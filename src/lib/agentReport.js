// Agent weekly report: rent status and let / not let for every property one
// letting agent looks after. Built for Gareth (Propertunity), who gets it by
// email every Monday, and downloadable from Reports as the same PDF.
//
// Pure functions, no React, no Supabase. The in-app report and the
// agent-weekly-report edge function both call buildAgentReport() on the
// fetchProperties shape (properties with rent_payments, tenancies,
// rent_receipts, non_chargeable_periods, rent_overrides, stl_bookings), so the
// email can never disagree with the Rent Tracker.
//
// Everything rides on the rent engine:
//   this month / last month  the collapsed Rent Tracker tile for that period
//                            month, evaluated as at the report date
//   owed                     outstanding on every collectible period since
//                            go-live whose payment window has closed (Missed),
//                            plus any open historic arrears balance
// A month marked paid with no amount stays Paid, the same as the tracker.
//
// Outward-facing: it goes to the agent, so no tenant names, notes, values or
// mortgage figures. Just the property, whether it is let, and the rent.

import { evaluateProperty, groupByMonth, arrearsSummary, monthBounds, isoToday, monthlyRent, STATE, GO_LIVE } from './rentEngine'
import { tenancyForDate } from './tenancyUtils'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Statuses that are in the report. Purchased (not yet ours to let) and sold
// properties are left out.
const REPORTED = ['rented', 'notice_given', 'let_agreed', 'on_rental_market', 'vacant', 'refurb', 'short_term_let']

export const LET_LABEL = {
  rented: 'Let',
  notice_given: 'Notice given',
  short_term_let: 'Short-term let',
  let_agreed: 'Let agreed',
  on_rental_market: 'On the market',
  vacant: 'Vacant',
  refurb: 'Refurb',
}
export const isLet = status => status === 'rented' || status === 'notice_given' || status === 'short_term_let'

// Tile states as the agent reads them.
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

// "Room 3, Piers View" -> "Piers View". Short-term-let rooms in one building
// are reported as a single line so fifteen rooms don't eat a page.
function stlBuilding(p) {
  const n = String(p.name || '').trim()
  const m = n.match(/^(room|unit|flat)\s*[\w-]+\s*,\s*(.+)$/i)
  return m ? m[2].trim() : n
}

function monthKey(iso) { const [y, m] = iso.split('-').map(Number); return { year: y, month: m } }
function prevMonth({ year, month }) { return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 } }
export function monthName({ year, month }) { return `${MONTH_SHORT[month - 1]} ${year}` }

// One property's line.
function propertyLine(p, { asOf, thisMo, lastMo, months }) {
  const evals = evaluateProperty(p, { today: asOf })
  const tiles = groupByMonth(evals)
  const grid = {}
  for (const mo of months) {
    const t = tiles.find(x => x.year === mo.year && x.month === mo.month)
    if (t) grid[mo.key] = { state: t.state, expected: t.expected, received: t.received, outstanding: t.outstanding, needsBackfill: t.needsBackfill }
  }
  const tile = mo => tiles.find(t => t.year === mo.year && t.month === mo.month) || null
  const cur = tile(thisMo), prev = tile(lastMo)

  // Owed = missed balances on closed periods, not this month's rent that is
  // simply not due yet.
  let owed = 0, missedMonths = 0
  for (const e of evals) {
    if (e.state === STATE.MISSED && e.outstanding > 0) { owed = round2(owed + e.outstanding); missedMonths++ }
  }
  const arrears = arrearsSummary(p).balance
  const t = tenancyForDate(p.tenancies || [], asOf)
  const rent = t ? round2(monthlyRent(t)) : (Number(p.rent_pcm) || 0)
  const dueDay = t?.rent_due_day || p.rent_due_day || null

  return {
    id: p.id,
    name: String(p.name || p.address || 'Property').trim(),
    companyId: p.company_id || null,
    company: p.company?.name || '',
    status: p.status,
    letLabel: LET_LABEL[p.status] || p.status,
    let: isLet(p.status),
    vacantSince: !isLet(p.status) ? (p.vacant_since || null) : null,
    tenancyEnd: p.status === 'notice_given' ? (t?.expected_move_out || t?.tenancy_end || p.tenancy_end || null) : null,
    rent,
    dueDay,
    thisMonth: cur ? { state: cur.state, expected: cur.expected, received: cur.received, outstanding: cur.outstanding, needsBackfill: cur.needsBackfill } : null,
    lastMonth: prev ? { state: prev.state, expected: prev.expected, received: prev.received, outstanding: prev.outstanding, needsBackfill: prev.needsBackfill } : null,
    owed,
    missedMonths,
    arrears: arrears > 0 ? arrears : 0,
    rooms: 1,
    grid,
  }
}

// Fold short-term-let rooms into one line per building, summing what the
// bookings brought in.
function foldStl(lines) {
  const out = [], byBuilding = new Map()
  for (const l of lines) {
    if (l.status !== 'short_term_let') { out.push(l); continue }
    const key = `${l.companyId}|${l._building}`
    let g = byBuilding.get(key)
    if (!g) {
      g = { ...l, name: l._building, rooms: 0, rent: 0, owed: 0, missedMonths: 0, arrears: 0,
        thisMonth: { state: STATE.STL, expected: 0, received: 0, outstanding: 0 },
        lastMonth: { state: STATE.STL, expected: 0, received: 0, outstanding: 0 }, grid: {} }
      byBuilding.set(key, g); out.push(g)
    }
    for (const [k, t] of Object.entries(l.grid || {})) {
      const cell = (g.grid[k] ||= { state: STATE.STL, expected: 0, received: 0, outstanding: 0 })
      cell.received = round2(cell.received + (t.received || 0))
    }
    g.rooms++
    g.thisMonth.received = round2(g.thisMonth.received + (l.thisMonth?.received || 0))
    g.lastMonth.received = round2(g.lastMonth.received + (l.lastMonth?.received || 0))
  }
  for (const g of byBuilding.values()) if (g.rooms > 1) g.name = `${g.name} (${g.rooms} rooms)`
  return out
}

/**
 * Build the report.
 * @param {object[]} properties  fetchProperties shape
 * @param {object}   opts
 * @param {object}   opts.agent  { id, name } estate_agents row
 * @param {string}  [opts.asOf]  ISO date, default today
 */
export function buildAgentReport(properties, { agent, asOf = isoToday() } = {}) {
  const thisMo = monthKey(asOf)
  const lastMo = prevMonth(thisMo)
  // Tracker grid: every month from go-live (or 11 months back, whichever is
  // later) to this month.
  const months = []
  const [gy, gm] = GO_LIVE.split('-').map(Number)
  const endIdx = thisMo.year * 12 + thisMo.month - 1
  for (let i = Math.max(gy * 12 + gm - 1, endIdx - 11); i <= endIdx; i++) {
    const year = Math.floor(i / 12), month = (i % 12) + 1
    months.push({ year, month, key: `${year}-${month}`, label: MONTH_SHORT[month - 1] })
  }
  const scoped = (properties || []).filter(p =>
    !p.deleted_at && !p.archived_at && REPORTED.includes(p.status) && managedByAgent(p, agent))

  const raw = scoped.map(p => ({ ...propertyLine(p, { asOf, thisMo, lastMo, months }), _building: stlBuilding(p) }))
  const lines = foldStl(raw)
    .map(({ _building, ...l }) => l)
    .sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name, 'en-GB', { numeric: true }))

  // Headline figures count units, not folded lines.
  const units = raw.length
  const letUnits = raw.filter(l => l.let).length
  const notLet = lines.filter(l => !l.let)
  let expected = 0, received = 0, backfill = 0
  for (const l of raw) {
    const c = l.thisMonth
    if (!c || c.state === STATE.STL || c.state === STATE.NOT_COLLECTIBLE || c.state === STATE.LEGACY || c.state === STATE.FUTURE) continue
    if (c.needsBackfill) { backfill++; continue }
    expected = round2(expected + (c.expected || 0))
    received = round2(received + Math.min(c.received || 0, c.expected || 0))
  }
  const owing = lines.filter(l => l.owed > 0 || l.arrears > 0)
    .sort((a, b) => (b.owed + b.arrears) - (a.owed + a.arrears))
  const byCompany = []
  for (const l of lines) {
    let g = byCompany.find(c => c.company === l.company)
    if (!g) { g = { company: l.company, lines: [] }; byCompany.push(g) }
    g.lines.push(l)
  }

  return {
    agent: agent ? { id: agent.id, name: agent.name } : null,
    asOf,
    thisMonth: { ...thisMo, label: monthName(thisMo), ...monthBounds(thisMo.year, thisMo.month) },
    lastMonth: { ...lastMo, label: monthName(lastMo) },
    months,
    lines,
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
      outstanding: round2(Math.max(0, expected - received)),
      rate: expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : null,
      owed: round2(lines.reduce((s, l) => s + l.owed, 0)),
      arrears: round2(lines.reduce((s, l) => s + l.arrears, 0)),
      owingCount: owing.length,
      backfill,
      stlReceived: round2(lines.filter(l => l.status === 'short_term_let').reduce((s, l) => s + (l.thisMonth?.received || 0), 0)),
    },
  }
}
