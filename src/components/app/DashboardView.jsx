import { monthRate } from '../../lib/rentForecast'
import { resolveWidgetPrefs } from '../../lib/dashboardPrefs'
import RentIncomePanel from '../RentIncomePanel'
import { SmartAlerts } from '../DashboardComponents'
import * as api from '../../lib/api'
import { aggregateDeals } from '../../lib/dealCashflow'
import { propertyComplianceSummary } from '../../lib/complianceStatus'
import { MONO, CV } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import PropertySearchBar from '../PropertySearchBar'
import PortfolioInsightsWidget from '../PortfolioInsightsWidget'
import { canUseInvestorFeatures } from '../../lib/tierGating'
import { plural } from '../../lib/format'
import { CompanyDocumentsTab, TenantInbox, PropertyMap, AutopilotWidget } from './lazyViews'
import { fmt } from '../../lib/appFmt'
import { StatCard } from './StatCard'
import { HealthRing } from './HealthRing'
import { PortfolioModellerWidget } from './PortfolioModellerWidget'

// Dashboard view: welcome zero-state, company filter pills and the
// user-orderable section registry (KPI grid, rent income, alerts, widgets).
// Moved verbatim from App.jsx; every value it reads is passed in explicitly.
export function DashboardView({
  activeProperties, isMobile, T, companies, setShowAddCo, setEditProp, setShowAddProp, openDetail,
  user, stats, dashCoFilter, dashProps, tenanciesByProp, setDashCoFilter, rentSnapshot,
  companyStats, setView, dashCos, activeFlags, showToast, companySettings, companySubs,
  isPlatformAdmin, setProperties, setSelectedId, setDetailTab, setPortfolioTab, activeCoTab,
  isAdmin, sectionPrefs, SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED, setStatusFilter,
  dashboardDeals, insurancePolicies, widgetPrefs, WIDGET_DEFAULT_ORDER, WIDGET_DEFAULT_ENABLED,
  setCoFilter, setCustomizeDashTab, setShowCustomizeDash,
}) {
  return (
    <div className="fade">
      {/* First-run zero-state. Accounts with no properties land here —
          including the most common post-onboarding state (a company
          created by the wizard but no property yet, which previously
          skipped this hero and dumped the user on a wall of £0 KPIs).
          While this shows, the dashboard sections below are skipped
          entirely. */}
      {activeProperties.length === 0 && (
        <div className="card" style={{padding:isMobile?'24px 18px':'40px 32px',marginBottom:20,textAlign:'center',background:T.card,border:`1px dashed ${T.gold}66`}}>
          <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="home" size={isMobile?30:38} color={T.gold}/></div>
          <h1 style={{fontSize:isMobile?20:24,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>Welcome to Properly</h1>
          <p style={{fontFamily:MONO,fontSize:13,color:T.muted,marginBottom:20,lineHeight:1.6,maxWidth:520,margin:'0 auto 20px'}}>
            {companies.length === 0
              ? "You're on a 14-day free trial. The fastest way to see what the app does is to add your first company and one property — takes about 2 minutes."
              : 'Your company is set up — now add your first property to bring the dashboard to life. Takes about a minute.'}
          </p>
          <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
            {companies.length === 0
              ? <>
                  <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>1. Add a Company</button>
                  <button className="btn btn-ghost" onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled title="Add a company first">2. Add a Property</button>
                </>
              : <button className="btn btn-gold" onClick={()=>{setEditProp(null);setShowAddProp(true)}}>Add your first property</button>}
          </div>
        </div>
      )}
      {/* Mobile property search. The header bar has no room for it at
          phone widths (logo + title + actions already fill 52px), so on
          mobile it sits at the top of the dashboard instead. */}
      {isMobile && activeProperties.length > 0 && (
        <div style={{marginBottom:14}}>
          <PropertySearchBar
            properties={activeProperties}
            onOpen={p=>openDetail(p)}
            placeholder="Search properties…"/>
        </div>
      )}
      <div style={{marginBottom:isMobile?14:20,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16,marginBottom:isMobile?10:16}}>
          <div style={{flex:'1 1 auto',minWidth:0}}>
            {(() => {
              const fn = (user?.user_metadata?.first_name || (user?.user_metadata?.full_name||'').trim().split(' ')[0] || '').trim()
              const hr = new Date().getHours()
              const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
              return (
                <h1 style={{fontSize:isMobile?22:30,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?2:4}}>
                  {greet}{fn ? <>, {fn}</> : ''}
                </h1>
              )
            })()}
            {activeProperties.length > 0 && <p style={{fontFamily:MONO,color:T.muted,fontSize:isMobile?11:12,lineHeight:1.5,wordBreak:'break-word',overflowWrap:'anywhere'}}>
              {plural(stats.total,'property','properties')} · {stats.rented} rented{stats.noticeGiven>0?` (${stats.noticeGiven} on notice)`:''}{stats.letAgreed>0?` · ${stats.letAgreed} let agreed`:''} · {stats.vacant} vacant{dashCoFilter.length>0?` · ${dashCoFilter.length} of ${plural(companies.length,'company','companies')}`:` · ${plural(companies.length,'company','companies')}`}
              {dashProps.some(p=>p.current_value>0) && <>
                {/* On mobile drop to a new line so the value/equity pair has its own row */}
                {isMobile ? <br/> : ' · '}
                <span style={{color:T.muted}}>Value </span>
                <span style={{color:T.green,fontWeight:700}}>
                  {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0),0))}
                </span>
                {' · '}
                <span style={{color:T.muted}}>Equity </span>
                <span style={{color:T.green,fontWeight:700}}>
                  {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0)-(p.mortgage_amount||0),0))}
                </span>
              </>}
            </p>}
          </div>
          {/* Portfolio health ring — average of per-property health
              scores, consistent with the per-card HealthBadge. */}
          {dashProps.length > 0 && (() => {
            const avg = dashProps.reduce((sum,p)=>sum+(api.calcPropertyHealthScore(p, p.compliance_items||[], tenanciesByProp[p.id]||p.tenancy||null, p.maintenance_jobs||[], p.rent_payments||[]).score||0),0)/dashProps.length
            return <HealthRing score={avg}/>
          })()}
        </div>
        {/* Company filter pills */}
        {companies.length > 1 && (
          <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
            <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
            <button
              onClick={()=>setDashCoFilter([])}
              style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                border:`1px solid ${dashCoFilter.length===0?T.gold:T.border}`,
                background:dashCoFilter.length===0?T.gold:'transparent',
                color:dashCoFilter.length===0?CV.onGold:T.muted,fontWeight:dashCoFilter.length===0?700:400}}>
              All companies
            </button>
            {companies.map(c=>{
              const sel = dashCoFilter.includes(c.id)
              return (
                <button key={c.id}
                  onClick={()=>setDashCoFilter(prev=>{
                    if(prev.length===0) {
                      // Was 'all' — switch to just this one
                      return [c.id]
                    }
                    if(prev.includes(c.id)) {
                      // Already selected — deselect. If empty after, go back to 'all'
                      const next = prev.filter(id=>id!==c.id)
                      return next
                    }
                    // Add to selection
                    const next = [...prev, c.id]
                    // If all companies selected, snap back to 'all'
                    return next.length===companies.length ? [] : next
                  })}
                  style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                    border:`1px solid ${sel?(c.color||T.gold):T.border}`,
                    background:sel?(c.color||T.gold)+'22':'transparent',
                    color:sel?(c.color||T.goldText):T.muted}}>
                  {sel?'✓ ':''}{c.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {(() => {
        // First-run: the welcome hero above is the whole dashboard.
        // Rendering the sections under it would just be a wall of £0
        // KPIs and empty widgets.
        if (activeProperties.length === 0) return null
        // ───────────────────────────────────────────────────────────────
        // Dashboard sections registry — each section is a labelled chunk
        // that the user can reorder and show/hide. Section content is
        // rendered by the function below. The KPI grid is one of these
        // sections too, with its own internal customisation preserved.
        // ───────────────────────────────────────────────────────────────

        const SECTION_DEFS = {
          rent_income: {
            icon: 'pound',
            label: 'Rental Income',
            description: 'Due vs collected by month, year to date, with a per-company split',
            render: () => <RentIncomePanel months={rentSnapshot.ytd} companies={companyStats} onOpenRent={()=>setView('rent')} isMobile={isMobile}/>,
          },
          kpi_grid: {
            icon: 'pie-chart',
            label: 'KPI cards',
            description: 'Portfolio value, monthly rent, arrears, and other key metrics',
            render: () => renderKpiGrid(),
          },
          by_company: {
            icon: 'grid',
            label: 'By Company',
            description: 'A card per company with its property/rent stats',
            render: () => renderByCompany(),
          },
          smart_alerts: {
            icon: '⚠',
            label: 'Items needing attention',
            description: 'Smart alerts: overdue rent, expiring compliance, vacant properties',
            render: () => <SmartAlerts properties={dashProps} companies={dashCos} fmt={fmt} openDetail={openDetail}/>,
          },
          autopilot_widget: {
            icon: '🤖',
            label: 'Portfolio Autopilot',
            description: 'AI-drafted prioritised actions across your portfolio',
            render: () => {
              if (!activeFlags.has('portfolio_autopilot')) return null
              const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
              return (
                <div style={{ marginTop: 28 }}>
                  <AutopilotWidget companyId={scopedId} companies={companies} onOpenFull={() => { window.location.hash = '#/autopilot' }}/>
                </div>
              )
            },
          },
          tenant_inbox: {
            icon: '📬',
            label: 'Tenant Inbox',
            description: 'Latest messages and repair requests from tenants',
            render: () => <TenantInbox user={user} companies={companies} showToast={showToast} companySettings={companySettings}/>,
          },
          portfolio_insights: {
            icon: '✨',
            label: 'AI Portfolio Insights',
            description: 'Observations and opportunities generated by Claude (refreshable every 30 min) — Investor tier',
            // Investor-tier feature. Gates via canUseInvestorFeatures
            // helper — platform admins + free-tier companies pass; otherwise
            // need an active 'investor' subscription. Falls back to an
            // upgrade prompt for starter-tier users.
            render: () => {
              const hasInvestor = canUseInvestorFeatures({
                subs: companySubs, companies, isPlatformAdmin,
              })
              if (!hasInvestor) {
                return (
                  <div style={{ marginTop: 28, marginBottom: 20, background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 14, padding: '20px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>✨</span>
                      <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0 }}>AI Portfolio Insights</h2>
                      <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.gold + '22', color: T.goldText }}>INVESTOR</span>
                    </div>
                    <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.7, marginBottom: 12 }}>
                      Get Claude-generated weekly observations about under-rented units, expiring certs, high LTVs and refinance opportunities. Available on the £5/property Investor tier.
                    </p>
                    <button className="btn btn-gold" style={{ fontSize: 12 }}
                      onClick={() => {
                        // 'billing' is a Settings sub-tab, not a top-level
                        // view. Set the hash BEFORE switching views —
                        // SettingsPage reads its initial tab from the URL
                        // at mount, whereas the tab-change event would
                        // fire before its listener exists. The event is
                        // still dispatched for an already-mounted page.
                        window.history.pushState({ view: 'settings', settingsTab: 'billing' }, '', '#/settings/billing')
                        setView('settings')
                        window.dispatchEvent(new CustomEvent(
                          'ownproperly:set-settings-tab',
                          { detail: { tab: 'billing' } }
                        ))
                      }}>
                      Upgrade to Investor →
                    </button>
                  </div>
                )
              }
              const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
              const scopedName = scopedId ? companies.find(c => c.id === scopedId)?.name : null
              return <PortfolioInsightsWidget companyId={scopedId} companyName={scopedName}/>
            },
          },
          property_map: {
            icon: '🗺',
            label: 'Property Map',
            description: 'Compact map showing all your properties',
            render: () => (
              <div style={{ marginTop: 28 }}>
                <PropertyMap
                  compact
                  properties={dashProps}
                  setProperties={setProperties}
                  showToast={showToast}
                  onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}
                  onViewFullMap={()=>{ setView('properties'); setPortfolioTab('map') }}
                />
              </div>
            ),
          },
          portfolio_modeller: {
            icon: '📈',
            label: 'Portfolio What-If Modeller',
            description: 'Model rent changes, refinancing, and other scenarios',
            render: () => <PortfolioModellerWidget properties={dashProps}/>,
          },
          company_documents: {
            icon: '📁',
            label: 'Company Documents',
            description: 'Documents stored at company level (only shows when a company is selected)',
            render: () => (
              activeCoTab && (companySettings[activeCoTab]||{}).feature_documents
                ? <div style={{marginTop:28}}>
                    <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:6}}>Company Documents</h2>
                    <p style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:14}}>
                      Documents stored at company level — for items that apply across all properties (e.g. company insurance, bank letters)
                    </p>
                    <CompanyDocumentsTab companyId={activeCoTab} showToast={showToast} isAdmin={isAdmin} user={user}/>
                  </div>
                : null
            ),
          },
        }

        // Default order + enabled are defined ONCE at the top of this
        // component (SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED).
        // Previously redeclared here, which caused the customise modal
        // to silently miss new sections (e.g. portfolio_insights).
        // Resolve current section prefs, filling in any missing keys from defaults.
        // Same resolver as the KPI widgets: a section the user has never
        // saved lands where the default order puts it (after its nearest
        // default predecessor), not at the bottom of the page.
        const resolvedSections = resolveWidgetPrefs(sectionPrefs, SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED)
          .filter(s => SECTION_DEFS[s.key])

        // ── Renderers for each section. Defined here to keep closures
        //    over dashProps/companies/etc lexically simple.

        function renderKpiGrid() {
          // Widget definitions — each returns a StatCard JSX element
          const WIDGET_DEFS = {
            portfolio_value: { icon:'home', label:'Portfolio Value', render: () => (
              <StatCard icon="home" label="Portfolio Value" value={fmt(stats.totalEstVal)} sub={`Invested ${fmt(stats.totalInvested)}`} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                breakdown={[
                  {label:'Estimated portfolio value', value:fmt(stats.totalEstVal), color:T.goldText},
                  {label:'Total invested (purchase + refurb)', value:fmt(stats.totalInvested)},
                  {label:'Purchase prices', value:fmt(dashProps.reduce((s,p)=>s+(p.purchase_price||0),0)), indent:true},
                  {label:'Refurb costs', value:fmt(dashProps.reduce((s,p)=>s+(p.refurb_cost||0),0)), indent:true},
                  {label:'Unrealised gain', value:fmt(stats.totalEstVal-stats.totalInvested), color:stats.totalEstVal>stats.totalInvested?T.green:T.red, separator:true, note:'Est. portfolio value minus total invested (purchase + refurb)'},
                  {label:'Transaction costs', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0)+(p.legal_fees||0),0)), separator:true},
                  {label:'Stamp duty', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0),0)), indent:true},
                  {label:'Legal fees', value:fmt(dashProps.reduce((s,p)=>s+(p.legal_fees||0),0)), indent:true},
                ]}
              />
            )},
            monthly_rent: { icon:'pound', label:'Monthly Rental Income', render: () => {
              // One card for "what should this month bring in": the
              // headline is the rent engine's collectible rent for the
              // month (tenancy-aware, prorated for move-ins/outs, voids
              // and non-chargeable periods). The contracted rent_pcm
              // total, annualised figure and next month's forecast sit on
              // the face; the previous separate Rent Forecast card was
              // retired because it duplicated this one.
              // This card answers "what should come in"; what HAS come
              // in lives on Rent Collected, so nothing is repeated.
              const cur = rentSnapshot.months[0]
              const next = rentSnapshot.next
              const hasPeriods = cur.periods > 0
              const headline = hasPeriods ? cur.expected : stats.monthlyRent
              const gap = cur.expected - stats.monthlyRent
              const sub = !hasPeriods ? `${cur.label} · no rent periods yet, showing contracted rent`
                : Math.abs(gap) < 1 ? `Expected ${cur.label} · matches contracted rent`
                : `Expected ${cur.label} · ${fmt(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'} contracted`
              return (
                <StatCard icon="pound" label="Monthly Rental Income" value={fmt(headline)} sub={sub} accent={T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                  strip={[
                    {label:'Contracted', value:`${fmt(stats.monthlyRent)}/mo`},
                    {label:`${next.label.slice(0,3)} forecast`, value:fmt(next.expected), color:T.goldText},
                    {label:'Annualised', value:`${fmt(stats.monthlyRent*12)}/yr`},
                    {label:'Rented', value:`${stats.rented} of ${stats.total}`},
                  ]}
                  breakdown={[
                    {label:`Expected ${cur.label}`, value:fmt(cur.expected), color:T.green, note:'What the tenancies say is due this month: mid-month move-ins and move-outs, voids and approved non-chargeable periods are prorated'},
                    {label:'Contracted monthly rent', value:fmt(stats.monthlyRent), note:'Sum of the monthly rent on every rented or notice-given property'},
                    {label:'Expected vs contracted', value:`${gap >= 0 ? '+' : '-'}${fmt(Math.abs(gap))}`, color:Math.abs(gap) < 1 ? T.muted : gap > 0 ? T.green : T.amber},
                    {label:'Annualised (contracted)', value:fmt(stats.monthlyRent*12), color:T.green},
                    {label:`${next.label} forecast`, value:fmt(next.expected), color:T.goldText, separator:true, note:next.periods === 0 ? 'No rent periods generated for next month yet' : undefined},
                    {label:'Rented units', value:`${stats.rented} of ${stats.total}`, separator:true},
                    {label:'Occupancy rate', value:`${Math.round(stats.occupancy.rate)}%`, color:T.green, note:'Occupied units over lettable units (refurb and purchased left out)'},
                    ...companyStats.map(c=>({label:`${c.name} · expected ${cur.label.slice(0,3)}`, value:fmt(cur.byCompany[c.id]?.expected || 0), color:c.color, separator:c===companyStats[0]})),
                  ]}
                />
              )
            }},
            rent_received: { icon:'receipt', label:'Rent Collected', render: () => {
              // What HAS come in: this month's collected rent with its
              // percentage and outstanding, and the two previous months
              // on the face. By rent period (the month the rent is for,
              // as the Rent Tracker lays it out). Short-term-let income
              // is excluded from the headline and footnoted.
              //
              // Colour semantics: green = money in; the warning colours
              // are reserved for COMPLETED months whose collection window
              // has closed. This month mid-collection is never red.
              const [cur, prev, prev2] = rentSnapshot.months
              const rate = monthRate(cur)
              const completedColor = r => r == null ? T.muted : r >= 95 ? T.green : r >= 80 ? T.amber : T.red
              const stlTotal = cur.stlReceived + prev.stlReceived + prev2.stlReceived
              const sub = cur.expected > 0
                ? `${cur.label} · ${rate}% of ${fmt(cur.expected)} · ${fmt(cur.outstanding)} outstanding`
                : `${cur.label} · ${cur.periods === 0 ? 'no rent periods yet' : 'nothing expected'}`
              // Card face: one row per month (oldest first, this month
              // bold) plus year to date: Due · Collected · Outstanding · %.
              const ytd = rentSnapshot.ytd.reduce((a, mo) => ({ expected: a.expected + mo.expected, received: a.received + mo.received }), { expected: 0, received: 0 })
              ytd.outstanding = Math.max(0, ytd.expected - ytd.received)
              const tableRow = (mo, isCurrent, label) => {
                const r = monthRate(mo)
                const col = isCurrent ? T.green : completedColor(r)
                return { strong: isCurrent, cells: [label, fmt(mo.expected), fmt(mo.received), fmt(mo.outstanding), r == null ? '–' : `${r}%`],
                  colors: [isCurrent ? T.text : T.muted, T.text, T.green, mo.outstanding > 0 ? (isCurrent ? T.amber : col) : T.green, col] }
              }
              const table = { columns: ['Month', 'Due', 'Collected', 'Outstanding', '%'], rows: [
                tableRow(prev2, false, prev2.label.slice(0,3)), tableRow(prev, false, prev.label.slice(0,3)), tableRow(cur, true, `${cur.label.slice(0,3)} so far`),
                tableRow(ytd, true, `${cur.year} YTD`),
              ] }
              const monthRow = (mo, isCurrent) => {
                const r = monthRate(mo)
                return {
                  label: `${mo.label}${isCurrent ? ' (so far)' : ''}`,
                  value: fmt(mo.received),
                  color: isCurrent ? T.green : completedColor(r),
                  note: mo.expected > 0
                    ? `${r}% of ${fmt(mo.expected)} expected${mo.outstanding > 0 ? ` · ${fmt(mo.outstanding)} outstanding` : ''}${mo.needsBackfill > 0 ? ` · ${mo.needsBackfill} paid with no amount` : ''}`
                    : (mo.periods === 0 ? 'No rent periods recorded' : 'Nothing expected'),
                }
              }
              return (
                <StatCard icon="receipt" label="Rent Collected" value={fmt(cur.received)} sub={sub} accent={T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                  table={table}
                  breakdown={[
                    monthRow(cur, true),
                    monthRow(prev, false),
                    monthRow(prev2, false),
                    {label:'Three-month total', value:fmt(cur.received + prev.received + prev2.received), color:T.green, separator:true, note:'Figures are by rent period, the month the rent is for, matching the Rent Tracker'},
                    ...(cur.needsBackfill > 0 ? [{label:`${cur.needsBackfill} paid ${cur.needsBackfill===1?'period':'periods'} with no amount this month`, value:'⚠', color:T.amber, note:'Marked paid in the Rent Tracker without a figure, so collected is understated until the amounts are entered'}] : []),
                    ...companyStats.map(c=>({label:`${c.name} · collected ${cur.label.slice(0,3)}`, value:fmt(cur.byCompany[c.id]?.received || 0), color:c.color, separator:c===companyStats[0]})),
                    ...(stlTotal > 0 ? [{label:'Short-term let income (excluded above)', value:fmt(stlTotal), color:'#9B6FDE', separator:true, note:'Booking income over the same three months, reported in full on the Short-Term Let Income page'}] : []),
                  ]}
                />
              )
            }},
            arrears: { icon:'alert-triangle', label:'Total Arrears', render: () => (
              <StatCard icon="alert-triangle" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                breakdown={[
                  // Each property in arrears links straight to its Rent
                  // tab — that's where the payment history and arrears
                  // detail live, which is what you want next after
                  // spotting the number here.
                  ...dashProps.filter(p=>(p.arrears||0)>0).map(p=>({label:p.name, value:fmt(p.arrears), color:T.red,
                    onClick:()=>openDetail(p,'rent'), linkTitle:`Open ${p.name} — rent & arrears`})),
                  ...(dashProps.filter(p=>(p.arrears||0)>0).length===0?[{label:'No arrears - all clear!', value:'✓', color:T.green}]:[]),
                  {label:'Vacant units', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                ]}
              />
            )},
            refurb: { icon:'hammer', label:'In Refurbishment', render: () => (
              <StatCard icon="hammer" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue} onNavigate={()=>{setStatusFilter('refurb');setPortfolioTab('properties');setView('properties')}} navLabel="View"
                breakdown={[
                  // Same for live refurbs — straight to the Refurb tab
                  // for phases, costs and progress notes.
                  ...dashProps.filter(p=>p.refurb_status==='in-progress').map(p=>({label:p.name, value:p.company?.abbr||'', color:T.blue,
                    onClick:()=>openDetail(p,'refurb'), linkTitle:`Open ${p.name} — refurbishment`})),
                  ...(stats.inRefurb===0?[{label:'No active refurbs', value:'✓', color:T.green}]:[]),
                  {label:'Planned refurbs', value:dashProps.filter(p=>p.refurb_status==='planned').length},
                  {label:'Completed refurbs', value:dashProps.filter(p=>p.refurb_status==='complete').length, color:T.green},
                ]}
              />
            )},
            mortgages: { icon:'landmark', label:'Mortgages Outstanding', render: () => (
              <StatCard icon="landmark" label="Mortgages Outstanding" value={fmt(stats.totalMortgage)} sub={`${stats.mortgaged} mortgaged properties`} accent={T.purple} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                breakdown={[
                  {label:'Total mortgage debt', value:fmt(stats.totalMortgage), color:T.purple},
                  {label:'Total portfolio equity', value:fmt(stats.totalEquity), color:stats.totalEquity>0?T.green:T.red},
                  {label:'Monthly repayments', value:fmt(stats.monthlyMortgageCost)},
                  {label:'Annual repayments', value:fmt(stats.monthlyMortgageCost*12)},
                  {label:'Average LTV', value:stats.totalEstVal>0?((stats.totalMortgage/stats.totalEstVal)*100).toFixed(1)+'%':'-'},
                  ...companyStats.map(c=>({
                    label:c.name+' debt',
                    value:fmt(dashProps.filter(p=>p.company_id===c.id).reduce((s,p)=>s+(p.mortgage_amount||0),0)),
                    color:c.color
                  })),
                ]}
              />
            )},
            cashflow_forecast: { icon:'wallet', label:'Cash Committed', render: () => {
              // Filter deals by the dashboard's company filter so the
              // widget stays in sync with the rest of the page. Properties
              // are already filtered (dashProps).
              const filteredDeals = dashCoFilter.length === 0
                ? dashboardDeals
                : dashboardDeals.filter(d => dashCoFilter.includes(d.company_id))
              const cashAgg = aggregateDeals(filteredDeals, dashProps)
              // Big number is total cash out across ALL live items
              // (committed AND pipeline). The sub-line and breakdown
              // give the urgency split. Earlier we tried "next 90 days"
              // as the headline but it was £0 for users without dates
              // set — useless out of the box. Total exposure is more
              // honest as a glanceable headline.
              const next90 = (cashAgg.byBucket.overdue?.cashOut || 0)
                           + (cashAgg.byBucket['0-30']?.cashOut || 0)
                           + (cashAgg.byBucket['31-60']?.cashOut || 0)
                           + (cashAgg.byBucket['61-90']?.cashOut || 0)
              const next90Count = (cashAgg.byBucket.overdue?.count || 0)
                                + (cashAgg.byBucket['0-30']?.count || 0)
                                + (cashAgg.byBucket['31-60']?.count || 0)
                                + (cashAgg.byBucket['61-90']?.count || 0)
              const overdueCash = cashAgg.byBucket.overdue?.cashOut || 0
              const overdueCount = cashAgg.byBucket.overdue?.count || 0
              const pipelineCash = cashAgg.byGroup.pipeline?.cashOut || 0
              // Accent: red if overdue, amber if anything due in 30d,
              // gold otherwise (purely planning view).
              const accent = overdueCash > 0 ? T.red
                           : (cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber
                           : T.gold
              // Sub-line gives the urgency split at a glance:
              //   "£X due in 90d · £Y in pipeline"
              // Falls back to a friendly hint if there's nothing live.
              const sub = cashAgg.totalCount === 0
                ? 'No live deals or properties'
                : `${fmt(next90)} due in 90d · ${fmt(pipelineCash)} in pipeline`
              return (
                <StatCard icon="wallet" label="Cash Committed" value={fmt(cashAgg.totalCashOut)} sub={sub} accent={accent} onNavigate={()=>setView('deals')} navLabel="Deals"
                  breakdown={[
                    ...(overdueCash > 0 ? [{label:`Overdue (${overdueCount} ${overdueCount===1?'item':'items'})`, value:fmt(overdueCash), color:T.red, separator:true}] : []),
                    {label:'Next 30 days', value:fmt(cashAgg.byBucket['0-30']?.cashOut || 0), color:(cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber : T.muted, note:`${cashAgg.byBucket['0-30']?.count || 0} item(s) needing cash this month`},
                    {label:'31-60 days',   value:fmt(cashAgg.byBucket['31-60']?.cashOut || 0), color:T.text},
                    {label:'61-90 days',   value:fmt(cashAgg.byBucket['61-90']?.cashOut || 0), color:T.text},
                    {label:'Subtotal: due in next 90 days', value:fmt(next90), color:next90 > 0 ? T.goldText : T.muted, separator:true, note:`${next90Count} item(s) with completion or refurb dates set`},
                    {label:'Later (90+ days)', value:fmt(cashAgg.byBucket['91+']?.cashOut || 0), color:T.muted, separator:true},
                    {label:'Pipeline (no date set)', value:fmt(pipelineCash), color:T.muted, note:'Deals still being analysed/offered. Set expected completion dates to move these into the dated buckets above.'},
                    {label:'Total cash out across all live items', value:fmt(cashAgg.totalCashOut), color:T.goldText, separator:true},
                    ...(cashAgg.propertyRefurbUndated > 0 ? [{label:`${cashAgg.propertyRefurbUndated} refurb${cashAgg.propertyRefurbUndated===1?'':'s'} without a target finish date`, value:'⚠', color:T.amber, note:'Set a target finish on the Refurbs page to place it in the 90-day view'}] : []),
                  ]}
                />
              )
            }},
            insurance_renewals: { icon:'shield-check', label:'Insurance Renewals', render: () => {
              // Filter policies by the dashboard's company filter, mirroring
              // how the cashflow widget handles dashCoFilter. RLS already
              // limits the user's visible set.
              const visiblePolicies = dashCoFilter.length === 0
                ? insurancePolicies
                : insurancePolicies.filter(p => dashCoFilter.includes(p.company_id))
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const daysUntil = (d) => Math.floor((new Date(d) - today) / (1000 * 60 * 60 * 24))
              // Buckets:
              //   expired   — already past expiry, needs urgent action
              //   d30       — renewing in next 30 days (amber alert)
              //   d60       — renewing in 31-60 days
              //   d90       — renewing in 61-90 days
              //   later     — beyond 90 days
              // For each bucket we sum premiums so the user sees what
              // money is committed and roughly when.
              const bucketed = { expired: [], d30: [], d60: [], d90: [], later: [] }
              visiblePolicies.forEach(p => {
                if (!p.expiry_date) return
                const d = daysUntil(p.expiry_date)
                if (d < 0)       bucketed.expired.push(p)
                else if (d <= 30) bucketed.d30.push(p)
                else if (d <= 60) bucketed.d60.push(p)
                else if (d <= 90) bucketed.d90.push(p)
                else              bucketed.later.push(p)
              })
              const sumP = (arr) => arr.reduce((s, p) => s + (Number(p.premium) || 0), 0)
              // Big number = total annual premium across all active
              // policies (anything not yet expired). Catches the eye and
              // tells the user their total insurance bill.
              const totalAnnual = visiblePolicies
                .filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0)
                .reduce((s, p) => s + (Number(p.premium) || 0), 0)
              const activeCount = visiblePolicies.filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0).length
              // Accent: red if anything's expired, amber if renewing
              // in 30 days, gold otherwise.
              const accent = bucketed.expired.length > 0 ? T.red
                           : bucketed.d30.length > 0 ? T.amber
                           : T.gold
              const sub = visiblePolicies.length === 0
                ? 'No policies tracked'
                : bucketed.expired.length > 0
                  ? `${bucketed.expired.length} expired · ${activeCount} active`
                  : bucketed.d30.length > 0
                    ? `${bucketed.d30.length} renewing in 30 days · ${activeCount} active`
                    : `${activeCount} active ${activeCount === 1 ? 'policy' : 'policies'}`
              return (
                <StatCard icon="shield-check" label="Insurance Renewals" value={fmt(totalAnnual)} sub={sub} accent={accent} onNavigate={()=>{window.location.hash='#/compliance/insurance'}} navLabel="Insurance"
                  breakdown={[
                    ...(bucketed.expired.length > 0 ? [{label:`Expired (${bucketed.expired.length})`, value:fmt(sumP(bucketed.expired)), color:T.red, separator:true, note:'Policies past their expiry date. Renew immediately.'}] : []),
                    {label:'Next 30 days', value:fmt(sumP(bucketed.d30)), color:bucketed.d30.length > 0 ? T.amber : T.muted, note:`${bucketed.d30.length} ${bucketed.d30.length === 1 ? 'policy' : 'policies'} renewing this month`},
                    {label:'31-60 days',   value:fmt(sumP(bucketed.d60)), color:T.text, note:bucketed.d60.length > 0 ? `${bucketed.d60.length} ${bucketed.d60.length === 1 ? 'policy' : 'policies'}` : null},
                    {label:'61-90 days',   value:fmt(sumP(bucketed.d90)), color:T.text, note:bucketed.d90.length > 0 ? `${bucketed.d90.length} ${bucketed.d90.length === 1 ? 'policy' : 'policies'}` : null},
                    {label:'Later',        value:fmt(sumP(bucketed.later)), color:T.muted, note:`${bucketed.later.length} ${bucketed.later.length === 1 ? 'policy' : 'policies'} beyond 90 days`, separator:true},
                    {label:'Total annual premium (all active)', value:fmt(totalAnnual), color:T.goldText, separator:true},
                  ]}
                />
              )
            }},
            property_count: { icon:'home', label:'Property Count', render: () => (
              <StatCard icon="home" label="Property Count" value={stats.total} sub={`${stats.rented} rented · ${stats.vacant} vacant`} accent={T.gold} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                breakdown={[
                  {label:'Total properties', value:stats.total},
                  {label:'Rented', value:stats.rented, color:T.green},
                  {label:'Vacant', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                  {label:'In refurbishment', value:stats.inRefurb, color:T.blue},
                  ...companyStats.map(c=>({label:c.name, value:c.count, color:c.color})),
                ]}
              />
            )},
            occupancy_rate: { icon:'pie-chart', label:'Occupancy Rate', render: () => {
              // Over lettable units only: refurb and purchased units
              // can't take a tenant yet, so they'd drag the % down for
              // no reason. The empty lettable units sit on the card face.
              const o = stats.occupancy
              const rate = Math.round(o.rate)
              return (
                <StatCard icon="pie-chart" label="Occupancy Rate" value={rate+'%'} sub={`${o.occupied} of ${o.lettable} lettable occupied`} accent={rate>=90?T.green:rate>=75?T.amber:T.red} onNavigate={()=>{setStatusFilter('vacant');setPortfolioTab('properties');setView('properties')}} navLabel="Vacant"
                  strip={[
                    {label:'Let agreed', value:o.letAgreed, color:o.letAgreed?T.amber:T.muted},
                    {label:'On market', value:o.onMarket, color:o.onMarket?'#3AA7B8':T.muted},
                    {label:'Vacant', value:o.vacant, color:o.vacant?T.red:T.muted},
                    {label:'Not lettable', value:o.notLettable, color:T.muted},
                  ]}
                  breakdown={[
                    {label:'Rented', value:o.rented, color:T.green},
                    ...(o.shortTermLet ? [{label:'Short-term let', value:o.shortTermLet, color:T.green}] : []),
                    ...(o.noticeGiven ? [{label:'Notice given', value:o.noticeGiven, color:T.amber, note:'Tenant still paying through the notice period'}] : []),
                    {label:'Occupied', value:o.occupied, color:T.green},
                    {label:'Let agreed', value:o.letAgreed, color:T.amber, separator:true, note:'Tenant found, not moved in yet'},
                    {label:'On rental market', value:o.onMarket, color:'#3AA7B8', note:'Being marketed, rent not expected yet'},
                    {label:'Vacant', value:o.vacant, color:T.red},
                    {label:'Lettable units', value:o.lettable},
                    {label:'Occupancy %', value:rate+'%', color:rate>=90?T.green:T.amber, note:'Occupied over lettable units'},
                    ...(o.refurb ? [{label:'In refurb (not counted)', value:o.refurb, color:T.muted, separator:true}] : []),
                    ...(o.purchased ? [{label:'Purchased (not counted)', value:o.purchased, color:T.muted, separator:!o.refurb}] : []),
                    {label:'Vacancy cost (est)', value:fmt(dashProps.filter(p=>p.status==='vacant').reduce((s,p)=>s+(p.rent_pcm||0),0))+'/mo lost', color:T.red, separator:true},
                  ]}
                />
              )
            }},
            compliance_status: { icon:'clipboard-check', label:'Portfolio Compliance', render: () => {
              // Same rollup as the Compliance overview cards: every
              // tracked+applicable requirement per property, with
              // insurance status pulled from the policy register.
              const tracked = dashProps.filter(p => p.status !== 'sold' && !p.archived_at)
              let expired = 0, expiring = 0, missingReq = 0, fully = 0, scored = 0
              tracked.forEach(p => {
                const s = propertyComplianceSummary(p, companySettings[p.company_id] || {}, insurancePolicies)
                if (s.total === 0) return
                scored++
                expired += s.expired
                expiring += s.expiring
                missingReq += s.rows.filter(r => r.status.state === 'missing' && r.req.tier <= 2).length
                if (s.expired === 0 && s.expiring === 0 && s.missing === 0) fully++
              })
              const accent = (expired > 0 || missingReq > 0) ? T.red : expiring > 0 ? T.amber : T.green
              const sub = expired > 0 ? `${expired} expired · ${missingReq} missing required`
                : missingReq > 0 ? `${missingReq} missing required`
                : expiring > 0 ? `${expiring} expiring soon`
                : 'All tracked items in date'
              return (
                <StatCard icon="clipboard-check" label="Portfolio Compliance" value={`${fully}/${scored}`} sub={sub} accent={accent}
                  onNavigate={()=>setView('compliance')} navLabel="Compliance"
                  breakdown={[
                    {label:'Properties fully in date', value:String(fully), color:T.green},
                    {label:'Expired items', value:String(expired), color:expired>0?T.red:T.muted},
                    {label:'Expiring within 60 days', value:String(expiring), color:expiring>0?T.amber:T.muted},
                    {label:'Missing required items', value:String(missingReq), color:missingReq>0?T.red:T.muted, note:'Legal certificates, licences and tenancy paperwork with nothing on file'},
                  ]}
                />
              )
            }},
          }
          // Saved layout + defaults, resolved by the same helper the
          // Customize modal uses: a widget the user has never saved is
          // slotted where the default order puts it (the rent cards sit
          // beside Monthly Rental Income, not on a row of their own) and
          // starts with its default enabled flag.
          const currentWidgets = resolveWidgetPrefs(widgetPrefs, WIDGET_DEFAULT_ORDER, WIDGET_DEFAULT_ENABLED)
          const enabledWidgets = currentWidgets.filter(w => w.enabled && WIDGET_DEFS[w.key])
          const count = enabledWidgets.length
          return (
            <div style={{marginBottom:20}}>
              {/* Rows stretch to even heights; a card's detail panel is an
                  overlay (see StatCard) so opening one never resizes the row. */}
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':`repeat(${Math.min(count,5)},1fr)`,gap:10}}>
                {enabledWidgets.map(w => (
                  <div key={w.key} style={{display:'contents'}}>{WIDGET_DEFS[w.key].render()}</div>
                ))}
              </div>
            </div>
          )
        }

        function renderByCompany() {
          return (
            <>
              <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:14}}>By Company</h2>
              {companies.length===0
                ?<div className="card" style={{padding:32,textAlign:'center'}}>
                    <div style={{fontFamily:MONO,color:T.muted,fontSize:12,marginBottom:16}}>No companies yet. Add your first one to get started.</div>
                    <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>+ Add Company</button>
                  </div>
                :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14,marginBottom:28}}>
                    {companyStats.map(c=>(
                      <div key={c.id} className="card" style={{padding:'20px 22px',borderLeft:`3px solid ${c.color}`}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                          <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:c.color,background:c.color+'22',padding:'3px 10px',borderRadius:4}}>{c.abbr}</div>
                          <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                          {[{l:'Properties',v:c.count},{l:'Rented',v:`${c.rented}/${c.count}`},{l:'Monthly Income',v:fmt(c.monthlyRent)},{l:'Arrears',v:fmt(c.arrears),red:c.arrears>0}].map((item,i)=>(
                            <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                              <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>{item.l}</div>
                              <div style={{fontFamily:MONO,fontSize:15,fontWeight:700,color:item.red?T.red:T.goldText}}>{item.v}</div>
                            </div>
                          ))}
                        </div>
                        <button className="btn btn-ghost" style={{width:'100%',marginTop:12,fontSize:11}} onClick={()=>{setCoFilter(c.id);setStatusFilter('all');setPortfolioTab('properties');setView('properties')}}>View Properties -&gt;</button>
                      </div>
                    ))}
                  </div>
              }
            </>
          )
        }

        // ── Render the visible sections in their preferred order ──
        const visibleSections = resolvedSections.filter(s => s.enabled)
        return (
          <>
            {/* Customize Dashboard button — single source of truth for both sections and widget toggles */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:8}}>
              <div style={{flex:'1 1 auto',minWidth:0,fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                Dashboard · {visibleSections.length} sections shown
              </div>
              <button onClick={()=>{ setCustomizeDashTab('sections'); setShowCustomizeDash(true) }}
                style={{fontFamily:MONO,fontSize:10,padding:'4px 10px',minHeight:28,borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                Customise
              </button>
            </div>
            {visibleSections.map(s => {
              const def = SECTION_DEFS[s.key]
              if (!def) return null
              return <div key={s.key}>{def.render()}</div>
            })}
          </>
        )
      })()}
    </div>
  )
}
