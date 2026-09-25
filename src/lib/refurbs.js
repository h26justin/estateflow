// ── REFURBS ENGINE ────────────────────────────────────────────────────────
// Pure functions behind the Refurbs section, the property Refurb tab and the
// Deals cashflow "refurb to fund" line. No React, no DB.
//
// A refurb project has two numbers that matter:
//   AGREED  = agreed_price (the original quote) + every 'extra' line
//   PAID    = every 'payment' line minus every 'credit' line
// REMAINING = agreed - paid (floored at zero). That is the cashflow figure.
//
// Ruling 2 Sep 2026: an unspent agreed price is NOT money invested. The
// property's refurb_cost mirror therefore tracks PAID, and mirrorFields()
// below reproduces the DB trigger so the client can patch state locally
// without a refetch.

export const STAGES = ['planned', 'in_progress', 'snagging', 'on_hold', 'complete']

export const STAGE_CFG = {
  planned:     { label: 'Planned',     color: '#4B8FE0' },
  in_progress: { label: 'In progress', color: '#E0943A' },
  snagging:    { label: 'Snagging',    color: '#9B59B6' },
  on_hold:     { label: 'On hold',     color: '#8A939E' },
  complete:    { label: 'Complete',    color: '#2ECC8A' },
}

export const LINE_KINDS = {
  payment: { label: 'Payment', sign: +1 },
  extra:   { label: 'Extra',   sign: 0  },
  credit:  { label: 'Credit',  sign: -1 },
}

export const FUNDING_OPTIONS = [
  { value: 'cash',     label: 'Cash' },
  { value: 'bridge',   label: 'Bridging loan' },
  { value: 'mortgage', label: 'Mortgage / retention' },
]

// Default checklist seeded on every new project. Keys are stable so a
// Settings toggle list can be layered on later without touching data.
export const DEFAULT_REFURB_MILESTONES = [
  { key: 'keys_received', label: 'Keys received',                       sort: 1 },
  { key: 'strip_out',     label: 'Strip out',                           sort: 2 },
  { key: 'first_fix',     label: 'First fix (electrics and plumbing)',  sort: 3 },
  { key: 'second_fix',    label: 'Second fix',                          sort: 4 },
  { key: 'decoration',    label: 'Decoration and flooring',             sort: 5 },
  { key: 'certificates',  label: 'Gas and electrical certificates',     sort: 6 },
  { key: 'snagging',      label: 'Snagging signed off',                 sort: 7 },
  { key: 'ready_to_let',  label: 'Ready to let',                        sort: 8 },
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function isLiveProject(p) {
  return !!p && !p.deleted_at
}

export function isActiveProject(p) {
  return isLiveProject(p) && p.stage !== 'complete'
}

export function liveLines(project) {
  return (Array.isArray(project?.refurb_lines) ? project.refurb_lines : []).filter(l => l && !l.deleted_at)
}

/**
 * Money summary for one project.
 *   original  the agreed price as first quoted
 *   extras    sum of 'extra' lines (agreed variations)
 *   agreed    original + extras
 *   paid      payments less credits
 *   remaining agreed - paid, never below zero
 *   overpaid  paid - agreed when positive (paid more than was ever agreed)
 *   pct       paid as a percentage of agreed, capped at 100
 *   over      true when extras > 0 (the job cost more than first agreed)
 */
export function projectTotals(project) {
  const lines = liveLines(project)
  const original = num(project?.agreed_price)
  let extras = 0, payments = 0, credits = 0
  for (const l of lines) {
    const a = num(l.amount)
    if (l.kind === 'extra') extras += a
    else if (l.kind === 'payment') payments += a
    else if (l.kind === 'credit') credits += a
  }
  const agreed = original + extras
  const paid = payments - credits
  const remaining = Math.max(0, agreed - paid)
  const overpaid = Math.max(0, paid - agreed)
  const pct = agreed > 0 ? Math.min(100, Math.round((paid / agreed) * 100)) : 0
  return { original, extras, agreed, paid, payments, credits, remaining, overpaid, pct, over: extras > 0, lineCount: lines.length }
}

/** Whole days until target_end_date (negative = overdue). null when unset. */
export function daysLeft(project, today = new Date()) {
  if (!project?.target_end_date) return null
  const t = new Date(String(project.target_end_date).slice(0, 10) + 'T00:00:00')
  if (isNaN(t.getTime())) return null
  const d0 = new Date(today); d0.setHours(0, 0, 0, 0)
  return Math.round((t - d0) / 86400000)
}

export function isOverdue(project, today = new Date()) {
  if (!isActiveProject(project)) return false
  const d = daysLeft(project, today)
  return d != null && d < 0
}

/**
 * Suggest the next stage after a change, or null when nothing should move.
 * Only ever nudges forward; the UI asks before applying.
 */
export function suggestStage(project) {
  if (!isLiveProject(project)) return null
  const t = projectTotals(project)
  if (project.stage !== 'complete' && t.agreed > 0 && t.paid >= t.agreed) return 'complete'
  if (project.stage === 'planned' && t.paid > 0) return 'in_progress'
  return null
}

/**
 * Reproduce the DB mirror for one property's projects so the client can
 * patch the property row without a refetch. Returns null when the property
 * has no live projects (the DB leaves the legacy value alone in that case).
 */
export function mirrorFields(projects) {
  const live = (projects || []).filter(isLiveProject)
  if (live.length === 0) return null
  let paid = 0
  for (const p of live) paid += projectTotals(p).paid
  const anyInProgress = live.some(p => ['in_progress', 'snagging', 'on_hold'].includes(p.stage))
  const anyPlanned = live.some(p => p.stage === 'planned')
  const refurb_status = anyInProgress ? 'in-progress' : anyPlanned ? 'planned' : 'complete'
  return { refurb_cost: Math.max(0, paid), refurb_status, refurb_cost_unpaid: false }
}

/** Flatten properties (each with refurb_projects) into a project list with the property attached. */
export function projectsFromProperties(properties) {
  const out = []
  for (const p of (properties || [])) {
    if (!p || p.deleted_at) continue
    for (const rp of (p.refurb_projects || [])) {
      if (!isLiveProject(rp)) continue
      out.push({ ...rp, property: p })
    }
  }
  return out
}

/** Portfolio-level summary for the header stats and alerts. */
export function summariseProjects(projects, today = new Date()) {
  const live = (projects || []).filter(isLiveProject)
  const byStage = Object.fromEntries(STAGES.map(s => [s, []]))
  let agreed = 0, paid = 0, remaining = 0, active = 0, overBudget = 0, overdue = 0, noPrice = 0, complete = 0
  for (const p of live) {
    const t = projectTotals(p)
    ;(byStage[p.stage] || byStage.planned).push(p)
    if (p.stage === 'complete') { complete += 1; continue }
    active += 1
    agreed += t.agreed
    paid += t.paid
    remaining += t.remaining
    if (t.over || t.overpaid > 0) overBudget += 1
    if (isOverdue(p, today)) overdue += 1
    if (t.agreed <= 0) noPrice += 1
  }
  return { active, complete, agreed, paid, remaining, overBudget, overdue, noPrice, byStage, total: live.length }
}

/** All payment/credit lines across projects, newest first, each with its project attached. */
export function ledgerLines(projects) {
  const rows = []
  for (const p of (projects || [])) {
    if (!isLiveProject(p)) continue
    for (const l of liveLines(p)) rows.push({ ...l, project: p })
  }
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return rows
}

/** Distinct payees seen so far, most recent first, for the quick-add autocomplete. */
export function knownPayees(projects) {
  const seen = new Set()
  const out = []
  for (const l of ledgerLines(projects)) {
    const name = (l.payee || '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  for (const p of (projects || [])) {
    const name = (p?.contractor_name || '').trim()
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name) }
  }
  return out
}

/**
 * Cashflow contribution of one property's refurbs, used by dealCashflow:
 *   headline  total agreed across active projects
 *   unpaid    total remaining to pay
 *   trigger   earliest target_end_date among active projects (ISO string) or null
 */
export function propertyRefurbSummary(property) {
  const active = (property?.refurb_projects || []).filter(isActiveProject)
  let headline = 0, unpaid = 0, trigger = null
  for (const p of active) {
    const t = projectTotals(p)
    headline += t.agreed
    unpaid += t.remaining
    if (p.target_end_date && (!trigger || String(p.target_end_date) < trigger)) trigger = String(p.target_end_date).slice(0, 10)
  }
  return { headline, unpaid, trigger, count: active.length }
}
