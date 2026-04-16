import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { AIListingWriter, ListingYieldCalculator } from './AITools'
import LettingsPipeline from './LettingsPipeline'
import * as api from '../lib/api'

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
const fmtPct = n => (n||0).toFixed(1) + '%'
const mono = "'DM Mono',monospace"

const STATUS_CFG = {
  analysing:  { label:'Analysing',   color:'#4B8FE0' },
  offer_made: { label:'Offer made',  color:'#E0943A' },
  under_offer:{ label:'Under offer', color:'#9B59B6' },
  exchanged:  { label:'Exchanged',   color:'#C8A84B' },
  completed:  { label:'Completed',   color:'#2ECC8A' },
  dead:       { label:'Dead',        color:'#E05555' },
}

const DEAL_TYPES = ['btl','hmo','sa','brrr']
const DEAL_TYPE_LABELS = { btl:'Buy-to-Let', hmo:'HMO', sa:'Serviced Apartment', brrr:'BRRR' }
const PURCHASE_TYPES = { cash:'Cash', mortgage:'Mortgage', bridge:'Bridging Finance' }
const CONTACT_ROLES = { solicitor:'Solicitor', estate_agent:'Estate Agent', mortgage_broker:'Mortgage Broker', surveyor:'Surveyor', other:'Other' }

const STAGE_LABELS = {
  offer:'Offer Stage', professionals:'Instructing Professionals',
  legal:'Legal Due Diligence', exchange:'Exchange',
  completion:'Completion & Post-Completion',
  pre_auction:'Pre-Auction', auction_day:'Auction Day (Exchange)',
  brrr:'BRRR — Refinance Stage',
}

// ── MODULE-LEVEL COMPONENTS (outside DealsPage to prevent focus loss) ─────────
function InputRow({ label, field, type='number', prefix='£', suffix='', min=0, step=1, placeholder='', form, set, T }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontFamily:mono,fontSize:12,color:T.text}}>{label}</span>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        {prefix && <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{prefix}</span>}
        <input
          type={type}
          value={form[field] ?? ''}
          min={min}
          step={step}
          placeholder={placeholder}
          onChange={e => set(field, type==='number' ? e.target.value : e.target.value)}
          onBlur={e => { if (type==='number') set(field, parseFloat(e.target.value) || 0) }}
          style={{fontFamily:mono,fontSize:13,width:100,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:'5px 8px',textAlign:'right',outline:'none'}}
        />
        {suffix && <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{suffix}</span>}
      </div>
    </div>
  )
}

function ResultRow({ label, value, color, big, T }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontFamily:mono,fontSize:big?13:11,color:T.muted}}>{label}</span>
      <span style={{fontFamily:mono,fontSize:big?18:13,fontWeight:big?700:600,color:color||T.text}}>{value}</span>
    </div>
  )
}

// ── PORTFOLIO MODELLER (DEALS PAGE) ──────────────────────────────────────────
function PortfolioModellerInDeals({ properties = [], T }) {
  const [extra, setExtra]   = useState(5)
  const [price, setPrice]   = useState(175000)
  const [yld, setYld]       = useState(6.5)
  const [yrs, setYrs]       = useState(10)
  const [growth, setGrowth] = useState(3)

  const currentIncome = properties.reduce((s,p) => s + (p.rent_pcm||0)*12, 0)
  const currentValue  = properties.reduce((s,p) => s + (p.current_value||p.est_value||0), 0)
  const newIncome     = extra * price * (yld/100)
  const totalIncome   = currentIncome + newIncome
  const totalValue    = currentValue + (extra * price)
  const futureValue   = totalValue * Math.pow(1 + growth/100, yrs)
  const futureIncome  = totalIncome * Math.pow(1.02, yrs)
  const f = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

  const sliders = [
    {label:'Additional properties to buy', min:0, max:50, step:1, val:extra, set:setExtra, suffix:' properties'},
    {label:'Average purchase price', min:50000, max:1000000, step:5000, val:price, set:setPrice, prefix:'£', fmt:true},
    {label:'Target gross yield', min:2, max:15, step:0.5, val:yld, set:setYld, suffix:'%'},
    {label:'Annual capital growth', min:0, max:10, step:0.5, val:growth, set:setGrowth, suffix:'%'},
    {label:'Time horizon', min:1, max:30, step:1, val:yrs, set:setYrs, suffix:' years'},
  ]

  return (
    <div style={{background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 22px'}}>
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:16}}>
        <span style={{fontSize:20}}>📈</span>
        <div>
          <div style={{fontSize:14, fontWeight:700, color:T.text}}>Portfolio what-if modeller</div>
          <div style={{fontFamily:mono, fontSize:11, color:T.muted}}>Drag the sliders to model different acquisition strategies</div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:14, marginBottom:16}}>
        {sliders.map(s => (
          <div key={s.label}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:5}}>
              <span style={{fontFamily:mono, fontSize:11, color:T.muted}}>{s.label}</span>
              <span style={{fontFamily:mono, fontSize:13, fontWeight:700, color:T.gold}}>
                {s.prefix||''}{s.fmt ? parseInt(s.val).toLocaleString('en-GB') : s.val}{s.suffix||''}
              </span>
            </div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
              onChange={e => s.set(parseFloat(e.target.value))}
              style={{width:'100%', accentColor:T.gold}}/>
          </div>
        ))}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10}}>
        {[
          {label:'Current portfolio', value:f(currentIncome)+'/yr', sub:f(currentValue)+' value · '+properties.length+' properties', color:T.muted},
          {label:'After buying '+extra+' more', value:f(totalIncome)+'/yr', sub:f(totalValue)+' combined value', color:'#2ECC8A'},
          {label:'Monthly take-home now', value:f(currentIncome/12)+'/mo', sub:'gross, before costs', color:T.text},
          {label:'Monthly take-home after', value:f(totalIncome/12)+'/mo', sub:'gross, before costs', color:'#2ECC8A'},
          {label:'In '+yrs+' years ('+growth+'% growth)', value:f(futureIncome/12)+'/mo', sub:f(futureValue)+' portfolio', color:'#C8A84B'},
        ].map(k => (
          <div key={k.label} style={{background:T.bg, borderRadius:10, padding:'12px 14px', borderLeft:`3px solid ${k.color}`}}>
            <div style={{fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:16, fontWeight:800, color:k.color, marginBottom:2}}>{k.value}</div>
            <div style={{fontFamily:mono, fontSize:10, color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:mono, fontSize:10, color:T.muted, marginTop:12}}>
        Gross rental income only. Does not deduct void periods, management fees, maintenance or tax. Capital growth is compound annual. Rent growth assumed 2%/yr.
      </div>
    </div>
  )
}

export default function DealsPage({ user, companies, properties = [], onConvertToProperty, showToast }) {
  const { T } = useTheme()
  const [view, setView]       = useState('list')
  const [dealView, setDealView] = useState('list') // list | pipeline | tools // list | deal
  const [deals, setDeals]     = useState([])
  const [selectedDeal, setSelectedDeal] = useState(null)
  const [dealTab, setDealTab] = useState('calculator')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [compareIds, setCompareIds] = useState([])
  const [showCompare, setShowCompare] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [coFilter, setCoFilter] = useState('all')
  const [triggerNewLetting, setTriggerNewLetting] = useState(false)

  useEffect(() => { loadDeals() }, [])

  async function loadDeals() {
    setLoading(true)
    try {
      const data = await api.fetchDeals(user.id)
      setDeals(data)
    } catch(e) {}
    setLoading(false)
  }

  async function createNewDeal() {
    try {
      const deal = await api.createDeal(user.id, {
        name: 'New Deal',
        company_id: companies?.length === 1 ? companies[0]?.id : null,
      })
      // Load user's master milestone defaults then initialise
      const milestoneConfig = await api.fetchMilestoneDefaults(user.id).catch(()=>({}))
      api.initialiseMilestones(deal.id, false, false, milestoneConfig).catch(()=>{})
      setDeals(prev => [deal, ...prev])
      setSelectedDeal({ ...deal })
      setView('deal')
    } catch(e) { showToast(e.message, 'error') }
  }

  async function saveDealField(field, value) {
    if (!selectedDeal) return
    try {
      const updated = await api.updateDeal(selectedDeal.id, { [field]: value })
      setSelectedDeal(updated)
      setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
    } catch(e) {}
  }

  async function saveDeal(fields) {
    if (!selectedDeal) return
    setSaving(true)
    try {
      const updated = await api.updateDeal(selectedDeal.id, fields)
      setSelectedDeal(updated)
      setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
      showToast('Deal saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  async function deleteDeal(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    try {
      await api.deleteDeal(id)
      setDeals(prev => prev.filter(d => d.id !== id))
      if (selectedDeal?.id === id) { setSelectedDeal(null); setView('list') }
      showToast('Deal deleted')
    } catch(e) { showToast(e.message, 'error') }
  }

  async function duplicateDeal(deal) {
    try {
      const copy = await api.duplicateDeal(deal)
      await api.initialiseMilestones(copy.id, copy.is_auction, copy.deal_type === 'brrr')
      setDeals(prev => [copy, ...prev])
      showToast('Deal duplicated')
    } catch(e) { showToast(e.message, 'error') }
  }

  function openDeal(deal) {
    setSelectedDeal(deal)
    setDealTab('calculator')
    setView('deal')
  }

  const filtered = useMemo(() => deals.filter(d => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (coFilter !== 'all' && d.company_id !== coFilter) return false
    return true
  }), [deals, statusFilter, coFilter])


  // ── card / style helpers ────────────────────────────────────────────────────
  const card = { background: T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 22px' }
  const sect = { fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8, display:'block' }
  const tabBtn = (k) => ({
    fontFamily:mono, fontSize:11, padding:'7px 16px', borderRadius:8, border:'none',
    cursor:'pointer', background: dealTab===k ? T.gold+'22' : 'transparent',
    color: dealTab===k ? T.gold : T.muted, fontWeight: dealTab===k ? 700 : 400,
  })

  // ── DEAL DETAIL VIEW ────────────────────────────────────────────────────────
  if (view === 'deal' && selectedDeal) return (
    <DealDetail
      key={selectedDeal.id}
      deal={selectedDeal}
      companies={companies}
      user={user}
      showToast={showToast}
      onBack={()=>{ setView('list') }}
      onSave={saveDeal}
      onDelete={()=>deleteDeal(selectedDeal.id)}
      onConvert={onConvertToProperty}
    />
  )

  // ── UNIFIED SHELL (sub-nav always visible) ───────────────────────────────────
  const newBtnLabel = dealView==='lettings' ? '+ New letting' : '+ New Deal'
  function handleNewBtn() {
    if (dealView==='lettings') setTriggerNewLetting(true)
    else createNewDeal()
  }

  return (
    <div className="fade">
      {/* Header — identical layout on every tab, nothing moves */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:28,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Deals</h1>
          <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>
            {dealView==='list'
              ? `${deals.length} deal${deals.length!==1?'s':''} · ${deals.filter(d=>d.status==='under_offer').length} under offer`
              : dealView==='pipeline' ? 'Deal pipeline board'
              : dealView==='lettings' ? 'Track lettings from vacant to moved in'
              : 'AI tools & calculators'}
          </p>
        </div>
        {/* Right side: tab switcher + action button — always same elements, never changes width */}
        <div style={{display:'flex',gap:10,alignItems:'center',flexShrink:0}}>
          {compareIds.length >= 2 && dealView==='list' && (
            <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setShowCompare(true)}>
              📊 Compare ({compareIds.length})
            </button>
          )}
          <div style={{display:'flex',background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,overflow:'hidden'}}>
            {[['list','☰ List'],['pipeline','📋 Pipeline'],['lettings','🏠 Lettings'],['tools','✨ Tools']].map(([k,l])=>(
              <button key={k} onClick={()=>setDealView(k)}
                style={{fontFamily:mono,fontSize:11,padding:'7px 14px',border:'none',cursor:'pointer',
                  background:dealView===k?T.gold:'transparent',
                  color:dealView===k?'white':T.muted,
                  fontWeight:dealView===k?700:400,
                  transition:'all 0.15s'}}>
                {l}
              </button>
            ))}
          </div>
          {/* Action button — always present, label changes but width stays the same */}
          <button className="btn btn-gold" onClick={handleNewBtn}
            style={{whiteSpace:'nowrap',minWidth:110}}>
            {newBtnLabel}
          </button>
        </div>
      </div>

      {/* ── PIPELINE VIEW ── */}
      {dealView==='pipeline' && <DealPipeline deals={filtered} companies={companies} onOpen={openDeal} onNew={createNewDeal} T={T}/>}

      {/* ── LETTINGS VIEW ── */}
      {dealView==='lettings' && <LettingsPipeline user={user} companies={companies} properties={properties} showToast={showToast} triggerNew={triggerNewLetting} onNewHandled={()=>setTriggerNewLetting(false)}/>}

      {/* ── TOOLS VIEW ── */}
      {dealView==='tools' && (
        <div style={{display:'grid',gap:16}}>
          <ListingYieldCalculator T={T} onAutoFill={()=>{ createNewDeal(); showToast('New deal created — fill in the figures from the listing') }}/>
          <PortfolioModellerInDeals properties={properties} T={T}/>
          <AIListingWriter T={T}/>
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {dealView==='list' && <div>

      {/* Filters - only show on list view */}
      {dealView === 'list' && <div style={{display:'flex',gap:10,marginBottom:4,flexWrap:'wrap',fontSize:11}}><span style={{fontFamily:mono,color:T.muted,fontSize:10,alignSelf:'center'}}>List view · {filtered.length} deals</span></div>}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CFG).map(([k,v])=>(<option key={k} value={k}>{v.label}</option>))}
        </select>
        {companies.length > 1 && (
          <select value={coFilter} onChange={e=>setCoFilter(e.target.value)}
            style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
            <option value="all">All companies</option>
            <option value="">Unassigned</option>
            {companies.map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        )}
      </div>

      {loading
        ? <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center'}}>Loading deals…</div>
        : filtered.length === 0
          ? <div className="card" style={{padding:48,textAlign:'center'}}>
              <div style={{fontSize:36,marginBottom:12}}>🎯</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.muted,marginBottom:16}}>No deals yet. Add your first deal to analyse.</div>
              <button className="btn btn-gold" onClick={createNewDeal}>+ Add Deal</button>
            </div>
          : <div style={{display:'grid',gap:12}}>
              {filtered.map(deal => {
                const co = companies.find(c=>c.id===deal.company_id)
                const sc = STATUS_CFG[deal.status]||STATUS_CFG.analysing
                const sd = deal.stamp_duty_override ?? api.calcStampDuty(deal.purchase_price, deal.is_additional_property, deal.is_first_time_buyer)
                const totalCost = (deal.purchase_price||0)+sd+(deal.legal_fees||0)+(deal.survey_cost||0)+(deal.auction_fees||0)+(deal.broker_fee||0)+(deal.refurb_cost||0)+(deal.other_costs||0)
                const deposit = deal.purchase_type==='cash' ? deal.purchase_price : (deal.purchase_price||0)*(deal.deposit_percent||25)/100
                const cashIn = Math.max(0, totalCost - (deal.purchase_price||0)*(1-(deal.deposit_percent||25)/100))
                const grossRent = deal.deal_type==='hmo'
                  ? (deal.hmo_rooms||4)*(deal.hmo_rent_per_room||0)
                  : deal.deal_type==='sa'
                    ? (deal.sa_nightly_rate||0)*(deal.sa_occupancy_percent||70)/100*30.4
                    : (deal.monthly_rent||0)
                const grossYield = deal.purchase_price > 0 ? (grossRent*12/deal.purchase_price)*100 : 0
                const monthlyRepayment = deal.purchase_type !== 'cash'
                  ? api.calcMonthlyRepayment((deal.purchase_price||0)*(1-(deal.deposit_percent||25)/100), deal.mortgage_rate||5, deal.mortgage_term||25)
                  : 0
                const effectiveRent = grossRent*(1-(deal.void_percent||8)/100)
                const agentVatMult = (deal.agent_fee_vat||'ex_vat')==='ex_vat' ? 1.2 : 1.0
                const runningCosts = effectiveRent*((deal.agent_fee_percent||10)*agentVatMult/100 + (deal.maintenance_percent||10)/100) + (deal.insurance_monthly||0) + (deal.service_charge_monthly||0) + monthlyRepayment
                const monthlyProfit = effectiveRent - runningCosts
                const inCompare = compareIds.includes(deal.id)

                return (
                  <div key={deal.id} className="card" style={{padding:'18px 20px',borderLeft:`3px solid ${sc.color}`,cursor:'pointer',transition:'transform 0.18s'}}
                    onMouseEnter={e=>e.currentTarget.style.transform='translateY(-1px)'}
                    onMouseLeave={e=>e.currentTarget.style.transform='none'}
                    onClick={()=>openDeal(deal)}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                          <span style={{fontSize:15,fontWeight:700,color:T.text}}>{deal.name}</span>
                          <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:sc.color+'22',color:sc.color}}>{sc.label}</span>
                          {co && <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B'}}>{co.abbr}</span>}
                          <span style={{fontFamily:mono,fontSize:10,color:T.muted}}>{DEAL_TYPE_LABELS[deal.deal_type]||'BTL'}{deal.is_auction?' · Auction':''}</span>
                        </div>
                        {deal.address && <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:8}}>{deal.address}</div>}
                        <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                          <div><div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Purchase</div><div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.text}}>{fmt(deal.purchase_price)}</div></div>
                          <div><div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Gross yield</div><div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:grossYield>=6?T.green:grossYield>=4?T.amber:T.red}}>{fmtPct(grossYield)}</div></div>
                          <div><div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Mo. profit</div><div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:monthlyProfit>0?T.green:T.red}}>{fmt(monthlyProfit)}</div></div>
                          <div><div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Cash in</div><div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.text}}>{fmt(cashIn)}</div></div>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>openDeal(deal)}
                          style={{fontFamily:mono,fontSize:10,padding:'4px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold}}>
                          Edit →
                        </button>
                        <button onClick={()=>setCompareIds(prev=>inCompare?prev.filter(id=>id!==deal.id):prev.length<3?[...prev,deal.id]:prev)}
                          style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',
                            border:`1px solid ${inCompare?T.gold:T.border}`,background:inCompare?T.gold+'22':'transparent',color:inCompare?T.gold:T.muted}}>
                          {inCompare?'✓ Compare':'Compare'}
                        </button>
                        <button onClick={()=>duplicateDeal(deal)}
                          style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                          Copy
                        </button>
                        <button onClick={()=>deleteDeal(deal.id)}
                          style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
      }

      {/* Compare modal */}
      {showCompare && compareIds.length >= 2 && (
        <CompareModal deals={deals.filter(d=>compareIds.includes(d.id))} companies={companies} onClose={()=>setShowCompare(false)}/>
      )}
      </div>}
    </div>
  )


}

// ── DEAL DETAIL ────────────────────────────────────────────────────────────────
function DealDetail({ deal, companies, user, showToast, onBack, onSave, onDelete, onConvert }) {
  const { T } = useTheme()
  const [tab, setTab]     = useState('calculator')
  const [form, setForm]   = useState(deal ? { ...deal } : {})
  const [saving, setSaving] = useState(false)

  if (!deal) return null

  const sect = { fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8, display:'block' }
  const sectionCard = { background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 22px' }

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))
  const num = (field) => parseFloat(form[field]) || 0

  // ── CALCULATIONS ────────────────────────────────────────────────────────────
  const sd = form.stamp_duty_override != null
    ? num('stamp_duty_override')
    : api.calcStampDuty(num('purchase_price'), form.is_additional_property, form.is_first_time_buyer)

  const loanAmount = form.purchase_type === 'cash' ? 0 : num('purchase_price') * (1 - num('deposit_percent') / 100)
  const deposit = num('purchase_price') - loanAmount
  const mortgageFee = form.purchase_type !== 'cash' ? loanAmount * (num('mortgage_fee_percent') / 100) : 0
  const totalAcquisition = num('purchase_price') + sd + num('legal_fees') + num('survey_cost') + num('auction_fees') + num('broker_fee') + num('refurb_cost') + num('other_costs') + mortgageFee
  const cashIn = Math.max(0, totalAcquisition - loanAmount)
  const isInterestOnly = (form.mortgage_type || 'interest_only') === 'interest_only'
  const monthlyRepayment = form.purchase_type !== 'cash' ? api.calcMonthlyRepayment(loanAmount, num('mortgage_rate'), num('mortgage_term') || 25, isInterestOnly) : 0

  const grossMonthlyRent = form.deal_type === 'hmo'
    ? (form.hmo_rent_mode === 'individual' && Array.isArray(form.hmo_room_rents) && form.hmo_room_rents.length > 0
        ? form.hmo_room_rents.reduce((s,r)=>s+(parseFloat(r)||0),0)
        : num('hmo_rooms') * num('hmo_rent_per_room'))
    : form.deal_type === 'sa'
      ? num('sa_nightly_rate') * (num('sa_occupancy_percent') / 100) * 30.4
      : num('monthly_rent')

  const effectiveRent = grossMonthlyRent * (1 - num('void_percent') / 100)
  // Agent fee: if ex_vat, multiply by 1.2 to get true cost (10% ex VAT = 12% effective)
  const agentFeeMultiplier = (form.agent_fee_vat || 'ex_vat') === 'ex_vat' ? 1.2 : 1.0
  const agentFee = effectiveRent * num('agent_fee_percent') / 100 * agentFeeMultiplier
  const maintenanceFee = effectiveRent * num('maintenance_percent') / 100
  const hmoExtras = form.deal_type === 'hmo' ? num('hmo_utilities_monthly') + num('hmo_council_tax_monthly') + num('hmo_licence_annual') / 12 : 0
  const totalMonthlyCosts = monthlyRepayment + agentFee + maintenanceFee + num('insurance_monthly') + num('service_charge_monthly') + num('ground_rent_monthly') + hmoExtras

  const monthlyProfit = effectiveRent - totalMonthlyCosts
  const annualProfit = monthlyProfit * 12
  const grossYield = num('purchase_price') > 0 ? (grossMonthlyRent * 12 / num('purchase_price')) * 100 : 0
  const netYield = num('purchase_price') > 0 ? (annualProfit / num('purchase_price')) * 100 : 0
  const cashOnCash = cashIn > 0 ? (annualProfit / cashIn) * 100 : 0
  const roce = totalAcquisition > 0 ? (annualProfit / totalAcquisition) * 100 : 0
  const payback = annualProfit > 0 ? cashIn / annualProfit : 0

  // BRRR
  const brrrNewLoan = num('brrr_end_value') * num('brrr_refinance_ltv') / 100
  const brrrNewRepayment = api.calcMonthlyRepayment(brrrNewLoan, num('brrr_new_rate'), num('brrr_new_term') || 25, isInterestOnly)
  const brrrMoneyLeft = cashIn - (brrrNewLoan - loanAmount)
  const brrrCashOnCash = brrrMoneyLeft > 0 ? (annualProfit / brrrMoneyLeft) * 100 : 0

  async function handleSave() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  // InputRow and ResultRow are defined at module level to avoid focus loss

  const sc = STATUS_CFG[form.status]||STATUS_CFG.analysing
  const co = companies.find(c=>c.id===form.company_id)

  const tabStyle = (k) => ({
    fontFamily:mono, fontSize:11, padding:'7px 14px', borderRadius:8, border:'none',
    cursor:'pointer', background: tab===k ? T.gold+'22' : 'transparent',
    color: tab===k ? T.gold : T.muted, fontWeight: tab===k ? 700 : 400,
  })

  return (
    <div className="fade">
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <button onClick={onBack} style={{fontFamily:mono,fontSize:11,background:'none',border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>← All Deals</button>
        <div style={{flex:1}}>
          <input value={form.name} onChange={e=>set('name',e.target.value)} onBlur={handleSave}
            style={{fontSize:20,fontWeight:700,background:'none',border:'none',color:T.text,outline:'none',width:'100%',fontFamily:'Georgia,serif'}}
            placeholder="Deal name…"/>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select value={form.status} onChange={e=>{set('status',e.target.value);handleSave()}}
            style={{fontFamily:mono,fontSize:11,background:sc.color+'22',border:`1px solid ${sc.color}44`,color:sc.color,borderRadius:8,padding:'6px 10px',fontWeight:700}}>
            {Object.entries(STATUS_CFG).map(([k,v])=>(<option key={k} value={k}>{v.label}</option>))}
          </select>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave} disabled={saving}>
            {saving?'Saving…':'💾 Save'}
          </button>
          {form.status === 'completed' && (
            <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>onConvert&&onConvert(form)}>Convert to Property →</button>
          )}
          <button className="btn btn-ghost" style={{fontSize:11,color:T.red,borderColor:T.red+'44'}} onClick={onDelete}>Delete</button>
        </div>
      </div>

      {/* Meta row */}
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <input value={form.address||''} onChange={e=>set('address',e.target.value)}
          onBlur={async e => {
            const addr = e.target.value.trim()
            // Auto-rename deal if name is still the default
            if (addr && (!form.name || form.name === 'New Deal' || form.name === 'New Deal (copy)')) {
              set('name', addr)
              await onSave({ ...form, address: addr, name: addr })
            } else {
              await handleSave()
            }
          }}
          placeholder="Property address (auto-names deal)"
          style={{flex:2,minWidth:200,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px',outline:'none'}}/>
        <select value={form.company_id||''} onChange={e=>{set('company_id',e.target.value||null);handleSave()}}
          style={{flex:1,minWidth:160,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px'}}>
          <option value="">Unassigned company</option>
          {companies.map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:24,borderBottom:`1px solid ${T.border}`,flexWrap:'wrap'}}>
        {[['calculator','🔢 Calculator'],['tracker','📍 Purchase Tracker'],['contacts','👥 Contacts'],['documents','📄 Documents']].map(([k,l])=>(
          <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* ── CALCULATOR TAB ── */}
      {tab === 'calculator' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:24,alignItems:'start'}}>
          <div style={{display:'grid',gap:16}}>

            {/* Deal type & purchase type */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
              <span style={sect}>Deal type</span>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
                {DEAL_TYPES.map(t=>(
                  <button key={t} onClick={()=>set('deal_type',t)}
                    style={{fontFamily:mono,fontSize:11,padding:'6px 14px',borderRadius:20,cursor:'pointer',
                      border:`1px solid ${form.deal_type===t?T.gold:T.border}`,
                      background:form.deal_type===t?T.gold+'22':'transparent',
                      color:form.deal_type===t?T.gold:T.muted}}>
                    {DEAL_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                {Object.entries(PURCHASE_TYPES).map(([k,l])=>(
                  <button key={k} onClick={()=>set('purchase_type',k)}
                    style={{fontFamily:mono,fontSize:11,padding:'6px 14px',borderRadius:20,cursor:'pointer',
                      border:`1px solid ${form.purchase_type===k?T.blue:T.border}`,
                      background:form.purchase_type===k?T.blue+'22':'transparent',
                      color:form.purchase_type===k?T.blue:T.muted}}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <label style={{fontFamily:mono,fontSize:11,color:T.muted,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                  <input type="checkbox" checked={!!form.is_auction} onChange={e=>set('is_auction',e.target.checked)} style={{width:'auto',margin:0}}/>
                  Auction purchase
                </label>
                <label style={{fontFamily:mono,fontSize:11,color:T.muted,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                  <input type="checkbox" checked={!!form.is_additional_property} onChange={e=>set('is_additional_property',e.target.checked)} style={{width:'auto',margin:0}}/>
                  Additional property (+5% SDLT surcharge)
                </label>
                <label style={{fontFamily:mono,fontSize:11,color:T.muted,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                  <input type="checkbox" checked={!!form.is_first_time_buyer} onChange={e=>set('is_first_time_buyer',e.target.checked)} style={{width:'auto',margin:0}}/>
                  First-time buyer
                </label>
              </div>
            </div>

            {/* Acquisition costs */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
              <span style={sect}>Acquisition costs</span>
              <InputRow label="Purchase price" field="purchase_price"form={form} set={set} T={T}/>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                <div>
                  <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Stamp duty (SDLT)</span>
                  <div style={{fontFamily:mono,fontSize:9,color:T.muted,marginTop:2}}>
                    {form.is_additional_property ? 'Standard bands + 5% surcharge (Oct 2024 rates)' : form.is_first_time_buyer ? 'FTB relief: 0% to £300k, 5% to £500k' : 'Standard: 0% to £125k, 2% to £250k, 5% to £925k'}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:mono,fontSize:12,color:T.gold}}>
                    {form.stamp_duty_override != null ? '' : '≈ '}{fmt(sd)}
                  </span>
                  {form.stamp_duty_override == null
                    ? <button onClick={()=>set('stamp_duty_override', sd)} style={{fontFamily:mono,fontSize:9,color:T.muted,background:'none',border:`1px solid ${T.border}`,borderRadius:4,padding:'2px 6px',cursor:'pointer'}}>Override</button>
                    : <button onClick={()=>set('stamp_duty_override', null)} style={{fontFamily:mono,fontSize:9,color:T.amber,background:'none',border:`1px solid ${T.amber}44`,borderRadius:4,padding:'2px 6px',cursor:'pointer'}}>Auto</button>
                  }
                  {form.stamp_duty_override != null && (
                    <input type="number" value={form.stamp_duty_override} min={0}
                      onChange={e=>set('stamp_duty_override',parseFloat(e.target.value)||0)}
                      style={{fontFamily:mono,fontSize:13,width:90,background:T.bg,border:`1px solid ${T.gold}`,color:T.text,borderRadius:6,padding:'4px 8px',textAlign:'right',outline:'none'}}/>
                  )}
                </div>
              </div>
              <InputRow label="Legal fees" field="legal_fees" form={form} set={set} T={T}/>
              {!form.show_conv_breakdown ? (
                <div style={{padding:'3px 0',borderBottom:`1px solid ${T.border}`}}>
                  <button onClick={()=>set('show_conv_breakdown',true)}
                    style={{background:'none',border:'none',cursor:'pointer',color:T.muted,fontFamily:mono,fontSize:10,textDecoration:'underline',padding:'4px 0'}}>
                    + Break into solicitor / searches / disbursements
                  </button>
                </div>
              ) : (<>
                <InputRow label="→ Solicitor fee" field="solicitor_fee" form={form} set={set} T={T}/>
                <InputRow label="→ Search fees" field="search_fees" form={form} set={set} T={T}/>
                <InputRow label="→ Disbursements" field="disbursements" form={form} set={set} T={T}/>
              </>)}
              <InputRow label="Survey / valuation" field="survey_cost" form={form} set={set} T={T}/>
              {form.is_auction && <InputRow label="Auction fees" field="auction_fees"form={form} set={set} T={T}/>}
              <InputRow label="Broker / finder fee" field="broker_fee" form={form} set={set} T={T}/>
              <InputRow label="Refurbishment cost" field="refurb_cost"form={form} set={set} T={T}/>
              <InputRow label={form.other_costs_label||'Other costs'} field="other_costs"form={form} set={set} T={T}/>
            </div>

            {/* Finance */}
            {form.purchase_type !== 'cash' && (
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
                <span style={sect}>Finance</span>
                <InputRow label="Deposit" field="deposit_percent" prefix="" suffix="%" min={0} step={1} form={form} set={set} T={T}/>
                {/* Mortgage type toggle */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                  <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Mortgage type</span>
                  <div style={{display:'flex',gap:6}}>
                    {[['interest_only','Interest only'],['repayment','Repayment']].map(([k,l])=>(
                      <button key={k} onClick={()=>set('mortgage_type',k)}
                        style={{fontFamily:mono,fontSize:11,padding:'4px 12px',borderRadius:20,cursor:'pointer',
                          border:`1px solid ${(form.mortgage_type||'interest_only')===k?T.gold:T.border}`,
                          background:(form.mortgage_type||'interest_only')===k?T.gold+'22':'transparent',
                          color:(form.mortgage_type||'interest_only')===k?T.gold:T.muted}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <InputRow label="Mortgage rate" field="mortgage_rate" prefix="" suffix="% p.a." min={0} step={0.1} form={form} set={set} T={T}/>
                {(form.mortgage_type||'interest_only') === 'repayment' && (
                  <InputRow label="Mortgage term" field="mortgage_term" prefix="" suffix="years" min={1} step={1} form={form} set={set} T={T}/>
                )}
                {(form.mortgage_type||'interest_only') === 'interest_only' && (
                  <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${T.border}`,fontFamily:mono,fontSize:11}}>
                    <span style={{color:T.muted}}>Term</span>
                    <span style={{color:T.muted}}>Not required for interest-only</span>
                  </div>
                )}
                <InputRow label="Arrangement fee" field="mortgage_fee_percent" prefix="" suffix="% of loan" min={0} step={0.1} form={form} set={set} T={T}/>
                {num('mortgage_fee_percent') > 0 && (
                  <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontFamily:mono,fontSize:11}}>
                    <span style={{color:T.muted}}>= {fmt(loanAmount * num('mortgage_fee_percent') / 100)} added to costs</span>
                  </div>
                )}
              </div>
            )}

            {/* Income */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
              <span style={sect}>Rental income</span>
              {(form.deal_type==='btl'||form.deal_type==='brrr') && (
                <InputRow label="Monthly rent" field="monthly_rent"form={form} set={set} T={T}/>
              )}
              {form.deal_type==='hmo' && (<>
                <InputRow label="Number of rooms" field="hmo_rooms" prefix="" suffix="rooms" min={1} step={1} form={form} set={set} T={T}/>
                {/* Rent mode toggle */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                  <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Rent entry</span>
                  <div style={{display:'flex',gap:6}}>
                    {[['same','Same rate'],['individual','Per room']].map(([k,l])=>(
                      <button key={k} onClick={()=>set('hmo_rent_mode',k)}
                        style={{fontFamily:mono,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                          border:`1px solid ${(form.hmo_rent_mode||'same')===k?T.gold:T.border}`,
                          background:(form.hmo_rent_mode||'same')===k?T.gold+'22':'transparent',
                          color:(form.hmo_rent_mode||'same')===k?T.gold:T.muted}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {(form.hmo_rent_mode||'same')==='same' ? (
                  <InputRow label="Rent per room" field="hmo_rent_per_room" form={form} set={set} T={T}/>
                ) : (
                  <div style={{padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                    {Array.from({length:Math.max(1,parseInt(form.hmo_rooms)||1)},(_,i)=>{
                      const rents = Array.isArray(form.hmo_room_rents)?form.hmo_room_rents:[]
                      const val = rents[i]??form.hmo_rent_per_room??0
                      return (
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:12}}>
                          <span style={{fontFamily:mono,fontSize:12,color:T.text,flexShrink:0}}>Room {i+1}</span>
                          <div style={{display:'flex',alignItems:'center',gap:4}}>
                            <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>£</span>
                            <input type="number" min={0} step={1} value={val}
                              onChange={e=>{
                                const n=Math.max(1,parseInt(form.hmo_rooms)||1)
                                const r=Array.isArray(form.hmo_room_rents)?[...form.hmo_room_rents]:Array(n).fill(form.hmo_rent_per_room||0)
                                while(r.length<n) r.push(form.hmo_rent_per_room||0)
                                r[i]=parseFloat(e.target.value)||0
                                set('hmo_room_rents',r)
                              }}
                              style={{fontFamily:mono,fontSize:13,width:90,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:'4px 8px',textAlign:'right',outline:'none'}}/>
                            <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>/mo</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                  <span style={{fontFamily:mono,fontSize:12,color:T.muted}}>Total HMO income</span>
                  <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.green}}>{fmt(grossMonthlyRent)}/mo</span>
                </div>
              </>)}
              {form.deal_type==='sa' && (<>
                <InputRow label="Nightly rate" field="sa_nightly_rate"form={form} set={set} T={T}/>
                <InputRow label="Occupancy" field="sa_occupancy_percent" prefix="" suffix="%" min={0} max={100} step={1}form={form} set={set} T={T}/>
              </>)}
              <InputRow label="Void allowance" field="void_percent" prefix="" suffix="%" min={0} max={100} step={1}form={form} set={set} T={T}/>
            </div>

            {/* Running costs */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
              <span style={sect}>Monthly running costs</span>
              {/* Agent fee with VAT toggle */}
              <div style={{padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Letting agent fee</span>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" min={0} max={30} step={0.5}
                      value={form.agent_fee_percent??10}
                      onChange={e=>set('agent_fee_percent',parseFloat(e.target.value)||0)}
                      style={{fontFamily:mono,fontSize:13,width:52,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:'4px 6px',textAlign:'right',outline:'none'}}/>
                    <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>% of rent</span>
                  </div>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontFamily:mono,fontSize:10,color:T.muted}}>VAT treatment</span>
                  <div style={{display:'flex',gap:5}}>
                    {[['ex_vat','+ VAT (20%)'],['inc_vat','Inc. VAT']].map(([k,l])=>(
                      <button key={k} onClick={()=>set('agent_fee_vat',k)}
                        style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:20,cursor:'pointer',
                          border:`1px solid ${(form.agent_fee_vat||'ex_vat')===k?T.amber:T.border}`,
                          background:(form.agent_fee_vat||'ex_vat')===k?T.amber+'22':'transparent',
                          color:(form.agent_fee_vat||'ex_vat')===k?T.amber:T.muted}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {(form.agent_fee_vat||'ex_vat')==='ex_vat' && (
                  <div style={{fontFamily:mono,fontSize:10,color:T.amber,marginTop:4}}>
                    Fee = {form.agent_fee_percent||10}% × 1.20 (VAT) = {((form.agent_fee_percent||10)*1.2).toFixed(1)}% effective rate
                  </div>
                )}
              </div>
              <InputRow label="Maintenance reserve" field="maintenance_percent" prefix="" suffix="% of rent" min={0} step={1}form={form} set={set} T={T}/>
              <InputRow label="Buildings insurance" field="insurance_monthly"form={form} set={set} T={T}/>
              <InputRow label="Service charge" field="service_charge_monthly"form={form} set={set} T={T}/>
              <InputRow label="Ground rent" field="ground_rent_monthly"form={form} set={set} T={T}/>
              {form.deal_type==='hmo' && (<>
                <InputRow label="Utilities (monthly)" field="hmo_utilities_monthly"form={form} set={set} T={T}/>
                <InputRow label="Council tax (monthly)" field="hmo_council_tax_monthly"form={form} set={set} T={T}/>
                <InputRow label="HMO licence (annual)" field="hmo_licence_annual"form={form} set={set} T={T}/>
              </>)}
            </div>

            {/* BRRR */}
            {(form.deal_type==='brrr') && (
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
                <span style={sect}>BRRR — Refinance</span>
                <InputRow label="Estimated end value (post refurb)" field="brrr_end_value"form={form} set={set} T={T}/>
                <InputRow label="Refinance LTV" field="brrr_refinance_ltv" prefix="" suffix="%" min={0} max={90} step={1}form={form} set={set} T={T}/>
                <InputRow label="New mortgage rate" field="brrr_new_rate" prefix="" suffix="% p.a." min={0} step={0.1}form={form} set={set} T={T}/>
                <InputRow label="New mortgage term" field="brrr_new_term" prefix="" suffix="years" min={1} step={1}form={form} set={set} T={T}/>
              </div>
            )}

            {/* Notes */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
              <span style={sect}>Notes</span>
              <textarea value={form.notes||''} onChange={e=>set('notes',e.target.value)} rows={4}
                placeholder="Vendor motivation, planning notes, estate agent contact, viewing notes…"
                style={{width:'100%',fontFamily:mono,fontSize:12,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 12px',resize:'vertical',outline:'none'}}/>
            </div>

            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button className="btn btn-gold" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save Deal'}</button>
            </div>
          </div>

          {/* ── RESULTS PANEL ── */}
          <div style={{position:'sticky',top:80}}>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginBottom:12}}>
              <span style={sect}>Acquisition summary</span>
              <ResultRow label="Purchase price" value={fmt(num('purchase_price'))} T={T}/>
              <ResultRow label="Stamp duty" value={fmt(sd)} color={T.amber} T={T}/>
              {mortgageFee > 0 && <ResultRow label={`Arrangement fee (${num('mortgage_fee_percent')}%)`} value={fmt(mortgageFee)} color={T.amber} T={T}/>}
              <ResultRow label="All other costs" value={fmt(totalAcquisition-num('purchase_price')-sd-mortgageFee)} T={T}/>
              <ResultRow label="Total capital required" value={fmt(totalAcquisition)} big T={T}/>
              {form.purchase_type !== 'cash' && (<>
                <ResultRow label="Mortgage loan" value={fmt(loanAmount)} color={T.blue} T={T}/>
                <ResultRow label="Cash in deal" value={fmt(cashIn)} color={T.gold} big T={T}/>
                <ResultRow label={isInterestOnly?'Monthly payment (interest only)':'Monthly repayment (capital + interest)'} value={fmt(monthlyRepayment)} color={T.amber} T={T}/>
              </>)}
            </div>

            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginBottom:12}}>
              <span style={sect}>Returns</span>
              <ResultRow label="Gross monthly rent" value={fmt(grossMonthlyRent)} T={T}/>
              <ResultRow label="Effective rent (after void)" value={fmt(effectiveRent)} T={T}/>
              <ResultRow label={`Agent fee (${form.agent_fee_percent||10}%${(form.agent_fee_vat||'ex_vat')==='ex_vat'?' + VAT':' inc VAT'})`} value={fmt(agentFee)} color={T.muted} T={T}/>
              <ResultRow label="Total monthly costs" value={fmt(totalMonthlyCosts)} color={T.red} T={T}/>
              <ResultRow label="Monthly profit / loss" value={fmt(monthlyProfit)} color={monthlyProfit>0?T.green:T.red} big T={T}/>
              <ResultRow label="Annual profit" value={fmt(annualProfit)} color={monthlyProfit>0?T.green:T.red} T={T}/>
            </div>

            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginBottom:12}}>
              <span style={sect}>Yield &amp; return metrics</span>
              <ResultRow label="Gross yield" value={fmtPct(grossYield)} color={grossYield>=6?T.green:grossYield>=4?T.amber:T.red} big T={T}/>
              <ResultRow label="Net yield (after all costs)" value={fmtPct(netYield)} color={netYield>=4?T.green:netYield>=2?T.amber:T.red} T={T}/>
              <ResultRow label="Cash-on-cash return" value={fmtPct(cashOnCash)} color={cashOnCash>=8?T.green:cashOnCash>=5?T.amber:T.red} big T={T}/>
              <ResultRow label="ROCE" value={fmtPct(roce)} color={roce>=8?T.green:roce>=5?T.amber:T.red} T={T}/>
              <ResultRow label="Payback period" value={payback>0?payback.toFixed(1)+' years':'—'} T={T}/>
            </div>

            {form.deal_type === 'brrr' && (
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
                <span style={sect}>BRRR analysis</span>
                <ResultRow label="New loan at refinance" value={fmt(brrrNewLoan)} color={T.blue} T={T}/>
                <ResultRow label="New monthly repayment" value={fmt(brrrNewRepayment)} color={T.amber} T={T}/>
                <ResultRow label="Capital released" value={fmt(brrrNewLoan - loanAmount)} color={T.green} T={T}/>
                <ResultRow label="Money left in deal" value={fmt(brrrMoneyLeft)} color={brrrMoneyLeft<cashIn?T.green:T.muted} big T={T}/>
                <ResultRow label="Cash-on-cash (post refi)" value={fmtPct(brrrCashOnCash)} color={T.green} T={T}/>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 24 TAX IMPACT ── */}
      {tab === 'calculator' && form.purchase_type !== 'cash' && monthlyRepayment > 0 && (
        <div style={{...sectionCard, marginTop:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={sect}>Section 24 tax impact</span>
            <div style={{display:'flex',gap:6}}>
              {[['personal','Personal'],['ltd','Ltd Co']].map(([k,l])=>(
                <button key={k} onClick={()=>set('ownership_type',k)}
                  style={{fontFamily:mono,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${(form.ownership_type||'personal')===k?T.gold:T.border}`,
                    background:(form.ownership_type||'personal')===k?T.gold+'22':'transparent',
                    color:(form.ownership_type||'personal')===k?T.gold:T.muted}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {(form.ownership_type||'personal')==='personal' ? (() => {
            const taxRate = num('section24_rate') || 40
            const annualInterest = monthlyRepayment * 12
            const s24Credit = annualInterest * 0.20
            const taxableIncome = effectiveRent * 12 - (agentFee + maintenanceFee + num('insurance_monthly') + num('service_charge_monthly') + num('ground_rent_monthly') + hmoExtras) * 12
            const taxOwed = Math.max(0, taxableIncome * (taxRate/100) - s24Credit)
            const profitAfterTax = annualProfit - taxOwed
            return (<>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:8,lineHeight:1.7}}>
                Section 24 restricts mortgage interest relief to 20% for personal ownership. Select your tax band:
              </div>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {[[20,'20% Basic'],[40,'40% Higher'],[45,'45% Additional']].map(([r,l])=>(
                  <button key={r} onClick={()=>set('section24_rate',r)}
                    style={{fontFamily:mono,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                      border:`1px solid ${(form.section24_rate||40)===r?T.amber:T.border}`,
                      background:(form.section24_rate||40)===r?T.amber+'22':'transparent',
                      color:(form.section24_rate||40)===r?T.amber:T.muted}}>
                    {l}
                  </button>
                ))}
              </div>
              <ResultRow label="Annual profit (before tax)" value={fmt(annualProfit)} T={T}/>
              <ResultRow label={`Income tax (${taxRate}% — S.24 restricted)`} value={fmt(taxOwed)} color={T.red} T={T}/>
              <ResultRow label="Annual profit (after tax)" value={fmt(profitAfterTax)} color={profitAfterTax>0?T.green:T.red} big T={T}/>
              <ResultRow label="Monthly take-home (after tax)" value={fmt(profitAfterTax/12)} color={profitAfterTax>0?T.green:T.red} T={T}/>
            </>)
          })() : (() => {
            const corpTax = Math.max(0, annualProfit * 0.25)
            const retained = annualProfit - corpTax
            return (<>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:8,lineHeight:1.7}}>
                Ltd company: full mortgage interest deductible. Corporation tax 25%.
              </div>
              <ResultRow label="Annual profit (before CT)" value={fmt(annualProfit)} T={T}/>
              <ResultRow label="Corporation tax (25%)" value={fmt(corpTax)} color={T.amber} T={T}/>
              <ResultRow label="Retained profit (after CT)" value={fmt(retained)} color={T.green} big T={T}/>
            </>)
          })()}
        </div>
      )}

      {/* ── PURCHASE TRACKER TAB ── */}
      {tab === 'tracker' && (
        <PurchaseTracker deal={form} onUpdate={updated=>setForm(prev=>({...prev,...updated}))} showToast={showToast}/>
      )}

      {/* ── CONTACTS TAB ── */}
      {tab === 'contacts' && (
        <ContactsTab dealId={form.id} userId={user?.id} showToast={showToast}/>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <DocumentsTab dealId={form.id} userId={user.id} showToast={showToast}/>
      )}
    </div>
  )
}

// ── PURCHASE TRACKER ──────────────────────────────────────────────────────────
function PurchaseTracker({ deal, onUpdate, showToast }) {
  const { T } = useTheme()
  const [milestones, setMilestones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [deal.id])

  async function load() {
    setLoading(true)
    try {
      const data = await api.fetchDealMilestones(deal.id)
      setMilestones(data)
    } catch(e) {}
    setLoading(false)
  }

  async function toggleMilestone(m) {
    const updated = { completed: !m.completed, completed_date: !m.completed ? new Date().toISOString().split('T')[0] : null }
    try {
      await api.updateMilestone(m.id, updated)
      setMilestones(prev => prev.map(x => x.id === m.id ? { ...x, ...updated } : x))
    } catch(e) {}
  }

  async function toggleEnabled(m) {
    try {
      await api.updateMilestone(m.id, { is_enabled: !m.is_enabled })
      setMilestones(prev => prev.map(x => x.id === m.id ? { ...x, is_enabled: !m.is_enabled } : x))
    } catch(e) {}
  }

  async function setDate(m, date) {
    try {
      await api.updateMilestone(m.id, { completed_date: date })
      setMilestones(prev => prev.map(x => x.id === m.id ? { ...x, completed_date: date } : x))
    } catch(e) {}
  }

  const stages = [...new Set(milestones.filter(m=>m.is_enabled).map(m=>m.stage))]
  const enabled = milestones.filter(m=>m.is_enabled)
  const completed = enabled.filter(m=>m.completed).length
  const progress = enabled.length > 0 ? (completed/enabled.length)*100 : 0

  const isSdlt = (m) => m.milestone_key === 'sdlt_filed'
  const isInsurance = (m) => m.milestone_key === 'insurance_active'

  if (loading) return <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center'}}>Loading tracker…</div>

  return (
    <div>
      {/* Progress header */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px',marginBottom:20}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <span style={{fontFamily:mono,fontSize:12,color:T.text,fontWeight:700}}>Purchase progress</span>
          <span style={{fontFamily:mono,fontSize:12,color:T.gold}}>{completed} / {enabled.length} complete</span>
        </div>
        <div style={{background:T.border,borderRadius:4,height:8,marginBottom:14}}>
          <div style={{height:'100%',borderRadius:4,background:T.gold,width:`${progress}%`,transition:'width 0.4s'}}/>
        </div>
        <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
          <div>
            <span style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Target completion</span>
            <input type="date" value={deal.target_completion_date||''} onChange={async e=>{
              await api.updateDeal(deal.id,{target_completion_date:e.target.value||null})
              onUpdate({target_completion_date:e.target.value||null})
            }} style={{display:'block',fontFamily:mono,fontSize:12,marginTop:4,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:'4px 8px'}}/>
          </div>
          {deal.target_completion_date && (
            <div>
              <span style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Days remaining</span>
              <div style={{fontFamily:mono,fontSize:16,fontWeight:700,color:T.gold,marginTop:4}}>
                {Math.max(0, Math.ceil((new Date(deal.target_completion_date)-new Date())/(1000*60*60*24)))} days
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Milestone settings note */}
      <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16}}>
        Toggle the blue switches to show or hide any step — customise this to match your buying process. Steps marked ★ are recommended but can be turned off too.
      </div>

      {stages.map(stage => {
        const stageMilestones = milestones.filter(m=>m.stage===stage)
        return (
          <div key={stage} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden',marginBottom:12}}>
            <div style={{padding:'12px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontFamily:mono,fontSize:10,fontWeight:700,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{STAGE_LABELS[stage]||stage}</span>
              <span style={{fontFamily:mono,fontSize:10,color:T.muted}}>
                {stageMilestones.filter(m=>m.is_enabled&&m.completed).length}/{stageMilestones.filter(m=>m.is_enabled).length}
              </span>
            </div>
            {stageMilestones.map(m => (
              <div key={m.id} style={{padding:'12px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:12,opacity:m.is_enabled?1:0.4}}>
                {/* Toggle enabled — all milestones */}
                <div onClick={()=>toggleEnabled(m)}
                  style={{width:32,height:18,borderRadius:9,background:m.is_enabled?T.blue:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}>
                  <div style={{position:'absolute',top:2,left:m.is_enabled?16:2,width:14,height:14,borderRadius:7,background:'white',transition:'left 0.2s'}}/>
                </div>
                {/* Tick */}
                <div onClick={()=>m.is_enabled&&toggleMilestone(m)}
                  style={{width:20,height:20,borderRadius:5,flexShrink:0,cursor:m.is_enabled?'pointer':'default',
                    background:m.completed?T.green:T.surface,
                    border:`2px solid ${m.completed?T.green:T.border}`,
                    display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}>
                  {m.completed && <span style={{color:'white',fontSize:11,fontWeight:700}}>✓</span>}
                </div>
                {/* Label */}
                <div style={{flex:1}}>
                  <span style={{fontFamily:mono,fontSize:12,color:m.completed?T.muted:T.text,textDecoration:m.completed?'line-through':'none'}}>
                    {m.label}
                  </span>
                  {m.is_required && <span style={{fontFamily:mono,fontSize:9,color:T.gold,marginLeft:6,opacity:0.7}}>★</span>}
                  {isSdlt(m) && <span style={{fontFamily:mono,fontSize:9,background:T.red+'22',color:T.red,padding:'2px 6px',borderRadius:4,marginLeft:8}}>14 day deadline</span>}
                  {isInsurance(m) && <span style={{fontFamily:mono,fontSize:9,background:T.amber+'22',color:T.amber,padding:'2px 6px',borderRadius:4,marginLeft:8}}>Required at exchange</span>}
                </div>
                {/* Date */}
                {m.is_enabled && (
                  <input type="date" value={m.completed_date||''} onChange={e=>setDate(m,e.target.value)}
                    style={{fontFamily:mono,fontSize:11,background:T.bg,border:`1px solid ${T.border}`,color:T.muted,borderRadius:6,padding:'3px 6px'}}/>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── CONTACTS TAB ──────────────────────────────────────────────────────────────
function ContactsTab({ dealId, userId, showToast }) {
  const { T } = useTheme()
  const [contacts, setContacts]       = useState([])
  const [addressBook, setAddressBook] = useState([])
  const [editing, setEditing]         = useState(null)
  const [form, setForm]               = useState({})
  const [showBook, setShowBook]       = useState(false)
  const [bookFilter, setBookFilter]   = useState('')
  const [abView, setAbView]           = useState('deal') // 'deal' | 'book'

  useEffect(() => {
    api.fetchDealContacts(dealId).then(setContacts).catch(()=>{})
    if (userId) api.fetchAddressBook(userId).then(setAddressBook).catch(()=>{})
  }, [dealId, userId])

  function startNew() { setForm({ role:'solicitor', name:'', company_name:'', phone:'', email:'', notes:'' }); setEditing('new') }
  function startEdit(c) { setForm({...c}); setEditing(c.id) }

  async function save() {
    try {
      const saved = await api.upsertDealContact(dealId, form)
      if (editing === 'new') setContacts(prev=>[...prev, saved])
      else setContacts(prev=>prev.map(c=>c.id===saved.id?saved:c))
      setEditing(null); showToast('Contact saved')
    } catch(e) { showToast(e.message,'error') }
  }

  async function saveToBook() {
    try {
      const entry = await api.saveToAddressBook(userId, form)
      setAddressBook(prev=>[...prev, entry])
      showToast('Saved to address book')
    } catch(e) { showToast(e.message,'error') }
  }

  async function addFromBook(entry) {
    const { id, user_id, created_at, updated_at, ...fields } = entry
    try {
      const saved = await api.upsertDealContact(dealId, fields)
      setContacts(prev=>[...prev, saved])
      showToast(`${entry.name} added`)
    } catch(e) { showToast(e.message,'error') }
  }

  async function remove(id) {
    try {
      await api.deleteDealContact(id)
      setContacts(prev=>prev.filter(c=>c.id!==id))
      showToast('Contact removed')
    } catch(e) { showToast(e.message,'error') }
  }

  async function deleteFromBook(id) {
    if (!confirm('Remove from address book?')) return
    try {
      await api.deleteAddressBookEntry(id)
      setAddressBook(prev=>prev.filter(e=>e.id!==id))
      showToast('Removed from address book')
    } catch(e) {}
  }

  const filteredBook = addressBook.filter(e =>
    !bookFilter || e.name?.toLowerCase().includes(bookFilter.toLowerCase()) ||
    e.company_name?.toLowerCase().includes(bookFilter.toLowerCase()) ||
    e.role?.toLowerCase().includes(bookFilter.toLowerCase())
  )

  const label = { fontFamily:mono, fontSize:10, color:T.muted, display:'block', marginBottom:4 }
  const inp = { fontFamily:mono, fontSize:12, background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'8px 10px', outline:'none', width:'100%' }

  return (
    <div>
      {/* Tab switcher */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden'}}>
          {[['deal','This deal'],['book','📒 Address book']].map(([k,l])=>(
            <button key={k} onClick={()=>setAbView(k)} style={{fontFamily:mono,fontSize:11,padding:'7px 16px',border:'none',cursor:'pointer',background:abView===k?T.gold+'22':'transparent',color:abView===k?T.gold:T.muted,fontWeight:abView===k?700:400}}>{l}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          {abView==='deal' && <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setAbView('book')}}>📒 Pick from address book</button>}
          <button className="btn btn-gold" style={{fontSize:11}} onClick={startNew}>+ New contact</button>
        </div>
      </div>

      {/* ── DEAL CONTACTS ── */}
      {abView==='deal' && (
        <div style={{display:'grid',gap:12}}>
          {contacts.length===0&&!editing&&(
            <div className="card" style={{padding:32,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>
              No contacts yet. Add your solicitor, estate agent and mortgage broker, or pick from your address book.
            </div>
          )}
          {contacts.map(c=>(
            <div key={c.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'16px 20px'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,flexWrap:'wrap',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:18,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:14,fontWeight:700,color:T.gold}}>
                    {(c.name?.[0]||'?').toUpperCase()}
                  </div>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:T.text}}>{c.name||'—'}</div>
                    <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{CONTACT_ROLES[c.role]||c.role}{c.company_name?` · ${c.company_name}`:''}</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>startEdit(c)} style={{fontFamily:mono,fontSize:11,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>Edit</button>
                  <button onClick={()=>remove(c.id)} style={{fontFamily:mono,fontSize:11,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>Remove</button>
                </div>
              </div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap',fontFamily:mono,fontSize:11,color:T.muted}}>
                {c.phone&&<a href={`tel:${c.phone}`} style={{color:T.muted,textDecoration:'none'}}>📞 {c.phone}</a>}
                {c.email&&<a href={`mailto:${c.email}`} style={{color:T.gold,textDecoration:'none'}}>✉ {c.email}</a>}
                {c.notes&&<span>📝 {c.notes}</span>}
              </div>
            </div>
          ))}

          {editing&&(
            <div style={{background:T.card,border:`1px solid ${T.gold}44`,borderRadius:12,padding:'20px 22px'}}>
              <div style={{fontFamily:mono,fontSize:10,color:T.gold,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>{editing==='new'?'New contact':'Edit contact'}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div><label style={label}>Role</label>
                  <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={inp}>
                    {Object.entries(CONTACT_ROLES).map(([k,l])=>(<option key={k} value={k}>{l}</option>))}
                  </select>
                </div>
                <div><label style={label}>Name</label><input value={form.name||''} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Full name" style={inp}/></div>
                <div><label style={label}>Company</label><input value={form.company_name||''} onChange={e=>setForm(p=>({...p,company_name:e.target.value}))} placeholder="Firm name" style={inp}/></div>
                <div><label style={label}>Phone</label><input value={form.phone||''} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder="07700 900000" style={inp}/></div>
                <div><label style={label}>Email</label><input value={form.email||''} onChange={e=>setForm(p=>({...p,email:e.target.value}))} placeholder="contact@firm.com" style={inp}/></div>
                <div><label style={label}>Notes</label><input value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Optional notes" style={inp}/></div>
              </div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <button className="btn btn-gold" style={{fontSize:12}} onClick={save}>Save to deal</button>
                {editing==='new'&&form.name&&(
                  <button className="btn btn-ghost" style={{fontSize:12}} onClick={async()=>{await save();await saveToBook()}}>Save to deal + address book</button>
                )}
                <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADDRESS BOOK ── */}
      {abView==='book' && (
        <div>
          <div style={{display:'flex',gap:10,marginBottom:16}}>
            <input value={bookFilter} onChange={e=>setBookFilter(e.target.value)}
              placeholder="Search by name, company or role…"
              style={{flex:1,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px',outline:'none'}}/>
          </div>
          {filteredBook.length===0&&(
            <div className="card" style={{padding:32,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>
              {addressBook.length===0?'Your address book is empty. When adding contacts to deals, click "Save to deal + address book" to build it up.':'No contacts match your search.'}
            </div>
          )}
          <div style={{display:'grid',gap:10}}>
            {filteredBook.map(entry=>(
              <div key={entry.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <div style={{width:36,height:36,borderRadius:18,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:14,fontWeight:700,color:T.gold,flexShrink:0}}>
                  {(entry.name?.[0]||'?').toUpperCase()}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.text}}>{entry.name}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{CONTACT_ROLES[entry.role]||entry.role}{entry.company_name?` · ${entry.company_name}`:''}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginTop:2}}>
                    {entry.phone&&<span style={{marginRight:12}}>📞 {entry.phone}</span>}
                    {entry.email&&<span>✉ {entry.email}</span>}
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>addFromBook(entry)} style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold}}>
                    + Add to deal
                  </button>
                  <button onClick={()=>deleteFromBook(entry.id)} style={{fontFamily:mono,fontSize:11,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── DOCUMENTS TAB ─────────────────────────────────────────────────────────────
function DocumentsTab({ dealId, userId, showToast }) {
  const { T } = useTheme()
  const [docs, setDocs]         = useState([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    api.fetchDealDocuments(dealId).then(setDocs).catch(()=>{})
  }, [dealId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadDealDocument(dealId, file, userId)
      const docs = await api.fetchDealDocuments(dealId)
      setDocs(docs)
      showToast('Document uploaded')
    } catch(e) { showToast(e.message,'error') }
    setUploading(false)
  }

  async function remove(doc) {
    try {
      await api.deleteDealDocument(doc)
      setDocs(prev=>prev.filter(d=>d.id!==doc.id))
      showToast('Document removed')
    } catch(e) { showToast(e.message,'error') }
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
        <span style={{fontFamily:mono,fontSize:12,color:T.muted}}>Documents stored against this deal</span>
        <label style={{cursor:'pointer'}}>
          <span className="btn btn-gold" style={{fontSize:11}}>{uploading?'Uploading…':'+ Upload Document'}</span>
          <input type="file" style={{display:'none'}} onChange={handleUpload} disabled={uploading}/>
        </label>
      </div>
      {docs.length===0
        ? <div className="card" style={{padding:32,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>
            No documents yet. Upload your survey report, mortgage offer, legal pack or contracts.
          </div>
        : <div style={{display:'grid',gap:8}}>
            {docs.map(doc=>(
              <div key={doc.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
                <span style={{fontSize:20}}>📄</span>
                <div style={{flex:1}}>
                  <a href={doc.url} target="_blank" rel="noreferrer" style={{fontSize:13,fontWeight:600,color:T.gold,textDecoration:'none'}}>{doc.name}</a>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:2}}>
                    {doc.size ? (doc.size/1024).toFixed(0)+'KB · ' : ''}
                    {new Date(doc.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                  </div>
                </div>
                <button onClick={()=>remove(doc)} style={{fontFamily:mono,fontSize:11,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>Remove</button>
              </div>
            ))}
          </div>
      }
    </div>
  )
}

// ── COMPARISON MODAL ──────────────────────────────────────────────────────────
function CompareModal({ deals, companies, onClose }) {
  const { T } = useTheme()
  const rows = [
    { label:'Purchase price', fn: d => fmt(d.purchase_price) },
    { label:'Total cash in', fn: d => {
      const sd = d.stamp_duty_override ?? api.calcStampDuty(d.purchase_price, d.is_additional_property, d.is_first_time_buyer)
      const total = (d.purchase_price||0)+sd+(d.legal_fees||0)+(d.survey_cost||0)+(d.refurb_cost||0)+(d.other_costs||0)
      const loan = d.purchase_type==='cash' ? 0 : (d.purchase_price||0)*(1-(d.deposit_percent||25)/100)
      return fmt(Math.max(0, total-loan))
    }},
    { label:'Monthly rent', fn: d => fmt(d.deal_type==='hmo'?(d.hmo_rooms||4)*(d.hmo_rent_per_room||0):d.monthly_rent||0) },
    { label:'Monthly repayment', fn: d => fmt(d.purchase_type==='cash'?0:api.calcMonthlyRepayment((d.purchase_price||0)*(1-(d.deposit_percent||25)/100),d.mortgage_rate||5,d.mortgage_term||25)) },
    { label:'Gross yield', fn: d => {
      const rent = d.deal_type==='hmo'?(d.hmo_rooms||4)*(d.hmo_rent_per_room||0):d.monthly_rent||0
      return d.purchase_price>0?fmtPct((rent*12/d.purchase_price)*100):'—'
    }, highlight: true },
    { label:'Deal type', fn: d => DEAL_TYPE_LABELS[d.deal_type]||'BTL' },
    { label:'Purchase type', fn: d => PURCHASE_TYPES[d.purchase_type]||'Mortgage' },
    { label:'Status', fn: d => STATUS_CFG[d.status]?.label||d.status },
  ]

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:400,padding:24}}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,width:'100%',maxWidth:900,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{padding:'20px 28px',borderBottom:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h2 style={{fontSize:18,fontWeight:700,color:T.text}}>Deal Comparison</h2>
          <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{padding:'20px 28px'}}>
          <div style={{display:'grid',gridTemplateColumns:`160px repeat(${deals.length},1fr)`,gap:0}}>
            <div/>
            {deals.map(d=>{
              const co = companies.find(c=>c.id===d.company_id)
              return (
                <div key={d.id} style={{padding:'12px 16px',background:T.card,borderRadius:'8px 8px 0 0',margin:'0 4px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:4}}>{d.name}</div>
                  {co&&<div style={{fontFamily:mono,fontSize:10,color:co.color||T.gold}}>{co.abbr} {co.name}</div>}
                </div>
              )
            })}
            {rows.map(row=>(
              <>
                <div key={row.label+'l'} style={{padding:'10px 0',fontFamily:mono,fontSize:11,color:T.muted,display:'flex',alignItems:'center'}}>
                  {row.label}
                </div>
                {deals.map(d=>(
                  <div key={d.id+row.label} style={{padding:'10px 16px',margin:'0 4px',background:T.card,borderBottom:`1px solid ${T.border}`,textAlign:'center',fontFamily:mono,fontSize:row.highlight?14:12,fontWeight:row.highlight?700:400,color:row.highlight?T.gold:T.text}}>
                    {row.fn(d)}
                  </div>
                ))}
              </>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DEAL PIPELINE KANBAN ──────────────────────────────────────────────────────
function DealPipeline({ deals, companies, onOpen, onNew, T }) {
  const STAGES = [
    { key: 'analysing',   label: '🔍 Analysing',   color: '#4B8FE0' },
    { key: 'offer',       label: '📝 Offer made',  color: '#C8A84B' },
    { key: 'under_offer', label: '🤝 Under offer', color: '#E0943A' },
    { key: 'exchanged',   label: '✍ Exchanged',   color: '#9B59B6' },
    { key: 'complete',    label: '🎉 Complete',    color: '#2ECC8A' },
    { key: 'dead',        label: '❌ Dead',        color: '#888' },
  ]

  const byStage = Object.fromEntries(STAGES.map(s => [s.key, deals.filter(d => (d.status||'analysing') === s.key)]))
  const totalValue = deals.filter(d=>d.status!=='dead').reduce((s,d)=>s+(d.purchase_price||0),0)
  const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display:'flex', gap:16, marginBottom:20, flexWrap:'wrap' }}>
        {[
          { label:'Total deals', value: deals.length, color: T.text },
          { label:'Pipeline value', value: fmt(totalValue), color: T.gold },
          { label:'Active', value: deals.filter(d=>!['dead','complete'].includes(d.status||'analysing')).length, color: '#4B8FE0' },
          { label:'Completed', value: byStage.complete?.length||0, color: '#2ECC8A' },
        ].map(k => (
          <div key={k.label} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:'10px 16px' }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, overflowX:'auto', minHeight:400 }}>
        {STAGES.map(stage => {
          const stagDeals = byStage[stage.key] || []
          return (
            <div key={stage.key} style={{ minWidth:180 }}>
              {/* Column header */}
              <div style={{ padding:'8px 12px', borderRadius:'8px 8px 0 0', background:stage.color+'22', border:`1px solid ${stage.color}44`, borderBottom:'none', marginBottom:0 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, color:stage.color }}>{stage.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:T.muted }}>{stagDeals.length} deal{stagDeals.length!==1?'s':''}</div>
              </div>

              {/* Cards */}
              <div style={{ background:T.bg, border:`1px solid ${stage.color}44`, borderRadius:'0 0 8px 8px', padding:8, minHeight:200 }}>
                {stagDeals.map(deal => {
                  const co = companies.find(c=>c.id===deal.company_id)
                  const sdlt = deal.stamp_duty_override ?? (deal.purchase_price ? Math.round(deal.purchase_price * (deal.is_additional_property!==false ? 0.05 : 0.02)) : 0)
                  return (
                    <div key={deal.id} onClick={()=>onOpen(deal)}
                      style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 12px', marginBottom:8, cursor:'pointer', transition:'border-color 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=stage.color}
                      onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                      {/* Deal name */}
                      <div style={{ fontSize:12, fontWeight:700, color:T.text, marginBottom:4, lineHeight:1.4 }}>
                        {deal.name || 'Untitled deal'}
                      </div>
                      {/* Company badge */}
                      {co && (
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4, background:(co.color||T.gold)+'22', color:co.color||T.gold, display:'inline-block', marginBottom:6 }}>{co.abbr}</div>
                      )}
                      {/* Price */}
                      {deal.purchase_price > 0 && (
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:T.text, fontWeight:600, marginBottom:2 }}>{fmt(deal.purchase_price)}</div>
                      )}
                      {/* Type badge */}
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:4 }}>
                        {deal.deal_type && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, padding:'2px 6px', borderRadius:4, background:T.blue+'22', color:T.blue }}>{deal.deal_type.toUpperCase()}</span>
                        )}
                        {deal.purchase_price > 0 && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, padding:'2px 6px', borderRadius:4, background:T.bg, color:T.muted }}>
                            {((deal.monthly_rent||deal.hmo_rooms*deal.hmo_rent_per_room||0)*12/(deal.purchase_price)*100).toFixed(1)}% yield
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {stagDeals.length === 0 && (
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:T.muted, textAlign:'center', padding:'20px 8px', opacity:0.5 }}>
                    No deals
                  </div>
                )}
                {stage.key === 'analysing' && (
                  <button onClick={onNew} style={{ width:'100%', fontFamily:"'DM Mono',monospace", fontSize:10, padding:'7px', borderRadius:6, border:`1px dashed ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer', marginTop:4 }}>
                    + Add deal
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:T.muted, marginTop:12 }}>
        Click any deal to open it. Change a deal's stage in the deal editor to move it between columns.
      </div>
    </div>
  )
}
