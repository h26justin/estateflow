// Tenancies for one property: the record the Rent Tracker rebuild hangs
// everything on (dates, rent terms, due day, payment window, payment source,
// benefit schedule, opening arrears). Plus approved non-chargeable periods.
//
// Drafts seeded from the free-text property fields carry needs_confirmation
// and a note explaining each assumption; a human confirms or corrects them.
import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import MoneyInput from '../lib/MoneyInput'
import { useConfirm } from '../lib/ConfirmContext'
import {
  TENANCY_STATUSES, PAYMENT_SOURCES, RENT_FREQUENCIES, BENEFIT_FREQUENCIES, DEFAULT_PAYMENT_WINDOW_DAYS,
  usesBenefit, benefitSplitCheck, tenancyDraftFromProperty, currentTenancy,
} from '../lib/tenancyUtils'

const label = (list, v) => list.find(x => x.v === v)?.l || v || '—'
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fmtMoney = n => n == null ? '—' : `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ordinal = n => n == null ? '—' : `${n}${['th','st','nd','rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]}`

const EMPTY = {
  tenant_name: '', tenant_ref: '', tenancy_start: '', tenancy_end: '', notice_received_date: '', expected_move_out: '',
  rent_amount: '', rent_frequency: 'monthly', rent_due_day: '', payment_window_days: DEFAULT_PAYMENT_WINDOW_DAYS,
  status: 'rented', payment_source: 'tenant', benefit_type: '', benefit_contribution: '', tenant_contribution: '',
  benefit_frequency: '', benefit_next_payment_date: '', benefit_paid_to: '', benefit_reference: '',
  opening_arrears: '', opening_arrears_date: '', notes: '',
}

export default function TenancyPanel({ property, showToast, canEdit = true, canViewPersonal = true, onChanged }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [tenancies, setTenancies] = useState(null)
  const [periods, setPeriods] = useState([])
  const [editing, setEditing] = useState(null)   // null | 'new' | tenancy id
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [periodForm, setPeriodForm] = useState(null)

  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function load() {
    try {
      const [t, p] = await Promise.all([api.fetchTenancies(property.id), api.fetchNonChargeablePeriods(property.id)])
      setTenancies(t); setPeriods(p)
      onChanged?.(t)
    } catch (e) { showToast?.(e.message || 'Could not load tenancies', 'error'); setTenancies([]) }
  }
  useEffect(() => { setTenancies(null); setEditing(null); load() }, [property.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function startNew(prefill) {
    setForm({ ...EMPTY, ...(prefill || {}), needs_confirmation: false })
    setEditing('new')
  }
  function startEdit(t) {
    const f = { ...EMPTY }
    for (const k of Object.keys(EMPTY)) f[k] = t[k] ?? ''
    setForm(f); setEditing(t.id)
  }
  function prefillFromProperty() {
    const d = tenancyDraftFromProperty(property)
    startNew({ ...d, needs_confirmation: false })
    if (d.notes) showToast?.(d.notes)
  }

  async function save() {
    if (saving) return
    if (!form.tenancy_start) { showToast?.('Tenancy start date is required', 'error'); return }
    if (form.tenancy_end && form.tenancy_end < form.tenancy_start) { showToast?.('Tenancy end must be on or after the start', 'error'); return }
    const split = benefitSplitCheck(form)
    if (!split.ok) {
      const go = await confirmDialog({ title: 'Contributions do not tie to the rent', body: `${split.message} Save anyway?`, confirmLabel: 'Save anyway' })
      if (!go) return
    }
    setSaving(true)
    try {
      const payload = { ...form, property_id: property.id, company_id: property.company_id }
      if (editing === 'new') await api.createTenancy(payload)
      else await api.updateTenancy(editing, { ...payload, needs_confirmation: false })
      showToast?.('Tenancy saved')
      setEditing(null)
      await load()
    } catch (e) { showToast?.(e.message || 'Save failed', 'error') }
    setSaving(false)
  }

  async function confirmDraft(t) {
    try { await api.confirmTenancy(t.id); showToast?.('Tenancy confirmed'); await load() }
    catch (e) { showToast?.(e.message, 'error') }
  }
  async function endNow(t) {
    const today = new Date().toISOString().slice(0, 10)
    const go = await confirmDialog({ title: 'End this tenancy?', body: `Sets the tenancy end to today (${fmtDate(today)}) and its status to Ended. Rent stops being expected after today.`, confirmLabel: 'End tenancy' })
    if (!go) return
    try { await api.updateTenancy(t.id, { tenancy_end: t.tenancy_end && t.tenancy_end < today ? t.tenancy_end : today, status: 'ended' }); await load() }
    catch (e) { showToast?.(e.message, 'error') }
  }
  async function remove(t) {
    const go = await confirmDialog({ title: 'Delete this tenancy record?', body: 'Receipts and periods linked to it stay, but lose their tenancy link. Prefer "End tenancy" for a tenant who has left.', confirmLabel: 'Delete', danger: true })
    if (!go) return
    try { await api.deleteTenancy(t.id); await load() } catch (e) { showToast?.(e.message, 'error') }
  }

  async function savePeriod() {
    if (!periodForm?.start_date) { showToast?.('Start date is required', 'error'); return }
    try {
      if (periodForm.id) await api.updateNonChargeablePeriod(periodForm.id, { start_date: periodForm.start_date, end_date: periodForm.end_date || null, reason: periodForm.reason, notes: periodForm.notes || null })
      else await api.createNonChargeablePeriod({ property_id: property.id, start_date: periodForm.start_date, end_date: periodForm.end_date || null, reason: periodForm.reason || 'vacant', notes: periodForm.notes || null })
      setPeriodForm(null); await load()
    } catch (e) { showToast?.(e.message, 'error') }
  }
  async function removePeriod(p) {
    const go = await confirmDialog({ title: 'Remove this non-chargeable period?', body: 'The months it covered will count as collectible again.', confirmLabel: 'Remove', danger: true })
    if (!go) return
    try { await api.deleteNonChargeablePeriod(p.id); await load() } catch (e) { showToast?.(e.message, 'error') }
  }

  const cur = tenancies ? currentTenancy(tenancies) : null
  const history = (tenancies || []).filter(t => t !== cur)
  const split = benefitSplitCheck(form)
  const sectionHead = (text, right) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{text}</div>
      <div style={{ display: 'flex', gap: 6 }}>{right}</div>
    </div>
  )
  const pill = (text, c) => <span style={{ fontFamily: MONO, fontSize: 10, padding: '2px 8px', borderRadius: 20, background: c + '22', color: c, border: `1px solid ${c}44`, whiteSpace: 'nowrap' }}>{text}</span>
  const statusColor = { rented: T.green, notice_given: T.amber, vacant: T.red, refurbishment: T.blue, ended: T.muted }

  function TenancyCard({ t, isCurrent }) {
    const benefit = usesBenefit(t.payment_source)
    const rows = [
      ['Tenant', canViewPersonal ? (t.tenant_name || '—') : 'Hidden', t.tenant_ref ? `Ref ${t.tenant_ref}` : null],
      ['Dates', `${fmtDate(t.tenancy_start)} → ${t.tenancy_end ? fmtDate(t.tenancy_end) : 'periodic'}`, t.notice_received_date ? `Notice received ${fmtDate(t.notice_received_date)}${t.expected_move_out ? `, expected out ${fmtDate(t.expected_move_out)}` : ''}` : null],
      ['Rent', `${fmtMoney(t.rent_amount)} ${label(RENT_FREQUENCIES, t.rent_frequency).toLowerCase()}`, `Due ${ordinal(t.rent_due_day)} · ${t.payment_window_days} day window`],
      ['Paid by', label(PAYMENT_SOURCES, t.payment_source), benefit ? `${t.benefit_type || 'Benefit'} ${fmtMoney(t.benefit_contribution)} + tenant ${fmtMoney(t.tenant_contribution)}${t.benefit_frequency ? ` · ${label(BENEFIT_FREQUENCIES, t.benefit_frequency).toLowerCase()}` : ''}${t.benefit_next_payment_date ? ` · next ${fmtDate(t.benefit_next_payment_date)}` : ''}${t.benefit_paid_to ? ` · to ${t.benefit_paid_to}` : ''}` : null],
      ['Opening arrears', Number(t.opening_arrears) ? fmtMoney(t.opening_arrears) : 'None', t.opening_arrears_date ? `as at ${fmtDate(t.opening_arrears_date)}` : null],
    ]
    return (
      <div className="card" style={{ padding: '14px 16px', marginBottom: 10, borderLeft: `3px solid ${statusColor[t.status] || T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {pill(label(TENANCY_STATUSES, t.status), statusColor[t.status] || T.muted)}
          {isCurrent && pill('Current', T.gold)}
          {t.needs_confirmation && pill('Needs confirmation', T.amber)}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {canEdit && t.needs_confirmation && <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => confirmDraft(t)}>Confirm</button>}
            {canEdit && <button className="btn" style={{ fontSize: 11 }} onClick={() => startEdit(t)}>Edit</button>}
            {canEdit && t.status !== 'ended' && <button className="btn" style={{ fontSize: 11 }} onClick={() => endNow(t)}>End tenancy</button>}
            {canEdit && <button className="btn" style={{ fontSize: 11, color: T.red }} onClick={() => remove(t)} aria-label="Delete tenancy">✕</button>}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map(([l, v, sub]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', background: T.bg, borderRadius: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted, flexShrink: 0 }}>{l}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{v}</div>
                {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>{sub}</div>}
              </div>
            </div>
          ))}
          {t.notes && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '6px 12px' }}>{t.notes}</div>}
        </div>
      </div>
    )
  }

  const inputStyle = { width: '100%' }
  const Field = ({ l, children, hint }) => (
    <div>
      <label>{l}{hint && <span style={{ color: T.muted, fontWeight: 400, fontSize: 10 }}> {hint}</span>}</label>
      {children}
    </div>
  )

  return (
    <div style={{ marginBottom: 18 }}>
      {sectionHead('Tenancies', canEdit && editing === null && (
        <>
          {(tenancies?.length === 0) && <button className="btn" style={{ fontSize: 11 }} onClick={prefillFromProperty}>Prefill from property</button>}
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => startNew()}>+ New tenancy</button>
        </>
      ))}

      {tenancies === null && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>Loading…</div>}

      {tenancies && tenancies.length === 0 && editing === null && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 10, fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
          No tenancy recorded. The Rent Tracker needs one to know when rent is due and who pays it.
          {canEdit && ' Use "Prefill from property" to start from the rent, due day and end date already on the property, then check each field.'}
        </div>
      )}

      {editing !== null && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{editing === 'new' ? 'New tenancy' : 'Edit tenancy'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field l="Tenant name"><input style={inputStyle} value={form.tenant_name} onChange={e => s('tenant_name', e.target.value)} placeholder="e.g. J Smith" /></Field>
            <Field l="Tenant reference" hint="(stable ID)"><input style={inputStyle} value={form.tenant_ref} onChange={e => s('tenant_ref', e.target.value)} placeholder="e.g. WMH-12-2026" /></Field>
            <Field l="Tenancy start"><input type="date" value={form.tenancy_start} onChange={e => s('tenancy_start', e.target.value)} /></Field>
            <Field l="Tenancy end" hint="(leave blank for periodic)"><input type="date" value={form.tenancy_end} onChange={e => s('tenancy_end', e.target.value)} /></Field>
            <Field l="Status">
              <select value={form.status} onChange={e => s('status', e.target.value)}>{TENANCY_STATUSES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
            </Field>
            <Field l="Notice received" hint="(if given)"><input type="date" value={form.notice_received_date} onChange={e => s('notice_received_date', e.target.value)} /></Field>
            {(form.status === 'notice_given' || form.notice_received_date) && (
              <Field l="Expected move-out"><input type="date" value={form.expected_move_out} onChange={e => s('expected_move_out', e.target.value)} /></Field>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field l="Rent amount"><MoneyInput prefix="£" value={form.rent_amount} onChange={v => s('rent_amount', v)} /></Field>
            <Field l="Frequency"><select value={form.rent_frequency} onChange={e => s('rent_frequency', e.target.value)}>{RENT_FREQUENCIES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Field>
            <Field l="Due day" hint="(1–31)"><input type="number" min={1} max={31} value={form.rent_due_day} onChange={e => s('rent_due_day', e.target.value)} placeholder="e.g. 1" /></Field>
            <Field l="Payment window" hint="(days)"><input type="number" min={0} max={60} value={form.payment_window_days} onChange={e => s('payment_window_days', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field l="Paid by"><select value={form.payment_source} onChange={e => s('payment_source', e.target.value)}>{PAYMENT_SOURCES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Field>
            <Field l="Opening historic arrears" hint="(before go-live)"><MoneyInput prefix="£" value={form.opening_arrears} onChange={v => s('opening_arrears', v)} /></Field>
            {Number(form.opening_arrears) > 0 && <Field l="Arrears as at"><input type="date" value={form.opening_arrears_date} onChange={e => s('opening_arrears_date', e.target.value)} /></Field>}
          </div>
          {usesBenefit(form.payment_source) && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Government assistance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Field l="Benefit type"><input value={form.benefit_type} onChange={e => s('benefit_type', e.target.value)} placeholder="e.g. UC housing element" /></Field>
                <Field l="Benefit contribution"><MoneyInput prefix="£" value={form.benefit_contribution} onChange={v => s('benefit_contribution', v)} /></Field>
                <Field l="Tenant contribution"><MoneyInput prefix="£" value={form.tenant_contribution} onChange={v => s('tenant_contribution', v)} /></Field>
                <Field l="Payment frequency"><select value={form.benefit_frequency} onChange={e => s('benefit_frequency', e.target.value)}><option value="">Select…</option>{BENEFIT_FREQUENCIES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Field>
                <Field l="Next expected payment"><input type="date" value={form.benefit_next_payment_date} onChange={e => s('benefit_next_payment_date', e.target.value)} /></Field>
                <Field l="Paid to"><select value={form.benefit_paid_to} onChange={e => s('benefit_paid_to', e.target.value)}><option value="">Select…</option><option value="landlord">Landlord directly</option><option value="tenant">Tenant</option></select></Field>
              </div>
              <Field l="Reference / notes"><input value={form.benefit_reference} onChange={e => s('benefit_reference', e.target.value)} /></Field>
              {!split.ok && <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: T.amber }}>{split.message}</div>}
              {split.ok && (Number(form.benefit_contribution) || Number(form.tenant_contribution)) ? <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: T.green }}>Contributions tie to the rent.</div> : null}
            </div>
          )}
          <div style={{ marginBottom: 14 }}><label>Notes</label><textarea value={form.notes} onChange={e => s('notes', e.target.value)} rows={2} style={{ resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save tenancy'}</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {cur && <TenancyCard t={cur} isCurrent />}
      {history.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setShowHistory(v => !v)}>{showHistory ? 'Hide' : 'Show'} {history.length} previous {history.length === 1 ? 'tenancy' : 'tenancies'}</button>
          {showHistory && <div style={{ marginTop: 10 }}>{history.map(t => <TenancyCard key={t.id} t={t} isCurrent={false} />)}</div>}
        </div>
      )}

      {/* Non-chargeable periods */}
      <div style={{ marginTop: 18 }}>
        {sectionHead('Non-chargeable periods', canEdit && !periodForm && (
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setPeriodForm({ start_date: '', end_date: '', reason: 'vacant', notes: '' })}>+ Add period</button>
        ))}
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginBottom: 8 }}>Vacant, refurbishment or agreed rent-free periods. These months are excluded from the collection rate.</div>
        {periodForm && (
          <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
              <Field l="From"><input type="date" value={periodForm.start_date} onChange={e => setPeriodForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
              <Field l="To" hint="(blank = ongoing)"><input type="date" value={periodForm.end_date || ''} onChange={e => setPeriodForm(f => ({ ...f, end_date: e.target.value }))} /></Field>
              <Field l="Reason"><select value={periodForm.reason} onChange={e => setPeriodForm(f => ({ ...f, reason: e.target.value }))}>
                <option value="vacant">Vacant</option><option value="refurbishment">Refurbishment</option><option value="rent_free">Agreed rent-free</option><option value="other">Other</option>
              </select></Field>
            </div>
            <div style={{ marginBottom: 10 }}><label>Notes</label><input value={periodForm.notes || ''} onChange={e => setPeriodForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={savePeriod}>Save period</button>
              <button className="btn" style={{ fontSize: 11 }} onClick={() => setPeriodForm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {periods.length === 0 && !periodForm && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>None recorded.</div>}
        {periods.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.bg, borderRadius: 8, marginBottom: 6 }}>
            <Icon name="calendar" size={14} color={T.muted} />
            <div style={{ flex: 1, fontSize: 13, color: T.text }}>
              {fmtDate(p.start_date)} → {p.end_date ? fmtDate(p.end_date) : 'ongoing'}
              <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginLeft: 8 }}>{{ vacant: 'Vacant', refurbishment: 'Refurbishment', rent_free: 'Rent-free', other: 'Other' }[p.reason] || p.reason}{p.notes ? ` · ${p.notes}` : ''}</span>
            </div>
            {canEdit && <button className="btn" style={{ fontSize: 11 }} onClick={() => setPeriodForm({ id: p.id, start_date: p.start_date, end_date: p.end_date || '', reason: p.reason, notes: p.notes || '' })}>Edit</button>}
            {canEdit && <button className="btn" style={{ fontSize: 11, color: T.red }} onClick={() => removePeriod(p)} aria-label="Remove period">✕</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
