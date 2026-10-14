// Lettings progressions.
import { supabase } from '../supabase'

// ── LETTINGS PROGRESSIONS ─────────────────────────────────────────────────────
export async function fetchLettingsProgressions(userId) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .select('*, property:properties(id,name,address,rent_pcm,company_id), company:companies(id,name,abbr,color)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createLettingsProgression(userId, fields = {}) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .insert({ user_id: userId, checklist: {}, ...fields })
    .select().single()
  if (error) throw error
  return data
}

export async function updateLettingsProgression(id, fields) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function archiveLettingsProgression(id) {
  const { error } = await supabase
    .from('lettings_progressions')
    .update({ archived_at: new Date().toISOString(), stage: 'let' })
    .eq('id', id)
  if (error) throw error
}

export async function deleteLettingsProgression(id) {
  const { error } = await supabase.from('lettings_progressions').delete().eq('id', id)
  if (error) throw error
}
