import { useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// ── TRIAL EXPIRED GATE ─────────────────────────────────────────────────
// Full-screen blocker that appears the moment a user signs in and any
// company they own/access has an expired trial AND is not on free tier
// AND has no active paid subscription. They can't dismiss it — they
// either pay (Stripe Checkout) or sign out.
//
// Why per-company rather than per-user: a user can be invited to many
// companies. A single company being overdue shouldn't lock out their
// access to other companies — but it shouldn't be hidden either. So
// the gate lists ALL overdue companies and requires each to be paid.
// When the last overdue company is paid (or admin grants free tier),
// the gate disappears automatically on next data reload.
//
// Platform admins (Justin) bypass this gate entirely. Tenant-only
// users (no companies) also bypass.
//
// Decision tree per company:
//   1. is_free_tier=true                      → no gate (admin granted)
//   2. subscription.status='active'           → no gate (paying)
//   3. trial_ends_at > now                    → no gate (still in trial)
//   4. trial_ends_at <= now AND not paid/free → GATED  (the overdue case)

export function getOverdueCompanies({ companies = [], subs = [] }) {
  const now = Date.now()
  const subByCo = new Map(subs.map(s => [s.company_id, s]))
  return companies
    .filter(c => !c.is_free_tier)
    .filter(c => {
      const sub = subByCo.get(c.id)
      if (sub && (sub.status === 'active' || sub.status === 'past_due')) {
        // 'active' = paying, no gate. 'past_due' = was paying, gate
        // them so they fix payment.
        return sub.status === 'past_due'
      }
      // No sub or trialing — gate when trial has expired.
      const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : 0
      return trialEnd > 0 && trialEnd <= now
    })
}

export default function TrialExpiredGate({ companies, subs, user, onSignOut }) {
  const { T } = useTheme()
  const [workingCoId, setWorkingCoId] = useState(null)

  async function payNow(companyId) {
    setWorkingCoId(companyId)
    try {
      const url = await api.createCheckoutSession(companyId, 'checkout')
      window.location.href = url
    } catch (e) {
      showAppToast('Could not open checkout: ' + (e?.message || 'unknown'), 'error')
      setWorkingCoId(null)
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:T.bg, overflow:'auto',
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'40px 20px',
    }}>
      <div style={{ maxWidth:560, width:'100%' }}>
        {/* Brand strip */}
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:28, fontWeight:700, letterSpacing:'-0.03em', color:T.text }}>OwnProperly</div>
          <div style={{ fontFamily:MONO, fontSize:11, color:T.muted, marginTop:4 }}>Account access paused</div>
        </div>

        {/* Headline card */}
        <div style={{
          background:T.amber+'11', border:`1px solid ${T.amber}44`,
          borderRadius:14, padding:'24px 26px', marginBottom:18,
        }}>
          <div style={{ fontSize:18, fontWeight:700, color:T.text, marginBottom:8 }}>
            ⏰ Your free trial has ended
          </div>
          <div style={{ fontFamily:MONO, fontSize:12, color:T.text, lineHeight:1.7 }}>
            To keep using OwnProperly, please add a payment method. Just <strong>£2 per
            property per month</strong> — no setup fees, cancel any time. Your data is
            safe; nothing is deleted while access is paused.
          </div>
        </div>

        {/* Per-company action list */}
        <div style={{ display:'grid', gap:10, marginBottom:18 }}>
          {companies.map(co => {
            const props = co.real_property_count || co.property_count || 0
            const monthly = props * 2
            const isWorking = workingCoId === co.id
            return (
              <div key={co.id} style={{
                background:T.card, border:`1px solid ${T.border}`,
                borderRadius:12, padding:'16px 18px',
                display:'flex', alignItems:'center', justifyContent:'space-between',
                gap:14, flexWrap:'wrap',
              }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                    {co.abbr && (
                      <span style={{
                        fontFamily:MONO, fontSize:10, fontWeight:700,
                        padding:'2px 8px', borderRadius:4,
                        background:(co.color||T.gold)+'22', color:co.color||T.gold,
                      }}>{co.abbr}</span>
                    )}
                    <span style={{ fontSize:14, fontWeight:700, color:T.text }}>{co.name}</span>
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:10, color:T.muted }}>
                    {props} {props===1?'property':'properties'} · £{monthly}/month
                  </div>
                </div>
                <button onClick={()=>payNow(co.id)} disabled={!!workingCoId}
                  className="btn btn-gold"
                  style={{ fontSize:12, whiteSpace:'nowrap' }}>
                  {isWorking ? 'Redirecting…' : '💳 Add payment'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer — sign out + support */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginTop:24 }}>
          <div style={{ fontFamily:MONO, fontSize:10, color:T.muted, lineHeight:1.6 }}>
            Need help? Email <a href="mailto:hello@ownproperly.com" style={{ color:T.gold }}>hello@ownproperly.com</a>
          </div>
          <button onClick={onSignOut}
            style={{
              fontFamily:MONO, fontSize:11, padding:'7px 14px',
              borderRadius:8, border:`1px solid ${T.border}`,
              background:'transparent', color:T.muted, cursor:'pointer',
            }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
