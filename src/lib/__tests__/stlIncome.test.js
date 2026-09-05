import { describe, it, expect } from 'vitest'
import {
  isRevenueBooking, channelLabel, bookingNights, summariseStl, ytd, periodRange, periodDays,
  guestDisplayName, bookingReference, bookingStatusLabel, unitCount, bookingMatches, bookingFees, bookingNetAfterFees, feeDeductedAtSource, managerPayouts, fortnightRange, observedChannelRates, effectiveFees } from '../stlIncome'

const bk = (over = {}) => ({
  id: 'b1', property_id: 'p1', provider: 'hostaway', source: 'Airbnb', status: 'new',
  guest_name: 'John Smith', arrival: '2026-03-10', departure: '2026-03-13', total_amount: 300,
  hostaway_reservation_id: 12345, hostaway_listing_id: 501, ...over,
})

describe('isRevenueBooking', () => {
  it('counts new / modified / confirmed Hostaway and Booked Lodgify stays', () => {
    expect(isRevenueBooking(bk({ status: 'new' }))).toBe(true)
    expect(isRevenueBooking(bk({ status: 'modified' }))).toBe(true)
    expect(isRevenueBooking(bk({ status: 'confirmed' }))).toBe(true)
    expect(isRevenueBooking(bk({ status: 'Booked', provider: 'lodgify' }))).toBe(true)
  })
  it('excludes cancelled, expired and every inquiry status', () => {
    for (const s of ['cancelled', 'expired', 'declined', 'inquiry', 'inquiryNotPossible', 'inquiryPreapproved', 'awaitingPayment', 'ownerStay', 'unknown', '', null]) {
      expect(isRevenueBooking(bk({ status: s }))).toBe(false)
    }
  })
  it('excludes a confirmed booking that carries a cancellation date', () => {
    expect(isRevenueBooking(bk({ status: 'new', cancellation_date: '2026-03-01' }))).toBe(false)
  })
})

describe('channelLabel', () => {
  it('normalises the direct-booking variants to Direct', () => {
    expect(channelLabel('Direct site')).toBe('Direct')
    expect(channelLabel('Direct')).toBe('Direct')
    expect(channelLabel('bookingEngine')).toBe('Direct')
    expect(channelLabel('Manual')).toBe('Direct')
  })
  it('normalises channel spellings from both syncs', () => {
    expect(channelLabel('BookingCom')).toBe('Booking.com')
    expect(channelLabel('Booking.com')).toBe('Booking.com')
    expect(channelLabel('AirbnbIntegration')).toBe('Airbnb')
    expect(channelLabel('Vrbo iCal')).toBe('Vrbo')
  })
  it('falls back to Other for blanks and keeps unknown names', () => {
    expect(channelLabel('')).toBe('Other')
    expect(channelLabel(null)).toBe('Other')
    expect(channelLabel('Marriott')).toBe('Marriott')
  })
})

describe('bookingNights', () => {
  it('is departure minus arrival', () => {
    expect(bookingNights(bk())).toBe(3)
  })
  it('floors a same-day stay to one night, matching the sync', () => {
    expect(bookingNights(bk({ arrival: '2026-03-10', departure: '2026-03-10' }))).toBe(1)
  })
  it('is zero when a date is missing', () => {
    expect(bookingNights(bk({ departure: null }))).toBe(0)
  })
  it('is not fooled by the DST change', () => {
    expect(bookingNights(bk({ arrival: '2026-03-28', departure: '2026-03-30' }))).toBe(2)
    expect(bookingNights(bk({ arrival: '2026-10-24', departure: '2026-10-26' }))).toBe(2)
  })
})

describe('summariseStl', () => {
  const bookings = [
    bk({ id: 'a', arrival: '2026-03-10', departure: '2026-03-13', total_amount: 300, source: 'Airbnb' }),
    bk({ id: 'b', arrival: '2026-03-20', departure: '2026-03-22', total_amount: 200, source: 'Booking.com' }),
    bk({ id: 'c', arrival: '2026-03-25', departure: '2026-03-27', total_amount: 999, status: 'cancelled' }),
    bk({ id: 'd', arrival: '2026-03-26', departure: '2026-03-28', total_amount: 500, status: 'inquiry' }),
    bk({ id: 'e', arrival: '2026-04-02', departure: '2026-04-04', total_amount: 150, source: 'Direct site' }),
  ]
  it('sums gross from revenue bookings only, by arrival month', () => {
    const s = summariseStl(bookings, [], { from: '2026-03-01', to: '2026-03-31' })
    expect(s.gross).toBe(500)
    expect(s.bookings).toBe(2)
    expect(s.nonRevenueCount).toBe(2)
    expect(s.nights).toBe(5)
    expect(s.net).toBe(500)
    expect(s.adjustmentsTotal).toBe(0)
  })
  it('an adjustment in the period reduces net but not gross', () => {
    const adj = [{ id: 'x', property_id: 'p1', adjustment_date: '2026-03-15', amount: -120, kind: 'refund' }]
    const s = summariseStl(bookings, adj, { from: '2026-03-01', to: '2026-03-31' })
    expect(s.gross).toBe(500)
    expect(s.adjustmentsTotal).toBe(-120)
    expect(s.net).toBe(380)
    expect(s.adjustments).toHaveLength(1)
  })
  it('ignores adjustments dated outside the period', () => {
    const adj = [{ adjustment_date: '2026-04-15', amount: -120, kind: 'refund' }]
    expect(summariseStl(bookings, adj, { from: '2026-03-01', to: '2026-03-31' }).net).toBe(500)
  })
  it('breaks down by normalised channel, largest first', () => {
    const s = summariseStl(bookings, [], { from: '2026-03-01', to: '2026-04-30' })
    expect(s.byChannel.map(c => c.channel)).toEqual(['Airbnb', 'Booking.com', 'Direct'])
    expect(s.byChannel[0].share).toBeCloseTo(300 / 650)
    expect(s.byChannel[2].nights).toBe(2)
  })
  it('occupancy = nights sold / (rooms x days in period)', () => {
    // March: 31 days, 2 rooms = 62 room-nights available, 5 sold.
    const s = summariseStl(bookings, [], { from: '2026-03-01', to: '2026-03-31', roomCount: 2 })
    expect(s.periodDays).toBe(31)
    expect(s.occupancy).toBeCloseTo((5 / 62) * 100, 2)
  })
  it('occupancy is null when the room count is unknown', () => {
    expect(summariseStl(bookings, [], { from: '2026-03-01', to: '2026-03-31' }).occupancy).toBeNull()
    expect(summariseStl(bookings, [], { from: '2026-03-01', to: '2026-03-31', roomCount: 0 }).occupancy).toBeNull()
  })
  it('builds a month-by-month series that crosses a year boundary', () => {
    const b = [
      bk({ id: 'n', arrival: '2025-11-28', departure: '2025-12-03', total_amount: 400 }),
      bk({ id: 'o', arrival: '2025-12-30', departure: '2026-01-02', total_amount: 250 }),
      bk({ id: 'p', arrival: '2026-01-15', departure: '2026-01-17', total_amount: 100 }),
    ]
    const adj = [{ adjustment_date: '2026-01-20', amount: -50, kind: 'refund' }]
    const s = summariseStl(b, adj, { from: '2025-11-01', to: '2026-02-28' })
    expect(s.months.map(m => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    // The 30 Dec -> 2 Jan stay lands in December (arrival month), not split.
    expect(s.months[1]).toMatchObject({ gross: 250, bookings: 1, nights: 3 })
    expect(s.months[0]).toMatchObject({ gross: 400, nights: 5 })
    expect(s.months[2]).toMatchObject({ gross: 100, adjustments: -50, net: 50 })
    expect(s.months[3]).toMatchObject({ gross: 0, bookings: 0, net: 0 })
    expect(s.gross).toBe(750)
    expect(s.net).toBe(700)
  })
  it('handles an open-ended period by spanning the data', () => {
    const s = summariseStl(bookings, [])
    expect(s.months.map(m => m.key)).toEqual(['2026-03', '2026-04'])
    expect(s.gross).toBe(650)
    expect(s.occupancy).toBeNull()
  })
  it('treats a NULL total as zero rather than NaN', () => {
    const s = summariseStl([bk({ total_amount: null })], [])
    expect(s.gross).toBe(0)
    expect(s.bookings).toBe(1)
  })
})

describe('ytd', () => {
  const bookings = [
    bk({ id: 'a', arrival: '2026-01-10', departure: '2026-01-12', total_amount: 100 }),
    bk({ id: 'b', arrival: '2026-08-10', departure: '2026-08-12', total_amount: 200 }),
    bk({ id: 'c', arrival: '2026-11-10', departure: '2026-11-12', total_amount: 400 }),
    bk({ id: 'd', arrival: '2025-11-10', departure: '2025-11-12', total_amount: 800 }),
  ]
  it('runs from 1 Jan to today for the current year', () => {
    const s = ytd(bookings, [], 2026, { today: new Date(2026, 8, 2) })
    expect(s.gross).toBe(300)
    expect(s.periodDays).toBe(245)
  })
  it('covers the whole of a past year', () => {
    const s = ytd(bookings, [], 2025, { today: new Date(2026, 8, 2) })
    expect(s.gross).toBe(800)
    expect(s.periodDays).toBe(365)
  })
})

describe('periodRange / periodDays', () => {
  const today = new Date(2026, 0, 15) // 15 Jan 2026
  it('this month and last month across a year boundary', () => {
    expect(periodRange('this_month', today)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(periodRange('last_month', today)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('ytd ends today', () => {
    expect(periodRange('ytd', today)).toEqual({ from: '2026-01-01', to: '2026-01-15' })
  })
  it('handles February in a leap year', () => {
    expect(periodRange('this_month', new Date(2028, 1, 3)).to).toBe('2028-02-29')
  })
  it('periodDays is inclusive and zero when reversed', () => {
    expect(periodDays('2026-03-01', '2026-03-31')).toBe(31)
    expect(periodDays('2026-03-31', '2026-03-01')).toBe(0)
    expect(periodDays(null, '2026-03-01')).toBe(0)
  })
})

describe('display helpers', () => {
  it('shows initials + surname only', () => {
    expect(guestDisplayName('John Smith')).toBe('J. Smith')
    expect(guestDisplayName('maria de la cruz')).toBe('M. cruz')
    expect(guestDisplayName('Cher')).toBe('Cher')
    expect(guestDisplayName('')).toBe('Guest')
    expect(guestDisplayName(null)).toBe('Guest')
  })
  it('references prefer the channel manager id', () => {
    expect(bookingReference(bk())).toBe('Hostaway #12345')
    expect(bookingReference(bk({ hostaway_reservation_id: null, lodgify_booking_id: 77 }))).toBe('Lodgify #77')
  })
  it('status labels collapse the many non-revenue statuses', () => {
    expect(bookingStatusLabel(bk())).toBe('Confirmed')
    expect(bookingStatusLabel(bk({ status: 'cancelled' }))).toBe('Cancelled')
    expect(bookingStatusLabel(bk({ status: 'inquiryPreapproved' }))).toBe('Inquiry')
    expect(bookingStatusLabel(bk({ status: 'awaitingPayment' }))).toBe('AwaitingPayment')
  })
  it('unitCount prefers mappings, then distinct listing ids, else null', () => {
    const p = { id: 'p1' }
    expect(unitCount(p, [], [{ property_id: 'p1' }, { property_id: 'p1' }, { property_id: 'p2' }])).toBe(2)
    expect(unitCount(p, [bk({ hostaway_listing_id: 1 }), bk({ hostaway_listing_id: 2 }), bk({ hostaway_listing_id: 2 })], [])).toBe(2)
    expect(unitCount(p, [bk({ hostaway_listing_id: null })], [])).toBeNull()
  })
  it('unitCount counts a room with no listing and no bookings as 0, not unknown', () => {
    // A room still in refurb is not open for bookings, so it sits out of the
    // occupancy denominator instead of blanking occupancy for the whole block.
    const p = { id: 'p9' }
    expect(unitCount(p, [], [])).toBe(0)
    expect(unitCount(p, [bk({ property_id: 'p1' })], [{ property_id: 'p1' }])).toBe(0)
    // but a mapping or a first booking brings it straight back in
    expect(unitCount(p, [], [{ property_id: 'p9' }])).toBe(1)
    expect(unitCount(p, [bk({ property_id: 'p9', hostaway_listing_id: 7 })], [])).toBe(1)
  })
  it('bookingMatches searches guest, reference and channel', () => {
    expect(bookingMatches(bk(), 'smith')).toBe(true)
    expect(bookingMatches(bk(), '12345')).toBe(true)
    expect(bookingMatches(bk({ source: 'Direct site' }), 'direct')).toBe(true)
    expect(bookingMatches(bk(), 'nobody')).toBe(false)
    expect(bookingMatches(bk(), '')).toBe(true)
  })
})

describe('platform fees and manager payouts', () => {
  const bk = (id, pid, source, arrival, total, channelFee, hostawayFee = 0) => ({ id, property_id: pid, source, status: 'new', arrival, departure: arrival.slice(0, 8) + String(Number(arrival.slice(8, 10)) + 2).padStart(2, '0'), total_amount: total, channel_commission: channelFee, hostaway_commission: hostawayFee })
  const bookings = [
    bk('a', 'p1', 'Airbnb', '2026-08-03', 200, 6),         // deducted at source
    bk('b', 'p1', 'Booking.com', '2026-08-05', 300, 45),    // invoiced separately
    bk('c', 'p2', 'Airbnb', '2026-08-10', 100, 3),
    { id: 'd', property_id: 'p2', source: 'Airbnb', status: 'new', arrival: '2026-08-12', departure: '2026-08-13', total_amount: 80 }, // fees not yet synced
  ]
  it('splits fees by whether the channel deducts at source', () => {
    const s = summariseStl(bookings, [], { from: '2026-08-01', to: '2026-08-31' })
    expect(s.gross).toBe(680); expect(s.platformFees).toBe(54); expect(s.channelFees).toBe(54)
    expect(s.feesDeducted).toBe(9); expect(s.feesInvoiced).toBe(45)
    expect(s.netAfterFees).toBe(626); expect(s.payoutReceived).toBe(671); expect(s.net).toBe(626)
    expect(s.feesKnown).toBe(3)
    const bcom = s.byChannel.find(c => c.channel === 'Booking.com')
    expect(bcom.fees).toBe(45); expect(bcom.feeRate).toBe(15); expect(bcom.deductedAtSource).toBe(false)
    expect(s.months.find(m => m.key === '2026-08').fees).toBe(54)
  })
  it('booking helpers', () => {
    expect(bookingFees(bookings[0])).toEqual({ channel: 6, hostaway: 0, total: 6, known: true })
    expect(bookingFees(bookings[3]).known).toBe(false)
    expect(bookingNetAfterFees(bookings[1])).toBe(255)
    expect(feeDeductedAtSource('Airbnb')).toBe(true); expect(feeDeductedAtSource('Booking.com')).toBe(false)
  })
  it('pays a manager a percentage of income after platform fees for their properties only', () => {
    const managers = [{ id: 'm1', name: 'Stacey', percentage: 15, basis: 'net_after_platform_fees', active: true }]
    const props = [{ id: 'p1', stl_manager_id: 'm1' }, { id: 'p2', stl_manager_id: null }]
    const adj = [{ property_id: 'p1', adjustment_date: '2026-08-20', amount: -50 }]
    const rows = managerPayouts(bookings, adj, props, managers, { from: '2026-08-01', to: '2026-08-31' })
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.gross).toBe(500); expect(r.platformFees).toBe(51); expect(r.adjustments).toBe(-50)
    expect(r.netAfterFees).toBe(399); expect(r.amount).toBe(59.85); expect(r.properties).toHaveLength(1)
  })
  it('gross basis and inactive managers', () => {
    const managers = [{ id: 'm1', name: 'A', percentage: 10, basis: 'gross', active: true }, { id: 'm2', name: 'B', percentage: 50, basis: 'gross', active: false }]
    const props = [{ id: 'p1', stl_manager_id: 'm1' }, { id: 'p2', stl_manager_id: 'm2' }]
    const rows = managerPayouts(bookings, [], props, managers, { from: '2026-08-01', to: '2026-08-31' })
    expect(rows).toHaveLength(1); expect(rows[0].amount).toBe(50)
  })
  it('fortnights are anchored and consecutive', () => {
    const cur = fortnightRange(new Date('2026-09-02T12:00:00Z'), 0)
    const prev = fortnightRange(new Date('2026-09-02T12:00:00Z'), -1)
    expect(cur).toEqual({ from: '2026-08-31', to: '2026-09-13' })
    expect(prev).toEqual({ from: '2026-08-17', to: '2026-08-30' })
    expect(periodRange('last_fortnight', new Date('2026-09-02T12:00:00Z'))).toEqual(prev)
  })
})

describe('estimating fees not yet reported', () => {
  const known = { id: 'k', property_id: 'p', source: 'Booking.com', status: 'new', arrival: '2026-08-01', departure: '2026-08-03', total_amount: 200, channel_commission: 30 }
  const pending = { id: 'u', property_id: 'p', source: 'Booking.com', status: 'new', arrival: '2026-08-10', departure: '2026-08-12', total_amount: 100 }
  const airbnbUnknown = { id: 'a', property_id: 'p', source: 'Airbnb', status: 'new', arrival: '2026-08-11', departure: '2026-08-12', total_amount: 100 }
  it('derives the observed rate per channel from bookings that carry a fee', () => {
    expect(observedChannelRates([known, pending])).toEqual({ 'Booking.com': 15 })
  })
  it('estimates an invoice-later channel at the observed rate, never a deduct-at-source channel', () => {
    const rates = observedChannelRates([known])
    expect(effectiveFees(pending, rates)).toMatchObject({ total: 15, estimated: true, rate: 15 })
    expect(effectiveFees(airbnbUnknown, rates).estimated).toBe(false)
    expect(effectiveFees(pending, null).total).toBe(0)
  })
  it('summary counts estimated fees and reports them separately', () => {
    const s = summariseStl([known, pending, airbnbUnknown], [], { from: '2026-08-01', to: '2026-08-31', rates: { 'Booking.com': 15 } })
    expect(s.platformFees).toBe(45); expect(s.feesEstimated).toBe(1); expect(s.feesEstimatedAmount).toBe(15); expect(s.feesKnown).toBe(1)
    expect(s.netAfterFees).toBe(355)
  })
})
