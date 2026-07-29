import { useState, useEffect } from 'react'
import { MONO } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { safeOverlayClose } from '../../lib/modalUtils'
import { useConfirm } from '../../lib/ConfirmContext'
import { supabase } from '../../lib/supabase'
import * as api from '../../lib/api'
import FocusTrap from '../../lib/FocusTrap'

export default function AccessModal({ companies, userId, onClose, showToast }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const [allUsers, setAllUsers] = useState([])
  const [access, setAccess]     = useState({})
  const [loading, setLoading]   = useState(true)
  const [newEmail, setNewEmail] = useState('')
  // Inline required-field highlighting once Add User is tried with no email.
  const [triedAdd, setTriedAdd] = useState(false)

  useEffect(()=>{ loadData() },[])

  async function loadData() {
    setLoading(true)
    try {
      // Fetch all signed-up users via SECURITY DEFINER function
      const { data: authUsers } = await supabase.rpc('list_auth_users')

      // Fetch all access rows
      const { data: accessRows } = await supabase.from('user_company_access').select('*')

      // Build access map: { user_id: [company_id, ...] }
      const map = {}
      ;(accessRows || []).forEach(row => {
        if (!map[row.user_id]) map[row.user_id] = []
        map[row.user_id].push(row.company_id)
      })
      setAccess(map)

      // Prefer auth users list (complete), fall back to access rows
      if (authUsers && authUsers.length > 0) {
        setAllUsers(authUsers.map(u => ({ id: u.id, email: u.email })))
      } else {
        const fromRows = {}
        ;(accessRows || []).forEach(row => {
          if (!fromRows[row.user_id]) fromRows[row.user_id] = { id: row.user_id, email: row.email || row.user_id }
        })
        setAllUsers(Object.values(fromRows))
      }
    } catch(e) {
    }
    setLoading(false)
  }

  async function toggleAccess(targetUserId, companyId, email) {
    const current = access[targetUserId]?.companies || []
    const has = current.includes(companyId)
    try {
      if (has) {
        await api.revokeCompanyAccess(targetUserId, companyId)
      } else {
        await api.grantCompanyAccess(targetUserId, companyId, email)
      }
      await loadData()
      showToast('Access updated')
    } catch(e) { showToast(e.message, 'error') }
  }

  async function addUser() {
    const email = newEmail.trim().toLowerCase()
    if (!email) { setTriedAdd(true); return }
    // Look up UUID from already-loaded allUsers list
    const match = allUsers.find(u => u.email?.toLowerCase() === email)
    const targetId = match ? match.id : email // fallback to email if not signed up yet
    try {
      for (const co of companies) {
        await supabase.from('user_company_access')
          .upsert({ user_id: targetId, company_id: co.id, email, is_admin: false },
            { onConflict: 'user_id,company_id' })
      }
      setNewEmail('')
      await loadData()
      showToast(match ? `Access granted to ${email}` : `Invite saved — ${email} must sign up first`)
    } catch(e) { showToast(e.message, 'error') }
  }

  async function removeUser(targetUserId) {
    try {
      await api.removeUserAccess(targetUserId)
      await loadData()
      showToast('User removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  return (
    <div className="overlay" onClick={safeOverlayClose(newEmail.trim().length > 0, onClose, confirmDiscard)}>
      <FocusTrap onEscape={() => safeOverlayClose(newEmail.trim().length > 0, onClose, confirmDiscard)({ target: null, currentTarget: null })}>
      <div className="modal" style={{maxWidth:580}} role="dialog" aria-modal="true" aria-labelledby="access-modal-title">
        <div style={{padding:'24px 28px 0'}}>
          <h2 id="access-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>Company Access Control</h2>
          <p style={{fontFamily:MONO,color:T.muted,fontSize:11,marginBottom:20}}>Control which users can see which companies. Admins (like you) always see everything.</p>
        </div>
        <div style={{padding:'0 28px 28px'}}>

          {/* Add new user */}
          <div style={{marginBottom:20,padding:'16px',background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
            <label htmlFor="am-new-email">Add User by Email</label>
            <form onSubmit={e=>{e.preventDefault(); addUser()}} style={{display:'flex',gap:8,marginTop:6}}>
              <input id="am-new-email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                placeholder="user@example.com"
                style={{flex:1,fontSize:12,...(triedAdd && !newEmail.trim() ? {borderColor:T.red} : {})}}
                aria-invalid={triedAdd && !newEmail.trim() ? 'true' : undefined}
                aria-describedby={triedAdd && !newEmail.trim() ? 'am-new-email-err' : undefined}/>
              <button type="submit" className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}}>Add User</button>
            </form>
            {triedAdd && !newEmail.trim() && <span id="am-new-email-err" style={{fontFamily:MONO,fontSize:10,color:T.red,display:'block',marginTop:4}}>Required</span>}
            <div style={{fontFamily:MONO,fontSize:10,color:T.muted,marginTop:8}}>
              Note: The user must first sign up at your app URL. Users with no restrictions here see nothing - add them and then tick their companies below.
            </div>
          </div>

          {loading ? <div style={{textAlign:'center',padding:20,fontFamily:MONO,color:T.muted}}>Loading...</div> : (
            allUsers.length===0
              ? <div style={{textAlign:'center',padding:20,fontFamily:MONO,color:T.muted,fontSize:12}}>No users found. Make sure the <code>list_auth_users</code> SQL function has been created.</div>
              : allUsers.map(u=>(
                <div key={u.id} style={{marginBottom:16,padding:'14px 16px',background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{fontFamily:MONO,fontSize:12,color:T.text,fontWeight:600}}>{u.email}</div>
                      {u.id===userId&&<span style={{fontFamily:MONO,fontSize:9,background:T.gold+'22',color:T.gold,border:`1px solid ${T.gold}44`,borderRadius:4,padding:'2px 6px'}}>YOU · ADMIN</span>}
                      {u.id!==userId&&!(access[u.id]||[]).length&&<span style={{fontFamily:MONO,fontSize:9,background:T.green+'22',color:T.green,border:`1px solid ${T.green}44`,borderRadius:4,padding:'2px 6px'}}>ADMIN</span>}
                    </div>
                    {u.id!==userId&&<button className="btn btn-danger" style={{fontSize:10,padding:'4px 10px'}} onClick={()=>removeUser(u.id)}>Remove</button>}
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {companies.map(co=>{
                      const hasAccess = (access[u.id]||[]).includes(co.id)
                      return (
                        <button key={co.id} onClick={()=>toggleAccess(u.id, co.id, u.email)}
                          style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                            border:`1px solid ${hasAccess?co.color:T.border}`,
                            background:hasAccess?co.color+'22':'transparent',
                            color:hasAccess?co.color:T.muted,transition:'all 0.18s'}}>
                          {hasAccess?'✓ ':''}{co.abbr} {co.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
          )}

          <button className="btn btn-ghost" style={{width:'100%',marginTop:8,fontSize:12}} onClick={onClose}>Close</button>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
