// Property inspections and inspection photos.
import { supabase } from '../supabase'
import { uid } from './_shared'

// ── PROPERTY INSPECTIONS ──────────────────────────────────────────────────
// Mid-tenancy / check-in / check-out inspections with photo evidence.
// See migration 2026-05-24_property_inspections.sql for the table shape.

export async function fetchInspections(propertyId) {
  const { data, error } = await supabase
    .from('property_inspections')
    .select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('scheduled_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createInspection(propertyId, inspection) {
  const { data, error } = await supabase
    .from('property_inspections')
    .insert({ ...inspection, property_id: propertyId, user_id: await uid() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateInspection(id, updates) {
  const { data, error } = await supabase
    .from('property_inspections')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function softDeleteInspection(id, deletedBy) {
  const { error } = await supabase
    .from('property_inspections')
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq('id', id)
  if (error) throw error
}

// Upload an inspection photo. Returns a URL the inspection row can
// reference in its photos jsonb array.
export async function uploadInspectionPhoto(propertyId, file, caption = '') {
  const userId = await uid()
  const safeName = (file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
  const path = `${userId}/inspections/${propertyId}/${Date.now()}_${safeName}`
  const { error: upErr } = await supabase.storage.from('property-documents')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (upErr) throw upErr
  // Short-lived signed URL for the immediate upload preview only; rendering
  // goes through SignedPhoto(path), which signs fresh URLs on demand.
  const { data: urlData } = await supabase.storage.from('property-documents')
    .createSignedUrl(path, 60 * 60)
  return {
    url: urlData?.signedUrl || null,
    path,
    caption,
    taken_at: new Date().toISOString(),
  }
}
