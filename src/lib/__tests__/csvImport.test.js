import { describe, it, expect } from 'vitest'
import {
  parseCsv, detectColumns, parseDate, parseMonth, parseAmount, parseStatus,
  parseCategory, monthBounds, sourceRef, buildRentPlan, buildExpensePlan,
  aliasesToLearn,
} from '../csvImport'

const PROPS = [
  { id: 'p-henley', name: '35 Henley Road', address: '35 Henley Road, Sunderland, SR4 8AS' },
  { id: 'p-esp3', name: 'Esplanade West Flat 3', address: '16 Esplanade, Sunderland' },
  { id: 'p-chester', name: '12 Chester Grove', address: '12 Chester Grove, Sunderland' },
]

const rentPlan = (csv, opts = {}) => {
  const { headers, rows } = parseCsv(csv)
  return buildRentPlan({ rows, columns: detectColumns(headers), properties: PROPS, ...opts })
}
const expPlan = (csv, opts = {}) => {
  const { headers, rows } = parseCsv(csv)
  return buildExpensePlan({ rows, columns: detectColumns(headers), properties: PROPS, ...opts })
}

describe('parseCsv', () => {
  it('reads a simple file with a header row', () => {
    const { headers, rows } = parseCsv('Property,Amount\n35 Henley Road,635\n')
    expect(headers).toEqual(['Property', 'Amount'])
    expect(rows).toHaveLength(1)
    expect(rows[0].Property).toBe('35 Henley Road')
    expect(rows[0].__line).toBe(2)
  })

  it('honours quoted fields containing commas and doubled quotes', () => {
    const { rows } = parseCsv('Property,Description\nA,"Repairs, urgent ""x"""\n')
    expect(rows[0].Description).toBe('Repairs, urgent "x"')
  })

  it('handles a quoted newline inside a field', () => {
    const { rows } = parseCsv('Property,Description\nA,"line one\nline two"\n')
    expect(rows).toHaveLength(1)
    expect(rows[0].Description).toBe('line one\nline two')
  })

  it('strips a BOM so the first header still matches', () => {
    const { headers } = parseCsv('﻿Property,Amount\nA,1\n')
    expect(headers[0]).toBe('Property')
  })

  it('drops blank spacer lines rather than treating them as data', () => {
    const { rows } = parseCsv('Property,Amount\nA,1\n\n,\nB,2\n')
    expect(rows.map(r => r.Property)).toEqual(['A', 'B'])
  })

  it('copes with a file that does not end in a newline', () => {
    const { rows } = parseCsv('Property,Amount\nA,1')
    expect(rows).toHaveLength(1)
  })

  it('is safe on empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
    expect(parseCsv(null)).toEqual({ headers: [], rows: [] })
  })
})

describe('detectColumns', () => {
  it('maps the obvious headers', () => {
    const c = detectColumns(['Property', 'Period Start', 'Period End', 'Amount', 'Status'])
    expect(c.property).toBe('Property')
    expect(c.period_start).toBe('Period Start')
    expect(c.amount).toBe('Amount')
  })

  it('does not let notes steal the description column', () => {
    const c = detectColumns(['Property', 'Description', 'Notes'])
    expect(c.description).toBe('Description')
    expect(c.notes).toBe('Notes')
  })
})

describe('value coercion', () => {
  it('reads DD/MM/YYYY as day-first', () => {
    // Month-first would silently move this to 3 January.
    expect(parseDate('03/01/2025')).toBe('2025-01-03')
  })

  it('passes ISO dates through', () => {
    expect(parseDate('2025-01-03')).toBe('2025-01-03')
  })

  it('rejects an impossible date rather than rolling it over', () => {
    expect(parseDate('31/02/2025')).toBeNull()
    expect(parseDate('2025-13-01')).toBeNull()
  })

  it('reads the month forms a landlord will actually type', () => {
    expect(parseMonth('2025-01')).toEqual({ year: 2025, month: 1 })
    expect(parseMonth('Jan 2025')).toEqual({ year: 2025, month: 1 })
    expect(parseMonth('January 2025')).toEqual({ year: 2025, month: 1 })
    expect(parseMonth('01/2025')).toEqual({ year: 2025, month: 1 })
    expect(parseMonth('nonsense')).toBeNull()
  })

  it('gets month bounds right including a leap February', () => {
    expect(monthBounds(2024, 2)).toEqual({ period_start: '2024-02-01', period_end: '2024-02-29' })
    expect(monthBounds(2025, 2)).toEqual({ period_start: '2025-02-01', period_end: '2025-02-28' })
  })

  it('parses money with symbols and separators', () => {
    expect(parseAmount('£1,234.50')).toBe(1234.5)
    expect(parseAmount('  635 ')).toBe(635)
  })

  it('reads a bracketed accounting negative', () => {
    // Xero writes agent commission this way.
    expect(parseAmount('(65.00)')).toBe(-65)
  })

  it('returns null for a non-number rather than zero', () => {
    // Treating "n/a" as 0 would silently wipe a figure.
    expect(parseAmount('n/a')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })

  it('maps loose status wording onto the constraint values', () => {
    expect(parseStatus('Paid')).toBe('paid')
    expect(parseStatus('yes')).toBe('paid')
    expect(parseStatus('vacant')).toBe('void')
    expect(parseStatus('banana')).toBeNull()
  })

  it('recognises the fee wordings that actually turn up', () => {
    expect(parseCategory('Management Fee')).toBe('agent_fees')
    expect(parseCategory('Commission')).toBe('agent_fees')
    expect(parseCategory('Agent / Management Fees')).toBe('agent_fees')
    expect(parseCategory('Repairs & Maintenance')).toBe('repairs')
    expect(parseCategory('Service Charge')).toBe('service_charge')
  })

  it('gives a stable source ref for identical input and a different one otherwise', () => {
    expect(sourceRef('rent', ['a', 1])).toBe(sourceRef('rent', ['a', 1]))
    expect(sourceRef('rent', ['a', 1])).not.toBe(sourceRef('rent', ['a', 2]))
  })
})

describe('buildRentPlan — the paid-with-no-amount trap', () => {
  it('rejects a paid row with no amount', () => {
    // This exact shape left Vale reporting £0 across 117 paid months.
    const { plan, summary } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,,paid\n')
    expect(plan[0].action).toBe('error')
    expect(plan[0].errors[0]).toMatch(/no amount/i)
    expect(summary.error).toBe(1)
    expect(summary.create).toBe(0)
  })

  it('rejects a paid row with a zero amount too', () => {
    const { plan } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,0,paid\n')
    expect(plan[0].action).toBe('error')
  })

  it('accepts a void month with no amount', () => {
    const { plan } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,,void\n')
    expect(plan[0].action).toBe('create')
    expect(plan[0].status).toBe('void')
  })

  it('infers paid from an amount when there is no status column', () => {
    const { plan } = rentPlan('Property,Month,Amount\n35 Henley Road,2025-01,635\n')
    expect(plan[0].status).toBe('paid')
    expect(plan[0].amount).toBe(635)
    expect(plan[0].action).toBe('create')
  })

  it('refuses negative rent and points at the expense route', () => {
    const { plan } = rentPlan('Property,Month,Amount\n35 Henley Road,2025-01,-635\n')
    expect(plan[0].action).toBe('error')
    expect(plan[0].errors.join(' ')).toMatch(/expense/i)
  })
})

describe('buildRentPlan — dedupe', () => {
  const existing = [{
    id: 'rp-1', property_id: 'p-henley',
    period_start: '2025-01-01', period_end: '2025-01-31',
    status: 'paid', amount: 635, source_ref: null,
  }]

  it('skips a row identical to what is already stored', () => {
    const { plan, summary } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,635,paid\n', { existing })
    expect(plan[0].action).toBe('skip')
    expect(summary.skip).toBe(1)
  })

  it('updates rather than duplicating when the amount differs', () => {
    const { plan } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,700,paid\n', { existing })
    expect(plan[0].action).toBe('update')
    expect(plan[0].existingId).toBe('rp-1')
    expect(plan[0].before).toEqual({ status: 'paid', amount: 635 })
  })

  it('fills a stored paid month whose amount is NULL', () => {
    const nulled = [{ ...existing[0], amount: null }]
    const { plan } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,635,paid\n', { existing: nulled })
    expect(plan[0].action).toBe('update')
    expect(plan[0].before.amount).toBeNull()
  })

  it('still allows a second segment in the same month on different dates', () => {
    // Tenant changeover mid-month is legitimate and must not be blocked.
    const csv = 'Property,Period Start,Period End,Amount\n'
      + '35 Henley Road,2025-01-01,2025-01-15,300\n'
      + '35 Henley Road,2025-01-16,2025-01-31,335\n'
    const { summary } = rentPlan(csv, { existing: [] })
    expect(summary.create).toBe(2)
    expect(summary.error).toBe(0)
  })

  it('blocks two rows in the same file claiming the identical period', () => {
    const csv = 'Property,Month,Amount\n35 Henley Road,2025-01,635\n35 Henley Road,2025-01,635\n'
    const { plan, summary } = rentPlan(csv)
    expect(plan[0].action).toBe('create')
    expect(plan[1].action).toBe('error')
    expect(plan[1].errors[0]).toMatch(/line 2/)
    expect(summary.error).toBe(1)
  })

  it('skips a row already imported under the same source reference', () => {
    const ref = sourceRef('rent', ['p-henley', '2025-01-01', '2025-01-31', 635, 'paid'])
    const { plan } = rentPlan('Property,Month,Amount,Status\n35 Henley Road,2025-01,635,paid\n', {
      existing: [{ id: 'x', property_id: 'p-other', period_start: null, period_end: null, source_ref: ref }],
    })
    expect(plan[0].action).toBe('skip')
  })

  it('warns when one line covers an implausibly long period', () => {
    const { plan } = rentPlan('Property,Period Start,Period End,Amount\n35 Henley Road,2025-01-01,2025-12-31,7620\n')
    expect(plan[0].warnings.join(' ')).toMatch(/365 days/)
  })
})

describe('buildRentPlan — property resolution', () => {
  it('errors rather than guessing when no property matches', () => {
    const { plan } = rentPlan('Property,Month,Amount\nSomewhere Else Entirely,2025-01,500\n')
    expect(plan[0].action).toBe('error')
    expect(plan[0].propertyId).toBeNull()
  })

  it('matches Xero\'s name for a renamed property', () => {
    // Xero calls it "16 Esplanade Flat 3"; EstateFlow calls it "Esplanade West Flat 3".
    const { plan } = rentPlan('Property,Month,Amount\n16 Esplanade Flat 3,2025-01,625\n')
    expect(plan[0].propertyId).toBe('p-esp3')
  })

  it('uses a learned alias', () => {
    const { plan } = rentPlan('Property,Month,Amount\nHenly Road,2025-01,635\n', {
      aliases: [{ property_id: 'p-henley', alias: 'Henly Road', alias_norm: 'henly road' }],
    })
    expect(plan[0].propertyId).toBe('p-henley')
    expect(plan[0].matchedVia).toBe('alias')
  })
})

describe('buildExpensePlan', () => {
  it('creates a straightforward expense', () => {
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Repairs,Boiler,120.50\n')
    expect(plan[0].action).toBe('create')
    expect(plan[0].date).toBe('2025-01-03')
    expect(plan[0].category).toBe('repairs')
    expect(plan[0].amount).toBe(120.5)
  })

  it('folds a bracketed negative into a positive cost and says so', () => {
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Commission,Fee,(63.50)\n')
    expect(plan[0].amount).toBe(63.5)
    expect(plan[0].category).toBe('agent_fees')
    expect(plan[0].warnings.join(' ')).toMatch(/negative/i)
  })

  it('files an unrecognised category as other with a warning', () => {
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Wombat,X,10\n')
    expect(plan[0].category).toBe('other')
    expect(plan[0].warnings.join(' ')).toMatch(/not recognised/i)
  })

  it('errors on a missing amount', () => {
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Repairs,X,\n')
    expect(plan[0].action).toBe('error')
  })

  it('blocks a line identical to another in the same file', () => {
    const csv = 'Property,Date,Category,Description,Amount\n'
      + '35 Henley Road,03/01/2025,Repairs,Boiler,120\n'
      + '35 Henley Road,03/01/2025,Repairs,Boiler,120\n'
    const { plan } = expPlan(csv)
    expect(plan[1].action).toBe('error')
  })

  it('warns but still allows a genuine repeat of an existing hand-keyed cost', () => {
    // Two identical costs on one day are possible, so this must not block.
    const existing = [{ id: 'e1', property_id: 'p-henley', date: '2025-01-03', category: 'repairs', amount: 120, source_ref: null }]
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Repairs,Boiler,120\n', { existing })
    expect(plan[0].action).toBe('create')
    expect(plan[0].warnings.join(' ')).toMatch(/already exists/i)
  })

  it('skips a row already imported under the same source reference', () => {
    const first = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Repairs,Boiler,120\n')
    const ref = first.plan[0].sourceRef
    const { plan } = expPlan('Property,Date,Category,Description,Amount\n35 Henley Road,03/01/2025,Repairs,Boiler,120\n', {
      existing: [{ id: 'e1', property_id: 'p-henley', date: '2025-01-03', category: 'repairs', amount: 120, source_ref: ref }],
    })
    expect(plan[0].action).toBe('skip')
  })
})

describe('aliasesToLearn', () => {
  it('learns only labels the user corrected by hand', () => {
    const plan = [
      { matchedVia: 'manual', propertyId: 'p-henley', label: 'Henly Rd' },
      { matchedVia: 'score', propertyId: 'p-esp3', label: '16 Esplanade Flat 3' },
    ]
    const out = aliasesToLearn(plan, PROPS)
    expect(out).toHaveLength(1)
    expect(out[0].alias).toBe('Henly Rd')
  })

  it('does not learn a label that already equals the property name', () => {
    const plan = [{ matchedVia: 'manual', propertyId: 'p-henley', label: '35 Henley Road' }]
    expect(aliasesToLearn(plan, PROPS)).toHaveLength(0)
  })

  it('learns each distinct label once', () => {
    const plan = [
      { matchedVia: 'manual', propertyId: 'p-henley', label: 'Henly Rd' },
      { matchedVia: 'manual', propertyId: 'p-henley', label: 'Henly Rd' },
    ]
    expect(aliasesToLearn(plan, PROPS)).toHaveLength(1)
  })
})

describe('buildRentPlan — overlapping periods', () => {
  const PROPS = [{ id: 'p1', name: '17 Turnberry Avenue', address: '17 Turnberry Avenue, Blyth' }]
  const cols = { property: 'Property', period_start: 'Start', period_end: 'End', amount: 'Amount', status: 'Status' }
  const row = (start, end, amount, status = 'paid') =>
    ({ __line: 2, Property: '17 Turnberry Avenue', Start: start, End: end, Amount: String(amount), Status: status })

  // The bug this exists to prevent: a tenancy cycle of 7 May - 6 Jun and an
  // accounting month of 1 - 31 May are the same rent under different bounds.
  // They are not duplicates so the unique index allows both, and both then count
  // as income.
  it('blocks a calendar month that overlaps an existing paid tenancy cycle', () => {
    const { plan } = buildRentPlan({
      rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
      existing: [{ id: 'e1', property_id: 'p1', period_start: '2026-05-07', period_end: '2026-06-06', status: 'paid', amount: 950 }],
    })
    expect(plan[0].action).toBe('error')
    expect(plan[0].errors[0]).toMatch(/Overlaps rent already recorded for 2026-05-07 to 2026-06-06/)
    expect(plan[0].errors[0]).toMatch(/count the same rent twice/)
  })

  it('allows a month that only touches the edges of neighbouring periods', () => {
    // Abutting, not overlapping: 30 April ends before 1 May begins.
    const { plan } = buildRentPlan({
      rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
      existing: [
        { id: 'e1', property_id: 'p1', period_start: '2026-04-01', period_end: '2026-04-30', status: 'paid', amount: 950 },
        { id: 'e2', property_id: 'p1', period_start: '2026-06-01', period_end: '2026-06-30', status: 'paid', amount: 950 },
      ],
    })
    expect(plan[0].action).toBe('create')
    expect(plan[0].errors).toEqual([])
  })

  it('still updates in place when the bounds match exactly', () => {
    // An exact match is an update, never an overlap error — otherwise the whole
    // point of the importer (filling blank amounts) would break.
    const { plan } = buildRentPlan({
      rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
      existing: [{ id: 'e1', property_id: 'p1', period_start: '2026-05-01', period_end: '2026-05-31', status: 'paid', amount: 500 }],
    })
    expect(plan[0].action).toBe('update')
    expect(plan[0].existingId).toBe('e1')
  })

  it('ignores overlap with a void or unpaid row', () => {
    // Those carry no income, so there is nothing to double-count. This is the
    // common case when filling a year the app had only placeholders for.
    for (const status of ['void', 'unpaid']) {
      const { plan } = buildRentPlan({
        rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
        existing: [{ id: 'e1', property_id: 'p1', period_start: '2026-05-17', period_end: '2026-06-16', status, amount: 625 }],
      })
      expect(plan[0].action, status).toBe('create')
    }
  })

  it('ignores overlap with a paid row that has no amount', () => {
    // A paid row with a NULL amount reports zero income, so it cannot be
    // double-counted — and these are exactly the rows an import exists to fix.
    const { plan } = buildRentPlan({
      rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
      existing: [{ id: 'e1', property_id: 'p1', period_start: '2026-05-17', period_end: '2026-06-16', status: 'paid', amount: null }],
    })
    expect(plan[0].action).toBe('create')
  })

  it('does not flag an overlap on a different property', () => {
    const { plan } = buildRentPlan({
      rows: [row('2026-05-01', '2026-05-31', 870.2)], columns: cols, properties: PROPS,
      existing: [{ id: 'e1', property_id: 'other', period_start: '2026-05-07', period_end: '2026-06-06', status: 'paid', amount: 950 }],
    })
    expect(plan[0].action).toBe('create')
  })
})

describe('detectColumns — an ambiguous "Notes" header', () => {
  it('maps a Notes column to notes, not description', () => {
    // Regression: 'description' listed 'notes' among its aliases and was checked
    // first, so a rent file with a Notes column showed NOTES as "not used" and
    // dropped the text, because the rent planner never reads description.
    const cols = detectColumns(['Property', 'Period Start', 'Period End', 'Amount', 'Status', 'Notes'])
    expect(cols.notes).toBe('Notes')
    expect(cols.description).toBeUndefined()
  })

  it('still maps Description and Notes separately when both exist', () => {
    const cols = detectColumns(['Property', 'Date', 'Amount', 'Description', 'Notes'])
    expect(cols.description).toBe('Description')
    expect(cols.notes).toBe('Notes')
  })

  it('keeps the other description aliases working', () => {
    for (const h of ['Description', 'Details', 'Narration', 'Memo', 'Reference']) {
      expect(detectColumns(['Property', 'Date', 'Amount', h]).description, h).toBe(h)
    }
  })

  it('carries the rent notes through to the plan', () => {
    const { plan } = buildRentPlan({
      rows: [{ __line: 2, Property: '35 Henley Road', Start: '2025-01-01', End: '2025-01-31', Amount: '635', Status: 'paid', Notes: 'Xero rental income 2025-01' }],
      columns: detectColumns(['Property', 'Start', 'End', 'Amount', 'Status', 'Notes']),
      properties: [{ id: 'p1', name: '35 Henley Road', address: '35 Henley Road, Sunderland' }],
      existing: [],
    })
    expect(plan[0].notes).toBe('Xero rental income 2025-01')
  })

  it('an expenses file with only Notes still gets a description from it', () => {
    // The reason this reorder is safe: buildExpensePlan falls back
    // description -> notes -> 'Imported expense'.
    const { plan } = buildExpensePlan({
      rows: [{ __line: 2, Property: '35 Henley Road', Date: '2025-01-14', Amount: '120.50', Category: 'Repairs', Notes: 'Boiler service' }],
      columns: detectColumns(['Property', 'Date', 'Amount', 'Category', 'Notes']),
      properties: [{ id: 'p1', name: '35 Henley Road', address: '35 Henley Road, Sunderland' }],
      existing: [],
    })
    expect(plan[0].description).toBe('Boiler service')
  })
})

describe('buildRentPlan — an update can double-count too', () => {
  const PROPS = [{ id: 'p1', name: '48 Turnberry Avenue', address: '48 Turnberry Avenue, Blyth' }]
  const cols = { property: 'Property', period_start: 'Start', period_end: 'End', amount: 'Amount', status: 'Status' }
  const row = (start, end, amount) =>
    ({ __line: 2, Property: '48 Turnberry Avenue', Start: start, End: end, Amount: String(amount), Status: 'paid' })
  const blankMonth = { id: 'month', property_id: 'p1', period_start: '2026-08-01', period_end: '2026-08-31', status: 'paid', amount: null }
  const cycle = { id: 'cycle', property_id: 'p1', period_start: '2026-07-07', period_end: '2026-08-06', status: 'paid', amount: 895 }

  it('blocks filling a blank month when another paid row covers some of it', () => {
    // The residual case the insert-only check missed: the August month exists as
    // a blank placeholder so it is an update, while a 7 Jul - 6 Aug cycle
    // already carries GBP 895 of that rent.
    const { plan } = buildRentPlan({
      rows: [row('2026-08-01', '2026-08-31', 819.82)], columns: cols, properties: PROPS,
      existing: [blankMonth, cycle],
    })
    expect(plan[0].action).toBe('error')
    expect(plan[0].errors[0]).toMatch(/double-count/)
    expect(plan[0].errors[0]).toMatch(/2026-07-07 to 2026-08-06/)
  })

  it('still fills a blank month when nothing else covers it', () => {
    // The core purpose of the importer must keep working.
    const { plan } = buildRentPlan({
      rows: [row('2026-08-01', '2026-08-31', 819.82)], columns: cols, properties: PROPS,
      existing: [blankMonth],
    })
    expect(plan[0].action).toBe('update')
    expect(plan[0].existingId).toBe('month')
  })

  it('does not treat the row being updated as its own clash', () => {
    // The matched row overlaps itself by definition; excluding it by id is what
    // stops every single update erroring.
    const { plan } = buildRentPlan({
      rows: [row('2026-08-01', '2026-08-31', 819.82)], columns: cols, properties: PROPS,
      existing: [{ ...blankMonth, amount: 500 }],
    })
    expect(plan[0].action).toBe('update')
    expect(plan[0].errors).toEqual([])
  })

  it('leaves an unchanged row as a skip, not an error', () => {
    const { plan } = buildRentPlan({
      rows: [row('2026-08-01', '2026-08-31', 819.82)], columns: cols, properties: PROPS,
      existing: [{ ...blankMonth, amount: 819.82 }, cycle],
    })
    expect(plan[0].action).toBe('skip')
  })
})
