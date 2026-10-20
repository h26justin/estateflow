import { MONO, CV, FS, SANS, R } from '../../lib/styles'
import { Button, Modal } from '../ui'

// Rename-company dialog. Moved verbatim from App.jsx; every value it
// reads is passed in explicitly.
export function RenameCompanyModal({
  T, renameCoTarget, renameCo, setRenameCo, renameCoPassword, setRenameCoPassword,
  setRenameCoError, renameCoError, setRenameCoTarget, handleRenameCompany, renameCoSaving,
}) {
  return (
    <Modal onClose={()=>!renameCoSaving&&setRenameCoTarget(null)} size="sm" zIndex={600} title="Rename company"
      description={<>Currently: <strong style={{color:T.text}}>{renameCoTarget.name}</strong></>}
      footer={<>
        <Button variant="secondary" onClick={()=>setRenameCoTarget(null)}>
          Cancel
        </Button>
        <Button onClick={handleRenameCompany} disabled={renameCoSaving}>
          {renameCoSaving?'Saving…':'Save new name'}
        </Button>
      </>}>
        <div style={{display:'grid',gap:14}}>
          <div>
            <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:5,}}>New company name</label>
            <input aria-label="New company name" value={renameCo.name} onChange={e=>setRenameCo(p=>({...p,name:e.target.value}))} autoFocus
              style={{width:'100%',fontFamily:SANS,fontSize:FS.base,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:R.sm,padding:'10px 14px',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:5,}}>Abbreviation (up to 5 chars)</label>
            <input aria-label="Abbreviation (up to 5 chars)" value={renameCo.abbr} onChange={e=>setRenameCo(p=>({...p,abbr:e.target.value.toUpperCase().slice(0,5)}))} placeholder="e.g. ACME"
              style={{width:'100%',fontFamily:SANS,fontSize:FS.base,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:R.sm,padding:'10px 14px',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:5,}}>Your password to confirm</label>
            <input aria-label="Your password to confirm" type="password" value={renameCoPassword} onChange={e=>{setRenameCoPassword(e.target.value);setRenameCoError('')}}
              placeholder="Enter your password"
              style={{width:'100%',fontFamily:SANS,fontSize:FS.base,background:T.bg,border:`1.5px solid ${renameCoError?T.red:T.border}`,color:T.text,borderRadius:R.sm,padding:'10px 14px',boxSizing:'border-box'}}/>
            {renameCoError&&<div style={{fontFamily:SANS,fontSize:FS.sm,color:T.red,marginTop:6}}>{renameCoError}</div>}
          </div>
        </div>
    </Modal>
  )
}
