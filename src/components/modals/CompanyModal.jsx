import { useState, useEffect } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { isFormDirty } from '../../lib/modalUtils'
import { useConfirm } from '../../lib/ConfirmContext'
import * as api from '../../lib/api'
import { pressable } from '../../lib/pressable'
import { LegalOwnerChoice } from '../CompanyLegalOwner'
import { COMPANY_COLORS, DEFAULT_COMPANY_COLOR } from '../../lib/companyColors'
import { Button, Modal } from '../ui'

export default function CompanyModal({ onClose, onSave }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const initialForm = { name:'', abbr:'', color:DEFAULT_COMPANY_COLOR, companyType:'operating', legalOwner:null }
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

  return <Modal onClose={onClose} size="md" isDirty={isDirty} confirmFn={confirmDiscard}
      title="Add company" description="Create a new company to group properties under."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="company-modal-form">
          {similarCompanies.length > 0 ? 'Create anyway' : 'Add company'}
        </Button>
      </>}>
      <form id="company-modal-form" onSubmit={e=>{e.preventDefault(); handleSave()}} style={{display:'flex',flexDirection:'column',gap:12}}>
        <div>
          <label htmlFor="cm-name">Company name *</label>
          <input id="cm-name" value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Vale Property Group" style={triedSave && !form.name ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.name ? 'true' : undefined} aria-describedby={triedSave && !form.name ? 'cm-name-err' : undefined}/>
          {triedSave && !form.name && <span id="cm-name-err" style={{fontFamily:MONO,fontSize:FS.xs,color:T.red,display:'block',marginTop:4}}>Required</span>}
        </div>

        {/* Similar-companies warning */}
        {similarCompanies.length > 0 && (
          <div style={{ background:T.amber+'11', border:`1px solid ${T.amber}55`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontFamily:SANS, fontSize:FS.sm, fontWeight:700, color:T.amber, marginBottom:6 }}>
              A company with a similar name already exists
            </div>
            <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, marginBottom:10, lineHeight:1.5 }}>
              {similarCompanies.length === 1 ? 'Did you mean to join this one?' : 'Did you mean to join one of these?'} If yes, ask the owner for a shareable invite link instead of creating a duplicate.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {similarCompanies.map(co => (
                <div key={co.id} style={{ fontFamily:SANS, fontSize:FS.sm, color:T.text, padding:'6px 10px', background:T.bg, borderRadius:6 }}>
                  <strong>{co.name}</strong>
                </div>
              ))}
            </div>
            <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.faint, fontStyle:'italic', marginTop:8 }}>
              Or continue below to create a separate "{form.name.trim()}" company.
            </div>
          </div>
        )}

        <div>
          <label htmlFor="cm-abbr">Short Code (3-4 letters)</label>
          <input id="cm-abbr" value={form.abbr} onChange={e=>s('abbr',e.target.value.toUpperCase())} placeholder="e.g. VPG" maxLength={4} style={triedSave && !form.abbr ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.abbr ? 'true' : undefined} aria-describedby={triedSave && !form.abbr ? 'cm-abbr-err' : undefined}/>
          {triedSave && !form.abbr && <span id="cm-abbr-err" style={{fontFamily:MONO,fontSize:FS.xs,color:T.red,display:'block',marginTop:4}}>Required</span>}
        </div>
        <div>
          <label>Type</label>
          <div style={{display:'flex',gap:8}}>
            {[['operating','Operating','Owns properties directly'],['holding','Holding company','Owns other companies — no properties, shows a group view instead']].map(([v,l,d])=>(
              <button key={v} type="button" onClick={()=>s('companyType',v)}
                title={d}
                style={{flex:1,fontFamily:SANS,fontSize:FS.sm,padding:'9px 10px',borderRadius:8,cursor:'pointer',textAlign:'left',
                  border:`1px solid ${form.companyType===v?T.gold:T.border}`,
                  background:form.companyType===v?T.gold+'18':'transparent',
                  color:form.companyType===v?T.goldText:T.muted}}>
                <div style={{fontWeight:700}}>{l}</div>
                <div style={{fontSize:FS.xs,marginTop:2,lineHeight:1.4,color:T.muted}}>{d}</div>
              </button>
            ))}
          </div>
        </div>
        {form.companyType !== 'holding' && (
          <LegalOwnerChoice T={T} value={form.legalOwner} onChange={v=>s('legalOwner',v)} idPrefix="cm-legal-owner"/>
        )}
        {/* Presets clear WCAG AA on light surfaces (lib/companyColors). The
            selected swatch gets a two-tone ring (surface gap + ink outline)
            so it reads in both themes — the old white border vanished on
            light backgrounds. */}
        <div><label id="cm-colour-label">Colour</label><div role="radiogroup" aria-labelledby="cm-colour-label" style={{display:'flex',gap:10,flexWrap:'wrap',padding:3}}>{COMPANY_COLORS.map(({name,hex})=>{
          const on = (form.color||'').toLowerCase()===hex.toLowerCase()
          return <div key={hex} {...pressable(()=>s('color',hex), { role: 'radio', 'aria-checked': on, 'aria-label': `Colour ${name}` })} title={name} style={{width:32,height:32,borderRadius:8,background:hex,cursor:'pointer',boxShadow:on?`0 0 0 2px ${T.surface}, 0 0 0 4px ${T.text}`:'none',transition:'box-shadow 0.15s'}}/>
        })}</div></div>
      </form>
    </Modal>
}
