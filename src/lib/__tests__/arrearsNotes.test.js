// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  currentNotes, noteIsCurrent, nextVersion, monthEndQueue, explanationLabel, explanationText,
  previousPeriod, periodOf, AWAITING_REVIEW, QUEUE_FILTERS,
} from '../arrearsNotes'
import { propertyArrears } from '../rentEngine'
import { buildAgentReport } from '../agentReport'

// Versioned arrears notes and the month-end queue (rent brief C6).

const row = (id, start, end, status = 'void', amount = null) => {
  const [y, m] = start.split('-').map(Number)
  return { id, year: y, month: m, month_label: `${m}/${y}`, period_start: start, period_end: end, status, amount }
}
const month = (id, y, m, status = 'void', amount = null) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return row(id, `${y}-${mm}-01`, `${y}-${mm}-${last}`, status, amount)
}
const T = (over = {}) => ({ id: 't1', tenancy_start: '2026-01-01', tenancy_end: null, rent_amount: 500, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0, ...over })
const prop = (over = {}) => ({ id: 'p1', name: 'Flat p1', status: 'rented', rent_pcm: 500, rent_due_day: '1st', company_id: 'c1', tenancies: [T()], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [], rent_payments: [], ...over })
const note = (id, over = {}) => ({ id, property_id: 'p1', period: '2026-10', reason: `reason ${id}`, status: 'open', supersedes: null, created_at: `2026-10-01T10:00:0${id.length}Z`, ...over })

describe('currentNotes', () => {
  it('picks the version nobody supersedes and keeps the chain as history, newest first', () => {
    const rows = [
      note('a', { created_at: '2026-09-01T00:00:00Z' }),
      note('b', { supersedes: 'a', created_at: '2026-10-01T00:00:00Z' }),
      note('c', { supersedes: 'b', created_at: '2026-11-01T00:00:00Z' }),
    ]
    const m = currentNotes(rows.slice().reverse())
    const e = m.get('p1')
    expect(e.current.id).toBe('c')
    expect(e.history.map(r => r.id)).toEqual(['b', 'a'])
    expect(e.versions).toBe(3)
  })

  it('takes the newest head when two edits branched from one version, and keeps the other in history', () => {
    const rows = [
      note('a', { created_at: '2026-09-01T00:00:00Z' }),
      note('b', { supersedes: 'a', created_at: '2026-10-01T00:00:00Z' }),
      note('x', { supersedes: 'a', created_at: '2026-10-02T00:00:00Z' }),
    ]
    const e = currentNotes(rows).get('p1')
    expect(e.current.id).toBe('x')
    expect(e.history.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('separates properties and ignores rows without one', () => {
    const m = currentNotes([note('a'), note('b', { property_id: 'p2' }), { id: 'z' }])
    expect([...m.keys()].sort()).toEqual(['p1', 'p2'])
    expect(m.get('p2').history).toEqual([])
  })

  it('survives a supersedes cycle', () => {
    const m = currentNotes([note('a', { supersedes: 'b', created_at: '2026-10-01T00:00:00Z' }), note('b', { supersedes: 'a', created_at: '2026-10-02T00:00:00Z' })])
    expect(m.get('p1').current.id).toBe('b')
    expect(m.get('p1').history.map(r => r.id)).toEqual(['a'])
  })

  it('is empty for no rows', () => {
    expect(currentNotes([]).size).toBe(0)
    expect(currentNotes(null).size).toBe(0)
  })
})

describe('explanations', () => {
  it('says Awaiting review instead of inventing text', () => {
    expect(explanationLabel(null)).toBe(AWAITING_REVIEW)
    expect(explanationLabel(note('a', { reason: '   ', next_action: 'chase' }))).toBe(AWAITING_REVIEW)
    expect(explanationText(note('a', { reason: null }))).toBeNull()
    expect(explanationLabel(note('a', { reason: ' Tenant lost job ' }))).toBe('Tenant lost job')
  })

  it('noteIsCurrent needs this period and a reason', () => {
    expect(noteIsCurrent(note('a', { period: '2026-11' }), '2026-11')).toBe(true)
    expect(noteIsCurrent(note('a', { period: '2026-10' }), '2026-11')).toBe(false)
    expect(noteIsCurrent(note('a', { period: '2026-11', reason: '' }), '2026-11')).toBe(false)
    expect(noteIsCurrent(null, '2026-11')).toBe(false)
  })

  it('periods', () => {
    expect(periodOf('2026-11-19')).toBe('2026-11')
    expect(previousPeriod('2026-11')).toBe('2026-10')
    expect(previousPeriod('2026-01')).toBe('2025-12')
  })
})

describe('nextVersion', () => {
  const last = note('a', { period: '2026-10', response: 'Will pay Friday', payment_plan: '£50 a week', next_action: 'Call', follow_up_date: '2026-10-20', owner: 'Tiffany', tenancy_id: 't1' })

  it('keeps last month\'s explanation as a new version for this period', () => {
    const v = nextVersion(last, { period: '2026-11' })
    expect(v).toMatchObject({ property_id: 'p1', tenancy_id: 't1', period: '2026-11', supersedes: 'a', reason: 'reason a', response: 'Will pay Friday', payment_plan: '£50 a week', next_action: 'Call', follow_up_date: '2026-10-20', owner: 'Tiffany', status: 'open' })
    expect(v.id).toBeUndefined()
    expect(v.author).toBeUndefined()
    expect(v.created_at).toBeUndefined()
  })

  it('applies changes on top (needs investigation)', () => {
    expect(nextVersion(last, { period: '2026-11', changes: { status: 'needs_investigation' } })).toMatchObject({ status: 'needs_investigation', supersedes: 'a', reason: 'reason a' })
  })

  it('starts a first version with no predecessor', () => {
    expect(nextVersion(null, { period: '2026-11', property_id: 'p9', changes: { reason: 'New' } })).toEqual({ property_id: 'p9', tenancy_id: null, period: '2026-11', supersedes: null, status: 'open', reason: 'New' })
  })
})

describe('monthEndQueue', () => {
  const asOf = '2026-11-19'

  it('flags rent outstanding and what fell overdue this month, from the rent engine', () => {
    // Oct missed (overdue before November), Nov missed (window closed 6 Nov).
    const p = prop({ rent_payments: [month('oct', 2026, 10), month('nov', 2026, 11)] })
    const [r] = monthEndQueue({ properties: [p], asOf })
    expect(r.outstanding).toBe(propertyArrears(p, asOf))
    expect(r.outstanding).toBe(1000)
    expect(r.newlyOverdue).toBe(500)
    expect(r.flags).toMatchObject({ outstanding: true, newlyOverdue: true, received: false })
    expect(r.explanation).toBe(AWAITING_REVIEW)
    expect(r.noteCurrent).toBe(false)
  })

  it('does not call older arrears newly overdue when part was paid this month', () => {
    const receipt = { id: 'r1', received_date: '2026-11-10', amount: 200, kind: 'receipt', source: 'manual', rent_allocations: [{ rent_payment_id: 'oct', target: 'current_rent', amount: 200 }] }
    const p = prop({ rent_payments: [month('oct', 2026, 10)], rent_receipts: [receipt] })
    const [r] = monthEndQueue({ properties: [p], asOf })
    expect(r.outstanding).toBe(300)
    expect(r.newlyOverdue).toBe(0)
    expect(r.receivedThisMonth).toBe(200)
    expect(r.flags.received).toBe(true)
    expect(r.flags.imported).toBe(false)
  })

  it('flags imported and corrected receipts and overrides made this month', () => {
    const p = prop({
      rent_payments: [month('nov', 2026, 11)],
      rent_receipts: [
        { id: 'r1', received_date: '2026-11-02', amount: 500, kind: 'receipt', source: 'statement', rent_allocations: [{ rent_payment_id: 'nov', target: 'current_rent', amount: 500 }] },
        { id: 'r2', received_date: '2026-11-03', amount: -20, kind: 'refund', source: 'manual', reverses_receipt_id: 'r0', rent_allocations: [] },
        { id: 'r3', received_date: '2026-10-03', amount: 500, kind: 'receipt', source: 'bank', rent_allocations: [] },
      ],
      rent_overrides: [{ id: 'o1', rent_payment_id: 'nov', state: 'clear', reason: 'x', created_at: '2026-11-05T09:00:00Z' }],
    })
    const [r] = monthEndQueue({ properties: [p], asOf })
    expect(r.importedCount).toBe(1)
    expect(r.correctedCount).toBe(2)
    expect(r.receivedThisMonth).toBe(480)
  })

  it('flags vacancy (non-chargeable days) this month', () => {
    const p = prop({ rent_payments: [month('nov', 2026, 11, 'paid', 250)], non_chargeable_periods: [{ id: 'n1', start_date: '2026-11-16', end_date: '2026-11-30', reason: 'refurb' }] })
    const [r] = monthEndQueue({ properties: [p], asOf })
    expect(r.flags.vacancy).toBe(true)
    expect(r.vacancy).toHaveLength(1)
  })

  it('flags missing sources: paid with no amount, and no tenancy record', () => {
    const backfill = prop({ id: 'pb', name: 'B', rent_payments: [month('oct', 2026, 10, 'paid', null)] })
    const fallback = prop({ id: 'pf', name: 'F', tenancies: [], rent_payments: [month('nov', 2026, 11, 'paid', 500)] })
    const rows = monthEndQueue({ properties: [backfill, fallback], asOf })
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by.pb.flags.needsBackfill).toBe(true)
    expect(by.pb.missingSource).toBe(true)
    expect(by.pf.flags.noTenancy).toBe(true)
    expect(by.pf.missingSource).toBe(true)
  })

  it('leaves out properties with nothing to review, and short-term lets', () => {
    const clean = prop({ rent_payments: [month('oct', 2026, 10, 'paid', 500)] })
    const stl = prop({ id: 's', status: 'short_term_let', rent_payments: [month('nov', 2026, 11)] })
    expect(monthEndQueue({ properties: [clean, stl], asOf })).toEqual([])
  })

  it('says whether the explanation is current for this period', () => {
    const p = prop({ rent_payments: [month('oct', 2026, 10)] })
    const last = currentNotes([note('a', { period: '2026-10', reason: 'Lost job' })])
    const [r1] = monthEndQueue({ properties: [p], notesByProperty: last, asOf })
    expect(r1.noteCurrent).toBe(false)
    expect(r1.explanation).toBe('Lost job')
    const now = currentNotes([note('a', { period: '2026-10' }), note('b', { period: '2026-11', reason: 'Lost job', supersedes: 'a', created_at: '2026-11-02T00:00:00Z' })])
    const [r2] = monthEndQueue({ properties: [p], notesByProperty: now, asOf })
    expect(r2.noteCurrent).toBe(true)
    expect(r2.versions).toBe(2)
  })

  it('sorts the largest arrears first, and the filters select rows', () => {
    const a = prop({ id: 'a', name: 'A', rent_payments: [month('oct', 2026, 10)] })
    const b = prop({ id: 'b', name: 'B', rent_payments: [month('sep', 2026, 9), month('oct', 2026, 10)] })
    const rows = monthEndQueue({ properties: [a, b], asOf })
    expect(rows.map(r => r.id)).toEqual(['b', 'a'])
    const f = Object.fromEntries(QUEUE_FILTERS.map(x => [x.v, x.test]))
    expect(rows.filter(f.notCurrent)).toHaveLength(2)
    expect(rows.filter(f.newlyOverdue)).toHaveLength(0)
  })
})

describe('agent report: arrears explanations (opt-in)', () => {
  const asOf = '2026-11-19'
  const owing = prop({ managed_by_agent_id: 'ag1', company: { name: 'Co' }, rent_payments: [month('oct', 2026, 10)] })
  const other = prop({ id: 'p2', name: 'Flat p2', managed_by_agent_id: 'ag1', company: { name: 'Co' }, rent_payments: [month('oct', 2026, 10)] })
  const notes = currentNotes([note('a', { reason: 'Lost job, plan agreed' })])

  it('leaves notes out unless includeNotes is set', () => {
    const m = buildAgentReport([owing], { agent: { id: 'ag1', name: 'Agent' }, asOf, notesByProperty: notes })
    expect(m.includeNotes).toBe(false)
    expect(m.owing[0].explanation).toBeUndefined()
  })

  it('adds the reason, or Awaiting review where none is written', () => {
    const m = buildAgentReport([owing, other], { agent: { id: 'ag1', name: 'Agent' }, asOf, notesByProperty: notes, includeNotes: true })
    expect(m.includeNotes).toBe(true)
    const by = Object.fromEntries(m.owing.map(c => [c.id, c.explanation]))
    expect(by).toEqual({ p1: 'Lost job, plan agreed', p2: AWAITING_REVIEW })
  })
})
