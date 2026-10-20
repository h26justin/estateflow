import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { useConfirm } from '../../lib/ConfirmContext'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { logError } from '../../lib/logError'
import RolePermissionsModal from '../RolePermissionsModal'
import { canDo, ROLE_OPTIONS, ROLE_OPTION_LABELS, roleFromAccessRow, roleUpdateFor, isAdminDemotion } from '../../lib/permissions'
import { ShareableLinksTab } from './ShareableLinksTab'
import { SkeletonRows } from '../../lib/Skeleton'
import { Button, EmptyState, Modal } from '../ui'

// ── ACCESS MODAL (Admin only) ─────────────────────────────────────────────────

// ── USER ACCESS MANAGEMENT ────────────────────────────────────────────────────
// Index user_company_access rows two ways: user -> [companyId] for the access
// pills, and "userId:companyId" -> row for the per-company role selector.
function indexAccessRows(rows) {
  const access = {}, rowMap = {}
  rows.forEach(row => {
    if (!row.company_id) return
    if (!access[row.user_id]) access[row.user_id] = []
    access[row.user_id].push(row.company_id)
    rowMap[row.user_id + ':' + row.company_id] = row
  })
  return { access, rowMap }
}

// user: the signed-in user (own row is locked). permissionsMap/devModeActive:
// from App.jsx, decide per company whether this user may change roles there
// (manage_users, or owner, or platform admin in dev mode).
export function AccessModal({companies, onClose, showToast, user, permissionsMap = null, devModeActive = false}) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const mono = MONO
  const [users, setUsers]           = useState([])
  const [access, setAccess]         = useState({})
  const [rowMap, setRowMap]         = useState({})   // "userId:companyId" -> access row
  const [roleTarget, setRoleTarget] = useState(null) // { user, company, accessRow } for RolePermissionsModal
  const [invites, setInvites]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(null)
  const [newEmail, setNewEmail]         = useState('')
  const [newIsAdmin, setNewIsAdmin]     = useState(false)
  const [selectedCoIds, setSelectedCoIds] = useState([]) // populated after companies load
  const [showCoSelect, setShowCoSelect] = useState(false)
  const [adding, setAdding]             = useState(false)
  const [tab, setTab]                   = useState('users')

  const beginLoad = useLoadGuard()
  // Load once when the modal opens: loadData also resets the company
  // selection, so a refreshed `companies` prop must not re-run it mid-edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ loadData() },[])

  async function loadData() {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const [authUsers, rows] = await Promise.all([
        api.fetchAllUsers().catch(()=>[]),
        api.fetchAllAccessRows().catch(()=>[])
      ])
      if (!isCurrent()) return
      // SECURITY: filter access rows to only those on companies the current user has shared
      const myCompanyIds = new Set((companies || []).map(c => c.id))
      const relevantRows = rows.filter(r => myCompanyIds.has(r.company_id))

      const indexed = indexAccessRows(relevantRows)
      setAccess(indexed.access)
      setRowMap(indexed.rowMap)

      // Only show users who ALREADY have access to one of my companies.
      // Do NOT expose the platform-wide user list to non-platform-admins.
      const allowedUserIds = new Set(relevantRows.map(r => r.user_id))
      const filteredUsers = authUsers.filter(u => allowedUserIds.has(u.id))

      if (filteredUsers.length > 0) {
        setUsers(filteredUsers.map(u => ({ id: u.id, email: u.email })))
      } else {
        const fromRows = {}
        relevantRows.forEach(row => {
          if (!fromRows[row.user_id]) fromRows[row.user_id] = { id: row.user_id, email: row.email || row.user_id }
        })
        setUsers(Object.values(fromRows))
      }
      // Load pending invites for all companies
      const allInvites = []
      for (const co of companies) {
        const inv = await api.fetchPendingInvitations(co.id).catch(()=>[])
        inv.forEach(i => allInvites.push({ ...i, companyName: co.name, companyAbbr: co.abbr, companyColor: co.color }))
      }
      if (!isCurrent()) return
      setInvites(allInvites)
      // Default: all companies selected
      setSelectedCoIds(companies.map(c => c.id))
    } catch(e) {
      if (!isCurrent()) return
      logError('AccessModal:loadData', e)
    }
    setLoading(false)
  }

  // Re-read only the access rows (not the user list or invites) so the role
  // shown is what the database holds, not what we hoped to save.
  async function reloadRows() {
    try {
      const rows = await api.fetchAllAccessRows()
      const myCompanyIds = new Set((companies || []).map(c => c.id))
      const indexed = indexAccessRows(rows.filter(r => myCompanyIds.has(r.company_id)))
      setAccess(indexed.access)
      setRowMap(indexed.rowMap)
    } catch(e) { /* keep the optimistic state; the toast already reported the save */ }
  }

  async function toggleCompany(userId, companyId, userEmail) {
    const has = (access[userId]||[]).includes(companyId)
    setSaving(userId + companyId)
    try {
      if (has) await api.revokeCompanyAccess(userId, companyId)
      else await api.grantCompanyAccess(userId, companyId, userEmail)
      setAccess(prev => ({
        ...prev,
        [userId]: has
          ? (prev[userId]||[]).filter(c=>c!==companyId)
          : [...(prev[userId]||[]), companyId]
      }))
      showToast('Access updated')
      await reloadRows()
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  // Change one member's role on one company. "Rent Tracker Editor" is stored
  // as viewer + {view_rent, edit_rent} overrides (see roleUpdateFor). Demoting
  // an admin is the one change that asks first.
  async function changeRole(u, co, option) {
    const key = u.id + ':' + co.id
    const current = roleFromAccessRow(rowMap[key])
    if (option === current) return
    if (isAdminDemotion(current, option)) {
      const ok = await confirmDialog({
        title: `Remove admin rights from ${u.email}?`,
        body: `They will become ${ROLE_OPTION_LABELS[option]} on ${co.name} and lose the ability to manage users and company settings there.`,
        confirmLabel: 'Change role', destructive: true,
      })
      if (!ok) return
    }
    setSaving(key + ':role')
    try {
      const { role, overrides } = roleUpdateFor(option)
      await api.updateUserRole(u.id, co.id, role, overrides)
      setRowMap(prev => ({
        ...prev,
        [key]: { ...(prev[key] || { user_id: u.id, company_id: co.id, email: u.email }), role, permissions: overrides, is_admin: role === 'admin' },
      }))
      showToast(`${u.email} is now ${ROLE_OPTION_LABELS[option]} on ${co.abbr || co.name}`)
      await reloadRows()
    } catch(e) { showToast(e.message || 'Could not change role', 'error') }
    setSaving(null)
  }

  async function setAllCompanies(userId, userEmail, giveAll) {
    setSaving(userId+'all')
    try {
      await api.setAllCompanyAccess(userId, userEmail, giveAll ? companies.map(c=>c.id) : [])
      setAccess(prev => ({ ...prev, [userId]: giveAll ? companies.map(c=>c.id) : [] }))
      showToast(giveAll ? 'Full access granted' : 'All access removed')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  async function removeUser(userId) {
    if (!await confirmDialog({ title: 'Remove this user completely?', body: 'They will lose access to all your companies.', confirmLabel: 'Remove', destructive: true })) return
    try {
      await api.removeUserAccess(userId)
      setUsers(prev=>prev.filter(u=>u.id!==userId))
      setAccess(prev=>{ const n={...prev}; delete n[userId]; return n })
      showToast('User removed')
    } catch(e) { showToast(e.message,'error') }
  }

  async function sendInvite() {
    const email = newEmail.trim().toLowerCase()
    if (!email || companies.length === 0) return
    setAdding(true)
    try {
      const coIds = selectedCoIds.length > 0 ? selectedCoIds : companies.map(c => c.id)
      const result = await api.sendInvitation(coIds, email, newIsAdmin)
      setNewEmail('')
      setNewIsAdmin(false)
      setSelectedCoIds(companies.map(c => c.id))
      setShowCoSelect(false)
      await loadData()
      if (result?.emailSent === false) {
        showToast(`Invite saved but email failed: ${result.emailError}`, 'error')
      } else {
        showToast(`Invitation email sent to ${email} ✓`)
      }
    } catch(e) { showToast(e.message,'error') }
    setAdding(false)
  }

  async function cancelInvite(id) {
    try {
      await api.deleteInvitation(id)
      setInvites(prev=>prev.filter(i=>i.id!==id))
      showToast('Invitation cancelled')
    } catch(e) { showToast(e.message,'error') }
  }

  const totalAccess = (u) => (access[u.id]||[]).length
  const hasAll = (u) => companies.every(co=>(access[u.id]||[]).includes(co.id))
  const hasNone = (u) => (access[u.id]||[]).length === 0

  const tabStyle = (k) => ({
    fontFamily: mono, fontSize: 11, padding: '7px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
    background: tab===k ? T.gold+'22' : 'transparent',
    color: tab===k ? T.goldText : T.muted,
    fontWeight: tab===k ? 600 : 400,
  })

  return (
    <>
    <Modal onClose={onClose} isDirty={newEmail.trim().length > 0} confirmFn={confirmDiscard} size="lg"
      title="User access management"
      description="Manage who can access your companies. Send invitations to new users."
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <div>

          {/* Tabs */}
          <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:0,flexWrap:'wrap'}}>
            <button style={tabStyle('users')} onClick={()=>setTab('users')}>
              Users ({users.length})
            </button>
            <button style={tabStyle('invites')} onClick={()=>setTab('invites')}>
              Pending Invites ({invites.length})
            </button>
            <button style={tabStyle('links')} onClick={()=>setTab('links')}>
              Shareable Links
            </button>
          </div>

          {/* ── INVITE NEW USER ── */}
          <div style={{background:T.bg,borderRadius:10,padding:'14px 16px',marginBottom:20,border:`1px solid ${T.border}`}}>
            <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,}}>Invite user by email</label>
            <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&sendInvite()}
                placeholder="colleague@example.com"
                style={{flex:1,minWidth:200,fontFamily:SANS,fontSize:FS.sm,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px'}}/>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <input type="checkbox" id="invite-admin" checked={newIsAdmin} onChange={e=>setNewIsAdmin(e.target.checked)} style={{width:'auto',margin:0}}/>
                <label htmlFor="invite-admin" style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,cursor:'pointer',whiteSpace:'nowrap'}}>Make admin</label>
              </div>
              <Button variant="primary" size="sm" onClick={sendInvite} disabled={adding||!newEmail.trim()}>
                {adding ? 'Sending…' : 'Send invite'}
              </Button>
            </div>
            {/* Company selector — only show if more than 1 company */}
            {companies.length > 1 && (
              <div style={{marginTop:10}}>
                <button onClick={()=>setShowCoSelect(s=>!s)}
                  style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline',textUnderlineOffset:2}}>
                  {showCoSelect ? '▲ Hide' : '▼ Choose'} which companies ({selectedCoIds.length} of {companies.length} selected)
                </button>
                {showCoSelect && (
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
                    {companies.map(co=>{
                      const sel = selectedCoIds.includes(co.id)
                      return (
                        <button key={co.id}
                          onClick={()=>setSelectedCoIds(prev=>sel?prev.filter(id=>id!==co.id):[...prev,co.id])}
                          style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 12px',borderRadius:20,cursor:'pointer',transition:'all 0.15s',
                            border:`1px solid ${sel?co.color:T.border}`,
                            background:sel?co.color+'22':'transparent',
                            color:sel?co.color:T.muted}}>
                          {sel?'✓ ':''}{co.abbr} {co.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginTop:8,lineHeight:1.6}}>
              An invitation link will be sent. They must sign up at <span style={{color:T.goldText}}>www.ownproperly.com</span> to accept it.
            </div>
          </div>

          {loading
            ? <SkeletonRows rows={3} height={36}/>
            : <>
              {/* ── USERS TAB ── */}
              {tab==='users' && (
                users.length===0
                  ? <EmptyState compact icon="users" title="No users yet" body="Send an invitation above."/>
                  : <div style={{display:'grid',gap:10}}>
                      {users.map(u=>(
                        <div key={u.id} style={{background:T.bg,borderRadius:12,padding:'14px 16px',border:`1px solid ${T.border}`}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{width:34,height:34,borderRadius:17,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:700,color:T.goldText,flexShrink:0}}>
                                {(u.email[0]||'?').toUpperCase()}
                              </div>
                              <div>
                                <div style={{fontSize:13,fontWeight:600,color:T.text}}>{u.email}</div>
                                <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>
                                  {hasNone(u)?'No access':hasAll(u)?'All companies':totalAccess(u)+' of '+companies.length+' companies'}
                                </div>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button onClick={()=>setAllCompanies(u.id,u.email,true)}
                                disabled={!!saving||hasAll(u)}
                                style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.green}`,color:T.green,background:T.green+'11',opacity:hasAll(u)?0.4:1}}>
                                All ✓
                              </button>
                              <button onClick={()=>setAllCompanies(u.id,u.email,false)}
                                disabled={!!saving||hasNone(u)}
                                style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.amber}`,color:T.amber,background:T.amber+'11',opacity:hasNone(u)?0.4:1}}>
                                None ✗
                              </button>
                              <button onClick={()=>removeUser(u.id)}
                                style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}`,color:T.red,background:T.red+'11'}}>
                                Remove
                              </button>
                            </div>
                          </div>
                          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                            {companies.map(co=>{
                              const has = (access[u.id]||[]).includes(co.id)
                              return (
                                <button key={co.id} onClick={()=>toggleCompany(u.id,co.id,u.email)}
                                  disabled={!!saving}
                                  style={{fontFamily:SANS,fontSize:FS.sm,padding:'6px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                                    border:`1px solid ${has?co.color:T.border}`,
                                    background:has?co.color+'22':'transparent',
                                    color:has?co.color:T.muted}}>
                                  {has?'✓ ':''}{co.abbr} {co.name}
                                </button>
                              )
                            })}
                          </div>

                          {/* Per-company role. Locked for the company owner, for
                              your own row, and where you lack manage_users. */}
                          {(access[u.id]||[]).length>0 && (
                            <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${T.border}`,display:'grid',gap:6}}>
                              <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Role per company</div>
                              {companies.filter(co=>(access[u.id]||[]).includes(co.id)).map(co=>{
                                const key = u.id+':'+co.id
                                const row = rowMap[key]
                                const current = roleFromAccessRow(row)
                                const isCompanyOwner = co.owner_id === u.id || current === 'owner'
                                const isSelf = !!user?.id && u.id === user.id
                                const canManage = devModeActive || canDo(permissionsMap, co.id, 'manage_users')
                                const locked = isCompanyOwner || isSelf || !canManage
                                const lockReason = isCompanyOwner ? 'The company owner always has full access'
                                  : isSelf ? 'You cannot change your own role'
                                  : 'Only an owner or admin of this company can change roles'
                                const busyHere = saving === key+':role'
                                return (
                                  <div key={co.id} style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                    <span style={{fontFamily:mono,fontSize:FS.xs,color:co.color||T.goldText,minWidth:56}}>{co.abbr}</span>
                                    {locked
                                      ? <span title={lockReason} style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 10px',borderRadius:6,border:`1px solid ${T.border}`,color:T.muted,background:T.surface}}>
                                          {isCompanyOwner ? 'Owner' : (ROLE_OPTION_LABELS[current] || current)}
                                        </span>
                                      : <select value={current} disabled={!!saving} aria-label={`Role for ${u.email} on ${co.name}`}
                                          onChange={e=>changeRole(u,co,e.target.value)}
                                          style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 8px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,cursor:saving?'wait':'pointer'}}>
                                          {ROLE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>}
                                    {busyHere && <span style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>Saving…</span>}
                                    {!locked && !busyHere && (
                                      <button onClick={()=>setRoleTarget({user:u,company:co,accessRow:row})}
                                        style={{fontFamily:SANS,fontSize:FS.sm,color:T.goldText,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline',textUnderlineOffset:2}}>
                                        Advanced…
                                      </button>
                                    )}
                                    <span style={{fontFamily:mono,fontSize:FS.xs,color:T.faint}}>
                                      {isCompanyOwner ? '' : (ROLE_OPTIONS.find(o=>o.value===current)?.hint || '')}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
              )}

              {/* ── INVITES TAB ── */}
              {tab==='invites' && (
                invites.length===0
                  ? <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.faint,textAlign:'center',padding:32,background:T.bg,borderRadius:10}}>
                      No pending invitations.
                    </div>
                  : <div style={{display:'grid',gap:8}}>
                      {invites.map(inv=>(
                        <div key={inv.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:T.bg,borderRadius:10,border:`1px solid ${T.border}`,gap:12,flexWrap:'wrap'}}>
                          <div>
                            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{inv.email}</div>
                            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>
                              Invited to <span style={{color:inv.companyColor||T.goldText}}>{inv.companyAbbr}</span> {inv.companyName}
                              {inv.is_admin && <span style={{marginLeft:8,background:T.gold+'22',color:T.goldText,padding:'1px 6px',borderRadius:4}}>Admin</span>}
                            </div>
                            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.faint,marginTop:2}}>
                              Expires {new Date(inv.expires_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                            </div>
                          </div>
                          <button onClick={()=>cancelInvite(inv.id)}
                            style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}`,color:T.red,background:T.red+'11',flexShrink:0}}>
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
              )}

              {/* ── SHAREABLE LINKS TAB ── */}
              {tab === 'links' && (
                <ShareableLinksTab companies={companies} showToast={showToast} T={T}/>
              )}
            </>
          }
        </div>
    </Modal>

      {/* Advanced per-key overrides for one member on one company. Reuses the
          platform-admin modal; its z-index sits above this overlay. */}
      {roleTarget && (
        <RolePermissionsModal
          user={roleTarget.user}
          company={roleTarget.company}
          accessRow={roleTarget.accessRow}
          showToast={showToast}
          onClose={()=>setRoleTarget(null)}
          onSaved={(newRow)=>{
            const key = roleTarget.user.id+':'+roleTarget.company.id
            setRowMap(prev=>({ ...prev, [key]: { ...(prev[key]||{ user_id: roleTarget.user.id, company_id: roleTarget.company.id }), role: newRow.role, permissions: newRow.permissions, is_admin: newRow.is_admin } }))
            setRoleTarget(null)
            reloadRows()
          }}/>
      )}
    </>
  )
}
