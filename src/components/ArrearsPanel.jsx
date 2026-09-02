// Arrears for one property, kept in three separate figures so a payment plan
// can never disguise missed current rent:
//   1. current-period rent outstanding (from the rent engine)
//   2. historic / legacy arrears (opening balances less receipts allocated to arrears)
//   3. payment-plan progress
import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import MoneyInput from '../lib/MoneyInput'
import { useConfirm } from '../lib/ConfirmContext'
import { evaluateProperty, collectionStats, arrearsSummary } from '../lib/rentEngine'
import { planProgress, activePlan, PLAN_STATUS_LABEL, PLAN_FREQUENCIES } from '../lib/paymentPlans'
import { currentTenancy } from '../lib/tenancyUtils'

const money = n => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function ArrearsPanel({ property, showToast, canEdit = true, onChanged }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [plans, setPlans] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    try { const p = await api.fetchPaymentPlans(property.id); setPlans(p); onChanged?.(p) }
    catch (e) { showToast?.(e.message || 'Could not load payment plans', 'error'); setPlans([]) }
  }
  useEffect(() => { setPlans(null); setForm(null); load() }, [property.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const evals = evaluateProperty(property)
  const year = new Date().getFullYear()
  const cs = collectionStats(evals.filter(e => e.year === year))
  const ar = arrearsSummary(property)
  const receipts = property.rent_receipts || []
  const plan = plans ? activePlan(plans) : null
  const prog = plan ? planProgress(plan, receipts) : null
  const tenancy = currentTenancy(property.tenancies || [])
  const statusColor = { on_track: T.green, due_soon: T.amber, broken: T.red, completed: T.muted, paused: T.blue }

  function startPlan(existing) {
    setForm(existing ? { ...existing } : {
      opening_balance: ar.balance > 0 ? ar.balance : '', start_date: new Date().toISOString().slice(0, 10),
      instalment_amount: '', frequency: 'monthly', due_day: tenancy?.rent_due_day || '', notes: '', document_url: '',
    })
  }
  async function savePlan() {
    if (saving || !form) return
    if (!Number(form.opening_balance) || !Number(form.instalment_amount) || !form.start_date) { showToast?.('Opening balance, instalment and start date are required', 'error'); return }
    setSaving(true)
    try {
      const payload = { property_id: property.id, tenancy_id: tenancy?.id || null, company_id: property.company_id,
        opening_balance: Number(form.opening_balance), start_date: form.start_date, instalment_amount: Number(form.instalment_amount),
        frequency: form.frequency, due_day: form.frequency === 'monthly' && form.due_day ? Number(form.due_day) : null,
        notes: form.notes || null, document_url: form.document_url || null }
      if (form.id) await api.updatePaymentPlan(form.id, payload)
      else await api.createPaymentPlan(payload)
      showToast?.('Payment plan saved'); setForm(null); await load()
    } catch (e) { showToast?.(e.message || 'Could not save plan', 'error') }
    setSaving(false)
  }
  async function setOverride(p, status_override) {
    try { await api.updatePaymentPlan(p.id, { status_override }); await load() } catch (e) { showToast?.(e.message, 'error') }
  }
  async function removePlan(p) {
    const go = await confirmDialog({ title: 'Delete this payment plan?', body: 'Receipts allocated to arrears are kept. Prefer marking the plan Completed or Paused.', confirmLabel: 'Delete', danger: true })
    if (!go) return
    try { await api.deletePaymentPlan(p.id); await load() } catch (e) { showToast?.(e.message, 'error') }
  }

  const tile = (l, v, c, sub) => (
    <div style={{ background: T.bg, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{l}</div>
      <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: c }}>{v}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Arrears and payment plan</div>
        {canEdit && !form && !plan && <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => startPlan()}>+ Payment plan</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        {tile(`Current rent outstanding · ${year}`, money(cs.outstanding), cs.outstanding > 0 ? T.red : T.green, `${cs.counts.missed} missed · ${cs.counts.due + cs.counts.part_paid} due or part paid`)}
        {tile('Historic arrears', money(ar.balance), ar.balance > 0 ? T.amber : T.muted, ar.opening ? `${money(ar.opening)} opening, ${money(ar.paid)} paid off` : 'no opening balance recorded')}
        {prog ? tile('Payment plan', PLAN_STATUS_LABEL[prog.status], statusColor[prog.status], `${prog.instalmentsPaid} of ${prog.instalmentsTotal} instalments · ${money(prog.balance)} left`) : tile('Payment plan', 'None', T.muted, ar.balance > 0 ? 'arrears not on a plan' : '')}
      </div>
      {Number(property.arrears) > 0 && !ar.opening && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.amber, marginBottom: 10 }}>
          The property card carries {money(property.arrears)} of arrears typed by hand. Record it as the opening arrears on the tenancy so it is tracked here.
        </div>
      )}

      {prog && plan && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, padding: '2px 8px', borderRadius: 20, background: statusColor[prog.status] + '22', color: statusColor[prog.status], border: `1px solid ${statusColor[prog.status]}44` }}>{PLAN_STATUS_LABEL[prog.status]}</span>
            <span style={{ fontSize: 12, color: T.text }}>{money(plan.instalment_amount)} {PLAN_FREQUENCIES.find(f => f.v === plan.frequency)?.l.toLowerCase()} from {fmtDate(plan.start_date)}{plan.due_day ? `, due on the ${plan.due_day}` : ''}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {canEdit && <button className="btn" style={{ fontSize: 10 }} onClick={() => startPlan(plan)}>Edit</button>}
              {canEdit && prog.status !== 'paused' && prog.status !== 'completed' && <button className="btn" style={{ fontSize: 10 }} onClick={() => setOverride(plan, 'paused')}>Pause</button>}
              {canEdit && prog.status === 'paused' && <button className="btn" style={{ fontSize: 10 }} onClick={() => setOverride(plan, null)}>Resume</button>}
              {canEdit && prog.status !== 'completed' && <button className="btn" style={{ fontSize: 10 }} onClick={() => setOverride(plan, 'completed')}>Mark completed</button>}
              {canEdit && <button className="btn" style={{ fontSize: 10, color: T.red }} onClick={() => removePlan(plan)} aria-label="Delete plan">✕</button>}
            </div>
          </div>
          <div style={{ height: 8, background: T.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${prog.percent}%`, height: '100%', background: statusColor[prog.status] }} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: MONO, fontSize: 10, color: T.muted }}>
            <span>Opening {money(prog.opening)}</span><span>Paid to plan {money(prog.paid)}</span><span>Balance {money(prog.balance)}</span>
            <span>Expected by now {money(prog.expectedToDate)}</span>{prog.shortfall > 0 && <span style={{ color: T.red }}>Shortfall {money(prog.shortfall)}</span>}
            <span>Next due {fmtDate(prog.nextDue)}</span>
          </div>
          {(plan.notes || plan.document_url) && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 6 }}>{plan.notes}{plan.document_url && <> · <a href={plan.document_url} target="_blank" rel="noreferrer" style={{ color: T.gold }}>agreement</a></>}</div>}
        </div>
      )}

      {form && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
            <div><label>Opening arrears balance</label><MoneyInput prefix="£" value={form.opening_balance} onChange={v => setForm(f => ({ ...f, opening_balance: v }))} /></div>
            <div><label>Plan start</label><input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div><label>Instalment</label><MoneyInput prefix="£" value={form.instalment_amount} onChange={v => setForm(f => ({ ...f, instalment_amount: v }))} /></div>
            <div><label>Frequency</label><select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>{PLAN_FREQUENCIES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select></div>
            {form.frequency === 'monthly' && <div><label>Due day <span style={{ color: T.muted, fontWeight: 400, fontSize: 10 }}>(1–31)</span></label><input type="number" min={1} max={31} value={form.due_day || ''} onChange={e => setForm(f => ({ ...f, due_day: e.target.value }))} /></div>}
            <div><label>Agreement link</label><input value={form.document_url || ''} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://…" /></div>
          </div>
          <div style={{ marginBottom: 10 }}><label>Notes</label><input value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={savePlan} disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {plans === null && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>Loading…</div>}
      <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>Receipts allocated to "Historic arrears" reduce the balance and count towards the plan. Current rent is judged on its own.</div>
    </div>
  )
}
