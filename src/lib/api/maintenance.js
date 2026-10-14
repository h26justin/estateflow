// Maintenance jobs.
import { supabase } from '../supabase'
import { uid } from './_shared'

// ── MAINTENANCE ───────────────────────────────────────────
export async function fetchMaintenance(propertyId) {
  const { data, error } = await supabase.from('maintenance_jobs').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createMaintenance(propertyId, job) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({ ...job, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateMaintenance(id, updates) {
  const { data, error } = await supabase.from('maintenance_jobs').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
// Soft-delete (see deleteCompliance for context).
export async function deleteMaintenance(id) {
  const { error } = await supabase
    .from('maintenance_jobs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function attachPhotosToJob(jobId, photos) {
  const { error } = await supabase.from('maintenance_jobs')
    .update({ photos: photos }).eq('id', jobId)
  if (error) throw error
}
