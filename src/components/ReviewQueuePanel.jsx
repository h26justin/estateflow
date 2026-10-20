// Receipts that need a human decision: unallocated remainders, possible
// duplicates across sources, conflicts. Nothing here is auto-resolved.
import { useState, useEffect } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import MoneyInput from '../lib/MoneyInput'
import { useConfirm } from '../lib/ConfirmContext'
import { rowKey } from '../lib/rowKey'
import { SkeletonList } from '../lib/Skeleton'
import { Button, Modal } from './ui'

const money = n => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function ReviewQueuePanel({ companies, properties, companyIds, canEdit, showToast, onClose, onChanged }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [items, setItems] = useState(null)
  const [editing, setEditing] = useState(null)   // { receipt, allocations }
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const lists = await Promise.all((companyIds?.length ? companyIds : companies.map(c => c.id)).map(id => api.fetchReviewQueue(id)))
      setItems(lists.flat().sort((a, b) => (a.received_date < b.received_date ? 1 : -1)))
    } catch (e) { showToast?.(e.message || 'Could not load the review queue', 'error'); setItems([]) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const propFor = r => properties.find(p => p.id === r.property_id) || r.property || {}
  const periodsFor = p => (p.rent_payments || []).filter(x => x.period_start).slice().sort((a, b) => (a.period_start < b.period_start ? 1 : -1))

  function startEdit(r) {
    setEditing({ receipt: r, allocations: (r.rent_allocations || []).map(a => ({ _key: rowKey(), target: a.target === 'unallocated' ? 'current_rent' : a.target, rent_payment_id: a.rent_payment_id || '', amount: Number(a.amount) })) })
  }
  const setAlloc = (i, k, v) => setEditing(e => ({ ...e, allocations: e.allocations.map((a, j) => j === i ? { ...a, [k]: v } : a) }))
  const remainder = editing ? Math.round((Number(editing.receipt.amount) - editing.allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)) * 100) / 100 : 0

  async function saveAlloc() {
    if (!editing || saving) return
    if (Math.abs(remainder) >= 0.005) { showToast?.(`${money(Math.abs(remainder))} still ${remainder > 0 ? 'unallocated' : 'over-allocated'}`, 'error'); return }
    for (const a of editing.allocations) if (a.target === 'current_rent' && !a.rent_payment_id) { showToast?.('Choose a rent period for each current-rent line', 'error'); return }
    setSaving(true)
    try { await api.reallocateReceipt(editing.receipt, editing.allocations); showToast?.('Receipt allocated'); setEditing(null); await load(); onChanged?.() }
    catch (e) { showToast?.(e.message, 'error') }
    setSaving(false)
  }
  async function markOk(r) {
    try { await api.updateReceipt(r.id, { review_status: 'ok', review_reason: null }); await load(); onChanged?.() } catch (e) { showToast?.(e.message, 'error') }
  }
  async function remove(r) {
    const go = await confirmDialog({ title: 'Delete this receipt as a duplicate?', body: `${money(r.amount)} received ${fmtDate(r.received_date)} will be removed. The receipt it duplicates is kept.`, confirmLabel: 'Delete duplicate', danger: true })
    if (!go) return
    try { await api.deleteReceipt(r.id); await load(); onChanged?.() } catch (e) { showToast?.(e.message, 'error') }
  }

  return (
    <Modal onClose={onClose} size="lg" zIndex={2000} title="Receipts to review"
      description="Unallocated money, possible duplicates and conflicts. Nothing is resolved automatically.">
        {items === null && <SkeletonList count={2} height={56}/>}
        {items && items.length === 0 && <div style={{ fontFamily: SANS, fontSize: FS.base, color: T.green, padding: '12px 0' }}>Nothing waiting for review.</div>}
        {items && items.map(r => {
          const p = propFor(r)
          const co = companies.find(c => c.id === (p.company_id || r.company_id))
          const isEditing = editing?.receipt?.id === r.id
          return (
            <div key={r.id} style={{ border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.amber}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T.text }}>{money(r.amount)}</div>
                <div style={{ fontSize: 12, color: T.text }}>{p.name || 'Property'}{co ? <span style={{ fontFamily: SANS, fontSize: FS.sm, color: co.color || T.goldText, marginLeft: 6 }}>{co.abbr || co.name}</span> : null}</div>
                <div style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted }}>{fmtDate(r.received_date)} · {r.payer?.replace('_', ' ')} · {r.source}{r.reference ? ` · ${r.reference}` : ''}</div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {canEdit && !isEditing && <Button size="sm" onClick={() => startEdit(r)}>Allocate</Button>}
                  {canEdit && !isEditing && <Button variant="secondary" size="sm" onClick={() => markOk(r)}>Looks right</Button>}
                  {canEdit && !isEditing && /duplicate/i.test(r.review_reason || '') && <Button variant="secondary" size="sm" style={{ color: T.red }} onClick={() => remove(r)}>Delete duplicate</Button>}
                </div>
              </div>
              <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.amber, marginTop: 4 }}>{r.review_reason || 'Needs review'}</div>
              {isEditing && (
                <div style={{ marginTop: 10 }}>
                  {editing.allocations.map((a, i) => (
                    <div key={a._key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 120px 30px', gap: 8, alignItems: 'end', marginBottom: 6 }}>
                      <div><label>Applies to</label><select aria-label="Applies to" value={a.target} onChange={e => setAlloc(i, 'target', e.target.value)}>
                        <option value="current_rent">Current rent</option><option value="historic_arrears">Historic arrears</option><option value="deposit">Deposit</option><option value="other">Other</option>
                      </select></div>
                      <div><label>Period</label>{a.target === 'current_rent'
                        ? <select value={a.rent_payment_id || ''} onChange={e => setAlloc(i, 'rent_payment_id', e.target.value)}><option value="">Choose…</option>{periodsFor(p).map(x => <option key={x.id} value={x.id}>{x.month_label} · {fmtDate(x.period_start)} → {fmtDate(x.period_end)} · {x.status}</option>)}</select>
                        : <input value={a.notes || ''} onChange={e => setAlloc(i, 'notes', e.target.value)} placeholder="optional note" />}</div>
                      <div><label>Amount</label><MoneyInput aria-label="Amount" prefix="£" value={a.amount} onChange={v => setAlloc(i, 'amount', v)} /></div>
                      <Button variant="ghost" size="sm" icon="x" aria-label="Remove split" style={{ color: T.red }} onClick={() => setEditing(e => ({ ...e, allocations: e.allocations.filter((_, j) => j !== i) }))} disabled={editing.allocations.length === 1} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="secondary" size="sm" icon="plus" onClick={() => setEditing(e => ({ ...e, allocations: [...e.allocations, { _key: rowKey(), target: 'historic_arrears', rent_payment_id: '', amount: '' }] }))}>Split</Button>
                    <span style={{ fontFamily: MONO, fontSize: FS.xs, color: Math.abs(remainder) < 0.005 ? T.green : T.amber }}>{Math.abs(remainder) < 0.005 ? 'Fully allocated' : `${money(Math.abs(remainder))} ${remainder > 0 ? 'unallocated' : 'over-allocated'}`}</span>
                    <Button variant="secondary" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" onClick={saveAlloc} disabled={saving}>{saving ? 'Saving…' : 'Save allocation'}</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
    </Modal>
  )
}
