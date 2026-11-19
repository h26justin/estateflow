import { describe, it, expect } from 'vitest'
import {
  buildDealExportModel, buildDealRow, dealsToCsv, costLinesToCsv, describeFilters, exportFileName,
  modelGroups, normaliseAsOf, DEALS_CSV_HEADERS, COST_LINES_CSV_HEADERS,
} from '../dealExport'
import { companyFunding, dealCashNeed, refurbPosition } from '../dealFinance'
import { toCsv } from '../csv'

const line = (deal_id, category, amount, state = 'confirmed', extra = {}) => ({ id: `${deal_id}-${category}-${amount}`, deal_id, category, amount, state, ...extra })

// Contact-style fields a deal row could carry; none may reach an export.
const CONTACTY = {
  solicitor_name: 'Sam Solicitor', solicitor_email: 'sam@law.example', solicitor_phone: '0100 000000',
  vendor_name: 'Val Vendor', agent_email: 'agent@example.test', notes: 'Call Sam on 0100 000000',
}

const companies = [
  { id: 'c1', name: 'Alpha Homes Ltd', abbr: 'AH', color: '#3b4a3f' },
  { id: 'c2', name: 'Beta Lets Ltd', abbr: 'BL' },
]
const deals = [
  { id: 'd1', name: 'Park Row', company_id: 'c1', status: 'conveyancing', purchase_price: 15000, expected_completion_date: '2026-11-27',
    attention_status: 'awaiting_response', next_action: 'Chase searches', next_action_owner: 'Tiffany', next_action_due: '2026-11-21', ...CONTACTY },
  { id: 'd2', name: 'Douro Terrace', company_id: 'c1', status: 'exchanged', purchase_price: 150000, legal_fees: 1500, refurb_cost: 12000,
    target_completion_date: '2026-12-10', ...CONTACTY },
  { id: 'd3', name: 'Fallen Lane', company_id: 'c1', status: 'dead', purchase_price: 90000, expected_completion_date: '2026-11-30' },
  { id: 'd4', name: 'Trashed Street', company_id: 'c1', status: 'offer_made', purchase_price: 50000, deleted_at: '2026-11-01T00:00:00Z' },
  { id: 'd5', name: 'Beta One', company_id: 'c2', status: 'under_offer', purchase_price: 80000 },
  { id: 'd6', name: 'No Company Close', company_id: null, status: 'analysing', purchase_price: 60000, expected_completion_date: '2027-01-15' },
  { id: 'd7', name: 'Unknown Price', company_id: 'c2', status: 'analysing' },
]
const linesByDeal = {
  d1: [
    line('d1', 'purchase_price', 15000), line('d1', 'sdlt', 750), line('d1', 'legal_fee', 900, 'quoted', { notes: 'Ring Sam on 0100 000000', source: 'Solicitor quote' }),
    line('d1', 'legal_vat', 180, 'quoted'), line('d1', 'searches', 159), line('d1', 'land_registry', 50), line('d1', 'on_account', 300, 'paid'),
    line('d1', 'refurb', 4000, 'estimate'),
  ],
  d3: [line('d3', 'purchase_price', 90000)],
}
const fundingByDeal = {
  d1: [{ id: 'f1', deal_id: 'd1', source: 'mortgage', amount: 10000, state: 'confirmed', notes: 'Broker Bob 07700 900000' },
    { id: 'f2', deal_id: 'd1', source: 'investor', amount: 2000, state: 'expected' }],
  d2: [{ id: 'f3', deal_id: 'd2', source: 'company_cash', amount: 50000, state: 'confirmed' }],
}
const cashByCompany = {
  c1: [{ company_id: 'c1', as_of: '2026-11-10', amount: 20000, created_at: 'a' }, { company_id: 'c1', as_of: '2026-11-18', amount: 30000, created_at: 'b' }],
  c2: { company_id: 'c2', as_of: '2026-11-15', amount: 5000 },
}
const asOf = new Date('2026-11-19T14:05:00Z')
const filters = { companyId: 'all', status: 'all' }

const build = (over = {}) => buildDealExportModel({ deals, companies, linesByDeal, fundingByDeal, cashByCompany, asOf, filters, ...over })
const group = (model, id) => modelGroups(model).find(g => g.company.id === id)

describe('buildDealExportModel', () => {
  it('carries the as-of time and the filters in words', () => {
    const m = build()
    expect(m.asOf).toBe('2026-11-19T14:05:00.000Z')
    expect(m.asOfDate).toBe('2026-11-19')
    expect(m.asOfLabel).toMatch(/19 Nov 2026/)
    expect(m.filters.labels).toEqual(['Company: All companies', 'Stage: All stages'])
    expect(m.filters.text).toContain('Company: All companies')
  })

  it('company totals are companyFunding results, unchanged', () => {
    const m = build()
    for (const c of companies) {
      const g = group(m, c.id)
      const cash = Array.isArray(cashByCompany[c.id]) ? cashByCompany[c.id][1] : cashByCompany[c.id]
      const f = companyFunding({ deals: deals.filter(d => d.company_id === c.id), linesByDeal, fundingByDeal, cashPosition: cash, from: '2026-11-19' })
      expect(g.funding).toEqual(f)
      expect(g.totals.cashNeed).toBe(f.needInWindow)
      expect(g.totals.fundingGap).toBe(f.fundingGap)
      expect(g.totals.combinedGap).toBe(f.combinedGap)
      expect(g.totals.refurbForecast).toBe(f.refurbForecast)
      expect(g.totals.unknownCount).toBe(f.unknownCount)
      expect(g.totals.cash).toBe(f.cash.amount)
    }
    // c1 uses its latest cash position (18 Nov, £30,000), counted once.
    expect(group(m, 'c1').totals.cash).toBe(30000)
  })

  it('deal rows equal dealCashNeed / refurbPosition for the same inputs', () => {
    const m = build()
    for (const g of modelGroups(m)) {
      for (const r of g.deals) {
        const d = deals.find(x => x.id === r.id)
        const cn = dealCashNeed(d, linesByDeal[d.id] || [], fundingByDeal[d.id] || [])
        expect(r.cashNeed).toBe(cn.need)
        expect(r.balanceDue).toBe(cn.position.balanceDue)
        expect(r.completionTotal).toBe(cn.position.total)
        expect(r.credits).toBe(cn.position.credits)
        expect(r.financingConfirmed).toBe(cn.financingConfirmed)
        expect(r.financingExpected).toBe(cn.financingExpected)
        expect(r.refurbForecast).toBe(refurbPosition(d, linesByDeal[d.id] || []).amount)
      }
    }
    const park = group(m, 'c1').deals.find(r => r.id === 'd1')
    expect(park).toMatchObject({ completionTotal: 17039, credits: 300, balanceDue: 16739, financingConfirmed: 10000, financingExpected: 2000, cashNeed: 6739, refurbForecast: 4000, basis: 'lines', state: 'quoted' })
    expect(park).toMatchObject({ stage: 'Conveyancing', attention: 'Awaiting response', nextAction: 'Chase searches', nextActionOwner: 'Tiffany', nextActionDue: '2026-11-21', expectedCompletion: '2026-11-27', price: 15000 })
  })

  it('All Deals totals add the per-company results (gap summed per company)', () => {
    const m = build()
    const gs = modelGroups(m)
    const add = k => Math.round(gs.reduce((s, g) => s + Math.round(g.totals[k] * 100), 0)) / 100
    expect(m.totals.cashNeed).toBe(add('cashNeed'))
    expect(m.totals.fundingGap).toBe(add('fundingGap'))
    expect(m.totals.refurbForecast).toBe(add('refurbForecast'))
    expect(m.totals.balanceDue).toBe(add('balanceDue'))
    expect(m.totals.cash).toBe(35000)
    expect(m.totals.deals).toBe(deals.length)
  })

  it('includes deals with no company in Unassigned, with no cash', () => {
    const m = build()
    expect(m.unassigned).toBeTruthy()
    expect(m.unassigned.deals.map(r => r.id)).toEqual(['d6'])
    expect(m.unassigned.funding.cash).toBeNull()
    expect(m.unassigned.totals.cashNeed).toBe(m.unassigned.deals[0].cashNeed)
    expect(m.unassigned.totals.cashNeed).toBeGreaterThan(0)
    expect(m.unassigned.funding.fundingGap).toBe(m.unassigned.totals.cashNeed)
    expect(m.dataQuality.join('\n')).toMatch(/no company/)
    // A deal whose company is not in the list is not dropped either.
    const stray = buildDealExportModel({ deals: [{ id: 'x', name: 'Stray', company_id: 'gone', status: 'analysing', purchase_price: 1000 }], companies, asOf })
    expect(stray.unassigned.deals.map(r => r.id)).toEqual(['x'])
  })

  it('lists dead and deleted deals when filters include them but never counts them', () => {
    const m = build()
    const c1 = group(m, 'c1')
    const ids = c1.deals.map(r => r.id)
    expect(ids).toEqual(expect.arrayContaining(['d3', 'd4']))
    const fallen = c1.deals.find(r => r.id === 'd3')
    const trashed = c1.deals.find(r => r.id === 'd4')
    expect(fallen).toMatchObject({ countsInFunding: false, excludedReason: 'Fallen through' })
    expect(trashed).toMatchObject({ countsInFunding: false, excludedReason: 'Deleted' })
    expect(c1.funding.rows.map(r => r.dealId)).not.toContain('d3')
    expect(c1.funding.rows.map(r => r.dealId)).not.toContain('d4')
    expect(c1.totals.liveDeals).toBe(2)
    expect(c1.totals.excludedDeals).toBe(2)
    // Totals are the same as if the excluded deals were never passed in.
    const without = build({ deals: deals.filter(d => d.id !== 'd3' && d.id !== 'd4') })
    expect(group(without, 'c1').totals.cashNeed).toBe(c1.totals.cashNeed)
    expect(group(without, 'c1').totals.balanceDue).toBe(c1.totals.balanceDue)
    expect(without.totals.fundingGap).toBe(m.totals.fundingGap)
  })

  it('counts unknown need as unknown, not £0', () => {
    const r = group(build(), 'c2').deals.find(x => x.id === 'd7')
    expect(r.cashNeed).toBeNull()
    expect(r.missing).toContain('Purchase price not entered')
    expect(group(build(), 'c2').totals.unknownCount).toBe(1)
  })

  it('never includes contact fields or notes', () => {
    const json = JSON.stringify(build())
    for (const v of ['Sam Solicitor', 'sam@law.example', '0100 000000', 'Val Vendor', 'agent@example.test', '07700 900000', 'Broker Bob']) {
      expect(json).not.toContain(v)
    }
    for (const k of ['solicitor_name', 'solicitor_email', 'vendor_name', 'agent_email', 'notes']) expect(json).not.toContain(`"${k}"`)
    const row = buildDealRow(deals[0], { lines: linesByDeal.d1, funding: fundingByDeal.d1 })
    expect(Object.keys(row).some(k => /contact|solicitor|email|phone|vendor|notes/i.test(k))).toBe(false)
  })

  it('has methodology and data-quality text', () => {
    const m = build()
    expect(m.methodology.length).toBeGreaterThan(5)
    expect(m.methodology.join(' ')).toMatch(/Funding gap/)
    expect(m.dataQuality.join('\n')).toMatch(/Douro Terrace.*No completion statement entered/)
    expect(m.dataQuality.join('\n')).toMatch(/Beta Lets Ltd|Unknown Price/)
  })
})

describe('dealsToCsv', () => {
  const m = build()
  const rows = dealsToCsv(m)
  const col = name => DEALS_CSV_HEADERS.indexOf(name)

  it('one header row then one row per deal', () => {
    expect(rows[0]).toEqual(DEALS_CSV_HEADERS)
    expect(rows.length).toBe(1 + deals.length)
    expect(rows.every(r => r.length === DEALS_CSV_HEADERS.length)).toBe(true)
  })

  it('GBP as plain numbers and ISO dates', () => {
    const park = rows.find(r => r[col('deal')] === 'Park Row')
    expect(park[col('balance_due_gbp')]).toBe('16739.00')
    expect(park[col('cash_need_gbp')]).toBe('6739.00')
    expect(park[col('expected_completion')]).toBe('2026-11-27')
    expect(park[col('as_of')]).toBe('2026-11-19T14:05:00.000Z')
    expect(rows.find(r => r[col('deal')] === 'Unknown Price')[col('cash_need_gbp')]).toBe('')
  })

  it('counted rows add up to the model totals', () => {
    const counted = rows.slice(1).filter(r => r[col('counts_in_funding')] === 'yes')
    const add = name => Math.round(counted.reduce((s, r) => s + Math.round(Number(r[col(name)] || 0) * 100), 0)) / 100
    expect(add('cash_need_gbp')).toBe(m.totals.cashNeed)
    expect(add('balance_due_gbp')).toBe(m.totals.balanceDue)
    expect(add('refurb_forecast_gbp')).toBe(m.totals.refurbForecast)
    expect(rows.find(r => r[col('deal')] === 'No Company Close')[col('company')]).toBe('Unassigned')
    expect(rows.find(r => r[col('deal')] === 'Fallen Lane')[col('excluded_reason')]).toBe('Fallen through')
  })

  it('contains no contact details', () => {
    const csv = toCsv(rows)
    expect(csv).not.toMatch(/Sam Solicitor|sam@law|0100 000000|Val Vendor|Broker Bob/)
    expect(rows[0].join(',')).not.toMatch(/solicitor|email|phone|contact|notes/)
  })
})

describe('costLinesToCsv', () => {
  const m = build()
  const rows = costLinesToCsv(m)
  const col = name => COST_LINES_CSV_HEADERS.indexOf(name)

  it('lists every cost line and funding row with deal and company', () => {
    expect(rows[0]).toEqual(COST_LINES_CSV_HEADERS)
    const park = rows.filter(r => r[col('deal')] === 'Park Row')
    expect(park.filter(r => r[col('record_type')] === 'Cost line')).toHaveLength(linesByDeal.d1.length)
    expect(park.filter(r => r[col('record_type')] === 'Funding')).toHaveLength(2)
    expect(park.every(r => r[col('company')] === 'Alpha Homes Ltd')).toBe(true)
  })

  it('lets a reader rebuild each balance due and cash need', () => {
    for (const g of modelGroups(m)) {
      for (const r of g.deals) {
        if (r.balanceDue == null) continue
        const mine = rows.filter(x => x[col('deal')] === r.name)
        const p = t => Math.round(Number(t[col('amount_gbp')]) * 100)
        const comp = mine.filter(x => x[col('counts_towards')] === 'Completion').reduce((s, x) => s + p(x), 0)
        const cred = mine.filter(x => x[col('counts_towards')] === 'Credit (deducted)').reduce((s, x) => s + p(x), 0)
        expect((comp - cred) / 100).toBe(r.balanceDue)
        const fin = mine.filter(x => x[col('deducted_from_cash_need')] === 'yes').reduce((s, x) => s + p(x), 0)
        expect(Math.max(0, comp - cred - fin) / 100).toBe(r.cashNeed)
      }
    }
  })

  it('leaves out notes', () => {
    expect(toCsv(rows)).not.toMatch(/Ring Sam|0100 000000|Broker Bob|07700/)
  })
})

describe('helpers', () => {
  it('describeFilters names the company and stage', () => {
    expect(describeFilters({ companyId: 'c2', status: 'dead' }, companies)).toEqual(['Company: Beta Lets Ltd', 'Stage: Fallen through'])
    expect(describeFilters({ companyId: '' }, companies)[0]).toBe('Company: Unassigned')
  })
  it('file names carry the scope and as-of date', () => {
    expect(exportFileName(build(), 'deals', 'csv')).toBe('deals-all-deals-2026-11-19.csv')
    const one = build({ deals: deals.filter(d => d.company_id === 'c2'), filters: { companyId: 'c2', status: 'all' } })
    expect(exportFileName(one, 'deals-funding', 'pdf')).toBe('deals-funding-beta-lets-ltd-2026-11-19.pdf')
  })
  it('a bare ISO date as-of is that day', () => {
    expect(normaliseAsOf('2026-11-19')).toMatchObject({ date: '2026-11-19', iso: '2026-11-19' })
  })
})
