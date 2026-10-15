import { useTheme } from '../../lib/ThemeContext'
import { MONO } from '../../lib/styles'
import CalcExplain from '../CalcExplain'
import { NotesTimeline } from './NotesTimeline'

// ── FINANCIALS TAB ────────────────────────────────────────────────────────────
export function FinancialsTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit, isAdmin, user, showToast, canViewFinancial = true, canEditFinancial = true}) {
  const { T } = useTheme()

  if (!canViewFinancial) {
    return (
      <div style={{padding:40, textAlign:'center'}}>
        <div style={{fontSize:48, marginBottom:12}}>🔒</div>
        <div style={{fontFamily:MONO, fontSize:12, color:T.muted, marginBottom:8}}>Financial data is hidden</div>
        <div style={{fontFamily:MONO, fontSize:11, color:T.faint, maxWidth:420, margin:'0 auto', lineHeight:1.6}}>
          You don't have permission to view financial information for this property. Ask the company owner to grant you the "View financial data" permission.
        </div>
      </div>
    )
  }

  const mortgage = calcMonthlyMortgage(selected)
  const yield_ = calcGrossYield(selected)
  const monthlyProfit = calcMonthlyProfit(selected)
  const totalInvested = (selected.purchase_price||0)+(selected.refurb_cost||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)
  const currentVal = selected.current_value || selected.est_value || 0
  const equity = currentVal - (selected.mortgage_amount||0)
  const ltv = currentVal ? (((selected.mortgage_amount||0)/currentVal)*100).toFixed(1) : '—'

  // Yield calc — match calcGrossYield in App.jsx. yieldBasis from settings
  // determines whether the denominator is purchase+refurb ('cost') or current value.
  // Default is 'cost' so we describe that path; if the user has switched to 'value'
  // the actual number from calcGrossYield reflects that, but for transparency we
  // show the inputs that match what they'd see today.
  const yieldDenom = (selected.purchase_price||0)+(selected.refurb_cost||0)
  const annualRent = (selected.rent_pcm||0)*12
  const usingCurrentValue = !!selected.current_value && selected.current_value !== selected.est_value

  const sections = [
    {title:'Purchase & Costs', items:[
      {l:'Purchase Price',    v:fmt(selected.purchase_price)},
      {l:'Deposit',          v:fmt(selected.deposit)},
      {l:'Refurb Cost',      v:fmt(selected.refurb_cost)},
      {l:'Stamp Duty',       v:fmt(selected.stamp_duty)},
      {l:'Legal Fees',       v:fmt(selected.legal_fees)},
      {l:'Total Invested',   v:fmt(totalInvested), bold:true, color:'#C8A84B',
        explain: {
          title: 'Total Invested',
          formula: 'Purchase Price + Refurb + Stamp Duty + Legal Fees',
          inputs: [
            { label: 'Purchase Price', value: fmt(selected.purchase_price) },
            { label: 'Refurb Cost',    value: fmt(selected.refurb_cost) },
            { label: 'Stamp Duty',     value: fmt(selected.stamp_duty) },
            { label: 'Legal Fees',     value: fmt(selected.legal_fees) },
          ],
          result: fmt(totalInvested),
          note: 'This is your gross capital outlay. If you used a mortgage, your actual cash-in is lower (deposit + costs, not full purchase price).',
        }},
    ]},
    {title:'Mortgage', items:[
      {l:'Mortgage Amount',  v:fmt(selected.mortgage_amount)},
      {l:'Mortgage Rate',    v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'—'},
      {l:'Mortgage Term',    v:selected.mortgage_term?`${selected.mortgage_term} years`:'—'},
      {l:'Monthly Payment',  v:mortgage>0?fmt(mortgage):'—'},
      {l:'Annual Payments',  v:mortgage>0?fmt(mortgage*12):'—'},
      {l:'Loan to Value',    v:ltv!=='—'?ltv+'%':'—', color:'#9B59B6',
        explain: {
          title: 'Loan to Value (LTV)',
          formula: 'Mortgage Amount ÷ Current Value × 100',
          inputs: [
            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
            { label: 'Current Value',   value: fmt(currentVal) },
          ],
          result: ltv !== '—' ? ltv + '%' : '—',
          note: usingCurrentValue
            ? 'Using your updated current value. To use the original estimated value instead, clear the Current Value field on Overview.'
            : 'Current Value falls back to Estimated Value when not set separately.',
        }},
    ]},
    {title:'Returns', items:[
      {l:'Estimated Value',  v:fmt(selected.est_value), color:'#C8A84B'},
      {l:'Current Value',    v:fmt(currentVal), color:'#C8A84B'},
      {l:'Equity',           v:fmt(equity), color:equity>0?'#2ECC8A':'#E05555',
        explain: {
          title: 'Equity',
          formula: 'Current Value − Mortgage Amount',
          inputs: [
            { label: 'Current Value',   value: fmt(currentVal) },
            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
          ],
          result: fmt(equity),
          note: 'Your stake in the property today. Goes negative if mortgage > value (negative equity).',
        }},
      {l:'Monthly Rent',     v:fmt(selected.rent_pcm), color:'#2ECC8A'},
      {l:'Annual Rent',      v:fmt(annualRent), color:'#2ECC8A'},
      {l:'Gross Yield',      v:yield_>0?yield_.toFixed(2)+'%':'—', color:'#2ECC8A',
        explain: {
          title: 'Gross Yield',
          formula: '(Monthly Rent × 12) ÷ Cost Basis × 100',
          inputs: [
            { label: 'Monthly Rent',   value: fmt(selected.rent_pcm) },
            { label: 'Annual Rent',    value: fmt(annualRent) },
            { label: 'Purchase Price', value: fmt(selected.purchase_price) },
            { label: 'Refurb Cost',    value: fmt(selected.refurb_cost) },
            { label: 'Cost Basis',     value: fmt(yieldDenom) },
          ],
          result: yield_ > 0 ? yield_.toFixed(2) + '%' : '—',
          note: 'Cost basis defaults to Purchase Price + Refurb. You can switch to Current Value in Settings → Display.',
        }},
      {l:'Monthly Profit',   v:monthlyProfit>0?fmt(monthlyProfit):'—', color:monthlyProfit>0?'#2ECC8A':'#E05555',
        explain: {
          title: 'Monthly Profit',
          formula: 'Monthly Rent − Monthly Mortgage − (Insurance ÷ 12)',
          inputs: [
            { label: 'Monthly Rent',     value: fmt(selected.rent_pcm) },
            { label: 'Monthly Mortgage', value: mortgage > 0 ? fmt(mortgage) : '£0' },
            { label: 'Insurance ÷ 12',   value: fmt((selected.insurance||0)/12) },
          ],
          result: fmt(monthlyProfit),
          note: 'Simple cashflow estimate. Doesn\'t include voids, agent fees, maintenance reserve, or tax.',
        }},
    ]},
  ]

  return (
    <div>
      <div style={{display:'grid',gap:12,marginBottom:20}}>
        {sections.map((section,si)=>(
          <div key={si} className="card" style={{padding:'18px 22px'}}>
            <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {section.items.map((item,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                  <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                  <span style={{fontFamily:MONO,fontSize:11,fontWeight:item.bold?700:600,color:item.color||T.text,display:'inline-flex',alignItems:'center',gap:2}}>
                    {item.v||'—'}
                    {item.explain && <CalcExplain {...item.explain}/>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} category="financials"/>
    </div>
  )
}
