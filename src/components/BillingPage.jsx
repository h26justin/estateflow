import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'

export default function BillingPage({ companies, user, isPlatformAdmin }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  const [subs, setSubs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [working, setWorking]   = useState(null)
  // Platform admin state
  const [allCompanies, setAllCompanies] = useState([])
  const [adminTab, setAdminTab] = useState(() => isPlatformAdmin ? 'admin' : 'billing')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const data = await api.fetchSubscriptions(companies.map(c => c.id))
      setSubs(data)
      if (isPlatformAdmin) {
        const all = await api.fetchAllCompaniesAdmin()
        setAllCompanies(all)
      }
    } catch(e) {}
    setLoading(false)
  }

  async function handleCheckout(companyId, action = 'checkout') {
    setWorking(companyId)
    try {
      const url = await api.createCheckoutSession(companyId, action)
      window.location.href = url
    } catch(e) {
      alert('Billing error: ' + e.message)
    }
    setWorking(null)
  }

  async function toggleFreeTier(companyId, current) {
    try {
      await api.setCompanyFreeTier(companyId, !current, user.id)
      await loadData()
    } catch(e) { alert(e.message) }
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 26px', marginBottom: 16 }
  const label = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, display: 'block' }

  function StatusBadge({ status }) {
    const cfg = {
      active:    { bg: T.green+'22', color: T.green,  label: 'Active' },
      trialing:  { bg: T.blue+'22',  color: T.blue,   label: 'Free Trial' },
      past_due:  { bg: T.amber+'22', color: T.amber,  label: 'Payment due' },
      canceled:  { bg: T.red+'22',   color: T.red,    label: 'Cancelled' },
      free_tier: { bg: T.gold+'22',  color: T.gold,   label: 'Free tier' },
    }[status] || { bg: T.border, color: T.muted, label: status }
    return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>Loading billing…</div>

  return (
    <div style={{ maxWidth: 720 }}>

      {/* Platform admin tabs */}
      {isPlatformAdmin && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
          {[['billing','💳 My Billing'],['admin','⚙ Admin: All Accounts']].map(([k,l]) => (
            <button key={k} onClick={()=>setAdminTab(k)} style={{
              fontFamily: mono, fontSize: 11, padding: '8px 16px', borderRadius: '8px 8px 0 0',
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: adminTab===k ? T.gold+'22' : 'transparent',
              color: adminTab===k ? T.gold : T.muted, fontWeight: adminTab===k ? 600 : 400,
            }}>{l}</button>
          ))}
        </div>
      )}

      {/* ── MY BILLING ── */}
      {adminTab === 'billing' && (
        <>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            Your subscriptions
          </div>

          {companies.map(co => {
            const sub = subs.find(s => s.company_id === co.id)
            const status = co.is_free_tier ? 'free_tier' : (sub?.status || 'trialing')
            const propCount = sub?.property_count || 0
            const monthly = propCount * 1
            const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
            const trialEnd = co.trial_ends_at ? new Date(co.trial_ends_at) : null
            const trialDaysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - new Date()) / (1000*60*60*24))) : 0

            return (
              <div key={co.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: (co.color||'#C8A84B')+'22', color: co.color||'#C8A84B', border: `1px solid ${(co.color||'#C8A84B')}44` }}>{co.abbr}</span>
                      <span style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{co.name}</span>
                    </div>
                    <StatusBadge status={status}/>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {status !== 'free_tier' && (
                      <>
                        <div style={{ fontSize: 24, fontWeight: 700, color: T.gold, letterSpacing: '-0.02em' }}>£{monthly}<span style={{ fontSize: 13, color: T.muted, fontFamily: mono }}>/mo</span></div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{propCount} {propCount===1?'property':'properties'} × £1</div>
                      </>
                    )}
                    {status === 'free_tier' && <div style={{ fontFamily: mono, fontSize: 13, color: T.gold, fontWeight: 700 }}>Free tier ✓</div>}
                  </div>
                </div>

                {/* Trial warning */}
                {status === 'trialing' && trialDaysLeft <= 7 && trialDaysLeft > 0 && (
                  <div style={{ background: T.amber+'22', border: `1px solid ${T.amber}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontFamily: mono, fontSize: 11, color: T.amber }}>
                    ⚠ Trial ends in {trialDaysLeft} day{trialDaysLeft!==1?'s':''}. Add a payment method to keep access.
                  </div>
                )}
                {status === 'past_due' && (
                  <div style={{ background: T.red+'22', border: `1px solid ${T.red}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontFamily: mono, fontSize: 11, color: T.red }}>
                    ⚠ Payment failed. Update your payment method to restore full access.
                  </div>
                )}

                {periodEnd && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 14 }}>Next billing date: {periodEnd}</div>}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(status === 'trialing' || status === 'past_due') && (
                    <button className="btn btn-gold" style={{ fontSize: 12 }}
                      onClick={() => handleCheckout(co.id, 'checkout')}
                      disabled={!!working}>
                      {working===co.id ? 'Redirecting…' : '💳 Add payment method'}
                    </button>
                  )}
                  {status === 'active' && (
                    <button className="btn btn-ghost" style={{ fontSize: 12 }}
                      onClick={() => handleCheckout(co.id, 'portal')}
                      disabled={!!working}>
                      {working===co.id ? 'Redirecting…' : 'Manage subscription'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* ── ADMIN: ALL ACCOUNTS ── */}
      {adminTab === 'admin' && isPlatformAdmin && (
        <>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            All customer accounts — {allCompanies.length} companies
          </div>
          <div style={{ background: T.amber+'22', border: `1px solid ${T.amber}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontFamily: mono, fontSize: 11, color: T.amber }}>
            Toggle free tier to exempt any company from billing permanently.
          </div>
          {allCompanies.map(co => (
            <div key={co.id} style={{ ...card, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: (co.color||'#C8A84B')+'22', color: co.color||'#C8A84B' }}>{co.abbr}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{co.name}</span>
                    {co.is_free_tier && <span style={{ fontFamily: mono, fontSize: 10, background: T.gold+'22', color: T.gold, padding: '2px 8px', borderRadius: 10 }}>FREE TIER</span>}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                    Owner: {co.owner_email || co.owner_id?.slice(0,8)}
                    {co.free_tier_reason && <span style={{ marginLeft: 10, color: T.gold }}>· {co.free_tier_reason}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{co.is_free_tier ? 'Free' : 'Paid'}</span>
                  <div onClick={() => toggleFreeTier(co.id, co.is_free_tier)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: co.is_free_tier ? T.gold : T.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: 3, left: co.is_free_tier ? 21 : 3, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
