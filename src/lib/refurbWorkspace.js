// ── REFURB WORKSPACE ENGINE ───────────────────────────────────────────────
// Pure functions behind the refurb project workspace: journey templates,
// stage status, works progress, current stage, programme dates, dependency
// knock-on, forecast final cost and the portfolio filters. No React, no DB.
//
// Two progress numbers exist and are never mixed:
//   WORKS PROGRESS  how much of the journey is done (this file)
//   PAID %          how much of the agreed money has gone out (refurbs.js)
//
// Works progress, worked out the same way everywhere:
//   • Only live top-level stages count. Skipped and archived stages are left
//     out entirely, so skipping a stage never makes the job look further on.
//   • Each counted stage carries a weight (default 1).
//   • A stage's own completion is:
//       complete                       100%
//       not started                      0%
//       in progress / blocked / on hold  its recorded progress %, else the
//                                        share of its checklist ticked, else
//                                        0% with "no progress recorded"
//     A stage with substages takes the weighted average of its substages
//     instead (same rules, one level down).
//   • Works progress = sum(weight x completion) / sum(weight).
// Missing information is reported as missing, never assumed.

export const STAGE_STATUSES = ['not_started', 'in_progress', 'blocked', 'on_hold', 'complete', 'skipped']

export const STAGE_STATUS_CFG = {
  not_started: { label: 'Not started', color: '#8A939E' },
  in_progress: { label: 'In progress', color: '#E0943A' },
  blocked:     { label: 'Blocked',     color: '#E05252' },
  on_hold:     { label: 'On hold',     color: '#9B59B6' },
  complete:    { label: 'Complete',    color: '#2ECC8A' },
  skipped:     { label: 'Skipped',     color: '#B5BCC4' },
}

export const PROJECT_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial',  label: 'Commercial' },
]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent']
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled']

// Built-in templates (brief part 4). Editable once applied: a project gets
// its own copy of the stages, so changing one project never changes another.
export const BUILT_IN_TEMPLATES = {
  residential: {
    name: 'Residential', project_type: 'residential',
    stages: [
      ['scope_survey', 'Scope & Survey'], ['design_plans', 'Design & Plans'], ['approvals', 'Approvals'],
      ['strip_out', 'Strip Out'], ['structural', 'Structural Works'], ['first_fix', 'First Fix'],
      ['plastering', 'Plastering'], ['second_fix', 'Second Fix'], ['kitchen_bath', 'Kitchen & Bathroom'],
      ['floor_decor', 'Flooring & Decoration'], ['snagging', 'Snagging'], ['handover', 'Handover'],
    ].map(([key, name]) => ({ key, name, substages: [] })),
  },
  commercial: {
    name: 'Commercial', project_type: 'commercial',
    stages: [
      ['survey_brief', 'Survey & Brief'], ['design', 'Design'], ['approvals', 'Approvals'],
      ['procurement', 'Procurement'], ['enabling', 'Enabling Works'], ['structural', 'Structural Works'],
      ['services', 'Services'], ['fit_out', 'Fit-Out'], ['testing', 'Testing & Commissioning'],
      ['snagging', 'Snagging'], ['handover', 'Handover'],
    ].map(([key, name]) => ({ key, name, substages: [] })),
  },
}

const DAY = 86400000

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** ISO yyyy-mm-dd or null. */
export function isoDate(d) {
  if (!d) return null
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null
  if (d instanceof Date && !isNaN(d.getTime())) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return null
}

function toDate(iso) {
  const s = isoDate(iso)
  return s ? new Date(s + 'T00:00:00') : null
}

export function addDays(iso, days) {
  const d = toDate(iso)
  if (!d) return null
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

/** Whole days from a to b (b - a). null when either is missing. */
export function daysBetween(a, b) {
  const da = toDate(a), db = toDate(b)
  if (!da || !db) return null
  return Math.round((db - da) / DAY)
}

// ── Stage list helpers ────────────────────────────────────────────────────

export function isLiveStage(s) {
  return !!s && !s.deleted_at && !s.archived_at
}

/** Counted toward progress: live and not skipped. */
export function isCountedStage(s) {
  return isLiveStage(s) && s.status !== 'skipped'
}

const bySort = (a, b) => (num(a.sort_order) - num(b.sort_order)) || String(a.created_at || '').localeCompare(String(b.created_at || ''))

/** Top-level live stages in order, each with its live substages as `children`. */
export function stageTree(stages) {
  const live = (stages || []).filter(isLiveStage)
  const kids = new Map()
  for (const s of live) {
    if (!s.parent_id) continue
    if (!kids.has(s.parent_id)) kids.set(s.parent_id, [])
    kids.get(s.parent_id).push(s)
  }
  return live.filter(s => !s.parent_id).sort(bySort)
    .map(s => ({ ...s, children: (kids.get(s.id) || []).sort(bySort) }))
}

/** Every live stage flattened in display order (parent, then its substages). */
export function flatStages(stages) {
  const out = []
  for (const s of stageTree(stages)) {
    const { children, ...rest } = s
    out.push(rest)
    for (const c of children) out.push(c)
  }
  return out
}

export function archivedStages(stages) {
  return (stages || []).filter(s => s && !s.deleted_at && s.archived_at).sort(bySort)
}

/** The label shown for a stage's status: its custom label, else the category's. */
export function statusLabel(stage) {
  return (stage?.status_label || '').trim() || STAGE_STATUS_CFG[stage?.status]?.label || 'Not started'
}

/**
 * Status options for a project: the six categories plus the project's custom
 * statuses ({ label, category }). Each option is { value, status, label }.
 * value is what a <select> holds: the category key, or "category|label".
 */
export function statusOptions(customStatuses) {
  const out = STAGE_STATUSES.map(s => ({ value: s, status: s, label: STAGE_STATUS_CFG[s].label }))
  for (const c of (Array.isArray(customStatuses) ? customStatuses : [])) {
    const label = String(c?.label || '').trim()
    if (!label || !STAGE_STATUSES.includes(c?.category)) continue
    out.push({ value: `${c.category}|${label}`, status: c.category, label })
  }
  return out
}

export function statusValue(stage) {
  return stage?.status_label ? `${stage.status}|${stage.status_label}` : (stage?.status || 'not_started')
}

export function parseStatusValue(value) {
  const [status, ...rest] = String(value || '').split('|')
  return { status: STAGE_STATUSES.includes(status) ? status : 'not_started', status_label: rest.join('|') || null }
}

// ── Progress ──────────────────────────────────────────────────────────────

function checklistRatio(stageId, tasks) {
  const items = (tasks || []).filter(t => t && !t.deleted_at && t.stage_id === stageId && t.kind === 'checklist' && t.status !== 'cancelled')
  if (items.length === 0) return null
  return items.filter(t => t.status === 'done').length / items.length
}

/**
 * Completion of one stage, 0..1, plus where the number came from:
 *   source: 'status' | 'recorded' | 'checklist' | 'substages' | 'missing'
 */
export function stageCompletion(stage, children = [], tasks = []) {
  const kids = (children || []).filter(isCountedStage)
  if (kids.length > 0) {
    let w = 0, done = 0, missing = 0
    for (const k of kids) {
      const kw = Math.max(0, num(k.weight ?? 1))
      const c = stageCompletion(k, [], tasks)
      if (c.source === 'missing') missing += 1
      w += kw
      done += kw * c.value
    }
    if (stage.status === 'complete') return { value: 1, source: 'status' }
    return { value: w > 0 ? done / w : 0, source: 'substages', missing }
  }
  if (stage.status === 'complete') return { value: 1, source: 'status' }
  if (stage.status === 'not_started' || stage.status === 'skipped') return { value: 0, source: 'status' }
  if (stage.progress_pct != null && stage.progress_pct !== '') return { value: Math.max(0, Math.min(100, num(stage.progress_pct))) / 100, source: 'recorded' }
  const r = checklistRatio(stage.id, tasks)
  if (r != null) return { value: r, source: 'checklist' }
  return { value: 0, source: 'missing' }
}

/**
 * Works progress for a project's journey.
 *   pct        0..100 rounded
 *   counted    number of stages in the sum
 *   complete   number of counted stages complete
 *   missing    stages under way with no recorded progress (shown as missing)
 *   hasJourney false when there are no counted stages at all
 */
export function worksProgress(stages, tasks = []) {
  const tree = stageTree(stages).filter(isCountedStage)
  if (tree.length === 0) return { pct: null, counted: 0, complete: 0, missing: 0, hasJourney: false }
  let w = 0, done = 0, missing = 0, complete = 0
  for (const s of tree) {
    const sw = Math.max(0, num(s.weight ?? 1))
    const c = stageCompletion(s, s.children, tasks)
    if (c.source === 'missing') missing += 1
    missing += c.missing || 0
    if (s.status === 'complete') complete += 1
    w += sw
    done += sw * c.value
  }
  return { pct: w > 0 ? Math.round((done / w) * 100) : 0, counted: tree.length, complete, missing, hasJourney: true }
}

/**
 * The stage the job is "at": the first top-level stage under way (in
 * progress, blocked or on hold); failing that, the first not started; null
 * when every counted stage is complete or there is no journey.
 */
export function currentStage(stages) {
  const tree = stageTree(stages).filter(isCountedStage)
  return tree.find(s => ['in_progress', 'blocked', 'on_hold'].includes(s.status))
    || tree.find(s => s.status === 'not_started')
    || null
}

// ── Dates ─────────────────────────────────────────────────────────────────

/** The dates the programme currently expects: forecast, else planned. */
export function expectedStart(s) { return isoDate(s?.forecast_start) || isoDate(s?.planned_start) }
export function expectedEnd(s) { return isoDate(s?.forecast_end) || isoDate(s?.planned_end) }

/** Best-known finish: actual if finished, else forecast, else planned. */
export function bestEnd(s) { return isoDate(s?.actual_end) || expectedEnd(s) }
export function bestStart(s) { return isoDate(s?.actual_start) || expectedStart(s) }

/**
 * Delay state for a stage:
 *   overdue  not complete and its expected finish is in the past
 *   slipped  forecast finish later than the planned finish (days > 0)
 */
export function stageDelay(stage, today = new Date()) {
  const t = isoDate(today)
  const end = expectedEnd(stage)
  const done = stage?.status === 'complete' || stage?.status === 'skipped'
  const overdue = !done && !!end && end < t
  const slip = daysBetween(stage?.planned_end, isoDate(stage?.actual_end) || isoDate(stage?.forecast_end))
  return { overdue, slippedDays: slip != null && slip > 0 ? slip : 0, overdueDays: overdue ? daysBetween(end, t) : 0 }
}

export function isTaskOpen(t) {
  return !!t && !t.deleted_at && t.status !== 'done' && t.status !== 'cancelled'
}

export function isTaskOverdue(t, today = new Date()) {
  return isTaskOpen(t) && !!t.due_date && isoDate(t.due_date) < isoDate(today)
}

/** The latest expected finish across live, counted stages (the programme's end). */
export function programmeEnd(stages) {
  let end = null
  for (const s of (stages || []).filter(isCountedStage)) {
    const e = bestEnd(s)
    if (e && (!end || e > end)) end = e
  }
  return end
}

export function programmeStart(stages) {
  let start = null
  for (const s of (stages || []).filter(isCountedStage)) {
    const e = bestStart(s)
    if (e && (!start || e < start)) start = e
  }
  return start
}

// ── Dependencies ──────────────────────────────────────────────────────────

/** True when adding stageId <- dependsOnId would create a loop. */
export function wouldCreateCycle(deps, stageId, dependsOnId) {
  if (stageId === dependsOnId) return true
  // Walk predecessors of dependsOnId; if we reach stageId it loops.
  const preds = new Map()
  for (const d of (deps || [])) {
    if (!preds.has(d.stage_id)) preds.set(d.stage_id, [])
    preds.get(d.stage_id).push(d.depends_on_id)
  }
  const seen = new Set()
  const stack = [dependsOnId]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === stageId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const p of (preds.get(cur) || [])) stack.push(p)
  }
  return false
}

/**
 * Knock-on of a date change through finish-to-start dependencies.
 *
 * `stages` are the stages with the proposed change already applied.
 * A dependent stage may not start before its predecessor's best-known
 * finish + lag + 1 day. Where it would, its forecast start moves to that
 * day and its forecast finish moves by the same amount (duration kept).
 * Stages already started (actual_start set), complete or skipped never
 * move. Only moves LATER are proposed; nothing is pulled earlier
 * automatically.
 *
 * Returns [{ stage_id, name, from_start, to_start, from_end, to_end, days, because }]
 * in the order they should be applied. Nothing is written: the project
 * manager confirms.
 */
export function cascadeDates(stages, deps) {
  const byId = new Map((stages || []).filter(isLiveStage).map(s => [s.id, { ...s }]))
  const succ = new Map()
  const indeg = new Map([...byId.keys()].map(k => [k, 0]))
  for (const d of (deps || [])) {
    if (!byId.has(d.stage_id) || !byId.has(d.depends_on_id)) continue
    if (!succ.has(d.depends_on_id)) succ.set(d.depends_on_id, [])
    succ.get(d.depends_on_id).push(d)
    indeg.set(d.stage_id, (indeg.get(d.stage_id) || 0) + 1)
  }
  // Kahn order so a chain A -> B -> C moves C after B has moved.
  const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([k]) => k)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const d of (succ.get(id) || [])) {
      indeg.set(d.stage_id, indeg.get(d.stage_id) - 1)
      if (indeg.get(d.stage_id) === 0) queue.push(d.stage_id)
    }
  }
  const moves = new Map()
  for (const id of order) {
    const pred = byId.get(id)
    for (const d of (succ.get(id) || [])) {
      const s = byId.get(d.stage_id)
      if (!s || s.actual_start || s.status === 'complete' || s.status === 'skipped') continue
      const predEnd = bestEnd(pred)
      if (!predEnd) continue
      const earliest = addDays(predEnd, num(d.lag_days) + 1)
      const start = expectedStart(s)
      if (start && start >= earliest) continue
      const end = expectedEnd(s)
      const dur = start && end ? Math.max(0, daysBetween(start, end)) : null
      const toStart = earliest
      const toEnd = dur != null ? addDays(toStart, dur) : (end && end < toStart ? toStart : end)
      const prev = moves.get(s.id)
      const move = {
        stage_id: s.id, name: s.name,
        from_start: prev ? prev.from_start : start, to_start: toStart,
        from_end: prev ? prev.from_end : end, to_end: toEnd,
        because: pred.name,
      }
      move.days = daysBetween(move.from_start || move.to_start, move.to_start) || 0
      moves.set(s.id, move)
      s.forecast_start = toStart
      s.forecast_end = toEnd
    }
  }
  return order.filter(id => moves.has(id)).map(id => moves.get(id))
}

// ── Money ─────────────────────────────────────────────────────────────────

/**
 * Forecast final cost (ruling 6, 1 Oct 2026):
 *   calculated = max(revised approved budget, invoiced + committed not yet invoiced)
 *   override   the PM's figure, used instead when set (reason kept in history)
 * revised approved budget = original agreed + approved variations. Pending
 * variations never move it.
 */
export function forecastFinalCost({ agreed = 0, invoiced = 0, committed = 0, override = null }) {
  const calculated = Math.max(num(agreed), num(invoiced) + num(committed))
  const hasOverride = override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override))
  const value = hasOverride ? Number(override) : calculated
  return { value, calculated, overridden: hasOverride, variance: value - num(agreed) }
}

// ── Templates ─────────────────────────────────────────────────────────────

/** Stage rows to insert for a template (top level, then substages by parent key). */
export function templateRows(template) {
  const out = []
  let i = 0
  for (const st of (template?.stages || [])) {
    i += 1
    const name = String(st?.name || '').trim()
    if (!name) continue
    out.push({ stage_key: st.key || null, name, sort_order: i, parent_key: null, weight: st.weight ?? 1 })
    let j = 0
    for (const sub of (st.substages || [])) {
      j += 1
      const sn = String(sub?.name || '').trim()
      if (!sn) continue
      out.push({ stage_key: sub.key || null, name: sn, sort_order: j, parent_key: st.key || name, weight: sub.weight ?? 1 })
    }
  }
  return out
}

/** A project's current journey as a template definition, for "Save as template". */
export function templateFromStages(stages) {
  return stageTree(stages).map(s => ({
    key: s.stage_key || null, name: s.name, weight: num(s.weight ?? 1) || 1,
    substages: s.children.map(c => ({ key: c.stage_key || null, name: c.name, weight: num(c.weight ?? 1) || 1 })),
  }))
}

// ── Portfolio filters ─────────────────────────────────────────────────────

/**
 * Filter workspace projects for the Refurbs page. Each project is a
 * refurb_projects row with `property` attached (projectsFromProperties).
 * filters: { type, q, companyId, status, contractor, manager, from, to, archived }
 * from / to match on the forecast completion (target_end_date), falling
 * back to the start date when there is no completion date.
 */
export function filterProjects(projects, f = {}) {
  const q = String(f.q || '').trim().toLowerCase()
  return (projects || []).filter(p => {
    if (!p || p.deleted_at) return false
    if (f.archived ? !p.archived_at : p.archived_at) return false
    if (f.type && (p.project_type || 'residential') !== f.type) return false
    if (f.companyId && f.companyId !== 'all' && p.property?.company_id !== f.companyId) return false
    if (f.status && f.status !== 'all') {
      if (f.status === 'active' ? p.stage === 'complete' : p.stage !== f.status) return false
    }
    if (f.contractor && f.contractor !== 'all' && String(p.contractor_name || '').trim().toLowerCase() !== f.contractor.toLowerCase()) return false
    if (f.manager && f.manager !== 'all' && String(p.project_manager_name || '').trim().toLowerCase() !== f.manager.toLowerCase()) return false
    const d = isoDate(p.target_end_date) || isoDate(p.start_date)
    if (f.from && (!d || d < f.from)) return false
    if (f.to && (!d || d > f.to)) return false
    if (q) {
      const hay = [p.title, p.property?.name, p.property?.address, p.property?.postcode, p.contractor_name, p.project_manager_name, p.property?.company?.name, p.property?.company?.abbr]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct non-empty values of a field, case-insensitively, sorted. */
export function distinctValues(projects, field) {
  const seen = new Map()
  for (const p of (projects || [])) {
    const v = String(p?.[field] || '').trim()
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * One project's journey summary for cards and the overview, from the
 * portfolio-wide stage / task load.
 */
export function journeySummary(project, stages = [], tasks = [], today = new Date()) {
  const mine = (stages || []).filter(s => s.project_id === project.id)
  const myTasks = (tasks || []).filter(t => t.project_id === project.id)
  const progress = worksProgress(mine, myTasks)
  const cur = currentStage(mine)
  const overdueTasks = myTasks.filter(t => isTaskOverdue(t, today))
  const openTasks = myTasks.filter(isTaskOpen)
  const blocked = stageTree(mine).flatMap(s => [s, ...s.children]).filter(s => s.status === 'blocked')
  const delayed = flatStages(mine).filter(s => { const d = stageDelay(s, today); return d.overdue || d.slippedDays > 0 })
  return { progress, current: cur, overdueTasks, openTasks, blocked, delayed, stageCount: stageTree(mine).length }
}
