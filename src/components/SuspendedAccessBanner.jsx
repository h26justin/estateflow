// SuspendedAccessBanner — full-screen view shown to a collaborator when
// ALL of their accessible companies have been hidden due to suspended
// billing (account owner stopped paying / trial expired with no Stripe
// sub / no admin free-tier grant).
//
// Why this exists: the previous behaviour was to drop the user on the
// onboarding wizard ("Add your first company") because companies.length
// was 0. That's misleading — they're not a new user, they're a
// collaborator who had access yesterday and lost it overnight when
// their account owner missed a payment.
//
// This banner:
//   1. Names the suspended companies so the user knows exactly which
//      ones to chase up.
//   2. Identifies the account owner so they know who to contact.
//   3. Offers a "Sign out" escape hatch.
//
// Collaborator can't pay for someone else's company (the create-checkout
// edge function rejects non-owners) — so we deliberately don't show any
// "Add payment" button here. The only action that fixes this is the
// account owner signing in and paying. They get the trial-expired gate
// on their own session, which is the right place for the action.

import { MONO } from '../lib/styles'
import { ChromeLogo } from './Logo'

export default function SuspendedAccessBanner({ suspended = [], user, T, onSignOut }) {
  // Group suspended companies by account-owner email so we can list
  // them under each owner. Most collaborators only have one owner, but
  // an accountant managing multiple landlords could have several.
  const byOwner = {}
  for (const co of suspended) {
    const ownerEmail = co.owner_email || 'your account owner'
    if (!byOwner[ownerEmail]) byOwner[ownerEmail] = []
    byOwner[ownerEmail].push(co)
  }
  const ownerEntries = Object.entries(byOwner)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: T.bg, overflow: 'auto',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 580, width: '100%' }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <ChromeLogo height={30} style={{ display: 'inline-block' }}/>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginTop: 4 }}>
            Account paused
          </div>
        </div>

        {/* Headline */}
        <div style={{
          background: T.amber + '11', border: `1px solid ${T.amber}44`,
          borderRadius: 14, padding: '24px 26px', marginBottom: 18,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
            Your access has been paused
          </div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: T.text, lineHeight: 1.7 }}>
            You're a collaborator on {suspended.length === 1 ? 'a company' : `${suspended.length} companies`}{' '}
            whose subscription{suspended.length === 1 ? ' is' : 's are'} not currently active. Access will return
            automatically once the account owner updates their billing — no action needed on your end.
          </div>
        </div>

        {/* Per-owner breakdown */}
        <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
          {ownerEntries.map(([ownerEmail, cos]) => (
            <div key={ownerEmail} style={{
              background: T.card, border: `1px solid ${T.border}`,
              borderRadius: 12, padding: '18px 20px',
            }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Account owner
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4, wordBreak: 'break-word' }}>
                {ownerEmail}
              </div>
              {ownerEmail !== 'your account owner' && (
                <a
                  href={`mailto:${ownerEmail}?subject=${encodeURIComponent('Properly subscription needs updating')}&body=${encodeURIComponent(`Hi,\n\nMy Properly access to ${cos.map(c => c.name).join(', ')} has been paused. Could you update the subscription so I can get back in?\n\nThanks`)}`}
                  style={{
                    display: 'inline-block', marginTop: 2,
                    fontFamily: MONO, fontSize: 11, color: T.gold,
                    textDecoration: 'underline',
                  }}>
                  Email them
                </a>
              )}

              <div style={{ borderTop: `1px solid ${T.border}`, margin: '14px 0' }}/>

              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Paused {cos.length === 1 ? 'company' : 'companies'}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {cos.map(co => (
                  <div key={co.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: T.bg,
                    border: `1px solid ${T.border}`, borderRadius: 8,
                  }}>
                    {co.abbr && (
                      <span style={{
                        fontFamily: MONO, fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 4,
                        background: (co.color || T.gold) + '22',
                        color: co.color || T.gold,
                      }}>{co.abbr}</span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      {co.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Reassurance + footer */}
        <div style={{
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: '16px 18px', marginBottom: 18,
          fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.7,
        }}>
          <strong style={{ color: T.text }}>Your data is safe.</strong> Nothing is deleted while
          access is paused. As soon as the account owner re-subscribes, all your data,
          documents and history will be exactly where you left them.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.6 }}>
            Signed in as <strong style={{ color: T.text }}>{user?.email}</strong>
            <br/>
            Questions? Email <a href="mailto:hello@ownproperly.com" style={{ color: T.gold }}>hello@ownproperly.com</a>
          </div>
          <button onClick={onSignOut}
            style={{
              fontFamily: MONO, fontSize: 11, padding: '8px 16px',
              borderRadius: 8, border: `1px solid ${T.border}`,
              background: 'transparent', color: T.muted, cursor: 'pointer',
            }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
