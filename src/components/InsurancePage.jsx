import { MONO } from '../lib/styles'
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
import { Icon } from '../lib/icons'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import { fmt } from '../lib/format'
import { showAppToast } from '../lib/toast'
import MoneyInput from '../lib/MoneyInput'
import FocusTrap from '../lib/FocusTrap'
import { isFormDirty, safeOverlayClose } from '../lib/modalUtils'

const mono = MONO

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
  const [view, setView]         = useState('by_property')  // 'by_property' | 'active' | 'expiring' | 'expired' | 'all' | 'history'
  const [historyChainId, setHistoryChainId] = useState(null)
  const [editing, setEditing]   = useState(null)          // policy being edited, or {} for new
  const [renewing, setRenewing] = useState(null)          // policy being renewed (snapshot for the modal)
  // When the user clicks a property with multiple policies, we show a small
  // picker rather than opening one of them by guesswork. Tracks the property
  // whose picker is open; null means no picker showing.
  const [propertyPicker, setPropertyPicker] = useState(null)

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
    } else if (view === 'expiring') {
      // Not yet expired but renewal is due within 90 days.
      f = f.filter(p => ['urgent', 'soon'].includes(expiryBucket(p.expiry_date)))
    } else if (view === 'expired') {
      f = f.filter(p => expiryBucket(p.expiry_date) === 'expired')
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

  /**
   * Smart routing when a user clicks a property in the "By Property" view:
   *   - 0 policies covering this property → open new-policy modal pre-ticked
   *   - 1 policy                          → open edit modal for that policy
   *   - >1 policies                       → show picker, user chooses what to manage
   *
   * "Covering this property" includes both per-property links AND company-wide
   * policies (no property links) belonging to the same company.
   */
  function policiesForProperty(property) {
    return policies.filter(pol => {
      if (pol.company_id !== property.company_id) return false
      const links = pol.properties || []
      return links.length === 0 || links.some(p => p.id === property.id)
    })
  }
  function handlePropertyClick(property) {
    const covering = policiesForProperty(property)
    if (covering.length === 0) {
      // No policies — open new-policy modal with this property pre-selected
      setEditing({
        company_id:   property.company_id,
        _propertyIds: [property.id],
      })
    } else if (covering.length === 1) {
      setEditing(covering[0])
    } else {
      setPropertyPicker({ property, policies: covering })
    }
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['by_property', 'By Property'], ['active', 'Active'], ['expiring', 'Expiring Soon'], ['expired', 'Expired'], ['all', 'All'], ['history', 'History']].map(([k, l]) => (
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
      ) : view === 'by_property' ? (
        <ByPropertyView
          properties={properties}
          companies={companies}
          policies={policies}
          coFilter={coFilter}
          policiesForProperty={policiesForProperty}
          onPropertyClick={handlePropertyClick}
          T={T}
        />
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
          <div style={{ display:"flex", justifyContent:"center", marginBottom: 8 }}><Icon name="shield-check" size={30} color={T.gold}/></div>
          {policies.length === 0 ? (
            <>
              <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 12 }}>
                No policies yet. Add your first insurance policy to start tracking renewals.
              </div>
              <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setEditing({})}>+ Add Policy</button>
            </>
          ) : (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>
              {view === 'expiring' ? 'No policies expiring in the next 90 days.'
                : view === 'expired' ? 'No expired policies.'
                : 'No policies match the current filters.'}
            </div>
          )}
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

      {/* Property picker — shown when a property has multiple policies and
          the user clicks it from By Property view. Lets them choose which
          policy to manage, or add a new one. */}
      {propertyPicker && (
        <div className="overlay" onClick={() => setPropertyPicker(null)}>
          <FocusTrap onEscape={() => setPropertyPicker(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-labelledby="insurance-picker-title">
            <div style={{ padding: '22px 26px 0' }}>
              <h2 id="insurance-picker-title" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: T.text }}>
                Manage insurance
              </h2>
              <p style={{ fontFamily: mono, color: T.muted, fontSize: 11, marginBottom: 16 }}>
                {propertyPicker.property.name || propertyPicker.property.address} is covered by {propertyPicker.policies.length} policies. Which would you like to manage?
              </p>
            </div>
            <div style={{ padding: '0 26px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {propertyPicker.policies.map(pol => {
                const days = Math.floor((new Date(pol.expiry_date) - new Date()) / 86400000)
                const color = days < 0 ? T.red : days <= 30 ? T.amber : days <= 90 ? T.gold : T.green
                return (
                  <button
                    key={pol.id}
                    onClick={() => { setEditing(pol); setPropertyPicker(null) }}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                      background: T.bg, border: `1px solid ${T.border}`,
                      borderLeft: `3px solid ${color}`,
                      textAlign: 'left', fontFamily: mono,
                    }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{pol.policy_name}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        {TYPE_LABEL[pol.policy_type] || pol.policy_type} · expires {pol.expiry_date}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{fmt(pol.premium)}/yr</div>
                      <div style={{ fontSize: 9, color }}>
                        {days < 0 ? `Expired ${Math.abs(days)}d ago` : `Renews ${days}d`}
                      </div>
                    </div>
                  </button>
                )
              })}
              {/* Add another policy option */}
              <button
                onClick={() => {
                  // Open new-policy modal pre-ticked to this property
                  setEditing({
                    company_id:   propertyPicker.property.company_id,
                    _propertyIds: [propertyPicker.property.id],
                  })
                  setPropertyPicker(null)
                }}
                style={{
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: `1px dashed ${T.gold}`,
                  color: T.gold, fontFamily: mono, fontSize: 11, fontWeight: 700,
                  textAlign: 'center', marginTop: 4,
                }}>
                + Add another policy
              </button>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setPropertyPicker(null)}>Cancel</button>
              </div>
            </div>
          </div>
          </FocusTrap>
        </div>
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
            History
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
          Edit
        </button>
        <button onClick={onDelete} aria-label={`Delete policy ${policy.policy_name || ''}`.trim()}
          style={{ fontFamily: mono, fontSize: 10, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${T.red}44`, color: T.red }}>
          ✕
        </button>
      </div>
    </div>
  )
}

// ── By Property view ──────────────────────────────────────────────────────
// Mirrors the Rent Tracker layout: group properties by company, show each
// property's insurance status with a colour-coded pill. Clicking a property
// triggers smart routing in the parent (handlePropertyClick).
//
// This is the most useful default landing because it answers the question
// "what's NOT insured?" at a glance — which is much harder to answer from
// the policy-centric Active/All views.
function ByPropertyView({ properties, companies, policies, coFilter, policiesForProperty, onPropertyClick, T }) {
  // Exclude sold/archived properties, like the rent tracker does.
  // 'archived_at' presence means manually archived; status='sold' means
  // disposed of. Neither needs insurance tracking going forward.
  const activeProps = useMemo(
    () => properties.filter(p => p.status !== 'sold' && !p.archived_at),
    [properties]
  )
  // Apply the company filter from the parent (the pills at the top).
  // Default 'all' = every company; otherwise filter to one.
  const visibleProps = useMemo(
    () => coFilter === 'all' ? activeProps : activeProps.filter(p => p.company_id === coFilter),
    [activeProps, coFilter]
  )
  const visibleCos = useMemo(
    () => coFilter === 'all' ? companies : companies.filter(c => c.id === coFilter),
    [companies, coFilter]
  )

  // Group by company, dropping empty groups so we don't render blank cards.
  const groups = useMemo(() =>
    visibleCos
      .map(c => ({
        company: c,
        props: visibleProps
          .filter(p => p.company_id === c.id)
          // Sort naturally by name so "Flat 2" comes before "Flat 10"
          .sort((a, b) => String(a.name || a.address || '').localeCompare(
            String(b.name || b.address || ''),
            undefined,
            { numeric: true, sensitivity: 'base' }
          )),
      }))
      .filter(g => g.props.length > 0),
    [visibleCos, visibleProps]
  )

  /**
   * Classify a property's insurance status based on the BEST of all its
   * covering policies — i.e. the one with the longest time to expiry.
   * That way a property covered by one expiring policy AND one new policy
   * shows as healthy, not as "expired".
   *
   * Returns one of:
   *   { kind: 'insured',     label, color, days, nextExpiry, count }   — active, beyond 30 days
   *   { kind: 'renewing',    label, color, days, nextExpiry, count }   — within 30 days
   *   { kind: 'expired',     label, color, days, nextExpiry, count }   — all policies past expiry
   *   { kind: 'not_insured', label, color }                            — no policies at all
   */
  function classify(property) {
    const covering = policiesForProperty(property)
    if (covering.length === 0) {
      return { kind: 'not_insured', label: 'Not insured', color: T.red }
    }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    // For each policy, compute days-to-expiry. The "best" is the largest
    // (or least-negative if all expired).
    const ranked = covering
      .map(p => ({ pol: p, days: Math.floor((new Date(p.expiry_date) - today) / 86400000) }))
      .sort((a, b) => b.days - a.days)
    const best = ranked[0]
    const days = best.days
    if (days < 0) {
      return {
        kind: 'expired',
        label: `Expired ${Math.abs(days)}d ago`,
        color: T.red, days,
        nextExpiry: best.pol.expiry_date, count: covering.length,
      }
    }
    if (days <= 30) {
      return {
        kind: 'renewing',
        label: `Renews in ${days}d`,
        color: T.amber, days,
        nextExpiry: best.pol.expiry_date, count: covering.length,
      }
    }
    return {
      kind: 'insured',
      label: `Insured`,
      color: T.green, days,
      nextExpiry: best.pol.expiry_date, count: covering.length,
    }
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '16px 18px' }

  // Empty state
  if (groups.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom: 8 }}><Icon name="home" size={30} color={T.faint}/></div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>
          {properties.length === 0
            ? 'No properties yet. Add properties to start tracking insurance coverage.'
            : 'No properties match the current filter.'}
        </div>
      </div>
    )
  }

  // Portfolio-level summary numbers — gives a "we're covered/we're not" feel
  // at the top of the page.
  const allVisible = visibleProps.map(p => ({ prop: p, status: classify(p) }))
  const insuredCount    = allVisible.filter(x => x.status.kind === 'insured').length
  const renewingCount   = allVisible.filter(x => x.status.kind === 'renewing').length
  const expiredCount    = allVisible.filter(x => x.status.kind === 'expired').length
  const notInsuredCount = allVisible.filter(x => x.status.kind === 'not_insured').length

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Summary strip */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { l: 'Insured',     v: insuredCount,    c: T.green,  i: '✅' },
            { l: 'Renewing',    v: renewingCount,   c: T.amber,  i: '⚠'  },
            { l: 'Expired',     v: expiredCount,    c: T.red,    i: '🔴' },
            { l: 'Not insured', v: notInsuredCount, c: T.red,    i: '❌' },
          ].map(item => (
            <div key={item.l} style={{ padding: '10px 12px', background: T.bg, borderRadius: 8, borderLeft: `3px solid ${item.c}` }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                {item.i} {item.l}
              </div>
              <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, color: item.v > 0 && (item.l === 'Not insured' || item.l === 'Expired') ? item.c : T.text }}>
                {item.v}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
          Click any property to view or update its policy. Properties with no coverage open a new-policy form pre-ticked.
        </div>
      </div>

      {/* Company groups */}
      {groups.map(({ company, props }) => {
        const ps = props.map(p => ({ prop: p, status: classify(p) }))
        const groupInsured    = ps.filter(x => x.status.kind === 'insured').length
        const groupTotal      = ps.length
        return (
          <div key={company.id} style={card}>
            {/* Group header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                  background: (company.color || T.gold) + '22',
                  color: company.color || T.gold }}>
                  {company.abbr}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{company.name}</span>
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                {groupInsured} of {groupTotal} covered
              </div>
            </div>
            {/* Property rows */}
            <div style={{ display: 'grid', gap: 6 }}>
              {ps.map(({ prop, status }) => (
                <button
                  key={prop.id}
                  onClick={() => onPropertyClick(prop)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    background: T.bg, border: `1px solid ${T.border}`,
                    borderLeft: `3px solid ${status.color}`,
                    fontFamily: mono, fontSize: 11, color: T.text,
                    textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = T.card}
                  onMouseLeave={e => e.currentTarget.style.background = T.bg}
                  title="Click to manage insurance for this property"
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {prop.name || prop.address || 'Untitled'}
                    </div>
                    {prop.address && prop.address !== prop.name && (
                      <div style={{ fontSize: 9, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {prop.address}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{
                      fontFamily: mono, fontSize: 10, fontWeight: 700,
                      padding: '3px 8px', borderRadius: 4,
                      background: status.color + '22', color: status.color,
                      whiteSpace: 'nowrap',
                    }}>
                      {status.label}
                    </span>
                    {status.kind !== 'not_insured' && status.count > 1 && (
                      <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>
                        {status.count} policies
                      </div>
                    )}
                  </div>
                  <div style={{ color: T.muted, fontSize: 16 }}>›</div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}


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
  const confirmDiscard = useConfirm()
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

  // Dirty check — ~10 fields plus the multi-property selection must not be
  // wiped by a stray backdrop click or Escape.
  const [snapshot] = useState(form)
  const isDirty = isFormDirty(snapshot, form)
    || [...propertyIds].sort().join(',') !== [...initialIds].sort().join(',')
  const overlayClose = safeOverlayClose(isDirty, onClose, confirmDiscard)

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

  // Inline required-field highlighting — set once the user has tried to
  // save with something missing (same pattern as PropertyModal).
  const [triedSave, setTriedSave] = useState(false)

  function handleSubmit() {
    if (!form.policy_name || !form.company_id || !form.start_date || !form.expiry_date) {
      setTriedSave(true)
      showAppToast('Policy name, company, start date and expiry date are required.', 'error')
      return
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
  const errStyle = { fontFamily: mono, fontSize: 10, color: T.red, display: 'block', marginTop: 4 }
  // Merge the red required-border into the shared input style when a field
  // failed the last save attempt.
  const inpErr = (bad) => bad ? { ...inp, borderColor: T.red } : inp

  return (
    <div className="overlay" onClick={overlayClose}>
      <FocusTrap onEscape={() => overlayClose({ target: null, currentTarget: null })}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-labelledby="policy-modal-title">
        <div style={{ padding: '24px 28px 0' }}>
          <h2 id="policy-modal-title" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: T.text }}>
            {isRenewal ? 'Renew Policy' : isNew ? 'Add Insurance Policy' : 'Edit Insurance Policy'}
          </h2>
          <p style={{ fontFamily: mono, color: T.muted, fontSize: 11, marginBottom: 20 }}>
            {isRenewal
              ? 'Pre-filled from last year. Adjust the new premium and dates, then save.'
              : 'Track an annual insurance policy.'}
          </p>
        </div>

        <form onSubmit={e => { e.preventDefault(); handleSubmit() }} style={{ padding: '0 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="policy-name">Policy Name *</label>
              <input id="policy-name" style={inpErr(triedSave && !form.policy_name)} value={form.policy_name} onChange={e => s('policy_name', e.target.value)}
                placeholder="e.g. Buildings Insurance 2026"
                aria-invalid={triedSave && !form.policy_name ? 'true' : undefined}
                aria-describedby={triedSave && !form.policy_name ? 'policy-name-err' : undefined} />
              {triedSave && !form.policy_name && <span id="policy-name-err" style={errStyle}>Required</span>}
            </div>
            <div>
              <label style={lbl} htmlFor="policy-company">Company *</label>
              <select id="policy-company" style={inpErr(triedSave && !form.company_id)} value={form.company_id} onChange={e => s('company_id', e.target.value)}
                aria-invalid={triedSave && !form.company_id ? 'true' : undefined}
                aria-describedby={triedSave && !form.company_id ? 'policy-company-err' : undefined}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {triedSave && !form.company_id && <span id="policy-company-err" style={errStyle}>Required</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="policy-type">Policy Type</label>
              <select id="policy-type" style={inp} value={form.policy_type} onChange={e => s('policy_type', e.target.value)}>
                {api.POLICY_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="policy-freq">Payment Frequency</label>
              <select id="policy-freq" style={inp} value={form.payment_freq} onChange={e => s('payment_freq', e.target.value)}>
                <option value="annual">Annual (one-off)</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="policy-provider">Provider</label>
              <input id="policy-provider" style={inp} value={form.provider} onChange={e => s('provider', e.target.value)}
                placeholder="e.g. Direct Line, AXA" />
            </div>
            <div>
              <label style={lbl} htmlFor="policy-broker">Broker (optional)</label>
              <input id="policy-broker" style={inp} value={form.broker} onChange={e => s('broker', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="policy-number">Policy Number</label>
              <input id="policy-number" style={inp} value={form.policy_number} onChange={e => s('policy_number', e.target.value)} />
            </div>
            <div>
              <label style={lbl} htmlFor="policy-start">Start Date *</label>
              <input id="policy-start" style={inpErr(triedSave && !form.start_date)} type="date" value={form.start_date} onChange={e => s('start_date', e.target.value)}
                aria-invalid={triedSave && !form.start_date ? 'true' : undefined}
                aria-describedby={triedSave && !form.start_date ? 'policy-start-err' : undefined} />
              {triedSave && !form.start_date && <span id="policy-start-err" style={errStyle}>Required</span>}
            </div>
            <div>
              <label style={lbl} htmlFor="policy-expiry">Expiry Date *</label>
              <input id="policy-expiry" style={inpErr(triedSave && !form.expiry_date)} type="date" value={form.expiry_date} onChange={e => s('expiry_date', e.target.value)}
                aria-invalid={triedSave && !form.expiry_date ? 'true' : undefined}
                aria-describedby={triedSave && !form.expiry_date ? 'policy-expiry-err' : undefined} />
              {triedSave && !form.expiry_date && <span id="policy-expiry-err" style={errStyle}>Required</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="policy-premium">Annual Premium</label>
              <MoneyInput id="policy-premium" prefix="£" value={form.premium} onChange={v => s('premium', v)} style={inp} />
            </div>
            <div>
              <label style={lbl} htmlFor="policy-reminder">Reminder (days before expiry)</label>
              <input id="policy-reminder" style={inp} type="number" min={0} value={form.reminder_days}
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
                  <button type="button" onClick={() => setPropertyIds(availableProps.map(p => p.id))}
                    style={{ fontFamily: mono, fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: `1px solid ${T.border}`, color: T.muted }}>
                    Select all
                  </button>
                  <button type="button" onClick={() => setPropertyIds([])}
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
                      <input type="checkbox" checked={checked} onChange={() => toggleProperty(p.id)} style={{ margin: 0, width: 'auto', flexShrink: 0 }} />
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
            <label style={lbl} htmlFor="policy-notes">Notes</label>
            <textarea id="policy-notes" style={{ ...inp, minHeight: 60, resize: 'vertical' }}
              value={form.notes} onChange={e => s('notes', e.target.value)}
              placeholder="Excess, claim limits, other policy details…" />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-gold" style={{ fontSize: 12 }}>
              {isRenewal ? 'Save Renewal' : isNew ? 'Add Policy' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
      </FocusTrap>
    </div>
  )
}
