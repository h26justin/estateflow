import { useState } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import { Icon, ICON_NAMES } from '../lib/icons'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import FocusTrap from '../lib/FocusTrap'
import { ChromeLogo } from './Logo'
import { Button } from './ui'

const STEPS = [
  {
    icon: 'sparkle',
    title: 'Welcome to Properly',
    desc: "Your whole portfolio in one place. The dashboard shows total value, monthly income, equity and arrears at a glance. This quick tour takes under a minute.",
    tip: null,
    tag: null,
  },
  {
    icon: 'building',
    title: 'Your portfolio',
    desc: "Hit the gold \"+ New\" button to add a property. Each one gets its own dashboard with health score, yield, equity, documents and maintenance history.",
    tip: "Group properties under companies — each gets its own branding, reports and tenant portal subdomain.",
    tag: 'Portfolio',
  },
  {
    icon: 'wallet',
    title: 'Rent tracking',
    desc: "The Rent Tracker colour-codes every month — green paid, red missed, amber late. Click any square for a day-by-day breakdown, or import your agent's PDF statement.",
    tip: "Reports has 16 exports for your accountant — P&L, arrears, rent roll, tax summaries and more.",
    tag: 'Finance',
  },
  {
    icon: 'shield-check',
    title: 'Compliance & alerts',
    desc: "Track gas certificates, EICRs, EPCs, licences, deposits and notices per property — with staged alerts at 90, 60, 30 and 7 days before anything expires (you choose how early each one starts).",
    tip: "Deposit, notice and rent-increase records double as your evidence if a dispute ever reaches court.",
    tag: 'Compliance',
  },
  {
    icon: 'users',
    title: 'Tenant portal',
    desc: "Give tenants a branded portal — repair requests with photos, secure messaging, documents and payment history. Requests land straight in your Tenant Inbox.",
    tip: "Enable it in Settings → Tenant Portal, and set your logo and colours in Settings → Branding.",
    tag: 'Tenants',
  },
  {
    icon: 'message',
    title: 'Need a hand?',
    desc: "Explore Deals, Lettings and Reports when you're ready. Ideas or issues? The Feedback tab comes straight to us and shapes what we build next.",
    tip: "Properly is a PWA — add it to your home screen for a native app feel, no App Store needed.",
    tag: null,
  },
]

export default function OnboardingTour({ user, onComplete }) {
  const { T } = useTheme()
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)

  const TAG_COLORS = {
    Portfolio:  T.blue,
    Finance:    T.green,
    Compliance: T.amber,
    Tenants:    T.purple,
  }

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1
  const isFirst = step === 0
  const progress = ((step + 1) / STEPS.length) * 100
  const tagColor = current.tag ? TAG_COLORS[current.tag] || T.gold : null

  async function finish() {
    setSaving(true)
    try { await api.markOnboardingComplete(user.id, user.email) } catch(e) {}
    onComplete()
  }

  async function skip() {
    setSaving(true)
    try { await api.markOnboardingComplete(user.id, user.email) } catch(e) {}
    onComplete()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      background: 'rgba(10,14,20,0.88)',
      backdropFilter: 'blur(4px)',
    }}>
      <FocusTrap onEscape={skip}>
        <div role="dialog" aria-modal="true" aria-labelledby="tour-step-title" style={{
          width: '100%', maxWidth: 540,
          maxHeight: '88vh', overflowY: 'auto', overflowX: 'hidden',
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 24,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}>

          {/* Header */}
          <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: '26px 32px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <ChromeLogo height={26}/>
              <button onClick={skip} disabled={saving} style={{
                background: 'none', border: 'none', color: T.muted,
                fontFamily: SANS, fontSize: FS.sm, cursor: 'pointer',
                minHeight: 32, padding: '6px 8px', marginRight: -8,
              }}>Skip tour ✕</button>
            </div>

            {/* Progress bar */}
            <div style={{ background: T.border, borderRadius: 4, height: 4, marginBottom: 16 }}>
              <div style={{
                height: '100%', borderRadius: 4, background: T.gold,
                width: `${progress}%`, transition: 'width 0.4s ease',
              }}/>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted, letterSpacing: '0.1em' }}>
                {step + 1} / {STEPS.length}
              </div>
              {current.tag && (
                <span style={{
                  fontFamily: MONO, fontSize: FS.xs, fontWeight: 700,
                  padding: '2px 10px', borderRadius: 20,
                  background: (tagColor || T.gold) + '28', color: tagColor || T.goldText,
                  letterSpacing: '0.06em',
                }}>{current.tag}</span>
              )}
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: '28px 32px 24px' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 14 }}>{ICON_NAMES.includes(current.icon)?<Icon name={current.icon} size={38}/>:current.icon}</div>
            <h2 id="tour-step-title" style={{
              fontSize: 21, fontWeight: 700, color: T.text,
              marginBottom: 12, letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}>
              {current.title}
            </h2>
            <p style={{
              fontFamily: SANS, fontSize: FS.base,
              color: T.muted, lineHeight: 1.85, marginBottom: current.tip ? 18 : 0,
            }}>
              {current.desc}
            </p>

            {current.tip && (
              <div style={{
                background: T.gold + '14', border: `1px solid ${T.gold}33`,
                borderRadius: 10, padding: '11px 15px',
                fontFamily: SANS, fontSize: FS.sm,
                color: T.text, lineHeight: 1.75,
              }}>
                <Icon name="sparkle" size={13} color={T.goldText} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }}/>
                {current.tip}
              </div>
            )}
          </div>

          {/* Step dots */}
          {/* Each dot is a 24px hit area (WCAG 2.5.8) around the small visual pip. */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 0, paddingBottom: 2 }}>
            {STEPS.map((_, i) => (
              <button key={i} type="button" onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1} of ${STEPS.length}`} aria-current={i === step ? 'step' : undefined}
                style={{
                  minWidth: 24, height: 24, padding: '0 2px', border: 'none', background: 'none',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <span aria-hidden="true" style={{
                  display: 'block', width: i === step ? 18 : 6, height: 6, borderRadius: 3,
                  background: i === step ? T.gold : i < step ? T.gold + '55' : T.border,
                  transition: 'all 0.25s',
                }}/>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '18px 32px 28px', display: 'flex', gap: 10 }}>
            {!isFirst && (
              <Button variant="secondary" size="lg" style={{ flex: 1 }} onClick={() => setStep(s => s - 1)}>← Back</Button>
            )}
            <Button size="lg" style={{ flex: isFirst ? 1 : 2 }}
              onClick={isLast ? finish : () => setStep(s => s + 1)}
              disabled={saving}>
              {saving ? 'Starting…' : isLast ? 'Start using Properly' : 'Next →'}
            </Button>
          </div>
        </div>
      </FocusTrap>
    </div>
  )
}
