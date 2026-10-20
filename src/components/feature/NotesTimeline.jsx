import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { SkeletonRows } from '../../lib/Skeleton'
import { Button, EmptyState } from '../ui'

// ── NOTES TIMELINE ───────────────────────────────────────────────────────────
// `composerOnly` renders just the add-note box (no list, no card chrome) for
// hosts that show the notes themselves — the Overview tab lists every note
// already, so a second list (and a second "No notes yet") under it was noise.
// `onSaved(note)` lets that host add the new note to its own list.
export function NotesTimeline({propertyId, isAdmin, user, showToast, category, compact, composerOnly = false, onSaved}) {
  const { T } = useTheme()
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    if (!propertyId || composerOnly) return
    setLoading(true)
    let q = supabase.from('property_notes').select('*').eq('property_id', propertyId)
    if (category) q = q.eq('category', category)
    q.order('created_at', {ascending:false})
      .then(({data})=>{ setNotes(data||[]); setLoading(false) })
      .catch(()=>setLoading(false))
  },[propertyId, category, composerOnly])

  async function handleSave() {
    if (!newNote.trim() || !user) return
    setSaving(true)
    try {
      const data = await api.createNote(propertyId, newNote.trim(), category||'general', user.id, user.email)
      setNotes(prev=>[data,...prev])
      if (onSaved) onSaved(data)
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

  const composer = isAdmin&&<>
    <textarea value={newNote} onChange={e=>setNewNote(e.target.value)}
      aria-label="New note"
      placeholder="Add a note about this property..."
      style={{width:'100%',minHeight:72,resize:'vertical',marginBottom:8,fontSize:12}}/>
    <Button variant="primary" size="sm" onClick={handleSave} disabled={saving||!newNote.trim()} style={{marginBottom:composerOnly?0:16}}>
      {saving?'Saving...':'+ Save note'}
    </Button>
  </>
  if (composerOnly) return composer || null

  return (
    <div style={{background:T.card,borderRadius:12,padding:'16px 20px',border:`1px solid ${T.border}`}}>
      {!compact&&<div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>
        {category ? category.charAt(0).toUpperCase()+category.slice(1)+' Notes' : 'Notes Timeline'}
      </div>}
      {composer}
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
                    {isAdmin&&<Button variant="secondary" destructive size="sm" onClick={()=>handleDelete(n.id)}>
                      Delete
                    </Button>}
                  </div>
                  <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.note}</div>
                </div>
              ))}
            </div>
      }
    </div>
  )
}
