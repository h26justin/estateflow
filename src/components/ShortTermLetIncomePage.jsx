// Short-Term Let Income (Rent Tracker rebuild, Stage 6).
//
// One page for every property whose status is short_term_let, across all
// companies. Bookings come from stl_bookings (written by the Hostaway /
// Lodgify syncs); refunds and other adjustments are entered here by hand
// into stl_adjustments. Figures are GROSS booking values, channel commission
// not deducted, and are excluded from the residential collection rate.
//
// All arithmetic is in lib/stlIncome (pure, tested). This file is layout,
// filters and the adjustment form only.
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { MONO, monoLabel, inp, card } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { useIsMobile } from '../lib/useWindowSize'
import { useConfirm } from '../lib/ConfirmContext'
import { Icon } from '../lib/icons'
import { canDo } from '../lib/permissions'
import {
  STL_COLOR, STL_STATUS, ADJUSTMENT_KINDS, KNOWN_CHANNELS,
  isRevenueBooking, isCancelled, channelLabel, bookingNights, bookingReference, guestDisplayName,
  bookingStatusLabel, unitCount, summariseStl, periodRange, toISO, bookingMatches, bookingFees, bookingNetAfterFees, managerPayouts, observedChannelRates, effectiveFees,
  roomBreakdown, forwardLook, findPaidPayout, payoutSnapshot,
} from '../lib/stlIncome'
import { downloadCsv } from '../lib/csv'

const fmtMoney = n => {
  const v = Number(n) || 0
  const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-£${s}` : `£${s}`
}
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fmtDateShort = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "04:10 today" / "yesterday 21:30" / "3 Sep 04:10" for the last-synced line.
const syncLabel = iso => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return `${hm} today`
  if (same(d, y)) return `yesterday ${hm}`
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`
}
const PERIODS = [
  { v: 'this_month', l: 'This month' },
  { v: 'last_month', l: 'Last month' },
  { v: 'this_fortnight', l: 'This fortnight' },
  { v: 'last_fortnight', l: 'Last fortnight' },
  { v: 'ytd',        l: 'Year to date' },
  { v: 'custom',     l: 'Custom' },
]

const EMPTY_ADJ = { property_id: '', booking_id: '', adjustment_date: toISO(new Date()), amount: '', kind: 'refund', channel: '', reference: '', notes: '' }

export default function ShortTermLetIncomePage({ companies = [], properties = [], permissionsMap, devModeActive = false, showToast, openDetail, onPropertyUpdated }) {
  const { T, darkMode } = useTheme()
  const isMobile = useIsMobile(769)
  const confirmDialog = useConfirm()
  const stlText = darkMode ? '#B89BEF' : '#6E44B8'
  const stlBg = darkMode ? '#241A38' : '#F0EAFB'

  // ── Scope: every short-term-let property, across companies ──────────────
  const stlProps = useMemo(() => properties.filter(p => p.status === STL_STATUS), [properties])
  const stlIds = useMemo(() => stlProps.map(p => p.id), [stlProps])
  const stlIdKey = stlIds.slice().sort().join(',')
  const stlCompanies = useMemo(() => companies.filter(c => stlProps.some(p => p.company_id === c.id)), [companies, stlProps])

  // ── Filters ─────────────────────────────────────────────────────────────
  const [coFilter, setCoFilter] = useState([])          // [] = all
  const [propFilter, setPropFilter] = useState('all')
  const [period, setPeriod] = useState('this_month')
  const [customFrom, setCustomFrom] = useState(periodRange('ytd').from)
  const [customTo, setCustomTo] = useState(periodRange('ytd').to)
  const [search, setSearch] = useState('')
  const [showNonRevenue, setShowNonRevenue] = useState(false)

  const range = period === 'custom' ? { from: customFrom || null, to: customTo || null } : periodRange(period)
  const yearShown = Number((range.to || range.from || toISO(new Date())).slice(0, 4))

  // ── Data ────────────────────────────────────────────────────────────────
  const [bookings, setBookings] = useState(null)      // null = loading
  const [adjustments, setAdjustments] = useState([])
  const [mappings, setMappings] = useState([])
  const [managers, setManagers] = useState([])
  const [ledger, setLedger] = useState([])          // stl_manager_payouts: what has actually been paid
  const [connections, setConnections] = useState([])  // hostaway_connections, for the last-synced line
  const [loadError, setLoadError] = useState(null)

  async function loadManagers() {
    const mg = await api.fetchStlManagers(stlCompanies.map(c => c.id))
    setManagers(mg)
  }
  async function loadAdjustments() {
    const a = await api.fetchStlAdjustments({ propertyIds: stlIds })
    setAdjustments(a)
  }
  async function loadLedger() {
    const l = await api.fetchStlPayouts(stlCompanies.map(c => c.id))
    setLedger(l)
  }
  useEffect(() => {
    let alive = true
    if (stlIds.length === 0) { setBookings([]); setAdjustments([]); return }
    setBookings(null); setLoadError(null)
    ;(async () => {
      try {
        const coIds = stlCompanies.map(c => c.id)
        const [b, a, m, mg, l, cx] = await Promise.all([
          api.fetchStlIncomeBookings({ propertyIds: stlIds }),
          api.fetchStlAdjustments({ propertyIds: stlIds }),
          api.fetchHostawayMappings().catch(() => []),   // own-rows RLS; optional
          api.fetchStlManagers(coIds).catch(() => []),
          api.fetchStlPayouts(coIds).catch(() => []),      // table may not exist yet on an older DB
          api.fetchHostawayConnections().catch(() => []),  // own-rows RLS; optional
        ])
        if (!alive) return
        setBookings(b); setAdjustments(a); setMappings(m); setManagers(mg); setLedger(l); setConnections(cx)
      } catch (e) {
        if (!alive) return
        setLoadError(e.message || 'Could not load bookings'); setBookings([])
      }
    })()
    return () => { alive = false }
  }, [stlIdKey])

  // ── Selection ───────────────────────────────────────────────────────────
  const visibleCos = coFilter.length === 0 ? stlCompanies : stlCompanies.filter(c => coFilter.includes(c.id))
  const selectedProps = useMemo(() => stlProps.filter(p =>
    visibleCos.some(c => c.id === p.company_id) && (propFilter === 'all' || p.id === propFilter)
  ), [stlProps, visibleCos, propFilter])
  const selectedIds = useMemo(() => new Set(selectedProps.map(p => p.id)), [selectedProps])
  const propById = useMemo(() => Object.fromEntries(stlProps.map(p => [p.id, p])), [stlProps])
  const coById = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies])

  const scopedBookings = useMemo(() => (bookings || []).filter(b => selectedIds.has(b.property_id) && bookingMatches(b, search)), [bookings, selectedIds, search])
  const scopedAdjustments = useMemo(() => adjustments.filter(a => selectedIds.has(a.property_id)), [adjustments, selectedIds])

  // Room count for occupancy. Counts the units that are actually open for
  // bookings: rooms not yet listed anywhere (still in refurb, say) count 0 and
  // sit out of the denominator, so one dark room in a block no longer blanks
  // occupancy for the whole selection. Still null if any property has bookings
  // we cannot attribute to a listing, because then the count is unknowable.
  // notOpen is surfaced next to the figure so dark rooms stay visible.
  const { roomCount, notOpen } = useMemo(() => {
    if (selectedProps.length === 0) return { roomCount: null, notOpen: 0 }
    let total = 0
    let dark = 0
    for (const p of selectedProps) {
      const u = unitCount(p, bookings || [], mappings)
      if (u == null) return { roomCount: null, notOpen: 0 }
      if (u === 0) dark++
      total += u
    }
    return { roomCount: total, notOpen: dark }
  }, [selectedProps, bookings, mappings])

  // Fee rates observed across ALL bookings, used to estimate fees on bookings
  // whose channel has not reported a commission yet (Booking.com reports after
  // the stay). Estimates are labelled wherever they appear.
  const rates = useMemo(() => observedChannelRates(bookings || []), [bookings])
  const summary = useMemo(() => summariseStl(scopedBookings, scopedAdjustments, { ...range, roomCount, rates }), [scopedBookings, scopedAdjustments, range.from, range.to, roomCount, rates])
  const yearSummary = useMemo(() => summariseStl(scopedBookings, scopedAdjustments, { from: `${yearShown}-01-01`, to: `${yearShown}-12-31`, roomCount, rates }), [scopedBookings, scopedAdjustments, yearShown, roomCount, rates])
  const payouts = useMemo(() => managerPayouts(scopedBookings, scopedAdjustments, selectedProps, managers, { ...range, rates }), [scopedBookings, scopedAdjustments, selectedProps, managers, range.from, range.to, rates])
  const managerFees = Math.round(payouts.reduce((acc, r) => acc + r.amount, 0) * 100) / 100
  const netToOwner = Math.round((summary.netAfterFees - managerFees) * 100) / 100

  // Per-room rows and the sort the table is showing them in.
  const rooms = useMemo(() => roomBreakdown(scopedBookings, scopedAdjustments, selectedProps, { ...range, rates, mappings }), [scopedBookings, scopedAdjustments, selectedProps, range.from, range.to, rates, mappings])
  const [roomSort, setRoomSort] = useState({ key: 'gross', dir: 'desc' })
  const sortedRooms = useMemo(() => {
    const val = r => roomSort.key === 'name' ? (r.property.name || r.property.address || '') : r[roomSort.key]
    return rooms.slice().sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1            // unknowns sink regardless of direction
      if (bv == null) return -1
      const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return roomSort.dir === 'asc' ? c : -c
    })
  }, [rooms, roomSort])
  const toggleRoomSort = key => setRoomSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' })

  // What is on the books from today, independent of the period filter.
  const ahead = useMemo(() => forwardLook(scopedBookings, roomCount), [scopedBookings, roomCount])

  // Last Hostaway sync across the companies in view, for the trust line.
  const sync = useMemo(() => {
    const rows = connections.filter(c => visibleCos.some(v => v.id === c.company_id))
    if (rows.length === 0) return null
    const latest = rows.slice().sort((a, b) => String(b.last_synced_at || '').localeCompare(String(a.last_synced_at || '')))[0]
    const failed = rows.find(c => c.last_sync_status && c.last_sync_status !== 'ok')
    return { at: latest.last_synced_at || null, failed: failed ? (failed.last_sync_error || 'last sync failed') : null }
  }, [connections, visibleCos])
  const payoutRef = useRef(null)

  // ── Permissions ─────────────────────────────────────────────────────────
  const canEditCompany = cid => devModeActive || canDo(permissionsMap, cid, 'edit_rent')
  const editableProps = selectedProps.filter(p => canEditCompany(p.company_id))
  const canAdd = editableProps.length > 0

  // ── Adjustment form ─────────────────────────────────────────────────────
  const [adjForm, setAdjForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const setA = (k, v) => setAdjForm(f => ({ ...f, [k]: v }))
  function openAdjForm(prefill = {}) {
    setAdjForm({ ...EMPTY_ADJ, property_id: editableProps.length === 1 ? editableProps[0].id : '', ...prefill })
  }
  const kindMeta = ADJUSTMENT_KINDS.find(k => k.v === adjForm?.kind)
  const formBookings = useMemo(() => {
    if (!adjForm?.property_id) return []
    return (bookings || []).filter(b => b.property_id === adjForm.property_id && isRevenueBooking(b))
      .sort((a, b) => (b.arrival || '').localeCompare(a.arrival || '')).slice(0, 150)
  }, [adjForm?.property_id, bookings])

  async function saveAdjustment() {
    if (!adjForm.property_id) return showToast?.('Choose a property', 'error')
    if (!adjForm.adjustment_date) return showToast?.('Enter a date', 'error')
    const amt = Number(adjForm.amount)
    if (!Number.isFinite(amt) || amt === 0) return showToast?.('Enter a non-zero amount', 'error')
    if (kindMeta?.negative && amt > 0) return showToast?.(`${kindMeta.l}s are entered as a negative amount (money out)`, 'error')
    const prop = propById[adjForm.property_id]
    if (!prop || !canEditCompany(prop.company_id)) return showToast?.('You do not have permission to edit rent for this property', 'error')
    setSaving(true)
    try {
      await api.createStlAdjustment({ ...adjForm, amount: amt, company_id: prop.company_id, booking_id: adjForm.booking_id || null })
      await loadAdjustments()
      setAdjForm(null)
      showToast?.('Adjustment saved', 'success')
    } catch (e) { showToast?.(e.message || 'Could not save adjustment', 'error') }
    finally { setSaving(false) }
  }
  async function removeAdjustment(a) {
    const go = await confirmDialog({ title: 'Delete this adjustment?', body: `${fmtMoney(a.amount)} on ${fmtDate(a.adjustment_date)} will be removed and Net will change. The booking itself is untouched.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try { await api.deleteStlAdjustment(a.id); await loadAdjustments(); showToast?.('Adjustment deleted', 'success') }
    catch (e) { showToast?.(e.message || 'Could not delete adjustment', 'error') }
  }

  // ── Property managers (name + percentage) ────────────────────────────────
  const [mgrForm, setMgrForm] = useState(null)   // { company_id, name, percentage, basis, payout_frequency } | with id when editing
  const [mgrSaving, setMgrSaving] = useState(false)
  const setM = (k, v) => setMgrForm(f => ({ ...f, [k]: v }))
  async function saveManager() {
    if (!mgrForm?.company_id) return showToast?.('Choose a company', 'error')
    if (!String(mgrForm.name || '').trim()) return showToast?.('Enter the manager\'s name', 'error')
    const pct = Number(mgrForm.percentage)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return showToast?.('Percentage must be between 0 and 100', 'error')
    if (!canEditCompany(mgrForm.company_id)) return showToast?.('You do not have permission to edit rent for this company', 'error')
    setMgrSaving(true)
    try {
      if (mgrForm.id) await api.updateStlManager(mgrForm.id, { name: mgrForm.name.trim(), percentage: pct, basis: mgrForm.basis, payout_frequency: mgrForm.payout_frequency, notes: mgrForm.notes || null })
      else await api.createStlManager({ ...mgrForm, percentage: pct })
      await loadManagers(); setMgrForm(null); showToast?.('Manager saved', 'success')
    } catch (e) { showToast?.(e.message || 'Could not save manager', 'error') }
    finally { setMgrSaving(false) }
  }
  async function removeManager(m) {
    const assigned = stlProps.filter(p => p.stl_manager_id === m.id).length
    const go = await confirmDialog({ title: `Remove ${m.name}?`, body: assigned ? `${assigned} propert${assigned === 1 ? 'y is' : 'ies are'} assigned to ${m.name}; they will have no manager afterwards. Past payouts are not stored, so nothing else changes.` : 'Nothing is assigned to this manager.', confirmLabel: 'Remove', danger: true })
    if (!go) return
    try { await api.deleteStlManager(m.id); await loadManagers(); showToast?.('Manager removed', 'success') }
    catch (e) { showToast?.(e.message || 'Could not remove manager', 'error') }
  }
  async function assignManager(prop, managerId) {
    if (!canEditCompany(prop.company_id)) return showToast?.('You do not have permission to edit rent for this company', 'error')
    try {
      await api.setPropertyStlManager(prop.id, managerId || null)
      onPropertyUpdated?.(prop.id, { stl_manager_id: managerId || null })
      showToast?.(managerId ? 'Manager assigned' : 'Manager cleared', 'success')
    } catch (e) { showToast?.(e.message || 'Could not assign manager', 'error') }
  }
  // ── Payout ledger: record what was actually paid ─────────────────────────
  const [markingPaid, setMarkingPaid] = useState(null)   // manager id in flight
  async function markPaid(r) {
    if (!range.from || !range.to) return showToast?.('Choose a period with both dates first', 'error')
    if (!canEditCompany(r.manager.company_id)) return showToast?.('You do not have permission to record payouts for this company', 'error')
    const go = await confirmDialog({
      title: `Mark ${r.manager.name} as paid?`,
      body: `${fmtMoney(r.amount)} for ${periodLabel}: ${r.manager.percentage}% of ${fmtMoney(r.base)} (${r.manager.basis === 'gross' ? 'gross' : 'income after platform fees'}) across ${r.properties.filter(pp => pp.gross || pp.adjustments).length} unit(s). The figures behind it are frozen in the ledger so a later rate change or a late Booking.com invoice cannot restate what was paid.`,
      confirmLabel: 'Record payment',
    })
    if (!go) return
    setMarkingPaid(r.manager.id)
    try {
      await api.createStlPayout({
        company_id: r.manager.company_id, manager_id: r.manager.id, manager_name: r.manager.name,
        period_from: range.from, period_to: range.to,
        amount: r.amount, base_amount: r.base, percentage: r.manager.percentage, basis: r.manager.basis,
        breakdown: payoutSnapshot(r),
      })
      await loadLedger()
      showToast?.(`${r.manager.name} recorded as paid ${fmtMoney(r.amount)}`, 'success')
    } catch (e) { showToast?.(e.message || 'Could not record the payout', 'error') }
    finally { setMarkingPaid(null) }
  }
  async function removePaid(l) {
    const go = await confirmDialog({ title: 'Remove this payout record?', body: `${l.manager_name} · ${fmtDateShort(l.period_from)} – ${fmtDate(l.period_to)} · ${fmtMoney(l.amount)}. The period goes back to "not yet paid". Nothing is sent anywhere.`, confirmLabel: 'Remove', danger: true })
    if (!go) return
    try { await api.deleteStlPayout(l.id); await loadLedger(); showToast?.('Payout record removed', 'success') }
    catch (e) { showToast?.(e.message || 'Could not remove the record', 'error') }
  }
  const visibleLedger = useMemo(() => ledger.filter(l => visibleCos.some(c => c.id === l.company_id)), [ledger, visibleCos])
  const scrollToPayRun = () => payoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // ── CSV exports ───────────────────────────────────────────────────────────
  // periodLabel is declared further down, so resolve the file-name slug at click time.
  const slug = () => periodLabel.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const exportBookingsCsv = () => {
    const head = ['Check-in', 'Check-out', 'Nights', 'Room', 'Company', 'Channel', 'Reference', 'Guest', 'Gross', 'Platform fee', 'Fee estimated', 'Net after fees', 'Status', 'Payment status']
    const rows = [...revenueRows, ...nonRevenueRows].map(b => {
      const f = effectiveFees(b, rates); const prop = propById[b.property_id]
      return [b.arrival, b.departure, bookingNights(b), propLabel(b.property_id), coById[prop?.company_id]?.name || '', channelLabel(b.source), bookingReference(b), guestDisplayName(b.guest_name),
        Number(b.total_amount) || 0, f.total || 0, f.estimated ? 'yes' : '', isRevenueBooking(b) ? bookingNetAfterFees(b, rates) : 0, bookingStatusLabel(b), b.payment_status || '']
    })
    downloadCsv(`stl-bookings-${slug()}.csv`, [head, ...rows])
  }
  const exportMonthsCsv = () => {
    const head = ['Month', 'Bookings', 'Nights', 'Nights slept', 'Occupancy %', 'ADR', 'RevPAR', 'Gross', 'Platform fees', 'Adjustments', 'Net after fees']
    const rows = yearSummary.months.map(m => [`${yearShown}-${String(m.month).padStart(2, '0')}`, m.bookings, m.nights, m.occupiedNights, m.occupancy ?? '', m.adr ?? '', m.revpar ?? '', m.gross, m.fees, m.adjustments, m.net])
    downloadCsv(`stl-months-${yearShown}.csv`, [head, ...rows])
  }
  const exportRoomsCsv = () => {
    const head = ['Room', 'Company', 'Open', 'Units', 'Bookings', 'Nights', 'Nights slept', 'Occupancy %', 'ADR', 'RevPAR', 'Gross', 'Platform fees', 'Adjustments', 'Net after fees', 'Channels']
    const rows = sortedRooms.map(r => [r.property.name || r.property.address, coById[r.property.company_id]?.name || '', r.open ? 'yes' : 'no', r.units ?? '', r.bookings, r.nights, r.occupiedNights, r.occupancy ?? '', r.adr ?? '', r.revpar ?? '', r.gross, r.platformFees, r.adjustments, r.netAfterFees,
      r.byChannel.map(c => `${c.channel} ${(c.share * 100).toFixed(0)}%`).join(' / ')])
    downloadCsv(`stl-rooms-${slug()}.csv`, [head, ...rows])
  }

  const payoutText = () => {
    const lines = [`Short-term let manager payout · ${periodLabel}`]
    for (const r of payouts) {
      lines.push(`${r.manager.name} · ${r.manager.percentage}% of ${r.manager.basis === 'gross' ? 'gross' : 'income after platform fees'} · pay ${fmtMoney(r.amount)}`)
      for (const p of r.properties) lines.push(`  ${p.property.name || p.property.address}: gross ${fmtMoney(p.gross)}, fees ${fmtMoney(p.platformFees)}, adjustments ${fmtMoney(p.adjustments)}, net ${fmtMoney(p.netAfterFees)} → ${fmtMoney(p.amount)}`)
    }
    return lines.join('\n')
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const pillBtn = (active, accent = T.gold) => ({
    fontFamily: MONO, fontSize: 11, padding: '5px 14px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? accent : T.border}`, background: active ? accent : 'transparent',
    color: active ? (accent === T.gold ? '#1C2830' : '#fff') : T.muted, transition: 'all 0.18s',
  })
  const th = { fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { fontFamily: MONO, fontSize: 12, color: T.text, padding: '9px 10px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', verticalAlign: 'middle' }
  const tdR = { ...td, textAlign: 'right' }
  const statusPill = b => {
    const rev = isRevenueBooking(b)
    const canc = isCancelled(b)
    const c = rev ? stlText : canc ? T.red : T.muted
    const bg = rev ? stlBg : canc ? T.red + '22' : T.border
    return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontFamily: MONO, fontSize: 10, fontWeight: 600, color: c, background: bg }}>{bookingStatusLabel(b)}</span>
  }
  const Tile = ({ label, value, sub, accent }) => (
    <div style={{ ...card(T), padding: isMobile ? '12px 14px' : '16px 18px', borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ ...monoLabel(T), marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: isMobile ? 18 : 22, fontWeight: 700, color: accent || T.text, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 4 }}>{sub}</div>}
    </div>
  )

  const revenueRows = summary.revenueBookings.slice().sort((a, b) => (b.arrival || '').localeCompare(a.arrival || ''))
  const nonRevenueRows = summary.nonRevenueBookings.slice().sort((a, b) => (b.arrival || '').localeCompare(a.arrival || ''))
  const propLabel = pid => propById[pid]?.name || propById[pid]?.address || '—'
  const roomLabel = b => {
    const base = propLabel(b.property_id)
    const units = unitCount(propById[b.property_id], bookings || [], mappings)
    if (units > 1 && b.hostaway_listing_id) {
      const m = mappings.find(x => String(x.hostaway_listing_id) === String(b.hostaway_listing_id))
      return m?.hostaway_listing_name ? `${base} · ${m.hostaway_listing_name}` : `${base} · listing ${b.hostaway_listing_id}`
    }
    return base
  }
  const periodLabel = range.from && range.to ? `${fmtDateShort(range.from)} – ${fmtDate(range.to)}` : 'All time'

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="fade">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: isMobile ? 8 : 12, marginBottom: isMobile ? 12 : 18 }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STL_COLOR, display: 'inline-block' }} />
            Short-Term Let Income
          </h1>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
            Booking values from Hostaway with the platform fees Airbnb, Booking.com and Hostaway take, so you can see what actually comes to you. Excluded from the residential rent collection rate. Enter refunds and payout differences as adjustments; add property managers to work out their payout.
          </div>
          {sync && (
            <div style={{ fontFamily: MONO, fontSize: 10, marginTop: 6, color: sync.failed ? T.red : T.faint, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: sync.failed ? T.red : T.green, display: 'inline-block' }} />
              {sync.failed
                ? `Hostaway sync failed: ${sync.failed}`
                : sync.at ? `Hostaway synced ${syncLabel(sync.at)} · runs three times a day` : 'Hostaway connected, not synced yet'}
              <a href="#/settings/integrations" style={{ color: T.muted, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>Sync settings</a>
            </div>
          )}
        </div>
        {stlProps.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={exportBookingsCsv} disabled={bookings === null || revenueRows.length + nonRevenueRows.length === 0} className="btn btn-ghost" title="Download the bookings in this period as CSV"
              style={{ fontFamily: MONO, fontSize: 11, padding: '8px 14px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="download" size={13} /> Export CSV
            </button>
            {canAdd && (
              <button onClick={() => openAdjForm()} className="btn btn-ghost" style={{ fontFamily: MONO, fontSize: 11, padding: '8px 14px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="plus" size={13} /> Add adjustment
              </button>
            )}
            {canAdd && managers.length > 0 && (
              <button onClick={scrollToPayRun} className="btn btn-gold" style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="wallet" size={13} /> Manager pay run
              </button>
            )}
          </div>
        )}
      </div>

      {stlProps.length === 0 ? (
        <div style={{ ...card(T), textAlign: 'center', padding: '40px 20px' }}>
          <Icon name="bed" size={28} color={T.faint} />
          <div style={{ fontFamily: MONO, fontSize: 13, color: T.text, marginTop: 10, fontWeight: 600 }}>No short-term let properties yet</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginTop: 6, lineHeight: 1.6, maxWidth: 460, margin: '6px auto 0' }}>
            Set a property's status to Short-Term Let, then connect Hostaway under Settings → Integrations and map its listings. Bookings appear here after the first sync.
          </div>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {stlCompanies.length > 1 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginRight: 4 }}>COMPANY:</span>
                <button onClick={() => { setCoFilter([]); setPropFilter('all') }} style={pillBtn(coFilter.length === 0)}>All</button>
                {stlCompanies.map(c => (
                  <button key={c.id} onClick={() => { setCoFilter(f => f.includes(c.id) ? f.filter(x => x !== c.id) : [...f, c.id]); setPropFilter('all') }}
                    style={pillBtn(coFilter.includes(c.id), c.color || T.gold)}>
                    {c.abbr || c.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginRight: 4 }}>PERIOD:</span>
              {PERIODS.map(p => <button key={p.v} onClick={() => setPeriod(p.v)} style={pillBtn(period === p.v)}>{p.l}</button>)}
              {period === 'custom' && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="date" value={customFrom || ''} onChange={e => setCustomFrom(e.target.value)} style={{ ...inp(T), width: 'auto', padding: '5px 8px', fontSize: 11 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>to</span>
                  <input type="date" value={customTo || ''} onChange={e => setCustomTo(e.target.value)} style={{ ...inp(T), width: 'auto', padding: '5px 8px', fontSize: 11 }} />
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={propFilter} onChange={e => setPropFilter(e.target.value)} style={{ ...inp(T), width: isMobile ? '100%' : 260, padding: '7px 10px', fontSize: 12 }}>
                <option value="all">All properties / rooms ({stlProps.filter(p => visibleCos.some(c => c.id === p.company_id)).length})</option>
                {stlProps.filter(p => visibleCos.some(c => c.id === p.company_id)).map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.address}{stlCompanies.length > 1 && coById[p.company_id]?.abbr ? ` · ${coById[p.company_id].abbr}` : ''}</option>
                ))}
              </select>
              <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? '100%' : 220, maxWidth: 360 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.faint, display: 'flex' }}><Icon name="search" size={13} /></span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guest, reference, channel…" aria-label="Search bookings"
                  style={{ ...inp(T), padding: '7px 10px 7px 30px', fontSize: 12 }} />
                {search && <button onClick={() => setSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: T.muted, cursor: 'pointer', display: 'flex' }}><Icon name="x" size={13} /></button>}
              </div>
            </div>
          </div>

          {loadError && <div style={{ ...card(T), borderColor: T.red, color: T.red, fontFamily: MONO, fontSize: 12, marginBottom: 14 }}>{loadError}</div>}

          {bookings === null ? (
            <div style={{ ...card(T), textAlign: 'center', fontFamily: MONO, fontSize: 12, color: T.muted, padding: 40 }}>Loading bookings…</div>
          ) : (
            <>
              {/* Summary tiles */}
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{periodLabel} · {selectedProps.length} propert{selectedProps.length === 1 ? 'y' : 'ies'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(170px, 1fr))', gap: isMobile ? 8 : 12, marginBottom: 10 }}>
                <Tile label="Gross income" value={fmtMoney(summary.gross)} sub="what guests paid" accent={STL_COLOR} />
                <Tile label="Platform fees" value={fmtMoney(-summary.platformFees)} sub={`Airbnb etc. deducted ${fmtMoney(summary.feesDeducted)} · Booking.com invoiced ${fmtMoney(summary.feesInvoiced)}${summary.hostawayFees ? ` · Hostaway ${fmtMoney(summary.hostawayFees)}` : ''}`} accent={summary.platformFees ? T.red : undefined} />
                <Tile label="Adjustments" value={fmtMoney(summary.adjustmentsTotal)} sub={`${summary.adjustments.length} entered`} accent={summary.adjustmentsTotal < 0 ? T.red : summary.adjustmentsTotal > 0 ? T.green : undefined} />
                <Tile label="Net after platform fees" value={fmtMoney(summary.netAfterFees)} sub={`cash received ${fmtMoney(summary.payoutReceived)} (Booking.com fees billed later)`} accent={T.green} />
                <Tile label="Manager fees" value={fmtMoney(-managerFees)} sub={payouts.length ? payouts.map(r => `${r.manager.name} ${r.manager.percentage}%`).join(' · ') : 'no manager assigned'} accent={managerFees ? T.amber : undefined} />
                <Tile label="Net to owner" value={fmtMoney(netToOwner)} sub="after platform and manager fees" accent={T.gold} />
                <Tile label="Bookings" value={summary.bookings} sub={summary.nonRevenueCount ? `${summary.nonRevenueCount} non-revenue` : 'confirmed stays'} />
                <Tile label="Nights" value={summary.nights} sub="by check-in month" />
                <Tile label="Occupancy" value={summary.occupancy == null ? '—' : `${summary.occupancy.toFixed(0)}%`}
                  sub={summary.occupancy == null
                    ? (roomCount == null ? 'room count unknown' : roomCount === 0 ? 'no rooms open for bookings' : 'set a period')
                    : `${summary.occupiedNights} of ${roomCount * summary.periodDays} room-nights${notOpen ? ` · ${roomCount} of ${roomCount + notOpen} rooms open` : ''}${summary.occupancyToDate != null ? ` · ${summary.occupancyToDate.toFixed(0)}% over the ${summary.elapsedDays} night${summary.elapsedDays === 1 ? '' : 's'} so far` : ''}`} />
                <Tile label="ADR" value={summary.adr == null ? '—' : fmtMoney(summary.adr)} sub={summary.adr == null ? 'no nights sold' : 'per night sold · by check-in'} />
                <Tile label="RevPAR" value={summary.revpar == null ? '—' : fmtMoney(summary.revpar)}
                  sub={summary.revpar == null ? (roomCount == null ? 'room count unknown' : roomCount === 0 ? 'no rooms open' : 'set a period') : `per available room-night · ${roomCount} room${roomCount === 1 ? '' : 's'}`} />
              </div>
              {summary.bookings > 0 && summary.feesKnown < summary.bookings && (
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 14 }}>
                  Fees reported by the channel for {summary.feesKnown} of {summary.bookings} bookings.
                  {summary.feesEstimated > 0 && ` ${summary.feesEstimated} Booking.com booking${summary.feesEstimated === 1 ? '' : 's'} not yet invoiced ${summary.feesEstimated === 1 ? 'is' : 'are'} estimated at the observed rate (${fmtMoney(summary.feesEstimatedAmount)} in total); the figure firms up after the stay.`}
                  {summary.bookings - summary.feesKnown - summary.feesEstimated > 0 && ` ${summary.bookings - summary.feesKnown - summary.feesEstimated} other booking${summary.bookings - summary.feesKnown - summary.feesEstimated === 1 ? '' : 's'} carry no fee.`}
                </div>
              )}
              {summary.bookings > 0 && summary.feesKnown === summary.bookings && <div style={{ marginBottom: 10 }} />}

              {/* Forward look: what is already on the books from today */}
              <div style={{ ...card(T), marginBottom: 20, borderLeft: `3px solid ${STL_COLOR}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={{ ...monoLabel(T), marginBottom: 0 }}>On the books · from {fmtDate(ahead.today)}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>confirmed bookings only · not affected by the period filter</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: isMobile ? 8 : 12, marginBottom: ahead.arrivalsNext7.length ? 12 : 0 }}>
                  {[
                    { l: 'In house tonight', v: ahead.inHouse.length, sub: roomCount ? `of ${roomCount} room${roomCount === 1 ? '' : 's'}${ahead.departingToday.length ? ` · ${ahead.departingToday.length} checking out today` : ''}` : (ahead.departingToday.length ? `${ahead.departingToday.length} checking out today` : 'guests staying') },
                    { l: 'Arrivals next 7 days', v: ahead.arrivalsNext7.length, sub: ahead.arrivalsNext7.length ? `${ahead.arrivalsNext7.reduce((s2, b) => s2 + bookingNights(b), 0)} nights booked` : 'nothing arriving' },
                    { l: `Next ${ahead.horizon} nights`, v: ahead.forwardOccupancy == null ? `${ahead.nightsAhead} nt` : `${ahead.forwardOccupancy.toFixed(0)}%`, sub: ahead.availableNights ? `${ahead.nightsAhead} of ${ahead.availableNights} room-nights booked` : 'room count unknown' },
                    { l: 'Gross on the books', v: fmtMoney(ahead.grossAhead), sub: `check-ins in the next ${ahead.horizon} days` },
                  ].map(x => (
                    <div key={x.l} style={{ padding: isMobile ? '8px 10px' : '10px 12px', background: T.bg, borderRadius: 10 }}>
                      <div style={{ ...monoLabel(T), marginBottom: 4 }}>{x.l}</div>
                      <div style={{ fontFamily: MONO, fontSize: isMobile ? 16 : 20, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' }}>{x.v}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 2 }}>{x.sub}</div>
                    </div>
                  ))}
                </div>
                {ahead.arrivalsNext7.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '4px 16px' }}>
                    {ahead.arrivalsNext7.slice(0, 10).map(b => (
                      <div key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: MONO, fontSize: 11, padding: '3px 0', borderBottom: `1px solid ${T.border}`, overflow: 'hidden' }}>
                        <span style={{ color: b.arrival === ahead.today ? stlText : T.muted, fontWeight: b.arrival === ahead.today ? 700 : 400, whiteSpace: 'nowrap', minWidth: 52 }}>{b.arrival === ahead.today ? 'Today' : fmtDateShort(b.arrival)}</span>
                        <span style={{ color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{propLabel(b.property_id)}</span>
                        <span style={{ color: T.muted, whiteSpace: 'nowrap' }}>{guestDisplayName(b.guest_name)} · {channelLabel(b.source)} · {bookingNights(b)} nt</span>
                      </div>
                    ))}
                    {ahead.arrivalsNext7.length > 10 && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, padding: '4px 0' }}>+{ahead.arrivalsNext7.length - 10} more arriving this week</div>}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.4fr', gap: 16, marginBottom: 20 }}>
                {/* Channel breakdown */}
                <div style={card(T)}>
                  <div style={{ ...monoLabel(T), marginBottom: 12 }}>By channel · {periodLabel}</div>
                  {summary.byChannel.length === 0 ? (
                    <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint }}>No confirmed bookings in this period.</div>
                  ) : summary.byChannel.map(c => (
                    <div key={c.channel} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: T.text }}>{c.channel} <span style={{ color: T.faint, fontSize: 10 }}>· {c.bookings} · {c.nights} nt</span></span>
                        <span style={{ color: T.text, textAlign: 'right' }}>{fmtMoney(c.gross)} <span style={{ color: T.faint, fontSize: 10 }}>{(c.share * 100).toFixed(0)}%</span>
                          <div style={{ color: c.fees ? T.red : T.faint, fontSize: 10 }}>fee {fmtMoney(c.fees)}{c.fees ? ` (${c.feeRate}%)` : ''} · {c.deductedAtSource ? 'taken before payout' : 'invoiced separately'} · net {fmtMoney(c.net)}</div>
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: T.border }}>
                        <div style={{ width: `${Math.max(2, c.share * 100)}%`, height: '100%', borderRadius: 3, background: STL_COLOR }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Month by month */}
                <div style={{ ...card(T), overflowX: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ ...monoLabel(T), marginBottom: 0 }}>Month by month · {yearShown}</div>
                    <button className="btn" style={{ fontSize: 10 }} onClick={exportMonthsCsv}>Export CSV</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>Month</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={{ ...th, textAlign: 'right' }}>Nights</th>
                      <th style={{ ...th, textAlign: 'right' }} title="Nights slept that month over the month's room-nights">Occ.</th>
                      <th style={{ ...th, textAlign: 'right' }}>Gross</th><th style={{ ...th, textAlign: 'right' }}>Fees</th><th style={{ ...th, textAlign: 'right' }}>Adj.</th><th style={{ ...th, textAlign: 'right' }}>Net</th>
                    </tr></thead>
                    <tbody>
                      {yearSummary.months.map(m => {
                        const inRange = range.from && range.to && m.key >= range.from.slice(0, 7) && m.key <= range.to.slice(0, 7)
                        const dim = m.bookings === 0 && m.adjustments === 0
                        return (
                          <tr key={m.key} style={{ background: inRange ? stlBg : 'transparent' }}>
                            <td style={{ ...td, color: dim ? T.faint : T.text, fontWeight: inRange ? 700 : 400 }}>{MONTHS[m.month - 1]}</td>
                            <td style={{ ...tdR, color: dim ? T.faint : T.text }}>{m.bookings || '·'}</td>
                            <td style={{ ...tdR, color: dim ? T.faint : T.text }}>{m.nights || '·'}</td>
                            <td style={{ ...tdR, color: m.occupancy == null || !m.occupiedNights ? T.faint : T.text }}
                              title={m.occupancy == null ? 'room count unknown' : `${m.occupiedNights} of ${roomCount * m.days} room-nights`}>
                              {m.occupancy == null || !m.occupiedNights ? '·' : `${m.occupancy.toFixed(0)}%`}</td>
                            <td style={{ ...tdR, color: dim ? T.faint : T.text }}>{m.gross ? fmtMoney(m.gross) : '·'}</td>
                            <td style={{ ...tdR, color: m.fees ? T.red : T.faint }}>{m.fees ? fmtMoney(-m.fees) : '·'}</td>
                            <td style={{ ...tdR, color: m.adjustments < 0 ? T.red : m.adjustments > 0 ? T.green : T.faint }}>{m.adjustments ? fmtMoney(m.adjustments) : '·'}</td>
                            <td style={{ ...tdR, fontWeight: 600, color: dim ? T.faint : T.text }}>{m.net || m.gross ? fmtMoney(m.net) : '·'}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>Total</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{yearSummary.bookings}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{yearSummary.nights}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}
                          title={yearSummary.occupancyAchieved == null ? 'room count unknown' : `nights already slept, over the ${yearSummary.achievedDays} nights of trading that have run so far. Future months are still filling, so they are not averaged in.`}>
                          {yearSummary.occupancyAchieved == null ? '·' : `${yearSummary.occupancyAchieved.toFixed(0)}%`}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{fmtMoney(yearSummary.gross)}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none', color: yearSummary.platformFees ? T.red : T.text }}>{fmtMoney(-yearSummary.platformFees)}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none', color: yearSummary.adjustmentsTotal < 0 ? T.red : T.text }}>{fmtMoney(yearSummary.adjustmentsTotal)}</td>
                        <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{fmtMoney(yearSummary.net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By room */}
              <div style={{ ...card(T), padding: 0, marginBottom: 20, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px 10px', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ ...monoLabel(T), marginBottom: 0 }}>By room · {periodLabel}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>click a heading to sort</span>
                    <button className="btn" style={{ fontSize: 10 }} onClick={exportRoomsCsv} disabled={rooms.length === 0}>Export CSV</button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                    <thead><tr>
                      {[
                        { k: 'name', l: 'Room', right: false }, { k: 'bookings', l: 'Bookings' }, { k: 'nights', l: 'Nights' },
                        { k: 'occupancy', l: 'Occ.', title: 'Nights slept in the period over the room\'s room-nights' },
                        { k: 'adr', l: 'ADR', title: 'Gross per night sold' }, { k: 'revpar', l: 'RevPAR', title: 'Gross per available room-night' },
                        { k: 'gross', l: 'Gross' }, { k: 'platformFees', l: 'Fees' }, { k: 'netAfterFees', l: 'Net' },
                      ].map(c => (
                        <th key={c.k} onClick={() => toggleRoomSort(c.k)} title={c.title} style={{ ...th, textAlign: c.right === false ? 'left' : 'right', cursor: 'pointer', userSelect: 'none', color: roomSort.key === c.k ? T.text : T.muted }}>
                          {c.l}{roomSort.key === c.k ? (roomSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                      ))}
                      <th style={th}>Channels</th>
                    </tr></thead>
                    <tbody>
                      {sortedRooms.map(r => {
                        const dim = !r.open && r.bookings === 0
                        const c = dim ? T.faint : T.text
                        return (
                          <tr key={r.property.id} style={{ opacity: dim ? 0.6 : 1 }}>
                            <td style={{ ...td, color: c }}>
                              {openDetail
                                ? <button onClick={() => openDetail(r.property, 'rent')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c, fontFamily: MONO, fontSize: 12, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{r.property.name || r.property.address}</button>
                                : (r.property.name || r.property.address)}
                              {!r.open && <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 9, padding: '1px 6px', borderRadius: 10, background: T.border, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.units == null ? 'units unknown' : 'not open'}</span>}
                              {r.units > 1 && <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 10, color: T.faint }}>{r.units} listings</span>}
                            </td>
                            <td style={{ ...tdR, color: c }}>{r.bookings || '·'}</td>
                            <td style={{ ...tdR, color: c }}>{r.nights || '·'}</td>
                            <td style={{ ...tdR, color: r.occupancy == null ? T.faint : c }} title={r.occupancy == null ? '' : `${r.occupiedNights} of ${r.units * summary.periodDays} room-nights`}>{r.occupancy == null ? '·' : `${r.occupancy.toFixed(0)}%`}</td>
                            <td style={{ ...tdR, color: r.adr == null ? T.faint : c }}>{r.adr == null ? '·' : fmtMoney(r.adr)}</td>
                            <td style={{ ...tdR, color: r.revpar == null ? T.faint : c }}>{r.revpar == null ? '·' : fmtMoney(r.revpar)}</td>
                            <td style={{ ...tdR, color: c, fontWeight: 600 }}>{r.gross ? fmtMoney(r.gross) : '·'}</td>
                            <td style={{ ...tdR, color: r.platformFees ? T.red : T.faint }}>{r.platformFees ? fmtMoney(-r.platformFees) : '·'}</td>
                            <td style={{ ...tdR, color: r.gross ? T.green : T.faint, fontWeight: 600 }}>{r.gross || r.adjustments ? fmtMoney(r.netAfterFees) : '·'}</td>
                            <td style={{ ...td, minWidth: 140 }}>
                              {r.byChannel.length === 0 ? <span style={{ color: T.faint }}>·</span> : (
                                <div title={r.byChannel.map(x => `${x.channel} ${(x.share * 100).toFixed(0)}% (${fmtMoney(x.gross)})`).join(' · ')}>
                                  <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: T.border, marginBottom: 3 }}>
                                    {r.byChannel.map((x, i) => <div key={x.channel} style={{ width: `${x.share * 100}%`, background: i === 0 ? STL_COLOR : i === 1 ? T.gold : i === 2 ? T.blue || T.muted : T.muted }} />)}
                                  </div>
                                  <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, whiteSpace: 'nowrap' }}>{r.byChannel.slice(0, 3).map(x => `${x.channel} ${(x.share * 100).toFixed(0)}%`).join(' · ')}</div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {rooms.length > 1 && (
                        <tr>
                          <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>All rooms</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{summary.bookings}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{summary.nights}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{summary.occupancy == null ? '·' : `${summary.occupancy.toFixed(0)}%`}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{summary.adr == null ? '·' : fmtMoney(summary.adr)}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{summary.revpar == null ? '·' : fmtMoney(summary.revpar)}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none' }}>{fmtMoney(summary.gross)}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none', color: summary.platformFees ? T.red : T.text }}>{fmtMoney(-summary.platformFees)}</td>
                          <td style={{ ...tdR, fontWeight: 700, borderBottom: 'none', color: T.green }}>{fmtMoney(summary.netAfterFees)}</td>
                          <td style={{ ...td, borderBottom: 'none' }}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bookings */}
              <div style={{ ...card(T), padding: 0, marginBottom: 20, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px 10px', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ ...monoLabel(T), marginBottom: 0 }}>Bookings · {revenueRows.length} confirmed{search ? ` matching "${search}"` : ''}</div>
                  {nonRevenueRows.length > 0 && (
                    <button onClick={() => setShowNonRevenue(v => !v)} style={{ ...pillBtn(showNonRevenue), fontSize: 10 }}>
                      {showNonRevenue ? 'Hide' : 'Show'} {nonRevenueRows.length} non-revenue booking{nonRevenueRows.length === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
                {revenueRows.length === 0 && (!showNonRevenue || nonRevenueRows.length === 0) ? (
                  <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint, padding: '10px 18px 20px' }}>
                    {search ? 'No bookings match your search in this period.' : 'No confirmed bookings in this period.'}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead><tr>
                        <th style={th}>Check-in</th><th style={th}>Check-out</th><th style={{ ...th, textAlign: 'right' }}>Nights</th>
                        <th style={th}>Room</th><th style={th}>Channel</th><th style={th}>Reference</th><th style={th}>Guest</th>
                        <th style={{ ...th, textAlign: 'right' }}>Gross</th><th style={{ ...th, textAlign: 'right' }}>Fee</th><th style={{ ...th, textAlign: 'right' }}>Net</th><th style={th}>Status</th>
                        {canAdd && <th style={th}></th>}
                      </tr></thead>
                      <tbody>
                        {[...revenueRows, ...(showNonRevenue ? nonRevenueRows : [])].map(b => {
                          const rev = isRevenueBooking(b)
                          const prop = propById[b.property_id]
                          return (
                            <tr key={b.id} style={{ opacity: rev ? 1 : 0.6 }}>
                              <td style={td}>{fmtDate(b.arrival)}</td>
                              <td style={td}>{fmtDate(b.departure)}</td>
                              <td style={tdR}>{bookingNights(b)}</td>
                              <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {prop && openDetail
                                  ? <button onClick={() => openDetail(prop, 'rent')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.text, fontFamily: MONO, fontSize: 12, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{roomLabel(b)}</button>
                                  : roomLabel(b)}
                              </td>
                              <td style={td}>{channelLabel(b.source)}</td>
                              <td style={{ ...td, color: T.muted }}>{bookingReference(b)}</td>
                              <td style={td}>{guestDisplayName(b.guest_name)}</td>
                              <td style={{ ...tdR, fontWeight: rev ? 600 : 400, textDecoration: rev ? 'none' : 'line-through', color: rev ? T.text : T.faint }}>{fmtMoney(b.total_amount)}</td>
                              {(() => { const f = effectiveFees(b, rates); return (<>
                              <td style={{ ...tdR, color: rev && f.total ? T.red : T.faint, fontStyle: f.estimated ? 'italic' : 'normal' }} title={f.known ? `Channel ${fmtMoney(f.channel)}${f.hostaway ? ` · Hostaway ${fmtMoney(f.hostaway)}` : ''}` : f.estimated ? `Estimated at ${f.rate}% until the channel reports it` : 'No fee reported'}>{rev ? (f.total ? `${fmtMoney(-f.total)}${f.estimated ? '*' : ''}` : (f.known ? fmtMoney(0) : '—')) : '·'}</td>
                              <td style={{ ...tdR, fontWeight: rev ? 600 : 400, color: rev ? T.green : T.faint }}>{rev ? fmtMoney(bookingNetAfterFees(b, rates)) : '·'}</td>
                              </>) })()}
                              <td style={td}>{statusPill(b)}</td>
                              {canAdd && (
                                <td style={{ ...td, textAlign: 'right' }}>
                                  {rev && prop && canEditCompany(prop.company_id) && (
                                    <button title="Add a refund or adjustment against this booking" onClick={() => openAdjForm({ property_id: b.property_id, booking_id: b.id, channel: channelLabel(b.source), reference: bookingReference(b) })}
                                      style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: T.muted, fontFamily: MONO, fontSize: 10 }}>
                                      Adjust
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Property managers and payouts */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.4fr', gap: 16, marginBottom: 20 }}>
                <div style={card(T)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ ...monoLabel(T), marginBottom: 0 }}>Property managers</div>
                    {canAdd && !mgrForm && <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setMgrForm({ company_id: editableProps.length ? editableProps[0].company_id : (stlCompanies[0]?.id || ''), name: '', percentage: '', basis: 'net_after_platform_fees', payout_frequency: 'fortnightly', notes: '' })}>+ Add manager</button>}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginBottom: 10 }}>A named manager takes a percentage of each assigned unit's income, by default after platform fees and adjustments.</div>
                  {mgrForm && (
                    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {stlCompanies.length > 1 && !mgrForm.id && (
                        <div style={{ gridColumn: '1 / -1' }}><label style={monoLabel(T)}>Company</label>
                          <select value={mgrForm.company_id} onChange={e => setM('company_id', e.target.value)} style={inp(T)}>{stlCompanies.filter(c => canEditCompany(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                      )}
                      <div><label style={monoLabel(T)}>Name</label><input value={mgrForm.name} onChange={e => setM('name', e.target.value)} placeholder="e.g. Stacey" style={inp(T)} /></div>
                      <div><label style={monoLabel(T)}>Percentage</label><input type="number" step="0.5" min="0" max="100" value={mgrForm.percentage} onChange={e => setM('percentage', e.target.value)} placeholder="15" style={inp(T)} /></div>
                      <div><label style={monoLabel(T)}>Of</label>
                        <select value={mgrForm.basis} onChange={e => setM('basis', e.target.value)} style={inp(T)}>
                          <option value="net_after_platform_fees">Income after platform fees</option><option value="gross">Gross booking value</option>
                        </select></div>
                      <div><label style={monoLabel(T)}>Paid</label>
                        <select value={mgrForm.payout_frequency} onChange={e => setM('payout_frequency', e.target.value)} style={inp(T)}>
                          <option value="weekly">Weekly</option><option value="fortnightly">Every two weeks</option><option value="monthly">Monthly</option>
                        </select></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={monoLabel(T)}>Notes</label><input value={mgrForm.notes || ''} onChange={e => setM('notes', e.target.value)} placeholder="What the fee covers, e.g. management and cleaning" style={inp(T)} /></div>
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn" style={{ fontSize: 11 }} onClick={() => setMgrForm(null)} disabled={mgrSaving}>Cancel</button>
                        <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={saveManager} disabled={mgrSaving}>{mgrSaving ? 'Saving…' : 'Save manager'}</button>
                      </div>
                    </div>
                  )}
                  {managers.length === 0 && !mgrForm && <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint, marginBottom: 10 }}>No managers yet.</div>}
                  {managers.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.bg, borderRadius: 8, marginBottom: 6, opacity: m.active === false ? 0.6 : 1 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.name} <span style={{ fontFamily: MONO, fontSize: 11, color: STL_COLOR }}>{m.percentage}%</span></div>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>{m.basis === 'gross' ? 'of gross' : 'of income after platform fees'} · {m.payout_frequency === 'fortnightly' ? 'every two weeks' : m.payout_frequency}{stlCompanies.length > 1 && coById[m.company_id] ? ` · ${coById[m.company_id].abbr || coById[m.company_id].name}` : ''} · {stlProps.filter(p => p.stl_manager_id === m.id).length} unit(s){m.notes ? ` · ${m.notes}` : ''}</div>
                      </div>
                      {canEditCompany(m.company_id) && <button className="btn" style={{ fontSize: 10 }} onClick={() => setMgrForm({ ...m })}>Edit</button>}
                      {canEditCompany(m.company_id) && <button className="btn" style={{ fontSize: 10, color: T.red }} onClick={() => removeManager(m)} aria-label="Remove manager">✕</button>}
                    </div>
                  ))}
                  {managers.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...monoLabel(T), marginBottom: 6 }}>Who manages each unit</div>
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {selectedProps.map(p => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                            <span style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.address}</span>
                            <select value={p.stl_manager_id || ''} onChange={e => assignManager(p, e.target.value)} disabled={!canEditCompany(p.company_id)} style={{ ...inp(T), width: 'auto', padding: '3px 6px', fontSize: 11 }}>
                              <option value="">No manager</option>
                              {managers.filter(m => m.company_id === p.company_id).map(m => <option key={m.id} value={m.id}>{m.name} · {m.percentage}%</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div ref={payoutRef} style={{ ...card(T), overflowX: 'auto', scrollMarginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ ...monoLabel(T), marginBottom: 0 }}>Manager payout · {periodLabel}</div>
                    {payouts.length > 0 && <button className="btn" style={{ fontSize: 10 }} onClick={() => { navigator.clipboard?.writeText(payoutText()).then(() => showToast?.('Payout summary copied', 'success')).catch(() => showToast?.('Could not copy', 'error')) }}>Copy summary</button>}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginBottom: 10 }}>Bookings counted by check-in date in the period. Use "This fortnight" or "Last fortnight" above for a two-weekly payout run.</div>
                  {payouts.length === 0 ? (
                    <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint }}>{managers.length ? 'No assigned units have income in this period.' : 'Add a manager and assign units to see what to pay them.'}</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Manager / unit</th><th style={{ ...th, textAlign: 'right' }}>Net after fees</th><th style={{ ...th, textAlign: 'right' }}>%</th><th style={{ ...th, textAlign: 'right' }}>Pay</th>
                      </tr></thead>
                      <tbody>
                        {payouts.map(r => (
                          <Fragment key={r.manager.id}>
                            <tr style={{ background: stlBg }}>
                              <td style={{ ...td, fontWeight: 700, whiteSpace: 'normal' }}>{r.manager.name}
                                <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, fontWeight: 400 }}>
                                  {r.properties.length} unit(s) · {r.bookings} bookings · gross {fmtMoney(r.gross)} · platform fees {fmtMoney(-r.platformFees)}{r.adjustments ? ` · adjustments ${fmtMoney(r.adjustments)}` : ''}{r.feesEstimated ? ` · ${r.feesEstimated} fee${r.feesEstimated === 1 ? '' : 's'} estimated` : ''}{r.feesUnknown ? ` · ${r.feesUnknown} with no fee` : ''}
                                </div>
                              </td>
                              <td style={{ ...tdR, fontWeight: 600 }}>{fmtMoney(r.manager.basis === 'gross' ? r.gross : r.netAfterFees)}</td>
                              <td style={tdR}>{r.manager.percentage}%</td>
                              <td style={{ ...tdR, fontWeight: 700, color: T.gold, fontSize: 15 }}>
                                {fmtMoney(r.amount)}
                                {(() => {
                                  const paid = findPaidPayout(ledger, r.manager.id, range.from, range.to)
                                  if (paid) {
                                    const drift = Math.abs(Number(paid.amount) - r.amount) >= 0.01
                                    return (
                                      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, marginTop: 4, color: T.green, whiteSpace: 'normal' }}>
                                        Paid {fmtMoney(paid.amount)} on {fmtDateShort(paid.paid_on)}
                                        {drift && <div style={{ color: T.amber, fontWeight: 400 }}>now computes {fmtMoney(r.amount)}; the ledger keeps what was paid</div>}
                                      </div>
                                    )
                                  }
                                  if (!canEditCompany(r.manager.company_id) || !range.from || !range.to) return null
                                  return (
                                    <div style={{ marginTop: 6 }}>
                                      <button className="btn btn-gold" style={{ fontSize: 10, padding: '4px 10px' }} onClick={() => markPaid(r)} disabled={markingPaid === r.manager.id}>
                                        {markingPaid === r.manager.id ? 'Saving…' : 'Mark as paid'}
                                      </button>
                                    </div>
                                  )
                                })()}
                              </td>
                            </tr>
                            {r.properties.filter(pp => pp.gross || pp.adjustments).map(pp => (
                              <tr key={pp.property.id}>
                                <td style={{ ...td, color: T.muted, paddingLeft: 24 }}>{pp.property.name || pp.property.address}<span style={{ fontSize: 10, color: T.faint }}> · gross {fmtMoney(pp.gross)} · fees {fmtMoney(-pp.platformFees)}</span></td>
                                <td style={{ ...tdR, color: T.muted }}>{fmtMoney(pp.base)}</td><td style={tdR}></td>
                                <td style={{ ...tdR, color: T.muted }}>{fmtMoney(pp.amount)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {visibleLedger.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ ...monoLabel(T), marginBottom: 6 }}>Payout history · {visibleLedger.length} recorded</div>
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {visibleLedger.slice(0, 40).map(l => (
                          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${T.border}`, fontFamily: MONO, fontSize: 11 }}>
                            <span style={{ color: T.muted, whiteSpace: 'nowrap', minWidth: 140 }}>{fmtDateShort(l.period_from)} – {fmtDateShort(l.period_to)}</span>
                            <span style={{ color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.manager_name} <span style={{ color: T.faint }}>· {Number(l.percentage)}% of {fmtMoney(l.base_amount)} · paid {fmtDateShort(l.paid_on)}{stlCompanies.length > 1 && coById[l.company_id] ? ` · ${coById[l.company_id].abbr || coById[l.company_id].name}` : ''}</span></span>
                            <span style={{ color: T.gold, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney(l.amount)}</span>
                            {canEditCompany(l.company_id) && <button onClick={() => removePaid(l)} aria-label="Remove payout record" title="Remove payout record" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, display: 'inline-flex', padding: 0 }}><Icon name="trash" size={13} /></button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Adjustments */}
              <div style={{ ...card(T), padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px 10px', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ ...monoLabel(T), marginBottom: 0 }}>Adjustments · {summary.adjustments.length} in period · {fmtMoney(summary.adjustmentsTotal)}</div>
                  {canAdd && <button onClick={() => openAdjForm()} style={{ ...pillBtn(false), fontSize: 10 }}>+ Add adjustment</button>}
                </div>
                {summary.adjustments.length === 0 ? (
                  <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint, padding: '10px 18px 20px', lineHeight: 1.6 }}>
                    No refunds, chargebacks or payout differences recorded for this period.{canAdd ? ' Use "Add adjustment" when a channel refunds a guest or pays out a different amount.' : ''}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                      <thead><tr>
                        <th style={th}>Date</th><th style={th}>Property</th><th style={th}>Kind</th><th style={th}>Channel</th><th style={th}>Reference</th><th style={th}>Booking</th><th style={th}>Notes</th>
                        <th style={{ ...th, textAlign: 'right' }}>Amount</th>{canAdd && <th style={th}></th>}
                      </tr></thead>
                      <tbody>
                        {summary.adjustments.slice().sort((a, b) => (b.adjustment_date || '').localeCompare(a.adjustment_date || '')).map(a => {
                          const bkg = a.booking_id ? (bookings || []).find(b => b.id === a.booking_id) : null
                          const prop = propById[a.property_id]
                          return (
                            <tr key={a.id}>
                              <td style={td}>{fmtDate(a.adjustment_date)}</td>
                              <td style={td}>{propLabel(a.property_id)}</td>
                              <td style={td}>{ADJUSTMENT_KINDS.find(k => k.v === a.kind)?.l || a.kind}</td>
                              <td style={td}>{a.channel || '—'}</td>
                              <td style={{ ...td, color: T.muted }}>{a.reference || '—'}</td>
                              <td style={{ ...td, color: T.muted }}>{bkg ? `${fmtDateShort(bkg.arrival)} · ${guestDisplayName(bkg.guest_name)}` : '—'}</td>
                              <td style={{ ...td, whiteSpace: 'normal', maxWidth: 260, color: T.muted }}>{a.notes || ''}</td>
                              <td style={{ ...tdR, fontWeight: 600, color: Number(a.amount) < 0 ? T.red : T.green }}>{fmtMoney(a.amount)}</td>
                              {canAdd && (
                                <td style={{ ...td, textAlign: 'right' }}>
                                  {prop && canEditCompany(prop.company_id) && (
                                    <button onClick={() => removeAdjustment(a)} aria-label="Delete adjustment" title="Delete adjustment"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, display: 'inline-flex' }}><Icon name="trash" size={14} /></button>
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Add adjustment modal */}
      {adjForm && (
        <div className="overlay" onClick={() => !saving && setAdjForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 1000, padding: isMobile ? 0 : 20 }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stl-adj-title" onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: isMobile ? '18px 18px 0 0' : 18, padding: isMobile ? '20px 18px 28px' : '24px 28px', width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto' }}>
            <h2 id="stl-adj-title" style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: T.text }}>Add adjustment</h2>
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
              Money out (a refund to a guest, a chargeback) is a negative amount. Money in (a cleaning fee, an extra payout) is positive. Gross never changes; Net does.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={monoLabel(T)}>Property</label>
                <select value={adjForm.property_id} onChange={e => { setA('property_id', e.target.value); setA('booking_id', '') }} style={inp(T)}>
                  <option value="">Choose…</option>
                  {stlProps.filter(p => canEditCompany(p.company_id)).map(p => (
                    <option key={p.id} value={p.id}>{p.name || p.address}{stlCompanies.length > 1 && coById[p.company_id]?.abbr ? ` · ${coById[p.company_id].abbr}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={monoLabel(T)}>Date</label>
                <input type="date" value={adjForm.adjustment_date} onChange={e => setA('adjustment_date', e.target.value)} style={inp(T)} />
              </div>
              <div>
                <label style={monoLabel(T)}>Kind</label>
                <select value={adjForm.kind} onChange={e => setA('kind', e.target.value)} style={inp(T)}>
                  {ADJUSTMENT_KINDS.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}
                </select>
              </div>
              <div>
                <label style={monoLabel(T)}>Amount (£){kindMeta?.negative ? ' · negative' : ''}</label>
                <input type="number" step="0.01" inputMode="decimal" value={adjForm.amount} placeholder={kindMeta?.negative ? '-120.00' : '0.00'}
                  onChange={e => setA('amount', e.target.value)} style={inp(T)} />
                {kindMeta?.hint && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 4 }}>{kindMeta.hint}</div>}
              </div>
              <div>
                <label style={monoLabel(T)}>Channel</label>
                <select value={KNOWN_CHANNELS.includes(adjForm.channel) || !adjForm.channel ? adjForm.channel : '__other'} onChange={e => setA('channel', e.target.value === '__other' ? adjForm.channel || '' : e.target.value)} style={inp(T)}>
                  <option value="">—</option>
                  {KNOWN_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  {adjForm.channel && !KNOWN_CHANNELS.includes(adjForm.channel) && <option value="__other">{adjForm.channel}</option>}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={monoLabel(T)}>Booking (optional)</label>
                <select value={adjForm.booking_id} onChange={e => setA('booking_id', e.target.value)} style={inp(T)} disabled={!adjForm.property_id}>
                  <option value="">Not linked to a booking</option>
                  {formBookings.map(b => (
                    <option key={b.id} value={b.id}>{fmtDateShort(b.arrival)} → {fmtDateShort(b.departure)} · {guestDisplayName(b.guest_name)} · {channelLabel(b.source)} · {fmtMoney(b.total_amount)}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={monoLabel(T)}>Reference</label>
                <input value={adjForm.reference} onChange={e => setA('reference', e.target.value)} placeholder="Payout / case reference" style={inp(T)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={monoLabel(T)}>Notes</label>
                <textarea value={adjForm.notes} onChange={e => setA('notes', e.target.value)} rows={2} style={{ ...inp(T), resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setAdjForm(null)} disabled={saving} style={{ fontFamily: MONO, fontSize: 12, padding: '9px 18px', borderRadius: 10 }}>Cancel</button>
              <button className="btn btn-gold" onClick={saveAdjustment} disabled={saving} style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: '9px 18px', borderRadius: 10 }}>{saving ? 'Saving…' : 'Save adjustment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
