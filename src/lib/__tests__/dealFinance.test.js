import { describe, it, expect } from 'vitest'
import {
  completionPosition, refurbPosition, dealCashNeed, companyFunding, explainDeal,
  weakestState, weekStart, latestCashPosition, isLiveDeal, gbp, dateGB, costCategoryGroup,
} from '../dealFinance'
import { computeDealMetrics } from '../dealMetrics'

const line = (category, amount, state = 'confirmed', extra = {}) => ({ category, amount, state, ...extra })

describe('completionPosition', () => {
  it('Park Row: £17,039 of completion lines less £300 on account = £16,739', () => {
    const lines = [
      line('purchase_price', 15000),
      line('sdlt', 750),
      line('legal_fee', 900, 'quoted'),
      line('legal_vat', 180, 'quoted'),
      line('searches', 159),
      line('land_registry', 50),
      line('on_account', 300, 'paid'),
    ]
    const p = completionPosition({ purchase_price: 15000 }, lines)
    expect(p.total).toBe(17039)
    expect(p.credits).toBe(300)
    expect(p.balanceDue).toBe(16739)
    expect(p.basis).toBe('lines')
    expect(p.state).toBe('quoted')
    expect(p.missing).toEqual([])
  })

  it('Douro Terrace: £153,838 − £150 = £153,688', () => {
    const p = completionPosition({}, [line('purchase_price', 150000), line('sdlt', 2500), line('legal_fee', 1338), line('on_account', 150, 'paid')])
    expect(p.total).toBe(153838)
    expect(p.balanceDue).toBe(153688)
  })

  it('Offerton: a single estimate line is not labelled a solicitor fee', () => {
    const deal = { purchase_price: 55000 }
    const p = completionPosition(deal, [line('other_purchase', 60250, 'estimate', { label: 'Forecast completion' })])
    expect(p.total).toBe(60250)
    expect(p.balanceDue).toBe(60250)
    expect(p.state).toBe('estimate')
    expect(p.components.map(c => c.key)).toEqual(['other_purchase'])
    expect(p.components.some(c => /legal|solicitor/i.test(c.label))).toBe(false)
  })

  it('excludes refurb, contingency and other lines from completion', () => {
    const p = completionPosition({}, [line('purchase_price', 100000), line('refurb', 20000), line('contingency', 2000), line('other', 500)])
    expect(p.total).toBe(100000)
    expect(p.balanceDue).toBe(100000)
  })

  it('takes the weakest state across included lines', () => {
    expect(weakestState([line('a', 1, 'paid'), line('b', 1, 'confirmed')])).toBe('confirmed')
    expect(weakestState([line('a', 1, 'actual'), line('b', 1, 'quoted'), line('c', 1, 'estimate')])).toBe('estimate')
    const p = completionPosition({}, [line('purchase_price', 1000, 'paid'), line('sdlt', 10, 'actual')])
    expect(['paid', 'actual']).toContain(p.state)
  })

  it('sums in pence without float drift', () => {
    const p = completionPosition({}, [line('searches', 0.1), line('land_registry', 0.2)])
    expect(p.total).toBe(0.3)
  })

  it('falls back to the flat-field estimate without lines, excluding refurb', () => {
    const deal = { purchase_price: 200000, legal_fees: 1500, survey_cost: 600, broker_fee: 500, auction_fees: 0, other_costs: 400, refurb_cost: 30000, is_additional_property: true }
    const m = computeDealMetrics(deal)
    const p = completionPosition(deal, [])
    expect(p.basis).toBe('estimate')
    expect(p.state).toBe('estimate')
    expect(p.total).toBe(200000 + m.sd + 1500 + 600 + 500 + 400)
    expect(p.balanceDue).toBe(p.total)
    expect(p.missing).toContain('No completion statement entered')
  })

  it('unknown is not zero: no price and no lines gives null and a reason', () => {
    const p = completionPosition({}, [])
    expect(p.balanceDue).toBeNull()
    expect(p.total).toBeNull()
    expect(p.missing).toContain('Purchase price not entered')
  })

  it('ignores refurb-only lines for completion and keeps the estimate', () => {
    const p = completionPosition({ purchase_price: 100000 }, [line('refurb', 5000)])
    expect(p.basis).toBe('estimate')
  })

  it('groups categories', () => {
    expect(costCategoryGroup('deposit_paid')).toBe('credit')
    expect(costCategoryGroup('contingency')).toBe('refurb')
    expect(costCategoryGroup('nonsense')).toBe('other')
  })
})

describe('refurbPosition', () => {
  it('uses refurb and contingency lines', () => {
    const r = refurbPosition({ refurb_cost: 99999 }, [line('refurb', 35000, 'quoted'), line('contingency', 5000, 'estimate'), line('purchase_price', 1)])
    expect(r.amount).toBe(40000)
    expect(r.basis).toBe('lines')
    expect(r.state).toBe('estimate')
  })
  it('falls back to deal.refurb_cost as an estimate', () => {
    const r = refurbPosition({ refurb_cost: 12000 }, [])
    expect(r).toMatchObject({ amount: 12000, basis: 'estimate', state: 'estimate' })
  })
  it('is null when nothing is entered', () => {
    expect(refurbPosition({}, []).amount).toBeNull()
  })
})

describe('dealCashNeed', () => {
  const lines = [line('purchase_price', 100000), line('sdlt', 3000), line('deposit_paid', 10000, 'paid')]
  it('deducts confirmed and received financing only, not company cash', () => {
    const funding = [
      { source: 'mortgage', amount: 60000, state: 'confirmed' },
      { source: 'investor', amount: 5000, state: 'received' },
      { source: 'bridge', amount: 20000, state: 'expected' },
      { source: 'company_cash', amount: 38000, state: 'confirmed' },
    ]
    const cn = dealCashNeed({ expected_completion_date: '2026-12-04', target_completion_date: '2026-12-20' }, lines, funding)
    expect(cn.position.balanceDue).toBe(93000)
    expect(cn.financingConfirmed).toBe(65000)
    expect(cn.financingExpected).toBe(20000)
    expect(cn.need).toBe(28000)
    expect(cn.dueDate).toBe('2026-12-04')
  })
  it('uses the target date when there is no expected date, else null', () => {
    expect(dealCashNeed({ target_completion_date: '2027-01-08' }, lines, []).dueDate).toBe('2027-01-08')
    expect(dealCashNeed({}, lines, []).dueDate).toBeNull()
  })
  it('never goes below zero and stays null when unknown', () => {
    expect(dealCashNeed({}, lines, [{ source: 'mortgage', amount: 500000, state: 'confirmed' }]).need).toBe(0)
    expect(dealCashNeed({}, [], []).need).toBeNull()
  })
  it('explains with substituted numbers', () => {
    const text = explainDeal({}, lines, [{ source: 'mortgage', amount: 60000, state: 'confirmed' }]).join('\n')
    expect(text).toContain('£93,000')
    expect(text).toContain('£33,000')
    expect(text).toContain('Unscheduled'.toLowerCase())
  })
})

describe('companyFunding', () => {
  // WXH fixture from the brief: four completions, £130,000 cash.
  const wxhDeals = [
    { id: 'a', name: 'A', status: 'conveyancing', expected_completion_date: '2026-11-27' },
    { id: 'b', name: 'B', status: 'exchanged', expected_completion_date: '2026-12-04' },
    { id: 'c', name: 'C', status: 'under_offer', target_completion_date: '2026-12-02' },
    { id: 'd', name: 'D', status: 'ready_to_exchange', expected_completion_date: '2027-01-15' },
    { id: 'dead', name: 'Dead', status: 'dead', purchase_price: 500000 },
    { id: 'done', name: 'Done', status: 'completed', purchase_price: 500000 },
    { id: 'del', name: 'Deleted', status: 'analysing', purchase_price: 500000, deleted_at: '2026-11-01T00:00:00Z' },
  ]
  const linesByDeal = {
    a: [line('other_purchase', 325400, 'estimate'), line('refurb', 40000, 'estimate')],
    b: [line('other_purchase', 86450)],
    c: [line('other_purchase', 60250, 'estimate')],
    d: [line('other_purchase', 168525), line('refurb', 150000, 'quoted')],
  }
  const cashPosition = { amount: 130000, as_of: '2026-11-18', created_at: '2026-11-18T10:00:00Z' }

  it('WXH: £640,625 need, £130,000 cash, gap £510,625; with refurb £700,625', () => {
    const f = companyFunding({ deals: wxhDeals, linesByDeal, fundingByDeal: {}, cashPosition, from: '2026-11-19' })
    expect(f.activeDeals).toBe(4)
    expect(f.rows.map(r => r.need)).toEqual([325400, 60250, 86450, 168525])
    expect(f.needInWindow).toBe(640625)
    expect(f.cash.amount).toBe(130000)
    expect(f.fundingGap).toBe(510625)
    expect(f.refurbForecast).toBe(190000)
    expect(f.combinedGap).toBe(700625)
    const text = f.explain.join('\n')
    expect(text).toContain('£325,400 + £60,250 + £86,450 + £168,525 = £640,625')
    expect(text).toContain('max(0, £640,625 − £130,000) = £510,625')
    expect(text).toContain('= £700,625')
  })

  it('buckets by Monday-start week with a running shortfall', () => {
    const f = companyFunding({ deals: wxhDeals, linesByDeal, cashPosition, from: '2026-11-19' })
    expect(f.weeks.map(w => w.week)).toEqual(['2026-11-23', '2026-11-30', '2027-01-11'])
    expect(f.weeks[1]).toMatchObject({ need: 146700, deals: ['c', 'b'], weekEnd: '2026-12-06' })
    expect(f.weeks[1].cumulative).toBe(472100)
    expect(f.weeks[1].shortfall).toBe(342100)
  })

  it('limits the window with `to` and reports unscheduled separately', () => {
    const deals = [...wxhDeals, { id: 'u', name: 'U', status: 'analysing', purchase_price: 0 }, { id: 'u2', name: 'U2', status: 'analysing' }]
    const lines = { ...linesByDeal, u: [line('other_purchase', 1000)] }
    const f = companyFunding({ deals, linesByDeal: lines, cashPosition, from: '2026-11-19', to: '2026-12-19' })
    expect(f.needInWindow).toBe(325400 + 86450 + 60250)
    expect(f.fundingGap).toBe(325400 + 86450 + 60250 - 130000)
    expect(f.unscheduled.deals).toEqual(['u', 'u2'])
    expect(f.unscheduled.need).toBe(1000)
    expect(f.unscheduled.unknownCount).toBe(1)
  })

  it('counts cash once and treats a missing position as £0 with a note', () => {
    const f = companyFunding({ deals: wxhDeals, linesByDeal, cashPosition: null })
    expect(f.cash).toBeNull()
    expect(f.fundingGap).toBe(640625)
    expect(f.explain.join('\n')).toContain('not entered')
  })

  it('reports unknown needs instead of counting them as zero', () => {
    const f = companyFunding({ deals: [{ id: 'x', status: 'analysing', expected_completion_date: '2026-12-01' }], cashPosition })
    expect(f.unknownCount).toBe(1)
    expect(f.needInWindow).toBe(0)
    expect(f.weeks[0].unknownCount).toBe(1)
  })

  it('flags overdue completions', () => {
    const f = companyFunding({ deals: wxhDeals, linesByDeal, from: '2026-12-01' })
    expect(f.rows.find(r => r.dealId === 'a').overdue).toBe(true)
    expect(f.weeks[0].overdue).toBe(true)
  })
})

describe('helpers', () => {
  it('weekStart is the Monday', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-16') // Thursday
    expect(weekStart('2026-11-16')).toBe('2026-11-16') // Monday
    expect(weekStart('2026-11-22')).toBe('2026-11-16') // Sunday
    expect(weekStart(null)).toBeNull()
  })
  it('latest cash position by as_of then created_at', () => {
    const rows = [
      { id: 1, as_of: '2026-11-10', created_at: '2026-11-10T09:00:00Z' },
      { id: 2, as_of: '2026-11-18', created_at: '2026-11-18T09:00:00Z' },
      { id: 3, as_of: '2026-11-18', created_at: '2026-11-18T12:00:00Z' },
      { id: 4, as_of: '2026-11-01', created_at: '2026-11-19T12:00:00Z' },
    ]
    expect(latestCashPosition(rows).id).toBe(3)
    expect(latestCashPosition([])).toBeNull()
  })
  it('live deals', () => {
    expect(isLiveDeal({ status: 'exchanged' })).toBe(true)
    expect(isLiveDeal({ status: 'let' })).toBe(false)
    expect(isLiveDeal({ status: 'dead' })).toBe(false)
  })
  it('formats GBP and en-GB dates', () => {
    expect(gbp(16739)).toBe('£16,739')
    expect(gbp(12.5)).toBe('£12.50')
    expect(gbp(null)).toBe('—')
    expect(dateGB('2026-11-18')).toBe('18 Nov 2026')
  })
})
