// ── INSURANCE PAGE ────────────────────────────────────────────────────────
// Top-level page for managing insurance policies. Three views:
//   • Active   — current/upcoming-expiry policies (default)
//   • All      — every policy including historical/expired
//   • History  — for a chosen policy chain, shows year-over-year premiums
//
// A policy can cover:
//   • One property (most building/contents policies)
//   • Many properties (portfolio policies, fixed annual cost)
//   • A whole company (no per-property linkage)
//
// Renewal flow: clicking "Renew" on an existing policy creates a new policy
// row, copies most fields, shifts dates forward 1 year, and links back via
// previous_policy_id. The user can then adjust the new premium before save.

import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import { fmt } from '../lib/format'
import MoneyInput from '../lib/MoneyInput'

const mono = "'DM Mono',monospace"

// Bucket each policy by how urgent its renewal is. Anything past today is
// 'expired'; otherwise we look at days-to-go and classify.
function expiryBucket(expiryDate) {
  if (!expiryDate) return 'unknown'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  if (isNaN(expiry.getTime())) return 'unknown'
  const days = Math.floor((expiry - today) / (1000 * 60 * 60 * 24))
  if (days < 0)   return 'expired'
  if (days <= 30) return 'urgent'
  if (days <= 90) return 'soon'
  return 'ok'
}

function daysUntil(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  if (isNaN(expiry.getTime())) return null
  return Math.floor((expiry - today) / (1000 * 60 * 60 * 24))
}

const TYPE_LABEL = Object.fromEntries(api.POLICY_TYPES.map(t => [t.v, t.l]))

export default function InsurancePage({ user, companies = [], properties = [], showToast }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading]   = useState(true)
  const [coFilter, setCoFilter] = useState('all')
  const [view, setView]         = useState('active')      // 'active' | 'all' | 'history'
  const [historyChainId, setHistoryChainId] = useState(null)
  const [editing, setEditing]   = useState(null)          // policy being edited, or {} for new
  const [renewing, setRenewing] = useState(null)          // policy being renewed (snapshot for the modal)

  useEffect(() => { reload() }, [])

  async function reload() {
    setLoading(true)
    try {
      const data = await api.fetchInsurancePolicies()
      setPolicies(data)
    } catch (e) {
      showToast(e.message || 'Failed to load policies', 'error')
    }
    setLoading(false)
  }

  // Filter: by company first, then by view
  const filtered = useMemo(() => {
    let f = policies
    if (coFilter !== 'all') f = f.filter(p => p.company_id === coFilter)
    if (view === 'active') {
      // Show policies whose expiry is in the future (or within last 30 days
      // so a just-expired one stays visible for renewal prompts).
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
      f = f.filter(p => new Date(p.expiry_date) >= cutoff)
    }
    return f
  }, [policies, coFilter, view])

  // For history view, build the chain by walking previous_policy_id from
  // the selected starting policy backwards.
  const historyChain = useMemo(() => {
    if (!historyChainId) return []
    const byId = Object.fromEntries(policies.map(p => [p.id, p]))
    const chain = []
    let current = byId[historyChainId]
    while (current) {
      chain.push(current)
      current = current.previous_policy_id ? byId[current.previous_policy_id] : null
    }
    return chain
  }, [historyChainId, policies])

  async function handleSave(policyData, propertyIds) {
    try {
      if (editing?.id) {
        await api.updateInsurancePolicy(editing.id, policyData, propertyIds)
        showToast('Policy updated')
      } else {
        await api.createInsurancePolicy(policyData, propertyIds)
        showToast('Policy created')
      }
      setEditing(null)
      setRenewing(null)
      await reload()
    } catch (e) {
      showToast(e.message || 'Save failed', 'error')
    }
  }

  async function handleDelete(policy) {
    if (!await confirmDialog({
      title: 'Delete this policy?',
      body: 'It will be moved to Trash. You can restore it within 30 days.',
      confirmLabel: 'Delete',
      destructive: true,
    })) return
    try {
      await api.deleteInsurancePolicy(policy.id, user?.id)
      showToast('Policy deleted')
      await reload()
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error')
    }
  }

  async function handleRenew(policy) {
    // Pre-fill the modal with renewal defaults. We don't save to DB until
    // the user confirms — they may want to adjust the new premium first.
    const oldExpiry = new Date(policy.expiry_date)
    const newStart = oldExpiry.toISOString().slice(0, 10)
    const newExpiry = new Date(oldExpiry)
    newExpiry.setFullYear(newExpiry.getFullYear() + 1)
    setEditing({
      company_id:         policy.company_id,
      policy_type:        policy.policy_type,
      policy_name:        policy.policy_name,
      provider:           policy.provider,
      broker:             policy.broker,
      policy_number:      policy.policy_number,
      start_date:         newStart,
      expiry_date:        newExpiry.toISOString().slice(0, 10),
      premium:            policy.premium,
      payment_freq:       policy.payment_freq,
      previous_policy_id: policy.id,
      notes:              policy.notes,
      reminder_days:      policy.reminder_days,
      _propertyIds:       (policy.properties || []).map(p => p.id),
      _isRenewal:         true,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 4 }}>Insurance</h1>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
            {policies.length} {policies.length === 1 ? 'policy' : 'policies'} · {filtered.length} shown
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setEditing({})}>+ New Policy</button>
        </div>
      </div>

      {/* Company filter pills */}
      {companies.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>Filter:</span>
          {[{ id: 'all', abbr: 'All', color: T.gold }, ...companies].map(c => (
            <button key={c.id} onClick={() => setCoFilter(c.id)}
              style={{
                fontFamily: mono, fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${coFilter === c.id ? (c.color || T.gold) : T.border}`,
                background: coFilter === c.id ? (c.color || T.gold) + '22' : 'transparent',
                color: coFilter === c.id ? (c.color || T.gold) : T.muted,
                transition: 'all 0.18s',
              }}>
              {c.abbr || c.name}
            </button>
          ))}
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['active', 'Active'], ['all', 'All'], ['history', 'History']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            style={{
              fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${view === k ? T.gold : T.border}`,
              background: view === k ? T.gold + '22' : 'transparent',
              color: view === k ? T.gold : T.muted,
            }}>
            {l}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading policies…</div>
        </div>
      ) : view === 'history' ? (
        <HistoryView
          chain={historyChain}
          allPolicies={filtered}
          onSelect={setHistoryChainId}
          selectedId={historyChainId}
          T={T}
        />
      ) : filtered.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 12 }}>
            No policies yet. Add your first insurance policy to start tracking renewals.
          </div>
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setEditing({})}>+ Add Policy</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map(p => (
            <PolicyRow
              key={p.id}
              policy={p}
              onEdit={() => setEditing(p)}
              onRenew={() => handleRenew(p)}
              onDelete={() => handleDelete(p)}
              onShowHistory={() => { setView('history'); setHistoryChainId(p.id) }}
              T={T}
            />
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing !== null && (
        <PolicyModal
          policy={editing}
          companies={companies}
          properties={properties}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ── Policy row in the list view ───────────────────────────────────────────
function PolicyRow({ policy, onEdit, onRenew, onDelete, onShowHistory, T }) {
  const bucket = expiryBucket(policy.expiry_date)
  const days = daysUntil(policy.expiry_date)

  // Colour-code the expiry status
  const bucketStyle = {
    expired: { color: T.red,    label: `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`, bg: T.red + '11' },
    urgent:  { color: T.amber,  label: `Renews in ${days} ${days === 1 ? 'day' : 'days'}`,                      bg: T.amber + '11' },
    soon:    { color: T.gold,   label: `Renews in ${days} days`,                                                bg: T.gold + '11' },
    ok:      { color: T.green,  label: `Renews in ${days} days`,                                                bg: 'transparent' },
    unknown: { color: T.muted,  label: 'No expiry set',                                                         bg: 'transparent' },
  }[bucket]

  const propCount = policy.properties?.length || 0
  const coverage = propCount === 0
    ? `Whole company (${policy.company?.abbr || policy.company?.name || ''})`
    : propCount === 1
      ? policy.properties[0].name || policy.properties[0].address || '1 property'
      : `${propCount} properties`

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
      borderLeft: `4px solid ${bucketStyle.color}`,
      padding: '14px 18px',
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{policy.policy_name}</span>
          <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: policy.company?.color ? policy.company.color + '22' : T.muted + '22',
            color: policy.company?.color || T.muted }}>
            {policy.company?.abbr || policy.company?.name || '—'}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {TYPE_LABEL[policy.policy_type] || policy.policy_type}
          </span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 2 }}>
          {policy.provider || '—'} · {coverage}
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: T.muted }}>
            {policy.start_date} → <span style={{ color: bucketStyle.color, fontWeight: 700 }}>{policy.expiry_date}</span>
          </span>
          <span style={{ color: bucketStyle.color, fontWeight: 700, padding: bucketStyle.bg !== 'transparent' ? '2px 8px' : 0, background: bucketStyle.bg, borderRadius: 4 }}>
            {bucketStyle.label}
          </span>
          <span style={{ color: T.text, fontWeight: 700 }}>
            {fmt(policy.premium)} {policy.payment_freq === 'monthly' ? '/yr (£' + Math.round((policy.premium || 0) / 12) + '/mo)' : ''}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {policy.previous_policy_id && (
          <button onClick={onShowHistory} title="View history chain"
            style={{ fontFamily: mono, fontSize: 10, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${T.border}`, color: T.muted }}>
            📊 History
          </button>
        )}
        {(bucket === 'expired' || bucket === 'urgent' || bucket === 'soon') && (
          <button onClick={onRenew} title="Create next year's renewal"
            style={{ fontFamily: mono, fontSize: 10, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              background: T.gold + '22', border: `1px solid ${T.gold}`, color: T.gold, fontWeight: 700 }}>
            ↻ Renew
          </button>
        )}
        <button onClick={onEdit}
          style={{ fontFamily: mono, fontSize: 10, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${T.border}`, color: T.text }}>
          ✎ Edit
        </button>
        <button onClick={onDelete}
          style={{ fontFamily: mono, fontSize: 10, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${T.red}44`, color: T.red }}>
          🗑
        </button>
      </div>
    </div>
  )
}

// ── History view ──────────────────────────────────────────────────────────
// Lets the user pick a policy "head" and walks the chain backwards via
// previous_policy_id. Shows year-over-year premium with deltas.
function HistoryView({ chain, allPolicies, onSelect, selectedId, T }) {
  // Find "head" policies — those with no other policy pointing at them as
  // previous. These are the most recent in each chain.
  const heads = useMemo(() => {
    const referenced = new Set(allPolicies.map(p => p.previous_policy_id).filter(Boolean))
    return allPolicies.filter(p => !referenced.has(p.id))
  }, [allPolicies])

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }

  if (allPolicies.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>
          No policies to show history for. Add and renew a policy to build year-over-year history.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Chain picker */}
      <div style={card}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
          Pick a policy to see its history
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {heads.map(p => (
            <button key={p.id} onClick={() => onSelect(p.id)}
              style={{
                fontFamily: mono, fontSize: 11, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${selectedId === p.id ? T.gold : T.border}`,
                background: selectedId === p.id ? T.gold + '22' : 'transparent',
                color: selectedId === p.id ? T.gold : T.text,
                textAlign: 'left',
              }}>
              {p.policy_name}
              <span style={{ display: 'block', fontSize: 9, color: T.muted, marginTop: 2 }}>
                {p.company?.abbr || ''} · {TYPE_LABEL[p.policy_type] || p.policy_type}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* The chain */}
      {chain.length > 0 && (
        <div style={card}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
            Year-over-year history · {chain.length} {chain.length === 1 ? 'policy' : 'renewals'}
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {chain.map((p, i) => {
              const prev = chain[i + 1]
              const delta = prev ? p.premium - prev.premium : null
              const deltaPct = prev && prev.premium > 0 ? (delta / prev.premium) * 100 : null
              const year = (p.start_date || '').slice(0, 4)
              return (
                <div key={p.id} style={{
                  display: 'grid', gridTemplateColumns: '60px 1fr auto auto', gap: 14, alignItems: 'center',
                  padding: '12px 0', borderBottom: i < chain.length - 1 ? `1px solid ${T.border}` : 'none',
                }}>
                  <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: i === 0 ? T.gold : T.text }}>
                    {year || '—'}
                  </div>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 11, color: T.text }}>
                      {p.start_date} → {p.expiry_date}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
                      {p.provider || '—'} {p.policy_number ? `· #${p.policy_number}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.text }}>{fmt(p.premium)}</div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: T.muted }}>premium</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    {delta != null ? (
                      <>
                        <div style={{
                          fontFamily: mono, fontSize: 12, fontWeight: 700,
                          color: delta > 0 ? T.red : delta < 0 ? T.green : T.muted,
                        }}>
                          {delta > 0 ? '+' : ''}{fmt(delta)}
                        </div>
                        <div style={{ fontFamily: mono, fontSize: 9, color: T.muted }}>
                          {deltaPct != null ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% YoY` : ''}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>—</div>
                    )}
                  </div>
                </div>
              )
            })}
            {/* Total spent over the chain */}
            <div style={{
              marginTop: 10, padding: '12px 0 0', borderTop: `2px solid ${T.gold}`,
              display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 14, alignItems: 'center',
            }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Total
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                Across {chain.length} {chain.length === 1 ? 'policy' : 'policies'}
              </div>
              <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: T.gold, textAlign: 'right' }}>
                {fmt(chain.reduce((s, p) => s + (Number(p.premium) || 0), 0))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Editor modal ──────────────────────────────────────────────────────────
function PolicyModal({ policy, companies, properties, onClose, onSave }) {
  const { T } = useTheme()
  const isNew = !policy.id
  const isRenewal = policy._isRenewal

  // Default form values, filled from the policy prop (which may have
  // renewal pre-fills, full edit data, or be empty for a new policy).
  const [form, setForm] = useState({
    company_id:         policy.company_id || companies[0]?.id || '',
    policy_type:        policy.policy_type || 'landlord',
    policy_name:        policy.policy_name || '',
    provider:           policy.provider || '',
    broker:             policy.broker || '',
    policy_number:      policy.policy_number || '',
    start_date:         policy.start_date || '',
    expiry_date:        policy.expiry_date || '',
    premium:            policy.premium || '',
    payment_freq:       policy.payment_freq || 'annual',
    previous_policy_id: policy.previous_policy_id || null,
    reminder_days:      policy.reminder_days != null ? policy.reminder_days : 30,
    notes:              policy.notes || '',
  })
  // Property links — array of property IDs covered by this policy. Empty
  // array means "whole company / no specific properties".
  const initialIds = policy._propertyIds || (policy.properties || []).map(p => p.id)
  const [propertyIds, setPropertyIds] = useState(initialIds)

  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Properties available for linking — must belong to the selected company
  // (otherwise the user could create cross-company links which makes no sense).
  const availableProps = useMemo(() =>
    properties.filter(p => p.company_id === form.company_id && p.status !== 'sold'),
    [properties, form.company_id]
  )

  function toggleProperty(id) {
    setPropertyIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  function handleSubmit() {
    if (!form.policy_name || !form.company_id || !form.start_date || !form.expiry_date) {
      return alert('Policy name, company, start date and expiry date are required.')
    }
    const data = {
      ...form,
      premium: parseFloat(form.premium) || 0,
      reminder_days: parseInt(form.reminder_days) || 30,
    }
    onSave(data, propertyIds)
  }

  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, display: 'block' }
  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '8px 12px', width: '100%', outline: 'none' }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div style={{ padding: '24px 28px 0' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: T.text }}>
            {isRenewal ? 'Renew Policy' : isNew ? 'Add Insurance Policy' : 'Edit Insurance Policy'}
          </h2>
          <p style={{ fontFamily: mono, color: T.muted, fontSize: 11, marginBottom: 20 }}>
            {isRenewal
              ? 'Pre-filled from last year. Adjust the new premium and dates, then save.'
              : 'Track an annual insurance policy.'}
          </p>
        </div>

        <div style={{ padding: '0 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Policy Name *</label>
              <input style={inp} value={form.policy_name} onChange={e => s('policy_name', e.target.value)}
                placeholder="e.g. Buildings Insurance 2026" />
            </div>
            <div>
              <label style={lbl}>Company *</label>
              <select style={inp} value={form.company_id} onChange={e => s('company_id', e.target.value)}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Policy Type</label>
              <select style={inp} value={form.policy_type} onChange={e => s('policy_type', e.target.value)}>
                {api.POLICY_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Payment Frequency</label>
              <select style={inp} value={form.payment_freq} onChange={e => s('payment_freq', e.target.value)}>
                <option value="annual">Annual (one-off)</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Provider</label>
              <input style={inp} value={form.provider} onChange={e => s('provider', e.target.value)}
                placeholder="e.g. Direct Line, AXA" />
            </div>
            <div>
              <label style={lbl}>Broker (optional)</label>
              <input style={inp} value={form.broker} onChange={e => s('broker', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Policy Number</label>
              <input style={inp} value={form.policy_number} onChange={e => s('policy_number', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Start Date *</label>
              <input style={inp} type="date" value={form.start_date} onChange={e => s('start_date', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Expiry Date *</label>
              <input style={inp} type="date" value={form.expiry_date} onChange={e => s('expiry_date', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Annual Premium</label>
              <MoneyInput prefix="£" value={form.premium} onChange={v => s('premium', v)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Reminder (days before expiry)</label>
              <input style={inp} type="number" min={0} value={form.reminder_days}
                onChange={e => s('reminder_days', e.target.value)} />
            </div>
          </div>

          {/* Property picker */}
          <div>
            <label style={lbl}>Properties covered</label>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 8 }}>
              Tick all properties this policy covers. Leave all unticked for a company-wide policy.
              {propertyIds.length > 0 && ` · ${propertyIds.length} selected`}
            </div>
            {availableProps.length === 0 ? (
              <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '12px', background: T.bg, borderRadius: 6 }}>
                No properties in this company yet.
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
                maxHeight: 200, overflowY: 'auto',
                background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px',
              }}>
                {/* Select all / none */}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, paddingBottom: 6, borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
                  <button onClick={() => setPropertyIds(availableProps.map(p => p.id))}
                    style={{ fontFamily: mono, fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: `1px solid ${T.border}`, color: T.muted }}>
                    Select all
                  </button>
                  <button onClick={() => setPropertyIds([])}
                    style={{ fontFamily: mono, fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: `1px solid ${T.border}`, color: T.muted }}>
                    Clear
                  </button>
                </div>
                {availableProps.map(p => {
                  const checked = propertyIds.includes(p.id)
                  return (
                    <label key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4,
                        cursor: 'pointer', fontFamily: mono, fontSize: 11,
                        background: checked ? T.gold + '11' : 'transparent',
                        color: T.text,
                      }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleProperty(p.id)} style={{ margin: 0 }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {p.name || p.address || 'Untitled'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }}
              value={form.notes} onChange={e => s('notes', e.target.value)}
              placeholder="Excess, claim limits, other policy details…" />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={handleSubmit}>
              {isRenewal ? 'Save Renewal' : isNew ? 'Add Policy' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
