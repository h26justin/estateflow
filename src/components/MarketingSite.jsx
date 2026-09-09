import { useState, useEffect } from 'react'
import { MONO, SANS } from '../lib/styles'
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
  .show-mobile-logo { display: none; }
  @media (max-width: 768px) {
    .hide-mobile-logo { display: none; }
    .show-mobile-logo { display: block; }
  }

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
  .screen-tab{background:transparent;border:1px solid ${BORDER};color:${MUTED};font-family:${MONO};font-size:12px;padding:8px 14px;border-radius:999px;cursor:pointer;transition:all 0.15s;}
  .screen-tab:hover{border-color:${SLATE};color:${SLATE};}
  .screen-tab.active{background:${SLATE};border-color:${SLATE};color:${WHITE};}
  .screen-tab:focus-visible{outline:2px solid ${GOLD};outline-offset:2px;}
  .screen-frame{background:${WHITE};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(28,40,48,0.14),0 2px 6px rgba(28,40,48,0.06);}
  .screen-frame-bar{display:flex;align-items:center;gap:6px;padding:10px 14px;background:#F7F6F2;border-bottom:1px solid ${BORDER};}
  .screen-frame-bar span{width:10px;height:10px;border-radius:50%;background:#D9D5CB;display:inline-block;}
  .screen-frame-url{margin-left:12px;font-family:${MONO};font-size:11px;color:${MUTED};background:${WHITE};border:1px solid ${BORDER};border-radius:6px;padding:3px 10px;}
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
      { icon: 'building', title: 'Multi-company portfolios', desc: 'Organise properties under separate companies or trading names, each with its own branding, settings, Xero connection and access controls. Blocks of flats and HMO rooms sit under their building.' },
      { icon: 'pie-chart', title: 'Property health scores', desc: 'Every property gets an automatic health score from compliance, occupancy, rent and maintenance, so the ones that need you rise to the top.' },
      { icon: 'trending-up', title: 'Yield, equity and valuation', desc: 'Live gross and net yields, current value, equity and LTV per property and for the whole portfolio. Mortgages tracked with product end dates.' },
      { icon: 'map', title: 'Property map and search', desc: 'Every address geocoded onto one map. Find any property, tenant or building from the search bar on every page.' },
    ]
  },
  {
    cat: 'Rent & Finance',
    icon: 'pound',
    color: '#2ECC8A',
    features: [
      { icon: 'calendar', title: 'Rent Tracker and Day Tracker', desc: 'Month squares and a day-by-day grid for every tenancy: paid, due, missed, part-paid, payment plans and non-chargeable periods, with the arrears position always current.' },
      { icon: 'upload', title: 'Statement importer and inbox', desc: 'Drop a PNE or RMS agent statement PDF, or have the agent email it to your statement inbox, and rent, fees and maintenance are matched to properties automatically.' },
      { icon: 'receipt', title: 'Xero, two ways', desc: 'Rent and expenses post to Xero as bank transactions with a Property tracking category; reconciliation status and spend come back the other way so the P&L matches the books.' },
      { icon: 'wallet', title: 'Full Portfolio P&L', desc: 'Every company and property in one long P&L: income per unit, pre- and post-tax profit, your share as a shareholder, month by month, with a forecast for the rest of the year.' },
    ]
  },
  {
    cat: 'Short-Term Lets',
    icon: 'bed',
    color: '#9B6FDE',
    features: [
      { icon: 'plug', title: 'Hostaway and Lodgify sync', desc: 'Airbnb, Booking.com, Vrbo and direct bookings pulled from your channel manager three times a day and recorded as income once the guest has stayed, with platform fees shown per booking.' },
      { icon: 'percent', title: 'Occupancy, ADR and RevPAR', desc: 'Nights actually slept over the rooms actually open, average daily rate and revenue per available room, per room and per month. Rooms in refurb sit out of the maths.' },
      { icon: 'users', title: 'Manager pay run', desc: 'Give a property manager a percentage of income after platform fees and the pay run works itself out each fortnight. Mark it paid and the figures are frozen so a rate change never restates a past payout.' },
      { icon: 'clock', title: 'On the books', desc: 'Who is in house tonight, who arrives this week and how full the next thirty nights are, alongside the money that is already booked.' },
    ]
  },
  {
    cat: 'Compliance & Legal',
    icon: 'shield-check',
    color: '#E0943A',
    features: [
      { icon: 'clipboard-check', title: 'Certificate tracking with EPC auto-sync', desc: 'Gas safety, EICR, smoke and CO, HMO licences and more with expiry alerts at 90, 60 and 30 days. EPC ratings and expiry pulled from the national register automatically.' },
      { icon: 'id-card', title: 'Right to Rent and deposits', desc: 'Log document type, check date and expiry for every tenant; track which scheme protects each deposit, with dates and certificate numbers.' },
      { icon: 'scale', title: 'Renters Rights ready', desc: 'A portfolio checklist for the Renters Rights Act (PRS database, ombudsman, periodic tenancies) plus notice generation with the right grounds and periods.' },
      { icon: 'robot', title: 'Portfolio Autopilot', desc: 'A daily AI-drafted action list across arrears, compliance, insurance and vacancies. Every item is a suggestion with a ready-to-send draft; nothing goes out without you.' },
    ]
  },
  {
    cat: 'Refurbs',
    icon: 'hammer',
    color: '#C8A84B',
    features: [
      { icon: 'hammer', title: 'Refurb projects', desc: 'Agreed price against payments made, extras, milestones and a board view for every refurbishment, so remaining-to-pay is always a real number.' },
      { icon: 'wallet', title: 'Payments ledger', desc: 'Every payment and credit logged against the project and the payee, exportable for your accountant and pushed to Xero as its own category if you want it separate.' },
      { icon: 'target', title: 'Refurbs to fund', desc: 'The Deals cashflow view rolls every open refurb into the money you have committed, next to the pipeline you are still deciding on.' },
    ]
  },
  {
    cat: 'Deals & Acquisitions',
    icon: 'target',
    color: '#6E44B8',
    features: [
      { icon: 'calculator', title: 'BTL, HMO, SA and BRRR calculator', desc: 'Full acquisition numbers with current SDLT rates, conveyancing, agent fees, Section 24 tax and a deal score. Paste a Rightmove, Zoopla or OnTheMarket link to pre-fill.' },
      { icon: 'trending-up', title: 'Ten-year projection and remortgage scenarios', desc: 'Cashflow, equity and yield projected ten years out, with an LTV table showing what a remortgage at 65, 70 or 75 per cent would release.' },
      { icon: 'file-text', title: 'Deal pack PDF with photos', desc: 'One PDF per deal for a lender, partner or your own file: photos, the numbers, the projection and the milestones. Copy a deal and choose what carries across.' },
      { icon: 'sparkle', title: 'AI listing writer and what-if modeller', desc: 'Rightmove and Zoopla descriptions in seconds in the tone you choose, and a portfolio modeller that shows what five more properties at a given yield would do.' },
    ]
  },
  {
    cat: 'Tenant Portal',
    icon: 'users',
    color: '#9B6FDE',
    features: [
      { icon: 'globe', title: 'Branded subdomains', desc: 'Each company gets its own portal at yourname.ownproperly.com, in your colours and logo, with a branded email invite for every tenant.' },
      { icon: 'wrench', title: 'Repair requests', desc: 'Tenants submit repairs with photos. You get an alert, it lands in your maintenance tracker, and AI triage suggests urgency and trade.' },
      { icon: 'message', title: 'Secure messaging and documents', desc: 'Private threads between landlord and tenant, and the documents you choose to share, all in one auditable place instead of WhatsApp.' },
    ]
  },
  {
    cat: 'Reports & Tax',
    icon: 'file-text',
    color: '#4B8FE0',
    features: [
      { icon: 'file-text', title: '20 built-in reports', desc: 'P&L, rental income schedule, mortgage interest, capital gains, yield comparison, occupancy, collection rate, backfill, compliance, expenses and more. CSV and PDF, and a year-end tax pack.' },
      { icon: 'landmark', title: 'Making Tax Digital for Income Tax', desc: 'Quarterly Property Business submissions to HMRC built in, with sandbox testing and a clear steer on when MTD applies and when it does not (limited companies).' },
      { icon: 'folder', title: 'Documents, backups and audit log', desc: 'Leases, certificates and correspondence per property, weekly account backups you can download, and a full audit log of every change.' },
      { icon: 'download', title: 'Export everything', desc: 'Bookings, months, rooms, refurb payments and every report export to CSV. Your data is yours.' },
    ]
  },
]

const steps = [
  { n: '1', title: 'Create your account', desc: 'Sign up free. No credit card needed. Set up your first company and add properties in under 5 minutes.' },
  { n: '2', title: 'Import your portfolio', desc: 'Add properties one by one, invite tenants to their portal and connect your bank statement exports.' },
  { n: '3', title: 'Run your portfolio', desc: 'Track rent, stay compliant, manage repairs and generate reports — everything from one clean dashboard.' },
]

// Real screens from a live Properly account, captured 8 Sep 2026: the demo
// portfolio (Northgate Property Ltd and Harbour Lets Ltd, 19 units across two
// companies, fictional people). Files live in public/screens; each is the
// top 913px of a 1606px-wide app window, saved as WebP. Refresh recipe: sign
// in as a platform admin, Impersonate the demo user, capture with
// html-to-image.
const SCREENS = [
  { id: 'dashboard',  label: 'Dashboard',        img: '/screens/dashboard.webp', url: 'dashboard',
    title: 'The whole portfolio on one page',
    desc: 'Value, equity, rent received against forecast, arrears, occupancy and a health score across every company, with the items that need attention today, a portfolio map, Autopilot suggestions and AI insights underneath.' },
  { id: 'portfolio',  label: 'Portfolio',        img: '/screens/portfolio.webp', url: 'properties',
    title: 'Every unit, grouped by company and building',
    desc: 'Houses, flats in a block, HMO rooms and serviced apartments in one list or grid, with status, yield and rent on every row, filters by company and status, a map view and a one-step block-of-flats add.' },
  { id: 'property',   label: 'Property',         img: '/screens/property.webp', url: 'detail',
    title: 'One page per property, one tab per job',
    desc: 'Rent history month by month, tenancy, financials, compliance certificates, maintenance, documents, expenses and the refurb ledger for a single property, with the arrears position and quick stats always in view.' },
  { id: 'rent',       label: 'Rent Tracker',     img: '/screens/rent-tracker.webp', url: 'rent',
    title: 'Every month of every tenancy, at a glance',
    desc: 'Paid, due, missed and part-paid month squares per property, grouped by company and building, with the collection rate and arrears position for the year and a day-by-day view for the current month.' },
  { id: 'stl',        label: 'Short-term lets',  img: '/screens/stl-income.webp', url: 'stl',
    title: 'Airbnb and Booking.com income, after the fees',
    desc: 'Gross, platform fees, manager fees and net to owner for any period; occupancy, ADR and RevPAR on the rooms actually open; who is in house tonight and what is arriving, synced from Hostaway or Lodgify.' },
  { id: 'reports',    label: 'Reports',          img: '/screens/reports.webp', url: 'reports/full_pnl',
    title: 'Twenty reports, one click each',
    desc: 'Full Portfolio P&L per property and per company, cash flow, yield comparison, arrears, compliance, mortgage interest, capital gains and the MTD tax pack, for any tax year or calendar year, as PDF or CSV.' },
  { id: 'compliance', label: 'Compliance',       img: '/screens/compliance.webp', url: 'compliance',
    title: 'Certificates and paperwork per property',
    desc: 'Gas, EICR, EPC, smoke and CO, licences, deposits and Right to Rent for each unit, with legal requirements separated from advisory gaps, an expiry matrix, insurance per building and automatic reminders.' },
  { id: 'deals',      label: 'Deals',            img: '/screens/deals.webp', url: 'deals/pipeline',
    title: 'A pipeline for what you might buy next',
    desc: 'Analysing, offer made, under offer, exchanged and completed on a board or list, with price, yield and cash committed on every card, a purchase timeline of milestones and a full deal pack PDF one click away.' },
  { id: 'deal-calc',  label: 'Deal calculator',  img: '/screens/deal-calculator.webp', url: 'deals/deal',
    title: 'Stamp duty, mortgage and returns before you offer',
    desc: 'Buy-to-let, HMO, serviced apartment, BRR or flip: acquisition costs with the additional-property surcharge, mortgage and rental income, gross yield, net yield, cash-on-cash return and a ten-year projection.' },
  { id: 'refurbs',    label: 'Refurbs',          img: '/screens/refurbs.webp', url: 'refurbs',
    title: 'Agreed price against what you have paid',
    desc: 'Each refurb with its agreed total, extras, payments so far and remaining to pay, on a list, a stage board or a payments ledger, filtered by company, so the money committed to works is never a guess.' },
  { id: 'autopilot',  label: 'Autopilot',        img: '/screens/autopilot.webp', url: 'autopilot',
    title: 'A daily to-do list the software writes for you',
    desc: 'Expired gas certificates, boiler services due, smoke alarm tests, insurance renewals and rent arrears, each with a plain-English draft to send, so the day starts with actions instead of spreadsheets.' },
  { id: 'tenant',     label: 'Tenant portal',    img: '/screens/tenant-portal.webp', url: 'portal',
    title: 'Your tenants get their own branded portal',
    desc: 'A sign-in page on your-company.ownproperly.com where tenants see their tenancy, payment history and shared documents, and raise repairs with photos, in your company name and colours.' },
]

export default function MarketingSite({ onSignIn, onSignUp, onPrivacy }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('home')
  const [screen, setScreen] = useState(SCREENS[0].id)
  const shot = SCREENS.find(x => x.id === screen) || SCREENS[0]

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setActiveNav(id)
    setMobileMenuOpen(false)
  }

  // Blog pages link to /#pricing and /#features. This component mounts after
  // the async auth check, long past the browser's native fragment scroll, so
  // honour the hash ourselves once the sections exist.
  useEffect(() => {
    const id = (window.location.hash || '').replace('#', '')
    if (['features', 'pricing', 'home'].includes(id)) {
      document.getElementById(id)?.scrollIntoView()
      setActiveNav(id)
    }
  }, [])

  return (
    <div style={{ fontFamily: SANS, color: SLATE, background: CREAM, minHeight: '100vh', overflowX: 'hidden' }}>
      <style>{CSS}</style>

      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(244,243,239,0.96)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${BORDER}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 76 }}>
          <a href="/" aria-label="Properly — home" style={{ display:'flex', alignItems:'center' }}>
            <img src="/logo.svg" alt="Properly" className="hide-mobile-logo" style={{ height: 48, width: 'auto' }}/>
            <img src="/brand/lockup-short.svg" alt="Properly" className="show-mobile-logo" style={{ height: 30, width: 'auto' }}/>
          </a>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <div className="hide-mobile" style={{ display: 'flex', gap: 24 }}>
              {[['home','Home'],['features','Features'],['pricing','Pricing']].map(([id,label]) => (
                <button key={id} onClick={()=>scrollTo(id)}
                  style={{ background: 'none', border: 'none', fontFamily: MONO, fontSize: 12, color: activeNav===id ? SLATE : MUTED, cursor: 'pointer', fontWeight: activeNav===id ? 600 : 400, transition: 'color 0.15s' }}>
                  {label}
                </button>
              ))}
              <a href="/blog/" style={{ fontFamily: MONO, fontSize: 12, color: MUTED, textDecoration: 'none' }}>Guides</a>
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
          <div style={{ display: 'inline-block', background: GOLD + '22', border: `1px solid ${GOLD}44`, borderRadius: 20, padding: '5px 16px', fontFamily: MONO, fontSize: 11, color: GOLD, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 28 }}>
            Built this decade · UK landlords
          </div>
          <h1 style={{ fontSize: 54, fontWeight: 600, color: WHITE, lineHeight: 1.13, letterSpacing: '-0.025em', marginBottom: 24 }}>
            Property software that<br/>doesn't feel like 2010
          </h1>
          <p className="hero-sub" style={{ fontSize: 19, color: '#B0BEC5', lineHeight: 1.75, marginBottom: 40, fontFamily: MONO, fontWeight: 400, maxWidth: 680, margin: '0 auto 40px' }}>
            Run your entire UK rental portfolio from one dashboard. Rent, compliance, tenant portal, reports and more from £2 per property a month (£10/mo minimum) — AI insights and the deals pipeline on the £5 Investor plan.
          </p>
          <div className="mkt-hero-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={()=>scrollTo('features')} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff44', fontSize: 14, padding: '16px 36px' }}>See all features</button>
          </div>
          <p style={{ fontFamily: MONO, fontSize: 11, color: '#6A7D8E', marginTop: 20 }}>14-day free trial · Cancel anytime · No per-user fees, ever</p>
        </div>
      </section>

      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '28px 24px' }}>
        <div className="stats-grid" style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, textAlign: 'center' }}>
          {[['From £2/mo','per property · £10/mo min'],['0','per-user fees'],['2 plans','Starter & Investor'],['14 days','free, no card']].map(([val,lab]) => (
            <div key={val}>
              <div style={{ fontSize: 22, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', fontFamily: MONO }}>{val}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lab}</div>
            </div>
          ))}
        </div>
      </div>

      <section id="screens" style={{ padding: '80px 24px 72px', background: CREAM, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Inside Properly</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Real screens, live account</h2>
            <p style={{ fontFamily: MONO, fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 600, margin: '0 auto' }}>
              These are live pages from a working Properly account, not mock-ups: a two-company portfolio of houses, a block of flats, an HMO and six serviced apartments, exactly as it runs today.
            </p>
          </div>
          <div className="screen-tabs" role="tablist" aria-label="Product screens" style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 22 }}>
            {SCREENS.map(sc => (
              <button key={sc.id} role="tab" aria-selected={sc.id === shot.id} onClick={() => setScreen(sc.id)}
                className={'screen-tab' + (sc.id === shot.id ? ' active' : '')}>
                {sc.label}
              </button>
            ))}
          </div>
          <div className="screen-frame">
            <div className="screen-frame-bar" aria-hidden="true">
              <span/><span/><span/>
              <div className="screen-frame-url">www.ownproperly.com/#/{shot.url}</div>
            </div>
            <img key={shot.id} src={shot.img} alt={`Properly ${shot.label} page: ${shot.title}`} width={1606} height={913} loading={shot.id === SCREENS[0].id ? 'eager' : 'lazy'} decoding="async"
              style={{ display: 'block', width: '100%', height: 'auto' }}/>
          </div>
          <div className="screen-caption" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: 22, maxWidth: 860, margin: '22px auto 0' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: SLATE, marginBottom: 8, letterSpacing: '-0.01em' }}>{shot.title}</h3>
              <p style={{ fontFamily: MONO, fontSize: 13, color: MUTED, lineHeight: 1.8 }}>{shot.desc}</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '88px 24px 72px', background: WHITE }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Why Properly</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>The landlord tool you'd actually choose</h2>
            <p style={{ fontFamily: MONO, fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 580, margin: '0 auto' }}>
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
                  <span style={{ fontFamily: MONO, fontSize: 9, color: GOLD, background: GOLD + '14', border: `1px solid ${GOLD}33`, borderRadius: 4, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{c.tag}</span>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: SLATE, marginBottom: 10, lineHeight: 1.3 }}>{c.title}</h3>
                <p style={{ fontFamily: MONO, fontSize: 12, color: MUTED, lineHeight: 1.8 }}>{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '72px 24px 88px', background: CREAM }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Up and running in minutes</h2>
          </div>
          <div className="steps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
            {steps.map(s => (
              <div key={s.n} style={{ textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 26, background: SLATE, color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 20, fontWeight: 700, margin: '0 auto 20px' }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: SLATE, marginBottom: 10 }}>{s.title}</h3>
                <p style={{ fontFamily: MONO, fontSize: 13, color: MUTED, lineHeight: 1.75 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" style={{ padding: '88px 24px 100px', background: WHITE }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Everything you need</div>
            <h2 style={{ fontSize: 38, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Built for serious property investors</h2>
            <p style={{ fontFamily: MONO, fontSize: 14, color: MUTED, lineHeight: 1.8, maxWidth: 560, margin: '0 auto' }}>
              Eight modules covering every part of running a portfolio: acquisition, refurb, letting, rent, short-term lets, compliance, tax and the tenants themselves.
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
                        <p style={{ fontFamily: MONO, fontSize: 12, color: MUTED, lineHeight: 1.75 }}>{f.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '28px 32px', marginTop: 16 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 18 }}>Also included</div>
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
                    <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.65 }}>{desc}</div>
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
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>AI tools · on the Investor plan</div>
            <h2 style={{ fontSize: 32, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16, lineHeight: 1.25 }}>Listings written for you in 10 seconds</h2>
            <p style={{ fontFamily: MONO, fontSize: 13, color: '#9AAAB8', lineHeight: 1.8, marginBottom: 24 }}>
              Generate Rightmove and Zoopla descriptions in your choice of tone — professional, warm or luxury. Plus AI that reads your uploaded gas certs, EICRs and tenancy agreements and fills in the data for you. All included in the £5/property Investor plan.
            </p>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 13, padding: '12px 24px' }}>Try it free</button>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ background: '#ffffff0D', border: '1px solid #ffffff18', borderRadius: 14, padding: '22px 24px' }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: '#7A8FA0', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Generated listing · Zoopla · Warm tone</div>
              <p style={{ fontFamily: MONO, fontSize: 12, color: '#C8D5E0', lineHeight: 1.9 }}>
                "Tucked away in the heart of the city centre, this beautifully presented three-bedroom terraced home offers everything a modern family could wish for. The recently fitted kitchen floods the open-plan living space with natural light, while the south-facing garden provides a rare green retreat..."
              </p>
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['Professional','Warm','Luxury'].map(t => (
                  <span key={t} style={{ fontFamily: MONO, fontSize: 10, color: '#6A7D8E', background: '#ffffff0A', border: '1px solid #ffffff14', borderRadius: 6, padding: '3px 8px' }}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust + comparison section — landlords kicking the tyres compare
          Properly against spreadsheets and the established names. This
          inline table cuts that off at the pass. Numbers below are based
          on publicly-listed pricing as of May 2026 — update when they
          change. */}
      <section style={{ padding: '72px 24px 80px', background: WHITE, borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>How we compare</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Properly vs the alternatives</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${SLATE}` }}>
                  <th style={{ textAlign: 'left', padding: '14px 12px', color: MUTED, fontWeight: 600 }}></th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: GOLD, fontWeight: 700, background: GOLD + '11' }}>Properly</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Spreadsheets</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Arthur Online</th>
                  <th style={{ textAlign: 'center', padding: '14px 12px', color: SLATE, fontWeight: 600 }}>Landlord Vision</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Starting price', 'From £2/property/mo (£10/mo min)', 'Free', 'From £65/mo', 'From £15/mo'],
                  ['MTD ITSA submissions', 'Built in', '✗', 'Roadmap', 'Add-on'],
                  ['Section 24 calculator', '✓', 'DIY', '✗', '✓'],
                  ['Compliance reminders', 'Auto', 'Manual', '✓', '✓'],
                  ['Branded tenant portal', 'Subdomain', '✗', '✓', 'Add-on'],
                  ['BTL deal calculator', '✓', 'DIY', '✗', '✓'],
                  ['Multi-company billing', '✓', 'N/A', '✓', '✓'],
                  ['Xero integration', 'Native', 'CSV export', '✓', '✓'],
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
          <p style={{ fontFamily: MONO, fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 16 }}>
            Competitor pricing from public websites, May 2026. Features change — check directly before deciding.
          </p>
        </div>
      </section>

      <section id="pricing" style={{ padding: '88px 24px 100px', background: CREAM }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Honest pricing</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 14 }}>Simple per-property pricing.</h2>
            <p style={{ fontFamily: MONO, fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 600, margin: '0 auto' }}>Two plans: Starter at £2 a property and Investor at £5 a property, each with a £10/month minimum. No per-user fees, unlimited team members — whether you have one rental or a hundred.</p>
          </div>

          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <div style={{ background: SLATE, borderRadius: 20, padding: '36px 32px', color: WHITE }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>Starter plan</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', color: WHITE }}>£2</span>
                <span style={{ fontFamily: MONO, fontSize: 14, color: '#B0BEC5' }}>/property/month</span>
              </div>
              <p style={{ fontFamily: MONO, fontSize: 12, color: '#B0BEC5', marginBottom: 28, lineHeight: 1.7 }}>
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
                  '20 built-in reports with CSV and PDF export',
                  '14-day free trial — no card needed',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>✓</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: '#D0D8E0' }}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#ffffff0D', border: `1px solid ${GOLD}44`, borderRadius: 10, padding: '12px 14px', marginBottom: 24 }}>
                <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: GOLD, marginBottom: 4 }}>Investor plan · £5/property/month</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: '#B0BEC5', lineHeight: 1.6 }}>
                  Everything in Starter, plus AI portfolio insights, the AI listing writer and the deals pipeline. Same £10/month minimum.
                </div>
              </div>
              <button onClick={onSignUp} className="mkt-btn-white" style={{ width: '100%', fontSize: 13 }}>Start free trial</button>
            </div>

            <div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px', marginBottom: 16 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Example costs</div>
                {[['1 property','£10/mo (minimum)'],['5 properties','£10/mo'],['10 properties','£20/mo'],['25 properties','£50/mo'],['50 properties','£100/mo'],['100 properties','£200/mo']].map(([props,cost]) => (
                  <div key={props} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}>{props}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: SLATE }}>{cost}</span>
                  </div>
                ))}
                <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, marginTop: 10 }}>Starter plan shown — Investor is £5/property. A £10/month minimum applies to both. Prices exclude VAT where applicable.</div>
              </div>
              <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '24px' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Common questions</div>
                {[
                  ['What happens after the trial?', "You'll be prompted to add a card. If you don't, the account moves to read-only — your data is always safe."],
                  ['Can I cancel anytime?', 'Yes. Cancel from billing settings and keep access until the end of the billing period. No questions asked.'],
                  ['Do prices change if I add properties?', 'Yes — automatically and fairly. Add a property and it is billed pro-rata from that day.'],
                  ['Is the tenant portal included?', 'Yes. Every company gets a branded subdomain portal for tenants at no extra cost.'],
                ].map(([q,a]) => (
                  <div key={q} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: SLATE, marginBottom: 5 }}>{q}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.7 }}>{a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* "Book an onboarding call" section. The CTA is a mailto for now —
          the cal.com/ownproperly username was never registered, so the old
          hardcoded booking link 404'd for every visitor (and it was also
          the link in the day-13 trial email). When a Cal.com account
          exists, swap the href back to the booking URL here AND set the
          CAL_BOOKING_URL secret on the trial-emails edge function.
          Conversion lift on similar landing pages is typically 5-12%
          when offered alongside (not instead of) the self-serve CTA. */}
      <section style={{ background: WHITE, padding: '72px 24px', borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Prefer a real conversation?</div>
          <h2 style={{ fontSize: 32, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em', marginBottom: 16 }}>Book a 15-minute onboarding call</h2>
          <p style={{ fontFamily: MONO, fontSize: 14, color: MUTED, lineHeight: 1.7, marginBottom: 28, maxWidth: 560, margin: '0 auto 28px' }}>
            Stuck on whether Properly fits your portfolio? Book a call with Justin (founder).
            We'll go through your setup live and answer any questions about MTD ITSA, Section 24,
            multi-company billing or compliance tracking. No pitch, no follow-up unless you ask.
          </p>
          <a
            href="mailto:hello@ownproperly.com?subject=Onboarding%20call%20request&body=Hi%20Justin%2C%0A%0AI%27d%20like%20to%20book%20a%2015-minute%20onboarding%20call.%20A%20few%20times%20that%20work%20for%20me%3A%0A%0A"
            style={{
              display: 'inline-block', fontFamily: MONO, fontSize: 13, fontWeight: 700,
              padding: '14px 28px', borderRadius: 10, border: `1px solid ${SLATE}`,
              background: SLATE, color: WHITE, textDecoration: 'none',
            }}
          >
            Email to book a call →
          </a>
          <p style={{ fontFamily: MONO, fontSize: 11, color: MUTED, marginTop: 16 }}>
            Free · 15 min · Zoom or Google Meet · usually same-day reply
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
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Frequently asked questions</div>
            <h2 style={{ fontSize: 36, fontWeight: 600, color: SLATE, letterSpacing: '-0.02em' }}>Everything you might be wondering</h2>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              ['What is the best landlord software for UK rental properties?',
               'Properly (ownproperly.com) is property portfolio management software built specifically for UK landlords. It tracks rent payments, compliance certificates (Gas Safety, EICR, EPC), tenant references and Right to Rent, and includes a BTL deal calculator. Pricing starts at £2 per property per month (£10/month minimum) with a 14-day free trial.'],
              ['How much does Properly cost?',
               'Properly is £2 per property per month on the Starter plan. The Investor plan is £5 per property per month and adds AI portfolio insights, the AI listing writer and the deals pipeline. Both plans have a £10/month minimum and include a 14-day free trial with no credit card required.'],
              ['Does Properly support Making Tax Digital (MTD) for landlords?',
               "Yes. Properly is built for the MTD ITSA April 2026 mandate. It connects directly to HMRC via gov.uk OAuth, files quarterly Property Business submissions, and includes Section 24 mortgage interest restriction calculations. Sandbox mode lets you practice before going live."],
              ['What compliance certificates does Properly track?',
               'Properly tracks all UK landlord compliance: Gas Safety (CP12), EICR electrical reports, EPC energy performance ratings, HMO licences, Right to Rent expiry, deposit protection (TDS/DPS/MyDeposits), Legionella risk assessments and PAT testing. It sends automatic email reminders before each expiry.'],
              ['Can multiple landlords share an account?',
               'Yes. Properly supports multi-user companies with role-based permissions. You can invite a co-owner, accountant, or letting agent with granular controls over what they can view (financials) and edit (properties, tenancies, expenses, compliance).'],
              ['Does Properly integrate with Xero or QuickBooks?',
               'Properly has native Xero integration — connect once per company and rent, expenses, mortgage interest, deposits and refurb costs sync automatically. Granular toggles control what syncs. Reconciliation status pulls back from Xero. QuickBooks support is on the roadmap.'],
              ['Is Properly suitable for HMO landlords?',
               'Yes. Properly handles HMOs with per-room rent tracking, individual tenant references, HMO licence expiry alerts, and the ability to bulk-add a block of units in one step. Both selective licensing and mandatory HMO licensing are supported.'],
              ['Can tenants access Properly?',
               'Yes. Each property has a branded tenant portal where tenants can see their tenancy details, payment history, request repairs with photos, and download shared documents (gas safety certificates, the How to Rent guide). The portal lives at your-company.ownproperly.com.'],
            ].map(([q, a]) => (
              <details key={q} style={{ background: '#FAFAF8', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 22px' }}>
                <summary style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: SLATE, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{q}</span>
                  <span aria-hidden="true" style={{ color: GOLD, fontSize: 16, marginLeft: 12 }}>+</span>
                </summary>
                <p style={{ fontFamily: MONO, fontSize: 13, color: MUTED, lineHeight: 1.75, marginTop: 14 }}>{a}</p>
              </details>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <p style={{ fontFamily: MONO, fontSize: 13, color: MUTED }}>
              Have a question we haven't answered? Email <a href="mailto:hello@ownproperly.com" style={{ color: GOLD }}>hello@ownproperly.com</a>
            </p>
          </div>
        </div>
      </section>

      <section style={{ background: SLATE, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 34, fontWeight: 600, color: WHITE, letterSpacing: '-0.02em', marginBottom: 16 }}>Ready to switch to modern property software?</h2>
          <p style={{ fontFamily: MONO, fontSize: 14, color: '#B0BEC5', marginBottom: 32, lineHeight: 1.75 }}>
            14 days free. No credit card. If it doesn't beat what you're using now, walk away.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignUp} className="mkt-btn-gold" style={{ fontSize: 14, padding: '16px 36px' }}>Start free trial — no card needed</button>
            <button onClick={onSignIn} className="mkt-btn-ghost" style={{ color: WHITE, borderColor: '#ffffff33', fontSize: 14, padding: '16px 36px' }}>Sign in</button>
          </div>
          <p style={{ fontFamily: MONO, fontSize: 11, color: '#5A6A7A', marginTop: 20 }}>14-day free trial · From £2/property/month after (£10/mo minimum) · Cancel anytime</p>
        </div>
      </section>

      <footer style={{ background: DARK, padding: '40px 24px', borderTop: '1px solid #ffffff0F' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <img src="/wordmark-dark.svg" alt="Properly" style={{ height: 44, marginBottom: 10 }}/>
            <div style={{ fontFamily: MONO, fontSize: 11, color: '#6B7899' }}>Property Portfolio Management · Built for UK Landlords</div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Features','features'],['Pricing','pricing']].map(([label,id]) => (
              <button key={id} onClick={()=>scrollTo(id)} style={{ background: 'none', border: 'none', fontFamily: MONO, fontSize: 12, color: '#6B7899', cursor: 'pointer' }}>{label}</button>
            ))}
            <a href="/blog/" style={{ fontFamily: MONO, fontSize: 12, color: '#6B7899', textDecoration: 'none' }}>Guides</a>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: '#4A5568' }}>
            © {new Date().getFullYear()} Properly ·{' '}
            <button onClick={onPrivacy} style={{ background: 'none', border: 'none', color: '#7A8899', cursor: 'pointer', fontFamily: MONO, fontSize: 'inherit', textDecoration: 'underline' }}>Privacy Policy</button>
            {' '} · {' '}
            <a href="mailto:hello@ownproperly.com" style={{ color: '#7A8899', textDecoration: 'none' }}>hello@ownproperly.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
