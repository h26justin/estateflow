import { useEffect, useState } from 'react'
import { SOON_DAYS } from '../lib/complianceStatus'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import { fmt } from '../lib/format'
import { naturalCompare } from '../lib/addressUtils'
import {
  fetchRooms, createRoom, updateRoom, deleteRoom,
  fetchLicences, createLicence, updateLicence, deleteLicence,
  rollupRooms, daysUntilExpiry,
  ROOM_STATUSES, LICENCE_TYPES, LICENCE_STATUSES,
} from '../lib/api/hmoRooms'

// ── HMO ROOMS PANEL ──────────────────────────────────────────────────
// Embedded on a property's Rooms tab (shown when property.is_hmo). Lets the
// landlord break the property into individually-let rooms — each with its own
// tenancy, rent and occupancy — surfaces a portfolio-style rent rollup and
// per-room "lapsed tenancy" arrears flags, and tracks the property's HMO
// licence(s) with an expiry reminder.

const roomLabel = (s) => ROOM_STATUSES.find(x => x.v === s)?.l || s
const licTypeLabel = (s) => LICENCE_TYPES.find(x => x.v === s)?.l || s
const licStatusLabel = (s) => LICENCE_STATUSES.find(x => x.v === s)?.l || s
const dateGB = (d) => d ? new Date(d).toLocaleDateString('en-GB') : ''

export default function HmoRoomsPanel({ propertyId, canEdit = true }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()

  const [rooms, setRooms]       = useState([])
  const [licences, setLicences] = useState([])
  const [loading, setLoading]   = useState(true)

  const blankRoom = { room_name: '', rent_pcm: '', tenant_name: '', tenancy_start: '', tenancy_end: '', status: 'vacant', notes: '' }
  const [roomForm, setRoomForm]   = useState(blankRoom)
  const [addingRoom, setAddingRoom] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState(null)
  const [savingRoom, setSavingRoom] = useState(false)

  const blankLic = { licence_type: 'mandatory', authority: '', licence_number: '', issued_date: '', expiry_date: '', status: 'active', notes: '' }
  const [licForm, setLicForm]   = useState(blankLic)
  const [addingLic, setAddingLic] = useState(false)
  const [editingLicId, setEditingLicId] = useState(null)
  const [savingLic, setSavingLic] = useState(false)

  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])
  async function load() {
    setLoading(true)
    try {
      const [r, l] = await Promise.all([fetchRooms(propertyId), fetchLicences(propertyId)])
      setRooms(r); setLicences(l)
    } catch (e) { showAppToast(e.message || 'Failed to load HMO rooms', 'error') }
    setLoading(false)
  }

  const roll = rollupRooms(rooms)
  const arrearsIds = new Set(roll.arrears.map(a => a.id))

  // ── Room handlers ──────────────────────────────────────────────────
  function startAddRoom() { setRoomForm(blankRoom); setEditingRoomId(null); setAddingRoom(true) }
  function startEditRoom(r) {
    setRoomForm({
      room_name: r.room_name || '', rent_pcm: r.rent_pcm ?? '', tenant_name: r.tenant_name || '',
      tenancy_start: r.tenancy_start || '', tenancy_end: r.tenancy_end || '',
      status: r.status || 'vacant', notes: r.notes || '',
    })
    setEditingRoomId(r.id); setAddingRoom(true)
  }
  function cancelRoom() { setAddingRoom(false); setEditingRoomId(null); setRoomForm(blankRoom) }

  async function saveRoom() {
    if (!roomForm.room_name.trim()) { showAppToast('Room name is required', 'error'); return }
    setSavingRoom(true)
    try {
      if (editingRoomId) {
        const updated = await updateRoom(editingRoomId, roomForm)
        setRooms(prev => prev.map(x => x.id === editingRoomId ? updated : x))
      } else {
        const created = await createRoom(propertyId, roomForm)
        setRooms(prev => [...prev, created].sort((a, b) => naturalCompare(a.room_name, b.room_name)))
      }
      cancelRoom()
      showAppToast(editingRoomId ? 'Room updated' : 'Room added')
    } catch (e) { showAppToast(e.message || 'Save failed', 'error') }
    setSavingRoom(false)
  }

  async function removeRoom(r) {
    if (!await confirmDialog({ title: `Remove ${r.room_name}?`, confirmLabel: 'Remove', destructive: true })) return
    try {
      await deleteRoom(r.id)
      setRooms(prev => prev.filter(x => x.id !== r.id))
    } catch (e) { showAppToast(e.message || 'Remove failed', 'error') }
  }

  // ── Licence handlers ───────────────────────────────────────────────
  function startAddLic() { setLicForm(blankLic); setEditingLicId(null); setAddingLic(true) }
  function startEditLic(l) {
    setLicForm({
      licence_type: l.licence_type || 'mandatory', authority: l.authority || '',
      licence_number: l.licence_number || '', issued_date: l.issued_date || '',
      expiry_date: l.expiry_date || '', status: l.status || 'active', notes: l.notes || '',
    })
    setEditingLicId(l.id); setAddingLic(true)
  }
  function cancelLic() { setAddingLic(false); setEditingLicId(null); setLicForm(blankLic) }

  async function saveLic() {
    setSavingLic(true)
    try {
      if (editingLicId) {
        const updated = await updateLicence(editingLicId, licForm)
        setLicences(prev => prev.map(x => x.id === editingLicId ? updated : x))
      } else {
        const created = await createLicence(propertyId, licForm)
        setLicences(prev => [...prev, created])
      }
      cancelLic()
      showAppToast(editingLicId ? 'Licence updated' : 'Licence added')
    } catch (e) { showAppToast(e.message || 'Save failed', 'error') }
    setSavingLic(false)
  }

  async function removeLic(l) {
    if (!await confirmDialog({ title: 'Remove this licence record?', confirmLabel: 'Remove', destructive: true })) return
    try {
      await deleteLicence(l.id)
      setLicences(prev => prev.filter(x => x.id !== l.id))
    } catch (e) { showAppToast(e.message || 'Remove failed', 'error') }
  }

  if (loading) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: 12 }}>Loading…</div>
  }

  return (
    <div style={{ marginTop: 18 }}>
      {/* ── Rollup ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        <Stat T={T} label="Rooms" value={roll.totalRooms} />
        <Stat T={T} label="Occupied" value={`${roll.occupiedRooms}/${roll.totalRooms}`} color={T.green} />
        <Stat T={T} label="Collectable PCM" value={fmt(roll.monthlyRent)} color={T.gold} />
        <Stat T={T} label="Void / month" value={fmt(roll.voidRent)} color={roll.voidRent > 0 ? T.amber : T.muted} />
      </div>

      {/* ── Arrears / lapsed-tenancy flags ── */}
      {roll.arrears.length > 0 && (
        <div style={{ background: T.red + '11', border: `1px solid ${T.red}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            ⚠ {roll.arrears.length} room{roll.arrears.length === 1 ? '' : 's'} need attention
          </div>
          {roll.arrears.map(a => (
            <div key={a.id} style={{ fontFamily: MONO, fontSize: 11, color: T.text }}>
              {a.room_name}{a.tenant_name ? ` · ${a.tenant_name}` : ''} — tenancy ended {dateGB(a.tenancy_end)}
            </div>
          ))}
        </div>
      )}

      {/* ── Rooms ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Rooms
          <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, fontWeight: 400 }}>
            {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
          </span>
        </h3>
        {canEdit && !addingRoom && (
          <button onClick={startAddRoom} className="btn btn-ghost" style={{ fontSize: 11 }}>+ Add room</button>
        )}
      </div>

      {addingRoom && (
        <div style={{ background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {editingRoomId ? 'Edit room' : 'New room'}
          </div>
          <div className="g2">
            <div>
              <label>Room name</label>
              <input value={roomForm.room_name} onChange={e => setRoomForm(f => ({ ...f, room_name: e.target.value }))} placeholder="e.g. Room 1 (en-suite)" />
            </div>
            <div>
              <label>Rent (PCM)</label>
              <input type="number" inputMode="decimal" value={roomForm.rent_pcm} onChange={e => setRoomForm(f => ({ ...f, rent_pcm: e.target.value }))} placeholder="550" />
            </div>
          </div>
          <div className="g2" style={{ marginTop: 10 }}>
            <div>
              <label>Occupancy</label>
              <select value={roomForm.status} onChange={e => setRoomForm(f => ({ ...f, status: e.target.value }))}>
                {ROOM_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
            <div>
              <label>Tenant name</label>
              <input value={roomForm.tenant_name} onChange={e => setRoomForm(f => ({ ...f, tenant_name: e.target.value }))} placeholder="(if occupied)" />
            </div>
          </div>
          <div className="g2" style={{ marginTop: 10 }}>
            <div>
              <label>Tenancy start</label>
              <input type="date" value={roomForm.tenancy_start} onChange={e => setRoomForm(f => ({ ...f, tenancy_start: e.target.value }))} />
            </div>
            <div>
              <label>Tenancy end</label>
              <input type="date" value={roomForm.tenancy_end} onChange={e => setRoomForm(f => ({ ...f, tenancy_end: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Notes</label>
            <textarea value={roomForm.notes} onChange={e => setRoomForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={cancelRoom} className="btn btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
            <button onClick={saveRoom} disabled={savingRoom} className="btn btn-gold" style={{ fontSize: 11 }}>
              {savingRoom ? 'Saving…' : editingRoomId ? 'Save changes' : 'Add room'}
            </button>
          </div>
        </div>
      )}

      {rooms.length === 0 && !addingRoom ? (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: T.muted }}>
          No rooms yet. {canEdit && 'Add one above to start letting by the room.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rooms.map(r => (
            <RoomRow key={r.id} room={r} T={T} canEdit={canEdit} flagged={arrearsIds.has(r.id)} onEdit={startEditRoom} onRemove={removeRoom} />
          ))}
        </div>
      )}

      {/* ── Licences ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '24px 0 12px', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          HMO Licence
          <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, fontWeight: 400 }}>
            {licences.length} {licences.length === 1 ? 'record' : 'records'}
          </span>
        </h3>
        {canEdit && !addingLic && (
          <button onClick={startAddLic} className="btn btn-ghost" style={{ fontSize: 11 }}>+ Add licence</button>
        )}
      </div>

      {addingLic && (
        <div style={{ background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {editingLicId ? 'Edit licence' : 'New licence'}
          </div>
          <div className="g2">
            <div>
              <label>Licence type</label>
              <select value={licForm.licence_type} onChange={e => setLicForm(f => ({ ...f, licence_type: e.target.value }))}>
                {LICENCE_TYPES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
            <div>
              <label>Status</label>
              <select value={licForm.status} onChange={e => setLicForm(f => ({ ...f, status: e.target.value }))}>
                {LICENCE_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
          </div>
          <div className="g2" style={{ marginTop: 10 }}>
            <div>
              <label>Issuing authority</label>
              <input value={licForm.authority} onChange={e => setLicForm(f => ({ ...f, authority: e.target.value }))} placeholder="e.g. Local Council" />
            </div>
            <div>
              <label>Licence number</label>
              <input value={licForm.licence_number} onChange={e => setLicForm(f => ({ ...f, licence_number: e.target.value }))} />
            </div>
          </div>
          <div className="g2" style={{ marginTop: 10 }}>
            <div>
              <label>Issued date</label>
              <input type="date" value={licForm.issued_date} onChange={e => setLicForm(f => ({ ...f, issued_date: e.target.value }))} />
            </div>
            <div>
              <label>Expiry date</label>
              <input type="date" value={licForm.expiry_date} onChange={e => setLicForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Notes</label>
            <textarea value={licForm.notes} onChange={e => setLicForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={cancelLic} className="btn btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
            <button onClick={saveLic} disabled={savingLic} className="btn btn-gold" style={{ fontSize: 11 }}>
              {savingLic ? 'Saving…' : editingLicId ? 'Save changes' : 'Add licence'}
            </button>
          </div>
        </div>
      )}

      {licences.length === 0 && !addingLic ? (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: T.muted }}>
          No HMO licence on record. {canEdit && 'Add one to track its expiry.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {licences.map(l => (
            <LicenceCard key={l.id} licence={l} T={T} canEdit={canEdit} onEdit={startEditLic} onRemove={removeLic} />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ T, label, value, color }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: color || T.text }}>{value}</div>
    </div>
  )
}

function RoomRow({ room, T, canEdit, flagged, onEdit, onRemove }) {
  const statusColor = room.status === 'occupied' ? T.green
    : room.status === 'vacant' ? T.amber
    : room.status === 'notice' ? T.blue : T.muted
  return (
    <div style={{ background: T.card, border: `1px solid ${flagged ? T.red + '66' : T.border}`, borderLeft: `3px solid ${statusColor}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            {room.room_name}
            <span style={{ marginLeft: 8, color: statusColor, fontSize: 10, padding: '1px 6px', background: statusColor + '22', borderRadius: 8 }}>{roomLabel(room.status)}</span>
            {flagged && <span style={{ marginLeft: 8, color: T.red, fontSize: 10 }}>· LAPSED</span>}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
            {room.rent_pcm != null ? `${fmt(room.rent_pcm)}/mo` : 'No rent set'}
            {room.tenant_name && ` · ${room.tenant_name}`}
            {room.tenancy_start && ` · from ${dateGB(room.tenancy_start)}`}
            {room.tenancy_end && ` to ${dateGB(room.tenancy_end)}`}
          </div>
          {room.notes && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.text, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{room.notes}</div>
          )}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => onEdit(room)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Edit</button>
            <button onClick={() => onRemove(room)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.red}44`, background: 'transparent', color: T.red, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>
    </div>
  )
}

function LicenceCard({ licence, T, canEdit, onEdit, onRemove }) {
  const days = daysUntilExpiry(licence.expiry_date)
  let reminder = null
  let accent = T.green
  if (days != null) {
    if (days < 0) { reminder = `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`; accent = T.red }
    else if (days <= SOON_DAYS) { reminder = `Expires in ${days} day${days === 1 ? '' : 's'}`; accent = T.amber }
    else { reminder = `Expires ${dateGB(licence.expiry_date)}`; accent = T.green }
  }
  if (licence.status === 'expired' || licence.status === 'lapsed') accent = T.red
  else if (licence.status === 'pending') accent = T.amber

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            {licTypeLabel(licence.licence_type)}
            <span style={{ marginLeft: 8, color: accent, fontSize: 10, padding: '1px 6px', background: accent + '22', borderRadius: 8 }}>{licStatusLabel(licence.status)}</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
            {licence.authority || 'No authority'}
            {licence.licence_number && ` · #${licence.licence_number}`}
            {licence.issued_date && ` · issued ${dateGB(licence.issued_date)}`}
          </div>
          {reminder && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: accent, marginTop: 6, fontWeight: 700 }}>{reminder}</div>
          )}
          {licence.notes && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.text, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{licence.notes}</div>
          )}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => onEdit(licence)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Edit</button>
            <button onClick={() => onRemove(licence)} style={{ fontFamily: MONO, fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.red}44`, background: 'transparent', color: T.red, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>
    </div>
  )
}
