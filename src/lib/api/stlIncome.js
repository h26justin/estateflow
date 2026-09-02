// Short-Term Let income: bookings (read) and manual adjustments (read/write).
// Stage 6 of the Rent Tracker rebuild. See
// supabase-migrations/2026-09-02_stl_income.sql.
//
// Bookings are written only by the hostaway-sync / lodgify-sync edge
// functions (service role); the client never inserts or edits them. The
// arithmetic over these rows lives in ../stlIncome (pure, unit-tested).
import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const BOOKING_COLS = 'id, property_id, user_id, provider, source, status, guest_name, arrival, departure, currency, total_amount, amount_paid, amount_due, rent_payment_id, hostaway_reservation_id, hostaway_listing_id, lodgify_booking_id, lodgify_property_id, created_at, synced_at, property:properties(id,name,address,company_id,status)'
const ADJUSTMENT_COLS = 'id, booking_id, property_id, company_id, adjustment_date, amount, kind, channel, reference, notes, created_at, created_by'

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// Bookings for a set of STL properties. `from` / `to` bound the ARRIVAL date
// (that is the month a booking is counted in). Paged past the PostgREST cap
// and chunked on the id list so a big portfolio never hits a URL-length limit.
export async function fetchStlBookings({ companyId = null, propertyIds = [], from = null, to = null } = {}) {
  if (!propertyIds?.length) return []
  const rows = []
  for (const ids of chunk(propertyIds, 200)) {
    const page = await fetchAllPages(() => {
      let q = supabase.from('stl_bookings').select(BOOKING_COLS)
        .in('property_id', ids)
        .order('arrival', { ascending: false })
        .order('id', { ascending: true })
      if (from) q = q.gte('arrival', from)
      if (to) q = q.lte('arrival', to)
      return q
    })
    rows.push(...page)
  }
  return companyId ? rows.filter(r => r.property?.company_id === companyId) : rows
}

export async function fetchStlAdjustments({ companyId = null, propertyIds = [], from = null, to = null } = {}) {
  if (!propertyIds?.length) return []
  const rows = []
  for (const ids of chunk(propertyIds, 200)) {
    const page = await fetchAllPages(() => {
      let q = supabase.from('stl_adjustments').select(ADJUSTMENT_COLS)
        .in('property_id', ids)
        .order('adjustment_date', { ascending: false })
        .order('id', { ascending: true })
      if (from) q = q.gte('adjustment_date', from)
      if (to) q = q.lte('adjustment_date', to)
      return q
    })
    rows.push(...page)
  }
  return companyId ? rows.filter(r => r.company_id === companyId) : rows
}

const ADJUSTMENT_FIELDS = ['booking_id', 'property_id', 'company_id', 'adjustment_date', 'amount', 'kind', 'channel', 'reference', 'notes']
function cleanAdjustment(a) {
  const out = {}
  for (const k of ADJUSTMENT_FIELDS) {
    if (!(k in a)) continue
    let v = a[k]
    if (v === '') v = null
    if (k === 'amount' && v != null) v = Number(v)
    out[k] = v
  }
  return out
}

export async function createStlAdjustment(a) {
  const { data, error } = await supabase.from('stl_adjustments')
    .insert({ ...cleanAdjustment(a), user_id: await uid() })
    .select(ADJUSTMENT_COLS).single()
  if (error) throw friendly(error)
  return data
}

export async function deleteStlAdjustment(id) {
  const { error } = await supabase.from('stl_adjustments').delete().eq('id', id)
  if (error) throw friendly(error)
}

function friendly(error) {
  const msg = String(error?.message || '')
  if (msg.includes('stl_adjustments_sign_chk')) return new Error('Refunds and chargebacks must be entered as a negative amount.')
  if (msg.includes('stl_adjustments_amount_chk')) return new Error('An adjustment cannot be zero.')
  if (msg.includes('row-level security')) return new Error('You do not have permission to edit rent for this property.')
  return error
}
