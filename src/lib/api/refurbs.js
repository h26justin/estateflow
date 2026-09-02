// Refurbs API: refurb_projects, refurb_lines, refurb_milestones.
//
// Projects and their lines are embedded in fetchProperties() (see
// _monolith.js) so every page shares one source of truth; these helpers
// only write. Every write returns the affected row, and deletes are soft
// (deleted_at) so they can reach Trash later. A write that touches zero
// rows throws, so a missing RLS grant can never look like success.
import { supabase } from '../supabase'
import { DEFAULT_REFURB_MILESTONES } from '../refurbs'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const PROJECT_SELECT = '*, refurb_lines(*)'

export async function createRefurbProject(fields) {
  const { data, error } = await supabase
    .from('refurb_projects')
    .insert({ ...fields, user_id: await uid() })
    .select(PROJECT_SELECT).single()
  if (error) throw error
  // Seed the checklist. Best effort: the project is already saved.
  try { await initialiseRefurbMilestones(data.id) } catch (e) { console.error('refurb milestones seed failed', e) }
  return { ...data, refurb_lines: data.refurb_lines || [] }
}

export async function updateRefurbProject(id, fields) {
  const { data, error } = await supabase
    .from('refurb_projects').update(fields).eq('id', id)
    .select(PROJECT_SELECT).single()
  if (error) throw error
  if (!data) throw new Error('Refurb not found or no permission to edit it')
  return data
}

export async function deleteRefurbProject(id) {
  const { data, error } = await supabase
    .from('refurb_projects')
    .update({ deleted_at: new Date().toISOString(), deleted_by: await uid() })
    .eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Refurb not found or no permission to delete it')
}

export async function createRefurbLine(projectId, line) {
  const { data, error } = await supabase
    .from('refurb_lines')
    .insert({ ...line, project_id: projectId, created_by: await uid() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateRefurbLine(id, fields) {
  const { data, error } = await supabase
    .from('refurb_lines').update(fields).eq('id', id).select().single()
  if (error) throw error
  if (!data) throw new Error('Line not found or no permission to edit it')
  return data
}

export async function deleteRefurbLine(id) {
  const { data, error } = await supabase
    .from('refurb_lines')
    .update({ deleted_at: new Date().toISOString(), deleted_by: await uid() })
    .eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Line not found or no permission to delete it')
}

export async function fetchRefurbMilestones(projectId) {
  const { data, error } = await supabase
    .from('refurb_milestones').select('*').eq('project_id', projectId).order('sort_order')
  if (error) throw error
  return data || []
}

export async function initialiseRefurbMilestones(projectId) {
  const rows = DEFAULT_REFURB_MILESTONES.map(m => ({
    project_id: projectId, milestone_key: m.key, label: m.label, sort_order: m.sort,
    is_enabled: true, completed: false,
  }))
  const { error } = await supabase.from('refurb_milestones').upsert(rows, { onConflict: 'project_id,milestone_key', ignoreDuplicates: true })
  if (error) throw error
}

export async function updateRefurbMilestone(id, fields) {
  const { data, error } = await supabase
    .from('refurb_milestones').update(fields).eq('id', id).select().single()
  if (error) throw error
  if (!data) throw new Error('Milestone not found or no permission to edit it')
  return data
}
