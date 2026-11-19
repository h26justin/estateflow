// ── FROZEN MONTH-END REPORT SNAPSHOTS (rent brief C7) ───────────────────────
// A snapshot records the agent rent report's figures as issued, so a month
// end can be looked back on exactly as it stood. Rows in report_snapshots are
// insert-and-select only: a correction is a new snapshot that supersedes the
// old one (a dated restatement with a note saying why), never an edit.
//
// snapshotFromAgentReport() keeps a compact copy of buildAgentReport()'s
// output: the headline totals, aged arrears, and per property the figures a
// restatement would move. No tenant names, notes or month tiles.
// diffSnapshots() is the restatement delta between two snapshots (or a
// snapshot and the live report).
//
// Pure: no React, no DB.

export const FORMULA_VERSION = 'rent-engine-2026-11-19'
export const SNAPSHOT_KIND = Object.freeze({ agentRent: 'agent_rent_report', monthEndRent: 'month_end_rent', deals: 'deals' })

const AGED_KEYS = ['0-30', '31-60', '61-90', '90+', 'historic', 'total']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const pence = n => Math.round((Number(n) || 0) * 100)
const delta = (a, b) => (pence(b) - pence(a)) / 100

function compactAged(a) {
  const out = {}
  for (const k of AGED_KEYS) out[k] = round2(a?.[k])
  return out
}

/** Headline totals kept in a snapshot and compared by diffSnapshots, in display order. */
export const HEADLINE_TOTALS = Object.freeze([
  { key: 'owed', label: 'Owed (missed months)', money: true },
  { key: 'arrears', label: 'Older arrears', money: true },
  { key: 'totalOwed', label: 'Total owed', money: true },
  { key: 'shortfallYear', label: 'Shortfall this year', money: true },
  { key: 'yearDue', label: 'Due this year so far', money: true },
  { key: 'yearCollected', label: 'Collected this year', money: true },
  { key: 'monthDue', label: 'Due this month', money: true },
  { key: 'monthCollected', label: 'Collected this month', money: true },
  { key: 'rentRoll', label: 'Rent roll (monthly)', money: true },
  { key: 'missedMonths', label: 'Missed months', money: false },
  { key: 'owingCount', label: 'Properties owing', money: false },
  { key: 'units', label: 'Properties', money: false },
])

/** 'YYYY-MM' for an ISO date. */
export const periodOf = iso => String(iso || '').slice(0, 7)

/**
 * Build the insert fields for a snapshot of an agent report.
 * @param {object} model  buildAgentReport() output
 * @param {object} [o]    { period, companyId }: period defaults to the as-of month
 * Returns { kind, agent_id, company_id, as_of, period, formula_version, summary, lines }.
 */
export function snapshotFromAgentReport(model, { period, companyId = null } = {}) {
  if (!model) throw new Error('No report to snapshot')
  const s = model.summary || {}
  const summary = {
    agentName: model.agent?.name || null,
    year: model.year,
    units: s.units || 0,
    letUnits: s.letUnits || 0,
    owed: round2(s.owed),
    arrears: round2(s.arrears),
    totalOwed: (pence(s.owed) + pence(s.arrears)) / 100,
    aged: compactAged(s.aged),
    owingCount: s.owingCount || 0,
    missedMonths: s.missedMonths || 0,
    shortfallYear: round2(s.shortfallYear),
    yearDue: round2(s.yearDue),
    yearCollected: round2(s.yearCollected),
    yearRate: s.yearRate ?? null,
    monthDue: round2(s.monthDue),
    monthCollected: round2(s.monthCollected),
    rentRoll: round2(s.rentRoll),
    assumedOwed: round2(s.assumedOwed),
    paidNoAmountValue: round2(s.paidNoAmountValue),
  }
  // Whitelisted: never the tenant, notes or explanation.
  const lines = (model.lines || []).map(c => ({
    id: c.id,
    name: c.name,
    companyId: c.companyId || null,
    company: c.company || '',
    owed: round2(c.owed),
    arrears: round2(c.arrears),
    aged: compactAged(c.aged),
    missedMonths: c.missedMonths || 0,
    yearDue: round2(c.yearDue),
    yearCollected: round2(c.yearCollected),
  }))
  return {
    kind: SNAPSHOT_KIND.agentRent,
    agent_id: model.agent?.id || null,
    company_id: companyId || null,
    as_of: model.asOf,
    period: period || periodOf(model.asOf),
    formula_version: FORMULA_VERSION,
    summary,
    lines,
  }
}

/**
 * The single company a report covers, or null when it spans several (or
 * none), so a snapshot is shared with that company's members when it can be.
 */
export function reportCompanyId(model) {
  const ids = [...new Set((model?.lines || []).map(c => c.companyId || null))]
  return ids.length === 1 ? ids[0] : null
}

/** Same scope: kind, agent, company and period. */
const sameScope = (a, b) => a.kind === b.kind && (a.agent_id || null) === (b.agent_id || null) &&
  (a.company_id || null) === (b.company_id || null) && a.period === b.period

/** Ids of snapshots that a later snapshot supersedes. */
export function supersededIds(snapshots = []) {
  return new Set((snapshots || []).map(s => s.supersedes).filter(Boolean))
}

/**
 * The snapshot a new one for `fields`' scope would restate: the newest one in
 * the same kind, agent, company and period that nothing supersedes yet.
 * Null when this would be the first for that period.
 */
export function currentSnapshotFor(snapshots = [], fields) {
  const gone = supersededIds(snapshots)
  return (snapshots || []).filter(s => sameScope(s, fields) && !gone.has(s.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0] || null
}

/**
 * Restatement delta from `oldSnap` to `newSnap` (rows or snapshotFromAgentReport output).
 * Returns {
 *   totals:     [{ key, label, money, old, new, delta }]   every headline total
 *   aged:       [{ bucket, old, new, delta }]
 *   properties: [{ id, name, company, change: 'added'|'removed'|'changed', owed: {old,new,delta}, arrears: {old,new,delta} }]
 *               only properties whose owed or arrears moved, or that came or went
 *   changed:    true when any figure moved
 *   formulaChanged: true when the two were worked out by different formula versions
 * }
 */
export function diffSnapshots(oldSnap, newSnap) {
  const os = oldSnap?.summary || {}, ns = newSnap?.summary || {}
  const totals = HEADLINE_TOTALS.map(({ key, label, money }) => {
    const o = Number(os[key]) || 0, n = Number(ns[key]) || 0
    return { key, label, money, old: o, new: n, delta: money ? delta(o, n) : n - o }
  })
  const aged = AGED_KEYS.map(bucket => {
    const o = round2(os.aged?.[bucket]), n = round2(ns.aged?.[bucket])
    return { bucket, old: o, new: n, delta: delta(o, n) }
  })
  const oldLines = new Map((oldSnap?.lines || []).map(l => [l.id, l]))
  const newLines = new Map((newSnap?.lines || []).map(l => [l.id, l]))
  const properties = []
  for (const id of new Set([...oldLines.keys(), ...newLines.keys()])) {
    const o = oldLines.get(id), n = newLines.get(id)
    const pair = k => ({ old: round2(o?.[k]), new: round2(n?.[k]), delta: delta(o?.[k], n?.[k]) })
    const owed = pair('owed'), arrears = pair('arrears')
    const change = !o ? 'added' : !n ? 'removed' : 'changed'
    if (change === 'changed' && owed.delta === 0 && arrears.delta === 0) continue
    properties.push({ id, name: (n || o).name, company: (n || o).company, change, owed, arrears })
  }
  properties.sort((a, b) => Math.abs(pence(b.owed.delta) + pence(b.arrears.delta)) - Math.abs(pence(a.owed.delta) + pence(a.arrears.delta)) ||
    String(a.name).localeCompare(String(b.name), 'en-GB', { numeric: true }))
  const changed = totals.some(t => t.delta !== 0) || aged.some(a => a.delta !== 0) || properties.length > 0
  const ov = oldSnap?.formula_version || null, nv = newSnap?.formula_version || null
  return { totals, aged, properties, changed, formulaChanged: !!(ov && nv && ov !== nv) }
}
