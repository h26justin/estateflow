import { describe, it, expect } from 'vitest'
import {
  addMonths, firstPaymentDate, monthlyPayment, buildSchedule, loanStatus,
  summariseLoans, upcomingPayments, validateLoan,
} from '../externalLoans'

const base = { principal: 50000, annual_rate: 8, term_months: 24, repayment_type: 'repayment', received_date: '2026-01-15' }

describe('addMonths', () => {
  it('adds months and rolls the year', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })
  it('clamps to the end of a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
  it('returns null for a missing date', () => {
    expect(addMonths(null, 1)).toBeNull()
  })
})

describe('firstPaymentDate', () => {
  it('defaults to a month after the money arrived', () => {
    expect(firstPaymentDate(base)).toBe('2026-02-15')
  })
  it('uses an explicit first payment date', () => {
    expect(firstPaymentDate({ ...base, first_payment_date: '2026-03-01' })).toBe('2026-03-01')
  })
})

describe('monthlyPayment', () => {
  it('amortises a repayment loan', () => {
    // £50,000 at 8% over 24 months = £2,261.36 (standard annuity).
    expect(monthlyPayment(base)).toBe(2261.36)
  })
  it('splits evenly at 0%', () => {
    expect(monthlyPayment({ ...base, annual_rate: 0 })).toBe(2083.33)
  })
  it('charges interest only', () => {
    expect(monthlyPayment({ ...base, repayment_type: 'interest_only' })).toBe(333.33)
  })
  it('is zero for rolled up and for empty input', () => {
    expect(monthlyPayment({ ...base, repayment_type: 'rolled_up' })).toBe(0)
    expect(monthlyPayment({ principal: 0, term_months: 12 })).toBe(0)
  })
})

describe('buildSchedule', () => {
  it('repayment schedule clears the balance to the penny', () => {
    const rows = buildSchedule(base)
    expect(rows).toHaveLength(24)
    expect(rows[0]).toMatchObject({ period: 1, due_date: '2026-02-15', interest: 333.33 })
    expect(rows[23].balance).toBe(0)
    const capital = rows.reduce((s, r) => s + r.principal, 0)
    expect(Math.round(capital * 100) / 100).toBe(50000)
    // Every payment but the last is the regular payment.
    expect(rows.slice(0, 23).every(r => r.payment === 2261.36)).toBe(true)
    expect(Math.abs(rows[23].payment - 2261.36)).toBeLessThan(1) // penny rounding drift lands on the last payment
  })
  it('interest-only repays capital with the last payment', () => {
    const rows = buildSchedule({ ...base, repayment_type: 'interest_only', term_months: 12 })
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({ payment: 333.33, principal: 0, balance: 50000 })
    expect(rows[11]).toMatchObject({ payment: 50333.33, principal: 50000, balance: 0 })
  })
  it('rolled up is one payment of capital plus simple interest at term end', () => {
    const rows = buildSchedule({ ...base, repayment_type: 'rolled_up', term_months: 18 })
    expect(rows).toEqual([{ period: 1, due_date: '2027-07-15', payment: 56000, interest: 6000, principal: 50000, balance: 0 }])
  })
  it('is empty without a principal, term or date', () => {
    expect(buildSchedule({ ...base, principal: 0 })).toEqual([])
    expect(buildSchedule({ ...base, term_months: 0 })).toEqual([])
    expect(buildSchedule({ ...base, received_date: null })).toEqual([])
  })
})

describe('loanStatus', () => {
  const ticks = [
    { period: 1, amount: 2261.36, paid_date: '2026-02-15' },
    { period: 2, amount: 2261.36, paid_date: '2026-03-15' },
    { period: 3, amount: 2261.36, paid_date: '2026-04-15', deleted_at: '2026-04-20' },
  ]
  it('merges ticks, ignores unticked (soft-deleted) rows, flags overdue', () => {
    const s = loanStatus({ ...base, external_loan_payments: ticks }, '2026-05-01')
    expect(s.paidCount).toBe(2)
    expect(s.paidToDate).toBe(4522.72)
    expect(s.rows[2].paid).toBeNull()
    expect(s.overdueCount).toBe(1)
    expect(s.rows.filter(r => r.overdue).map(r => r.period)).toEqual([3])
    expect(s.nextDue.period).toBe(3)
    expect(s.status).toBe('overdue')
    expect(s.outstanding).toBeLessThan(50000)
    expect(s.outstanding).toBeGreaterThan(45000)
  })
  it('is repaid once every period is ticked', () => {
    const rows = buildSchedule({ ...base, term_months: 2 })
    const all = rows.map(r => ({ period: r.period, amount: r.payment }))
    const s = loanStatus({ ...base, term_months: 2, external_loan_payments: all }, '2030-01-01')
    expect(s.status).toBe('repaid')
    expect(s.outstanding).toBe(0)
    expect(s.nextDue).toBeNull()
  })
  it('reports total interest', () => {
    const s = loanStatus({ ...base, repayment_type: 'rolled_up', term_months: 12 }, '2026-01-20')
    expect(s.totalInterest).toBe(4000)
    expect(s.status).toBe('active')
  })
})

describe('summariseLoans', () => {
  it('totals running loans and skips repaid and deleted ones', () => {
    const loans = [
      { ...base, id: 'a' },
      { ...base, id: 'b', repayment_type: 'rolled_up', principal: 10000, term_months: 12 },
      { ...base, id: 'c', deleted_at: '2026-02-01' },
      { ...base, id: 'd', term_months: 1, external_loan_payments: [{ period: 1, amount: 50333.33 }] },
    ]
    const s = summariseLoans(loans, '2026-02-01')
    expect(s.count).toBe(3)
    expect(s.repaid).toBe(1)
    expect(s.active).toBe(2)
    expect(s.borrowed).toBe(60000)
    expect(s.monthlyOutgoing).toBe(2261.36) // rolled up adds nothing monthly
    expect(s.dueNext30).toBe(2261.36) // 15 Feb falls inside the window
    expect(s.overdueCount).toBe(0)
  })
})

describe('upcomingPayments', () => {
  it('lists unpaid payments across loans in date order', () => {
    const loans = [
      { ...base, id: 'a', received_date: '2026-01-20' },
      { ...base, id: 'b', received_date: '2026-01-10', external_loan_payments: [{ period: 1, amount: 1 }] },
    ]
    const list = upcomingPayments(loans, { today: '2026-01-25', limit: 3 })
    expect(list.map(x => [x.loan.id, x.row.due_date])).toEqual([
      ['a', '2026-02-20'], ['b', '2026-03-10'], ['a', '2026-03-20'],
    ])
  })
})

describe('validateLoan', () => {
  const ok = { ...base, company_id: 'co', lender_name: 'A Lender' }
  it('accepts a complete loan', () => { expect(validateLoan(ok)).toBeNull() })
  it('rejects missing pieces', () => {
    expect(validateLoan({ ...ok, company_id: '' })).toMatch(/company/)
    expect(validateLoan({ ...ok, lender_name: ' ' })).toMatch(/who/)
    expect(validateLoan({ ...ok, principal: 0 })).toMatch(/amount/)
    expect(validateLoan({ ...ok, term_months: 2.5 })).toMatch(/whole number/)
    expect(validateLoan({ ...ok, annual_rate: 120 })).toMatch(/between/)
    expect(validateLoan({ ...ok, first_payment_date: '2025-12-01' })).toMatch(/before/)
  })
})

describe('statementLines', () => {
  it('labels each line paid, overdue, due or upcoming', async () => {
    const { statementLines } = await import('../externalLoans')
    const loan = { ...base, term_months: 4, external_loan_payments: [{ period: 1, amount: 12000, paid_date: '2026-02-20' }] }
    const lines = statementLines(loan, '2026-03-20')
    expect(lines.map(l => l.status)).toEqual(['paid', 'overdue', 'due', 'upcoming'])
    expect(lines[0]).toMatchObject({ paid_date: '2026-02-20', paid_amount: 12000 })
    expect(lines[1].paid_date).toBeNull()
  })
})
