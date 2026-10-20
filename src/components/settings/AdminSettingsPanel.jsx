import { useState, useEffect, useCallback } from 'react'
import { MONO, FS, SANS, R } from '../../lib/styles'
import { Button, Modal } from '../ui'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { fmt } from '../feature/helpers'
import { FeatureFlagsPanel } from './FeatureFlagsPanel'
import { RevenueAnalyticsPanel } from './RevenueAnalyticsPanel'
import { Icon } from '../../lib/icons'
import { SkeletonRows } from '../../lib/Skeleton'
import { useConfirm } from '../../lib/ConfirmContext'
import { ensureAal2, totpPrompt } from '../../lib/mfaStepUp'

// ── ADMIN SETTINGS PANEL ──────────────────────────────────────────────────────
export function AdminSettingsPanel({ user, T, showToast }) {
  const confirmDialog = useConfirm()
  const mono = MONO
  const [tab, setTab]           = useState('accounts')
  const [companies, setCompanies] = useState([])
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [saving, setSaving]         = useState(null)
  const [filter, setFilter]         = useState('all')
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, email }
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError]   = useState('')
  const [deleting, setDeleting]         = useState(false)

  const beginLoad = useLoadGuard()

  const loadAll = useCallback(async () => {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const [cos, us] = await Promise.all([
        api.fetchAdminAllCompanies(),
        api.fetchAllUsers().catch(() => []),
      ])
      if (!isCurrent()) return
      setCompanies(cos)
      setUsers(us)
    } catch(e) {
      if (!isCurrent()) return
      showToast('Failed to load admin data', 'error')
    }
    setLoading(false)
  }, [beginLoad, showToast])
  useEffect(() => { loadAll() }, [loadAll])

  async function handleDeleteUser() {
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Please enter your password'); return }
    setDeleting(true)
    try {
      // Re-authenticate to verify password
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email, password: deletePassword
      })
      if (authErr) { setDeleteError('Incorrect password — please try again'); setDeleting(false); return }
      // Re-auth leaves an aal1 session; delete-user requires aal2.
      const step = await ensureAal2(totpPrompt(confirmDialog, 'Deleting a user needs your authenticator code.'))
      if (step === 'cancelled') { setDeleteError('Two-factor verification is required to delete a user'); setDeleting(false); return }
      // Password verified — delete the user
      await api.deleteUser(deleteTarget.id)
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
      setCompanies(prev => prev.filter(c => c.owner_email !== deleteTarget.email))
      setDeleteTarget(null)
      setDeletePassword('')
      showToast(`${deleteTarget.email} has been deleted`)
    } catch(e) {
      setDeleteError(e.message || 'Delete failed')
    }
    setDeleting(false)
  }

  async function toggleFreeTier(companyId, current) {
    setSaving(companyId)
    try {
      await api.setCompanyFreeTier(companyId, !current, user.id)
      setCompanies(prev => prev.map(c => c.id === companyId
        ? { ...c, is_free_tier: !current }
        : c))
      showToast(!current ? 'Free tier granted' : 'Moved to paid billing')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(null)
  }

  const filtered = companies.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !q || c.name?.toLowerCase().includes(q) || c.owner_email?.toLowerCase().includes(q)
    const status = c.is_free_tier ? 'free_tier' : (c.subscriptions?.[0]?.status || 'trialing')
    const matchFilter = filter === 'all' || status === filter
    return matchSearch && matchFilter
  })

  // KPIs
  const active   = companies.filter(c => c.subscriptions?.[0]?.status === 'active').length
  const trialing = companies.filter(c => !c.is_free_tier && (!c.subscriptions?.[0]?.status || c.subscriptions?.[0]?.status === 'trialing')).length
  const freeTier = companies.filter(c => c.is_free_tier).length
  const pastDue  = companies.filter(c => c.subscriptions?.[0]?.status === 'past_due').length
  const mrr      = companies.filter(c => c.subscriptions?.[0]?.status === 'active')
    .reduce((s, c) => s + (c.subscriptions?.[0]?.property_count || 0), 0)

  const STATUS_CFG = {
    active:    { label: 'Active',    color: T.green },
    trialing:  { label: 'Trialing',  color: T.blue  },
    past_due:  { label: 'Past due',  color: T.amber },
    canceled:  { label: 'Cancelled', color: T.red   },
    free_tier: { label: 'Free tier', color: T.goldText  },
  }

  const tabBtn = k => ({
    fontFamily: mono, fontSize: 11, padding: '7px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer',
    background: tab === k ? T.gold + '22' : 'transparent',
    color: tab === k ? T.goldText : T.muted,
    fontWeight: tab === k ? 700 : 400,
  })

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total accounts', value: companies.length, color: T.text },
          { label: 'Active paying',  value: active,           color: T.green },
          { label: 'On trial',       value: trialing,         color: T.blue  },
          { label: 'Past due',       value: pastDue,          color: T.amber },
          { label: 'Est. MRR',       value: fmt(mrr),         color: T.green },
        ].map(m => (
          <div key={m.label} style={{ background: T.bg, borderRadius: 12, padding: '16px 18px', border: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: m.color, letterSpacing: '-0.02em' }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${T.border}` }}>
        <button style={tabBtn('accounts')} onClick={() => setTab('accounts')}>Accounts ({companies.length})</button>
        <button style={tabBtn('users')} onClick={() => setTab('users')}>Users ({users.length})</button>
        <button style={tabBtn('flags')} onClick={() => setTab('flags')}>Feature Flags</button>
        <button style={tabBtn('revenue')} onClick={() => setTab('revenue')}>Revenue</button>
      </div>

      {loading ? (
        <SkeletonRows rows={5} height={44}/>
      ) : (
        <>
          {/* ACCOUNTS TAB */}
          {tab === 'accounts' && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by company or email…"
                  style={{ flex: 1, minWidth: 200, fontFamily: SANS, fontSize: FS.sm, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px' }}/>
                <select value={filter} onChange={e => setFilter(e.target.value)}
                  style={{ fontFamily: SANS, fontSize: FS.sm, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px' }}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="past_due">Past due</option>
                  <option value="free_tier">Free tier</option>
                </select>
              </div>

              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 60px 80px 120px', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  {['Company / Owner', 'Status', 'Props', 'MRR', 'Free tier'].map(h => (
                    <div key={h} style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', fontFamily: SANS, fontSize: FS.base, color: T.muted }}>No accounts match your search</div>
                )}
                {filtered.map(co => {
                  const status = co.is_free_tier ? 'free_tier' : (co.subscriptions?.[0]?.status || 'trialing')
                  const sc = STATUS_CFG[status] || { label: status, color: T.muted }
                  const propCount = co.subscriptions?.[0]?.property_count || 0
                  const monthlyRev = status === 'active' ? propCount : 0
                  return (
                    <div key={co.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 60px 80px 120px', gap: 8, padding: '13px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontFamily: mono, fontSize: FS.xs, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color || T.gold) + '22', color: co.color || T.goldText }}>{co.abbr}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{co.name}</span>
                        </div>
                        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>{co.owner_email || '—'}</div>
                      </div>
                      <div>
                        <span style={{ fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: sc.color + '22', color: sc.color }}>{sc.label}</span>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.text }}>{propCount}</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: monthlyRev > 0 ? T.green : T.muted }}>{monthlyRev > 0 ? fmt(monthlyRev) : '—'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: SANS, fontSize: FS.sm, color: co.is_free_tier ? T.goldText : T.muted }}>{co.is_free_tier ? 'Free' : 'Paid'}</span>
                        <button role="switch" aria-checked={!!co.is_free_tier} aria-label={`Free tier for ${co.name}`} disabled={saving === co.id} onClick={() => saving !== co.id && toggleFreeTier(co.id, co.is_free_tier)}
                          style={{ border:'none', padding:0, width: 38, height: 22, borderRadius: 11, background: co.is_free_tier ? T.gold : T.border, cursor: saving === co.id ? 'wait' : 'pointer', position: 'relative', transition: 'background 0.2s', opacity: saving === co.id ? 0.5 : 1, flexShrink: 0 }}>
                          <div style={{ position: 'absolute', top: 3, left: co.is_free_tier ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 10 }}>
                {filtered.length} of {companies.length} accounts · Toggle free tier to exempt from billing
              </div>
            </>
          )}

          {/* USERS TAB */}
          {tab === 'users' && (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by email…"
                style={{ width: '100%', maxWidth: 340, fontFamily: SANS, fontSize: FS.sm, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}/>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 100px 80px', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  {['Email', 'Companies', 'Signed up', ''].map(h => (
                    <div key={h} style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
                  ))}
                </div>
                {users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase())).map(u => {
                  const userCos = companies.filter(c => c.owner_email === u.email)
                  return (
                    <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 180px 100px 80px', gap: 8, padding: '13px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 16, background: T.gold + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.goldText, flexShrink: 0 }}>
                          {(u.email?.[0] || '?').toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, color: T.text }}>{u.email}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {userCos.length === 0
                          ? <span style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>No companies</span>
                          : userCos.slice(0, 3).map(co => (
                            <span key={co.id} style={{ fontFamily: mono, fontSize: FS.xs, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color || T.gold) + '22', color: co.color || T.goldText }}>{co.abbr}</span>
                          ))
                        }
                        {userCos.length > 3 && <span style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>+{userCos.length - 3}</span>}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                      </div>
                      <div>
                        {u.id !== user?.id && (
                          <button
                            onClick={() => { setDeleteTarget({ id: u.id, email: u.email }); setDeletePassword(''); setDeleteError('') }}
                            title="Delete user"
                            style={{ fontFamily: SANS, fontSize: FS.sm, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.red}44`, background: 'transparent', color: T.red }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 10 }}>{users.length} total users · Your own account cannot be deleted</div>
            </>
          )}

          {/* FEATURE FLAGS TAB */}
          {tab === 'flags' && <FeatureFlagsPanel users={users} companies={companies} T={T} showToast={showToast}/>}

          {/* REVENUE TAB */}
          {tab === 'revenue' && <RevenueAnalyticsPanel companies={companies} T={T} showToast={showToast}/>}
        </>
      )}

      {/* ── DELETE USER MODAL ── */}
      {deleteTarget && (
        <Modal onClose={() => { if (!deleting) { setDeleteTarget(null); setDeletePassword(''); setDeleteError('') } }} size="sm" zIndex={600}
          title="Delete user account"
          description={<>This will permanently delete <strong style={{ color: T.text }}>{deleteTarget.email}</strong> and all their data including companies, properties, deals and documents. <strong style={{ color: T.red }}>This cannot be undone.</strong></>}
          footer={<>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError('') }}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteUser} disabled={deleting || !deletePassword}>
              {deleting ? 'Verifying & deleting…' : 'Permanently delete user'}
            </Button>
          </>}>
          <label style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, display: 'block', marginBottom: 8 }}>
            Enter your admin password to confirm
          </label>
          <input aria-label="Enter your admin password to confirm"
            type="password"
            value={deletePassword}
            onChange={e => { setDeletePassword(e.target.value); setDeleteError('') }}
            onKeyDown={e => e.key === 'Enter' && handleDeleteUser()}
            placeholder="Your password"
            autoFocus
            style={{ width: '100%', fontFamily: SANS, fontSize: FS.base, background: T.bg, border: `1.5px solid ${deleteError ? T.red : T.border}`, color: T.text, borderRadius: R.sm, padding: '10px 14px' }}
          />
          {deleteError && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 8 }}>{deleteError}</div>
          )}
        </Modal>
      )}
    </div>
  )
}
