import { useState, useEffect } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import FocusTrap from '../lib/FocusTrap'
import { Button } from './ui'
import { Icon } from '../lib/icons'

const mono = MONO

const ROLE_INFO = {
  admin: {
    icon: 'star',
    tone: 'goldText',
    description: 'Full read/write access. Can invite users and manage all data. Cannot delete company or change billing.',
  },
  editor: {
    icon: 'file-text',
    tone: 'blue',
    description: 'Can add and edit properties, tenancies, rent, compliance, and maintenance. Cannot view financial data or invite users by default.',
  },
  viewer: {
    icon: 'eye',
    tone: 'purple',
    description: 'Read-only access to properties, rent, and compliance. Cannot edit anything. Tenant personal data is hidden by default. Turn on "Edit rent records" under Advanced to make a Rent Tracker Editor.',
  },
}

export default function RolePermissionsModal({ user, company, accessRow, onClose, onSaved, showToast }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [role, setRole] = useState(accessRow?.role || (accessRow?.is_admin ? 'admin' : 'editor'))
  const [overrides, setOverrides] = useState(accessRow?.permissions || {})
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Compute effective permissions based on role + overrides
  const basePerms = api.ROLE_DEFAULTS[role] || api.ROLE_DEFAULTS.editor
  const effective = { ...basePerms, ...overrides }

  function togglePermission(key) {
    setOverrides(prev => {
      const next = { ...prev }
      // If we're setting it to the same value as the role default, remove the override
      const newValue = !effective[key]
      if (newValue === basePerms[key]) {
        delete next[key]
      } else {
        next[key] = newValue
      }
      return next
    })
  }

  async function resetOverrides() {
    if (await confirmDialog({ title: 'Reset all custom permissions?', body: `All overrides will be removed and the role's default permissions for "${role}" will apply.`, confirmLabel: 'Reset' })) {
      setOverrides({})
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.updateUserRole(user.id, company.id, role, overrides)
      showToast?.('Role and permissions updated')
      onSaved?.({ ...accessRow, role, permissions: overrides, is_admin: role === 'admin' })
    } catch(e) {
      showToast?.('Failed to save: ' + (e.message || 'unknown error'), 'error')
    }
    setSaving(false)
  }

  const name = user?.profile?.full_name
    || [user?.profile?.first_name, user?.profile?.last_name].filter(Boolean).join(' ')
    || user?.email

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:900,padding:24}}>
      <FocusTrap onEscape={onClose}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:620,maxHeight:'92vh',overflowY:'auto',padding:'28px',border:`1px solid ${T.border}`}}
        role="dialog" aria-modal="true" aria-labelledby="role-permissions-title">

        {/* Header */}
        <div style={{marginBottom:18}}>
          <h3 id="role-permissions-title" style={{fontSize:18,fontWeight:700,color:T.text,margin:0,marginBottom:4}}>Manage role & permissions</h3>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>
            <strong>{name}</strong> on <strong style={{color:company?.color||T.goldText}}>{company?.name}</strong>
          </div>
        </div>

        {/* Role selector */}
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Role</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {['admin','editor','viewer'].map(r => {
              const info = { ...ROLE_INFO[r], color: T[ROLE_INFO[r].tone] }
              const selected = role === r
              return (
                <button key={r} onClick={()=>{setRole(r);setOverrides({})}}
                  style={{
                    textAlign:'left', padding:'14px 16px', borderRadius:10, cursor:'pointer',
                    border: `2px solid ${selected?info.color:T.border}`,
                    background: selected?info.color+'15':'transparent',
                    display:'flex', gap:12, alignItems:'flex-start'
                  }}>
                  <span style={{display:'flex',flexShrink:0,color:info.color}}><Icon name={info.icon} size={22}/></span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:selected?info.color:T.text,marginBottom:2,textTransform:'capitalize'}}>{r}</div>
                    <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,lineHeight:1.5}}>{info.description}</div>
                  </div>
                  <div style={{width:20,height:20,borderRadius:10,border:`2px solid ${selected?info.color:T.border}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2}}>
                    {selected && <div style={{width:10,height:10,borderRadius:5,background:info.color}}/>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Advanced toggle */}
        <div style={{borderTop:`1px solid ${T.border}`,paddingTop:16,marginBottom:14}}>
          <button onClick={()=>setShowAdvanced(s=>!s)}
            style={{background:'none',border:'none',cursor:'pointer',fontFamily:SANS,fontSize:FS.sm,color:T.goldText,fontWeight:700,padding:0,display:'flex',alignItems:'center',gap:6}}>
            {showAdvanced ? '▼' : '▶'} Advanced — override specific permissions
            {hasOverrides && <span style={{fontSize:FS.xs,background:T.gold+'33',color:T.goldText,padding:'2px 7px',borderRadius:4}}>{Object.keys(overrides).length} custom</span>}
          </button>
          <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginTop:6,marginLeft:14}}>
            Use this to grant or restrict specific abilities beyond the role defaults.
          </div>
        </div>

        {showAdvanced && (
          <div style={{marginBottom:18}}>
            {hasOverrides && (
              <div style={{textAlign:'right',marginBottom:8}}>
                <button onClick={resetOverrides}
                  style={{fontFamily:SANS,fontSize:FS.sm,padding:'4px 10px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.muted}44`,background:'transparent',color:T.muted}}>
                  Reset overrides
                </button>
              </div>
            )}
            {api.PERMISSION_GROUPS.map(group => (
              <div key={group.label} style={{marginBottom:14}}>
                <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{group.label}</div>
                <div style={{background:T.bg,borderRadius:8,overflow:'hidden'}}>
                  {group.keys.map((key, i) => {
                    const on = effective[key]
                    const isOverride = key in overrides
                    return (
                      <div key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:i>0?`1px solid ${T.border}`:'none',gap:10}}>
                        <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.text,flex:1}}>
                          {api.PERMISSION_LABELS[key] || key}
                          {isOverride && <span style={{fontSize:FS.xs,background:T.gold+'22',color:T.goldText,padding:'1px 6px',borderRadius:3,marginLeft:6,fontWeight:700}}>OVERRIDE</span>}
                        </div>
                        <button onClick={()=>togglePermission(key)}
                          style={{
                            width:40, height:22, borderRadius:11,
                            background: on ? T.green : T.muted+'44',
                            border: 'none', cursor:'pointer',
                            position:'relative', flexShrink:0, transition:'background 0.2s'
                          }}>
                          <div style={{
                            position:'absolute', top:2, left: on ? 20 : 2,
                            width:18, height:18, borderRadius:9, background:'white',
                            transition:'left 0.2s'
                          }}/>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{display:'flex',gap:10,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
          <Button variant="secondary" onClick={onClose} style={{flex:1}}>Cancel</Button>
          <Button onClick={save} disabled={saving} style={{flex:2}}>
            {saving?'Saving...':'Save changes'}
          </Button>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
