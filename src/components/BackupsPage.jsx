import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'

const mono = "'DM Mono',monospace"

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs===1?'':'s'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} day${days===1?'':'s'} ago`
  const wks = Math.floor(days / 7)
  return `${wks} week${wks===1?'':'s'} ago`
}

export default function BackupsPage({ user, showToast }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [deleting, setDeleting] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await api.fetchUserBackups(user?.id)
      setBackups(data)
    } catch(e) { console.error('Failed to load backups', e) }
    setLoading(false)
  }

  useEffect(() => { if (user?.id) load() }, [user?.id])

  async function createBackup() {
    setCreating(true)
    try {
      await api.createManualBackup(user?.id)
      await load()
      showToast?.('Backup created successfully')
    } catch(e) { showToast?.('Backup failed: ' + (e.message || 'unknown error'), 'error') }
    setCreating(false)
  }

  async function download(backup) {
    setDownloading(backup.id)
    try {
      await api.downloadBackupById(backup.id, user?.id)
      showToast?.('Backup downloaded')
    } catch(e) { showToast?.('Download failed: ' + (e.message || 'unknown error'), 'error') }
    setDownloading(null)
  }

  async function quickBackup() {
    setCreating(true)
    try {
      await api.downloadFullBackup(user?.id, user?.email)
      showToast?.('Backup downloaded')
    } catch(e) { showToast?.('Backup failed: ' + (e.message || 'unknown error'), 'error') }
    setCreating(false)
  }

  async function remove(backup) {
    if (!await confirmDialog({
      title: `Delete backup from ${formatDate(backup.created_at)}?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })) return
    setDeleting(backup.id)
    try {
      await api.deleteBackup(backup.id, user?.id)
      await load()
      showToast?.('Backup deleted')
    } catch(e) { showToast?.('Delete failed: ' + (e.message || 'unknown error'), 'error') }
    setDeleting(null)
  }

  const latestBackup = backups[0]

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:20,fontWeight:700,color:T.text,margin:0,marginBottom:4}}>Backup History</h2>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>
          Your data is automatically backed up every week. You can create a manual backup anytime, or download any previous backup to restore your data or share with support.
        </p>
      </div>

      {/* Status card */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:16}}>
          <div style={{flex:1,minWidth:220}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Latest backup</div>
            {latestBackup ? (
              <>
                <div style={{fontSize:18,fontWeight:700,color:T.green,marginBottom:4}}>{relativeTime(latestBackup.created_at)}</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>
                  {formatDate(latestBackup.created_at)} · {formatBytes(latestBackup.size_bytes)}
                </div>
              </>
            ) : (
              <>
                <div style={{fontSize:18,fontWeight:700,color:T.amber,marginBottom:4}}>No backups yet</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>Create your first backup to get started</div>
              </>
            )}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={quickBackup} disabled={creating}
              style={{fontFamily:mono,fontSize:12,padding:'10px 18px',borderRadius:8,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:creating?'wait':'pointer',fontWeight:600}}>
              ↓ Quick download
            </button>
            <button onClick={createBackup} disabled={creating}
              style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px 22px',borderRadius:8,border:'none',background:creating?T.border:T.gold,color:'#1A2530',cursor:creating?'wait':'pointer'}}>
              {creating ? 'Creating...' : 'Create backup now'}
            </button>
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div style={{background:T.gold+'11',border:`1px solid ${T.gold}33`,borderRadius:10,padding:'12px 16px',marginBottom:20,fontFamily:mono,fontSize:11,color:T.text,lineHeight:1.7}}>
        <strong style={{color:T.gold}}>How backups work:</strong> Automatic backups run every Monday and are kept for the 12 most recent. You can create manual backups anytime, and download any backup as JSON for safekeeping or restoration support.
      </div>

      {/* Backup list */}
      {loading ? (
        <div style={{textAlign:'center',padding:40,fontFamily:mono,fontSize:12,color:T.muted}}>Loading backups...</div>
      ) : backups.length === 0 ? (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'60px 20px',textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:12}}>📦</div>
          <div style={{fontFamily:mono,fontSize:13,color:T.muted,marginBottom:8}}>No backup history yet</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.faint,marginBottom:20}}>Click "Create backup now" to create your first backup</div>
        </div>
      ) : (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1.4fr 100px 90px 1fr 180px',gap:14,padding:'12px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
            {['Created','Type','Size','Contents','Actions'].map(h=>(
              <div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>
            ))}
          </div>
          {backups.map((b, i) => {
            const counts = b.counts || {}
            const summary = [
              counts.companies && `${counts.companies} cos`,
              counts.properties && `${counts.properties} props`,
              counts.tenancies && `${counts.tenancies} tnc`,
              counts.compliance && `${counts.compliance} cert`,
              counts.expenses && `${counts.expenses} exp`,
            ].filter(Boolean).join(' · ')
            const isLatest = i === 0
            return (
              <div key={b.id} style={{display:'grid',gridTemplateColumns:'1.4fr 100px 90px 1fr 180px',gap:14,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
                <div>
                  <div style={{fontSize:13,color:T.text,fontWeight:600,marginBottom:2}}>
                    {formatDate(b.created_at)}
                    {isLatest && <span style={{fontFamily:mono,fontSize:9,color:T.green,background:T.green+'22',padding:'2px 7px',borderRadius:4,marginLeft:8,fontWeight:700}}>LATEST</span>}
                  </div>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{relativeTime(b.created_at)}</div>
                </div>
                <div>
                  <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:4,
                    background: b.type==='automatic' ? T.blue+'22' : b.type==='manual' ? T.gold+'22' : T.muted+'22',
                    color:     b.type==='automatic' ? T.blue      : b.type==='manual' ? T.gold      : T.muted}}>
                    {b.type === 'automatic' ? 'Auto' : b.type === 'manual' ? 'Manual' : b.type}
                  </span>
                </div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{formatBytes(b.size_bytes)}</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {summary || '—'}
                </div>
                <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                  <button onClick={()=>download(b)} disabled={downloading===b.id}
                    style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'5px 12px',borderRadius:6,cursor:downloading===b.id?'wait':'pointer',border:`1px solid ${T.gold}44`,background:T.gold+'11',color:T.gold}}>
                    {downloading===b.id?'…':'↓ Download'}
                  </button>
                  <button onClick={()=>remove(b)} disabled={deleting===b.id}
                    style={{fontFamily:mono,fontSize:10,padding:'5px 10px',borderRadius:6,cursor:deleting===b.id?'wait':'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {backups.length >= 12 && (
        <div style={{fontFamily:mono,fontSize:11,color:T.faint,marginTop:12,textAlign:'center'}}>
          Keeping the 12 most recent backups · older backups are automatically removed
        </div>
      )}

      {/* Restore help */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px',marginTop:20}}>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Need to restore data?</div>
        <div style={{fontFamily:mono,fontSize:12,color:T.text,lineHeight:1.7,marginBottom:12}}>
          If you've lost data or need to roll back to a previous state, download the backup you want to restore from and email it to us with details of what you need restored.
        </div>
        <a href="mailto:hello@ownproperly.com?subject=Restore backup request"
          style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'9px 18px',borderRadius:8,border:`1px solid ${T.border}`,background:'transparent',color:T.gold,textDecoration:'none',display:'inline-block'}}>
          Contact support for restore
        </a>
      </div>
    </div>
  )
}
