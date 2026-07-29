import { useState, useEffect } from 'react'
import { MONO } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { isFormDirty, safeOverlayClose } from '../../lib/modalUtils'
import { useConfirm } from '../../lib/ConfirmContext'
import * as api from '../../lib/api'
import FocusTrap from '../../lib/FocusTrap'

export default function CompanyModal({ onClose, onSave }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const initialForm = { name:'', abbr:'', color:'#C8A84B' }
  const [form, setForm] = useState(initialForm)
  const [snapshot] = useState(initialForm)
  const isDirty = isFormDirty(snapshot, form)
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Inline required-field highlighting — set once the user has tried to
  // save with something missing (same pattern as PropertyModal).
  const [triedSave, setTriedSave] = useState(false)

  function handleSave() {
    if (!form.name || !form.abbr) { setTriedSave(true); return }
    onSave(form)
  }

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

  return <div className="overlay" onClick={safeOverlayClose(isDirty, onClose, confirmDiscard)}>
    <FocusTrap onEscape={() => safeOverlayClose(isDirty, onClose, confirmDiscard)({ target: null, currentTarget: null })}>
    <div className="modal" style={{maxWidth:480}} role="dialog" aria-modal="true" aria-labelledby="company-modal-title">
      <div style={{padding:'24px 28px 0'}}>
        <h2 id="company-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>Add Company</h2>
        <p style={{fontFamily:MONO,color:T.muted,fontSize:11,marginBottom:20}}>Create a new company to group properties under.</p>
      </div>
      <form onSubmit={e=>{e.preventDefault(); handleSave()}} style={{padding:'0 28px 28px',display:'flex',flexDirection:'column',gap:12}}>
        <div>
          <label htmlFor="cm-name">Company Name *</label>
          <input id="cm-name" value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Vale Property Group" style={triedSave && !form.name ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.name ? 'true' : undefined} aria-describedby={triedSave && !form.name ? 'cm-name-err' : undefined}/>
          {triedSave && !form.name && <span id="cm-name-err" style={{fontFamily:MONO,fontSize:10,color:T.red,display:'block',marginTop:4}}>Required</span>}
        </div>

        {/* Similar-companies warning */}
        {similarCompanies.length > 0 && (
          <div style={{ background:T.amber+'11', border:`1px solid ${T.amber}55`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontFamily:MONO, fontSize:11, fontWeight:700, color:T.amber, marginBottom:6 }}>
              A company with a similar name already exists
            </div>
            <div style={{ fontFamily:MONO, fontSize:10, color:T.muted, marginBottom:10, lineHeight:1.5 }}>
              {similarCompanies.length === 1 ? 'Did you mean to join this one?' : 'Did you mean to join one of these?'} If yes, ask the owner for a shareable invite link instead of creating a duplicate.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {similarCompanies.map(co => (
                <div key={co.id} style={{ fontFamily:MONO, fontSize:11, color:T.text, padding:'6px 10px', background:T.bg, borderRadius:6 }}>
                  <strong>{co.name}</strong>
                </div>
              ))}
            </div>
            <div style={{ fontFamily:MONO, fontSize:10, color:T.faint, fontStyle:'italic', marginTop:8 }}>
              Or continue below to create a separate "{form.name.trim()}" company.
            </div>
          </div>
        )}

        <div>
          <label htmlFor="cm-abbr">Short Code (3-4 letters)</label>
          <input id="cm-abbr" value={form.abbr} onChange={e=>s('abbr',e.target.value.toUpperCase())} placeholder="e.g. VPG" maxLength={4} style={triedSave && !form.abbr ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.abbr ? 'true' : undefined} aria-describedby={triedSave && !form.abbr ? 'cm-abbr-err' : undefined}/>
          {triedSave && !form.abbr && <span id="cm-abbr-err" style={{fontFamily:MONO,fontSize:10,color:T.red,display:'block',marginTop:4}}>Required</span>}
        </div>
        <div><label>Colour</label><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['#C8A84B','#4B8FE0','#2ECC8A','#E05555','#9B59B6','#E0943A','#1ABC9C','#E74C3C'].map(col=><div key={col} onClick={()=>s('color',col)} style={{width:32,height:32,borderRadius:8,background:col,cursor:'pointer',border:`3px solid ${form.color===col?'#fff':'transparent'}`,transition:'border 0.15s'}}/>)}</div></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-gold">
            {similarCompanies.length > 0 ? 'Create anyway' : 'Add Company'}
          </button>
        </div>
      </form>
    </div>
    </FocusTrap>
  </div>
}
