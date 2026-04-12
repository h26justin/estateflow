import { useState } from 'react'
import * as api from '../lib/api'

const SLATE = '#2D3C4A'
const GOLD  = '#C8A84B'
const CREAM = '#F4F3EF'
const WHITE = '#FFFFFF'
const MUTED = '#6B7691'

const STEPS = [
  {
    icon: '🎉',
    title: 'Welcome to OwnProperly!',
    desc: "You're all set up. Let's take a quick tour so you get the most out of your portfolio dashboard.",
    tip: null,
    highlight: null,
  },
  {
    icon: '🏠',
    title: 'Add your first property',
    desc: 'Click the gold "+ New" button in the top right, then select "Add Property". Fill in the address, status, purchase price and current rent.',
    tip: 'Start with your most important property — you can add the rest anytime.',
    highlight: 'top-right',
  },
  {
    icon: '💰',
    title: 'Track rent payments',
    desc: 'Open any property and go to the Financials tab. You\'ll see a rent ledger for every month. Mark payments as paid, overdue or void.',
    tip: 'Arrears are automatically calculated and flagged on your dashboard.',
    highlight: 'financials',
  },
  {
    icon: '📋',
    title: 'Stay compliant',
    desc: 'The Compliance tab tracks your gas certificates, EPCs, electrical reports and more. Set expiry dates and you\'ll get email alerts before they lapse.',
    tip: 'Compliance alerts are sent automatically — no manual checking needed.',
    highlight: 'compliance',
  },
  {
    icon: '🔧',
    title: 'Log maintenance jobs',
    desc: 'Report repairs in the Maintenance tab. Track jobs from open to complete, assign contractors, and keep notes on what was done.',
    tip: 'All job history is saved permanently — useful for disputes and inspections.',
    highlight: 'maintenance',
  },
  {
    icon: '📊',
    title: 'Your portfolio dashboard',
    desc: 'The main dashboard shows your total invested, estimated value, monthly rent, equity and arrears across your entire portfolio at a glance.',
    tip: 'Use the company filter to drill into individual companies.',
    highlight: 'dashboard',
  },
  {
    icon: '👥',
    title: 'Invite your team',
    desc: 'Go to Settings → User Access to invite property managers, accountants or partners. Control exactly which companies they can see.',
    tip: 'Invited users get a branded email with a link to create their account.',
    highlight: 'settings',
  },
  {
    icon: '✅',
    title: "You're ready to go!",
    desc: 'That covers the essentials. Add your properties, set up compliance tracking and your dashboard will fill up quickly.',
    tip: null,
    highlight: null,
  },
]

export default function OnboardingTour({ user, onComplete }) {
  const [step, setStep]       = useState(0)
  const [saving, setSaving]   = useState(false)

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1
  const isFirst = step === 0
  const progress = ((step + 1) / STEPS.length) * 100

  async function finish() {
    setSaving(true)
    try {
      await api.markOnboardingComplete(user.id, user.email)
    } catch(e) {}
    onComplete()
  }

  async function skip() {
    setSaving(true)
    try {
      await api.markOnboardingComplete(user.id, user.email)
    } catch(e) {}
    onComplete()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      background: 'rgba(10,14,20,0.85)',
      backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: WHITE, borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
      }}>

        {/* Header */}
        <div style={{ background: SLATE, padding: '28px 32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <img src="/logo.svg" alt="OwnProperly" style={{ height: 32, width: 'auto' }}/>
            <button onClick={skip} disabled={saving} style={{
              background: 'none', border: 'none', color: '#7A8899',
              fontFamily: "'DM Mono',monospace", fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.05em',
            }}>Skip tour ✕</button>
          </div>

          {/* Progress bar */}
          <div style={{ background: '#ffffff22', borderRadius: 4, height: 4, marginBottom: 20 }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: GOLD,
              width: `${progress}%`,
              transition: 'width 0.4s ease',
            }}/>
          </div>

          {/* Step counter */}
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Step {step + 1} of {STEPS.length}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '32px 32px 28px' }}>
          <div style={{ fontSize: 44, marginBottom: 16, lineHeight: 1 }}>{current.icon}</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 12, letterSpacing: '-0.02em', fontFamily: 'Georgia, serif' }}>
            {current.title}
          </h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: MUTED, lineHeight: 1.8, marginBottom: current.tip ? 20 : 0 }}>
            {current.desc}
          </p>

          {current.tip && (
            <div style={{
              background: GOLD + '18',
              border: `1px solid ${GOLD}44`,
              borderRadius: 10, padding: '12px 16px',
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              color: '#7A5E1A', lineHeight: 1.7,
            }}>
              <span style={{ fontWeight: 700, color: GOLD }}>💡 Tip: </span>
              {current.tip}
            </div>
          )}
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingBottom: 4 }}>
          {STEPS.map((_, i) => (
            <div key={i} onClick={() => setStep(i)} style={{
              width: i === step ? 20 : 7, height: 7,
              borderRadius: 4, cursor: 'pointer',
              background: i === step ? GOLD : '#D8D4CE',
              transition: 'all 0.25s',
            }}/>
          ))}
        </div>

        {/* Footer buttons */}
        <div style={{ padding: '20px 32px 28px', display: 'flex', gap: 10 }}>
          {!isFirst && (
            <button onClick={() => setStep(s => s - 1)} style={{
              flex: 1, fontFamily: "'DM Mono',monospace", fontWeight: 600,
              fontSize: 13, padding: '13px 20px', borderRadius: 10,
              border: '1.5px solid #DDE1E5', background: 'transparent',
              color: SLATE, cursor: 'pointer',
            }}>← Back</button>
          )}
          <button
            onClick={isLast ? finish : () => setStep(s => s + 1)}
            disabled={saving}
            style={{
              flex: isFirst ? 1 : 2,
              fontFamily: "'DM Mono',monospace", fontWeight: 700,
              fontSize: 13, padding: '13px 20px', borderRadius: 10,
              border: 'none',
              background: isLast ? GOLD : SLATE,
              color: isLast ? SLATE : WHITE,
              cursor: 'pointer', transition: 'all 0.18s',
            }}>
            {saving ? 'Starting…' : isLast ? '🚀 Start using OwnProperly' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
