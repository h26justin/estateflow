import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { SkeletonRows } from '../../lib/Skeleton'
import { EmptyState } from '../ui'

// ── NOTES TIMELINE ───────────────────────────────────────────────────────────
export function NotesTimeline({propertyId, isAdmin, user, showToast, setProperties, category, compact}) {
  const { T } = useTheme()
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    if (!propertyId) return
    setLoading(true)
    let q = supabase.from('property_notes').select('*').eq('property_id', propertyId)
    if (category) q = q.eq('category', category)
    q.order('created_at', {ascending:false})
      .then(({data})=>{ setNotes(data||[]); setLoading(false) })
      .catch(()=>setLoading(false))
  },[propertyId, category])

  async function handleSave() {
    if (!newNote.trim() || !user) return
    setSaving(true)
    try {
      const data = await api.createNote(propertyId, newNote.trim(), category||'general', user.id, user.email)
      setNotes(prev=>[data,...prev])
      setNewNote('')
      if (showToast) showToast('Note saved')
    } catch(e) {
      if (showToast) showToast(e.message, 'error')
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    try {
      await api.deleteNote(id)
      setNotes(prev=>prev.filter(n=>n.id!==id))
    } catch(e) {}
  }

  function formatDate(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
      ' ' + new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div style={{background:T.card,borderRadius:12,padding:'16px 20px',border:`1px solid ${T.border}`}}>
      {!compact&&<div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>
        {category ? category.charAt(0).toUpperCase()+category.slice(1)+' Notes' : 'Notes Timeline'}
      </div>}
      {isAdmin&&<>
        <textarea value={newNote} onChange={e=>setNewNote(e.target.value)}
          placeholder="Add a note about this property..."
          style={{width:'100%',minHeight:72,resize:'vertical',marginBottom:8,fontSize:12}}/>
        <button className="btn btn-gold" style={{fontSize:11,marginBottom:16}} onClick={handleSave} disabled={saving}>
          {saving?'Saving...':'+ Save Note'}
        </button>
      </>}
      {loading
        ? <SkeletonRows rows={3} height={36}/>
        : notes.length===0
          ? <EmptyState compact icon="file-text" title="No notes yet"/>
          : <div style={{display:'grid',gap:10}}>
              {notes.map(n=>(
                <div key={n.id} style={{background:T.bg,borderRadius:8,padding:'10px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,flexWrap:'wrap',gap:6}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.goldText}}>{n.user_email}</span>
                      <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{formatDate(n.created_at)}</span>
                    </div>
                    {isAdmin&&<button onClick={()=>handleDelete(n.id)}
                      style={{fontFamily:MONO,fontSize:FS.xs,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>
                      Delete
                    </button>}
                  </div>
                  <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.note}</div>
                </div>
              ))}
            </div>
      }
    </div>
  )
}
