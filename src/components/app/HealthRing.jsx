import { memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'

// Portfolio health ring (redesign Dashboard hero). `score` is 0-100; the band
// label + colour follow the same thresholds the per-property HealthBadge uses.
export const HealthRing = memo(({ score }) => {
  const { T } = useTheme()
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const band = s >= 80 ? { label:'Good standing', color:T.green }
             : s >= 60 ? { label:'Needs attention', color:T.amber }
             : { label:'Action needed', color:T.red }
  const r = 30, c = 2 * Math.PI * r, dash = (s / 100) * c
  return (
    <div style={{display:'flex',alignItems:'center',gap:14}}>
      <div style={{position:'relative',width:74,height:74,flexShrink:0}}>
        <svg width="74" height="74" viewBox="0 0 74 74" style={{transform:'rotate(-90deg)'}}>
          <circle cx="37" cy="37" r={r} fill="none" stroke={T.border} strokeWidth="6"/>
          <circle cx="37" cy="37" r={r} fill="none" stroke={band.color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}/>
        </svg>
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
          <span style={{fontFamily:MONO,fontSize:20,fontWeight:500,color:T.text,lineHeight:1}}>{s}</span>
        </div>
      </div>
      <div>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>Portfolio health</div>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,fontWeight:600,color:band.color}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:band.color}}/>{band.label}
        </div>
      </div>
    </div>
  )
})
