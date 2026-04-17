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
    desc: "Your entire property portfolio in one place. Let's take a quick tour of everything available to you — it'll only take a couple of minutes.",
    tip: null,
    tag: null,
  },
  {
    icon: '🏘',
    title: 'Add your properties',
    desc: "Hit the gold \"+ New\" button at the top right and select \"Add Property\". Add your address, status, purchase price, current value and monthly rent. Each property gets its own dashboard with health score, yield and equity.",
    tip: "Group properties under different companies — each company gets its own branding, reports and tenant portal subdomain.",
    tag: 'Portfolio',
  },
  {
    icon: '💰',
    title: 'Rent Tracker',
    desc: "The Rent Tracker shows every property's payment history as colour-coded month squares — green for paid, red for missed, amber for late. Click any square to see a day-by-day breakdown of exactly which days were covered, and hit the Day view button to see all properties at once.",
    tip: "Import your agent's monthly PDF statement directly — OwnProperly reads PNE and RMS formats and matches payments to properties automatically.",
    tag: 'Finance',
  },
  {
    icon: '📋',
    title: 'Compliance tracking',
    desc: "The Compliance tab on each property tracks gas certificates, EICRs, EPCs, HMO licences and more — with automatic alerts at 90, 60 and 30 days before expiry. Never miss a certificate renewal again.",
    tip: "The Right to Rent tab tracks document types and follow-up dates per tenant. You'll be alerted before time-limited permission expires.",
    tag: 'Compliance',
  },
  {
    icon: '⚖️',
    title: 'Legal & tenancy tools',
    desc: "Track deposit protection (scheme, certificate number, date) in the Deposit tab. Log Section 21 and Section 8 notices with served dates and court hearing dates in the Notices tab. Keep a full rent increase history in the Rent History tab.",
    tip: "All of these records are your evidence if a dispute ever reaches court or an adjudicator.",
    tag: 'Legal',
  },
  {
    icon: '👥',
    title: 'Tenant portal',
    desc: "Give every tenant their own branded portal at yourcompany.ownproperly.com. They can submit repair requests with photos, message you securely, view shared documents and see their payment history — all without your personal contact details.",
    tip: "Go to Settings → Tenant Portal to enable features and Settings → Branding to upload your logo and set your brand colour.",
    tag: 'Tenants',
  },
  {
    icon: '🔧',
    title: 'Maintenance & repairs',
    desc: "Log repair jobs in the Maintenance tab — assign contractors, track costs and mark jobs from open to complete. When a tenant submits a repair through the portal, it appears instantly in your Tenant Inbox with their description and photos.",
    tip: "All maintenance history is saved permanently — useful for inspections, disputes and understanding per-property costs.",
    tag: 'Maintenance',
  },
  {
    icon: '🎯',
    title: 'Deals & acquisitions',
    desc: "The Deals section has a full BTL/HMO/SA/BRRR calculator with correct April 2025 SDLT rates, Section 24 tax modelling and per-room HMO analysis. Track deals through a 6-stage pipeline from sourcing to completion.",
    tip: "Paste a Rightmove or Zoopla URL into the listing yield calculator and it'll pull the price and property type automatically.",
    tag: 'Deals',
  },
  {
    icon: '✨',
    title: 'AI listing writer',
    desc: "Head to Deals → Tools → AI listing writer. Enter your property details, choose your platform (Rightmove/Zoopla) and tone (professional, warm or luxury) and get a polished listing description in seconds.",
    tip: "The portfolio what-if modeller lets you drag sliders to model adding properties, changing yields and projecting income over 10 years.",
    tag: 'AI Tools',
  },
  {
    icon: '🏠',
    title: 'Lettings pipeline',
    desc: "The Lettings tab in Deals tracks every vacant property through 6 stages — Vacant → Advertising → Viewings → Referencing → Contract → Move-in. Each stage has a built-in checklist so nothing gets missed on the way to a new tenancy.",
    tip: "Days vacant is tracked automatically — you'll see a warning if a property has been empty for more than 14 days.",
    tag: 'Lettings',
  },
  {
    icon: '📊',
    title: '20 reports & analytics',
    desc: "The Reports section has 20 built-in reports — P&L per property, tax summaries, arrears, compliance status, occupancy rate, rent roll, yield rankings and more. Every report exports to CSV for your accountant.",
    tip: "The dashboard shows your total portfolio value, monthly income, equity and arrears at a glance — with filters by company.",
    tag: 'Reports',
  },
  {
    icon: '💬',
    title: 'Feedback & settings',
    desc: "Found something that's not working or have an idea for a new feature? Hit the Feedback tab — we read every message and it directly shapes what we build next. In Settings, customise your navigation, branding, notifications and team access.",
    tip: "OwnProperly is a PWA — add it to your home screen on iPhone or Android for a native app experience with no App Store needed.",
    tag: null,
  },
  {
    icon: '🚀',
    title: "You're ready to go!",
    desc: "Start by adding your properties, then set up compliance tracking and invite your tenants to their portal. Your dashboard will fill up fast and you'll have full visibility of your portfolio within minutes.",
    tip: null,
    tag: null,
  },
]

const TAG_COLORS = {
  Portfolio:   '#4B8FE0',
  Finance:     '#2ECC8A',
  Compliance:  '#E0943A',
  Legal:       '#E05555',
  Tenants:     '#9B59B6',
  Maintenance: '#4B8FE0',
  Deals:       '#C8A84B',
  'AI Tools':  '#C8A84B',
  Lettings:    '#2ECC8A',
  Reports:     '#4B8FE0',
}

export default function OnboardingTour({ user, onComplete }) {
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1
  const isFirst = step === 0
  const progress = ((step + 1) / STEPS.length) * 100
  const tagColor = current.tag ? TAG_COLORS[current.tag] || GOLD : null

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
      <div style={{
        width: '100%', maxWidth: 540,
        background: WHITE, borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
      }}>

        {/* Header */}
        <div style={{ background: SLATE, padding: '26px 32px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <img src="/logo.svg" alt="OwnProperly" style={{ height: 30, width: 'auto' }}/>
            <button onClick={skip} disabled={saving} style={{
              background: 'none', border: 'none', color: '#7A8899',
              fontFamily: "'DM Mono',monospace", fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.05em',
            }}>Skip tour ✕</button>
          </div>

          {/* Progress bar */}
          <div style={{ background: '#ffffff18', borderRadius: 4, height: 4, marginBottom: 16 }}>
            <div style={{
              height: '100%', borderRadius: 4, background: GOLD,
              width: `${progress}%`, transition: 'width 0.4s ease',
            }}/>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#7A8899', letterSpacing: '0.1em' }}>
              {step + 1} / {STEPS.length}
            </div>
            {current.tag && (
              <span style={{
                fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700,
                padding: '2px 10px', borderRadius: 20,
                background: (tagColor || GOLD) + '28', color: tagColor || GOLD,
                letterSpacing: '0.06em',
              }}>{current.tag}</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '28px 32px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 14, lineHeight: 1 }}>{current.icon}</div>
          <h2 style={{
            fontSize: 21, fontWeight: 700, color: SLATE,
            marginBottom: 12, letterSpacing: '-0.02em',
            fontFamily: 'Georgia, serif', lineHeight: 1.25,
          }}>
            {current.title}
          </h2>
          <p style={{
            fontFamily: "'DM Mono',monospace", fontSize: 12.5,
            color: MUTED, lineHeight: 1.85, marginBottom: current.tip ? 18 : 0,
          }}>
            {current.desc}
          </p>

          {current.tip && (
            <div style={{
              background: GOLD + '14', border: `1px solid ${GOLD}33`,
              borderRadius: 10, padding: '11px 15px',
              fontFamily: "'DM Mono',monospace", fontSize: 11.5,
              color: '#7A5E1A', lineHeight: 1.75,
            }}>
              <span style={{ fontWeight: 700, color: GOLD }}>💡 </span>
              {current.tip}
            </div>
          )}
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, paddingBottom: 2 }}>
          {STEPS.map((_, i) => (
            <div key={i} onClick={() => setStep(i)} style={{
              width: i === step ? 18 : 6, height: 6,
              borderRadius: 3, cursor: 'pointer',
              background: i === step ? GOLD : i < step ? GOLD + '55' : '#D8D4CE',
              transition: 'all 0.25s',
            }}/>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '18px 32px 28px', display: 'flex', gap: 10 }}>
          {!isFirst && (
            <button onClick={() => setStep(s => s - 1)} style={{
              flex: 1, fontFamily: "'DM Mono',monospace", fontWeight: 600,
              fontSize: 13, padding: '12px 20px', borderRadius: 10,
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
              fontSize: 13, padding: '12px 20px', borderRadius: 10,
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
