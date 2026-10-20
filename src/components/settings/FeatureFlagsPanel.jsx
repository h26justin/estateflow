import { useState, useEffect, useCallback } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { useConfirm } from '../../lib/ConfirmContext'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { Icon } from '../../lib/icons'
import { SkeletonRows } from '../../lib/Skeleton'
import { Button, EmptyState, Modal } from '../ui'

// ── FEATURE FLAGS PANEL (Developer only) ─────────────────────────────────────
export function FeatureFlagsPanel({ users, companies, T, showToast }) {
  const mono = MONO
  const confirmDialog = useConfirm()
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingFlag, setEditingFlag] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newFlag, setNewFlag] = useState({ key:'', name:'', description:'', enabled_globally:false })

  const beginLoad = useLoadGuard()

  const load = useCallback(async () => {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const data = await api.fetchFeatureFlags()
      if (!isCurrent()) return
      setFlags(data)
    } catch(e) {
      if (!isCurrent()) return
      showToast('Failed to load flags','error')
    }
    setLoading(false)
  }, [beginLoad, showToast])
  useEffect(()=>{ load() }, [load])

  async function toggleGlobal(flag) {
    try {
      await api.updateFeatureFlag(flag.key, { enabled_globally: !flag.enabled_globally })
      await load()
      showToast(`${flag.name} ${!flag.enabled_globally ? 'enabled' : 'disabled'} globally`)
    } catch(e) { showToast('Update failed','error') }
  }

  async function createFlag() {
    if (!newFlag.key || !newFlag.name) { showToast('Key and name required','error'); return }
    try {
      await api.createFeatureFlag(newFlag)
      setShowNew(false)
      setNewFlag({ key:'', name:'', description:'', enabled_globally:false })
      await load()
      showToast('Flag created')
    } catch(e) { showToast(e.message || 'Create failed','error') }
  }

  async function removeFlag(key) {
    if (!await confirmDialog({ title: `Delete flag "${key}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) return
    try {
      await api.deleteFeatureFlag(key)
      await load()
      showToast('Flag deleted')
    } catch(e) { showToast('Delete failed','error') }
  }

  if (loading) return <SkeletonRows rows={5} height={44}/>

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Feature Flags</div>
          <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted}}>Enable features globally, per user, or per company. Priority: user override → company override → global.</div>
        </div>
        <button className="btn btn-gold" style={{fontSize:FS.sm}} onClick={()=>setShowNew(true)}>+ New Flag</button>
      </div>

      {showNew && (
        <div style={{background:T.bg,border:`2px dashed ${T.gold}`,borderRadius:10,padding:16,marginBottom:16}}>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:10,textTransform:'uppercase',letterSpacing:'0.1em'}}>New feature flag</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:4}}>Key (snake_case, unique)</label>
              <input aria-label="Key (snake_case, unique)" value={newFlag.key} onChange={e=>setNewFlag({...newFlag,key:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_')})}
                placeholder="eg. advanced_reports" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:SANS,fontSize:FS.sm}}/>
            </div>
            <div>
              <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:4}}>Display name</label>
              <input aria-label="Display name" value={newFlag.name} onChange={e=>setNewFlag({...newFlag,name:e.target.value})}
                placeholder="eg. Advanced Reports" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:SANS,fontSize:FS.sm}}/>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,display:'block',marginBottom:4}}>Description</label>
            <input aria-label="Description" value={newFlag.description} onChange={e=>setNewFlag({...newFlag,description:e.target.value})}
              placeholder="What does this feature do?" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:SANS,fontSize:FS.sm}}/>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontFamily:SANS,fontSize:FS.sm,color:T.text,marginBottom:12,cursor:'pointer'}}>
            <input type="checkbox" checked={newFlag.enabled_globally} onChange={e=>setNewFlag({...newFlag,enabled_globally:e.target.checked})}/>
            Enable globally by default
          </label>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-gold" style={{fontSize:FS.sm}} onClick={createFlag}>Create</button>
            <button className="btn btn-ghost" style={{fontSize:FS.sm}} onClick={()=>setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{display:'grid',gap:10}}>
        {flags.length === 0 && <EmptyState compact icon="flag" title="No flags yet" body="Create your first flag above."/>}
        {flags.map(flag => (
          <div key={flag.key} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.text}}>{flag.name}</span>
                  <code style={{fontFamily:mono,fontSize:FS.xs,background:T.bg,padding:'2px 8px',borderRadius:4,color:T.muted}}>{flag.key}</code>
                  <span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:flag.enabled_globally?T.green+'22':T.muted+'22',color:flag.enabled_globally?T.green:T.muted,textTransform:'uppercase'}}>
                    {flag.enabled_globally ? 'Globally ON' : 'Globally OFF'}
                  </span>
                </div>
                {flag.description && <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginBottom:6}}>{flag.description}</div>}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>toggleGlobal(flag)}
                  style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${flag.enabled_globally?T.red:T.green}`,background:(flag.enabled_globally?T.red:T.green)+'22',color:flag.enabled_globally?T.red:T.green}}>
                  {flag.enabled_globally ? 'Disable globally' : 'Enable globally'}
                </button>
                <button onClick={()=>setEditingFlag(flag)}
                  style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:T.bg,color:T.text}}>
                  Overrides →
                </button>
                <button onClick={()=>removeFlag(flag.key)} aria-label={`Delete flag ${flag.name}`}
                  style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>
                  <Icon name="trash" size={14}/>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingFlag && <FlagOverridesModal flag={editingFlag} users={users} companies={companies} onClose={()=>setEditingFlag(null)} T={T} showToast={showToast}/>}
    </div>
  )
}

function FlagOverridesModal({ flag, users, companies, onClose, T, showToast }) {
  const mono = MONO
  const [userOverrides, setUserOverrides] = useState([])
  const [companyOverrides, setCompanyOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [pickMode, setPickMode] = useState(null) // 'user' | 'company' | null
  const [search, setSearch] = useState('')


  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, c] = await Promise.all([
        api.fetchFlagUserOverrides(flag.key),
        api.fetchFlagCompanyOverrides(flag.key),
      ])
      setUserOverrides(u)
      setCompanyOverrides(c)
    } catch(e) {}
    setLoading(false)
  }, [flag.key])
  useEffect(()=>{ load() }, [load])

  async function addUserOverride(userId, enabled) {
    try { await api.setFlagUserOverride(flag.key, userId, enabled); await load(); setPickMode(null); setSearch('') } catch(e) { showToast('Failed','error') }
  }
  async function removeUserOverride(userId) {
    try { await api.removeFlagUserOverride(flag.key, userId); await load() } catch(e) { showToast('Failed','error') }
  }
  async function addCompanyOverride(companyId, enabled) {
    try { await api.setFlagCompanyOverride(flag.key, companyId, enabled); await load(); setPickMode(null); setSearch('') } catch(e) { showToast('Failed','error') }
  }
  async function removeCompanyOverride(companyId) {
    try { await api.removeFlagCompanyOverride(flag.key, companyId); await load() } catch(e) { showToast('Failed','error') }
  }

  const userOverrideIds = new Set(userOverrides.map(o => o.user_id))
  const companyOverrideIds = new Set(companyOverrides.map(o => o.company_id))

  return (
    <Modal onClose={onClose} size="lg" zIndex={1000}
      title={<><Icon name="flag" size={16} color={T.goldText} style={{display:'inline-block',verticalAlign:'-2px',marginRight:6}}/>{flag.name}</>}
      description={<code style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>{flag.key}</code>}>
        <p style={{fontFamily:SANS,fontSize:FS.base,color:T.muted,marginBottom:16,lineHeight:1.6}}>
          Global: <strong style={{color:flag.enabled_globally?T.green:T.muted}}>{flag.enabled_globally ? 'ON' : 'OFF'}</strong>. Overrides below take priority.
        </p>

        {/* USER OVERRIDES */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Per-user overrides ({userOverrides.length})</div>
            <Button variant="secondary" size="sm" icon="plus" onClick={()=>setPickMode('user')}>Add user</Button>
          </div>
          {userOverrides.length === 0 && <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,padding:10}}>No user overrides.</div>}
          {userOverrides.map(o => {
            const u = users.find(u=>u.id===o.user_id)
            return (
              <div key={o.user_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:T.bg,borderRadius:6,marginBottom:6}}>
                <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{u?.email || o.user_id}</span>
                <div style={{display:'flex',gap:6}}>
                  <span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:o.enabled?T.green+'22':T.red+'22',color:o.enabled?T.green:T.red,textTransform:'uppercase'}}>
                    {o.enabled ? 'FORCED ON' : 'FORCED OFF'}
                  </span>
                  <Button variant="ghost" size="sm" icon="x" onClick={()=>removeUserOverride(o.user_id)} aria-label="Remove user override" />
                </div>
              </div>
            )
          })}
        </div>

        {/* COMPANY OVERRIDES */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Per-company overrides ({companyOverrides.length})</div>
            <Button variant="secondary" size="sm" icon="plus" onClick={()=>setPickMode('company')}>Add company</Button>
          </div>
          {companyOverrides.length === 0 && <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,padding:10}}>No company overrides.</div>}
          {companyOverrides.map(o => {
            const c = companies.find(c=>c.id===o.company_id)
            return (
              <div key={o.company_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:T.bg,borderRadius:6,marginBottom:6}}>
                <span style={{fontFamily:SANS,fontSize:FS.sm,color:T.text}}>{c?.name || o.company_id}</span>
                <div style={{display:'flex',gap:6}}>
                  <span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:o.enabled?T.green+'22':T.red+'22',color:o.enabled?T.green:T.red,textTransform:'uppercase'}}>
                    {o.enabled ? 'FORCED ON' : 'FORCED OFF'}
                  </span>
                  <Button variant="ghost" size="sm" icon="x" onClick={()=>removeCompanyOverride(o.company_id)} aria-label="Remove company override" />
                </div>
              </div>
            )
          })}
        </div>

        {/* PICK SUBJECT */}
        {pickMode && (
          <div style={{background:T.bg,border:`2px dashed ${T.gold}`,borderRadius:10,padding:14,marginTop:10}}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,marginBottom:8,textTransform:'uppercase',letterSpacing:'0.1em'}}>
              Select {pickMode === 'user' ? 'user' : 'company'} to add override
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
              style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:SANS,fontSize:FS.sm,marginBottom:10}}/>
            <div style={{maxHeight:260,overflow:'auto'}}>
              {pickMode === 'user' && users.filter(u => !userOverrideIds.has(u.id) && (!search || u.email?.toLowerCase().includes(search.toLowerCase()))).slice(0,30).map(u => (
                <div key={u.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',marginBottom:4,background:T.surface,borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{u.email}</span>
                  <div style={{display:'flex',gap:4}}>
                    <Button variant="secondary" size="sm" style={{color:T.green,borderColor:T.green}} onClick={()=>addUserOverride(u.id, true)}>Force ON</Button>
                    <Button variant="secondary" size="sm" destructive onClick={()=>addUserOverride(u.id, false)}>Force OFF</Button>
                  </div>
                </div>
              ))}
              {pickMode === 'company' && companies.filter(c => !companyOverrideIds.has(c.id) && (!search || c.name?.toLowerCase().includes(search.toLowerCase()))).slice(0,30).map(c => (
                <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',marginBottom:4,background:T.surface,borderRadius:6}}>
                  <span style={{fontFamily:SANS,fontSize:FS.sm,color:T.text}}>{c.name}</span>
                  <div style={{display:'flex',gap:4}}>
                    <Button variant="secondary" size="sm" style={{color:T.green,borderColor:T.green}} onClick={()=>addCompanyOverride(c.id, true)}>Force ON</Button>
                    <Button variant="secondary" size="sm" destructive onClick={()=>addCompanyOverride(c.id, false)}>Force OFF</Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" style={{marginTop:8}} onClick={()=>{setPickMode(null);setSearch('')}}>Cancel</Button>
          </div>
        )}
    </Modal>
  )
}
