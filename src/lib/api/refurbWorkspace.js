// Refurb workspace API: journey stages, dependencies, tasks, updates,
// history, saved templates and refurb files (cover photo).
//
// Same rules as api/refurbs.js: every write returns the affected row, a
// write that touches zero rows throws (so a missing RLS grant can never
// look like success), and deletes are soft (deleted_at). History rows in
// refurb_events are append-only.
//
// Reads that span the portfolio page through fetchAllPages: 46 projects x
// 12 stages is already past half of PostgREST's silent 1000-row cap.
import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'
import { validateUpload } from './_monolith'
import { templateRows } from '../refurbWorkspace'

let cachedName = null
async function me() {
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  if (!user) throw new Error('Not signed in')
  if (!cachedName || cachedName.id !== user.id) {
    let name = null
    try {
      const { data: prof } = await supabase.from('user_profiles').select('full_name, first_name, last_name').eq('user_id', user.id).maybeSingle()
      name = prof?.full_name || [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') || null
    } catch (_) { /* name is a nicety */ }
    cachedName = { id: user.id, name: name || user.email || 'Unknown user' }
  }
  return cachedName
}

export async function currentRefurbActor() { return me() }

function one(data, what) {
  if (!data) throw new Error(`${what} not found or no permission to change it`)
  return data
}

// ── Loads ─────────────────────────────────────────────────────────────────

/** Everything one project's workspace needs, in parallel. */
export async function fetchRefurbWorkspace(projectId) {
  const q = t => supabase.from(t).select('*').eq('project_id', projectId)
  const [stages, deps, tasks, updates, events, files] = await Promise.all([
    q('refurb_stages').is('deleted_at', null).order('sort_order'),
    q('refurb_stage_dependencies'),
    q('refurb_tasks').is('deleted_at', null).order('sort_order'),
    q('refurb_updates').is('deleted_at', null).order('update_date', { ascending: false }),
    q('refurb_events').order('created_at', { ascending: false }).limit(500),
    q('refurb_files').is('deleted_at', null).order('created_at', { ascending: false }),
  ])
  for (const r of [stages, deps, tasks, updates, events, files]) if (r.error) throw r.error
  return {
    stages: stages.data || [], deps: deps.data || [], tasks: tasks.data || [],
    updates: updates.data || [], events: events.data || [], files: files.data || [],
  }
}

/** Portfolio-wide stages, open tasks and cover files for the cards. */
export async function fetchRefurbPortfolio() {
  const [stages, tasks, covers] = await Promise.all([
    fetchAllPages(() => supabase.from('refurb_stages')
      .select('id, project_id, parent_id, name, sort_order, status, status_label, weight, progress_pct, planned_start, planned_end, forecast_start, forecast_end, actual_start, actual_end, contractor_name, responsible_name, archived_at, deleted_at, created_at')
      .is('deleted_at', null).order('id')),
    fetchAllPages(() => supabase.from('refurb_tasks')
      .select('id, project_id, stage_id, kind, title, status, due_date, priority, owner_name, deleted_at')
      .is('deleted_at', null).order('id')),
    fetchAllPages(() => supabase.from('refurb_files')
      .select('id, project_id, file_path, crop, kind').eq('kind', 'cover').is('deleted_at', null).order('id')),
  ])
  return { stages, tasks, covers }
}

/** Signed URLs for many files at once: Map(path -> url). */
export async function signRefurbPaths(paths, expiresIn = 3600) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const { data, error } = await supabase.storage.from('property-documents').createSignedUrls(chunk, expiresIn)
    if (error) throw error
    for (const row of (data || [])) if (row?.signedUrl) out.set(row.path, row.signedUrl)
  }
  return out
}

// ── History ───────────────────────────────────────────────────────────────

/**
 * Append history rows. Best effort by design: the change itself is already
 * saved, so a failed log is reported to the console rather than undoing it.
 */
export async function logRefurbEvents(projectId, events) {
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean)
  if (list.length === 0) return []
  const actor = await me()
  const rows = list.map(e => ({
    project_id: projectId, stage_id: e.stage_id || null, entity: e.entity || 'project', entity_id: e.entity_id || null,
    action: e.action, field: e.field || null,
    old_value: e.old_value == null ? null : String(e.old_value), new_value: e.new_value == null ? null : String(e.new_value),
    reason: e.reason || null, actor_name: actor.name, created_by: actor.id,
  }))
  const { data, error } = await supabase.from('refurb_events').insert(rows).select()
  if (error) { console.error('refurb history write failed', error); return [] }
  return data || []
}

// ── Stages ────────────────────────────────────────────────────────────────

export async function createRefurbStage(projectId, fields) {
  const { data, error } = await supabase.from('refurb_stages').insert({ ...fields, project_id: projectId }).select().single()
  if (error) throw error
  return data
}

export async function updateRefurbStage(id, fields) {
  const { data, error } = await supabase.from('refurb_stages').update(fields).eq('id', id).select().maybeSingle()
  if (error) throw error
  return one(data, 'Stage')
}

/** Apply several stage updates (reorder, cascaded dates). Returns the saved rows. */
export async function updateRefurbStages(updates) {
  const out = []
  for (const u of (updates || [])) out.push(await updateRefurbStage(u.id, u.fields))
  return out
}

/**
 * Seed a project's journey from a template. Refuses when the project already
 * has live stages, so a template can never duplicate a journey.
 */
export async function applyRefurbTemplate(projectId, template) {
  const { data: existing, error: e0 } = await supabase.from('refurb_stages').select('id').eq('project_id', projectId).is('deleted_at', null).limit(1)
  if (e0) throw e0
  if ((existing || []).length > 0) throw new Error('This refurb already has a journey. Edit its stages instead.')
  const rows = templateRows(template)
  const top = rows.filter(r => !r.parent_key)
  const { data: parents, error } = await supabase.from('refurb_stages')
    .insert(top.map(r => ({ project_id: projectId, stage_key: r.stage_key, name: r.name, sort_order: r.sort_order, weight: r.weight })))
    .select()
  if (error) throw error
  const byKey = new Map()
  top.forEach((r, i) => { const saved = (parents || []).find(p => p.sort_order === r.sort_order) || parents[i]; byKey.set(r.stage_key || r.name, saved) })
  const subs = rows.filter(r => r.parent_key).map(r => ({
    project_id: projectId, parent_id: byKey.get(r.parent_key)?.id, stage_key: r.stage_key, name: r.name, sort_order: r.sort_order, weight: r.weight,
  })).filter(r => r.parent_id)
  let children = []
  if (subs.length) {
    const { data, error: e2 } = await supabase.from('refurb_stages').insert(subs).select()
    if (e2) throw e2
    children = data || []
  }
  return [...(parents || []), ...children]
}

// ── Dependencies ──────────────────────────────────────────────────────────

export async function createRefurbDependency(projectId, stageId, dependsOnId, lagDays = 0) {
  const { data, error } = await supabase.from('refurb_stage_dependencies')
    .insert({ project_id: projectId, stage_id: stageId, depends_on_id: dependsOnId, lag_days: lagDays || 0 }).select().single()
  if (error) {
    if (error.code === '23505') throw new Error('That dependency already exists.')
    throw error
  }
  return data
}

export async function updateRefurbDependency(id, fields) {
  const { data, error } = await supabase.from('refurb_stage_dependencies').update(fields).eq('id', id).select().maybeSingle()
  if (error) throw error
  return one(data, 'Dependency')
}

// A dependency is a link, not a record with history of its own, so it is
// hard deleted (the removal is logged in refurb_events by the caller).
export async function deleteRefurbDependency(id) {
  const { data, error } = await supabase.from('refurb_stage_dependencies').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Dependency not found or no permission to remove it')
}

// ── Tasks / milestones / checklist ────────────────────────────────────────

export async function createRefurbTask(projectId, fields) {
  const { data, error } = await supabase.from('refurb_tasks').insert({ ...fields, project_id: projectId }).select().single()
  if (error) throw error
  return data
}

export async function updateRefurbTask(id, fields) {
  const { data, error } = await supabase.from('refurb_tasks').update(fields).eq('id', id).select().maybeSingle()
  if (error) throw error
  return one(data, 'Task')
}

export async function deleteRefurbTask(id) {
  const actor = await me()
  const { data, error } = await supabase.from('refurb_tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Task not found or no permission to delete it')
}

// ── Updates / notes ───────────────────────────────────────────────────────

export async function createRefurbUpdate(projectId, fields) {
  const actor = await me()
  const { data, error } = await supabase.from('refurb_updates')
    .insert({ ...fields, project_id: projectId, author_name: fields.author_name || actor.name }).select().single()
  if (error) throw error
  return data
}

export async function deleteRefurbUpdate(id) {
  const actor = await me()
  const { data, error } = await supabase.from('refurb_updates')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Update not found or no permission to delete it')
}

// ── Templates ─────────────────────────────────────────────────────────────

export async function fetchRefurbTemplates() {
  const { data, error } = await supabase.from('refurb_templates').select('*').is('deleted_at', null).order('name')
  if (error) throw error
  return data || []
}

export async function createRefurbTemplate({ company_id, name, project_type, stages }) {
  const { data, error } = await supabase.from('refurb_templates')
    .insert({ company_id: company_id || null, name: name.trim(), project_type, stages }).select().single()
  if (error) throw error
  return data
}

export async function deleteRefurbTemplate(id) {
  const { data, error } = await supabase.from('refurb_templates')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Template not found or no permission to delete it')
}

// ── Contractors (existing table, shared per company) ──────────────────────

export async function fetchContractors() {
  const { data, error } = await supabase.from('contractors').select('id, name, trade, company_id, phone, email').order('name')
  if (error) throw error
  return data || []
}

export async function createContractor({ name, company_id, trade }) {
  const actor = await me()
  const { data, error } = await supabase.from('contractors')
    .insert({ name: name.trim(), company_id: company_id || null, trade: trade || null, user_id: actor.id }).select('id, name, trade, company_id, phone, email').single()
  if (error) throw error
  return data
}

// ── Files ─────────────────────────────────────────────────────────────────

/**
 * Upload one file for a refurb into the private bucket and record it.
 * Path: <uid>/refurbs/<projectId>/<ts>_<rand>.<ext> (own-folder upload
 * policy). Teammates read it through refurb_files (see migration).
 */
export async function uploadRefurbFile(projectId, file, fields = {}) {
  validateUpload(file)
  const actor = await me()
  const rawExt = (String(file.name || '').split('.').pop() || '').toLowerCase()
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
  const path = `${actor.id}/refurbs/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error: upErr } = await supabase.storage.from('property-documents')
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw upErr
  const { data, error } = await supabase.from('refurb_files').insert({
    project_id: projectId, file_path: path, name: file.name || null, mime: file.type || null, size: file.size,
    uploaded_by: actor.name, ...fields,
  }).select().single()
  if (error) {
    try { await supabase.storage.from('property-documents').remove([path]) } catch (_) { /* orphan cleanup only */ }
    throw error
  }
  return data
}

export async function updateRefurbFile(id, fields) {
  const { data, error } = await supabase.from('refurb_files').update(fields).eq('id', id).select().maybeSingle()
  if (error) throw error
  return one(data, 'File')
}

// Soft delete; the object stays for the Trash retention window.
export async function deleteRefurbFile(id) {
  const actor = await me()
  const { data, error } = await supabase.from('refurb_files')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('File not found or no permission to delete it')
}
