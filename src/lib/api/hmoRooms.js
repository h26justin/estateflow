// Room-level HMO management (feature flag: hmo_rooms).
//
// CRUD for hmo_rooms (one lettable room per row, each with its own tenancy,
// rent and occupancy) and hmo_licences (the per-property HMO licence register),
// plus a room-level rent rollup used by the property's Rooms tab.
//
// RLS scopes every query to properties the caller can access; writes are gated
// server-side by has_property_permission + company_is_live (see migration
// 2026-06-11_hmo_rooms.sql).

import { supabase } from '../supabase'
import { naturalCompare } from '../addressUtils'

const uid = async () => (await supabase.auth.getUser()).data.user.id

export const ROOM_STATUSES = [
  { v: 'occupied',    l: 'Occupied' },
  { v: 'vacant',      l: 'Vacant' },
  { v: 'notice',      l: 'On notice' },
  { v: 'maintenance', l: 'Maintenance' },
]

export const LICENCE_TYPES = [
  { v: 'mandatory',  l: 'Mandatory HMO' },
  { v: 'additional', l: 'Additional licensing' },
  { v: 'selective',  l: 'Selective licensing' },
  { v: 'other',      l: 'Other' },
]

export const LICENCE_STATUSES = [
  { v: 'active',  l: 'Active' },
  { v: 'pending', l: 'Pending / applied' },
  { v: 'expired', l: 'Expired' },
  { v: 'lapsed',  l: 'Lapsed' },
]

// ── Rooms ──────────────────────────────────────────────────────────────────

export async function fetchRooms(propertyId) {
  const { data, error } = await supabase
    .from('hmo_rooms')
    .select('*')
    .eq('property_id', propertyId)
    .order('room_name', { ascending: true })
  if (error) throw error
  // DB ordering is lexical ("Room 1, Room 10, Room 2") — natural-sort here.
  return (data || []).sort((a, b) => naturalCompare(a.room_name, b.room_name))
}

export async function createRoom(propertyId, room) {
  const userId = await uid()
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('company_id')
    .eq('id', propertyId)
    .single()
  if (propErr) throw propErr
  const { data, error } = await supabase
    .from('hmo_rooms')
    .insert({
      property_id: propertyId,
      company_id: prop?.company_id || null,
      user_id: userId,
      room_name: room.room_name,
      rent_pcm: room.rent_pcm === '' || room.rent_pcm == null ? null : Number(room.rent_pcm),
      tenant_name: room.tenant_name || null,
      tenancy_start: room.tenancy_start || null,
      tenancy_end: room.tenancy_end || null,
      status: room.status || 'vacant',
      notes: room.notes || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRoom(id, updates) {
  const patch = { ...updates, updated_at: new Date().toISOString() }
  if ('rent_pcm' in patch) {
    patch.rent_pcm = patch.rent_pcm === '' || patch.rent_pcm == null ? null : Number(patch.rent_pcm)
  }
  const { data, error } = await supabase
    .from('hmo_rooms')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRoom(id) {
  const { error } = await supabase.from('hmo_rooms').delete().eq('id', id)
  if (error) throw error
}

// ── Licences ─────────────────────────────────────────────────────────────────

export async function fetchLicences(propertyId) {
  const { data, error } = await supabase
    .from('hmo_licences')
    .select('*')
    .eq('property_id', propertyId)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createLicence(propertyId, licence) {
  const userId = await uid()
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('company_id')
    .eq('id', propertyId)
    .single()
  if (propErr) throw propErr
  const { data, error } = await supabase
    .from('hmo_licences')
    .insert({
      property_id: propertyId,
      company_id: prop?.company_id || null,
      user_id: userId,
      licence_type: licence.licence_type || 'mandatory',
      authority: licence.authority || null,
      licence_number: licence.licence_number || null,
      issued_date: licence.issued_date || null,
      expiry_date: licence.expiry_date || null,
      status: licence.status || 'active',
      notes: licence.notes || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLicence(id, updates) {
  const { data, error } = await supabase
    .from('hmo_licences')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteLicence(id) {
  const { error } = await supabase.from('hmo_licences').delete().eq('id', id)
  if (error) throw error
}

// ── Rent rollup ──────────────────────────────────────────────────────────────

/**
 * Mark a property as an HMO (or back to single-let). Caller must have write
 * permission; RLS enforces it. Returns the updated property row.
 */
export async function setPropertyHmo(propertyId, isHmo) {
  const { data, error } = await supabase
    .from('properties')
    .update({ is_hmo: !!isHmo })
    .eq('id', propertyId)
    .select('id, is_hmo')
    .single()
  if (error) throw error
  return data
}

/**
 * Room-level rent rollup for a property. Pure client-side aggregation over the
 * rooms list so the panel can render headline numbers + per-room arrears at a
 * glance without an extra round-trip.
 *
 *   totalRooms      — count of rooms
 *   occupiedRooms   — status === 'occupied'
 *   vacantRooms     — status === 'vacant'
 *   occupancyRate   — occupied / total (0..1)
 *   monthlyRent     — sum of rent_pcm across OCCUPIED rooms (collectable)
 *   potentialRent   — sum of rent_pcm across ALL rooms (full capacity)
 *   voidRent        — potential - monthly (lost income from voids)
 *   arrears         — rooms flagged as a risk: occupied with a tenancy_end in
 *                     the past (lapsed term) — surfaced for follow-up.
 */
export function rollupRooms(rooms = []) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let monthlyRent = 0
  let potentialRent = 0
  let occupiedRooms = 0
  let vacantRooms = 0
  const arrears = []

  for (const r of rooms) {
    const rent = Number(r.rent_pcm) || 0
    potentialRent += rent
    if (r.status === 'occupied') {
      occupiedRooms += 1
      monthlyRent += rent
      if (r.tenancy_end) {
        const end = new Date(r.tenancy_end)
        end.setHours(0, 0, 0, 0)
        if (end < today) {
          arrears.push({ id: r.id, room_name: r.room_name, tenant_name: r.tenant_name, tenancy_end: r.tenancy_end, rent_pcm: rent })
        }
      }
    } else if (r.status === 'vacant') {
      vacantRooms += 1
    }
  }

  const totalRooms = rooms.length
  return {
    totalRooms,
    occupiedRooms,
    vacantRooms,
    occupancyRate: totalRooms ? occupiedRooms / totalRooms : 0,
    monthlyRent,
    potentialRent,
    voidRent: potentialRent - monthlyRent,
    arrears,
  }
}

/**
 * Days until a licence expires (negative if already expired). null when no
 * expiry_date is set. Used to drive the licence card's expiry reminder.
 */
export function daysUntilExpiry(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate)
  exp.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}
