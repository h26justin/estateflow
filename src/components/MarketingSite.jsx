import { useState } from 'react'

const SLATE  = '#2D3C4A'
const GOLD   = '#C8A84B'
const CREAM  = '#F4F3EF'
const WHITE  = '#FFFFFF'
const MUTED  = '#6B7691'
const BORDER = '#E2DFD8'
const DARK   = '#1A2530'

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  html{scroll-behavior:smooth;}
  body{-webkit-font-smoothing:antialiased;}
  .mkt-btn-gold{background:${GOLD};color:${DARK};font-family:'DM Mono',monospace;font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;letter-spacing:0.02em;text-decoration:none;display:inline-block;}
  .mkt-btn-gold:hover{background:#B8942A;transform:translateY(-1px);box-shadow:0 4px 16px rgba(200,168,75,0.3);}
  .mkt-btn-ghost{background:transparent;color:${SLATE};font-family:'DM Mono',monospace;font-weight:600;font-size:13px;padding:13px 28px;border-radius:10px;border:1.5px solid ${BORDER};cursor:pointer;transition:all 0.18s;text-decoration:none;display:inline-block;}
  .mkt-btn-ghost:hover{border-color:${SLATE};background:${SLATE};color:white;}
  .mkt-btn-white{background:white;color:${SLATE};font-family:'DM Mono',monospace;font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;}
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
    icon: '🏘',
    color: '#4B8FE0',
    features: [
      { icon: '🏠', title: 'Multi-company portfolios', desc: 'Organise properties under separate companies or trading names. Each gets its own branding, settings and access controls.' },
      { icon: '📊', title: 'Property health scores', desc: 'Every property gets an automatic health score based on compliance, occupancy, rent and maintenance — so you see issues instantly.' },
      { icon: '💹', title: 'Yield & equity tracking', desc: 'Live gross and net yields per property. Track current value, equity and portfolio-wide financials at a glance.' },
      { icon: '🗑', title: '30-day trash recovery', desc: 'Accidentally deleted something? Soft-delete keeps everything recoverable for 30 days before permanent removal.' },
    ]
  },
  {
    cat: 'Rent & Finance',
    icon: '💰',
    color: '#2ECC8A',
    features: [
      { icon: '📅', title: 'Visual rent tracker', desc: 'Month-by-month payment squares for every tenancy. Paid, missed, late, void and refurb — colour-coded and clickable to update.' },
      { icon: '📥', title: 'Statement importer', desc: 'Import bank statements in CSV, PNE or RMS format to match and reconcile rent payments automatically.' },
      { icon: '📈', title: 'Rent increase timeline', desc: 'Log every rent review with date and amount. See the full history of increases per property at a glance.' },
      { icon: '⚠', title: 'Arrears alerts', desc: 'Smart alerts flag missed and late payments immediately. Daily digest emails ensure nothing slips through.' },
    ]
  },
  {
    cat: 'Compliance & Legal',
    icon: '📋',
    color: '#E0943A',
    features: [
      { icon: '🔥', title: 'Certificate tracking', desc: 'Gas safety, EICR, EPC, HMO licences — every certificate with expiry date, automatic alerts at 90, 60 and 30 days.' },
      { icon: '🪪', title: 'Right to Rent checks', desc: 'Log document type, check date and expiry for every tenant. Follow-up alerts ensure you stay legally compliant.' },
      { icon: '🏦', title: 'Deposit protection', desc: 'Track which scheme protects each deposit (DPS, TDS, mydeposits), dates and certificate numbers.' },
      { icon: '⚖', title: 'Section 21 & S8 notices', desc: 'Log served notices with dates, grounds and court hearing dates. Full notice history per tenancy.' },
    ]
  },
  {
    cat: 'Tenant Portal',
    icon: '👥',
    color: '#9B59B6',
    features: [
      { icon: '🌐', title: 'Branded subdomains', desc: 'Each company gets its own portal at yourname.ownproperly.com — branded with your colours and logo.' },
      { icon: '🔧', title: 'Repair requests', desc: 'Tenants submit repairs with photos directly. You get an instant email alert and it logs in your maintenance tracker.' },
      { icon: '💬', title: 'Secure messaging', desc: 'Private message threads between landlord and tenant. No WhatsApp, no personal emails — everything in one auditable place.' },
      { icon: '📨', title: 'Branded email invites', desc: 'Invite tenants to their portal with a fully branded email. They set their own password and are in immediately.' },
    ]
  },
  {
    cat: 'Deals & Acquisitions',
    icon: '🎯',
    color: '#C8A84B',
    features: [
      { icon: '🧮', title: 'BTL/HMO/SA/BRRR calculator', desc: 'Full acquisition calculator with correct April 2025 SDLT rates, conveyancing costs, agent fees and Section 24 tax modelling.' },
      { icon: '📌', title: 'Deal pipeline', desc: '6-stage Kanban board to track every deal from sourcing to completion. Milestones, contacts and documents per deal.' },
      { icon: '✨', title: 'AI listing writer', desc: 'Generate professional Rightmove and Zoopla listing descriptions in seconds. Choose tone: professional, warm or luxury.' },
      { icon: '📐', title: 'Portfolio modeller', desc: 'What-if modeller with 5 sliders — add properties, change yields, model refinancing — and see your portfolio projections live.' },
    ]
  },
  {
    cat: 'Reports & Data',
    icon: '📊',
    color: '#E05555',
    features: [
      { icon: '📄', title: '20 built-in reports', desc: 'P&L, tax summaries, arrears, compliance status, occupancy, rent roll, expenses and more — all exportable to CSV.' },
      { icon: '🔒', title: 'GDPR audit log', desc: 'Every action in the platform is logged — who did what and when. Full data export for any tenant or company on request.' },
      { icon: '📁', title: 'Document storage', desc: 'Upload leases, certificates and correspondence per property. Share documents directly with tenants via the portal.' },
      { icon: '🔔', title: 'Smart alert engine', desc: 'Configurable alerts for arrears, expiring leases, compliance deadlines and vacant properties. Weekly digest or instant.' },
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
    <div style={{ fontFamily: 'Georgia, serif', background: CREAM, minHeight: '100vh', overflowX: 'hidden' }}>
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
            Built for UK landlords
          </div>
          <h1 style={{ fontSize: 54, fontWeight: 600, color: WHITE, lineHeight: 1.13, letterSpacing: '-0.025em', marginBottom: 24 }}>
            Your entire property<br/>portfolio, perfectly organised
          </h1>
          <p className="hero-sub" style={{ fontSize: 19, color: '#B0BEC5', lineHeight: 1.75, marginBottom: 40, fontFamily: "'DM Mono',monospace", fontWeight: 400, maxWidth: 680, margin: '0 auto 40px' }}>
            Rent tracking, compliance, tenant portal, deal calculator, AI tools and 20 reports — all in one clean dashboard. Starting at £2 per property per month.
          </p>
          <div className="mkt-hero-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={()=>scrollTo('features')} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff44', fontSize: 14, padding: '16px 36px' }}>See all features</button>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#6A7D8E', marginTop: 20 }}>14-day free trial · Cancel anytime · From £2/property/month</p>
        </div>
      </section>

      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '28px 24px' }}>
        <div className="stats-grid" style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, textAlign: 'center' }}>
          {[['£2/mo','per property'],['20+','built-in reports'],['6 modules','all included'],['Any device','PWA ready']].map(([val,lab]) => (
            <div key={val}>
              <div style={{ fontSize: 22, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', fontFamily: "'DM Mono',monospace" }}>{val}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lab}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding: '88px 24px', background: CREAM }}>
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
                <div style={{ width: 40, height: 40, borderRadius: 10, background: cat.color + '18', border: `1px solid ${cat.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{cat.icon}</div>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: SLATE, letterSpacing: '-0.01em' }}>{cat.cat}</h3>
              </div>
              <div className="feat-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {cat.features.map(f => (
                  <div key={f.title} className="feat-card">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 9, background: cat.color + '14', border: `1px solid ${cat.color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{f.icon}</div>
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
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>AI powered</div>
            <h2 style={{ fontSize: 32, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16, lineHeight: 1.25 }}>Write your property listings in seconds</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#9AAAB8', lineHeight: 1.8, marginBottom: 24 }}>
              Our AI listing writer generates professional Rightmove and Zoopla descriptions from your property details. Choose professional, warm or luxury tone — done in under 10 seconds.
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

      <section id="pricing" style={{ padding: '88px 24px 100px', background: CREAM }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Simple pricing</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Pay only for what you use</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, lineHeight: 1.7 }}>No tiers, no feature gates, no hidden fees. Every feature, for every landlord.</p>
          </div>

          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <div style={{ background: SLATE, borderRadius: 20, padding: '36px 32px', color: WHITE }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>Everything included</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', color: WHITE }}>£2</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5' }}>/property/month</span>
              </div>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#B0BEC5', marginBottom: 28, lineHeight: 1.7 }}>
                Billed monthly. Add or remove properties anytime — you only pay for what you have.
              </p>
              <div style={{ display: 'grid', gap: 11, marginBottom: 32 }}>
                {[
                  'All 6 modules — no feature tiers',
                  'Unlimited team members',
                  'Tenant portal with branded subdomain',
                  'AI listing writer included',
                  'Document storage & sharing',
                  'Email alerts & weekly digest',
                  '20 built-in reports with CSV export',
                  '14-day free trial — no card needed',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>✓</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#D0D8E0' }}>{item}</span>
                  </div>
                ))}
              </div>
              <button onClick={onSignUp} className="mkt-btn-white" style={{ width: '100%', fontSize: 13 }}>Start free trial</button>
            </div>

            <div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px', marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Example costs</div>
                {[['5 properties','£10/mo'],['10 properties','£20/mo'],['25 properties','£50/mo'],['50 properties','£100/mo'],['100 properties','£200/mo']].map(([props,cost]) => (
                  <div key={props} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED }}>{props}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: SLATE }}>{cost}</span>
                  </div>
                ))}
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, marginTop: 10 }}>Prices exclude VAT where applicable.</div>
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

      <section style={{ background: SLATE, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 34, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16 }}>Ready to run your portfolio properly?</h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5', marginBottom: 32, lineHeight: 1.75 }}>
            Join landlords and property managers using OwnProperly to stay on top of rent, compliance, tenants and deals — all in one place.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={onSignIn} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff33', fontSize: 14, padding: '16px 36px' }}>Sign in</button>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#5A6A7A', marginTop: 20 }}>14-day free trial · £2/property/month after · Cancel anytime</p>
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
