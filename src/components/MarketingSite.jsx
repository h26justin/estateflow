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
  .mkt-btn-gold{background:${GOLD};color:${DARK};font-family:'DM Mono',monospace;font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;letter-spacing:0.02em;text-decoration:none;display:inline-block;}
  .mkt-btn-gold:hover{background:#B8942A;transform:translateY(-1px);}
  .mkt-btn-ghost{background:transparent;color:${SLATE};font-family:'DM Mono',monospace;font-weight:600;font-size:13px;padding:13px 28px;border-radius:10px;border:1.5px solid ${BORDER};cursor:pointer;transition:all 0.18s;text-decoration:none;display:inline-block;}
  .mkt-btn-ghost:hover{border-color:${SLATE};background:${SLATE};color:white;}
  .mkt-btn-white{background:white;color:${SLATE};font-family:'DM Mono',monospace;font-weight:700;font-size:13px;padding:14px 28px;border-radius:10px;border:none;cursor:pointer;transition:all 0.18s;}
  .mkt-btn-white:hover{background:${CREAM};}
  @media(max-width:768px){
    .mkt-hero-btns{flex-direction:column!important;align-items:stretch!important;}
    .mkt-hero-btns a,.mkt-hero-btns button{text-align:center!important;}
    .feat-grid{grid-template-columns:1fr!important;}
    .steps-grid{grid-template-columns:1fr!important;}
    .stats-grid{grid-template-columns:1fr 1fr!important;}
    .pricing-grid{grid-template-columns:1fr!important;}
    h1{font-size:36px!important;}
    .hero-sub{font-size:16px!important;}
  }
`

const features = [
  { icon: '🏠', title: 'Property portfolio', desc: 'Manage all your properties in one place. Track status, tenants, rent and yields across every company you own.' },
  { icon: '💰', title: 'Rent tracking', desc: 'Log payments, flag arrears and see your monthly collection rate at a glance. Never miss an overdue payment again.' },
  { icon: '📋', title: 'Compliance management', desc: 'Gas, electrical, EPC, HMO licences — track every certificate with expiry alerts before they lapse.' },
  { icon: '🔧', title: 'Maintenance jobs', desc: 'Log and track repair jobs from report to completion. Assign to contractors and monitor progress.' },
  { icon: '📊', title: 'Financial reporting', desc: 'Expenses, yields, equity and monthly profit per property. Export reports for your accountant.' },
  { icon: '📄', title: 'Document storage', desc: 'Store leases, certificates and correspondence securely. Access from anywhere, on any device.' },
  { icon: '👥', title: 'Team access', desc: 'Invite property managers, accountants or partners. Control exactly which companies they can see.' },
  { icon: '📱', title: 'Mobile ready', desc: 'Fully responsive on iOS and Android. Check your portfolio on the go, no app download needed.' },
  { icon: '🔔', title: 'Smart alerts', desc: 'Daily email digests flag arrears, expiring leases and compliance deadlines so nothing slips through.' },
]

const steps = [
  { n: '1', title: 'Create your account', desc: 'Sign up free. No credit card needed. Set up your first company in under 2 minutes.' },
  { n: '2', title: 'Add your properties', desc: 'Import your portfolio one by one or in bulk. Each property gets its own dashboard.' },
  { n: '3', title: 'Manage everything', desc: 'Track rent, compliance, maintenance and documents — all in one place.' },
]

export default function MarketingSite({ onSignIn, onSignUp }) {
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

      {/* ── NAV ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(244,243,239,0.95)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${BORDER}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 116 }}>
          <img src="/logo.svg" alt="OwnProperly" style={{ height: 100, width: 'auto' }}/>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 24 }} className="hide-mobile">
              {[['home','Home'],['features','Features'],['pricing','Pricing']].map(([id,label]) => (
                <button key={id} onClick={()=>scrollTo(id)}
                  style={{ background: 'none', border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 12, color: activeNav===id ? SLATE : MUTED, cursor: 'pointer', fontWeight: activeNav===id ? 600 : 400 }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onSignIn} className="mkt-btn-ghost" style={{ padding: '8px 18px', fontSize: 12 }}>Sign in</button>
              <button onClick={onSignUp} className="mkt-btn-gold" style={{ padding: '8px 18px', fontSize: 12 }}>Get started free</button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section id="home" style={{ background: `linear-gradient(160deg, ${DARK} 0%, ${SLATE} 100%)`, padding: '100px 24px 120px', textAlign: 'center' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: GOLD + '22', border: `1px solid ${GOLD}44`, borderRadius: 20, padding: '5px 16px', fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 28 }}>
            Property management software
          </div>
          <h1 style={{ fontSize: 56, fontWeight: 600, color: WHITE, lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: 24 }}>
            Your entire property<br/>portfolio, perfectly organised
          </h1>
          <p className="hero-sub" style={{ fontSize: 20, color: '#B0BEC5', lineHeight: 1.7, marginBottom: 40, fontFamily: "'DM Mono',monospace", fontWeight: 400 }}>
            Track rent, compliance, maintenance and documents across every property you own — starting at just £1 per property per month.
          </p>
          <div className="mkt-hero-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={()=>scrollTo('features')} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff44', fontSize: 14, padding: '16px 36px' }}>See all features</button>
          </div>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#7A8899', marginTop: 20 }}>14-day free trial · Cancel anytime · From £1/property/month</p>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '28px 24px' }}>
        <div className="stats-grid" style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, textAlign: 'center' }}>
          {[['£1/mo','per property'],['14 days','free trial'],['100%','data ownership'],['Any device','mobile ready']].map(([val,lab]) => (
            <div key={val}>
              <div style={{ fontSize: 22, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>{val}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lab}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '80px 24px', background: CREAM }}>
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
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: MUTED, lineHeight: 1.7 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={{ padding: '80px 24px', background: WHITE }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Everything you need</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Built for property investors</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, marginTop: 14, lineHeight: 1.7 }}>Every feature a serious landlord needs, in one clean dashboard.</p>
          </div>
          <div className="feat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {features.map(f => (
              <div key={f.title} style={{ background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px 26px', transition: 'border-color 0.18s, transform 0.18s' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=GOLD+'88';e.currentTarget.style.transform='translateY(-2px)'}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=BORDER;e.currentTarget.style.transform='none'}}>
                <div style={{ fontSize: 28, marginBottom: 14 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: SLATE, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, lineHeight: 1.75 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{ padding: '80px 24px', background: CREAM }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Simple pricing</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Pay only for what you use</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: MUTED, marginTop: 14, lineHeight: 1.7 }}>No tiers, no hidden fees. Just £1 per property per month.</p>
          </div>

          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            {/* Main pricing card */}
            <div style={{ background: SLATE, borderRadius: 20, padding: '36px 32px', color: WHITE }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>Standard plan</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', color: WHITE }}>£1</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5' }}>/property/month</span>
              </div>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#B0BEC5', marginBottom: 28, lineHeight: 1.6 }}>
                Billed monthly. Add or remove properties anytime — you only pay for what you have.
              </p>
              <div style={{ display: 'grid', gap: 10, marginBottom: 32 }}>
                {['All features included','Unlimited team members','Document storage','Email alerts & weekly digest','14-day free trial'].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>✓</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#D0D8E0' }}>{item}</span>
                  </div>
                ))}
              </div>
              <button onClick={onSignUp} className="mkt-btn-white" style={{ width: '100%', fontSize: 13 }}>
                Start free trial
              </button>
            </div>

            {/* Examples + FAQ */}
            <div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px', marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Example costs</div>
                {[['5 properties','£5/mo'],['10 properties','£10/mo'],['25 properties','£25/mo'],['50 properties','£50/mo'],['100 properties','£100/mo']].map(([props,cost]) => (
                  <div key={props} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED }}>{props}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: SLATE }}>{cost}</span>
                  </div>
                ))}
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, marginTop: 10 }}>
                  Prices exclude VAT where applicable.
                </div>
              </div>

              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Common questions</div>
                {[
                  ['What happens after the trial?', 'You\'ll be prompted to add a card. If you don\'t, the account moves to read-only — your data is safe.'],
                  ['Can I cancel anytime?', 'Yes. Cancel from your billing settings and you keep access until the end of the billing period.'],
                  ['Do prices change if I add properties?', 'Yes — automatically. Add a property and it\'s billed pro-rata from that day.'],
                ].map(([q,a]) => (
                  <div key={q} style={{ marginBottom: 14 }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, color: SLATE, marginBottom: 4 }}>{q}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, lineHeight: 1.6 }}>{a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section style={{ background: SLATE, padding: '72px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 34, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16 }}>
            Ready to organise your portfolio?
          </h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#B0BEC5', marginBottom: 32, lineHeight: 1.7 }}>
            Join landlords and property managers who use OwnProperly to stay on top of everything.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial</button>
            <button onClick={onSignIn} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff33', fontSize: 14, padding: '16px 36px' }}>Sign in</button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: DARK, padding: '40px 24px', borderTop: `1px solid #ffffff11` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <img src="/logo.svg" alt="OwnProperly" style={{ height: 40, filter: 'brightness(0.8)', marginBottom: 8 }}/>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#6B7899' }}>Property Portfolio Management</div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Features','features'],['Pricing','pricing']].map(([label,id]) => (
              <button key={id} onClick={()=>scrollTo(id)}
                style={{ background: 'none', border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#6B7899', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#4A5568' }}>
            © {new Date().getFullYear()} OwnProperly
          </div>
        </div>
      </footer>
    </div>
  )
}
