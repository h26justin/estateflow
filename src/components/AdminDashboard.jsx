import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'

export default function AdminDashboard({ onClose }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  const [tab, setTab]           = useState('overview')
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [saving, setSaving]         = useState(null)
  const [subFilter, setSubFilter]   = useState('all')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError]   = useState('')
  const [deleting, setDeleting]         = useState(false)
  const [currentUser, setCurrentUser]   = useState(null)

  useEffect(() => {
    loadAll()
    supabase.auth.getUser().then(({data:{user}})=>setCurrentUser(user))
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [companies, users] = await Promise.all([
        api.fetchAdminAllCompanies(),
        api.fetchAllUsers().catch(() => []),
      ])
      setData({ companies, users })
    } catch(e) {}
    setLoading(false)
  }

  async function handleDeleteUser() {
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Please enter your password'); return }
    setDeleting(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: currentUser?.email, password: deletePassword
      })
      if (authErr) { setDeleteError('Incorrect password — please try again'); setDeleting(false); return }
      await api.deleteUser(deleteTarget.id)
      setData(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== deleteTarget.id)
      }))
      setDeleteTarget(null)
      setDeletePassword('')
    } catch(e) { setDeleteError(e.message || 'Delete failed') }
    setDeleting(false)
  }

  async function toggleFreeTier(companyId, current) {
    setSaving(companyId)
    try {
      await api.setCompanyFreeTier(companyId, !current)
      await loadAll()
    } catch(e) { alert(e.message) }
    setSaving(null)
  }

  const metrics = useMemo(() => {
    if (!data) return {}
    const cos = data.companies
    const active    = cos.filter(c => c.subscriptions?.[0]?.status === 'active').length
    const trialing  = cos.filter(c => c.subscriptions?.[0]?.status === 'trialing' && !c.is_free_tier).length
    const freeTier  = cos.filter(c => c.is_free_tier).length
    const pastDue   = cos.filter(c => c.subscriptions?.[0]?.status === 'past_due').length
    const totalProps = cos.reduce((s,c) => s + (c.subscriptions?.[0]?.property_count || 0), 0)
    const mrr = cos.filter(c => c.subscriptions?.[0]?.status === 'active')
      .reduce((s,c) => s + (c.subscriptions?.[0]?.property_count || 0), 0)
    return { active, trialing, freeTier, pastDue, totalProps, mrr, totalCos: cos.length, totalUsers: data.users.length }
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.companies.filter(c => {
      const q = search.toLowerCase()
      const matchSearch = !q || c.name?.toLowerCase().includes(q) || c.owner_email?.toLowerCase().includes(q)
      const status = c.is_free_tier ? 'free_tier' : (c.subscriptions?.[0]?.status || 'trialing')
      const matchFilter = subFilter === 'all' || status === subFilter
      return matchSearch && matchFilter
    })
  }, [data, search, subFilter])

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14 }
  const labelSm = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }

  function StatusPill({ company }) {
    const status = company.is_free_tier ? 'free_tier' : (company.subscriptions?.[0]?.status || 'trialing')
    const cfg = {
      active:    { bg: T.green+'22', color: T.green,  label: 'Active' },
      trialing:  { bg: T.blue+'22',  color: T.blue,   label: 'Trialing' },
      past_due:  { bg: T.amber+'22', color: T.amber,  label: 'Past due' },
      canceled:  { bg: T.red+'22',   color: T.red,    label: 'Cancelled' },
      free_tier: { bg: T.gold+'22',  color: T.gold,   label: 'Free tier' },
    }[status] || { bg: T.border, color: T.muted, label: status }
    return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
  }

  const tabStyle = (k) => ({
    fontFamily: mono, fontSize: 11, padding: '8px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
    background: tab === k ? T.gold + '22' : 'transparent',
    color: tab === k ? T.gold : T.muted,
    fontWeight: tab === k ? 700 : 400,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: T.bg, overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '0 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src="/logo.svg" alt="OwnProperly" style={{ height: 28 }}/>
            <div style={{ width: 1, height: 24, background: T.border }}/>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.gold, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Platform Admin</span>
          </div>
          <button onClick={onClose} style={{ fontFamily: mono, fontSize: 12, background: 'none', border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
            ← Back to app
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
          {[['overview','📊 Overview'],['accounts','🏢 Accounts'],['users','👥 Users']].map(([k,l]) => (
            <button key={k} style={tabStyle(k)} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, fontFamily: mono, fontSize: 12, color: T.muted }}>Loading all accounts…</div>
        ) : (

          <>
            {/* ── OVERVIEW TAB ── */}
            {tab === 'overview' && (
              <div>
                {/* KPI Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 28 }}>
                  {[
                    { label: 'Total accounts', value: metrics.totalCos, color: T.text },
                    { label: 'Active paying', value: metrics.active, color: T.green },
                    { label: 'On trial', value: metrics.trialing, color: T.blue },
                    { label: 'Past due', value: metrics.pastDue, color: T.amber },
                    { label: 'Free tier', value: metrics.freeTier, color: T.gold },
                    { label: 'Total users', value: metrics.totalUsers, color: T.text },
                    { label: 'Total properties', value: metrics.totalProps, color: T.text },
                    { label: 'Est. MRR', value: `£${metrics.mrr}`, color: T.green },
                  ].map(m => (
                    <div key={m.label} style={{ ...card, padding: '20px 22px' }}>
                      <div style={{ ...labelSm, marginBottom: 8 }}>{m.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: m.color, letterSpacing: '-0.02em' }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Recent accounts */}
                <div style={{ ...card, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ ...labelSm }}>Recent accounts</span>
                    <button onClick={() => setTab('accounts')} style={{ fontFamily: mono, fontSize: 11, color: T.gold, background: 'none', border: 'none', cursor: 'pointer' }}>View all →</button>
                  </div>
                  {data.companies.slice(0, 8).map(co => (
                    <div key={co.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: (co.color||'#C8A84B')+'22', color: co.color||'#C8A84B' }}>{co.abbr}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{co.name}</div>
                          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{co.owner_email}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{co.subscriptions?.[0]?.property_count || 0} props</span>
                        <StatusPill company={co}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── ACCOUNTS TAB ── */}
            {tab === 'accounts' && (
              <div>
                {/* Filters */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search company or email…"
                    style={{ flex: 1, minWidth: 200, fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 14px', outline: 'none' }}/>
                  <select value={subFilter} onChange={e => setSubFilter(e.target.value)}
                    style={{ fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 14px', outline: 'none' }}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="trialing">Trialing</option>
                    <option value="past_due">Past due</option>
                    <option value="canceled">Cancelled</option>
                    <option value="free_tier">Free tier</option>
                  </select>
                </div>

                <div style={{ ...card, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: '1fr 160px 80px 100px 80px', gap: 12 }}>
                    {['Company / Owner', 'Status', 'Props', 'MRR', 'Free tier'].map(h => (
                      <div key={h} style={{ ...labelSm }}>{h}</div>
                    ))}
                  </div>
                  {filtered.length === 0 && (
                    <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No accounts match your search</div>
                  )}
                  {filtered.map(co => {
                    const propCount = co.subscriptions?.[0]?.property_count || 0
                    const mrr = co.subscriptions?.[0]?.status === 'active' ? propCount : 0
                    return (
                      <div key={co.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: '1fr 160px 80px 100px 80px', gap: 12, alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color||'#C8A84B')+'22', color: co.color||'#C8A84B' }}>{co.abbr}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{co.name}</span>
                          </div>
                          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{co.owner_email || '—'}</div>
                        </div>
                        <div><StatusPill company={co}/></div>
                        <div style={{ fontFamily: mono, fontSize: 12, color: T.text }}>{propCount}</div>
                        <div style={{ fontFamily: mono, fontSize: 12, color: mrr > 0 ? T.green : T.muted }}>
                          {mrr > 0 ? `£${mrr}/mo` : '—'}
                        </div>
                        <div>
                          <div onClick={() => toggleFreeTier(co.id, co.is_free_tier)}
                            style={{ width: 36, height: 20, borderRadius: 10, background: co.is_free_tier ? T.gold : T.border, cursor: saving === co.id ? 'wait' : 'pointer', position: 'relative', transition: 'background 0.2s', opacity: saving === co.id ? 0.5 : 1 }}>
                            <div style={{ position: 'absolute', top: 2, left: co.is_free_tier ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 12 }}>
                  Showing {filtered.length} of {data.companies.length} accounts
                </div>
              </div>
            )}

            {/* ── USERS TAB ── */}
            {tab === 'users' && (
              <div>
                <div style={{ marginBottom: 20 }}>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by email…"
                    style={{ width: 320, fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 14px', outline: 'none' }}/>
                </div>
                <div style={{ ...card, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: '1fr 200px 100px 80px', gap: 12 }}>
                    {['Email', 'Companies', 'Signed up', ''].map(h => (
                      <div key={h} style={{ ...labelSm }}>{h}</div>
                    ))}
                  </div>
                  {data.users
                    .filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()))
                    .map(u => {
                      const userCos = data.companies.filter(c => c.owner_email === u.email)
                      return (
                        <div key={u.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: '1fr 200px 100px 80px', gap: 12, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 16, background: T.gold+'33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.gold, flexShrink: 0 }}>
                              {(u.email?.[0] || '?').toUpperCase()}
                            </div>
                            <span style={{ fontSize: 13, color: T.text }}>{u.email}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {userCos.length === 0
                              ? <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>No companies</span>
                              : userCos.map(co => (
                                <span key={co.id} style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color||'#C8A84B')+'22', color: co.color||'#C8A84B' }}>{co.abbr}</span>
                              ))
                            }
                          </div>
                          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                            {u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' }) : '—'}
                          </div>
                        </div>
                      )
                    })}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 12 }}>
                  {data.users.length} total users
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>

      {/* ── DELETE USER MODAL ── */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 24 }}>
          <div style={{ background: T.surface, border: `2px solid ${T.red}44`, borderRadius: 18, width: '100%', maxWidth: 440, padding: '32px 28px' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.red, marginBottom: 8 }}>Delete user account</h2>
              <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
                This will permanently delete <strong style={{ color: T.text }}>{deleteTarget.email}</strong> and all their data.
              </p>
              <p style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 8, fontWeight: 700 }}>This cannot be undone.</p>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                Enter your admin password to confirm
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteError('') }}
                onKeyDown={e => e.key === 'Enter' && handleDeleteUser()}
                placeholder="Your password"
                autoFocus
                style={{ width: '100%', fontFamily: mono, fontSize: 13, background: T.bg, border: `1.5px solid ${deleteError ? T.red : T.border}`, color: T.text, borderRadius: 8, padding: '10px 14px', outline: 'none' }}
              />
              {deleteError && <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 8 }}>{deleteError}</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError('') }}
                style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: '11px 20px', borderRadius: 10, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDeleteUser} disabled={deleting || !deletePassword}
                style={{ flex: 2, fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '11px 20px', borderRadius: 10, border: 'none', background: deleting || !deletePassword ? T.border : T.red, color: 'white', cursor: deleting || !deletePassword ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Verifying & deleting…' : '🗑 Permanently delete user'}
              </button>
            </div>
          </div>
        </div>
      )}
  )
}
