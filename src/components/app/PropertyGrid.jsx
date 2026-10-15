import { useTheme } from '../../lib/ThemeContext'
import { complianceStatusFor, complianceBadge } from '../../lib/complianceStatus'
import { MONO, FS } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import { propTypeMeta } from '../../lib/propertyCalcs'
import { pressable } from '../../lib/pressable'
import { Badge, CompanyPill } from './Badges'

// (ComplianceMatrix moved to components/CompliancePage.jsx — the matrix is
// now a sub-view of the top-level Compliance page.)

// ─── PROPERTY CARD GRID ──────────────────────────────────────────────────────
// Redesign card grid (design/redesign-2026). An optional browse layout alongside
// the dense list — a light card with a company-accent left edge + accent-tinted
// type-icon tile, then name / company+status pills / rent · yield · compliance.


export function PropertyGrid({ filtered, fmt, openDetail, calcGrossYield, yieldBasis }) {
  const { T } = useTheme()
  if (!filtered.length) return <div style={{fontFamily:MONO,color:T.muted,fontSize:12,padding:32,textAlign:'center'}}>No properties match your filters.</div>
  // Compliance footer chip — one consistent pill shape for every state.
  const compliancePill = (cfg) => cfg
    ? <span title={cfg.label} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 9px',borderRadius:999,background:cfg.bg,color:cfg.color,fontFamily:MONO,fontSize:FS.xs,fontWeight:700,whiteSpace:'nowrap'}}><Icon name={cfg.iconName} size={11}/>{cfg.label}</span>
    : <span title="Compliance valid" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:999,background:T.green+'1A',color:T.green,fontFamily:MONO,fontSize:FS.xs,fontWeight:700,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:'50%',background:T.green}}/>Valid</span>
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
      {filtered.map(p=>{
        const co = p.company
        const accent = co?.color || T.gold
        const tm = propTypeMeta(p.prop_type)
        const cfg = complianceBadge(complianceStatusFor(p), T)
        const gy = calcGrossYield(p, yieldBasis)
        return (
          <div key={p.id} className="card pcard" {...pressable(()=>openDetail(p))}
            style={{cursor:'pointer',display:'flex',flexDirection:'column',gap:9,padding:'14px 15px',borderLeft:`3px solid ${accent}`}}>
            {/* Top: accent-tinted type-icon tile + name / pills / address */}
            <div style={{display:'flex',alignItems:'flex-start',gap:11,minWidth:0}}>
              <div title={p.prop_type || 'Property'} style={{position:'relative',width:38,height:38,borderRadius:10,background:accent+'1A',border:`1px solid ${accent}33`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <Icon name={tm.icon} size={19} color={accent}/>
                {(tm.beds != null || tm.studio) && (
                  <span style={{position:'absolute',bottom:-5,right:-5,minWidth:18,height:18,padding:'0 3px',borderRadius:9,background:accent,color:'#fff',fontFamily:MONO,fontSize:FS.xs,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${T.surface}`}}>
                    {tm.studio ? 'S' : tm.beds}
                  </span>
                )}
              </div>
              <div style={{flex:1,minWidth:0}}>
                {/* Name gets the full width (wraps to 2 lines); pills sit below */}
                <div style={{fontSize:14,fontWeight:700,color:T.text,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{p.name}</div>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:3}}>{p.prop_type}{p.address?` · ${p.address}`:''}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <CompanyPill company={co}/>
                  <Badge status={p.status}/>
                </div>
              </div>
            </div>
            {/* Footer: rent / yield / compliance */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
              <div>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:1}}>Rent</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.text}}>{fmt(p.rent_pcm)}<span style={{fontSize:FS.xs,color:T.muted,fontWeight:400}}>/mo</span></div>
              </div>
              <div>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:1}}>Yield</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.goldText}}>{gy.toFixed(1)}%</div>
              </div>
              {compliancePill(cfg)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
