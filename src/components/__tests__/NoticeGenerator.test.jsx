import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NoticeGenerator from '../NoticeGenerator'

vi.mock('../../lib/ThemeContext', () => ({
  useTheme: () => ({ T: { card: '#fff', bg: '#f6f6f4', border: '#ddd', muted: '#666', text: '#111', gold: '#b8860b', goldText: '#7a5a00', green: '#2e8b57', amber: '#d98e04', red: '#c0392b' } }),
}))
vi.mock('../../lib/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../lib/api', () => ({ saveNotice: vi.fn(async () => ({})) }))

const property = {
  id: 'p1', address: '1 High St', rent_pcm: 1000,
  tenancies: [{ tenancy_start: '2024-01-01', status: 'active', tenant_name: 'A Tenant', rent_amount: 1000, rent_frequency: 'monthly', rent_due_day: 1 }],
}

function toForm(answerAll = true) {
  fireEvent.click(screen.getByRole('button', { name: /I understand/ }))
  if (answerAll) screen.getAllByRole('button', { name: 'Yes' }).forEach(b => fireEvent.click(b))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to form' }))
}

describe('NoticeGenerator', () => {
  beforeEach(() => localStorage.clear())

  it('never offers section 21', () => {
    render(<NoticeGenerator property={property} userId="u" onClose={() => {}} />)
    toForm()
    expect(screen.queryByText(/Section 21/)).toBeNull()
    expect(screen.getByText(/Form 3A content/)).toBeTruthy()
    expect(screen.getByText(/Ground 8 — Serious rent arrears/)).toBeTruthy()
  })

  it('works out the earliest date from the grounds chosen', () => {
    render(<NoticeGenerator property={property} userId="u" onClose={() => {}} />)
    toForm()
    fireEvent.change(screen.getByLabelText('Date notice will be served'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Ground 8 — Serious rent arrears/ }))
    expect(screen.getByLabelText('Earliest date proceedings can begin').value).toBe('2026-11-30')
    fireEvent.click(screen.getByRole('checkbox', { name: /Ground 1A — Sale of the property/ }))
    expect(screen.getByLabelText('Earliest date proceedings can begin').value).toBe('2027-03-02')
  })

  it('flags Ground 8 arrears below the threshold', () => {
    render(<NoticeGenerator property={property} userId="u" onClose={() => {}} />)
    toForm()
    fireEvent.change(screen.getByLabelText('Date notice will be served'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Ground 8 — Serious rent arrears/ }))
    fireEvent.change(screen.getByLabelText('Rent arrears today'), { target: { value: '1500' } })
    expect(screen.getByText(/Ground 8 needs at least 3 months/)).toBeTruthy()
  })

  it('section 13 mode prepares Form 4A and enforces two months notice', () => {
    render(<NoticeGenerator initialType="s13" property={property} userId="u" onClose={() => {}} />)
    toForm()
    expect(screen.getByText(/Form 4A content/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Date notice will be served'), { target: { value: '2026-11-01' } })
    expect(screen.getByLabelText('New rent starts').value).toBe('2027-01-01')
    fireEvent.change(screen.getByLabelText('New rent starts'), { target: { value: '2026-12-01' } })
    expect(screen.getByText(/cannot start before 2027-01-01/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Print/ }).disabled).toBe(true)
  })
})
