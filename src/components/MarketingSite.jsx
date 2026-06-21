import { useState } from 'react'
import { SANS } from '../lib/styles'
import { Icon } from '../lib/icons'

// Redesign palette (design/redesign-2026). SLATE = ink/text + dark brand panels.
const SLATE  = '#1C2830'
const GOLD   = '#B8902F'
const CREAM  = '#F4F3EF'
const WHITE  = '#FFFFFF'
const MUTED  = '#5C6670'
const BORDER = '#E4E1D9'
const DARK   = '#14202A'

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  html{scroll-behavior:smooth;}
  body{-webkit-font-smoothing:antialiased;}
  .mkt-btn-gold{background:${GOLD};color:${DARK};font-family:${SANS};font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;letter-spacing:0.02em;text-decoration:none;display:inline-block;}
  .mkt-btn-gold:hover{background:#B8942A;transform:translateY(-1px);box-shadow:0 4px 16px rgba(200,168,75,0.3);}
  .mkt-btn-ghost{background:transparent;color:${SLATE};font-family:${SANS};font-weight:600;font-size:13px;padding:13px 28px;border-radius:10px;border:1.5px solid ${BORDER};cursor:pointer;transition:all 0.18s;text-decoration:none;display:inline-block;}
  .mkt-btn-ghost:hover{border-color:${SLATE};background:${SLATE};color:white;}
  .mkt-btn-white{background:white;color:${SLATE};font-family:${SANS};font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;}
  .mkt-btn-white:hover{background:${CREAM};}
  .feat-card{background:${CREAM};border:1px solid ${BORDER};border-radius:14px;padding:26px 26px;transition:border-color 0.18s,transform 0.18s,box-shadow 0.18s;}
  .feat-card:hover{border-color:${GOLD}88;transform:translateY(-3px);box-shadow:0 8px 28px rgba(0,0,0,0.07);}
  @media(max-width:768px){
    .mkt-hero-btns{flex-direction:column!important;align-items:stretch!important;}
    .mkt-hero-btns a,.mkt-hero-btns button{text-align:center!important;}
    .feat-grid-3{grid-template-columns:1fr!important;}
    .feat-grid-2{grid-template-columns:1fr!important;}
    .steps-grid{grid-template-columns:1fr!important;}
    .stats-grid{grid-template-columns:1fr 1fr!important;}
    .pricing-grid{grid-template-columns:1fr!important;}
    h1{font-size:34px!important;}
    h2{font-size:26px!important;}
    .hero-sub{font-size:15px!important;}
    .hide-mobile{display:none!important;}
    .nav-btns{gap:8px!important;}
    .nav-btns button{padding:7px 12px!important;font-size:11px!important;}
  }
`

const FEATURE_CATS = [
  {
    cat: 'Portfolio Management',
    icon: 'building',
    color: '#4B8FE0',
    features: [
      { icon: 'building', title: 'Multi-company portfolios', desc: 'Organise properties under separate companies or trading names. Each gets its own branding, settings and access controls.' },
      { icon: 'pie-chart', title: 'Property health scores', desc: 'Every property gets an automatic health score based on compliance, occupancy, rent and maintenance — so you see issues instantly.' },
      { icon: 'trending-up', title: 'Yield & equity tracking', desc: 'Live gross and net yields per property. Track current value, equity and portfolio-wide financials at a glance.' },
      { icon: 'trash', title: '30-day trash recovery', desc: 'Accidentally deleted something? Soft-delete keeps everything recoverable for 30 days before permanent removal.' },
    ]
  },
  {
    cat: 'Rent & Finance',
    icon: 'wallet',
    color: '#2ECC8A',
    features: [
      { icon: 'calendar', title: 'Visual rent tracker', desc: 'Month-by-month payment squares for every tenancy. Paid, missed, late, void and refurb — colour-coded and clickable to update.' },
      { icon: 'download', title: 'Statement importer', desc: 'Import bank statements in CSV, PNE or RMS format to match and reconcile rent payments automatically.' },
      { icon: 'trending-up', title: 'Rent increase timeline', desc: 'Log every rent review with date and amount. See the full history of increases per property at a glance.' },
      { icon: 'alert-triangle', title: 'Arrears alerts', desc: 'Smart alerts flag missed and late payments immediately. Daily digest emails ensure nothing slips through.' },
    ]
  },
  {
    cat: 'Compliance & Legal',
    icon: 'shield-check',
    color: '#E0943A',
    features: [
      { icon: 'flame', title: 'Certificate tracking', desc: 'Gas safety, EICR, EPC, HMO licences — every certificate with expiry date, automatic alerts at 90, 60 and 30 days.' },
      { icon: 'id-card', title: 'Right to Rent checks', desc: 'Log document type, check date and expiry for every tenant. Follow-up alerts ensure you stay legally compliant.' },
      { icon: 'landmark', title: 'Deposit protection', desc: 'Track which scheme protects each deposit (DPS, TDS, mydeposits), dates and certificate numbers.' },
      { icon: 'scale', title: 'Section 21 & S8 notices', desc: 'Log served notices with dates, grounds and court hearing dates. Full notice history per tenancy.' },
    ]
  },
  {
    cat: 'Tenant Portal',
    icon: 'users',
    color: '#9B59B6',
    features: [
      { icon: 'globe', title: 'Branded subdomains', desc: 'Each company gets its own portal at yourname.ownproperly.com — branded with your colours and logo.' },
      { icon: 'wrench', title: 'Repair requests', desc: 'Tenants submit repairs with photos directly. You get an instant email alert and it logs in your maintenance tracker.' },
      { icon: 'message', title: 'Secure messaging', desc: 'Private message threads between landlord and tenant. No WhatsApp, no personal emails — everything in one auditable place.' },
      { icon: 'mail', title: 'Branded email invites', desc: 'Invite tenants to their portal with a fully branded email. They set their own password and are in immediately.' },
    ]
  },
  {
    cat: 'Deals & Acquisitions',
    icon: 'target',
    color: '#C8A84B',
    features: [
      { icon: 'calculator', title: 'BTL/HMO/SA/BRRR calculator', desc: 'Full acquisition calculator with correct April 2025 SDLT rates, conveyancing costs, agent fees and Section 24 tax modelling.' },
      { icon: 'target', title: 'Deal pipeline', desc: '6-stage Kanban board to track every deal from sourcing to completion. Milestones, contacts and documents per deal.' },
      { icon: 'sparkle', title: 'AI listing writer', desc: 'Generate professional Rightmove and Zoopla listing descriptions in seconds. Choose tone: professional, warm or luxury.' },
      { icon: 'trending-up', title: 'Portfolio modeller', desc: 'What-if modeller with 5 sliders — add properties, change yields, model refinancing — and see your portfolio projections live.' },
    ]
  },
  {
    cat: 'Reports & Data',
    icon: 'pie-chart',
    color: '#E05555',
    features: [
      { icon: 'file-text', title: '16 built-in reports', desc: 'P&L, tax summaries, arrears, compliance status, occupancy, rent roll, expenses and more — all exportable to CSV.' },
      { icon: 'lock', title: 'GDPR audit log', desc: 'Every action in the platform is logged — who did what and when. Full data export for any tenant or company on request.' },
      { icon: 'folder', title: 'Document storage', desc: 'Upload leases, certificates and correspondence per property. Share documents directly with tenants via the portal.' },
      { icon: 'bell', title: 'Smart alert engine', desc: 'Configurable alerts for arrears, expiring leases, compliance deadlines and vacant properties. Weekly digest or instant.' },
    ]
  },
]

const steps = [
  { n: '1', title: 'Create your account', desc: 'Sign up free. No credit card needed. Set up your first company and add properties in under 5 minutes.' },
  { n: '2', title: 'Import your portfolio', desc: 'Add properties one by one, invite tenants to their portal and connect your bank statement exports.' },
  { n: '3', title: 'Run your portfolio', desc: 'Track rent, stay compliant, manage repairs and generate reports — everything from one clean dashboard.' },
]

export default function MarketingSite({ onSignIn, onSignUp, onPrivacy }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('home')

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setActiveNav(id)
    setMobileMenuOpen(false)
  }

  return (
    <div style={{ fontFamily: SANS, color: SLATE, background: CREAM, minHeight: '100vh', overflowX: 'hidden' }}>
      <style>{CSS}</style>

      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(244,243,239,0.96)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${BORDER}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 116 }}>
          <img src="/logo.svg" alt="OwnProperly" style={{ height: 100, width: 'auto' }}/>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <div className="hide-mobile" style={{ display: 'flex', gap: 24 }}>
              {[['home','Home'],['features','Features'],['pricing','Pricing']].map(([id,label]) => (
                <button key={id} onClick={()=>scrollTo(id)}
                  style={{ background: 'none', border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 12, color: activeNav===id ? SLATE : MUTED, cursor: 'pointer', fontWeight: activeNav===id ? 600 : 400, transition: 'color 0.15s' }}>
                  {label}
                </button>
              ))}
              <a href="/blog/" style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, textDecoration: 'none' }}>Guides</a>
            </div>
            <div className="nav-btns" style={{ display: 'flex', gap: 10 }}>
              <button onClick={onSignIn} className="mkt-btn-ghost" style={{ padding: '8px 18px', fontSize: 12 }}>Sign in</button>
              <button onClick={onSignUp} className="mkt-btn-gold" style={{ padding: '8px 18px', fontSize: 12 }}>Start free trial</button>
            </div>
          </div>
        </div>
      </nav>

      <section id="home" style={{ background: `linear-gradient(160deg, ${DARK} 0%, ${SLATE} 100%)`, padding: '100px 24px 120px', textAlign: 'center' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: GOLD + '22', border: `1px solid ${GOLD}44`, borderRadius: 20, padding: '5px 16px', fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 28 }}>
            Built this decade · UK landlords
          </div>
          <h1 style={{ fontSize: 54, fontWeight: 600, color: WHITE, lineHeight: 1.13, letterSpacing: '-0.025em', marginBottom: 24 }}>
            Property software that<br/>doesn't feel like 2010
          </h1>
          <p className="hero-sub" style={{ fontSize: 19, color: '#B0BEC5', lineHeight: 1.75, marginBottom: 40, fontFamily: "'DM Mono',monospace", fontWeight: 400, maxWidth: 680, margin: '0 auto 40px' }}>
            Run your entire UK rental portfolio from one dashboard. Rent, compliance, tenant portal, reports and more from £2 per property a month (£10/mo minimum) — AI insights and the deals pipeline on the £5 Investor plan.
          </p>
          <div className="mkt-hero-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={()=>scrollTo('features')} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff44', fontSize: 14, padding: '16px 36px' }}>See all features</button>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#6A7D8E', marginTop: 20 }}>14-day free trial · Cancel anytime · No per-user fees, ever</p>
        </div>
      </section>

      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '28px 24px' }}>
        <div className="stats-grid" style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, textAlign: 'center' }}>
          {[['From £2/mo','per property · £10/mo min'],['0','per-user fees'],['2 plans','Starter & Investor'],['14 days','free, no card']].map(([val,lab]) => (
            <div key={val}>
              <div style={{ fontSize: 22, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', fontFamily: "'DM Mono',monospace" }}>{val}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lab}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding: '88px 24px 72px', background: WHITE }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Why OwnProperly</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>The landlord tool you'd actually choose</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 580, margin: '0 auto' }}>
              Most property software was built before the iPhone. Ours wasn't. Here's what that means in practice.
            </p>
          </div>
          <div className="feat-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              {
                icon: 'zap',
                title: 'Built for 2026, not 2010',
                desc: "Clean modern UI, dark mode, keyboard-friendly, works on every device. Feels like the apps you actually use — not the ones your accountant forces on you.",
                tag: 'Modern'
              },
              {
                icon: 'target',
                title: 'Honest, simple pricing',
                desc: "No add-on for tenants. No charge per user. Starter is £2 a property for the full landlord toolkit; Investor is £5 a property and adds AI insights and the deals pipeline. £10/month minimum on both. Add or remove properties anytime.",
                tag: 'Honest'
              },
              {
                icon: 'robot',
                title: 'AI that does the busywork',
                desc: "Our AI writes your Rightmove listings, extracts data from your gas certs and EICRs, and pre-fills your tenancy agreements. While other tools are 'considering it for 2027'.",
                tag: 'Smart'
              },
            ].map(c => (
              <div key={c.title} style={{ background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '28px 26px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: GOLD + '18', border: `1px solid ${GOLD}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={c.icon} size={22} color={GOLD}/></div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: GOLD, background: GOLD + '14', border: `1px solid ${GOLD}33`, borderRadius: 4, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{c.tag}</span>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: SLATE, marginBottom: 10, lineHeight: 1.3 }}>{c.title}</h3>
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, lineHeight: 1.8 }}>{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '72px 24px 88px', background: CREAM }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Up and running in minutes</h2>
          </div>
          <div className="steps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
            {steps.map(s => (
              <div key={s.n} style={{ textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 26, background: SLATE, color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700, margin: '0 auto 20px' }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: SLATE, marginBottom: 10 }}>{s.title}</h3>
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: MUTED, lineHeight: 1.75 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" style={{ padding: '88px 24px 100px', background: WHITE }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Everything you need</div>
            <h2 style={{ fontSize: 38, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Built for serious property investors</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, lineHeight: 1.8, maxWidth: 560, margin: '0 auto' }}>
              Six fully built modules covering every part of running a property portfolio — from acquisition to tenant management.
            </p>
          </div>

          {FEATURE_CATS.map(cat => (
            <div key={cat.cat} style={{ marginBottom: 64 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: cat.color + '18', border: `1px solid ${cat.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={cat.icon} size={20} color={cat.color}/></div>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: SLATE, letterSpacing: '-0.01em' }}>{cat.cat}</h3>
              </div>
              <div className="feat-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {cat.features.map(f => (
                  <div key={f.title} className="feat-card">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 9, background: cat.color + '14', border: `1px solid ${cat.color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={f.icon} size={18} color={cat.color}/></div>
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: SLATE, marginBottom: 5 }}>{f.title}</h4>
                        <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, lineHeight: 1.75 }}>{f.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '28px 32px', marginTop: 16 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 18 }}>Also included</div>
            <div className="feat-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                ['🌙','Dark & light mode','Easy on the eyes, day or night.'],
                ['📱','PWA — install on iPhone/Android','Works like a native app, no App Store needed.'],
                ['🎨','Custom branding per company','Your logo and colour on every tenant-facing page.'],
                ['🔗','Referral programme','Earn credit for every landlord you refer.'],
                ['🧭','Custom navigation','Show only the tabs your team needs.'],
                ['📧','Onboarding email sequences','Automated welcome, day 3 and day 7 emails.'],
              ].map(([icon, title, desc]) => (
                <div key={title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: SLATE, marginBottom: 3 }}>{title}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, lineHeight: 1.65 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '72px 24px', background: `linear-gradient(135deg, ${DARK} 0%, #1E3040 100%)` }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>AI tools · on the Investor plan</div>
            <h2 style={{ fontSize: 32, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16, lineHeight: 1.25 }}>Listings written for you in 10 seconds</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#9AAAB8', lineHeight: 1.8, marginBottom: 24 }}>
              Generate Rightmove and Zoopla descriptions in your choice of tone — professional, warm or luxury. Plus AI that reads your uploaded gas certs, EICRs and tenancy agreements and fills in the data for you. All included in the £5/property Investor plan.
            </p>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 13, padding: '12px 24px' }}>Try it free</button>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ background: '#ffffff0D', border: '1px solid #ffffff18', borderRadius: 14, padding: '22px 24px' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#7A8FA0', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Generated listing · Zoopla · Warm tone</div>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#C8D5E0', lineHeight: 1.9 }}>
                "Tucked away in the heart of the city centre, this beautifully presented three-bedroom terraced home offers everything a modern family could wish for. The recently fitted kitchen floods the open-plan living space with natural light, while the south-facing garden provides a rare green retreat..."
              </p>
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['✨ Professional','🤝 Warm','💎 Luxury'].map(t => (
                  <span key={t} style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#6A7D8E', background: '#ffffff0A', border: '1px solid #ffffff14', borderRadius: 6, padding: '3px 8px' }}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust + comparison section — landlords kicking the tyres compare
          OwnProperly against spreadsheets and the established names. This
          inline table cuts that off at the pass. Numbers below are based
          on publicly-listed pricing as of May 2026 — update when they
          change. */}
      <section style={{ padding: '72px 24px 80px', background: WHITE, borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>How we compare</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>OwnProperly vs the alternatives</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Mono',monospace", fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${SLATE}` }}>
                  <th style={{ textAlign: 'left', padding: '14px 12px', color: MUTED, fontWeight: 600 }}></th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: GOLD, fontWeight: 700, background: GOLD + '11' }}>OwnProperly</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Spreadsheets</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Arthur Online</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Landlord Vision</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Starting price', 'From £2/property/mo (£10/mo min)', 'Free', 'From £65/mo', 'From £15/mo'],
                  ['MTD ITSA submissions', '✓ Built in', '✗', 'Roadmap', '✓ Add-on'],
                  ['Section 24 calculator', '✓', '✗ DIY', '✗', '✓'],
                  ['Compliance reminders', '✓ Auto', '✗ Manual', '✓', '✓'],
                  ['Branded tenant portal', '✓ Subdomain', '✗', '✓', 'Add-on'],
                  ['BTL deal calculator', '✓', '✗ DIY', '✗', '✓'],
                  ['Multi-company billing', '✓', 'N/A', '✓', '✓'],
                  ['Xero integration', '✓ Native', 'CSV export', '✓', '✓'],
                  ['Free trial', '14 days', 'N/A', '14 days', '30 days'],
                ].map(([label, op, ss, ar, lv], i) => (
                  <tr key={label} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? '#FAFAF8' : 'transparent' }}>
                    <td style={{ padding: '11px 12px', color: SLATE, fontWeight: 600 }}>{label}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', color: SLATE, fontWeight: 700, background: GOLD + '11' }}>{op}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', color: MUTED }}>{ss}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', color: MUTED }}>{ar}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', color: MUTED }}>{lv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 16 }}>
            Competitor pricing from public websites, May 2026. Features change — check directly before deciding.
          </p>
        </div>
      </section>

      <section id="pricing" style={{ padding: '88px 24px 100px', background: CREAM }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Honest pricing</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Simple per-property pricing.</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 600, margin: '0 auto' }}>Two plans: Starter at £2 a property and Investor at £5 a property, each with a £10/month minimum. No per-user fees, unlimited team members — whether you have one rental or a hundred.</p>
          </div>

          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <div style={{ background: SLATE, borderRadius: 20, padding: '36px 32px', color: WHITE }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>Starter plan</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', color: WHITE }}>£2</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5' }}>/property/month</span>
              </div>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#B0BEC5', marginBottom: 28, lineHeight: 1.7 }}>
                Billed monthly with a £10/month minimum. Add or remove properties anytime — you only pay for what you have.
              </p>
              <div style={{ display: 'grid', gap: 11, marginBottom: 24 }}>
                {[
                  'Rent, compliance, maintenance & lettings',
                  'Unlimited team members',
                  'Tenant portal with branded subdomain',
                  'MTD ITSA submissions built in',
                  'Document storage & sharing',
                  'Email alerts & weekly digest',
                  '16 built-in reports with CSV export',
                  '14-day free trial — no card needed',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>✓</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#D0D8E0' }}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#ffffff0D', border: `1px solid ${GOLD}44`, borderRadius: 10, padding: '12px 14px', marginBottom: 24 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: GOLD, marginBottom: 4 }}>Investor plan · £5/property/month</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#B0BEC5', lineHeight: 1.6 }}>
                  Everything in Starter, plus AI portfolio insights, the AI listing writer and the deals pipeline. Same £10/month minimum.
                </div>
              </div>
              <button onClick={onSignUp} className="mkt-btn-white" style={{ width: '100%', fontSize: 13 }}>Start free trial</button>
            </div>

            <div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px', marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Example costs</div>
                {[['1 property','£10/mo (minimum)'],['5 properties','£10/mo'],['10 properties','£20/mo'],['25 properties','£50/mo'],['50 properties','£100/mo'],['100 properties','£200/mo']].map(([props,cost]) => (
                  <div key={props} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED }}>{props}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: SLATE }}>{cost}</span>
                  </div>
                ))}
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, marginTop: 10 }}>Starter plan shown — Investor is £5/property. A £10/month minimum applies to both. Prices exclude VAT where applicable.</div>
              </div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Common questions</div>
                {[
                  ['What happens after the trial?', "You'll be prompted to add a card. If you don't, the account moves to read-only — your data is always safe."],
                  ['Can I cancel anytime?', 'Yes. Cancel from billing settings and keep access until the end of the billing period. No questions asked.'],
                  ['Do prices change if I add properties?', 'Yes — automatically and fairly. Add a property and it is billed pro-rata from that day.'],
                  ['Is the tenant portal included?', 'Yes. Every company gets a branded subdomain portal for tenants at no extra cost.'],
                ].map(([q,a]) => (
                  <div key={q} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, color: SLATE, marginBottom: 5 }}>{q}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, lineHeight: 1.7 }}>{a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* "Book an onboarding call" section. Embeds a Cal.com inline
          link (no script load — keeps Core Web Vitals clean). Once
          you have a Cal account, replace the URL placeholder.
          Conversion lift on similar landing pages is typically 5-12%
          when offered alongside (not instead of) the self-serve CTA. */}
      <section style={{ background: WHITE, padding: '72px 24px', borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Prefer a real conversation?</div>
          <h2 style={{ fontSize: 32, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 16 }}>Book a 15-minute onboarding call</h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, lineHeight: 1.7, marginBottom: 28, maxWidth: 560, margin: '0 auto 28px' }}>
            Stuck on whether OwnProperly fits your portfolio? Book a call with Justin (founder).
            We'll go through your setup live and answer any questions about MTD ITSA, Section 24,
            multi-company billing or compliance tracking. No pitch, no follow-up unless you ask.
          </p>
          <a
            href="https://cal.com/ownproperly/onboarding"
            target="_blank"
            rel="noopener"
            style={{
              display: 'inline-block', fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700,
              padding: '14px 28px', borderRadius: 10, border: `1px solid ${SLATE}`,
              background: SLATE, color: WHITE, textDecoration: 'none',
            }}
            data-cal-link="ownproperly/onboarding"
            data-cal-namespace=""
            data-cal-config='{"layout":"month_view"}'
          >
            📅 Book onboarding call →
          </a>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, marginTop: 16 }}>
            Free · 15 min · Zoom or Google Meet
          </p>
        </div>
      </section>

      {/* FAQ section — mirrors the FAQPage JSON-LD in index.html. Google
          requires the visible content to match the structured data, and
          AI search (ChatGPT, Perplexity, Claude, Gemini) lifts these
          answers directly into their result cards. Phrased in the words
          real landlords use when searching. */}
      <section id="faq" style={{ background: WHITE, padding: '80px 24px', borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Frequently asked questions</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Everything you might be wondering</h2>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              ['What is the best landlord software for UK rental properties?',
               'OwnProperly is property portfolio management software built specifically for UK landlords. It tracks rent payments, compliance certificates (Gas Safety, EICR, EPC), tenant references and Right to Rent, and includes a BTL deal calculator. Pricing starts at £2 per property per month (£10/month minimum) with a 14-day free trial.'],
              ['How much does OwnProperly cost?',
               'OwnProperly is £2 per property per month on the Starter plan. The Investor plan is £5 per property per month and adds AI portfolio insights, the AI listing writer and the deals pipeline. Both plans have a £10/month minimum and include a 14-day free trial with no credit card required.'],
              ['Does OwnProperly support Making Tax Digital (MTD) for landlords?',
               "Yes. OwnProperly is built for the MTD ITSA April 2026 mandate. It connects directly to HMRC via gov.uk OAuth, files quarterly Property Business submissions, and includes Section 24 mortgage interest restriction calculations. Sandbox mode lets you practice before going live."],
              ['What compliance certificates does OwnProperly track?',
               'OwnProperly tracks all UK landlord compliance: Gas Safety (CP12), EICR electrical reports, EPC energy performance ratings, HMO licences, Right to Rent expiry, deposit protection (TDS/DPS/MyDeposits), Legionella risk assessments and PAT testing. It sends automatic email reminders before each expiry.'],
              ['Can multiple landlords share an account?',
               'Yes. OwnProperly supports multi-user companies with role-based permissions. You can invite a co-owner, accountant, or letting agent with granular controls over what they can view (financials) and edit (properties, tenancies, expenses, compliance).'],
              ['Does OwnProperly integrate with Xero or QuickBooks?',
               'OwnProperly has native Xero integration — connect once per company and rent, expenses, mortgage interest, deposits and refurb costs sync automatically. Granular toggles control what syncs. Reconciliation status pulls back from Xero. QuickBooks support is on the roadmap.'],
              ['Is OwnProperly suitable for HMO landlords?',
               'Yes. OwnProperly handles HMOs with per-room rent tracking, individual tenant references, HMO licence expiry alerts, and the ability to bulk-add a block of units in one step. Both selective licensing and mandatory HMO licensing are supported.'],
              ['Can tenants access OwnProperly?',
               'Yes. Each property has a branded tenant portal where tenants can see their tenancy details, payment history, request repairs with photos, and download shared documents (gas safety certificates, the How to Rent guide). The portal lives at your-company.ownproperly.com.'],
            ].map(([q, a]) => (
              <details key={q} style={{ background: '#FAFAF8', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 22px' }}>
                <summary style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700, color: SLATE, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{q}</span>
                  <span aria-hidden="true" style={{ color: GOLD, fontSize: 16, marginLeft: 12 }}>+</span>
                </summary>
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: MUTED, lineHeight: 1.75, marginTop: 14 }}>{a}</p>
              </details>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: MUTED }}>
              Have a question we haven't answered? Email <a href="mailto:hello@ownproperly.com" style={{ color: GOLD }}>hello@ownproperly.com</a>
            </p>
          </div>
        </div>
      </section>

      <section style={{ background: SLATE, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 34, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16 }}>Ready to switch to modern property software?</h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5', marginBottom: 32, lineHeight: 1.75 }}>
            14 days free. No credit card. If it doesn't beat what you're using now, walk away.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={onSignIn} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff33', fontSize: 14, padding: '16px 36px' }}>Sign in</button>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#5A6A7A', marginTop: 20 }}>14-day free trial · From £2/property/month after (£10/mo minimum) · Cancel anytime</p>
        </div>
      </section>

      <footer style={{ background: DARK, padding: '40px 24px', borderTop: '1px solid #ffffff0F' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <img src="/logo.svg" alt="OwnProperly" style={{ height: 40, filter: 'brightness(0.8)', marginBottom: 8 }}/>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#6B7899' }}>Property Portfolio Management · Built for UK Landlords</div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Features','features'],['Pricing','pricing']].map(([label,id]) => (
              <button key={id} onClick={()=>scrollTo(id)} style={{ background: 'none', border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#6B7899', cursor: 'pointer' }}>{label}</button>
            ))}
            <a href="/blog/" style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#6B7899', textDecoration: 'none' }}>Guides</a>
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#4A5568' }}>
            © {new Date().getFullYear()} OwnProperly ·{' '}
            <button onClick={onPrivacy} style={{ background: 'none', border: 'none', color: '#7A8899', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 'inherit', textDecoration: 'underline' }}>Privacy Policy</button>
            {' '} · {' '}
            <a href="mailto:hello@ownproperly.com" style={{ color: '#7A8899', textDecoration: 'none' }}>hello@ownproperly.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
