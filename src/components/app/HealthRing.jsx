import { memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'
import { healthBand } from '../../lib/dashboardKpis'

// Portfolio health ring (redesign Dashboard hero). `score` is 0-100 (see
// portfolioHealth in lib/dashboardKpis, which caps it when legal compliance
// or arrears are outstanding); `reasons` are the short drivers shown under
// the label so the ring never reads "Good" without saying why not.
export const HealthRing = memo(({ score, reasons = [] }) => {
  const { T } = useTheme()
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const b = healthBand(s)
  const band = b === 'good' ? { label:'Good standing', color:T.green }
             : b === 'attention' ? { label:'Needs attention', color:T.amber }
             : { label:'Action needed', color:T.red }
  const r = 30, c = 2 * Math.PI * r, dash = (s / 100) * c
  return (
    <div role="img" aria-label={`Portfolio health ${s} out of 100: ${band.label}${reasons.length ? ` (${reasons.join(', ')})` : ''}`}
      style={{display:'flex',alignItems:'center',gap:14,minWidth:0}}>
      <div style={{position:'relative',width:74,height:74,flexShrink:0}}>
        <svg aria-hidden="true" width="74" height="74" viewBox="0 0 74 74" style={{transform:'rotate(-90deg)'}}>
          <circle cx="37" cy="37" r={r} fill="none" stroke={T.border} strokeWidth="6"/>
          <circle cx="37" cy="37" r={r} fill="none" stroke={band.color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}/>
        </svg>
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
          <span style={{fontFamily:MONO,fontSize:20,fontWeight:500,color:T.text,lineHeight:1}}>{s}</span>
        </div>
      </div>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>Portfolio health</div>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,fontWeight:600,color:band.color}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:band.color}}/>{band.label}
        </div>
        {reasons.length > 0 && (
          <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginTop:3,lineHeight:1.5,maxWidth:260,overflowWrap:'anywhere'}}>{reasons.join(' · ')}</div>
        )}
      </div>
    </div>
  )
})
