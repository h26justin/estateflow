// Agent weekly report: the Rent Tracker for every property one letting agent
// looks after. Built for Gareth (Propertunity), who gets it by email every
// Monday, and downloadable from Reports as the same PDF.
//
// Pure functions, no React, no Supabase. The in-app report and the
// agent-weekly-report edge function both call buildAgentReport() on the
// fetchProperties shape (properties with rent_payments, tenancies,
// rent_receipts, non_chargeable_periods, rent_overrides, stl_bookings), so the
// email can never disagree with the Rent Tracker.
//
// Laid out like the Rent Tracker page (App.jsx RentTrackerView): company by
// company, buildings grouped under a header, one card per property with the
// calendar year's month tiles, the property status, the paid / due / missed /
// n/c counts and what came in this year. The counts follow engineSummary()
// there: every month of the year that has started, from the rent engine.
// On top of the tracker it shows what is owed: outstanding on every missed
// month since go-live plus any open historic arrears balance, and for the last
// four months the rent due against the rent collected, per property and per
// company, so a shortfall is visible month by month.
//
// Outward-facing: it goes to the agent, so no tenant names, notes, values or
// mortgage figures. Just the property, its status and the rent.

import { evaluateProperty, groupByMonth, arrearsSummary, isoToday, monthlyRent, STATE } from './rentEngine'
import { tenancyForDate } from './tenancyUtils'
import { buildingTailFromName, buildingKeyFromName } from './addressUtils'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Statuses that are in the report. Purchased (not yet ours to let) and sold
// properties are left out.
const REPORTED = ['rented', 'notice_given', 'let_agreed', 'on_rental_market', 'vacant', 'refurb', 'short_term_let']

// Same words as the Rent Tracker's status pill (App.jsx STATUS_CFG).
export const LET_LABEL = {
  rented: 'Rented',
  notice_given: 'Notice given',
  short_term_let: 'Short-Term Let',
  let_agreed: 'Let agreed',
  on_rental_market: 'On rental market',
  vacant: 'Vacant',
  refurb: 'Refurbing',
}
export const isLet = status => status === 'rented' || status === 'notice_given' || status === 'short_term_let'

export const RENT_LABEL = {
  paid: 'Paid', due: 'Due', part_paid: 'Part paid', missed: 'Missed',
  not_collectible: '-', stl: 'STL', legacy: '-', future: '-',
}

// Does this agent look after the property? The agent id is the source of
// truth; the older free-text managed_by is honoured only where no agent is
// linked, so a property moved to another agent never lingers here.
export function managedByAgent(p, agent) {
  if (!agent) return false
  if (p.managed_by_agent_id) return p.managed_by_agent_id === agent.id
  const name = String(p.managed_by || '').trim().toLowerCase()
  return !!name && name === String(agent.name || '').trim().toLowerCase()
}

// "28" -> "28th", "28th" stays, blank -> null.
export function dueDayLabel(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!/^\d{1,2}$/.test(s)) return s
  const n = Number(s), t = n % 100
  const suf = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
  return `${n}${suf}`
}

function monthKey(iso) { const [y, m] = iso.split('-').map(Number); return { year: y, month: m } }
export function monthName({ year, month }) { return `${MONTH_SHORT[month - 1]} ${year}` }

// One property's card.
function propertyCard(p, { asOf, year, thisMo }) {
  const evals = evaluateProperty(p, { today: asOf })
  const tiles = groupByMonth(evals)
  const isStl = p.status === 'short_term_let'

  // Calendar year tiles, Jan to Dec, like the tracker.
  const months = []
  const counts = { paid: 0, due: 0, missed: 0, nc: 0, backfill: 0 }
  let received = 0
  for (let m = 1; m <= 12; m++) {
    const t = tiles.find(x => x.year === year && x.month === m)
    const future = year > thisMo.year || (year === thisMo.year && m > thisMo.month)
    const state = future ? 'future' : (t ? t.state : null)
    months.push({
      month: m, label: MONTH_SHORT[m - 1], state, future,
      current: year === thisMo.year && m === thisMo.month,
      received: t?.received || 0, expected: t?.expected || 0, outstanding: t?.outstanding || 0,
      needsBackfill: !!t?.needsBackfill, override: !!t?.override,
      legacyStatus: t?.evals?.[0]?.legacyStatus || null,
    })
    if (!t || future) continue
    // engineSummary(): legacy months count by their old status.
    if (t.state === STATE.LEGACY) {
      const ls = t.evals?.[0]?.legacyStatus
      if (ls === 'paid') counts.paid++
      else if (ls === 'overdue' || ls === 'missed') counts.missed++
      else if (ls === 'late' || ls === 'partial') counts.due++
      received += t.evals.reduce((s, e) => s + (e.legacyAmount || 0), 0)
      continue
    }
    if (t.state === STATE.PAID) counts.paid++
    else if (t.state === STATE.DUE || t.state === STATE.PART_PAID) counts.due++
    else if (t.state === STATE.MISSED) counts.missed++
    else if (t.state === STATE.NOT_COLLECTIBLE) counts.nc++
    if (t.needsBackfill) counts.backfill++
    received += t.received || 0
  }

  // Owed = missed balances on closed periods, not rent still in its window.
  let owed = 0, missedMonths = 0
  for (const e of evals) {
    if (e.state === STATE.MISSED && e.outstanding > 0) { owed = round2(owed + e.outstanding); missedMonths++ }
  }
  const arrears = Math.max(0, arrearsSummary(p).balance)
  const t = tenancyForDate(p.tenancies || [], asOf)

  // Last 4 months (this month and the three before): rent due to be
  // collected against what came in, so the shortfall shows month by month.
  // A month the tracker shows Paid without the money recorded against it
  // (marked paid with no amount, or overridden to Paid) counts as collected
  // in full so the strip never contradicts its tile; it is flagged so the
  // reader knows the amount was not entered.
  const recent = recentMonths(thisMo).map(mo => {
    const r = tiles.find(x => x.year === mo.year && x.month === mo.month)
    const rated = r && [STATE.PAID, STATE.DUE, STATE.PART_PAID, STATE.MISSED].includes(r.state)
    const due = rated ? round2(r.expected) : 0
    const received = round2(r?.received || 0)
    const paidUnrecorded = !!(rated && r.state === STATE.PAID && received < due)
    const collected = paidUnrecorded ? due : received
    const gap = round2(Math.max(0, due - collected))
    // Rent still inside its payment window is not a shortfall yet.
    const open = r && (r.state === STATE.DUE || r.state === STATE.PART_PAID)
    return { ...mo, state: r?.state || null, due, collected, shortfall: open ? 0 : gap, stillDue: open ? gap : 0, assumed: paidUnrecorded }
  })
  const cur = tiles.find(x => x.year === thisMo.year && x.month === thisMo.month) || null

  return {
    id: p.id,
    name: String(p.name || p.address || 'Property').trim(),
    companyId: p.company_id || null,
    company: p.company?.name || '',
    status: p.status,
    letLabel: LET_LABEL[p.status] || p.status,
    let: isLet(p.status),
    stl: isStl,
    vacantSince: !isLet(p.status) ? (p.vacant_since || null) : null,
    tenancyEnd: p.status === 'notice_given' ? (t?.expected_move_out || t?.tenancy_end || p.tenancy_end || null) : null,
    // The tracker shows the property's own rent and due day.
    rent: Number(p.rent_pcm) || (t ? round2(monthlyRent(t)) : 0),
    dueDay: dueDayLabel(p.rent_due_day),
    months,
    counts,
    received: round2(received),
    thisMonth: cur ? { state: cur.state, expected: cur.expected, received: cur.received, needsBackfill: cur.needsBackfill } : null,
    owed,
    missedMonths,
    arrears: round2(arrears),
    recent,
  }
}

// This month and the three before it, oldest first.
function recentMonths(thisMo, count = 4) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const idx = thisMo.year * 12 + thisMo.month - 1 - i
    const year = Math.floor(idx / 12), month = (idx % 12) + 1
    out.push({ year, month, label: MONTH_SHORT[month - 1] })
  }
  return out
}

// Buildings: 2+ units sharing a name tail ("Room 1, Piers View") group under
// one header, singles stay flat. Same keys as the tracker.
function groupBuildings(cards) {
  const groups = [], byKey = new Map()
  for (const c of cards) {
    const key = buildingKeyFromName(c.name) || `__solo__${c.id}`
    if (!byKey.has(key)) { byKey.set(key, groups.length); groups.push({ key, name: buildingTailFromName(c.name) || c.name, cards: [] }) }
    groups[byKey.get(key)].cards.push(c)
  }
  for (const g of groups) {
    g.building = g.cards.length > 1
    if (g.building) {
      g.cards.sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { numeric: true }))
      g.rent = round2(g.cards.reduce((s, c) => s + c.rent, 0))
      g.received = round2(g.cards.reduce((s, c) => s + c.received, 0))
      g.missed = g.cards.reduce((s, c) => s + c.counts.missed, 0)
      g.due = g.cards.reduce((s, c) => s + c.counts.due, 0)
    }
  }
  return groups
}

/**
 * Build the report.
 * @param {object[]} properties  fetchProperties shape
 * @param {object}   opts
 * @param {object}   opts.agent      { id, name } estate_agents row
 * @param {object[]} [opts.companies] company rows ({ id, name, color, logo_url })
 * @param {string}   [opts.asOf]     ISO date, default today
 */
export function buildAgentReport(properties, { agent, companies = [], asOf = isoToday() } = {}) {
  const thisMo = monthKey(asOf)
  const year = thisMo.year
  const scoped = (properties || []).filter(p =>
    !p.deleted_at && !p.archived_at && REPORTED.includes(p.status) && managedByAgent(p, agent))
  const cards = scoped.map(p => propertyCard(p, { asOf, year, thisMo }))
    .sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name, 'en-GB', { numeric: true }))

  const coById = new Map((companies || []).map(c => [c.id, c]))
  const byCompany = []
  for (const c of cards) {
    let g = byCompany.find(x => x.companyId === c.companyId)
    if (!g) {
      const co = coById.get(c.companyId) || {}
      g = { companyId: c.companyId, company: c.company || co.name || 'No company', color: co.color || null, logoUrl: co.logo_url || null, cards: [] }
      byCompany.push(g)
    }
    g.cards.push(c)
  }
  for (const g of byCompany) {
    const sum = k => g.cards.reduce((s, c) => s + c.counts[k], 0)
    g.counts = { paid: sum('paid'), due: sum('due'), missed: sum('missed'), nc: sum('nc'), backfill: sum('backfill') }
    // The tracker's company total leaves short-term lets out.
    g.received = round2(g.cards.filter(c => !c.stl).reduce((s, c) => s + c.received, 0))
    g.owed = round2(g.cards.reduce((s, c) => s + c.owed + c.arrears, 0))
    g.groups = groupBuildings(g.cards)
    // Company last-4-months totals, long-term lets only (as the tracker).
    // The shortfall is summed property by property, so one tenant's
    // overpayment never hides another's shortfall.
    const lt = g.cards.filter(c => !c.stl)
    g.recent = recentMonths(thisMo).map((mo, i) => ({
      ...mo,
      due: round2(lt.reduce((s, c) => s + c.recent[i].due, 0)),
      collected: round2(lt.reduce((s, c) => s + c.recent[i].collected, 0)),
      shortfall: round2(lt.reduce((s, c) => s + c.recent[i].shortfall, 0)),
      stillDue: round2(lt.reduce((s, c) => s + c.recent[i].stillDue, 0)),
    }))
    g.shortfall4 = round2(g.recent.reduce((s, r) => s + r.shortfall, 0))
    g.missedMonths = g.cards.reduce((s, c) => s + c.missedMonths, 0)
    g.notLet = g.cards.filter(c => !c.let).length
  }

  const units = cards.length
  const letUnits = cards.filter(c => c.let).length
  let expected = 0, received = 0
  for (const c of cards) {
    const m = c.thisMonth
    if (!m || c.stl || [STATE.STL, STATE.NOT_COLLECTIBLE, STATE.LEGACY, STATE.FUTURE].includes(m.state) || m.needsBackfill) continue
    expected = round2(expected + (m.expected || 0))
    received = round2(received + Math.min(m.received || 0, m.expected || 0))
  }
  const owing = cards.filter(c => c.owed > 0 || c.arrears > 0).sort((a, b) => (b.owed + b.arrears) - (a.owed + a.arrears))
  const notLet = cards.filter(c => !c.let)

  return {
    agent: agent ? { id: agent.id, name: agent.name } : null,
    asOf,
    year,
    thisMonth: { ...thisMo, label: monthName(thisMo) },
    months: MONTH_SHORT.map((label, i) => ({ month: i + 1, label })),
    recentMonths: recentMonths(thisMo),
    lines: cards,
    byCompany,
    owing,
    notLet,
    summary: {
      units,
      letUnits,
      notLetUnits: units - letUnits,
      occupancy: units ? Math.round((letUnits / units) * 100) : null,
      expected,
      received,
      rate: expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : null,
      owed: round2(cards.reduce((s, c) => s + c.owed, 0)),
      arrears: round2(cards.reduce((s, c) => s + c.arrears, 0)),
      owingCount: owing.length,
      yearReceived: round2(byCompany.reduce((s, g) => s + g.received, 0)),
      // Last 4 months across every company: what fell short once the payment
      // window closed, and what is still inside it.
      shortfall4: round2(byCompany.reduce((s, g) => s + g.recent.reduce((t, r) => t + r.shortfall, 0), 0)),
      stillDue4: round2(byCompany.reduce((s, g) => s + g.recent.reduce((t, r) => t + r.stillDue, 0), 0)),
      due4: round2(byCompany.reduce((s, g) => s + g.recent.reduce((t, r) => t + r.due, 0), 0)),
      missedMonths: cards.reduce((s, c) => s + c.missedMonths, 0),
    },
  }
}
