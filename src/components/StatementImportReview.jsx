// IMPORT REVIEW for a managing-agent statement (PNE / RMS).
//
// Upload -> Properly reads it -> Properly matches the rent -> a person
// reviews the exceptions -> approves -> the Rent Tracker updates. Nothing is
// written until Approve. Every line shows what was read, what it was matched
// to and why its status is what it is; anything uncertain is left out until
// someone confirms or corrects it. The logic is in lib/statementImport.js
// (pure, tested); this file is the screen and the commit call.
import { useState, useEffect, useMemo } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import MoneyInput from '../lib/MoneyInput'
import { naturalCompare } from '../lib/addressUtils'
import { normaliseStatementName } from '../lib/statementParser'
import {
  reviewRows, planImport, planSummary, statusCounts, statementFingerprint, auditLines,
  REVIEW_STATUS, REVIEW_STATUS_LABEL,
} from '../lib/statementImport'

const gbp = n => n == null ? '–' : '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''
const KIND_LABEL = { rent: 'Rent', arrears: 'Arrears', fee: 'Fee', deduction: 'Deduction', credit: 'Credit', other_income: 'Other income' }

export default function StatementImportReview({ parsed, file, fileName, sourceDoc, properties, companies, aliases, canWriteProperty, onDone, onBack, showToast }) {
  const { T } = useTheme()
  const [overrides, setOverrides] = useState({})
  const [ctx, setCtx] = useState({ knownRefs: new Set(), existingFees: [] })
  const [ctxLoaded, setCtxLoaded] = useState(false)
  const [previous, setPrevious] = useState([])
  const [companyOverride, setCompanyOverride] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const fingerprint = useMemo(() => statementFingerprint(parsed), [parsed])
  const header = parsed.header

  const { company, rows: rawRows } = useMemo(
    () => reviewRows(parsed, { properties, companies, companyId: companyOverride, aliases, knownRefs: ctx.knownRefs, existingFees: ctx.existingFees }, overrides),
    [parsed, properties, companies, aliases, ctx, overrides, companyOverride])

  // Read-only companies: rows are shown but cannot be written.
  const rows = rawRows.map(r => r.propertyId && canWriteProperty && !canWriteProperty(r.propertyId)
    ? { ...r, include: false, status: r.status === REVIEW_STATUS.READY ? REVIEW_STATUS.NEEDS_REVIEW : r.status, reasons: [...r.reasons, 'You have read-only access to rent for this company'] }
    : r)

  // What is already recorded (for duplicate checks), and earlier imports.
  useEffect(() => {
    let live = true
    const scope = (company ? properties.filter(p => p.company_id === company.id) : properties).map(p => p.id)
    api.fetchStatementImportContext(scope, header.statementDate)
      .then(c => { if (live) { setCtx(c); setCtxLoaded(true) } })
      .catch(e => { console.error('fetchStatementImportContext', e); if (live) setCtxLoaded(true) })
    api.findPreviousStatementImports({ agent: header.agent, statementRef: header.statementRef, fingerprint })
      .then(p => { if (live) setPrevious(p) })
      .catch(e => console.error('findPreviousStatementImports', e))
    return () => { live = false }
  }, [company?.id, fingerprint]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = statusCounts(rows)
  const plan = useMemo(() => planImport(rows, { header }), [rows, header])
  const summary = planSummary(plan)
  const shown = rows.filter(r => filter === 'all' || r.status === filter)
  const set = (lineNo, patch) => setOverrides(o => ({ ...o, [lineNo]: { ...(o[lineNo] || {}), ...patch } }))
  const propOptions = useMemo(() => [...properties].filter(p => p.status !== 'sold').sort((a, b) => (a.company_id === company?.id ? 0 : 1) - (b.company_id === company?.id ? 0 : 1) || naturalCompare(a.name, b.name)), [properties, company?.id])

  async function approve() {
    if (!summary.rentReceipts && !summary.arrearsReceipts && !plan.expenses.length) return
    setBusy(true)
    try {
      let companyDocumentId = null
      if (file && !sourceDoc && company) {
        try { companyDocumentId = (await api.uploadStatementPdf(company.id, file)).id }
        catch (e) { console.error('uploadStatementPdf', e); showToast?.('The statement PDF could not be stored; the import will still be recorded: ' + (e.message || ''), 'error') }
      }
      const res = await api.commitStatementImport({
        plan, header, companyId: company?.id || null, filename: fileName || sourceDoc?.name || null, fingerprint,
        balance: parsed.balance, auditLines: auditLines(rows, overrides), companyDocumentId, propertyDocumentId: sourceDoc?.id || null,
      })
      // Remember labels the person matched by hand, for next month.
      const seen = new Set()
      for (const r of rows) {
        if (r.matchedVia !== 'manual' || !r.propertyId || !r.include) continue
        const norm = normaliseStatementName(r.line.property_address)
        const prop = properties.find(p => p.id === r.propertyId)
        if (!norm || seen.has(norm) || norm === normaliseStatementName(prop?.name)) continue
        seen.add(norm)
        try { await api.saveStatementAlias(r.propertyId, r.line.property_address, norm) } catch (e) { console.error('saveStatementAlias', e) }
      }
      if (sourceDoc) {
        try { await api.markStatementImported(sourceDoc.id, { batch_id: res.batchId, rent: res.receipts, fees: res.expenses, skipped: res.skipped }) } catch (e) { console.error('markStatementImported', e) }
      }
      onDone({ ...res, learned: seen.size, summary })
    } catch (e) {
      console.error('commitStatementImport', e)
      showToast?.(e.message || 'The import could not be completed', 'error')
    }
    setBusy(false)
  }

  const statusColor = s => ({ ready: T.green, matched: T.blue, needs_review: T.amber, unmatched: T.red, duplicate: T.muted }[s] || T.muted)
  const th = { fontFamily: MONO, fontSize: 9, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left', padding: '0 8px 6px 0', fontWeight: 400, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: T.card }
  const td = { fontSize: 12, padding: '7px 8px 7px 0', borderTop: `1px solid ${T.border}`, verticalAlign: 'top' }
  const num = { ...td, fontFamily: MONO, textAlign: 'right', whiteSpace: 'nowrap' }
  const inp = { fontFamily: MONO, fontSize: 11, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '4px 6px' }
  const bal = parsed.balance

  return <div>
    {/* Statement header */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
      {[
        ['Managing agent', header.agent === 'RMS' ? 'Rook Matthews Sayer' : header.agent === 'PNE' ? 'PNE Asset Management' : (header.agent || '–')],
        ['Statement', header.statementRef ? (header.statementNumber != null ? `No. ${header.statementRef}` : header.statementRef) : '–'],
        ['Statement date', dmy(header.statementDate) || '–'],
        ['Statement period', header.periodStart ? `${dmy(header.periodStart)} – ${dmy(header.periodEnd)}` : '–'],
        ['Paid to you', gbp(header.paymentAmount)],
        ['Agent invoice', header.invoiceNumber ? `${header.invoiceNumber}${header.invoiceFees != null ? ` · ${gbp(header.invoiceFees)}` : ''}` : '–'],
      ].map(([l, v]) => <div key={l} style={{ background: T.bg, borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</div>
      </div>)}
    </div>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontFamily: MONO, fontSize: 11 }}>
      <span style={{ color: T.muted }}>Company: {header.landlordCompany ? `"${header.landlordCompany}" on the statement →` : ''}</span>
      <select value={companyOverride || company?.id || ''} onChange={e => setCompanyOverride(e.target.value || null)} style={inp} aria-label="Company this statement belongs to">
        <option value="">Not matched: all companies</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {bal && <span style={{ color: bal.balances ? T.green : T.red }}>
        {bal.balances ? `Balances: income less fees and deductions = ${gbp(bal.stated)} paid` : `Does not balance: expected ${gbp(bal.expected)}, statement says ${gbp(bal.stated)}`}
      </span>}
    </div>
    {bal && !bal.balances && bal.causes?.length > 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.muted, marginBottom: 10 }}>{bal.causes.join(' ')}</div>}
    {previous.length > 0 && <div role="alert" style={{ background: T.red + '14', border: `1px solid ${T.red}55`, color: T.text, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12.5 }}>
      <b>This statement has already been imported</b> ({previous.map(p => `${new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${p.filename ? `, ${p.filename}` : ''}`).join('; ')}). Lines already recorded show as Duplicate and will not be added again. Revert the earlier import from Data import → History if it was wrong.
    </div>}
    {(parsed.warnings || []).filter(w => !/audit statement number/i.test(w)).length > 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.amber, marginBottom: 10 }}>{parsed.warnings.filter(w => !/audit statement number/i.test(w)).join(' ')}</div>}
    {(parsed.errors || []).length > 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.red, marginBottom: 10 }}>{parsed.errors.length} {parsed.errors.length === 1 ? 'entry' : 'entries'} could not be read: {parsed.errors.map(e => `${e.property_address || 'no property'} (${e.reason})`).join('; ')}. Add them by hand in the Rent Tracker.</div>}

    {/* Status filter */}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {[['all', `All ${rows.length}`], ...['ready', 'needs_review', 'unmatched', 'duplicate', 'matched'].filter(s => counts[s]).map(s => [s, `${REVIEW_STATUS_LABEL[s]} ${counts[s]}`])].map(([k, l]) => (
        <button key={k} onClick={() => setFilter(k)} style={{ fontFamily: MONO, fontSize: 10.5, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${filter === k ? (k === 'all' ? T.gold : statusColor(k)) : T.border}`, background: filter === k ? (k === 'all' ? T.gold : statusColor(k)) + '22' : 'transparent', color: k === 'all' ? T.text : statusColor(k) }}>{l}</button>
      ))}
      {!ctxLoaded && <span style={{ fontFamily: MONO, fontSize: 10, color: T.faint, alignSelf: 'center' }}>Checking what is already recorded…</span>}
    </div>

    {/* Review table */}
    <div style={{ overflow: 'auto', maxHeight: '58vh', border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead><tr>
          <th style={th}></th><th style={th}>Property</th><th style={th}>Tenant</th><th style={th}>Rent period</th>
          <th style={{ ...th, textAlign: 'right' }}>Rent due</th><th style={{ ...th, textAlign: 'right' }}>Amount received</th>
          <th style={{ ...th, textAlign: 'right' }}>Fee</th><th style={{ ...th, textAlign: 'right' }}>VAT</th><th style={{ ...th, textAlign: 'right' }}>Other deduction</th>
          <th style={th}>Suggested match</th><th style={th}>Status</th>
        </tr></thead>
        <tbody>{shown.map(r => {
          const canInclude = [REVIEW_STATUS.READY, REVIEW_STATUS.MATCHED].includes(r.status) && !r.blocked
          const needsConfirm = r.status === REVIEW_STATUS.NEEDS_REVIEW || (r.status === REVIEW_STATUS.DUPLICATE && !r.reasons.some(x => /Already imported from this statement/.test(x)))
          const isMoneyIn = ['rent', 'arrears', 'other_income'].includes(r.kind)
          return <tr key={r.lineNo} style={{ opacity: r.include ? 1 : 0.78 }}>
            <td style={td}><input type="checkbox" checked={r.include} disabled={!canInclude} onChange={e => set(r.lineNo, { include: e.target.checked })} aria-label={`Import line ${r.lineNo}`} style={{ width: 'auto', margin: 0 }} /></td>
            <td style={{ ...td, minWidth: 190 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint }}>{KIND_LABEL[r.kind]} · "{r.line.property_address || '—'}"</div>
              <select value={r.propertyId || ''} onChange={e => set(r.lineNo, { propertyId: e.target.value || null })} style={{ ...inp, width: '100%', marginTop: 2 }} aria-label="Property">
                <option value="">Choose property…</option>
                {propOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </td>
            <td style={{ ...td, minWidth: 110 }}>{r.tenant || <span style={{ color: T.faint }}>—</span>}{r.tenancy && <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint }}>tenancy: {r.tenancy.tenant_name || 'on record'}</div>}</td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>
              {r.kind === 'rent'
                ? <div style={{ display: 'grid', gap: 3 }}>
                    <input type="date" value={r.periodStart || ''} onChange={e => set(r.lineNo, { periodStart: e.target.value || null })} style={inp} aria-label="Rent from" />
                    <input type="date" value={r.periodEnd || ''} onChange={e => set(r.lineNo, { periodEnd: e.target.value || null })} style={inp} aria-label="Rent to" />
                  </div>
                : <span style={{ fontFamily: MONO, fontSize: 11 }}>{r.periodStart ? `${dmy(r.periodStart)} – ${dmy(r.periodEnd)}` : '—'}</span>}
            </td>
            <td style={num}>{r.kind === 'rent' ? gbp(r.rentDue) : ''}{r.kind === 'rent' && r.alreadyReceived > 0 && <div style={{ fontSize: 9.5, color: T.faint }}>{gbp(r.alreadyReceived)} in</div>}</td>
            <td style={num}>{isMoneyIn || r.kind === 'credit'
              ? <MoneyInput prefix="£" value={r.amount} onChange={v => set(r.lineNo, { amount: v == null ? 0 : v })} style={{ ...inp, width: 90, textAlign: 'right' }} />
              : ''}</td>
            <td style={num}>{r.kind === 'fee' ? gbp(r.fee) : ''}{r.kind === 'fee' && r.line.fee_pct != null && <div style={{ fontSize: 9.5, color: T.faint }}>{r.line.fee_pct}%</div>}</td>
            <td style={num}>{r.vat ? gbp(r.vat) : ''}</td>
            <td style={num}>{r.kind === 'deduction' ? gbp(r.deduction) : ''}</td>
            <td style={{ ...td, minWidth: 170, fontSize: 11.5 }}>
              {r.property ? <>
                <div>{r.property.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint }}>
                  {r.matchedVia === 'alias' ? 'remembered label' : r.matchedVia === 'manual' ? 'chosen by you' : r.matchScore != null ? `name match ${r.matchScore}` : ''}
                  {r.targetLabel ? ` → ${r.targetLabel}` : ''}
                </div>
              </> : <span style={{ color: T.faint }}>—</span>}
            </td>
            <td style={{ ...td, minWidth: 190 }}>
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: statusColor(r.status) }}>{REVIEW_STATUS_LABEL[r.status]}</span>
              {r.reasons.length > 0 && <ul style={{ margin: '3px 0 0', paddingLeft: 14, fontSize: 10.5, color: T.muted, lineHeight: 1.4 }}>{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {needsConfirm && !r.blocked && <button onClick={() => set(r.lineNo, { confirmed: true, include: true })} style={{ marginTop: 4, fontFamily: MONO, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: `1px solid ${T.amber}`, background: 'transparent', color: T.amber, cursor: 'pointer' }}>Checked: import it</button>}
              {r.confirmed && <button onClick={() => set(r.lineNo, { confirmed: false, include: undefined })} style={{ marginTop: 4, marginLeft: 4, fontFamily: MONO, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Undo</button>}
            </td>
          </tr>
        })}</tbody>
      </table>
    </div>

    {/* Approve */}
    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
        On approval: {summary.rentReceipts} rent {summary.rentReceipts === 1 ? 'receipt' : 'receipts'} ({gbp(summary.rentTotal)}) across {summary.periods} rent {summary.periods === 1 ? 'period' : 'periods'}{summary.newPeriods ? ` (${summary.newPeriods} new)` : ''}
        {summary.arrearsReceipts ? ` · ${summary.arrearsReceipts} arrears` : ''} · {summary.fees} agent {summary.fees === 1 ? 'fee' : 'fees'} ({gbp(summary.feeTotal)}){summary.otherExpenses ? ` · ${summary.otherExpenses} other` : ''}
        {summary.bridges ? ` · ${summary.bridges} hand-entered ${summary.bridges === 1 ? 'amount' : 'amounts'} kept as ${summary.bridges === 1 ? 'a receipt' : 'receipts'}` : ''}.
        <br />The Rent Tracker and the dashboard update from these. Recorded only: nothing is sent anywhere. The whole import can be reverted from Data import → History.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>← Back</button>
        <button className="btn btn-gold" onClick={approve} disabled={busy || !ctxLoaded || (!summary.rentReceipts && !summary.arrearsReceipts && !plan.expenses.length)}>
          {busy ? 'Importing…' : `Approve import (${rows.filter(r => r.include).length} ${rows.filter(r => r.include).length === 1 ? 'line' : 'lines'})`}
        </button>
      </div>
    </div>
  </div>
}
