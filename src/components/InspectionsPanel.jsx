import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// ── INSPECTIONS PANEL ────────────────────────────────────────────────
// Embedded on a property's Compliance tab. Lists scheduled +
// completed inspections, lets users schedule new ones, mark complete
// with photo evidence + condition rating.
//
// Photos are uploaded one at a time to property-documents storage;
// the URL + caption is pushed into the inspection row's photos
// jsonb array (see migration for shape).

const INSPECTION_TYPES = [
  { key: 'mid_term',   label: 'Mid-term inspection' },
  { key: 'check_in',   label: 'Check-in' },
  { key: 'check_out',  label: 'Check-out' },
  { key: 'annual',     label: 'Annual review' },
  { key: 'other',      label: 'Other' },
]
const CONDITIONS = [
  { key: 'good', label: 'Good' },
  { key: 'fair', label: 'Fair' },
  { key: 'poor', label: 'Poor' },
]

export default function InspectionsPanel({ propertyId, canEdit = true, user }) {
  const { T } = useTheme()
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState(false)
  const [editingId, setEditingId] = useState(null)

  const blank = { inspection_type: 'mid_term', scheduled_date: '', completed_date: '', inspector_name: '', notes: '', overall_condition: '', photos: [] }
  const [form, setForm] = useState(blank)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])
  async function load() {
    setLoading(true)
    try { setItems(await api.fetchInspections(propertyId)) }
    catch (e) { showAppToast(e.message || 'Failed to load inspections', 'error') }
    setLoading(false)
  }

  function startAdd() {
    setForm(blank); setEditingId(null); setAdding(true)
  }
  function startEdit(it) {
    setForm({
      inspection_type: it.inspection_type || 'mid_term',
      scheduled_date: it.scheduled_date || '',
      completed_date: it.completed_date || '',
      inspector_name: it.inspector_name || '',
      notes: it.notes || '',
      overall_condition: it.overall_condition || '',
      photos: it.photos || [],
    })
    setEditingId(it.id); setAdding(true)
  }
  function cancel() { setAdding(false); setEditingId(null); setForm(blank) }

  async function handlePhotoUpload(file) {
    if (!file) return
    setUploadingPhoto(true)
    try {
      const photo = await api.uploadInspectionPhoto(propertyId, file)
      setForm(f => ({ ...f, photos: [...(f.photos || []), photo] }))
    } catch (e) {
      showAppToast(e.message || 'Photo upload failed', 'error')
    }
    setUploadingPhoto(false)
  }
  function removePhoto(idx) {
    setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))
  }

  async function save() {
    try {
      if (editingId) {
        const updated = await api.updateInspection(editingId, form)
        setItems(prev => prev.map(x => x.id === editingId ? updated : x))
      } else {
        const created = await api.createInspection(propertyId, form)
        setItems(prev => [created, ...prev])
      }
      cancel()
      showAppToast(editingId ? 'Inspection updated' : 'Inspection scheduled')
    } catch (e) { showAppToast(e.message || 'Save failed', 'error') }
  }

  async function softDelete(it) {
    if (!confirm('Delete this inspection record?')) return
    try {
      await api.softDeleteInspection(it.id, user?.id)
      setItems(prev => prev.filter(x => x.id !== it.id))
    } catch (e) { showAppToast(e.message || 'Delete failed', 'error') }
  }

  const upcoming = items.filter(i => !i.completed_date)
  const completed = items.filter(i => i.completed_date)

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          🔍 Property Inspections
          <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, fontWeight: 400 }}>
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </span>
        </h3>
        {canEdit && !adding && (
          <button onClick={startAdd} className="btn btn-ghost" style={{ fontSize: 11 }}>
            + Schedule inspection
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: 12 }}>Loading…</div>
      ) : (
        <>
          {adding && (
            <div style={{ background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                {editingId ? 'Edit inspection' : 'New inspection'}
              </div>
              <div className="g2">
                <div>
                  <label>Type</label>
                  <select value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                    {INSPECTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Scheduled date</label>
                  <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}/>
                </div>
              </div>
              <div className="g2" style={{ marginTop: 10 }}>
                <div>
                  <label>Completed date <span style={{ color: T.muted, fontWeight: 400 }}>(leave blank if scheduled)</span></label>
                  <input type="date" value={form.completed_date} onChange={e => setForm(f => ({ ...f, completed_date: e.target.value }))}/>
                </div>
                <div>
                  <label>Inspector name</label>
                  <input value={form.inspector_name} onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))} placeholder="e.g. Jane Smith"/>
                </div>
              </div>
              {form.completed_date && (
                <div style={{ marginTop: 10 }}>
                  <label>Overall condition</label>
                  <select value={form.overall_condition} onChange={e => setForm(f => ({ ...f, overall_condition: e.target.value }))}>
                    <option value="">— not rated —</option>
                    {CONDITIONS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ resize: 'vertical' }} placeholder="Observations, repairs needed, tenant comments..."/>
              </div>

              {/* Photos */}
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Photo evidence ({form.photos?.length || 0})</span>
                  <button onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}
                    style={{ fontFamily: MONO, fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, cursor: 'pointer' }}>
                    {uploadingPhoto ? 'Uploading…' : '📷 Add photo'}
                  </button>
                </label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }}/>
                {form.photos?.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6, marginTop: 8 }}>
                    {form.photos.map((p, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={p.url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.border}` }}/>
                        <button onClick={() => removePhoto(i)} title="Remove"
                          style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button onClick={cancel} className="btn btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
                <button onClick={save} className="btn btn-gold" style={{ fontSize: 11 }}>
                  {editingId ? 'Save changes' : 'Schedule'}
                </button>
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Upcoming ({upcoming.length})
              </div>
              <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                {upcoming.map(it => <InspectionRow key={it.id} item={it} T={T} canEdit={canEdit} onEdit={startEdit} onDelete={softDelete}/>)}
              </div>
            </>
          )}

          {completed.length > 0 && (
            <>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Completed ({completed.length})
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {completed.map(it => <InspectionRow key={it.id} item={it} T={T} canEdit={canEdit} onEdit={startEdit} onDelete={softDelete}/>)}
              </div>
            </>
          )}

          {items.length === 0 && !adding && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: T.muted }}>
              No inspections recorded yet. {canEdit && 'Schedule one above.'}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function InspectionRow({ item, T, canEdit, onEdit, onDelete }) {
  const typeLabel = INSPECTION_TYPES.find(t => t.key === item.inspection_type)?.label || item.inspection_type
  const condLabel = CONDITIONS.find(c => c.key === item.overall_condition)?.label
  const condColor = item.overall_condition === 'good' ? T.green : item.overall_condition === 'fair' ? T.amber : T.red
  const isPast = item.scheduled_date && !item.completed_date && new Date(item.scheduled_date) < new Date()

  return (
    <div style={{ background: T.card, border: `1px solid ${isPast ? T.amber + '66' : T.border}`, borderLeft: `3px solid ${item.completed_date ? T.green : (isPast ? T.amber : T.blue)}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            {typeLabel}
            {isPast && <span style={{ marginLeft: 8, color: T.amber, fontSize: 10 }}>· OVERDUE</span>}
            {condLabel && <span style={{ marginLeft: 8, color: condColor, fontSize: 10, padding: '1px 6px', background: condColor + '22', borderRadius: 8 }}>{condLabel}</span>}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
            {item.completed_date
              ? `Completed ${new Date(item.completed_date).toLocaleDateString('en-GB')}`
              : item.scheduled_date
                ? `Scheduled ${new Date(item.scheduled_date).toLocaleDateString('en-GB')}`
                : 'Not scheduled'}
            {item.inspector_name && ` · ${item.inspector_name}`}
            {item.photos?.length > 0 && ` · 📷 ${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}`}
          </div>
          {item.notes && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.text, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {item.notes}
            </div>
          )}
          {item.photos?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              {item.photos.slice(0, 6).map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                  <img src={p.url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4, border: `1px solid ${T.border}`, cursor: 'pointer' }}/>
                </a>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => onEdit(item)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Edit</button>
            <button onClick={() => onDelete(item)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.red}44`, background: 'transparent', color: T.red, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>
    </div>
  )
}
