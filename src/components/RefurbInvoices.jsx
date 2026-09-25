// Refurb invoices: Import Refurb Invoice (read the PDF, confirm the fields,
// allocate across properties, reconcile), the invoice list, one invoice's
// detail with Log Payment, and the "invoices behind this refurb" panel.
//
// An invoice is a COST, not a payment (Justin, 25 Sep 2026): importing one
// never moves Paid. Paid only moves when a payment is logged here or on the
// refurb, and a payment logged here is split across the invoice's properties
// in proportion to what each was allocated. All arithmetic is in
// lib/refurbInvoices.js (pure, tested); this file is forms and layout.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useConfirm } from '../lib/ConfirmContext'
import { useTheme } from '../lib/ThemeContext'
import MoneyInput from '../lib/MoneyInput'
import { extractPdfTextFromFile } from '../lib/pdfExtract'
import { groupPropertiesByBuilding, naturalCompare } from '../lib/addressUtils'
import { STAGE_CFG } from '../lib/refurbs'
import {
  DOC_KINDS, APPROVAL_STATUSES, INVOICE_STATUS_LABEL,
  allocationBase, evenSplit, percentSplit, reconcile, allocationProblems, findDuplicate,
  paidAgainst, invoiceStatus, outstandingOn, invoicesForProject, defaultProjectFor, extractInvoiceFields, round2,
} from '../lib/refurbInvoices'

const mono = MONO
const fmt2 = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const todayISO = () => new Date().toISOString().slice(0, 10)
const inputStyle = T => ({ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' })
const btn = (T, kind = 'ghost') => ({
  fontFamily: mono, fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${kind === 'gold' ? T.gold : kind === 'danger' ? T.red + '66' : T.border}`,
  background: kind === 'gold' ? T.gold : 'transparent', color: kind === 'gold' ? '#fff' : kind === 'danger' ? T.red : T.muted,
})
const lbl = T => ({ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, display: 'block', marginBottom: 4 })
const panel = T => ({ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 })

function statusTone(s, T) {
  return { paid: T.green, part_paid: T.amber, approved: T.blue, awaiting_approval: T.amber, received: T.muted, credit: T.purple || '#9B6FDE' }[s] || T.muted
}
export function InvoiceStatusChip({ status, T: themeProp }) {
  const { T: themeCtx } = useTheme()
  const T = themeProp || themeCtx
  const c = statusTone(status, T)
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: c + '22', color: c, whiteSpace: 'nowrap' }}>{INVOICE_STATUS_LABEL[status] || status}</span>
}

// Invoices for the whole account, loaded once per page.
export function useRefurbInvoices(showToast) {
  const [invoices, setInvoices] = useState(null)
  const reload = useCallback(() => api.fetchRefurbInvoices().then(setInvoices).catch(e => {
    console.error('fetchRefurbInvoices', e)
    // Before the migration is applied the table does not exist: show none.
    setInvoices([])
    if (!/refurb_invoices|does not exist|schema cache/i.test(e?.message || '')) showToast?.(e.message || 'Could not load invoices', 'error')
  }), [showToast])
  useEffect(() => { reload() }, [reload])
  return { invoices: invoices || [], loaded: invoices != null, setInvoices, reload }
}

// Every live refurb line across the account (payments linked to invoices).
export function allLinesOf(projects) {
  return (projects || []).flatMap(p => (p.refurb_lines || []).filter(l => !l.deleted_at).map(l => ({ ...l, project_id: l.project_id || p.id })))
}

// ── Import Refurb Invoice ──────────────────────────────────────────────────
const emptyInvoice = companyId => ({
  company_id: companyId || '', doc_kind: 'invoice', credits_invoice_id: '', supplier_name: '', invoice_number: '',
  invoice_date: todayISO(), due_date: '', description: '', net_amount: '', vat_amount: '', gross_amount: '',
  allocation_basis: 'gross', approval_status: 'received', notes: '',
})

function matchCompany(hint, companies) {
  const h = String(hint || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  if (!h.trim()) return null
  return companies.find(c => {
    const n = String(c.name || '').toLowerCase().replace(/\b(ltd|limited)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').trim()
    return n && h.includes(n.split(' ').slice(0, 2).join(' '))
  }) || null
}

export function ImportRefurbInvoice({ properties, companies, invoices, canEditFor, mutations, onCreated, onCancel, showToast, T: themeProp, isMobile, defaultCompanyId }) {
  const { T: themeCtx } = useTheme()
  const T = themeProp || themeCtx
  const editableCompanies = companies.filter(c => canEditFor(c.id))
  const [step, setStep] = useState('upload') // upload | details | allocate
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState('')
  const [inv, setInv] = useState(() => emptyInvoice(defaultCompanyId && canEditFor(defaultCompanyId) ? defaultCompanyId : editableCompanies[0]?.id))
  const [extracted, setExtracted] = useState(null)
  const [method, setMethod] = useState('even')
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setInv(f => ({ ...f, [k]: v }))

  async function readFile(f) {
    if (!f) return
    setFile(f); setReading(true); setReadNote('')
    try {
      const text = f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? await extractPdfTextFromFile(f) : ''
      const x = extractInvoiceFields(text)
      setExtracted({ ...x, text_chars: text.length })
      const co = matchCompany(x.company_hint, editableCompanies)
      setInv(cur => ({
        ...cur,
        company_id: co?.id || cur.company_id,
        doc_kind: x.doc_kind || cur.doc_kind,
        supplier_name: x.supplier_name || cur.supplier_name,
        invoice_number: x.invoice_number || cur.invoice_number,
        invoice_date: x.invoice_date || cur.invoice_date,
        due_date: x.due_date || cur.due_date,
        description: x.description || cur.description,
        net_amount: x.net_amount ?? cur.net_amount,
        vat_amount: x.vat_amount ?? cur.vat_amount,
        gross_amount: x.gross_amount ?? cur.gross_amount,
      }))
      const found = ['supplier_name', 'invoice_number', 'invoice_date', 'gross_amount'].filter(k => x[k] != null).length
      setReadNote(text.trim().length < 20
        ? 'No text could be read from this file (it may be a scan). Enter the details below; the file is still kept with the invoice.'
        : `Read ${found} of 4 key fields from the PDF. Check every field before continuing.`)
    } catch (e) {
      console.error('refurb invoice read', e)
      setReadNote('Could not read this PDF: ' + (e.message || 'unknown error') + '. Enter the details below.')
    }
    setReading(false); setStep('details')
  }

  const duplicate = useMemo(() => inv.doc_kind === 'invoice' ? findDuplicate(inv, (invoices || []).filter(i => i.company_id === inv.company_id)) : null, [inv, invoices])
  const base = allocationBase(inv)

  // Candidate properties: the invoice's company, editable, not sold.
  const candidates = useMemo(() => (properties || [])
    .filter(p => p.company_id === inv.company_id && p.status !== 'sold' && !p.archived_at)
    .sort((a, b) => naturalCompare(a.name, b.name)), [properties, inv.company_id])
  const groups = useMemo(() => groupPropertiesByBuilding(candidates), [candidates])
  const blocks = groups.filter(g => g.isBuilding)
  const shown = candidates.filter(p => !search.trim() || `${p.name} ${p.address || ''}`.toLowerCase().includes(search.toLowerCase()))
  const selectedIds = new Set(rows.map(r => r.property_id))

  // Recompute amounts whenever the method, base or selection changes.
  function withAmounts(list, m = method, b = base) {
    if (m === 'even') { const parts = evenSplit(b, list.length); return list.map((r, i) => ({ ...r, amount: parts[i] ?? 0 })) }
    if (m === 'percent') { const parts = percentSplit(b, list.map(r => r.pct)); return list.map((r, i) => ({ ...r, amount: parts[i] ?? 0 })) }
    return list
  }
  useEffect(() => { setRows(r => withAmounts(r)) }, [method, base]) // eslint-disable-line react-hooks/exhaustive-deps

  function rowFor(p) {
    const proj = defaultProjectFor(p)
    return { property_id: p.id, project_id: proj?.id || '', create_project: !proj, amount: 0, pct: '', is_variation: false }
  }
  function toggle(p) {
    setRows(r => withAmounts(selectedIds.has(p.id) ? r.filter(x => x.property_id !== p.id) : [...r, rowFor(p)]))
  }
  function selectMany(list, on = true) {
    setRows(r => {
      const have = new Set(r.map(x => x.property_id))
      const next = on ? [...r, ...list.filter(p => !have.has(p.id)).map(rowFor)] : r.filter(x => !list.some(p => p.id === x.property_id))
      return withAmounts(next)
    })
  }
  function setRow(i, patch) {
    setRows(r => {
      const next = r.map((x, j) => j === i ? { ...x, ...patch } : x)
      return 'pct' in patch ? withAmounts(next) : next
    })
  }
  function evenPercent() {
    const n = rows.length; if (!n) return
    const each = Math.floor(10000 / n) / 100
    const pcts = rows.map((_, i) => i === n - 1 ? round2(100 - each * (n - 1)) : each)
    setRows(r => withAmounts(r.map((x, i) => ({ ...x, pct: pcts[i] }))))
  }

  const rec = reconcile(base, rows.map(r => r.amount))
  const pctTotal = round2(rows.reduce((s, r) => s + (Number(r.pct) || 0), 0))
  const problems = allocationProblems(inv, rows)
  const detailProblems = allocationProblems(inv, [{ project_id: 'x', amount: base }]).filter(p => !/allocate|Select at least/.test(p))

  async function save() {
    if (problems.length || duplicate) return
    setSaving(true)
    try {
      // 1. Keep the original file with the invoice.
      let documentId = null
      if (file) {
        try { documentId = (await api.uploadRefurbInvoiceFile(inv.company_id, file)).id }
        catch (e) { console.error('upload refurb invoice', e); showToast?.('The invoice will be saved without its PDF: ' + (e.message || 'upload failed'), 'error') }
      }
      // 2. Properties with no refurb get one, so the cost has a home.
      const resolved = []
      for (const r of rows) {
        if (r.project_id && !r.create_project) { resolved.push(r); continue }
        const created = await mutations.createProject(r.property_id, { title: 'Refurbishment', stage: 'in_progress', contractor_name: inv.supplier_name.trim(), agreed_price: 0, start_date: inv.invoice_date || null })
        if (!created) throw new Error('Could not create a refurb for one of the properties')
        resolved.push({ ...r, project_id: created.id, create_project: false })
      }
      // 3. Header + allocations + variation extras, reconciled, in one go.
      const payload = {
        ...inv, supplier_name: inv.supplier_name.trim(), invoice_number: inv.invoice_number.trim(),
        net_amount: inv.net_amount === '' ? null : inv.net_amount, vat_amount: inv.vat_amount === '' ? null : inv.vat_amount,
        credits_invoice_id: inv.doc_kind === 'credit_note' ? (inv.credits_invoice_id || null) : null,
        document_id: documentId, extracted: extracted ? { ...extracted } : null,
      }
      const allocations = resolved.map(r => ({
        project_id: r.project_id, property_id: r.property_id, amount: round2(r.amount), split_method: method === 'even' ? 'even' : method === 'percent' ? 'percent' : 'amount',
        split_pct: method === 'percent' ? Number(r.pct) || 0 : null, is_variation: inv.doc_kind === 'invoice' && !!r.is_variation,
      }))
      const res = await api.createRefurbInvoice(payload, allocations)
      onCreated?.(res)
    } catch (e) {
      console.error('create refurb invoice', e)
      showToast?.(e.message || 'Could not save the invoice', 'error')
    }
    setSaving(false)
  }

  const propName = id => properties.find(p => p.id === id)?.name || 'Property'
  const projectsOf = id => (properties.find(p => p.id === id)?.refurb_projects || []).filter(p => !p.deleted_at)

  const head = <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
    <div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Import refurb invoice</div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 2 }}>
        {['upload', 'details', 'allocate'].map((s, i) => <span key={s} style={{ color: step === s ? T.gold : T.muted }}>{i ? ' → ' : ''}{i + 1}. {{ upload: 'Upload', details: 'Check details', allocate: 'Allocate' }[s]}</span>)}
      </div>
    </div>
    <button onClick={onCancel} style={btn(T)}>Cancel</button>
  </div>

  if (!editableCompanies.length) return <div style={panel(T)}>{head}<div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>You need edit access to a company to import invoices.</div></div>

  if (step === 'upload') return <div style={panel(T)}>
    {head}
    <label style={{ display: 'block', border: `1.5px dashed ${T.border}`, borderRadius: 10, padding: 28, textAlign: 'center', cursor: 'pointer' }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}>
      <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => readFile(e.target.files?.[0])} />
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{reading ? 'Reading the invoice…' : 'Drop the contractor invoice or credit note here'}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>PDF preferred. Supplier, invoice number, dates and totals are read where the PDF has text; you confirm everything before it is saved.</div>
    </label>
    <div style={{ marginTop: 10 }}><button onClick={() => setStep('details')} style={btn(T)}>Enter manually without a file</button></div>
  </div>

  if (step === 'details') {
    const co = editableCompanies.find(c => c.id === inv.company_id)
    return <div style={panel(T)}>
      {head}
      {readNote && <div style={{ fontFamily: mono, fontSize: 11, color: T.amber, background: T.amber + '14', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>{readNote}</div>}
      {file && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 10 }}>File: {file.name} (kept with the invoice)</div>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
        <div><label style={lbl(T)}>Type</label>
          <select value={inv.doc_kind} onChange={e => set('doc_kind', e.target.value)} style={inputStyle(T)}>{DOC_KINDS.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}</select></div>
        <div><label style={lbl(T)}>Company (billed to)</label>
          <select value={inv.company_id} onChange={e => { set('company_id', e.target.value); setRows([]) }} style={inputStyle(T)}>{editableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label style={lbl(T)}>Status</label>
          <select value={inv.approval_status} onChange={e => set('approval_status', e.target.value)} style={inputStyle(T)}>{APPROVAL_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></div>
        <div><label style={lbl(T)}>Supplier / contractor *</label><input value={inv.supplier_name} onChange={e => set('supplier_name', e.target.value)} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>{inv.doc_kind === 'credit_note' ? 'Credit note number' : 'Invoice number'}</label><input value={inv.invoice_number} onChange={e => set('invoice_number', e.target.value)} style={inputStyle(T)} /></div>
        {inv.doc_kind === 'credit_note'
          ? <div><label style={lbl(T)}>Credits invoice (optional)</label>
              <select value={inv.credits_invoice_id} onChange={e => set('credits_invoice_id', e.target.value)} style={inputStyle(T)}>
                <option value="">Not linked</option>
                {(invoices || []).filter(i => i.company_id === inv.company_id && i.doc_kind === 'invoice').map(i => <option key={i.id} value={i.id}>{i.supplier_name} {i.invoice_number || ''} · {fmt2(i.gross_amount)}</option>)}
              </select></div>
          : <div />}
        <div><label style={lbl(T)}>Invoice date</label><input type="date" value={inv.invoice_date || ''} onChange={e => set('invoice_date', e.target.value)} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>Due date</label><input type="date" value={inv.due_date || ''} onChange={e => set('due_date', e.target.value)} style={inputStyle(T)} /></div>
        <div />
        <div><label style={lbl(T)}>Net</label><MoneyInput prefix="£" value={inv.net_amount} onChange={v => set('net_amount', v == null ? '' : v)} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>VAT</label><MoneyInput prefix="£" value={inv.vat_amount} onChange={v => set('vat_amount', v == null ? '' : v)} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>Gross *</label><MoneyInput prefix="£" value={inv.gross_amount} onChange={v => set('gross_amount', v == null ? '' : v)} style={{ ...inputStyle(T), fontWeight: 700 }} /></div>
      </div>
      <div style={{ marginTop: 10 }}><label style={lbl(T)}>Description of works</label>
        <textarea rows={2} value={inv.description} onChange={e => set('description', e.target.value)} style={{ ...inputStyle(T), resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} /></div>
      <div style={{ marginTop: 10 }}>
        <label style={lbl(T)}>Allocate on</label>
        <div style={{ display: 'flex', gap: 14, fontFamily: mono, fontSize: 11.5, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={inv.allocation_basis === 'gross'} onChange={() => set('allocation_basis', 'gross')} style={{ width: 'auto', margin: 0 }} /> Gross (VAT is a cost{co ? ` to ${co.name}` : ''})</label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={inv.allocation_basis === 'net'} onChange={() => set('allocation_basis', 'net')} style={{ width: 'auto', margin: 0 }} /> Net (VAT reclaimable)</label>
        </div>
      </div>
      {duplicate && <div role="alert" style={{ marginTop: 12, fontFamily: mono, fontSize: 11.5, color: T.red, background: T.red + '14', borderRadius: 8, padding: '8px 10px' }}>
        Already imported: {duplicate.supplier_name} {duplicate.invoice_number} ({fmt2(duplicate.gross_amount)}, {fmtDate(duplicate.invoice_date)}). The same invoice cannot be imported twice.
      </div>}
      {detailProblems.length > 0 && <div style={{ marginTop: 10, fontFamily: mono, fontSize: 11, color: T.amber }}>{detailProblems.join(' · ')}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => setStep('upload')} style={btn(T)}>← Back</button>
        <button onClick={() => setStep('allocate')} disabled={!!duplicate || detailProblems.length > 0} style={{ ...btn(T, 'gold'), opacity: duplicate || detailProblems.length ? 0.5 : 1 }}>Allocate to properties →</button>
      </div>
    </div>
  }

  // step === 'allocate'
  return <div style={panel(T)}>
    {head}
    <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 10 }}>
      {inv.supplier_name} · {inv.invoice_number || 'no number'} · {inv.doc_kind === 'credit_note' ? 'credit note' : 'invoice'} · allocating {inv.allocation_basis} {fmt2(base)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 14 }}>
      <div>
        <label style={lbl(T)}>Select properties</label>
        {blocks.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {blocks.map(g => {
            const all = g.items.every(p => selectedIds.has(p.id))
            return <button key={g.tail} onClick={() => selectMany(g.items, !all)} style={{ ...btn(T), padding: '4px 10px', color: all ? T.gold : T.muted, borderColor: all ? T.gold : T.border }}>
              {all ? '✓ ' : '+ '}Whole block: {g.tail} ({g.items.length})
            </button>
          })}
        </div>}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties" style={{ ...inputStyle(T), marginBottom: 6 }} />
        <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
          {shown.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: 10 }}>No properties for this company.</div>}
          {shown.map(p => <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${T.border}`, cursor: canEditFor(p.company_id) ? 'pointer' : 'not-allowed', fontSize: 12.5 }}>
            <input type="checkbox" checked={selectedIds.has(p.id)} disabled={!canEditFor(p.company_id)} onChange={() => toggle(p)} style={{ width: 'auto', margin: 0 }} />
            <span style={{ flex: 1 }}>{p.name}</span>
            {!defaultProjectFor(p) && <span style={{ fontFamily: mono, fontSize: 9.5, color: T.faint }}>no refurb yet</span>}
          </label>)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={() => selectMany(shown, true)} style={{ ...btn(T), padding: '3px 8px' }}>Select shown</button>
          <button onClick={() => setRows([])} style={{ ...btn(T), padding: '3px 8px' }}>Clear</button>
        </div>
      </div>

      <div>
        <label style={lbl(T)}>Split</label>
        <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          {[['even', 'Even split'], ['amount', 'Manual £'], ['percent', 'Manual %']].map(([k, l]) => (
            <button key={k} onClick={() => setMethod(k)} style={{ fontFamily: mono, fontSize: 11, padding: '6px 12px', border: 'none', cursor: 'pointer', background: method === k ? T.gold : 'transparent', color: method === k ? '#fff' : T.muted }}>{l}</button>
          ))}
        </div>
        {method === 'percent' && rows.length > 0 && <button onClick={evenPercent} style={{ ...btn(T), marginLeft: 8, padding: '4px 8px' }}>Fill equal %</button>}
        {rows.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '10px 0' }}>Tick one property, several, or a whole block.</div>}
        {rows.map((r, i) => {
          const projs = projectsOf(r.property_id)
          return <div key={r.property_id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'minmax(0,1.3fr) minmax(0,1.2fr) 110px', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={propName(r.property_id)}>{propName(r.property_id)}</div>
            <select value={r.create_project ? '__new' : r.project_id} onChange={e => setRow(i, e.target.value === '__new' ? { create_project: true, project_id: '' } : { create_project: false, project_id: e.target.value })} style={{ ...inputStyle(T), fontSize: 11 }} aria-label="Refurb to allocate to">
              {projs.map(p => <option key={p.id} value={p.id}>{p.title || 'Refurbishment'} · {STAGE_CFG[p.stage]?.label || p.stage}</option>)}
              <option value="__new">+ New refurb for this property</option>
            </select>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {method === 'percent'
                ? <><input type="number" min="0" max="100" step="0.01" value={r.pct} onChange={e => setRow(i, { pct: e.target.value })} style={{ ...inputStyle(T), width: 56, textAlign: 'right' }} aria-label="Percentage" /><span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>%</span></>
                : method === 'amount'
                  ? <MoneyInput prefix="£" value={r.amount} onChange={v => setRow(i, { amount: v == null ? 0 : v })} style={{ ...inputStyle(T), textAlign: 'right' }} />
                  : <span style={{ fontFamily: mono, fontSize: 12, marginLeft: 'auto' }}>{fmt2(r.amount)}</span>}
            </div>
            {method === 'percent' && <div style={{ gridColumn: '1 / -1', fontFamily: mono, fontSize: 10, color: T.muted, textAlign: 'right', marginTop: -4 }}>{fmt2(r.amount)}</div>}
            {inv.doc_kind === 'invoice' && <label style={{ gridColumn: '1 / -1', fontFamily: mono, fontSize: 10, color: T.muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!!r.is_variation} onChange={e => setRow(i, { is_variation: e.target.checked })} style={{ width: 'auto', margin: 0 }} />
              Variation: work beyond the agreed price (adds to Agreed as an extra)
            </label>}
          </div>
        })}

        {/* Live reconciliation */}
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontFamily: mono }}>
          {[['Invoice total', rec.total, T.text], ['Allocated', rec.allocated, T.text], ['Remaining', rec.remaining, Math.abs(rec.remaining) < 0.005 ? T.green : T.red]].map(([l, v, c]) => (
            <div key={l} style={{ background: T.bg, borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: c }}>{fmt2(v)}</div>
            </div>
          ))}
        </div>
        {method === 'percent' && rows.length > 0 && Math.abs(pctTotal - 100) > 0.001 && <div style={{ fontFamily: mono, fontSize: 11, color: T.amber, marginTop: 6 }}>Percentages add to {pctTotal}%; they must add to 100%.</div>}
        {problems.length > 0 && rows.length > 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 6 }}>{problems.join(' · ')}</div>}
        <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
          Saving records the cost against each refurb. It does not mark anything paid: log the payment on the invoice when the money goes out.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => setStep('details')} style={btn(T)}>← Back</button>
          <button onClick={save} disabled={saving || problems.length > 0 || !!duplicate} style={{ ...btn(T, 'gold'), opacity: saving || problems.length || duplicate ? 0.5 : 1 }}>
            {saving ? 'Saving…' : `Save ${inv.doc_kind === 'credit_note' ? 'credit note' : 'invoice'} to ${rows.length} ${rows.length === 1 ? 'property' : 'properties'}`}
          </button>
        </div>
      </div>
    </div>
  </div>
}

// ── Invoice list ───────────────────────────────────────────────────────────
export function InvoiceList({ invoices, companies, lines, onOpen, onImport, canImport, T: themeProp, isMobile }) {
  const { T: themeCtx } = useTheme()
  const T = themeProp || themeCtx
  const [status, setStatus] = useState('open')
  const rows = invoices.map(inv => ({ inv, st: invoiceStatus(inv, lines), paid: paidAgainst(inv.id, lines), out: outstandingOn(inv, lines) }))
    .filter(r => status === 'all' || (status === 'open' ? !['paid', 'credit'].includes(r.st) : r.st === status))
  const coName = id => companies.find(c => c.id === id)?.abbr || companies.find(c => c.id === id)?.name || ''
  const th = { fontFamily: mono, fontSize: 9.5, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left', padding: '0 8px 8px 0', fontWeight: 400, whiteSpace: 'nowrap' }
  const td = { fontSize: 12.5, padding: '8px 8px 8px 0', borderTop: `1px solid ${T.border}`, verticalAlign: 'top' }
  const num = { ...td, fontFamily: mono, textAlign: 'right', whiteSpace: 'nowrap' }
  return <div style={panel(T)}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle(T), width: 'auto' }} aria-label="Filter invoices">
        <option value="open">Not fully paid</option><option value="all">All</option>
        {Object.entries(INVOICE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {canImport && <button onClick={onImport} style={btn(T, 'gold')}>Import refurb invoice</button>}
    </div>
    {rows.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '12px 0' }}>No invoices here yet. Import one to allocate it across properties.</div>}
    {rows.length > 0 && <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr><th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>Number</th>{!isMobile && <th style={th}>Co</th>}<th style={th}>Properties</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={{ ...th, textAlign: 'right' }}>Paid</th><th style={{ ...th, textAlign: 'right' }}>Outstanding</th><th style={th}>Status</th></tr></thead>
      <tbody>{rows.map(({ inv, st, paid, out }) => (
        <tr key={inv.id} onClick={() => onOpen(inv)} style={{ cursor: 'pointer' }}>
          <td style={{ ...td, fontFamily: mono, whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date)}</td>
          <td style={td}>{inv.supplier_name}</td>
          <td style={{ ...td, fontFamily: mono }}>{inv.invoice_number || '—'}</td>
          {!isMobile && <td style={{ ...td, fontFamily: mono, fontSize: 11 }}>{coName(inv.company_id)}</td>}
          <td style={{ ...td, fontFamily: mono }}>{(inv.refurb_invoice_allocations || []).length}</td>
          <td style={num}>{inv.doc_kind === 'credit_note' ? '−' : ''}{fmt2(allocationBase(inv))}</td>
          <td style={num}>{inv.doc_kind === 'credit_note' ? '—' : fmt2(paid)}</td>
          <td style={{ ...num, color: out > 0 ? T.gold : T.muted }}>{inv.doc_kind === 'credit_note' ? '—' : fmt2(out)}</td>
          <td style={td}><InvoiceStatusChip status={st} T={T} /></td>
        </tr>
      ))}</tbody>
    </table></div>}
  </div>
}

// ── One invoice ────────────────────────────────────────────────────────────
export function InvoiceDetail({ invoice, properties, companies, projects, lines, canEdit, onUpdated, onDeleted, onLinesAdded, onOpenProject, onBack, showToast, T: themeProp, isMobile }) {
  const { T: themeCtx } = useTheme()
  const T = themeProp || themeCtx
  const confirmDialog = useConfirm()
  const st = invoiceStatus(invoice, lines)
  const out = outstandingOn(invoice, lines)
  const paidLines = lines.filter(l => l.invoice_id === invoice.id && l.kind !== 'extra').sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const [pay, setPay] = useState({ amount: out || '', date: todayISO(), payee: invoice.supplier_name, refund: false })
  const [busy, setBusy] = useState(false)
  useEffect(() => { setPay(p => ({ ...p, amount: out || '' })) }, [invoice.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const propName = id => properties.find(p => p.id === id)?.name || 'Property'
  const proj = id => projects.find(p => p.id === id)
  const company = companies.find(c => c.id === invoice.company_id)
  const isCredit = invoice.doc_kind === 'credit_note'

  async function openPdf() {
    try {
      const url = await api.getCompanyDocumentSignedUrlById(invoice.document_id)
      if (url) window.open(url, '_blank', 'noopener'); else showToast?.('The original file could not be found', 'error')
    } catch (e) { showToast?.(e.message || 'Could not open the file', 'error') }
  }
  async function setApproval(v) {
    try { onUpdated(await api.updateRefurbInvoice(invoice.id, { approval_status: v })) }
    catch (e) { showToast?.(e.message || 'Could not update', 'error') }
  }
  async function logPayment() {
    const amount = Number(pay.amount)
    if (!(amount > 0)) return
    if (!pay.refund && amount > out + 0.005 && !await confirmDialog({ title: 'Pay more than is outstanding?', body: `${fmt2(amount)} is more than the ${fmt2(out)} outstanding on this invoice.`, confirmLabel: 'Log it anyway' })) return
    setBusy(true)
    try {
      const created = await api.logRefurbInvoicePayment(invoice, { amount, date: pay.date || todayISO(), payee: pay.payee, kind: pay.refund ? 'credit' : 'payment' })
      onLinesAdded(created)
      showToast?.(`${pay.refund ? 'Refund' : 'Payment'} of ${fmt2(amount)} logged across ${created.length} ${created.length === 1 ? 'refurb' : 'refurbs'}`)
      setPay(p => ({ ...p, amount: '' }))
    } catch (e) { showToast?.(e.message || 'Could not log the payment', 'error') }
    setBusy(false)
  }
  async function remove() {
    if (!await confirmDialog({ title: 'Delete this invoice?', body: 'The invoice and its allocations are removed (variation extras with it). Payments already logged stay on each refurb, because that money was really paid.', confirmLabel: 'Delete', destructive: true })) return
    try { const res = await api.deleteRefurbInvoice(invoice.id); onDeleted(invoice, res.removedExtras) }
    catch (e) { showToast?.(e.message || 'Could not delete', 'error') }
  }

  const row = { display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : 'minmax(0,1.6fr) minmax(0,1.2fr) 120px 90px', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}`, fontSize: 12.5, alignItems: 'center' }
  return <div>
    <button onClick={onBack} style={{ ...btn(T), marginBottom: 12 }}>← Invoices</button>
    <div style={panel(T)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{invoice.supplier_name} · {invoice.invoice_number || 'no number'}</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
            {isCredit ? 'Credit note' : 'Invoice'} · {company?.name || ''} · dated {fmtDate(invoice.invoice_date)}{invoice.due_date ? ` · due ${fmtDate(invoice.due_date)}` : ''}
          </div>
          {invoice.description && <div style={{ fontSize: 13, marginTop: 6, maxWidth: 640 }}>{invoice.description}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <InvoiceStatusChip status={st} T={T} />
          {invoice.document_id && <button onClick={openPdf} style={btn(T)}>Open original</button>}
          {canEdit && <button onClick={remove} style={btn(T, 'danger')}>Delete</button>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6,1fr)', gap: 10, marginTop: 14, fontFamily: mono }}>
        {[['Net', invoice.net_amount], ['VAT', invoice.vat_amount], ['Gross', invoice.gross_amount], [`Allocated (${invoice.allocation_basis})`, allocationBase(invoice)], ['Paid', isCredit ? null : paidAgainst(invoice.id, lines)], ['Outstanding', isCredit ? null : out]].map(([l, v]) => (
          <div key={l}><div style={{ fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700 }}>{v == null || v === '' ? '—' : fmt2(v)}</div></div>
        ))}
      </div>
      {!isCredit && <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontFamily: mono, fontSize: 11 }}>
        <span style={{ color: T.muted }}>Approval:</span>
        <select value={invoice.approval_status} onChange={e => setApproval(e.target.value)} disabled={!canEdit} style={{ ...inputStyle(T), width: 'auto' }}>
          {APPROVAL_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <span style={{ color: T.faint }}>Part paid / Paid follow the payments logged below.</span>
      </div>}
    </div>

    <div style={panel(T)}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Allocated across {(invoice.refurb_invoice_allocations || []).length} {(invoice.refurb_invoice_allocations || []).length === 1 ? 'property' : 'properties'}</div>
      {(invoice.refurb_invoice_allocations || []).slice().sort((a, b) => naturalCompare(propName(a.property_id), propName(b.property_id))).map(a => {
        const p = proj(a.project_id)
        return <div key={a.id} style={row}>
          <span>{propName(a.property_id)}</span>
          {!isMobile && <button onClick={() => p && onOpenProject(p)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: p ? 'pointer' : 'default', color: T.blue, fontSize: 12 }}>{p ? `${p.title || 'Refurbishment'} · ${STAGE_CFG[p.stage]?.label || p.stage}` : 'Refurb removed'}</button>}
          <span style={{ fontFamily: mono, textAlign: 'right' }}>{isCredit ? '−' : ''}{fmt2(a.amount)}</span>
          {!isMobile && <span style={{ fontFamily: mono, fontSize: 10, color: a.is_variation ? T.amber : T.faint }}>{a.is_variation ? 'variation' : a.split_method}</span>}
        </div>
      })}
    </div>

    {!isCredit && <div style={panel(T)}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Payments against this invoice</div>
      {paidLines.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '6px 0' }}>Nothing paid yet. Importing an invoice never marks it paid.</div>}
      {paidLines.map(l => <div key={l.id} style={row}>
        <span style={{ fontFamily: mono }}>{fmtDate(l.date)}</span>
        {!isMobile && <span>{propName(proj(l.project_id)?.property_id)}</span>}
        <span style={{ fontFamily: mono, textAlign: 'right', color: l.kind === 'credit' ? T.red : T.green }}>{l.kind === 'credit' ? '−' : ''}{fmt2(l.amount)}</span>
        {!isMobile && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{l.kind === 'credit' ? 'refund' : 'payment'}</span>}
      </div>)}
      {canEdit && <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '130px 150px minmax(0,1fr) auto auto', gap: 8, alignItems: 'end', marginTop: 12 }}>
        <div><label style={lbl(T)}>{pay.refund ? 'Refund' : 'Amount paid'}</label><MoneyInput prefix="£" value={pay.amount} onChange={v => setPay(p => ({ ...p, amount: v == null ? '' : v }))} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>Date</label><input type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} style={inputStyle(T)} /></div>
        <div><label style={lbl(T)}>Paid to</label><input value={pay.payee} onChange={e => setPay(p => ({ ...p, payee: e.target.value }))} style={inputStyle(T)} /></div>
        <label style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, display: 'inline-flex', gap: 5, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={pay.refund} onChange={e => setPay(p => ({ ...p, refund: e.target.checked }))} style={{ width: 'auto', margin: 0 }} /> Refund from contractor
        </label>
        <button onClick={logPayment} disabled={busy || !(Number(pay.amount) > 0)} style={{ ...btn(T, 'gold'), opacity: busy || !(Number(pay.amount) > 0) ? 0.5 : 1 }}>{busy ? 'Saving…' : pay.refund ? 'Log refund' : 'Log payment'}</button>
      </div>}
      {canEdit && <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 6 }}>Recorded only: nothing is sent to the bank or Xero. The amount is split across the properties in proportion to their allocation.</div>}
    </div>}
  </div>
}

// ── Invoices behind one refurb (project detail / property tab) ─────────────
export function ProjectInvoices({ project, invoices, lines, onOpenInvoice, T: themeProp }) {
  const { T: themeCtx } = useTheme()
  const T = themeProp || themeCtx
  const rows = invoicesForProject(project.id, invoices)
  if (!rows.length) return null
  return <div style={panel(T)}>
    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Invoices allocated to this refurb</div>
    {rows.map(({ invoice, allocated }) => (
      <button key={invoice.id} onClick={() => onOpenInvoice?.(invoice)}
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 8, alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${T.border}`, padding: '7px 0', cursor: 'pointer', color: T.text, textAlign: 'left', fontSize: 12.5 }}>
        <span>{invoice.supplier_name} · {invoice.invoice_number || 'no number'} <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{fmtDate(invoice.invoice_date)} · of {fmt2(allocationBase(invoice))} across {(invoice.refurb_invoice_allocations || []).length}</span></span>
        <span style={{ fontFamily: mono }}>{invoice.doc_kind === 'credit_note' ? '−' : ''}{fmt2(allocated)}</span>
        <InvoiceStatusChip status={invoiceStatus(invoice, lines)} T={T} />
      </button>
    ))}
  </div>
}
