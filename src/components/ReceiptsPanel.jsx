// Rent receipts for one property. A receipt is a dated cash event with an
// allocation: current rent (a period), historic arrears, deposit or other.
// Nothing is guessed: an amount that is not fully allocated is recorded as
// unallocated and flagged for review. Reversals (bounce, refund) are negative
// receipts that point at the original, so the trail is never deleted.
import { useState, useEffect, useMemo } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import MoneyInput from '../lib/MoneyInput'
import { useConfirm } from '../lib/ConfirmContext'
import { currentTenancy, usesBenefit } from '../lib/tenancyUtils'
import { activePlan } from '../lib/paymentPlans'

const PAYERS = [
  { v: 'tenant', l: 'Tenant' }, { v: 'housing_benefit', l: 'Housing Benefit' },
  { v: 'universal_credit', l: 'Universal Credit' }, { v: 'other', l: 'Other' },
]
const TARGETS = [
  { v: 'current_rent', l: 'Current rent (a period)' }, { v: 'historic_arrears', l: 'Historic arrears' },
  { v: 'deposit', l: 'Deposit' }, { v: 'other', l: 'Other' },
]
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const money = n => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ReceiptsPanel({ property, tenancies, showToast, canEdit = true, onChanged }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [receipts, setReceipts] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(null)

  const cur = useMemo(() => currentTenancy(tenancies || property.tenancies || []), [tenancies, property.tenancies])

  // Periods this property has, newest first, for the allocation picker.
  const periods = useMemo(() => (property.rent_payments || [])
    .filter(p => p.period_start)
    .slice()
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))
    .map(p => ({ id: p.id, label: `${p.month_label || ''} · ${fmtDate(p.period_start)} → ${fmtDate(p.period_end)} · ${p.status}${p.amount != null ? ` · ${money(p.amount)}` : ''}` })),
    [property.rent_payments])

  async function load() {
    try { const r = await api.fetchReceipts(property.id); setReceipts(r); onChanged?.(r) }
    catch (e) { showToast?.(e.message || 'Could not load receipts', 'error'); setReceipts([]) }
  }
  useEffect(() => { setReceipts(null); setAdding(false); load() }, [property.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function startAdd() {
    const today = new Date().toISOString().slice(0, 10)
    const defaultPayer = cur && usesBenefit(cur.payment_source) && cur.payment_source !== 'mixed'
      ? cur.payment_source : 'tenant'
    setForm({
      received_date: today, amount: cur?.rent_amount || property.rent_pcm || '', payer: defaultPayer, reference: '', notes: '',
      allocations: [{ target: 'current_rent', rent_payment_id: periods[0]?.id || '', amount: cur?.rent_amount || property.rent_pcm || '' }],
      allowUnallocated: false,
    })
    setAdding(true)
  }
  const setAlloc = (i, k, v) => setForm(f => ({ ...f, allocations: f.allocations.map((a, j) => j === i ? { ...a, [k]: v } : a) }))
  const addAlloc = () => setForm(f => ({ ...f, allocations: [...f.allocations, { target: 'historic_arrears', rent_payment_id: '', amount: '' }] }))
  const removeAlloc = i => setForm(f => ({ ...f, allocations: f.allocations.filter((_, j) => j !== i) }))

  const allocated = (form?.allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const remainder = Math.round(((Number(form?.amount) || 0) - allocated) * 100) / 100

  async function save() {
    if (saving || !form) return
    if (!form.received_date) { showToast?.('Date received is required', 'error'); return }
    if (!Number(form.amount)) { showToast?.('Enter the amount received', 'error'); return }
    for (const a of form.allocations) {
      if (a.target === 'current_rent' && Number(a.amount) && !a.rent_payment_id) { showToast?.('Choose the rent period for each current-rent allocation', 'error'); return }
    }
    if (Math.abs(remainder) >= 0.005 && !form.allowUnallocated) {
      showToast?.(`${money(Math.abs(remainder))} is ${remainder > 0 ? 'not yet allocated' : 'over-allocated'}. Adjust the split, or tick "leave the remainder for review".`, 'error'); return
    }
    setSaving(true)
    try {
      const plan = activePlan(property.payment_plans || [])
      const allocations = form.allocations.map(a => a.target === 'historic_arrears' && plan ? { ...a, payment_plan_id: plan.id } : a)
      await api.createReceipt({
        property_id: property.id, company_id: property.company_id, tenancy_id: cur?.id || null,
        received_date: form.received_date, amount: Number(form.amount), payer: form.payer, source: 'manual',
        reference: form.reference || null, notes: form.notes || null,
      }, allocations, { allowUnallocated: form.allowUnallocated })
      showToast?.('Receipt recorded')
      setAdding(false); setForm(null)
      await load()
    } catch (e) { showToast?.(e.message || 'Could not save receipt', 'error') }
    setSaving(false)
  }

  async function reverse(r, kind) {
    const go = await confirmDialog({
      title: kind === 'bounce' ? 'Record this payment as bounced?' : 'Record a refund of this payment?',
      body: `A ${kind} of ${money(-r.amount)} dated today will be recorded against the same allocations. The original receipt stays for the audit trail.`,
      confirmLabel: kind === 'bounce' ? 'Record bounce' : 'Record refund',
    })
    if (!go) return
    try { await api.reverseReceipt(r, { kind }); showToast?.(`${kind === 'bounce' ? 'Bounce' : 'Refund'} recorded`); await load() }
    catch (e) { showToast?.(e.message, 'error') }
  }
  async function remove(r) {
    const go = await confirmDialog({ title: 'Delete this receipt?', body: 'Only for a receipt entered in error. For money that bounced or was refunded, record a bounce or refund instead so the history is kept.', confirmLabel: 'Delete', danger: true })
    if (!go) return
    try { await api.deleteReceipt(r.id); await load() } catch (e) { showToast?.(e.message, 'error') }
  }

  const periodLabel = id => periods.find(p => p.id === id)?.label?.split(' · ')[0] || 'period'
  const allocSummary = r => (r.rent_allocations || []).map(a => {
    const t = { current_rent: periodLabel(a.rent_payment_id), historic_arrears: 'arrears', deposit: 'deposit', other: 'other', unallocated: 'unallocated' }[a.target] || a.target
    return `${money(a.amount)} → ${t}`
  }).join(' · ')
  const kindColor = { receipt: T.green, adjustment: T.blue, refund: T.amber, bounce: T.red }

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Receipts</div>
        {canEdit && !adding && <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={startAdd}>+ Record receipt</button>}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginBottom: 10 }}>Money actually received, with what it paid for. Bounces and refunds are recorded against the original, never deleted.</div>

      {adding && form && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label>Date received</label><input type="date" value={form.received_date} onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))} /></div>
            <div><label>Amount</label><MoneyInput prefix="£" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} /></div>
            <div><label>Paid by</label><select value={form.payer} onChange={e => setForm(f => ({ ...f, payer: e.target.value }))}>{PAYERS.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label>Reference <span style={{ color: T.muted, fontWeight: 400, fontSize: 10 }}>(bank or statement ref)</span></label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
            <div><label>Notes</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Allocation</div>
          {form.allocations.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 130px 32px', gap: 8, alignItems: 'end', marginBottom: 8 }}>
              <div><label>Applies to</label><select value={a.target} onChange={e => setAlloc(i, 'target', e.target.value)}>{TARGETS.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></div>
              <div>
                <label>{a.target === 'current_rent' ? 'Rent period' : 'Detail'}</label>
                {a.target === 'current_rent'
                  ? <select value={a.rent_payment_id || ''} onChange={e => setAlloc(i, 'rent_payment_id', e.target.value)}>
                      <option value="">Choose a period…</option>
                      {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  : <input value={a.notes || ''} onChange={e => setAlloc(i, 'notes', e.target.value)} placeholder="optional note" />}
              </div>
              <div><label>Amount</label><MoneyInput prefix="£" value={a.amount} onChange={v => setAlloc(i, 'amount', v)} /></div>
              <button className="btn" style={{ fontSize: 11, color: T.red, height: 34 }} onClick={() => removeAlloc(i)} aria-label="Remove allocation" disabled={form.allocations.length === 1}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4, marginBottom: 12 }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={addAlloc}>+ Split</button>
            <span style={{ fontFamily: MONO, fontSize: 11, color: Math.abs(remainder) < 0.005 ? T.green : T.amber }}>
              {Math.abs(remainder) < 0.005 ? 'Fully allocated' : remainder > 0 ? `${money(remainder)} unallocated` : `${money(-remainder)} over-allocated`}
            </span>
            {remainder > 0.004 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11, color: T.muted, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.allowUnallocated} onChange={e => setForm(f => ({ ...f, allowUnallocated: e.target.checked }))} /> leave the remainder for review
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save receipt'}</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => { setAdding(false); setForm(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {receipts === null && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>Loading…</div>}
      {receipts && receipts.length === 0 && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>No receipts recorded yet. Month tiles still show the legacy paid amounts until receipts exist.</div>}
      {receipts && receipts.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {receipts.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.bg, borderRadius: 8, borderLeft: `3px solid ${kindColor[r.kind] || T.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, width: 84, flexShrink: 0 }}>{fmtDate(r.received_date)}</div>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: r.amount < 0 ? T.red : T.text, width: 90, flexShrink: 0 }}>{money(r.amount)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {PAYERS.find(p => p.v === r.payer)?.l || r.payer} · {r.source}{r.kind !== 'receipt' ? ` · ${r.kind}` : ''}{r.reference ? ` · ${r.reference}` : ''}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{allocSummary(r) || 'no allocation'}</div>
              </div>
              {r.review_status === 'needs_review' && <span style={{ fontFamily: MONO, fontSize: 10, padding: '2px 8px', borderRadius: 20, background: T.amber + '22', color: T.amber, border: `1px solid ${T.amber}44` }}>Review</span>}
              {canEdit && r.kind === 'receipt' && r.amount > 0 && (
                <>
                  <button className="btn" style={{ fontSize: 10 }} onClick={() => reverse(r, 'bounce')}>Bounced</button>
                  <button className="btn" style={{ fontSize: 10 }} onClick={() => reverse(r, 'refund')}>Refund</button>
                </>
              )}
              {canEdit && <button className="btn" style={{ fontSize: 11, color: T.red }} onClick={() => remove(r)} aria-label="Delete receipt">✕</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
