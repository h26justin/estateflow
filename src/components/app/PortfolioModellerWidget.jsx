import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'

export function PortfolioModellerWidget({ properties = [] }) {
  const { T } = useTheme()
  const [extraProps, setExtraProps] = useState(5)
  const [avgPrice, setAvgPrice] = useState(175000)
  const [avgYield, setAvgYield] = useState(6.5)
  const [years, setYears] = useState(10)
  const [growthRate, setGrowthRate] = useState(3)
  const mono = MONO
  const currentIncome = properties.reduce((s,p) => s + (p.rent_pcm||0)*12, 0)
  const currentValue  = properties.reduce((s,p) => s + (p.current_value||p.est_value||0), 0)
  const newIncome = extraProps * avgPrice * (avgYield/100)
  const totalIncome = currentIncome + newIncome
  const totalValue  = currentValue + (extraProps * avgPrice)
  const futureValue = totalValue * Math.pow(1 + growthRate/100, years)
  const futureIncome= totalIncome * Math.pow(1 + 0.02, years)
  const f = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginTop:16}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <span style={{fontSize:20}}>📈</span>
        <div style={{fontSize:14,fontWeight:700,color:T.text}}>Portfolio what-if modeller</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:16}}>
        {[
          {label:'Additional properties',min:0,max:50,step:1,val:extraProps,set:setExtraProps,suffix:' props'},
          {label:'Avg purchase price',min:50000,max:1000000,step:5000,val:avgPrice,set:setAvgPrice,prefix:'£',fmt:true},
          {label:'Target gross yield',min:2,max:15,step:0.5,val:avgYield,set:setAvgYield,suffix:'%'},
          {label:'Annual capital growth',min:0,max:10,step:0.5,val:growthRate,set:setGrowthRate,suffix:'%'},
          {label:'Time horizon',min:1,max:30,step:1,val:years,set:setYears,suffix:' yrs'},
        ].map(s=>(
          <div key={s.label}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{s.label}</span>
              <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.goldText}}>
                {s.prefix||''}{s.fmt?parseInt(s.val).toLocaleString('en-GB'):s.val}{s.suffix||''}
              </span>
            </div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
              onChange={e=>s.set(parseFloat(e.target.value))} style={{width:'100%'}}/>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        {[
          {label:'Today',value:f(currentIncome)+'/yr',sub:f(currentValue)+' portfolio',color:T.muted},
          {label:'After buying '+extraProps+' more',value:f(totalIncome)+'/yr',sub:f(totalValue)+' portfolio',color:T.green},
          {label:'In '+years+' years',value:f(futureIncome)+'/yr',sub:f(futureValue)+' portfolio',color:T.goldText},
        ].map(k=>(
          <div key={k.label} style={{background:T.bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${k.color}`}}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:800,color:k.color}}>{k.value}</div>
            <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
