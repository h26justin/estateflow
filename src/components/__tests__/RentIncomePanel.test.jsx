import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RentIncomePanel from '../RentIncomePanel'

vi.mock('../../lib/ThemeContext', () => ({
  useTheme: () => ({ T: { card: '#fff', bg: '#f6f6f4', border: '#ddd', muted: '#777', faint: '#999', text: '#111', gold: '#b8860b', green: '#2e8b57', amber: '#d98e04', red: '#c0392b' } }),
}))

const mo = (year, month, label, expected, received, extra = {}) => ({
  year, month, key: `${year}-${month}`, label, expected, received, outstanding: Math.max(0, expected - received),
  periods: 1, needsBackfill: 0, stlReceived: 0, propertiesWithRows: 1, byCompany: {}, ...extra,
})

// Newest first, like rentMonthSnapshot.
const months = [
  mo(2026, 9, 'Sep 2026', 59914, 7705, { byCompany: { a: { expected: 33350, received: 7705 }, b: { expected: 26564, received: 0 } } }),
  mo(2026, 8, 'Aug 2026', 61376, 28273, { byCompany: { a: { expected: 33350, received: 20000 }, b: { expected: 28026, received: 8273 } } }),
  mo(2026, 7, 'Jul 2026', 63619, 49164, { needsBackfill: 2, byCompany: { a: { expected: 33350, received: 33350 }, b: { expected: 30269, received: 15814 } } }),
]
const companies = [{ id: 'a', name: 'ExH Property Group', color: '#00f' }, { id: 'b', name: 'Vale Property Group', color: '#0a0' }]

describe('RentIncomePanel', () => {
  it('renders the month rows chronologically with a year-to-date total', () => {
    render(<RentIncomePanel months={months} companies={companies} />)
    const rows = screen.getAllByRole('row').map(r => r.textContent)
    const jul = rows.findIndex(t => t.startsWith('Jul 2026'))
    const sep = rows.findIndex(t => t.startsWith('Sep 2026 (so far)'))
    expect(jul).toBeGreaterThan(0)
    expect(sep).toBeGreaterThan(jul)
    expect(rows.find(t => t.startsWith('Jul 2026'))).toContain('£63,619')
    expect(rows.find(t => t.startsWith('Jul 2026'))).toContain('£49,164')
    expect(rows.find(t => t.startsWith('Jul 2026'))).toContain('77%')
    // YTD: due 184,909, collected 85,142, outstanding 99,767, 46%
    const ytd = rows.find(t => t.startsWith('2026 to date'))
    expect(ytd).toContain('£184,909'); expect(ytd).toContain('£85,142'); expect(ytd).toContain('£99,767'); expect(ytd).toContain('46%')
  })

  it('shows the summary tiles for this month and year to date', () => {
    render(<RentIncomePanel months={months} companies={companies} />)
    expect(screen.getByText('Due · Sep 2026')).toBeTruthy()
    expect(screen.getByText('13% of what is due')).toBeTruthy()
    expect(screen.getByText('Still to collect this month')).toBeTruthy()
    expect(screen.getByText(/46% of £184,909 due · £99,767 outstanding/)).toBeTruthy()
  })

  it('lists each company with due, collected, outstanding and three months of rates', () => {
    render(<RentIncomePanel months={months} companies={companies} />)
    const rows = screen.getAllByRole('row').map(r => r.textContent)
    const vale = rows.find(t => t.includes('Vale Property Group'))
    expect(vale).toContain('£26,564')   // due Sep
    expect(vale).toContain('£0')        // collected Sep
    expect(vale).toContain('0%')        // Sep rate
    expect(vale).toContain('30%')       // Aug rate: 8273 / 28026
    expect(vale).toContain('52%')       // Jul rate: 15814 / 30269
  })

  it('footnotes months marked paid with no amount', () => {
    render(<RentIncomePanel months={months} companies={companies} />)
    expect(screen.getByText(/marked paid with no amount: Jul 2\./)).toBeTruthy()
  })

  it('opens the Rent Tracker from the header button and renders nothing without months', () => {
    const open = vi.fn()
    render(<RentIncomePanel months={months} companies={companies} onOpenRent={open} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Rent Tracker' }))
    expect(open).toHaveBeenCalled()
    const { container } = render(<RentIncomePanel months={[]} companies={companies} />)
    expect(container.innerHTML).toBe('')
  })
})
