import { useState, useMemo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { useIsMobile } from '../../lib/useWindowSize'
import { defaultRentYear, getMonthlyRentStats, legacyCollectionRate, stlPaymentIds } from '../../lib/rentStats'
import { propertyNeedsTenancy } from '../../lib/tenancyUtils'
import { portfolioStats, GO_LIVE } from '../../lib/rentEngine'
import { RentReviewModal } from '../DashboardComponents'
import * as api from '../../lib/api'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, isPropertyEarningRent } from '../../lib/propertyStatus'
import { buildingTailFromName, buildingKeyFromName, naturalCompare } from '../../lib/addressUtils'
import { normaliseQuery, matchesQuery } from '../../lib/propertySearch'
import { useScrollRestoreOnClear } from '../../lib/useScrollRestoreOnClear'
import { MONO, CV, FS } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import { STL_COLOR } from '../../lib/rentColors'
import { engineSummary } from '../../lib/rentEngineSummary'
import { pressable } from '../../lib/pressable'
import { plural } from '../../lib/format'
import { ReviewQueuePanel, BankConnectionsModal, BankInboxModal } from './lazyViews'
import { Badge } from './Badges'
import { RentDots } from './RentDots'

// ─── RENT TRACKER OVERVIEW PAGE ──────────────────────────────────────────────
// Month counts and money received for a set of properties, from the rent
// engine (Stage 3+). Short-term lets are excluded (own page). Pre-2026 months
// keep their legacy status and amount but are counted so "All years" still
// adds up.
// Rent-square colour key. Ten entries wrap to five or six lines on a phone
// and push the tracker itself below the fold, so on mobile it collapses
// behind a "Key" toggle.
export function RentLegend({ small = false, collapsible = false }) {
  const { T } = useTheme()
  const [open, setOpen] = useState(false)
  const items = [{c:T.green,l:'Paid'},{c:T.amber,l:'Due / part paid'},{c:T.red,l:'Missed'},{c:T.blue,l:'Pending review (set aside)'},{c:T.faint,l:'Not collectible (hatched)'},{c:STL_COLOR,l:'Short-term let (stayed)'},{c:'#C4B3EA',l:'Short-term let (booked, not yet stayed)'},{c:T.amber,l:'Paid, amount needed (orange dot)'},{c:T.blue,l:'Payment plan (blue dot)'},{c:T.muted,l:'Pre-2026 legacy (dotted underline)'}]
  const sw = small ? 8 : 10
  const list = (
    <ul id={collapsible ? 'rent-legend-list' : undefined} aria-label="Rent colour key"
      style={{display:'flex',gap:12,flexWrap:'wrap',listStyle:'none',margin:collapsible?'8px 0 0':0,padding:0}}>
      {items.map(x=>(
        <li key={x.l} style={{display:'flex',alignItems:'center',gap:4,fontFamily:MONO,fontSize:small?FS.xs:11,color:T.muted}}>
          <span aria-hidden="true" style={{width:sw,height:sw,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}
        </li>
      ))}
    </ul>
  )
  if (!collapsible) return list
  return (
    <div>
      <button type="button" onClick={()=>setOpen(o=>!o)} aria-expanded={open} aria-controls="rent-legend-list"
        style={{display:'inline-flex',alignItems:'center',gap:6,minHeight:28,padding:'4px 10px',borderRadius:8,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,fontFamily:MONO,fontSize:11,cursor:'pointer'}}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12}/> Key
      </button>
      {open && list}
    </div>
  )
}

// ─── RENT TRACKER OVERVIEW PAGE ──────────────────────────────────────────────
export function RentTrackerOverview({companies, properties, fmt, openDetail, onDayTracker, yieldBasis, onRefresh, showToast, canSeed, canEditRent}) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const [showRentReview, setShowRentReview] = useState(false)
  const [showBankConnect, setShowBankConnect] = useState(false)
  const [showBankInbox, setShowBankInbox] = useState(false)
  // Empty array = "all companies visible". Toggle pills below the header
  // to focus on a subset; identical UX to the dashboard's dashCoFilter.
  const [coFilter, setCoFilter] = useState([])

  // Search + optional filters (Rent Tracker stage 1). The text search uses
  // the shared matcher in lib/propertySearch (name, address, building,
  // unit, company, tenant name); status and arrears narrow further.
  // Tenancy status / payment source / payment plan / benefit type filters
  // are later stages and will sit alongside these.
  const [searchQ, setSearchQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [arrearsOnly, setArrearsOnly] = useState(false)
  const hasQuery = normaliseQuery(searchQ).length > 0
  const narrowing = hasQuery || statusFilter !== 'all' || arrearsOnly
  // Clearing a search brings the user back to the company and position they
  // were working through, not the top of the page.
  useScrollRestoreOnClear(narrowing)
  function clearSearchAndFilters() { setSearchQ(''); setStatusFilter('all'); setArrearsOnly(false) }

  // Properties the tracker shows at all: anything with payment history or
  // currently earning rent (the pre-existing rule, now applied once).
  const trackedProps = useMemo(
    () => properties.filter(p => p.rent_payments?.length>0 || isPropertyEarningRent(p.status)),
    [properties],
  )
  const visibleProps = useMemo(() => {
    const tokens = normaliseQuery(searchQ)
    return trackedProps.filter(p =>
      (statusFilter === 'all' || p.status === statusFilter) &&
      (!arrearsOnly || (Number(p.arrears)||0) > 0) &&
      matchesQuery(p, tokens))
  }, [trackedProps, searchQ, statusFilter, arrearsOnly])
  // Company pills on top of that
  const visCos = coFilter.length === 0 ? companies : companies.filter(c => coFilter.includes(c.id))
  const shownProps = visCos.flatMap(c => visibleProps.filter(p => p.company_id===c.id))

  // Global year filter - applies to all properties
  const allPayments = properties.flatMap(p=>p.rent_payments||[])
  const allYears = [...new Set(allPayments.map(p=>p.year))].sort()
  const [globalYear, setGlobalYear] = useState(() => defaultRentYear(allPayments))
  const [showReview, setShowReview] = useState(false)
  const [expandedCompanies, setExpandedCompanies] = useState({})

  function toggleCompany(id) {
    setExpandedCompanies(prev=>({...prev,[id]:!prev[id]}))
  }

  // Per-property year stats — shared month-collapsing helper
  const getStats = getMonthlyRentStats

  // Company totals for selected year
  function getCompanyTotals(companyProps, year) {
    const e = engineSummary(companyProps, year)
    return { paid: e.paid, due: e.due, missed: e.missed, nc: e.nc, backfill: e.backfill, income: e.received }
  }

  return (
    <div className="fade">
      {/* Header + global year filter */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:isMobile?8:12,marginBottom:isMobile?14:24}}>
        <div>
          <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?6:8}}>Rent Tracker</h1>
          <RentLegend collapsible={isMobile}/>
        </div>
        {/* Right side: year filter + day tracker button */}
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginRight:4}}>FILTER YEAR:</span>
            {[null,...allYears].map(yr=>(
              <button key={yr||'all'} onClick={()=>setGlobalYear(yr)}
                style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${globalYear===yr?T.gold:T.border}`,
                  background:globalYear===yr?T.gold:'transparent',
                  color:globalYear===yr?CV.onGold:T.muted,transition:'all 0.18s'}}>
                {yr||'All'}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowRentReview(true)}
            title="Plan rent review"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.green}`,background:T.green+'22',color:T.green,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:6}}>
            <Icon name="trending-up" size={13}/> {isMobile ? 'Review' : 'Plan rent review'}
          </button>
          <button onClick={()=>setShowBankConnect(true)}
            title="Connect bank (early access)"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.blue}`,background:T.blue+'22',color:T.blue,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:6}}>
            <Icon name="landmark" size={13}/> {isMobile ? 'Bank' : 'Connect bank'}
            <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.blue+'33',color:T.blue}}>SOON</span>
          </button>
          {/* Bank Inbox hidden while Open Banking integration is paused —
              we don't yet have an approved AISP partner (GoCardless paused
              signups, TrueLayer declined). Component + edge function code
              are preserved; flip this back on once a provider is sorted.
              The Connect button stays visible because its modal gracefully
              shows a "register interest" form when no creds are set, which
              is useful for gauging demand for the feature. */}
          {false && (
            <button onClick={()=>setShowBankInbox(true)}
              title="Review bank transactions & match to rent"
              style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${T.purple}`,background:(T.purple)+'22',color:T.purple,whiteSpace:'nowrap'}}>
              📥 {isMobile ? 'Inbox' : 'Bank inbox'}
            </button>
          )}
          <button onClick={onDayTracker}
            title="Day-by-day view"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.goldText,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:6}}>
            <Icon name="calendar" size={13}/> {isMobile ? 'Day' : 'Day view'}
          </button>
        </div>
      </div>

      {showBankConnect && <BankConnectionsModal onClose={()=>setShowBankConnect(false)}/>}
      {showBankInbox && <BankInboxModal onClose={()=>{setShowBankInbox(false); onRefresh?.()}} properties={properties} onMatched={onRefresh}/>}

      {/* Search + filters. Same input / pill styling as the Portfolio view. */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:narrowing?8:18}}>
        <div style={{flex:'1 1 240px',minWidth:0,maxWidth:'100%',position:'relative',display:'flex',alignItems:'center'}}>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Search rent tracker"
            placeholder={isMobile ? 'Search properties or tenants…' : 'Search name, address, building, unit or tenant…'}
            style={{flex:1,minWidth:0,width:'auto',padding:'8px 30px 8px 12px',fontSize:12}}/>
          {searchQ&&<button type="button" onClick={()=>setSearchQ('')} aria-label="Clear search" title="Clear search"
            style={{position:'absolute',right:6,background:'transparent',border:'none',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,padding:'2px 4px'}}>×</button>}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
          {isMobile ? (
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filter by property status"
              style={{fontFamily:MONO,fontSize:11,padding:'6px 10px',borderRadius:20,border:`1px solid ${statusFilter==='all'?T.border:T.gold}`,
                background:statusFilter==='all'?'transparent':T.gold+'22',color:statusFilter==='all'?T.muted:T.goldText,cursor:'pointer'}}>
              <option value="all">All Status</option>
              {PROPERTY_STATUSES.map(f=><option key={f} value={f}>{PROPERTY_STATUS_LABELS[f] || f}</option>)}
            </select>
          ) : ['all', ...PROPERTY_STATUSES].map(f=>(
            <button key={f} onClick={()=>setStatusFilter(f)} aria-pressed={statusFilter===f} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold:'transparent',color:statusFilter===f?CV.onGold:T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':(PROPERTY_STATUS_LABELS[f] || f)}</button>
          ))}
          <div style={{width:1,alignSelf:'stretch',background:T.border,margin:'0 2px'}}/>
          <button onClick={()=>setArrearsOnly(v=>!v)} aria-pressed={arrearsOnly} title="Only show properties with arrears"
            style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
              border:`1px solid ${arrearsOnly?T.red:T.border}`,background:arrearsOnly?T.red+'22':'transparent',color:arrearsOnly?T.red:T.muted,fontWeight:arrearsOnly?700:400}}>
            {arrearsOnly?'✓ ':''}⚠ Arrears
          </button>
          {/* Later stages: tenancy status / payment source / payment plan / benefit type filters go here. */}
        </div>
      </div>
      {narrowing && (
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginBottom:14,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <span>{shownProps.length} of {plural(trackedProps.length,'property','properties')} match{hasQuery ? ` "${searchQ.trim()}"` : ''}</span>
          <button type="button" onClick={clearSearchAndFilters}
            style={{fontFamily:MONO,fontSize:FS.xs,background:'transparent',border:'none',cursor:'pointer',color:T.goldText,padding:0,textDecoration:'underline'}}>Clear</button>
        </div>
      )}

      {/* Portfolio rent summary tiles (respects the company filter, search, status / arrears filters + year) */}
      {(() => {
        const visProps = shownProps
        if (!visProps.length) return null
        const agg = visProps.reduce((a,p)=>{ const s=getStats(p.rent_payments||[], globalYear, p.rent_pcm); a.paid+=s.paid; a.paidToDate+=s.paidToDate; a.missed+=s.missed; a.late+=s.late; a.voidM+=s.voidM; a.income+=s.income; return a }, {paid:0,paidToDate:0,missed:0,late:0,voidM:0,income:0})
        // Collection rate counts VOID months against the portfolio: of every
        // month that has happened so far (paid / missed / late / void), how
        // many actually paid. Future months are excluded on both sides —
        // pre-created future voids aren't losses yet, and prepaid future STL
        // bookings aren't collections yet. Refurb months are deliberately
        // out (not lettable).
        const rate = legacyCollectionRate(agg)
        const fmtPct = v => v == null ? '—' : `${v}%`
        // Stage 4: for the go-live year onwards the tiles come from the rent
        // engine (value-based, due-date aware, STL and non-collectible
        // excluded). Earlier years keep the legacy month count, labelled.
        const nowYear = new Date().getFullYear()
        const legacyYear = !!globalYear && globalYear < Number(GO_LIVE.slice(0,4))
        const ps = legacyYear ? null : portfolioStats(visProps.filter(p=>p.status!=='short_term_let'), { year: globalYear || nowYear })
        const tiles = legacyYear ? [
          { label: `Collected · ${globalYear} · legacy data`, value: fmt(agg.income), accent: T.green },
          { label: 'Collection rate · legacy month count', value: rate === null ? '—' : `${rate}%`, accent: rate === null ? T.muted : rate>=95?T.green:rate>=85?T.amber:T.red },
          { label: 'Months paid', value: agg.paid, accent: T.text },
          { label: 'Missed / late / void', value: `${agg.missed} / ${agg.late} / ${agg.voidM}`, accent: (agg.missed>0)?T.red:(agg.late>0)?T.amber:T.muted },
        ] : [
          { label: `Collection rate · ${globalYear || nowYear} to date`, value: fmtPct(ps.ytd.rate), accent: ps.ytd.rate == null ? T.muted : ps.ytd.rate>=95?T.green:ps.ytd.rate>=85?T.amber:T.red,
            sub: `Month to date ${fmtPct(ps.mtd.rate)} · ${ps.ytd.periods} periods due` },
          { label: 'Collectible rent due', value: fmt(ps.ytd.due), accent: T.text, sub: `due to date · ${fmt(ps.ytd.notYetDue)} scheduled, not yet due · ${ps.ytd.counts.not_collectible} not collectible${ps.ytd.counts.duplicates ? ` (${ps.ytd.counts.duplicates} duplicate placeholders)` : ''}` },
          { label: 'Current rent received', value: fmt(ps.ytd.received), accent: T.green, sub: `${ps.ytd.excess > 0 ? `+${fmt(ps.ytd.excess)} over the rent on single periods (not netted off) · ` : ''}${ps.needsBackfill.length} paid with no amount · ${fmt(ps.ytd.needsInfo)} unverified (needs information)` },
          { label: 'Current rent outstanding', value: fmt(ps.ytd.outstanding), accent: ps.ytd.outstanding > 0 ? T.red : T.green,
            sub: `${fmt(ps.ytd.overdue)} overdue (${ps.ytd.counts.missed} missed) · ${fmt(ps.ytd.inWindow + ps.ytd.dueToday)} in payment window · pending review ${fmt(ps.ytd.pendingReview)} · combined ${fmt(ps.ytd.combined)} · historic arrears ${fmt(ps.arrears.balance)}${ps.arrears.unmatched ? ` (+${fmt(ps.arrears.unmatched)} paid with no opening balance)` : ''}${ps.arrears.overlap ? ` · ${fmt(ps.arrears.overlap)} arrears dated after 1 Jan 2026 not added (already in rent above)` : ''}` },
        ]
        return (
          <div className="summary-cards" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:isMobile?14:20}}>
            {tiles.map(t=>(
              <div key={t.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'16px 18px'}}>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{t.label}</div>
                <div style={{fontFamily:MONO,fontSize:20,fontWeight:500,color:t.accent,letterSpacing:'-0.01em'}}>{t.value}</div>
                {t.sub && <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginTop:4}}>{t.sub}</div>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Receipts awaiting a human decision (Stage 5) */}
      {(() => {
        const pending = shownProps.flatMap(p => p.rent_receipts || []).filter(r => r.review_status === 'needs_review')
        if (!pending.length) return null
        return (
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:'10px 14px',border:`1px solid ${T.amber}55`,background:T.amber+'12',borderRadius:12}}>
            <span style={{fontFamily:MONO,fontSize:11,color:T.amber,fontWeight:700}}>{pending.length} receipt{pending.length===1?'':'s'} to review</span>
            <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>unallocated money or possible duplicates, held until someone decides</span>
            <button className="btn btn-gold" style={{fontSize:11,marginLeft:'auto'}} onClick={()=>setShowReview(true)}>Review</button>
          </div>
        )
      })()}
      {showReview && <ReviewQueuePanel companies={visCos} properties={shownProps} companyIds={visCos.map(c=>c.id)} canEdit={visCos.some(c=>canEditRent?.(c.id))} showToast={showToast} onClose={()=>setShowReview(false)} onChanged={onRefresh}/>}

      {/* Company filter pills (only render if there's more than one
          company to choose from — saves vertical space for solo landlords) */}
      {companies.length > 1 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:18}}>
          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
          <button onClick={()=>setCoFilter([])}
            style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
              border:`1px solid ${coFilter.length===0?T.gold:T.border}`,
              background:coFilter.length===0?T.gold:'transparent',
              color:coFilter.length===0?CV.onGold:T.muted,fontWeight:coFilter.length===0?700:400}}>
            All companies
          </button>
          {companies.map(c => {
            const sel = coFilter.includes(c.id)
            return (
              <button key={c.id}
                onClick={()=>setCoFilter(prev => {
                  if (prev.length === 0) return [c.id]  // was 'all' → focus this one
                  if (prev.includes(c.id)) {
                    const next = prev.filter(id => id !== c.id)
                    return next  // deselecting → may end up at [] = all
                  }
                  const next = [...prev, c.id]
                  return next.length === companies.length ? [] : next  // all selected → snap back to 'all'
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

      {/* Companies — filtered by the pill row above, then by search / status / arrears */}
      {visCos.map(c=>{
        // Short-term lets are reported under Short-Term Let Income, not here.
        const cps = visibleProps.filter(p=>p.company_id===c.id&&p.status!=='short_term_let')
        if (!cps.length) return null
        const totals = getCompanyTotals(cps, globalYear)
        // Default open; while a search is active every company with a
        // match is forced open so results are never hidden in a collapsed
        // accordion.
        const isOpen = hasQuery || expandedCompanies[c.id] !== false

        return (
          <div key={c.id} style={{marginBottom:20}}>
            {/* Company header - clickable to collapse */}
            <div {...pressable(()=>toggleCompany(c.id), { 'aria-expanded': isOpen })}
              style={{display:'flex',alignItems:'center',gap:10,marginBottom:isOpen?12:0,cursor:'pointer',
                background:T.card,border:`1px solid ${T.border}`,borderRadius:isOpen?'12px 12px 0 0':'12px',
                padding:'14px 18px',transition:'border-radius 0.2s'}}>
              <div style={{width:3,height:20,background:c.color,borderRadius:2,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <h2 style={{fontSize:15,fontWeight:700}}>{c.name}</h2>
                  <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{plural(cps.length,'property','properties')}</span>
                  {(() => {
                    // Tenancy coverage for this company: how many earning units
                    // still have no tenancy record, and how many drafts await a
                    // human. Seeding creates DRAFTS only (needs_confirmation).
                    const missing = cps.filter(p => propertyNeedsTenancy(p.status) && !(p.tenancies||[]).length).length
                    const drafts = cps.filter(p => (p.tenancies||[]).some(t => t.needs_confirmation)).length
                    return (<>
                      {drafts>0 && <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.amber}}>{drafts} tenanc{drafts===1?'y':'ies'} to confirm</span>}
                      {missing>0 && canSeed?.(c.id) && (
                        <button onClick={async e=>{ e.stopPropagation();
                            try { const r = await api.seedTenanciesFromProperties(c.id, properties)
                              showToast?.(`${r.created} draft tenanc${r.created===1?'y':'ies'} created${r.skipped?`, ${r.skipped} already had one`:''}${r.failed.length?`, ${r.failed.length} failed`:''}. Confirm each in the property's Tenancy tab.`)
                              onRefresh?.() } catch(err) { showToast?.(err.message||'Seeding failed','error') } }}
                          style={{fontFamily:MONO,fontSize:FS.xs,padding:'2px 8px',borderRadius:20,border:`1px solid ${T.gold}66`,background:T.gold+'14',color:T.goldText,cursor:'pointer'}}
                          title="Create a draft tenancy for every rented unit from its property fields">
                          Seed {missing} tenanc{missing===1?'y':'ies'}
                        </button>
                      )}
                    </>)
                  })()}
                </div>
              </div>
              {/* Company summary for selected year */}
              <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
                {[
                  {v:totals.paid,   c:T.green, l:'paid'},
                  {v:totals.due,    c:T.amber, l:'due'},
                  {v:totals.missed, c:T.red,   l:'missed'},
                  {v:totals.nc,     c:T.faint, l:'not collectible'},
                  {v:totals.backfill, c:T.amber, l:'need amount'},
                ].filter(x=>x.v>0).map(x=>(
                  <span key={x.l} style={{fontFamily:MONO,fontSize:11,color:x.c,fontWeight:600}}>
                    {x.v} {x.l}
                  </span>
                ))}
                <span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.goldText}}>{fmt(totals.income)}</span>
                <span style={{fontFamily:MONO,fontSize:12,color:T.muted}}>{isOpen?'▲':'▼'}</span>
              </div>
            </div>

            {/* Property rows — grouped by building when 2+ units share a
                name suffix (e.g. "Room 1, Piers View" + "Room 10, Piers
                View"). Single properties render flat as before. */}
            {isOpen&&<div style={{border:`1px solid ${T.border}`,borderTop:'none',borderRadius:'0 0 12px 12px',overflow:'hidden'}}>
              {(() => {
                // Group consecutive properties by shared building tail
                const groups = []
                const indexByTail = new Map()
                for (const p of cps) {
                  const tail = buildingTailFromName(p.name)
                  const key = buildingKeyFromName(p.name) || `__solo__${p.id}`
                  if (!indexByTail.has(key)) {
                    indexByTail.set(key, groups.length)
                    groups.push({ key, name: tail, items: [] })
                  }
                  groups[indexByTail.get(key)].items.push(p)
                }

                // Natural-sort items inside each multi-unit building so
                // "Flat 1, 2, 3, 10" reads correctly instead of the
                // lexical "1, 10, 2, 3". Single-property groups are
                // untouched (the parent properties list already controls
                // their order via sort_order / name).
                for (const g of groups) {
                  if (g.items.length > 1) {
                    g.items.sort((a, b) => naturalCompare(a.name, b.name))
                  }
                }

                // Flat index for row striping across the whole company
                let rowIdx = 0
                const totalRows = cps.length

                return groups.map((group) => {
                  const isBuilding = group.items.length > 1
                  // Sum building-level totals for the header: nominal rent roll
                  // plus actual collected revenue for the selected year — the
                  // "whole block" line for multi-unit buildings (HMOs, STL
                  // blocks like Piers View).
                  const bgRent = group.items.reduce((s,p) => s + (Number(p.rent_pcm)||0), 0)
                  const bgE = engineSummary(group.items, globalYear)
                  const bgStats = { income: bgE.received, paid: bgE.paid, missed: bgE.missed, late: bgE.due }
                  return (
                    <div key={group.key}>
                      {isBuilding && (
                        <div style={{
                          padding: '10px 18px', background: T.bg,
                          borderBottom: `1px solid ${T.border}`,
                          display: 'flex', alignItems: 'center', gap: 10,
                          flexWrap: 'wrap',
                          fontFamily: MONO,
                        }}>
                          <span style={{ fontSize: 14 }} aria-hidden="true">🏘</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                            {group.name}
                          </span>
                          <span style={{ fontSize: FS.xs, color: T.muted }}>
                            · {plural(group.items.length,'unit')} · {fmt(bgRent)}/mo
                          </span>
                          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                            {bgStats.missed > 0 && (
                              <span style={{ fontSize: FS.xs, fontWeight: 700, color: T.red }}>{bgStats.missed} missed</span>
                            )}
                            {bgStats.late > 0 && (
                              <span style={{ fontSize: FS.xs, fontWeight: 700, color: T.amber }}>{bgStats.late} due</span>
                            )}
                            <span style={{ fontSize: FS.xs, color: T.muted }}>
                              {globalYear ? `${globalYear} revenue` : 'all-years revenue'}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: T.goldText }}>
                              {fmt(bgStats.income)}
                            </span>
                          </span>
                        </div>
                      )}
                      {group.items.map((p) => {
                        const pi = rowIdx++
                        const s = getStats(p.rent_payments||[], globalYear, p.rent_pcm)
                        return (
                          <div key={p.id}
                            style={{padding:`14px 18px 14px ${isBuilding ? (isMobile ? 22 : 30) : 18}px`,borderBottom:pi<totalRows-1?`1px solid ${T.border}`:'none',
                              background:pi%2===0?T.card:T.surface,cursor:'pointer',transition:'background 0.15s',
                              borderLeft: isBuilding ? `2px solid ${T.gold}33` : 'none',
                              marginLeft: isBuilding ? (isMobile ? 10 : 14) : 0,
                            }}
                            {...pressable(()=>openDetail(p))}
                            onMouseEnter={e=>e.currentTarget.style.background=T.border}
                            onMouseLeave={e=>e.currentTarget.style.background=pi%2===0?T.card:T.surface}>
                            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                              {/* Left: name + dots */}
                              <div style={{flex:1,minWidth:200}}>
                                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                                  <span style={{fontSize:13,fontWeight:600}}>
                                    {/* When grouped under a building, drop the redundant
                                        building suffix from each row's display name —
                                        unless a search is active, when the full name is
                                        what tells "Flat 1" apart from its namesakes. */}
                                    {isBuilding && !hasQuery ? (p.name.split(',')[0].trim() || p.name) : p.name}
                                  </span>
                                  {hasQuery && p.company && (
                                    <span title={p.company.name}
                                      style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:700,padding:'1px 6px',borderRadius:10,
                                        border:`1px solid ${(p.company.color||T.gold)}55`,background:(p.company.color||T.gold)+'22',color:p.company.color||T.goldText}}>
                                      {p.company.abbr || p.company.name}
                                    </span>
                                  )}
                                  {(p.arrears||0)>0&&<span style={{fontFamily:MONO,fontSize:FS.xs,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</span>}
                                </div>
                                {hasQuery && (p.address || p.tenant_name) && (
                                  <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginBottom:3,overflowWrap:'anywhere'}}>
                                    {p.address}{p.address && p.tenant_name ? ' · ' : ''}{p.tenant_name ? `Tenant: ${p.tenant_name}` : ''}
                                  </div>
                                )}
                                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginBottom:6}}>
                                  {`${fmt(p.rent_pcm)}/mo`} · Due {p.rent_due_day||'-'}
                                </div>
                                <RentDots payments={p.rent_payments||[]} stlIds={stlPaymentIds(p)} filterYear={globalYear} onDayTracker={onDayTracker} property={p} canEdit={canEditRent?.(p.company_id)} onChanged={onRefresh} showToast={showToast}/>
                              </div>
                              {/* Right: stats + badge */}
                              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                                <Badge status={p.status}/>
                                <div style={{display:'flex',gap:10,flexWrap:'wrap',justifyContent:'flex-end'}}>
                                  {(() => { const e = engineSummary([p], globalYear); return [
                                    {v:e.paid,   c:T.green, l:'paid'},
                                    {v:e.due,    c:T.amber, l:'due'},
                                    {v:e.missed, c:T.red,   l:'missed'},
                                    {v:e.nc,     c:T.faint, l:'n/c'},
                                  ] })().map(x=>(
                                    <span key={x.l} style={{fontFamily:MONO,fontSize:FS.xs,color:x.v>0?x.c:T.faint}} title={x.l==='n/c'?'not collectible (vacant, refurbishment, before or after the tenancy)':x.l}>
                                      {x.v} {x.l}
                                    </span>
                                  ))}
                                </div>
                                <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.goldText}} title="Received this year (amounts entered)">
                                  {fmt(engineSummary([p], globalYear).received)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              })()}
            </div>}
          </div>
        )
      })}

      {/* Empty / no-results states */}
      {properties.length === 0 ? (
        <div style={{fontFamily:MONO,color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
          No properties yet. Add a property on the Portfolio view to start tracking rent.
        </div>
      ) : trackedProps.length === 0 ? (
        <div style={{fontFamily:MONO,color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
          No properties are tracking rent yet. Set a property to Rented or log a payment and it will appear here.
        </div>
      ) : shownProps.length === 0 && (
        <div style={{fontFamily:MONO,color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
          {hasQuery ? <>No properties match <span style={{color:T.text}}>"{searchQ.trim()}"</span></> : 'No properties match these filters'}
          {coFilter.length > 0 ? ' in the selected companies.' : '.'}
          {narrowing && (
            <><br/><button type="button" className="btn btn-ghost" style={{fontSize:11,marginTop:12}} onClick={clearSearchAndFilters}>Clear search &amp; filters</button></>
          )}
        </div>
      )}

      {showRentReview && (
        <RentReviewModal
          properties={properties}
          companies={companies}
          fmt={fmt}
          yieldBasis={yieldBasis}
          onClose={()=>setShowRentReview(false)}
        />
      )}
    </div>
  )
}
