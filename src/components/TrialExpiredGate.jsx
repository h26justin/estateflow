import { useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'

// ── TRIAL EXPIRED GATE ─────────────────────────────────────────────────
// Full-screen blocker that appears the moment a user signs in and any
// company THEY OWN has an expired trial AND is not on free tier AND
// has no active paid subscription. They can't dismiss it — they either
// pay (Stripe Checkout) or sign out.
//
// IMPORTANT — owner vs collaborator semantics:
//   * The gate ONLY considers companies the user OWNS (companies.owner_id
//     matches the user's auth.uid).
//   * Collaborators inherit access from the owner — if the owner is
//     paying, the collaborator gets in. If the owner's trial has expired
//     and they haven't paid, that's the OWNER's problem to fix; we don't
//     show the gate to the collaborator (they can't pay for someone
//     else's company anyway — the create-checkout edge function rejects
//     anyone who isn't the owner or an explicit billing admin).
//   * Expired collaborator companies still appear in the user's view —
//     they're just read-only (the owner's subscription decides what's
//     possible). That keeps the collaborator productive on their other
//     companies while reminding them to nudge the owner about billing.
//
// Why per-owned-company rather than per-user: an owner can own many
// companies. A single company being overdue shouldn't lock out their
// access to other companies — but it shouldn't be hidden either. So
// the gate lists ALL overdue OWNED companies and requires each to be
// paid. When the last overdue company is paid (or admin grants free
// tier), the gate disappears automatically on next data reload.
//
// Platform admins (Justin) bypass this gate entirely. Tenant-only
// users (no companies) also bypass.
//
// Decision tree per OWNED company:
//   1. is_free_tier=true                      → no gate (admin granted)
//   2. subscription.status='active'           → no gate (paying)
//   3. trial_ends_at > now                    → no gate (still in trial)
//   4. trial_ends_at <= now AND not paid/free → GATED  (the overdue case)

export function getOverdueCompanies({ companies = [], subs = [], userId = null }) {
  const now = Date.now()
  const subByCo = new Map(subs.map(s => [s.company_id, s]))
  return companies
    // Only consider companies the user OWNS. Collaborators can't pay
    // for someone else's company, so showing them a gate would just
    // lock them out of their other (paid) companies for no benefit.
    .filter(c => !userId || c.owner_id === userId)
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

export default function TrialExpiredGate({ companies, subs, properties = [], user, onSignOut }) {
  const { T } = useTheme()
  const [workingCoId, setWorkingCoId] = useState(null)
  // Inline error — toasts render under the z:9999 overlay so any failure
  // would otherwise look like "nothing happens" to the user. The most
  // common failure is the create-checkout edge function returning 400
  // because STRIPE_SECRET_KEY / STRIPE_PRICE_ID secrets aren't set.
  const [error, setError] = useState(null)

  // Derive property count per company from the actual properties list
  // we already have client-side. Previously we tried co.real_property_count
  // which is only populated by the admin-only fetchAllCompaniesAdmin.
  function propsFor(coId) {
    return properties.filter(p => p.company_id === coId).length
  }

  async function payNow(companyId) {
    setWorkingCoId(companyId)
    setError(null)
    try {
      const url = await api.createCheckoutSession(companyId, 'checkout')
      if (!url) throw new Error('Checkout returned no URL')
      window.location.href = url
    } catch (e) {
      console.error('TrialExpiredGate:payNow', e)
      setError(e?.message || 'Unknown error opening Stripe checkout')
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
            Your free trial has ended
          </div>
          <div style={{ fontFamily:MONO, fontSize:12, color:T.text, lineHeight:1.7 }}>
            To keep using OwnProperly, please add a payment method. Just <strong>£2 per
            property per month</strong> — no setup fees, cancel any time. Your data is
            safe; nothing is deleted while access is paused.
          </div>
        </div>

        {/* Inline error (toasts render under our overlay so we can't use those). */}
        {error && (
          <div style={{
            background:T.red+'11', border:`1px solid ${T.red}66`,
            borderRadius:10, padding:'12px 14px', marginBottom:14,
            fontFamily:MONO, fontSize:11, color:T.red, lineHeight:1.6,
          }}>
            <strong>Couldn't open Stripe checkout:</strong><br/>{error}
            <div style={{ marginTop:8, color:T.muted, fontSize:10 }}>
              Please email <a href="mailto:hello@ownproperly.com" style={{ color:T.gold }}>hello@ownproperly.com</a> and
              we'll get your subscription set up directly.
            </div>
          </div>
        )}

        {/* Per-company action list */}
        <div style={{ display:'grid', gap:10, marginBottom:18 }}>
          {companies.map(co => {
            // Property count derived from the loaded properties list,
            // not from any field on the company row (those are admin-only).
            const props = propsFor(co.id)
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
                  {isWorking ? 'Redirecting…' : 'Add payment'}
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
