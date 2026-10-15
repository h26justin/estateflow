// Rent: dated rent segments, future rent-month slots and the tenant
// payment tracker.
import { supabase } from '../supabase'
import { uid } from './_shared'

// Refurb CRUD moved to api/refurbs.js (refurb_projects / refurb_lines).

// Derive {year, month, month_label} from a YYYY-MM-DD period_start string.
function periodToMonthParts(periodStart) {
  const y = parseInt(periodStart.slice(0, 4), 10)
  const m = parseInt(periodStart.slice(5, 7), 10)
  return { year: y, month: m, month_label: new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) }
}

// Whole-month period bounds for a (year, month) pair — first and last day as
// YYYY-MM-DD. Every rent_payments writer stamps these when the caller doesn't
// supply explicit dates, so period_start is never NULL on new rows (MTD and
// other period-filtered readers rely on it).
function monthPeriodBounds(year, month) {
  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  return {
    period_start: `${year}-${mm}-01`,
    period_end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

// ── RENT SEGMENTS ─────────────────────────────────────────────────────────
// A "segment" is one dated rent row: period_start..period_end with a status and
// the amount actually logged for it. Multiple per month are allowed (tenant
// changeover mid-month, partial payment + balance, etc.). year/month/month_label
// are derived from period_start so existing month-based reporting still works.

export async function createRentSegment(propertyId, periodStart, periodEnd, status, amount, notes = '') {
  const { year, month, month_label } = periodToMonthParts(periodStart)
  const { data, error } = await supabase.from('rent_payments').insert({
    property_id: propertyId, user_id: await uid(),
    year, month, month_label, status, amount, notes,
    period_start: periodStart, period_end: periodEnd,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateRentSegment(id, fields) {
  const payload = { ...fields }
  // Keep the derived month columns in sync when the start date moves.
  if (payload.period_start) Object.assign(payload, periodToMonthParts(payload.period_start))
  const { data, error } = await supabase
    .from('rent_payments').update(payload).eq('id', id).select().single()
  if (error) throw error
  // Legacy whole-month rows (NULL period dates) get stamped on touch so they
  // become visible to period-filtered readers (MTD quarters etc). Best-effort
  // — the primary update already succeeded.
  if (!data.period_start && data.year && data.month) {
    const bounds = monthPeriodBounds(data.year, data.month)
    const { data: stamped } = await supabase
      .from('rent_payments').update(bounds).eq('id', id).select().single()
    if (stamped) return stamped
  }
  return data
}

export async function deleteRentSegment(id) {
  const { error } = await supabase.from('rent_payments').delete().eq('id', id)
  if (error) throw error
}

// ── AUTO-GENERATE FUTURE RENT MONTHS ─────────────────────
// Creates void payment slots up to 6 months ahead for all properties
export async function ensureFutureRentMonths(properties, monthsAhead = 6) {
  const userId = await uid()
  const now = new Date()

  // Build target months: current month up to 6 months ahead
  const targetMonths = []
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    targetMonths.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })
    })
  }

  // For each property, check which future months are missing and insert them
  const inserts = []
  for (const prop of properties) {
    const existing = prop.rent_payments || []
    for (const tm of targetMonths) {
      const alreadyExists = existing.some(p => p.year === tm.year && p.month === tm.month)
      if (!alreadyExists) {
        inserts.push({
          property_id: prop.id,
          user_id: userId,
          month_label: tm.label,
          year: tm.year,
          month: tm.month,
          status: 'void',
          ...monthPeriodBounds(tm.year, tm.month),
        })
      }
    }
  }

  if (inserts.length === 0) return 0

  // Insert in batches of 100
  for (let i = 0; i < inserts.length; i += 100) {
    const batch = inserts.slice(i, i + 100)
    const { error } = await supabase.from('rent_payments').insert(batch)
    if (error) throw error
  }

  return inserts.length
}

export async function fetchTenantPaymentTracker(propertyId) {
  // Get last 12 months of rent payments
  const { data, error } = await supabase.from('rent_payments')
    .select('*').eq('property_id', propertyId)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
