import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { isFormDirty, safeOverlayClose } from '../../lib/modalUtils'
import * as api from '../../lib/api'

export default function CompanyModal({ onClose, onSave }) {
  const { T } = useTheme()
  const initialForm = { name:'', abbr:'', color:'#C8A84B' }
  const [form, setForm] = useState(initialForm)
  const [snapshot] = useState(initialForm)
  const isDirty = isFormDirty(snapshot, form)
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Duplicate-name guard. As the user types, look up other companies with
  // similar names. We don't BLOCK creation — a user might genuinely want a
  // separate company with a similar name. We just warn so they can pause
  // and reach out to the existing owner if they meant to join one.
  const [similarCompanies, setSimilarCompanies] = useState([])
  const [, setChecking] = useState(false)
  useEffect(() => {
    let cancelled = false
    const trimmed = form.name.trim()
    if (trimmed.length < 3) { setSimilarCompanies([]); return }
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const matches = await api.findCompaniesByNameFuzzy(trimmed)
        if (!cancelled) setSimilarCompanies(matches || [])
      } catch(e) { /* non-fatal */ }
      if (!cancelled) setChecking(false)
    }, 300) // debounce so we're not slamming the DB on every keystroke
    return () => { cancelled = true; clearTimeout(handle) }
  }, [form.name])

  return <div className="overlay" onClick={safeOverlayClose(isDirty, onClose)}>
    <div className="modal" style={{maxWidth:480}}>
      <div style={{padding:'24px 28px 0'}}>
        <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>Add Company</h2>
        <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:11,marginBottom:20}}>Create a new company to group properties under.</p>
      </div>
      <div style={{padding:'0 28px 28px',display:'flex',flexDirection:'column',gap:12}}>
        <div><label>Company Name *</label><input value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Vale Property Group"/></div>

        {/* Similar-companies warning */}
        {similarCompanies.length > 0 && (
          <div style={{ background:T.amber+'11', border:`1px solid ${T.amber}55`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, color:T.amber, marginBottom:6 }}>
              ⚠ A company with a similar name already exists
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:T.muted, marginBottom:10, lineHeight:1.5 }}>
              {similarCompanies.length === 1 ? 'Did you mean to join this one?' : 'Did you mean to join one of these?'} If yes, ask the owner for a shareable invite link instead of creating a duplicate.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {similarCompanies.map(co => (
                <div key={co.id} style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:T.text, padding:'6px 10px', background:T.bg, borderRadius:6 }}>
                  <strong>{co.name}</strong>
                  {co.owner_email && <span style={{ color:T.muted }}> · owner: {co.owner_email}</span>}
                </div>
              ))}
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:T.faint, fontStyle:'italic', marginTop:8 }}>
              Or continue below to create a separate "{form.name.trim()}" company.
            </div>
          </div>
        )}

        <div><label>Short Code (3-4 letters)</label><input value={form.abbr} onChange={e=>s('abbr',e.target.value.toUpperCase())} placeholder="e.g. VPG" maxLength={4}/></div>
        <div><label>Colour</label><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['#C8A84B','#4B8FE0','#2ECC8A','#E05555','#9B59B6','#E0943A','#1ABC9C','#E74C3C'].map(col=><div key={col} onClick={()=>s('color',col)} style={{width:32,height:32,borderRadius:8,background:col,cursor:'pointer',border:`3px solid ${form.color===col?'#fff':'transparent'}`,transition:'border 0.15s'}}/>)}</div></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={()=>{if(form.name&&form.abbr)onSave(form)}}>
            {similarCompanies.length > 0 ? 'Create anyway' : 'Add Company'}
          </button>
        </div>
      </div>
    </div>
  </div>
}
