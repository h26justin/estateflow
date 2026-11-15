// Arrears payment plans and receipt duplicate detection — pure functions.
import { addDays, daysInMonth, isoToday } from './rentEngine'

export const PLAN_STATUS_LABEL = {
  on_track: 'On track', due_soon: 'Due soon', broken: 'Broken', completed: 'Completed', paused: 'Paused',
}
export const PLAN_FREQUENCIES = [
  { v: 'weekly', l: 'Weekly' }, { v: 'fortnightly', l: 'Fortnightly' }, { v: 'four_weekly', l: 'Every 4 weeks' }, { v: 'monthly', l: 'Monthly' },
]

function addMonthsClamp(iso, n, day) {
  const [y, m] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  const d = Math.min(day || Number(iso.slice(8, 10)), daysInMonth(ny, nm))
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Instalment due dates from the start date up to `until` (inclusive), plus the
// first one after it. Monthly plans use due_day when set, else the start day.
export function planDueDates(plan, until, maxCount = 400) {
  const out = []
  if (!plan?.start_date) return out
  const step = { weekly: 7, fortnightly: 14, four_weekly: 28 }[plan.frequency]
  let d = plan.frequency === 'monthly' && plan.due_day
    ? (() => { const first = addMonthsClamp(plan.start_date, 0, plan.due_day); return first >= plan.start_date ? first : addMonthsClamp(plan.start_date, 1, plan.due_day) })()
    : plan.start_date
  let i = 0
  while (i < maxCount) {
    out.push(d)
    if (d > until) break
    i++
    d = step ? addDays(d, step) : addMonthsClamp(d, 1, plan.due_day || Number(plan.start_date.slice(8, 10)))
  }
  return out
}

// Amount allocated to this plan, plus historic-arrears allocations on the
// same property since the plan started that are not linked to any plan (a
// payment keyed without picking the plan still counts, even once others are
// linked). Allocations linked to a different plan never count.
export function planPaid(plan, receipts) {
  let paid = 0
  for (const r of receipts || []) {
    for (const a of r.rent_allocations || []) {
      if (a.target !== 'historic_arrears') continue
      if (a.payment_plan_id) { if (a.payment_plan_id === plan.id) paid += Number(a.amount) }
      else if (r.received_date >= plan.start_date) paid += Number(a.amount)
    }
  }
  return Math.round(paid * 100) / 100
}

// Full progress picture for a plan.
export function planProgress(plan, receipts, today = isoToday()) {
  const paid = planPaid(plan, receipts)
  const opening = Number(plan.opening_balance) || 0
  const balance = Math.round(Math.max(0, opening - paid) * 100) / 100
  const dates = planDueDates(plan, today)
  const dueDates = dates.filter(d => d <= today)
  const nextDue = dates.find(d => d > today) || null
  const instalment = Number(plan.instalment_amount) || 0
  // An instalment is expected once its due date has passed: one due today
  // can still be paid today, so a plan starting today is not broken.
  const pastDue = dates.filter(d => d < today)
  const expectedToDate = Math.min(opening, Math.round(pastDue.length * instalment * 100) / 100)
  const shortfall = Math.round(Math.max(0, expectedToDate - paid) * 100) / 100
  // Broken when a whole instalment is behind, or the final part-instalment
  // (whatever is left of the balance) is.
  const breakAt = Math.min(instalment, balance)
  let status
  if (plan.status_override === 'paused') status = 'paused'
  else if (plan.status_override === 'completed' || balance <= 0.005) status = 'completed'
  else if (pastDue.length > 0 && shortfall > 0.005 && shortfall >= breakAt - 0.005) status = 'broken'
  else if (nextDue && addDays(today, 7) >= nextDue) status = 'due_soon'
  else status = 'on_track'
  const instalmentsTotal = instalment ? Math.ceil(opening / instalment) : 0
  const instalmentsPaid = instalment ? Math.floor((paid + 0.005) / instalment) : 0
  return { paid, opening, balance, expectedToDate, shortfall, nextDue, dueDates, status, instalmentsTotal, instalmentsPaid, percent: opening ? Math.min(100, Math.round((paid / opening) * 100)) : 0 }
}

export function activePlan(plans, today = isoToday()) {
  return (plans || []).filter(p => p.status_override !== 'completed' && p.start_date <= today)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0] || null
}

// A receipt that looks like one we already have: same property, same amount,
// received within `windowDays`, and either the same source (a re-key) or a
// different source (the same money arriving via a statement AND a bank feed).
export function possibleDuplicate(existing, candidate, windowDays = 3) {
  const amt = Math.round(Number(candidate.amount) * 100)
  if (!amt) return null
  return (existing || []).find(r => {
    if (r.id && candidate.id && r.id === candidate.id) return false
    if (candidate.source_ref && r.source_ref && r.source_ref === candidate.source_ref) return false // handled by the unique index
    if (Math.round(Number(r.amount) * 100) !== amt) return false
    if (r.kind && r.kind !== 'receipt') return false
    const gap = Math.abs((new Date(r.received_date) - new Date(candidate.received_date)) / 86400000)
    return gap <= windowDays
  }) || null
}
