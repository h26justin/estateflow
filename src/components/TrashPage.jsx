import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'

const mono = "'DM Mono',monospace"

const TYPE_CONFIG = {
  properties:         { icon: '🏠', label: 'Property',    color: '#C8A84B' },
  companies:          { icon: '🏢', label: 'Company',     color: '#2ECC8A' },
  tenancy_details:    { icon: '📋', label: 'Tenancy',     color: '#4B8FE0' },
  compliance_items:   { icon: '✅', label: 'Certificate', color: '#7B68EE' },
  maintenance_jobs:   { icon: '🔧', label: 'Repair',      color: '#E0943A' },
  property_expenses:  { icon: '💷', label: 'Expense',     color: '#D46F97' },
  deals:              { icon: '🎯', label: 'Deal',        color: '#3AAFB9' },
  property_documents: { icon: '📄', label: 'Document',    color: '#9B8AC2' },
}

function daysAgo(dateStr) {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function daysUntilPurge(dateStr) {
  if (!dateStr) return null
  const deletedAt = new Date(dateStr)
  const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  const days = Math.ceil((purgeAt - Date.now()) / (1000 * 60 * 60 * 24))
  return Math.max(0, days)
}

export default function TrashPage({ user, onRestored }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState({})
  const [filter, setFilter] = useState('all')
  const [working, setWorking] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await api.fetchAllDeleted(user?.id)
      setGroups(data)
    } catch(e) { console.error('Failed to load trash', e) }
    setLoading(false)
  }

  useEffect(() => { if (user?.id) load() }, [user?.id])

  async function restore(item) {
    if (!await confirmDialog({ title: `Restore "${item._name}"?`, confirmLabel: 'Restore' })) return
    setWorking(item.id)
    try {
      // Companies use a cascade-aware restore so cascade-deleted properties also come back
      if (item._type === 'companies') {
        await api.restoreCompanyAndCascade(item.id, user.id)
      } else {
        await api.restoreEntity(item._type, item.id)
      }
      await load()
      if (onRestored) onRestored()
    } catch(e) { alert('Restore failed: ' + (e.message || 'unknown error')) }
    setWorking(null)
  }

  async function purgeNow(item) {
    if (!await confirmDialog({
      title: `Permanently delete "${item._name}"?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete forever',
      destructive: true,
    })) return
    setWorking(item.id)
    try {
      if (item._type === 'property_documents') {
        await api.hardDeleteDocument(item)
      } else {
        await api.hardDeleteEntity(item._type, item.id)
      }
      await load()
    } catch(e) { alert('Delete failed: ' + (e.message || 'unknown error')) }
    setWorking(null)
  }

  const allItems = [
    ...(groups.properties || []),
    ...(groups.companies || []),
    ...(groups.tenancies || []),
    ...(groups.compliance || []),
    ...(groups.maintenance || []),
    ...(groups.expenses || []),
    ...(groups.deals || []),
    ...(groups.documents || []),
  ].sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at))

  const filtered = filter === 'all' ? allItems : allItems.filter(i => i._type === filter)
  const totalCount = allItems.length

  // Tabs with counts
  const tabs = [
    { key: 'all', label: 'Everything', count: totalCount },
    ...Object.keys(TYPE_CONFIG).map(k => ({
      key: k,
      label: TYPE_CONFIG[k].label,
      icon: TYPE_CONFIG[k].icon,
      count: (groups[k.replace('_details', '').replace('_items', '').replace('_jobs', '').replace('property_expenses', 'expenses').replace('properties', 'properties')] ||
              (k === 'tenancy_details' ? groups.tenancies : null) ||
              (k === 'compliance_items' ? groups.compliance : null) ||
              (k === 'maintenance_jobs' ? groups.maintenance : null) ||
              (k === 'property_expenses' ? groups.expenses : null) ||
              groups[k] || []).length
    })).filter(t => t.count > 0)
  ]

  if (loading) {
    return <div style={{textAlign:'center',padding:60,fontFamily:mono,fontSize:12,color:T.muted}}>Loading trash...</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:20,fontWeight:700,color:T.text,margin:0,marginBottom:4}}>🗑 Trash</h2>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>
          Deleted items are kept here for 30 days before being permanently removed. You can restore anything during that window.
        </p>
      </div>

      {totalCount === 0 ? (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'60px 20px',textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:12}}>🗑</div>
          <div style={{fontFamily:mono,fontSize:13,color:T.muted,marginBottom:4}}>Your trash is empty</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.faint}}>Deleted items will appear here</div>
        </div>
      ) : (
        <>
          {/* Filter tabs */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                style={{
                  fontFamily:mono, fontSize:11, padding:'6px 14px', borderRadius:20, cursor:'pointer',
                  border:`1px solid ${filter===tab.key?T.gold:T.border}`,
                  background:filter===tab.key?T.gold+'22':'transparent',
                  color:filter===tab.key?T.gold:T.muted,
                  fontWeight:filter===tab.key?700:400,
                }}>
                {tab.icon && <span style={{marginRight:4}}>{tab.icon}</span>}
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Items */}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:'100px 1fr 140px 140px 200px',gap:12,padding:'12px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              {['Type','Item','Deleted','Auto-purge in','Actions'].map(h=><div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>)}
            </div>
            {filtered.map(item => {
              const cfg = TYPE_CONFIG[item._type]
              const purgeDays = daysUntilPurge(item.deleted_at)
              const urgent = purgeDays <= 3
              return (
                <div key={`${item._type}-${item.id}`} style={{display:'grid',gridTemplateColumns:'100px 1fr 140px 140px 200px',gap:12,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:16}}>{cfg.icon}</span>
                    <span style={{fontFamily:mono,fontSize:10,color:cfg.color,fontWeight:700}}>{cfg.label}</span>
                  </div>
                  <div style={{fontSize:13,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item._name || 'Unnamed'}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{daysAgo(item.deleted_at)}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:urgent?T.red:T.muted,fontWeight:urgent?700:400}}>
                    {purgeDays} {purgeDays===1?'day':'days'}
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>restore(item)} disabled={working===item.id}
                      style={{fontFamily:mono,fontSize:10,padding:'5px 12px',borderRadius:6,cursor:working===item.id?'wait':'pointer',border:`1px solid ${T.green}44`,background:T.green+'11',color:T.green,fontWeight:700}}>
                      {working===item.id?'…':'↶ Restore'}
                    </button>
                    <button onClick={()=>purgeNow(item)} disabled={working===item.id}
                      style={{fontFamily:mono,fontSize:10,padding:'5px 12px',borderRadius:6,cursor:working===item.id?'wait':'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>
                      ✕ Purge now
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{fontFamily:mono,fontSize:11,color:T.faint,marginTop:12,textAlign:'center'}}>
            Showing {filtered.length} of {totalCount} deleted items
          </div>
        </>
      )}
    </div>
  )
}
