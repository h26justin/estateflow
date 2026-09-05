import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import ShortTermLetIncomePage from '../ShortTermLetIncomePage'

// Fixtures are hoisted because vi.mock is: the factory below reads them.
const { bookings, TODAY } = vi.hoisted(() => {
  // Dates relative to today so the default "This month" period always holds the
  // fixtures, and the forward-look strip has someone in house tonight.
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const rel = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return iso(d) }
  const TODAY = rel(0)
  const monthStart = TODAY.slice(0, 7) + '-01'

  const bookings = [
    // in house tonight: arrived yesterday, leaves tomorrow
    { id: 'b1', property_id: 'p1', provider: 'hostaway', source: 'Airbnb', status: 'new', guest_name: 'Ada Lovelace', arrival: rel(-1), departure: rel(1), total_amount: 200, channel_commission: 30, hostaway_listing_id: 11, hostaway_reservation_id: 501, payment_status: 'Paid' },
    // arrives in three days, Booking.com, fee not yet invoiced (estimated)
    { id: 'b2', property_id: 'p2', provider: 'hostaway', source: 'Booking.com', status: 'new', guest_name: 'Brian Kernighan', arrival: rel(3), departure: rel(5), total_amount: 140, channel_commission: null, hostaway_listing_id: 22, hostaway_reservation_id: 502, payment_status: 'Paid' },
    // an enquiry, never revenue
    { id: 'b3', property_id: 'p1', provider: 'hostaway', source: 'Airbnb', status: 'inquiry', guest_name: 'Nobody', arrival: rel(10), departure: rel(12), total_amount: 90, hostaway_listing_id: 11, hostaway_reservation_id: 503 },
    // earlier this month so the month table and payout have something (kept inside the month)
    { id: 'b4', property_id: 'p1', provider: 'hostaway', source: 'Booking.com', status: 'new', guest_name: 'Grace Hopper', arrival: monthStart, departure: monthStart.slice(0, 8) + '03', total_amount: 130, channel_commission: 19.5, hostaway_listing_id: 11, hostaway_reservation_id: 504, payment_status: 'Paid' },
  ]
  return { bookings, TODAY }
})

vi.mock('../../lib/api', () => ({
  fetchStlIncomeBookings: vi.fn().mockResolvedValue(bookings),
  fetchStlAdjustments: vi.fn().mockResolvedValue([]),
  fetchHostawayMappings: vi.fn().mockResolvedValue([
    { id: 'm11', property_id: 'p1', hostaway_listing_id: 11, hostaway_listing_name: 'Studio - 1' },
    { id: 'm22', property_id: 'p2', hostaway_listing_id: 22, hostaway_listing_name: 'Studio - 2' },
  ]),
  fetchStlManagers: vi.fn().mockResolvedValue([
    { id: 'mgr1', company_id: 'cA', name: 'Stacey', percentage: 12, basis: 'net_after_platform_fees', payout_frequency: 'fortnightly', active: true, notes: null },
  ]),
  fetchStlPayouts: vi.fn().mockResolvedValue([]),
  fetchHostawayConnections: vi.fn().mockResolvedValue([
    { id: 'hc1', company_id: 'cA', status: 'connected', last_synced_at: new Date().toISOString(), last_sync_status: 'ok', last_sync_error: null },
  ]),
  createStlPayout: vi.fn(), deleteStlPayout: vi.fn(),
  createStlAdjustment: vi.fn(), deleteStlAdjustment: vi.fn(),
  createStlManager: vi.fn(), updateStlManager: vi.fn(), deleteStlManager: vi.fn(), setPropertyStlManager: vi.fn(),
}))

const companies = [{ id: 'cA', name: 'Alpha Lets Ltd', abbr: 'ALPHA' }]
const properties = [
  { id: 'p1', name: 'Room 1, Test House', address: '1 Test St', company_id: 'cA', status: 'short_term_let', stl_manager_id: 'mgr1' },
  { id: 'p2', name: 'Room 2, Test House', address: '1 Test St', company_id: 'cA', status: 'short_term_let', stl_manager_id: 'mgr1' },
  // still in refurb: no listing, no bookings, so it must read as "not open" and stay out of occupancy
  { id: 'p3', name: 'Room 3, Test House', address: '1 Test St', company_id: 'cA', status: 'short_term_let', stl_manager_id: 'mgr1' },
  { id: 'p9', name: 'Ordinary flat', address: '9 Other Rd', company_id: 'cA', status: 'rented' },
]

function renderPage() {
  return render(
    <ThemeProvider><ConfirmProvider>
      <ShortTermLetIncomePage companies={companies} properties={properties} permissionsMap={{}} devModeActive={true} showToast={() => {}} openDetail={() => {}} onPropertyUpdated={() => {}} />
    </ConfirmProvider></ThemeProvider>
  )
}

// The by-room card: heading label -> header row -> card. Room names also appear
// in the manager assignment list and the property dropdown, so scope to it.
const byRoomCard = async () => (await screen.findByText(/By room ·/)).parentElement.parentElement

describe('Short-Term Let Income page', () => {
  it('renders the new sections once the data lands', async () => {
    renderPage()
    // by-room table with the refurb room marked not open, and sortable headings
    const card = await byRoomCard()
    expect(within(card).getByText('Room 3, Test House')).toBeInTheDocument()
    expect(within(card).getByText('not open')).toBeInTheDocument()
    // ADR / RevPAR appear as tiles and as table headings
    expect(screen.getAllByText('ADR').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('RevPAR').length).toBeGreaterThanOrEqual(2)
    // forward look: Ada is in house tonight, Brian arrives this week
    expect(screen.getByText(/On the books · from/)).toBeInTheDocument()
    expect(screen.getByText('In house tonight')).toBeInTheDocument()
    expect(screen.getByText(/Kernighan · Booking\.com · 2 nt/)).toBeInTheDocument()   // guestDisplayName renders "B. Kernighan"
    // trust line
    expect(screen.getByText(/Hostaway synced .* today · runs three times a day/)).toBeInTheDocument()
    // pay run: primary action in the header, and the ledger button on Stacey's row
    expect(screen.getByRole('button', { name: /Manager pay run/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Mark as paid' })).toBeInTheDocument()
    // three CSV exports: header (bookings), month table, by room
    expect(screen.getAllByRole('button', { name: /Export CSV/ }).length).toBe(3)
  })

  it('sorts the room table when a heading is clicked without blowing up', async () => {
    renderPage()
    const card = await byRoomCard()
    const occ = within(card).getByText(/^Occ\./)
    fireEvent.click(occ)
    expect(occ.textContent).toMatch(/Occ\. [↑↓]/)
    fireEvent.click(occ)
    expect(occ.textContent).toMatch(/Occ\. [↑↓]/)
    // the refurb room sinks to the bottom whichever way we sort
    const rows = within(card).getAllByRole('row').map(r => r.textContent)
    const idx = rows.findIndex(t => t.includes('Room 3, Test House'))
    const allRooms = rows.findIndex(t => t.startsWith('All rooms'))
    expect(idx).toBeGreaterThan(0)
    expect(idx).toBeLessThan(allRooms)
    expect(rows.slice(idx + 1, allRooms).every(t => !t.includes('Room 1') && !t.includes('Room 2'))).toBe(true)
  })

  it('shows a paid badge instead of the button once the ledger has this period', async () => {
    const api = await import('../../lib/api')
    // whatever "this month" resolves to, the ledger row must match it exactly
    const d = new Date(); const y = d.getFullYear(), m = d.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    api.fetchStlPayouts.mockResolvedValueOnce([{ id: 'L1', company_id: 'cA', manager_id: 'mgr1', manager_name: 'Stacey', period_from: `${y}-${String(m).padStart(2, '0')}-01`, period_to: `${y}-${String(m).padStart(2, '0')}-${last}`, amount: 99.99, base_amount: 833.25, percentage: 12, basis: 'net_after_platform_fees', paid_on: TODAY, breakdown: [] }])
    renderPage()
    expect(await screen.findByText(/Paid £99\.99 on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as paid' })).toBeNull()
    expect(screen.getByText(/now computes/)).toBeInTheDocument()   // 99.99 is not what 12% works out to
    expect(screen.getByText(/Payout history · 1 recorded/)).toBeInTheDocument()
  })
})
