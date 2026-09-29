// External Loans — money lent into a company from outside the mortgage book
// (private lenders, directors, family, bridging).
//
// Record who it is from, how much, when it came in, the term and the rate;
// the page works out the monthly payment and the full schedule, and each
// month is ticked off once it has been paid. A tick records a payment that
// already happened; nothing here moves money. All arithmetic lives in
// lib/externalLoans.js (pure, tested); this file is layout and forms.
//
// URL: #/loans | #/loans/new | #/loans/<id>
import { useState, useEffect, useMemo, useCallback } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { useIsMobile } from '../lib/useWindowSize'
import { useConfirm } from '../lib/ConfirmContext'
import { canDo } from '../lib/permissions'
import MoneyInput from '../lib/MoneyInput'
import {
  REPAYMENT_TYPES, LENDER_TYPES, monthlyPayment, buildSchedule, loanStatus,
  summariseLoans, upcomingPayments, validateLoan, firstPaymentDate, todayISO,
} from '../lib/externalLoans'

const mono = MONO
const fmt = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const fmtP = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const typeLabel = v => REPAYMENT_TYPES.find(t => t.value === v)?.short || v
const lenderTypeLabel = v => LENDER_TYPES.find(t => t.value === v)?.label || v
const termLabel = m => {
  const n = Number(m) || 0
  if (n && n % 12 === 0) return `${n / 12} yr${n === 12 ? '' : 's'}`
  return `${n} mo`
}

const inputStyle = T => ({ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '7px 9px', outline: 'none', width: '100%', boxSizing: 'border-box' })
const btn = (T, kind = 'ghost') => ({
  fontFamily: mono, fontSize: 11, fontWeight: kind === 'gold' ? 700 : 500, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  background: kind === 'gold' ? T.gold : 'transparent', color: kind === 'gold' ? '#fff' : kind === 'danger' ? T.red : T.muted,
  border: `1px solid ${kind === 'gold' ? T.gold : kind === 'danger' ? T.red + '66' : T.border}`,
})
const card = T => ({ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 })

function CoChip({ company, T }) {
  if (!company) return null
  const col = company.color || T.gold
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: col + '22', color: col, whiteSpace: 'nowrap' }}>{company.abbr || company.name}</span>
}

function StatusChip({ status, T }) {
  const cfg = { active: ['Running', T.green], overdue: ['Overdue', T.red], repaid: ['Repaid', T.muted] }[status] || ['—', T.muted]
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: cfg[1] + '22', color: cfg[1], border: `1px solid ${cfg[1]}44`, whiteSpace: 'nowrap' }}>{cfg[0]}</span>
}

function Stat({ label, value, color, sub, T }) {
  return <div style={{ ...card(T), padding: '12px 14px' }}>
    <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
    <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: color || T.text, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>{sub}</div>}
  </div>
}

function Field({ label, hint, children, T }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, marginBottom: 5 }}>{label}</div>
    {children}
    {hint && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>{hint}</div>}
  </label>
}

// ── Add / edit form, with the monthly payment worked out as you type ──────
const EMPTY = { company_id: '', property_id: '', lender_name: '', lender_type: 'private', reference: '', principal: null,
  received_date: todayISO(), term_months: 12, annual_rate: null, repayment_type: 'repayment', first_payment_date: '', purpose: '', notes: '' }

function LoanForm({ initial, companies, properties, editableCompanies, onSave, onCancel, T, isMobile }) {
  const [f, setF] = useState(() => ({ ...EMPTY, company_id: editableCompanies.length === 1 ? editableCompanies[0].id : '', ...(initial || {}) }))
  const [termUnit, setTermUnit] = useState(() => (Number(initial?.term_months) || 12) % 12 === 0 ? 'years' : 'months')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  const termValue = termUnit === 'years' ? (Number(f.term_months) || 0) / 12 : f.term_months
  const setTerm = v => set('term_months', termUnit === 'years' ? Math.round((Number(v) || 0) * 12) : Math.round(Number(v) || 0))

  const draft = { ...f, principal: Number(f.principal) || 0, annual_rate: Number(f.annual_rate) || 0, first_payment_date: f.first_payment_date || null }
  const preview = useMemo(() => {
    const rows = buildSchedule(draft)
    const total = rows.reduce((s, r) => s + r.payment, 0)
    return { pay: monthlyPayment(draft), rows, total, interest: total - draft.principal }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.principal, draft.annual_rate, draft.term_months, draft.repayment_type, draft.received_date, draft.first_payment_date])

  const coProps = useMemo(() => properties.filter(p => p.company_id === f.company_id && p.status !== 'sold'), [properties, f.company_id])

  async function submit() {
    const err = validateLoan(draft)
    if (err) { setError(err); return }
    setError(null); setSaving(true)
    const ok = await onSave({ ...draft, lender_name: f.lender_name.trim(), property_id: f.property_id || null })
    setSaving(false)
    if (!ok) setError('Could not save. Check the details and try again.')
  }

  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }
  const ist = inputStyle(T)
  return <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
    <div style={{ ...card(T), display: 'grid', gap: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{initial?.id ? 'Edit loan' : 'New external loan'}</div>
      <div style={grid}>
        <Field label="Who is it from" T={T}>
          <input style={ist} value={f.lender_name} onChange={e => set('lender_name', e.target.value)} placeholder="Lender name" autoFocus />
        </Field>
        <Field label="Type of lender" T={T}>
          <select style={ist} value={f.lender_type} onChange={e => set('lender_type', e.target.value)}>
            {LENDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Company receiving it" T={T}>
          <select style={ist} value={f.company_id} onChange={e => { set('company_id', e.target.value); set('property_id', '') }} disabled={!!initial?.id}>
            <option value="">Choose a company</option>
            {editableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Property (optional)" hint="Secured on, or used for" T={T}>
          <select style={ist} value={f.property_id || ''} onChange={e => set('property_id', e.target.value)} disabled={!f.company_id}>
            <option value="">Not linked to a property</option>
            {coProps.map(p => <option key={p.id} value={p.id}>{p.name || p.address}</option>)}
          </select>
        </Field>
        <Field label="Amount borrowed" T={T}>
          <MoneyInput prefix="£" value={f.principal} onChange={v => set('principal', v)} style={ist} placeholder="0" />
        </Field>
        <Field label="Date the money came in" T={T}>
          <input type="date" style={ist} value={f.received_date || ''} onChange={e => set('received_date', e.target.value)} />
        </Field>
        <Field label="How long for" T={T}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" min="1" step={termUnit === 'years' ? '0.5' : '1'} style={ist} value={termValue || ''} onChange={e => setTerm(e.target.value)} />
            <select style={{ ...ist, width: 110 }} value={termUnit} onChange={e => setTermUnit(e.target.value)}>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </div>
        </Field>
        <Field label="Interest rate (per year)" T={T}>
          <MoneyInput suffix="%" value={f.annual_rate} onChange={v => set('annual_rate', v)} style={ist} placeholder="0" />
        </Field>
        <Field label="How it is repaid" T={T}>
          <select style={ist} value={f.repayment_type} onChange={e => set('repayment_type', e.target.value)}>
            {REPAYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="First payment due" hint="Defaults to one month after the money came in" T={T}>
          <input type="date" style={ist} value={f.first_payment_date || ''} onChange={e => set('first_payment_date', e.target.value)} />
        </Field>
        <Field label="Reference (optional)" T={T}>
          <input style={ist} value={f.reference || ''} onChange={e => set('reference', e.target.value)} placeholder="Agreement or account ref" />
        </Field>
        <Field label="What it is for (optional)" T={T}>
          <input style={ist} value={f.purpose || ''} onChange={e => set('purpose', e.target.value)} placeholder="e.g. deposit on a purchase" />
        </Field>
      </div>
      <Field label="Notes" T={T}>
        <textarea style={{ ...ist, minHeight: 60, resize: 'vertical' }} value={f.notes || ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      {error && <div style={{ fontFamily: mono, fontSize: 11, color: T.red }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btn(T)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(T, 'gold'), padding: '8px 16px' }} onClick={submit} disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add loan'}</button>
      </div>
    </div>

    <div style={{ ...card(T), position: isMobile ? 'static' : 'sticky', top: 16 }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>
        {f.repayment_type === 'rolled_up' ? 'Repaid in one payment' : 'Monthly payment'}
      </div>
      <div style={{ fontFamily: mono, fontSize: 30, fontWeight: 800, color: T.gold, margin: '6px 0 12px', fontVariantNumeric: 'tabular-nums' }}>
        {f.repayment_type === 'rolled_up' ? fmtP(preview.total) : fmtP(preview.pay)}
      </div>
      {[
        ['Payments', preview.rows.length || '—'],
        ['First due', fmtDate(preview.rows[0]?.due_date || firstPaymentDate(draft))],
        ['Final due', fmtDate(preview.rows[preview.rows.length - 1]?.due_date)],
        f.repayment_type === 'interest_only' && preview.rows.length ? ['Final payment (incl. capital)', fmtP(preview.rows[preview.rows.length - 1].payment)] : null,
        ['Total interest', fmtP(Math.max(0, preview.interest))],
        ['Total to repay', fmtP(preview.total)],
      ].filter(Boolean).map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 12, padding: '6px 0', borderTop: `1px solid ${T.border}` }}>
        <span style={{ color: T.muted }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span>
      </div>)}
    </div>
  </div>
}

// ── One loan: facts + schedule with tick boxes ────────────────────────────
function ScheduleRow({ row, canEdit, onTick, onUntick, onUpdateTick, T, isMobile }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(row.paid?.amount ?? row.payment)
  const [date, setDate] = useState(row.paid?.paid_date || '')
  const [busy, setBusy] = useState(false)
  const paid = !!row.paid
  const tone = paid ? T.green : row.overdue ? T.red : T.text
  const td = { padding: '8px 10px', borderTop: `1px solid ${T.border}`, fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle' }

  async function toggle() {
    if (!canEdit || busy) return
    setBusy(true)
    if (paid) await onUntick(row)
    else await onTick(row)
    setBusy(false)
  }
  async function saveEdit() {
    setBusy(true)
    const ok = await onUpdateTick(row, { amount: Number(amount) || 0, paid_date: date || row.paid.paid_date })
    setBusy(false)
    if (ok) setEditing(false)
  }

  return <tr style={{ background: row.overdue ? T.red + '0d' : 'transparent', opacity: paid ? 0.8 : 1 }}>
    <td style={{ ...td, width: 36 }}>
      <input type="checkbox" checked={paid} onChange={toggle} disabled={!canEdit || busy}
        aria-label={paid ? `Untick payment ${row.period}` : `Tick off payment ${row.period} as paid`}
        style={{ width: 18, height: 18, cursor: canEdit ? 'pointer' : 'default', accentColor: T.green }} />
    </td>
    <td style={{ ...td, color: T.muted }}>{row.period}</td>
    <td style={{ ...td, color: tone, fontWeight: row.overdue ? 700 : 400 }}>{fmtDate(row.due_date)}{row.overdue && <span style={{ fontSize: 10, marginLeft: 6 }}>OVERDUE</span>}</td>
    <td style={{ ...td, fontWeight: 700, textAlign: 'right' }}>{fmtP(row.payment)}</td>
    {!isMobile && <td style={{ ...td, color: T.muted, textAlign: 'right' }}>{fmtP(row.interest)}</td>}
    {!isMobile && <td style={{ ...td, color: T.muted, textAlign: 'right' }}>{fmtP(row.principal)}</td>}
    {!isMobile && <td style={{ ...td, color: T.muted, textAlign: 'right' }}>{fmtP(row.balance)}</td>}
    <td style={{ ...td, minWidth: 150 }}>
      {paid && !editing && <span style={{ color: T.green }}>
        Paid {fmtDate(row.paid.paid_date)}{Math.abs(Number(row.paid.amount) - row.payment) > 0.005 && ` · ${fmtP(row.paid.amount)}`}
        {canEdit && <button onClick={() => { setAmount(row.paid.amount); setDate(row.paid.paid_date); setEditing(true) }} style={{ ...btn(T), padding: '1px 6px', fontSize: 10, marginLeft: 6 }}>Edit</button>}
      </span>}
      {paid && editing && <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <MoneyInput prefix="£" value={amount} onChange={setAmount} style={{ ...inputStyle(T), width: 100, padding: '3px 6px' }} />
        <input type="date" value={date || ''} onChange={e => setDate(e.target.value)} style={{ ...inputStyle(T), width: 130, padding: '3px 6px' }} />
        <button onClick={saveEdit} disabled={busy} style={{ ...btn(T, 'gold'), padding: '3px 8px' }}>Save</button>
        <button onClick={() => setEditing(false)} style={{ ...btn(T), padding: '3px 8px' }}>×</button>
      </div>}
    </td>
  </tr>
}

function LoanDetail({ loan, company, property, canEdit, onBack, onEdit, onDelete, onTick, onUntick, onUpdateTick, openDetail, T, isMobile }) {
  const s = useMemo(() => loanStatus(loan), [loan])
  const [showAll, setShowAll] = useState(false)
  // Long schedules: show everything up to the next unpaid row plus a year.
  const cutoff = s.nextDue ? s.nextDue.period + 11 : s.periods
  const rows = showAll ? s.rows : s.rows.filter(r => r.period <= cutoff || !r.paid && r.overdue)
  const th = { padding: '8px 10px', fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, textAlign: 'left', fontWeight: 600 }
  const pct = s.periods ? Math.round(s.paidCount / s.periods * 100) : 0

  return <div className="fade">
    <button onClick={onBack} style={{ ...btn(T), marginBottom: 12 }}>← All loans</button>
    <div style={{ ...card(T), marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{loan.lender_name}</h2>
            <StatusChip status={s.status} T={T} />
            <CoChip company={company} T={T} />
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 6 }}>
            {lenderTypeLabel(loan.lender_type)} · {fmt(loan.principal)} received {fmtDate(loan.received_date)} · {Number(loan.annual_rate) || 0}% · {termLabel(loan.term_months)} · {typeLabel(loan.repayment_type)}
            {loan.reference && ` · Ref ${loan.reference}`}
          </div>
          {property && <div style={{ fontFamily: mono, fontSize: 11, marginTop: 4 }}>
            Property: <button onClick={() => openDetail?.(property)} style={{ background: 'none', border: 'none', padding: 0, color: T.gold, cursor: 'pointer', fontFamily: mono, fontSize: 11 }}>{property.name || property.address}</button>
          </div>}
          {loan.purpose && <div style={{ fontSize: 13, marginTop: 6 }}>{loan.purpose}</div>}
          {loan.notes && <div style={{ fontSize: 12, color: T.muted, marginTop: 4, whiteSpace: 'pre-wrap' }}>{loan.notes}</div>}
        </div>
        {canEdit && <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn(T)} onClick={onEdit}>Edit</button>
          <button style={btn(T, 'danger')} onClick={onDelete}>Delete</button>
        </div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginTop: 14 }}>
        <Stat T={T} label={loan.repayment_type === 'rolled_up' ? 'Repaid at end' : 'Monthly payment'} value={fmtP(loan.repayment_type === 'rolled_up' ? s.totalRepayable : s.regularPayment)} color={T.gold} />
        <Stat T={T} label="Capital outstanding" value={fmt(s.outstanding)} />
        <Stat T={T} label="Paid so far" value={fmt(s.paidToDate)} color={T.green} sub={`${s.paidCount} of ${s.periods} payments`} />
        <Stat T={T} label="Total interest" value={fmt(s.totalInterest)} sub={`${fmt(s.totalRepayable)} to repay in all`} />
        <Stat T={T} label={s.overdueCount ? 'Overdue' : 'Next due'} value={s.overdueCount ? fmtP(s.overdueAmount) : s.nextDue ? fmtDate(s.nextDue.due_date) : 'Repaid'}
          color={s.overdueCount ? T.red : undefined} sub={s.overdueCount ? `${s.overdueCount} payment${s.overdueCount === 1 ? '' : 's'}` : s.nextDue ? fmtP(s.nextDue.payment) : null} />
      </div>
      <div style={{ height: 6, background: T.bg, borderRadius: 3, overflow: 'hidden', marginTop: 14, border: `1px solid ${T.border}` }}>
        <div style={{ width: `${pct}%`, height: '100%', background: T.green }} />
      </div>
    </div>

    <div style={{ ...card(T), padding: 0, overflowX: 'auto' }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>Payment schedule</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{canEdit ? 'Tick a payment once it has been made' : 'View only'}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Paid</th><th style={th}>#</th><th style={th}>Due</th><th style={{ ...th, textAlign: 'right' }}>Payment</th>
          {!isMobile && <><th style={{ ...th, textAlign: 'right' }}>Interest</th><th style={{ ...th, textAlign: 'right' }}>Capital</th><th style={{ ...th, textAlign: 'right' }}>Balance after</th></>}
          <th style={th}></th>
        </tr></thead>
        <tbody>{rows.map(r => <ScheduleRow key={r.period + ':' + (r.paid?.id || '')} row={r} canEdit={canEdit} onTick={onTick} onUntick={onUntick} onUpdateTick={onUpdateTick} T={T} isMobile={isMobile} />)}</tbody>
      </table>
      {rows.length < s.rows.length && <div style={{ padding: 12, textAlign: 'center' }}>
        <button style={btn(T)} onClick={() => setShowAll(true)}>Show all {s.rows.length} payments</button>
      </div>}
    </div>
  </div>
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function ExternalLoansPage({ companies = [], properties = [], permissionsMap, devModeActive = false, showToast, openDetail }) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const confirmDialog = useConfirm()
  const canEditFor = useCallback(companyId => devModeActive
    || canDo(permissionsMap, companyId, 'edit_financial')
    || canDo(permissionsMap, companyId, 'edit_properties'), [permissionsMap, devModeActive])
  const editableCompanies = useMemo(() => companies.filter(c => canEditFor(c.id)), [companies, canEditFor])

  const parseHash = () => {
    const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
    if (parts[0] !== 'loans') return null
    if (parts[1] === 'new') return { mode: 'new' }
    if (parts[1]) return { mode: 'view', id: parts[1] }
    return { mode: 'list' }
  }
  const initial = parseHash() || { mode: 'list' }
  const [mode, setMode] = useState(initial.mode)
  const [selectedId, setSelectedId] = useState(initial.id || null)
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [coFilter, setCoFilter] = useState('all')
  const [showRepaid, setShowRepaid] = useState(false)

  useEffect(() => {
    let live = true
    api.fetchExternalLoans()
      .then(d => { if (live) setLoans(d) })
      .catch(e => { console.error(e); showToast?.('Could not load loans', 'error') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [showToast])

  useEffect(() => {
    const target = mode === 'new' ? '#/loans/new' : (mode === 'view' || mode === 'edit') && selectedId ? `#/loans/${selectedId}` : '#/loans'
    if (window.location.hash !== target) window.location.hash = target
  }, [mode, selectedId])
  useEffect(() => {
    const onHash = () => { const h = parseHash(); if (!h) return; setMode(h.mode); setSelectedId(h.id || null) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const coById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies])
  const propById = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties])
  const filtered = useMemo(() => coFilter === 'all' ? loans : loans.filter(l => l.company_id === coFilter), [loans, coFilter])
  const summary = useMemo(() => summariseLoans(filtered), [filtered])
  const upcoming = useMemo(() => upcomingPayments(filtered, { limit: 8 }), [filtered])
  const withStatus = useMemo(() => filtered.map(l => ({ loan: l, s: loanStatus(l) })), [filtered])
  const listed = useMemo(() => {
    const order = { overdue: 0, active: 1, repaid: 2 }
    return withStatus.filter(x => showRepaid || x.s.status !== 'repaid')
      .sort((a, b) => (order[a.s.status] - order[b.s.status]) || String(a.s.nextDue?.due_date || '9999').localeCompare(String(b.s.nextDue?.due_date || '9999')))
  }, [withStatus, showRepaid])
  const repaidCount = withStatus.filter(x => x.s.status === 'repaid').length
  const selected = selectedId ? loans.find(l => l.id === selectedId) : null

  const run = async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) showToast?.(okMsg); return r ?? true }
    catch (e) { console.error(e); showToast?.(e.message || 'Something went wrong', 'error'); return null }
  }
  const replaceLoan = next => setLoans(list => list.map(l => l.id === next.id ? next : l))
  const patchPayments = (loanId, fn) => setLoans(list => list.map(l => l.id === loanId ? { ...l, external_loan_payments: fn(l.external_loan_payments || []) } : l))

  async function handleCreate(fields) {
    const created = await run(() => api.createExternalLoan(fields), 'Loan added')
    if (created) { setLoans(list => [created, ...list]); setSelectedId(created.id); setMode('view') }
    return !!created
  }
  async function handleUpdate(fields) {
    const updated = await run(() => api.updateExternalLoan(selected.id, fields), 'Loan updated')
    if (updated) { replaceLoan(updated); setMode('view') }
    return !!updated
  }
  async function handleDelete() {
    const ticks = (selected.external_loan_payments || []).filter(p => !p.deleted_at).length
    if (!await confirmDialog({
      title: 'Delete this loan?',
      body: `${selected.lender_name}, ${fmt(selected.principal)}.${ticks ? ` Its ${ticks} ticked payment${ticks === 1 ? '' : 's'} go with it.` : ''} It moves out of the tracker; nothing in your bank or accounts changes.`,
      confirmLabel: 'Delete', destructive: true,
    })) return
    const ok = await run(() => api.deleteExternalLoan(selected.id), 'Loan deleted')
    if (ok) { setLoans(list => list.filter(l => l.id !== selected.id)); setSelectedId(null); setMode('list') }
  }
  const tickFor = loan => async row => {
    const today = todayISO()
    const created = await run(() => api.tickExternalLoanPayment(loan.id, {
      period: row.period, due_date: row.due_date, amount: row.payment,
      paid_date: row.due_date <= today ? row.due_date : today,
    }))
    if (created) patchPayments(loan.id, ps => [...ps, created])
    return !!created
  }
  const untickFor = loan => async row => {
    const ok = await run(() => api.untickExternalLoanPayment(row.paid.id))
    if (ok) patchPayments(loan.id, ps => ps.filter(p => p.id !== row.paid.id))
    return !!ok
  }
  const updateTickFor = loan => async (row, fields) => {
    const updated = await run(() => api.updateExternalLoanPayment(row.paid.id, fields), 'Payment updated')
    if (updated) patchPayments(loan.id, ps => ps.map(p => p.id === updated.id ? updated : p))
    return !!updated
  }

  const pageHead = <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
    <div>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>External Loans</h1>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
        {summary.active} running · {fmt(summary.outstanding)} capital outstanding · {fmt(summary.monthlyOutgoing)} a month
      </div>
    </div>
    {editableCompanies.length > 0 && mode === 'list' && <button onClick={() => setMode('new')} style={{ ...btn(T, 'gold'), padding: '8px 16px', fontSize: 12 }}>+ New loan</button>}
  </div>

  if (mode === 'new') return <div className="fade">{pageHead}
    <LoanForm companies={companies} properties={properties} editableCompanies={editableCompanies} onSave={handleCreate} onCancel={() => setMode('list')} T={T} isMobile={isMobile} />
  </div>

  if ((mode === 'view' || mode === 'edit') && selectedId && !selected) {
    return <div className="fade">{pageHead}<div style={{ ...card(T), textAlign: 'center', color: T.muted, fontFamily: mono, fontSize: 12 }}>
      {loading ? 'Loading…' : <>That loan was not found. <button style={btn(T)} onClick={() => { setSelectedId(null); setMode('list') }}>All loans</button></>}
    </div></div>
  }

  if (mode === 'edit' && selected) return <div className="fade">{pageHead}
    <LoanForm initial={selected} companies={companies} properties={properties} editableCompanies={companies.filter(c => c.id === selected.company_id)} onSave={handleUpdate} onCancel={() => setMode('view')} T={T} isMobile={isMobile} />
  </div>

  if (mode === 'view' && selected) return <div>{pageHead}
    <LoanDetail loan={selected} company={coById.get(selected.company_id)} property={propById.get(selected.property_id)} canEdit={canEditFor(selected.company_id)}
      onBack={() => { setSelectedId(null); setMode('list') }} onEdit={() => setMode('edit')} onDelete={handleDelete}
      onTick={tickFor(selected)} onUntick={untickFor(selected)} onUpdateTick={updateTickFor(selected)} openDetail={openDetail} T={T} isMobile={isMobile} />
  </div>

  const th = { padding: '8px 12px', fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, textAlign: 'left', fontWeight: 600 }
  const td = { padding: '10px 12px', borderTop: `1px solid ${T.border}`, fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums' }

  return <div className="fade">
    {pageHead}

    {companies.length > 1 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>Filter:</span>
      {[{ id: 'all', abbr: 'All', color: T.gold }, ...companies].map(c => (
        <button key={c.id} onClick={() => setCoFilter(c.id)}
          style={{ fontFamily: mono, fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${coFilter === c.id ? (c.color || T.gold) : T.border}`, background: coFilter === c.id ? (c.color || T.gold) + '22' : 'transparent', color: coFilter === c.id ? (c.color || T.gold) : T.muted }}>
          {c.abbr || c.name}
        </button>
      ))}
    </div>}

    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
      <Stat T={T} label="Loans running" value={summary.active} sub={`${fmt(summary.borrowed)} borrowed`} />
      <Stat T={T} label="Capital outstanding" value={fmt(summary.outstanding)} color={T.gold} />
      <Stat T={T} label="Monthly payments" value={fmt(summary.monthlyOutgoing)} />
      <Stat T={T} label="Due next 30 days" value={fmt(summary.dueNext30)} />
      <Stat T={T} label="Overdue" value={summary.overdueCount ? fmt(summary.overdueAmount) : 'None'} color={summary.overdueCount ? T.red : T.green}
        sub={summary.overdueCount ? `${summary.overdueCount} payment${summary.overdueCount === 1 ? '' : 's'} not ticked` : null} />
    </div>

    {loading ? <div style={{ ...card(T), textAlign: 'center', color: T.muted, fontFamily: mono, fontSize: 12 }}>Loading…</div>
    : loans.length === 0 ? <div style={{ ...card(T), textAlign: 'center', padding: 36 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No external loans yet</div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 14 }}>Add a loan from a private lender, director or family member. Properly works out the monthly payment and you tick each one off once it is paid.</div>
      {editableCompanies.length > 0 && <button onClick={() => setMode('new')} style={{ ...btn(T, 'gold'), padding: '8px 16px', fontSize: 12 }}>+ Add your first loan</button>}
    </div>
    : <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,2fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <div style={{ ...card(T), padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Lender</th>
            {!isMobile && <th style={{ ...th, textAlign: 'right' }}>Borrowed</th>}
            {!isMobile && <th style={th}>Terms</th>}
            <th style={{ ...th, textAlign: 'right' }}>Monthly</th>
            <th style={th}>Progress</th>
          </tr></thead>
          <tbody>{listed.map(({ loan, s }) => (
            <tr key={loan.id} onClick={() => { setSelectedId(loan.id); setMode('view') }} style={{ cursor: 'pointer' }}>
              <td style={td}>
                <div style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: T.text }}>{loan.lender_name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                  <CoChip company={coById.get(loan.company_id)} T={T} /><StatusChip status={s.status} T={T} />
                </div>
              </td>
              {!isMobile && <td style={{ ...td, textAlign: 'right' }}>{fmt(loan.principal)}<div style={{ fontSize: 10, color: T.muted }}>{fmtDate(loan.received_date)}</div></td>}
              {!isMobile && <td style={{ ...td, color: T.muted }}>{Number(loan.annual_rate) || 0}% · {termLabel(loan.term_months)}<div style={{ fontSize: 10 }}>{typeLabel(loan.repayment_type)}</div></td>}
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{loan.repayment_type === 'rolled_up' ? <span style={{ color: T.muted, fontWeight: 400 }}>at end</span> : fmtP(s.regularPayment)}</td>
              <td style={{ ...td, minWidth: 120 }}>
                <div style={{ fontSize: 11 }}>{s.paidCount}/{s.periods} paid</div>
                <div style={{ height: 5, background: T.bg, borderRadius: 3, overflow: 'hidden', marginTop: 4, border: `1px solid ${T.border}` }}>
                  <div style={{ width: `${s.periods ? s.paidCount / s.periods * 100 : 0}%`, height: '100%', background: s.status === 'overdue' ? T.red : T.green }} />
                </div>
                {s.nextDue && <div style={{ fontSize: 10, color: s.nextDue.overdue ? T.red : T.muted, marginTop: 3 }}>{s.nextDue.overdue ? 'Overdue' : 'Next'} {fmtDate(s.nextDue.due_date)}</div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        {repaidCount > 0 && <div style={{ padding: 10, textAlign: 'center' }}>
          <button style={btn(T)} onClick={() => setShowRepaid(v => !v)}>{showRepaid ? 'Hide' : 'Show'} {repaidCount} repaid loan{repaidCount === 1 ? '' : 's'}</button>
        </div>}
      </div>

      <div style={card(T)}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Coming up</div>
        {upcoming.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Nothing left to pay.</div>}
        {upcoming.map(({ loan, row }) => {
          const canEdit = canEditFor(loan.company_id)
          return <div key={loan.id + ':' + row.period} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${T.border}` }}>
            {canEdit && <input type="checkbox" checked={false} onChange={() => tickFor(loan)(row)} aria-label={`Tick off ${loan.lender_name} payment due ${row.due_date}`}
              style={{ width: 18, height: 18, cursor: 'pointer', accentColor: T.green, flexShrink: 0 }} />}
            <button onClick={() => { setSelectedId(loan.id); setMode('view') }} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.text }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loan.lender_name}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: row.overdue ? T.red : T.muted }}>{row.overdue ? 'Overdue · ' : ''}{fmtDate(row.due_date)}</div>
            </button>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtP(row.payment)}</div>
          </div>
        })}
      </div>
    </div>}
  </div>
}
