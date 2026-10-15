import { defaultRentYear, getMonthlyRentStats, stlPaymentIds } from '../../lib/rentStats'
import { canDo } from '../../lib/permissions'
import * as api from '../../lib/api'
import CalcExplain from '../CalcExplain'
import ActionMenu from '../ActionMenu'
import { MONO, FS } from '../../lib/styles'
import { calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit } from '../../lib/propertyCalcs'
import { ComplianceTab, TenancyTab, ExpensesTab, OverviewTab, FinancialsTab, DocumentsTab, MaintenanceTab, RightToRentTab, DepositProtectionTab, NoticeTrackerTab, RentHistoryTab, TenancyRenewalAlert, TenancyPanel, RefurbPropertyTab, HmoRoomsPanel, EpcPlanner, RentCollectionPanel, ESignPanel, ReferencingPanel } from './lazyViews'
import { fmt } from '../../lib/appFmt'
import { Badge, CompanyPill } from './Badges'
import { RentDots } from './RentDots'
import { RentTab } from './RentTab'

// Property detail view: header, tab bar and every per-property tab.
// Moved verbatim from App.jsx; every value it reads is passed in explicitly.
export function PropertyDetailView({
  closeDetail, isMobile, selected, T, permissionsMap, devModeActive, setEditProp, setShowAddProp,
  handleDuplicateProp, setShowSellModal, showToast, handleArchiveProp, confirmDialog,
  setShowDeleteConfirm, companySettings, activeFlags, detailTab, setDetailTab, yieldBasis, isAdmin,
  user, setEditingPayment, setView, insurancePolicies, companies, properties, setProperties,
  setSelectedId, setShowReferencing,
}) {
  return (
    <div className="fade">
      <button className="btn btn-ghost" style={{marginBottom:20,fontSize:11}} onClick={closeDetail}>&lt;- Back</button>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 280px',gap:18,alignItems:'start'}}>
        <div style={{minWidth:0}}>
          <div className="card" style={{padding:isMobile?'18px 16px':'24px 28px',marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div style={{flex:'1 1 auto',minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}><CompanyPill company={selected.company}/><Badge status={selected.status}/></div>
                <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:3}}>{selected.name}</h1>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{selected.address}</div>
                <div style={{fontFamily:MONO,fontSize:11,color:T.faint}}>{selected.prop_type}</div>
                {selected.managed_by&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,padding:'2px 10px',borderRadius:20,background:T.card,border:`1px solid ${T.border}`,fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>🏢 {selected.managed_by}</div>}
                {selected.archived_at&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,marginLeft:6,padding:'2px 10px',borderRadius:20,background:T.bg,border:`1px solid ${T.border}`,fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>Archived {new Date(selected.archived_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>}
              </div>
              <div style={{display:'flex',gap:8}}>
                {(canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive) && (
                  <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditProp(selected);setShowAddProp(true)}}>Edit</button>
                )}
                {(() => {
                  const canEdit = canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive
                  return (
                    <ActionMenu items={[
                      // Duplicate / Mark sold / Archive / Delete all mutate the property — gate by edit permission
                      ...(canEdit ? [{ label: 'Duplicate property', icon: '⊕',
                        onSelect: () => handleDuplicateProp(selected.id) }] : []),
                      ...(canEdit && selected.status !== 'sold' ? [{
                        label: 'Mark as sold', icon: '£',
                        onSelect: () => setShowSellModal(selected.id) }] : []),
                      // Export PDF is read-only — available to anyone who can see the property
                      { label: 'Export PDF summary', icon: '⤓',
                        onSelect: async () => {
                          try { await api.exportPropertySummaryPDF(selected) }
                          catch(e) { showToast(e.message, 'error') }
                        }},
                      ...(canEdit ? [
                        { divider: true },
                        ...(selected.archived_at
                          ? [{ label: 'Restore from archive', icon: '↩',
                               onSelect: () => handleArchiveProp(selected.id, false) }]
                          : [{ label: 'Archive property', icon: '📦',
                               onSelect: async () => {
                                 if (await confirmDialog({
                                   title: 'Archive this property?',
                                   body: 'It will be hidden from the active list and dashboard. You can restore it later.',
                                   confirmLabel: 'Archive',
                                 }))
                                   handleArchiveProp(selected.id, true)
                               }}]
                        ),
                        { label: 'Delete property', icon: 'trash',
                          destructive: true,
                          onSelect: () => setShowDeleteConfirm(selected.id) },
                      ] : []),
                    ]}/>
                  )
                })()}
              </div>
            </div>
          </div>
          {(()=>{
            const co = selected?.company_id
            const cs = companySettings[co] || {}
            // Top-level tabs: 9 max. Tenancy-related sub-views (Right to Rent / Deposit /
            // Notices / Rent History) are now nested inside Tenancy as sub-tabs to keep
            // the top row scannable. Old deep-link URLs (#/detail/<id>/deposit etc.) still
            // work because the tenancy section detects sub-tab URLs and switches accordingly.
            const tabs = ['overview','refurb','rent','financials']
            if(cs.feature_compliance)  tabs.push('compliance')
            if(cs.feature_tenancy)     tabs.push('tenancy')
            if(cs.feature_maintenance) tabs.push('maintenance')
            if(cs.feature_documents)   tabs.push('documents')
            if(cs.feature_expenses)    tabs.push('expenses')
            if(selected.is_hmo || activeFlags.has('hmo_rooms')) tabs.push('rooms')
            if(activeFlags.has('epc_planner')) tabs.push('epc-plan')
            // Tab keys are URL slugs (they form the #/detail/<id>/<tab>
            // segment — keys with spaces came back percent-encoded on
            // refresh and matched nothing, rendering a blank pane).
            // Multi-word keys need explicit display labels.
            const TAB_LABELS = { 'epc-plan': 'EPC Plan' }
            // Treat tenancy sub-tab URLs as if "tenancy" is the active top-level tab
            const TENANCY_SUB = ['right-to-rent','deposit','notices','rent-history']
            const activeTop = TENANCY_SUB.includes(detailTab) ? 'tenancy' : detailTab
            return (
              <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                {tabs.map(t=>(
                  <button key={t} className={`tab ${activeTop===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:TAB_LABELS[t]?'none':'capitalize'}}>{TAB_LABELS[t]||t}</button>
                ))}
              </div>
            )
          })()}
          {detailTab==='overview'&&<OverviewTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditProperty={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}

          {/* Rent-at-a-glance — most landlords arriving from Rent
              Tracker care about rent more than property metadata.
              Show this year's payment dots + YTD summary + a
              "Open full rent tracker" CTA. Stays on Overview so
              they don't need to switch tabs.

              Renders only when there's payment data; for brand-new
              properties we skip it so the Overview isn't padded
              with empty cards. */}
          {detailTab==='overview' && (() => {
            const payments = selected.rent_payments || []
            if (payments.length === 0) return null
            // Current year when it has data, else the most recent
            // year that does (shared defaultRentYear helper).
            const focusYear = defaultRentYear(payments)
            // Month-collapsed stats — same maths as the Rent Tracker
            // page so the two screens agree for the same year.
            const { paid, missed, late, income: collected } = getMonthlyRentStats(payments, focusYear, selected.rent_pcm)
            const arrears = selected.arrears || 0

            return (
              <div className="card" style={{padding:'16px 20px',marginTop:14,borderLeft:`3px solid ${T.green}`}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                      Rent · {focusYear}
                    </div>
                    {arrears > 0 && (
                      <span style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.red+'22',color:T.red}}>
                        {fmt(arrears)} in arrears
                      </span>
                    )}
                  </div>
                  <button className="btn btn-ghost" style={{fontSize:FS.xs}} onClick={()=>setDetailTab('rent')}>
                    Full history →
                  </button>
                </div>

                {/* Year of dots */}
                <RentDots payments={payments} filterYear={focusYear} stlIds={stlPaymentIds(selected)} property={selected}
                  onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})}
                  onDayTracker={(canDo(permissionsMap, selected.company_id, 'edit_rent') || devModeActive) ? ()=>setView('daytracker') : undefined}/>

                {/* YTD summary — compact 4-stat grid */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:14}}>
                  {[
                    {l:'Months paid',    v:paid,             c:T.green,  sub:fmt(collected)},
                    {l:'Months missed',  v:missed,           c:missed>0?T.red:T.muted,    sub:missed>0?fmt(missed*(selected.rent_pcm||0)):''},
                    {l:'Months late',    v:late,             c:late>0?T.amber:T.muted},
                    {l:'Monthly rent',   v:fmt(selected.rent_pcm), c:T.gold},
                  ].map((item,i)=>(
                    <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                      <div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:item.c}}>{item.v}</div>
                      {item.sub&&<div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,marginTop:2}}>{item.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {detailTab==='overview' && (() => {
            // Insurance summary: find policies covering THIS property.
            // Includes:
            //  - policies with an explicit property link
            //  - company-wide policies (no property links) belonging to
            //    the same company as this property
            const myPolicies = insurancePolicies.filter(pol => {
              if (pol.company_id !== selected.company_id) return false
              const links = pol.properties || []
              return links.length === 0 || links.some(p => p.id === selected.id)
            })
            if (myPolicies.length === 0) {
              return (
                <div className="card" style={{padding:'14px 20px',marginTop:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Insurance</div>
                    <div style={{fontFamily:MONO,fontSize:12,color:T.muted}}>No policies cover this property yet.</div>
                  </div>
                  <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{window.location.hash='#/compliance/insurance'}}>Add policy →</button>
                </div>
              )
            }
            // Show the next-expiring policy prominently, with a small
            // list of any others. Sorted by expiry date ascending.
            const sorted = [...myPolicies].sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date))
            const today = new Date(); today.setHours(0,0,0,0)
            return (
              <div className="card" style={{padding:'16px 20px',marginTop:14}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                  <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                    Insurance · {myPolicies.length} {myPolicies.length===1?'policy':'policies'}
                  </div>
                  <button className="btn btn-ghost" style={{fontSize:FS.xs}} onClick={()=>{window.location.hash='#/compliance/insurance'}}>Manage →</button>
                </div>
                <div style={{display:'grid',gap:6}}>
                  {sorted.map(pol => {
                    const expiry = new Date(pol.expiry_date)
                    const days = Math.floor((expiry - today) / (1000*60*60*24))
                    const color = days < 0 ? T.red : days <= 30 ? T.amber : days <= 90 ? T.gold : T.green
                    const status = days < 0
                      ? `Expired ${Math.abs(days)} ${Math.abs(days)===1?'day':'days'} ago`
                      : `Renews in ${days} ${days===1?'day':'days'}`
                    const isCompanyWide = (pol.properties || []).length === 0
                    return (
                      <div key={pol.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:12,alignItems:'center',padding:'8px 10px',background:T.bg,borderRadius:8,borderLeft:`3px solid ${color}`}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                            {pol.policy_name}
                            {isCompanyWide && <span style={{fontSize:FS.xs,color:T.muted,marginLeft:6,fontWeight:400}}>· company-wide</span>}
                          </div>
                          <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{pol.provider || '—'} · expires {pol.expiry_date}</div>
                        </div>
                        <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:color}}>{status}</div>
                        <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{fmt(pol.premium)}/yr</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
          {false&&detailTab==='overview-old'&&<div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
              {[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)},{l:'Total Invested',v:fmt((selected.purchase_price||0)+(selected.refurb_cost||0)),gold:true},{l:'Est. Value',v:fmt(selected.est_value)},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(1)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0}].map((item,i)=>(
                <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
                  <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
                  <div style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:item.gold?T.goldText:item.green?T.green:T.text}}>{item.v}</div>
                </div>
              ))}
            </div>
            {selected.notes&&<div className="card" style={{padding:'16px 20px'}}>
              <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Notes</div>
              <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
            </div>}
          </div>}
          {detailTab==='refurb'&&<RefurbPropertyTab property={selected} companies={companies} properties={properties} permissionsMap={permissionsMap} devModeActive={devModeActive} showToast={showToast} onPropertyPatch={(id, patch)=>setProperties(prev=>prev.map(p=>p.id===id?{...p,...patch}:p))} openRefurbs={()=>{setSelectedId(null);setView('refurbs')}}/>}
          {detailTab==='rent'&&<RentTab selected={selected} fmt={fmt} setEditingPayment={setEditingPayment} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} onDayTracker={()=>setView('daytracker')} canEdit={canDo(permissionsMap, selected.company_id, 'edit_rent') || devModeActive}/>}
          {detailTab==='financials'&&<FinancialsTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} calcMonthlyProfit={calcMonthlyProfit} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditFinancial={canDo(permissionsMap, selected.company_id, 'edit_financial') || devModeActive}/>}
          {false&&<div style={{display:'grid',gap:12}}>
            {[{title:'Purchase & Costs',items:[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Deposit',v:fmt(selected.deposit)},{l:'Mortgage Amount',v:fmt(selected.mortgage_amount)},{l:'Stamp Duty',v:fmt(selected.stamp_duty)},{l:'Legal Fees',v:fmt(selected.legal_fees)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)}]},{title:'Mortgage',items:[{l:'Rate',v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'-'},{l:'Term',v:selected.mortgage_term?selected.mortgage_term+' years':'-'},{l:'Monthly (Repay)',v:fmt(calcMonthlyMortgage(selected))},{l:'Monthly (IO)',v:selected.mortgage_amount&&selected.mortgage_rate?fmt(selected.mortgage_amount*selected.mortgage_rate/12):'-'}]},{title:'Returns',items:[{l:'Monthly Rent',v:fmt(selected.rent_pcm),gold:true},{l:'Annual Rent',v:fmt((selected.rent_pcm||0)*12),gold:true},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(2)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0},{l:'Annual Profit',v:fmt(calcMonthlyProfit(selected)*12),green:calcMonthlyProfit(selected)>0}]}].map((section,si)=>(
              <div key={si} className="card" style={{padding:'18px 22px'}}>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  {section.items.map((item,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                      <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                      <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:item.gold?T.goldText:item.green?T.green:T.text}}>{item.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>}
          {/* NOTE: no 'contractors' detail tab — it was renderable here
              but never present in the tab strip, so it was reachable
              only by hand-typed URL with nothing highlighted. Property-
              scoped contractor history lives in Maintenance. */}
          {(detailTab==='overview'||detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&<TenancyRenewalAlert propertyId={selected.id} rentPcm={selected.rent_pcm} userId={user?.id} showToast={showToast} T={T}/>}
          {detailTab==='compliance'&&<ComplianceTab propertyId={selected.id} property={selected} companySettings={companySettings[selected.company_id]||{}}
            onPropertyChange={(patch)=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,...patch}:p))}
            showToast={showToast} isAdmin={isAdmin} user={user} category="compliance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_compliance') || devModeActive}/>}
          {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&(()=>{
            // The four legacy values map to themselves as sub-tabs; "tenancy" => "details".
            const subTab = detailTab==='tenancy' ? 'details' : detailTab
            const SUBS = [
              ['details',       'Details'],
              ['right-to-rent', 'Right to Rent'],
              ['deposit',       'Deposit'],
              ['notices',       'Notices'],
              ['rent-history',  'Rent History'],
            ]
            return (
              <div>
                <div style={{display:'flex',gap:2,marginBottom:14,flexWrap:'wrap',borderBottom:`1px solid ${T.border}`,paddingBottom:0,alignItems:'center'}}>
                  {SUBS.map(([k,label])=>(
                    <button key={k}
                      onClick={()=>setDetailTab(k==='details' ? 'tenancy' : k)}
                      style={{
                        fontFamily:MONO,fontSize:11,padding:'8px 14px',
                        border:'none',borderBottom:`2px solid ${subTab===k?T.gold:'transparent'}`,
                        background:'transparent',cursor:'pointer',
                        color:subTab===k?T.text:T.muted,
                        fontWeight:subTab===k?700:400,
                        transition:'all 0.15s',
                        marginBottom:-1,
                      }}>
                      {label}
                    </button>
                  ))}
                  <button onClick={()=>setShowReferencing(true)}
                    style={{
                      marginLeft:'auto',marginBottom:6,
                      fontFamily:MONO,fontSize:11,fontWeight:700,
                      padding:'5px 12px',borderRadius:6,
                      border:`1px solid ${T.gold}66`,background:T.gold+'14',color:T.goldText,
                      cursor:'pointer',display:'flex',alignItems:'center',gap:6,
                    }}>
                    Tenant Referencing
                    <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.gold+'33',color:T.goldText}}>EARLY</span>
                  </button>
                </div>
                {subTab==='details'      &&<><TenancyPanel property={selected} showToast={showToast} canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive} onChanged={t=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,tenancies:t}:p))}/><TenancyTab key={selected.id} propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="tenancy" canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive}/></>}
                {subTab==='right-to-rent'&&<RightToRentTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                {subTab==='deposit'      &&<DepositProtectionTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                {subTab==='notices'      &&<NoticeTrackerTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T} property={selected}/>}
                {subTab==='rent-history' &&<RentHistoryTab propertyId={selected.id} userId={user?.id} currentRent={selected.rent_pcm} showToast={showToast} T={T} property={selected}/>}
              </div>
            )
          })()}
          {detailTab==='maintenance'&&<MaintenanceTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="maintenance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_maintenance') || devModeActive} activeFlags={activeFlags}/>}
          {detailTab==='expenses'&&<ExpensesTab propertyId={selected.id} showToast={showToast} fmt={fmt} rentPcm={selected.rent_pcm||0} isAdmin={isAdmin} user={user} category="expenses" canEdit={canDo(permissionsMap, selected.company_id, 'edit_expenses') || devModeActive} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive}/>}
          {detailTab==='documents'&&<DocumentsTab key={selected.id} propertyId={selected.id} propertyName={selected.name} showToast={showToast} isAdmin={isAdmin} user={user}/>}
          {detailTab==='rooms'&&(selected.is_hmo||activeFlags.has('hmo_rooms'))&&<HmoRoomsPanel propertyId={selected.id} isHmo={!!selected.is_hmo} onHmoChange={v=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,is_hmo:v}:p))} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
          {detailTab==='epc-plan'&&activeFlags.has('epc_planner')&&<EpcPlanner property={selected} T={T} canWrite={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
          {activeFlags.has('rent_collection')&&(detailTab==='rent'||detailTab==='rent-history')&&<RentCollectionPanel property={selected} companyId={selected.company_id} tenantUserId={null}/>}
          {detailTab==='documents'&&activeFlags.has('esign')&&<ESignPanel propertyId={selected.id} companyId={selected.company_id} documents={[]} T={T}/>}
          {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&activeFlags.has('referencing')&&<ReferencingPanel propertyId={selected.id} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
        </div>
        <div style={{display:'grid',gap:12}}>
          <div className="card" style={{padding:'18px 20px'}}>
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Quick Stats</div>
            {(() => {
              const cv = selected.current_value || selected.est_value || 0
              const totalCapIn = (selected.deposit||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)+(selected.refurb_cost||0)
              const eq = cv - (selected.mortgage_amount||0)
              const ltvNum = cv && selected.mortgage_amount ? (selected.mortgage_amount/cv)*100 : null
              return [
                {l:'Total Capital In', v:fmt(totalCapIn),
                  explain: {
                    title: 'Total Capital In',
                    formula: 'Deposit + Stamp Duty + Legal Fees + Refurb Cost',
                    inputs: [
                      { label: 'Deposit',     value: fmt(selected.deposit) },
                      { label: 'Stamp Duty',  value: fmt(selected.stamp_duty) },
                      { label: 'Legal Fees',  value: fmt(selected.legal_fees) },
                      { label: 'Refurb Cost', value: fmt(selected.refurb_cost) },
                    ],
                    result: fmt(totalCapIn),
                    note: !selected.mortgage_amount
                      ? "Heads up: this property has no mortgage recorded. For cash purchases, you may want to add the Purchase Price into Deposit so this number reflects the true cash you put in."
                      : "Cash you actually put in (excluding the mortgage). For mortgage purchases this is your real out-of-pocket.",
                  }},
                {l:'Current Value', v:fmt(cv),
                  explain: {
                    title: 'Current Value',
                    formula: 'Current Value (or Estimated Value as fallback)',
                    inputs: [
                      { label: 'Current Value',   value: selected.current_value ? fmt(selected.current_value) : '— (not set)' },
                      { label: 'Estimated Value', value: fmt(selected.est_value) },
                    ],
                    result: fmt(cv),
                    note: 'Set Current Value separately on Overview to track market changes vs. your initial estimate.',
                  }},
                {l:'Equity', v:fmt(eq),
                  explain: {
                    title: 'Equity',
                    formula: 'Current Value − Mortgage Amount',
                    inputs: [
                      { label: 'Current Value',   value: fmt(cv) },
                      { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                    ],
                    result: fmt(eq),
                    note: 'Your stake today. Goes negative if mortgage > value.',
                  }},
                {l:'LTV', v: ltvNum !== null ? ltvNum.toFixed(0)+'%' : '-',
                  explain: {
                    title: 'Loan to Value (LTV)',
                    formula: 'Mortgage Amount ÷ Current Value × 100',
                    inputs: [
                      { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                      { label: 'Current Value',   value: fmt(cv) },
                    ],
                    result: ltvNum !== null ? ltvNum.toFixed(1)+'%' : '— (no mortgage or value)',
                  }},
              ]
            })().map((item,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8,marginBottom:6}}>
                <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.goldText,display:'inline-flex',alignItems:'center',gap:2}}>
                  {item.v}
                  {item.explain && <CalcExplain {...item.explain}/>}
                </span>
              </div>
            ))}
          </div>
          {(selected.arrears||0)>0&&<div className="card" style={{padding:'16px 18px',borderLeft:`3px solid ${T.red}`}}>
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.red,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Rent Arrears</div>
            <div style={{fontFamily:MONO,fontSize:22,fontWeight:700,color:T.red,marginBottom:4}}>{fmt(selected.arrears)}</div>
            {selected.notes&&<div style={{fontFamily:MONO,fontSize:11,color:T.muted,lineHeight:1.6}}>{selected.notes}</div>}
          </div>}
        </div>
      </div>
    </div>
  )
}
