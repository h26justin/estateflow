import { MONO, CV, FS } from '../../lib/styles'

// Rename-company dialog. Moved verbatim from App.jsx; every value it
// reads is passed in explicitly.
export function RenameCompanyModal({
  T, renameCoTarget, renameCo, setRenameCo, renameCoPassword, setRenameCoPassword,
  setRenameCoError, renameCoError, setRenameCoTarget, handleRenameCompany, renameCoSaving,
}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:24}}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:420,padding:'32px 28px',border:`1px solid ${T.border}`}}>
        <h2 style={{fontSize:18,fontWeight:700,textAlign:'center',marginBottom:6}}>Rename company</h2>
        <p style={{fontFamily:MONO,fontSize:12,color:T.muted,textAlign:'center',marginBottom:24}}>Currently: <strong style={{color:T.text}}>{renameCoTarget.name}</strong></p>
        <div style={{display:'grid',gap:14,marginBottom:20}}>
          <div>
            <label style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>New company name</label>
            <input aria-label="New company name" value={renameCo.name} onChange={e=>setRenameCo(p=>({...p,name:e.target.value}))} autoFocus
              style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation (up to 5 chars)</label>
            <input aria-label="Abbreviation (up to 5 chars)" value={renameCo.abbr} onChange={e=>setRenameCo(p=>({...p,abbr:e.target.value.toUpperCase().slice(0,5)}))} placeholder="e.g. ACME"
              style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your password to confirm</label>
            <input aria-label="Your password to confirm" type="password" value={renameCoPassword} onChange={e=>{setRenameCoPassword(e.target.value);setRenameCoError('')}}
              placeholder="Enter your password"
              style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1.5px solid ${renameCoError?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
            {renameCoError&&<div style={{fontFamily:MONO,fontSize:11,color:T.red,marginTop:6}}>{renameCoError}</div>}
          </div>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={()=>setRenameCoTarget(null)}
            style={{flex:1,fontFamily:MONO,fontSize:12,padding:'11px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={handleRenameCompany} disabled={renameCoSaving}
            style={{flex:2,fontFamily:MONO,fontSize:12,fontWeight:700,padding:'11px',borderRadius:10,border:'none',background:renameCoSaving?T.border:T.gold,color:CV.onGold,cursor:'pointer'}}>
            {renameCoSaving?'Saving…':'Save new name'}
          </button>
        </div>
      </div>
    </div>
  )
}
