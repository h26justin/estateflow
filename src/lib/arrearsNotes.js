// Versioned arrears notes and the month-end review queue (rent brief C6).
//
// Pure functions, no React, no Supabase.
//
// A note is a chain of versions: each edit is a new row whose `supersedes`
// names the version it replaces. The current note for a property is the
// latest row that no other row supersedes. Nothing is ever overwritten, so
// earlier explanations stay visible.
//
// An explanation is never invented: where a property has no note (or a note
// with no reason), the report and the UI say "Awaiting review" instead of
// writing text from missing data.
//
// The month-end queue takes every figure about money from the rent engine
// (propertyArrears, evaluateProperty, missedOwed); receipts and overrides are
// read only for their dates and sources.

import { evaluateProperty, periodBreakdown, missedOwed, propertyArrears, monthBounds, isoToday, addDays, GO_LIVE, STATE } from './rentEngine'

export const AWAITING_REVIEW = 'Awaiting review'

export const NOTE_STATUSES = Object.freeze([
  { v: 'open', l: 'Open' },
  { v: 'needs_investigation', l: 'Needs investigation' },
  { v: 'awaiting_review', l: 'Awaiting review' },
  { v: 'resolved', l: 'Resolved' },
])
export const NOTE_STATUS_LABEL = Object.freeze(Object.fromEntries(NOTE_STATUSES.map(s => [s.v, s.l])))

// The explanation fields a version carries (everything but identity/audit).
export const NOTE_FIELDS = Object.freeze(['reason', 'response', 'payment_plan', 'next_action', 'follow_up_date', 'owner', 'status'])

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const newer = (a, b) => (a.created_at === b.created_at ? (String(a.id) > String(b.id) ? -1 : 1) : a.created_at > b.created_at ? -1 : 1)

// 'YYYY-MM' for an ISO date.
export function periodOf(iso = isoToday()) { return String(iso).slice(0, 7) }

// The period before 'YYYY-MM'.
export function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// "Nov 2026" for 'YYYY-MM'.
export function periodLabel(period) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return '—'
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// Map(property_id -> { current, history, versions }) from note rows in any
// order. `current` is the newest version nobody supersedes; `history` is
// every other version, the current one's own chain first (newest first),
// then any stray versions (a parallel edit) newest first. `versions` counts
// them all.
export function currentNotes(rows) {
  const byProp = new Map()
  for (const r of rows || []) {
    if (!r?.property_id) continue
    if (!byProp.has(r.property_id)) byProp.set(r.property_id, [])
    byProp.get(r.property_id).push(r)
  }
  const out = new Map()
  for (const [pid, list] of byProp) {
    const superseded = new Set(list.map(r => r.supersedes).filter(Boolean))
    const heads = list.filter(r => !superseded.has(r.id)).sort(newer)
    // A cycle (should never happen) leaves no head: fall back to the newest.
    const current = heads[0] || list.slice().sort(newer)[0]
    const byId = new Map(list.map(r => [r.id, r]))
    const chain = []
    const seen = new Set([current.id])
    for (let r = byId.get(current.supersedes); r && !seen.has(r.id); r = byId.get(r.supersedes)) { seen.add(r.id); chain.push(r) }
    const rest = list.filter(r => !seen.has(r.id)).sort(newer)
    out.set(pid, { current, history: [...chain, ...rest], versions: list.length })
  }
  return out
}

// The written explanation on a note, or null when there is none. Never
// builds text from the other fields.
export function explanationText(note) {
  const t = note?.reason == null ? '' : String(note.reason).trim()
  return t || null
}

// What a report or list shows for a property's explanation.
export function explanationLabel(note) {
  return explanationText(note) || AWAITING_REVIEW
}

// Is this note the explanation for `period` ('YYYY-MM')? It must be written
// for that period and actually say something.
export function noteIsCurrent(note, period) {
  return !!(note && period && note.period === period && explanationText(note))
}

// A new version of `note` for `period`, ready for addArrearsNote(): the
// explanation fields copied across, superseding `note`. `changes` overrides
// any field (status: 'needs_investigation', a new reason, ...).
export function nextVersion(note, { period, property_id, tenancy_id = null, changes = {} } = {}) {
  const base = {}
  if (note) for (const k of NOTE_FIELDS) base[k] = note[k] ?? null
  return {
    ...base,
    status: base.status || 'open',
    ...changes,
    property_id: property_id || note?.property_id,
    tenancy_id: tenancy_id ?? note?.tenancy_id ?? null,
    period: period || note?.period || periodOf(),
    supersedes: note?.id || null,
  }
}

// Rent periods with money still owed on `asOf` (overdue, due today or inside
// the payment window), oldest first: [{ e, b }] with the engine's evaluation
// and periodBreakdown().
export function outstandingPeriods(property, asOf = isoToday()) {
  return evaluateProperty(property, { today: asOf })
    .filter(e => e.periodStart >= GO_LIVE && e.periodStart <= asOf)
    .map(e => ({ e, b: periodBreakdown(e, asOf) }))
    .filter(({ b }) => b.owed > 0 && b.bucket !== 'notYetDue')
    .sort((x, y) => (x.e.periodStart < y.e.periodStart ? -1 : 1))
}

const inRange = (d, from, to) => !!d && d > from && d <= to

// The month-end review queue. One row per long-term-let property that needs
// a look this month, with flags:
//   outstanding        arrears now (overdue rent + historic balance), > 0
//   newlyOverdue       rent that fell overdue this month (not overdue at the
//                      end of last month, given the money recorded so far)
//   receivedThisMonth  money received since the end of last month (receipts)
//   corrected          receipts this month that are reversals, refunds,
//                      adjustments or flagged for review; overrides made
//                      this month
//   imported           receipts this month from a statement, bank, Xero or
//                      other import
//   vacancy            periods this month that are not chargeable in full
//                      (vacant, refurb, non-chargeable period, between
//                      tenancies)
//   needsBackfill      periods marked paid with no amount (missing source)
//   noTenancy          periods charged from the property's own fields
//                      because no tenancy is recorded (missing source)
//   noteCurrent        the explanation is written for this period
// Properties with nothing flagged are left out.
export function monthEndQueue({ properties, notesByProperty = new Map(), asOf = isoToday() } = {}) {
  const period = periodOf(asOf)
  const [y, m] = period.split('-').map(Number)
  const monthStart = monthBounds(y, m).start
  const prevEnd = addDays(monthStart, -1)
  const rows = []
  for (const p of properties || []) {
    if (!p || p.deleted_at || p.archived_at || p.status === 'short_term_let') continue
    const evals = evaluateProperty(p, { today: asOf })
    const prevEvals = new Map(evaluateProperty(p, { today: prevEnd }).map(e => [e.id, e]))
    const live = evals.filter(e => e.periodStart >= GO_LIVE && e.periodStart <= asOf)

    const outstanding = propertyArrears(p, asOf)
    let overdue = 0, newlyOverdue = 0
    for (const e of live) {
      const now = missedOwed(e, asOf)
      if (!(now > 0)) continue
      overdue = round2(overdue + now)
      const before = prevEvals.get(e.id)
      const then = before && before.periodStart <= prevEnd ? missedOwed(before, prevEnd) : 0
      if (now > then) newlyOverdue = round2(newlyOverdue + (now - then))
    }

    const receipts = (p.rent_receipts || []).filter(r => inRange(r.received_date, prevEnd, asOf))
    const receivedThisMonth = round2(receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0))
    const correctedReceipts = receipts.filter(r => (r.kind && r.kind !== 'receipt') || r.reverses_receipt_id || r.review_status === 'needs_review')
    const importedReceipts = receipts.filter(r => r.source && r.source !== 'manual')
    const overrides = (p.rent_overrides || []).filter(o => inRange(String(o.created_at || '').slice(0, 10), prevEnd, asOf))

    const thisMonth = live.filter(e => e.periodEnd >= monthStart && !e.superseded)
    const vacancy = thisMonth
      .filter(e => e.state === STATE.NOT_COLLECTIBLE || (e.collectibleDays > 0 && e.collectibleDays < e.totalDays))
      .map(e => ({ periodStart: e.periodStart, periodEnd: e.periodEnd, reason: e.reasons?.[0] || 'Not chargeable' }))
    const backfill = live.filter(e => e.needsBackfill && e.state !== STATE.LEGACY)
    const noTenancy = live.some(e => e.fallback)

    const flags = {
      outstanding: outstanding > 0,
      newlyOverdue: newlyOverdue > 0,
      received: receivedThisMonth !== 0,
      corrected: correctedReceipts.length + overrides.length > 0,
      imported: importedReceipts.length > 0,
      vacancy: vacancy.length > 0,
      needsBackfill: backfill.length > 0,
      noTenancy,
    }
    if (!Object.values(flags).some(Boolean)) continue
    const entry = notesByProperty.get?.(p.id) || null
    const note = entry?.current || null
    rows.push({
      id: p.id,
      property: p,
      name: String(p.name || p.address || 'Property').trim(),
      companyId: p.company_id || null,
      period,
      outstanding, overdue, newlyOverdue, receivedThisMonth,
      correctedCount: correctedReceipts.length + overrides.length,
      importedCount: importedReceipts.length,
      vacancy,
      backfillPeriods: backfill.length,
      flags,
      missingSource: flags.needsBackfill || flags.noTenancy,
      note,
      versions: entry?.versions || 0,
      noteCurrent: noteIsCurrent(note, period),
      explanation: explanationLabel(note),
    })
  }
  return rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, 'en-GB', { numeric: true }))
}

// Quick filters for the month-end panel.
export const QUEUE_FILTERS = Object.freeze([
  { v: 'all', l: 'All', test: () => true },
  { v: 'outstanding', l: 'Rent outstanding', test: r => r.flags.outstanding },
  { v: 'newlyOverdue', l: 'Newly overdue', test: r => r.flags.newlyOverdue },
  { v: 'received', l: 'Received this month', test: r => r.flags.received },
  { v: 'corrected', l: 'Corrected or imported', test: r => r.flags.corrected || r.flags.imported },
  { v: 'vacancy', l: 'Vacancy', test: r => r.flags.vacancy },
  { v: 'missingSource', l: 'Missing source', test: r => r.missingSource },
  { v: 'notCurrent', l: 'Explanation not current', test: r => r.flags.outstanding && !r.noteCurrent },
])
