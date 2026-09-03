import { supabase } from '../supabase'
import { extractStoragePaths, dealDocToPropertyCategory } from '../attachments'
import { loadCdnScript } from '../loadCdnScript'
import { collectClientFraudHeaders } from '../hmrcFraudHeaders'
import { sortPropertiesCanonically } from '../addressUtils'
import { DEFAULT_COPY_OPTIONS, isCopyOptionActive, buildDealCopyFields, buildMilestoneCopies } from '../dealCopy'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

// getSession() reads the cached session locally (no network); getUser() makes
// an HTTP round-trip to /auth/v1/user on EVERY call, which added ~100ms to
// every write. RLS revalidates the JWT server-side anyway.
const uid = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id) return session.user.id
  return (await supabase.auth.getUser()).data.user.id
}

export async function fetchCompanies() {
  const { data, error } = await supabase.from('companies').select('*').is('deleted_at', null).order('name')
  if (error) throw error
  return data
}
export async function createCompany(co) {
  const { data, error } = await supabase.from('companies').insert({ ...co, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateCompany(id, updates) {
  const { data, error } = await supabase.from('companies').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCompany(id) {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export async function fetchProperties() {
  // compliance_items joined so the portfolio list cards can show an
  // "Action needed" badge for expired / soon-to-expire certificates
  // without an extra round-trip per row.
  const { data, error } = await supabase
    .from('properties')
    .select('*, company:companies(id,name,abbr,color), refurb_projects(*, refurb_lines(*)), rent_payments(id,property_id,year,month,month_label,status,amount,notes,period_start,period_end,xero_reconciled), compliance_items(id,cert_type,cert_name,issue_date,expiry_date,deleted_at), stl_bookings(id,rent_payment_id), rent_receipts(id,received_date,amount,kind,payer,source,review_status,reverses_receipt_id,rent_allocations(id,rent_payment_id,target,amount,payment_plan_id)), payment_plans(id,tenancy_id,opening_balance,start_date,instalment_amount,frequency,due_day,status_override), non_chargeable_periods(id,start_date,end_date,reason,notes), rent_overrides(id,rent_payment_id,state,reason,expected_amount,created_at,created_by), tenancies(id,tenant_name,tenant_ref,tenancy_start,tenancy_end,notice_received_date,expected_move_out,rent_amount,rent_frequency,rent_due_day,payment_window_days,status,payment_source,benefit_type,benefit_contribution,tenant_contribution,benefit_frequency,benefit_next_payment_date,benefit_paid_to,opening_arrears,opening_arrears_date,needs_confirmation)')
    .is('deleted_at', null)
    // Refurb projects and their ledger lines are soft-deleted; keep Trash
    // rows out of every consumer (engine filters again client-side).
    .is('refurb_projects.deleted_at', null)
    .is('refurb_projects.refurb_lines.deleted_at', null)
    .order('sort_order', {ascending:true})
    .order('name', {ascending:true})
  if (error) throw error
  // Postgres name ordering is lexical ("Room 1, Room 10, Room 2") — re-sort
  // with the canonical natural comparator so every consumer of this array
  // (most pages render it as-is) reads correctly.
  return sortPropertiesCanonically(data)
}
export async function createProperty(prop) {
  const { data, error } = await supabase
    .from('properties').insert({ ...prop, user_id: await uid() })
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  // Fire-and-forget geocoding. Don't await — the caller doesn't need to wait,
  // and we don't want a slow Mapbox response to block the UI feedback for a save.
  // If it fails, the lazy geocoder on Map page open will retry later.
  if (data?.address) {
    geocodeProperty(data.id, data.address).catch(() => {})
  }
  return { ...data, refurb_projects: [], rent_payments: [], tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], payment_plans: [] }
}

/**
 * Bulk-create properties in a single round-trip. Used by the "Add Block of Flats"
 * wizard. All properties are tagged with the current user_id and the joined
 * company info is selected back so the UI can append them without a re-fetch.
 *
 * Returns the array of created rows in the same order as input. Geocoding is
 * fired-and-forgotten per row, just like createProperty.
 *
 * Throws on the first DB error — partial success is NOT swallowed because that
 * would leave the user in a confusing half-saved state. The wizard validates
 * inputs before calling this so DB errors should be rare.
 */
export async function bulkCreateProperties(props) {
  if (!Array.isArray(props) || props.length === 0) return []
  const u = await uid()
  const rows = props.map(p => ({ ...p, user_id: u }))
  const { data, error } = await supabase
    .from('properties').insert(rows)
    .select('*, company:companies(id,name,abbr,color)')
  if (error) throw error
  // Geocode each new property in the background.
  for (const row of (data || [])) {
    if (row?.address) geocodeProperty(row.id, row.address).catch(() => {})
  }
  return (data || []).map(d => ({ ...d, refurb_projects: [], rent_payments: [], tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], payment_plans: [] }))
}

export async function updateProperty(id, updates) {
  const { data, error } = await supabase
    .from('properties').update(updates).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  // If the address changed, re-geocode (fire-and-forget). Skips manually-pinned rows.
  if (updates.address && data?.address) {
    geocodeProperty(data.id, data.address).catch(() => {})
  }
  return data
}
export async function deleteProperty(id) {
  const { error } = await supabase.from('properties').delete().eq('id', id)
  if (error) throw error
}

/**
 * Duplicate a property — creates a fresh row with the same financial / status
 * data but a new ID. Children (refurb_projects, compliance_items,
 * tenancy, etc.) are NOT cloned — duplicated properties start with a clean slate.
 * Name is suffixed with " (copy)" for clarity.
 */
export async function duplicateProperty(propertyId) {
  // Fetch the source row directly (raw, no joins) so we get every column
  const { data: source, error: fetchErr } = await supabase
    .from('properties').select('*').eq('id', propertyId).single()
  if (fetchErr) throw fetchErr
  if (!source) throw new Error('Property not found')

  // Strip identity, audit, soft-delete, archive, sale, and stateful fields
  // — the duplicate is a fresh property, not a snapshot in time.
  // arrears in particular shouldn't carry over — it's a current-state figure.
  const {
    id, created_at, updated_at,
    deleted_at, deleted_by,
    archived_at, sale_price, sale_date,
    arrears,
    user_id: _ignored,           // recreated from auth context below
    ...payload
  } = source

  const newName = (source.name || 'Untitled') + ' (copy)'
  const { data: created, error: insertErr } = await supabase
    .from('properties')
    .insert({ ...payload, name: newName, user_id: await uid() })
    .select('*, company:companies(id,name,abbr,color)').single()
  if (insertErr) throw insertErr
  return { ...created, refurb_projects: [], rent_payments: [] }
}

/** Archive a property — hides from active list. Reversible. */
export async function archiveProperty(id) {
  const { data, error } = await supabase.from('properties')
    .update({ archived_at: new Date().toISOString() }).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}

/** Reverse archiveProperty. */
export async function unarchiveProperty(id) {
  const { data, error } = await supabase.from('properties')
    .update({ archived_at: null }).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}

/**
 * Generate a single-property summary PDF and trigger download.
 * Lazy-loads jsPDF from CDN if not already present (matches ReportsPage pattern).
 * Returns nothing — opens a download in the browser.
 */
export async function exportPropertySummaryPDF(property) {
  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, margin = 16
  const fmt = n => 'GBP ' + new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n || 0)

  let y = margin

  // Header
  doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text(property.name || 'Property Summary', margin, y); y += 8
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 118, 145)
  if (property.address) { doc.text(property.address, margin, y); y += 5 }
  if (property.prop_type) { doc.text(property.prop_type, margin, y); y += 5 }
  doc.text('Generated ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), margin, y); y += 10

  doc.setTextColor(26, 37, 48)

  // Helper: render a section with key/value rows
  function section(title, rows) {
    if (y > 260) { doc.addPage(); y = margin }
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 118, 145)
    doc.text(title.toUpperCase(), margin, y); y += 5
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 37, 48)
    rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '').forEach(([k, v]) => {
      if (y > 280) { doc.addPage(); y = margin }
      doc.text(String(k), margin, y)
      doc.text(String(v), W - margin, y, { align: 'right' })
      y += 5
    })
    y += 4
  }

  // Status / company
  section('Overview', [
    ['Status',  property.status || '—'],
    ['Company', property.company?.name || '—'],
    ['Bedrooms', property.bedrooms],
    ['Bathrooms', property.bathrooms],
  ])

  // Financials
  const totalInvested = (property.purchase_price || 0) + (property.refurb_cost || 0)
    + (property.stamp_duty || 0) + (property.legal_fees || 0)
  const currentVal = property.current_value || property.est_value || 0
  const equity = currentVal - (property.mortgage_amount || 0)
  const annualRent = (property.rent_pcm || 0) * 12
  const yieldDenom = (property.purchase_price || 0) + (property.refurb_cost || 0)
  const grossYield = yieldDenom && property.rent_pcm ? ((property.rent_pcm * 12) / yieldDenom * 100) : 0

  section('Purchase & Costs', [
    ['Purchase Price', fmt(property.purchase_price)],
    ['Deposit',        fmt(property.deposit)],
    ['Refurb Cost',    fmt(property.refurb_cost)],
    ['Stamp Duty',     fmt(property.stamp_duty)],
    ['Legal Fees',     fmt(property.legal_fees)],
    ['Total Invested', fmt(totalInvested)],
  ])

  section('Mortgage', [
    ['Mortgage Amount', fmt(property.mortgage_amount)],
    ['Mortgage Rate',   property.mortgage_rate ? (property.mortgage_rate * 100).toFixed(2) + '%' : null],
    ['Mortgage Term',   property.mortgage_term ? property.mortgage_term + ' years' : null],
    ['LTV',             currentVal && property.mortgage_amount
      ? ((property.mortgage_amount / currentVal) * 100).toFixed(1) + '%' : null],
  ])

  section('Returns', [
    ['Estimated Value', fmt(property.est_value)],
    ['Current Value',   fmt(currentVal)],
    ['Equity',          fmt(equity)],
    ['Monthly Rent',    fmt(property.rent_pcm)],
    ['Annual Rent',     fmt(annualRent)],
    ['Gross Yield',     grossYield > 0 ? grossYield.toFixed(2) + '%' : null],
  ])

  if (property.status === 'sold') {
    section('Sale', [
      ['Sale Price', fmt(property.sale_price)],
      ['Sale Date',  property.sale_date],
      ['Capital Gain (gross)', fmt((property.sale_price || 0) - totalInvested)],
    ])
  }

  // Footer
  doc.setFontSize(8); doc.setTextColor(160, 165, 178)
  doc.text('Properly — Property Summary', margin, 290)

  // Trigger download
  const safeName = (property.name || 'property').replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  doc.save(`${safeName}_summary.pdf`)
}

/**
 * Mark a property as sold. Sets status='sold', records sale_price + sale_date.
 * Does NOT archive — sold properties stay visible so they appear in capital
 * gains reports. Caller can archive separately if desired.
 */
export async function markPropertyAsSold(id, salePrice, saleDate) {
  const { data, error } = await supabase.from('properties')
    .update({
      status: 'sold',
      sale_price: salePrice,
      sale_date: saleDate,
    }).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}

// ── GEOCODING & MAP ──────────────────────────────────────────────────────────

/**
 * Returns the public Mapbox token configured at build time.
 * If the token is missing, the geocode/map features will silently no-op
 * with a clear console warning rather than crash the app.
 */
export function getMapboxToken() {
  const token = import.meta.env?.VITE_MAPBOX_TOKEN
  if (!token) {
    console.warn('[OwnProperly] VITE_MAPBOX_TOKEN is not set. Map and geocoding features will not work.')
    return null
  }
  return token
}

/**
 * Geocode an address using the Mapbox Geocoding API (forward geocoding).
 * UK-biased (`country=gb`) for better hit rate on UK addresses.
 *
 * Returns { latitude, longitude, place_name } on success, null on failure.
 * Does NOT write to the database — caller is responsible for persistence.
 */
export async function geocodeAddress(address) {
  const token = getMapboxToken()
  if (!token || !address) return null
  const q = encodeURIComponent(address.trim())
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?country=gb&limit=1&access_token=${token}`
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const data = await r.json()
    const feature = data?.features?.[0]
    if (!feature?.center || feature.center.length !== 2) return null
    const [longitude, latitude] = feature.center
    return { latitude, longitude, place_name: feature.place_name || null }
  } catch (e) {
    console.warn('[OwnProperly] Geocoding failed:', e?.message)
    return null
  }
}

/**
 * Geocode a property's address and persist the result to the property row.
 * Skips properties that have been manually pinned (geocode_pinned=true).
 * Returns the updated property row on success, null on failure.
 *
 * Does NOT throw on geocoding failure — failure marks the row with status='failed'
 * so the UI can surface a "couldn't find this address" message without crashing.
 */
export async function geocodeProperty(propertyId, address) {
  if (!address) return null
  const result = await geocodeAddress(address)
  if (!result) {
    // Mark as failed so we don't keep retrying every page load
    await supabase.from('properties').update({
      geocode_status: 'failed',
      geocoded_at: new Date().toISOString(),
    }).eq('id', propertyId).is('geocode_pinned', false)
    return null
  }
  const { data, error } = await supabase.from('properties').update({
    latitude: result.latitude,
    longitude: result.longitude,
    geocoded_at: new Date().toISOString(),
    geocode_status: 'ok',
  }).eq('id', propertyId).is('geocode_pinned', false)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) {
    // If the .is(geocode_pinned, false) filter excluded the row (because it
    // was already pinned by the user), `single()` returns an error. That's
    // not a real failure — return null silently.
    return null
  }
  return data
}

/**
 * For the Map view: geocode any properties that don't have coordinates yet.
 * Runs in parallel with a small concurrency limit so we don't hammer the API.
 * Returns the count of newly-geocoded properties.
 */
export async function geocodeMissingProperties(properties, onProgress = null) {
  const candidates = (properties || []).filter(p =>
    p.address &&
    p.geocode_status !== 'ok' &&
    p.geocode_status !== 'failed' && // already-failed addresses don't auto-retry
    !p.archived_at
  )
  if (candidates.length === 0) return 0
  let done = 0
  // Limit concurrency to 3 — Mapbox free tier is 600 req/min, so this is fine.
  const concurrency = 3
  const queue = [...candidates]
  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift()
      if (!p) break
      await geocodeProperty(p.id, p.address)
      done++
      if (onProgress) onProgress(done, candidates.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return done
}

/**
 * Save a manually-placed pin location.
 * Sets geocode_pinned=true so subsequent automatic geocoding will not overwrite.
 */
export async function setPropertyPin(id, latitude, longitude) {
  const { data, error } = await supabase.from('properties').update({
    latitude,
    longitude,
    geocode_pinned: true,
    geocoded_at: new Date().toISOString(),
    geocode_status: 'ok',
  }).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}

/**
 * Reset a manually-placed pin back to "auto-geocoded" mode and re-geocode.
 * Useful when a user wants to undo their drag.
 */
export async function resetPropertyPin(id, address) {
  // First clear the pinned flag
  await supabase.from('properties').update({
    geocode_pinned: false,
    geocode_status: null,  // force re-geocode
  }).eq('id', id)
  // Then re-geocode
  return await geocodeProperty(id, address)
}

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

// Legacy month-keyed upsert. The (property,year,month) unique constraint was
// dropped (a month can now hold multiple dated segments), so we can't use
// ON CONFLICT anymore — do a manual find-or-insert keyed on the whole month.
// Used by the App.jsx month strip toggle for properties that still only have
// one full-month row. For day-level ranges use createRentSegment instead.
export async function upsertRentPayment(propertyId, year, month, status, amount, notes, periodStart, periodEnd) {
  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const payload = { property_id: propertyId, user_id: await uid(), year, month, month_label: monthLabel, status, amount, notes }
  if (periodStart) payload.period_start = periodStart
  if (periodEnd)   payload.period_end   = periodEnd
  const { data: existing } = await supabase
    .from('rent_payments').select('id, period_start, period_end')
    .eq('property_id', propertyId).eq('year', year).eq('month', month)
    .order('period_start', { ascending: true, nullsFirst: true })
    .limit(1).maybeSingle()
  // Stamp whole-month period dates when the caller didn't supply any and the
  // row doesn't already have them — never overwrite an existing dated segment.
  if (!periodStart && !existing?.period_start) {
    const bounds = monthPeriodBounds(year, month)
    payload.period_start = bounds.period_start
    payload.period_end = periodEnd || existing?.period_end || bounds.period_end
  }
  const q = existing
    ? supabase.from('rent_payments').update(payload).eq('id', existing.id)
    : supabase.from('rent_payments').insert(payload)
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
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
// ── PROPERTY INSPECTIONS ──────────────────────────────────────────────────
// Mid-tenancy / check-in / check-out inspections with photo evidence.
// See migration 2026-05-24_property_inspections.sql for the table shape.

export async function fetchInspections(propertyId) {
  const { data, error } = await supabase
    .from('property_inspections')
    .select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('scheduled_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllInspections(userId) {
  const { data, error } = await supabase
    .from('property_inspections')
    .select('*, property:properties(id,name,address,company_id)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('scheduled_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createInspection(propertyId, inspection) {
  const { data, error } = await supabase
    .from('property_inspections')
    .insert({ ...inspection, property_id: propertyId, user_id: await uid() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateInspection(id, updates) {
  const { data, error } = await supabase
    .from('property_inspections')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function softDeleteInspection(id, deletedBy) {
  const { error } = await supabase
    .from('property_inspections')
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq('id', id)
  if (error) throw error
}

// Upload an inspection photo. Returns a URL the inspection row can
// reference in its photos jsonb array.
export async function uploadInspectionPhoto(propertyId, file, caption = '') {
  const userId = await uid()
  const safeName = (file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
  const path = `${userId}/inspections/${propertyId}/${Date.now()}_${safeName}`
  const { error: upErr } = await supabase.storage.from('property-documents')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (upErr) throw upErr
  // Short-lived signed URL for the immediate upload preview only; rendering
  // goes through SignedPhoto(path), which signs fresh URLs on demand.
  const { data: urlData } = await supabase.storage.from('property-documents')
    .createSignedUrl(path, 60 * 60)
  return {
    url: urlData?.signedUrl || null,
    path,
    caption,
    taken_at: new Date().toISOString(),
  }
}

// ── USER COMPANY ACCESS ────────────────────────────────────────────────────
export async function fetchUserAccessByEmail(email) {
  if (!email) return []
  const { data, error } = await supabase
    .from('user_company_access')
    .select('*')
    .eq('email', email)
  if (error) return []
  return data || []
}

export async function updateUserIdByEmail(email, userId) {
  try {
    await supabase.from('user_company_access')
      .update({ user_id: userId })
      .eq('email', email)
      .neq('user_id', userId)
  } catch(e) { }
}

export async function fetchUserAccess(userId) {
  const { data, error } = await supabase
    .from('user_company_access')
    .select('*')
    .eq('user_id', userId)
  // If table doesn't exist, return empty (admin mode)
  if (error) return []
  return data || []
}

export async function updateUserAccess(userId, companyId, email, grant) {
  if (grant) {
    const { error } = await supabase.from('user_company_access')
      .upsert({ user_id: userId, company_id: companyId, email, is_admin: false },
        { onConflict: 'user_id,company_id' })
    if (error) throw error
  } else {
    const { error } = await supabase.from('user_company_access')
      .delete().eq('user_id', userId).eq('company_id', companyId)
    if (error) throw error
  }
}

// ── ROLE MANAGEMENT ───────────────────────────────────────────────────────────
// Update a user's role on a company. Role is one of: 'admin','editor','viewer'
export async function updateUserRole(userId, companyId, role, permissionOverrides = {}) {
  const validRoles = ['admin','editor','viewer']
  if (!validRoles.includes(role)) throw new Error('Invalid role: ' + role)
  const { error } = await supabase.from('user_company_access')
    .update({ role, permissions: permissionOverrides, is_admin: role === 'admin' })
    .eq('user_id', userId)
    .eq('company_id', companyId)
  if (error) throw error
}

// ── ROLE DEFAULTS ─────────────────────────────────────────────────────────────
// Each role has a default set of permissions. These can be overridden per-user
// via the permissions JSONB column.
export const ROLE_DEFAULTS = {
  owner: {
    // Owner has everything (hardcoded in code, never stored)
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: true, edit_financial: true,
    view_expenses: true, edit_expenses: true,
    manage_users: true,
    edit_company_settings: true,
    delete_company: true,
    access_billing: true,
    download_reports: true,
  },
  admin: {
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: true, edit_financial: true,
    view_expenses: true, edit_expenses: true,
    manage_users: true,
    edit_company_settings: true,
    delete_company: false,       // only owner
    access_billing: false,       // only owner
    download_reports: true,
  },
  editor: {
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: false, edit_financial: false,    // hidden by default
    view_expenses: true, edit_expenses: true,
    manage_users: false,
    edit_company_settings: false,
    delete_company: false,
    access_billing: false,
    download_reports: true,
  },
  viewer: {
    view_properties: true, edit_properties: false,
    view_tenancies: true, edit_tenancies: false,
    view_tenant_personal: false,       // GDPR-friendly default
    view_rent: true, edit_rent: false,
    view_compliance: true, edit_compliance: false,
    view_maintenance: true, edit_maintenance: false,
    view_financial: false, edit_financial: false,
    view_expenses: true, edit_expenses: false,
    manage_users: false,
    edit_company_settings: false,
    delete_company: false,
    access_billing: false,
    download_reports: true,
  },
}

// Friendly labels for each permission key
export const PERMISSION_LABELS = {
  view_properties: 'View properties',
  edit_properties: 'Edit properties',
  view_tenancies: 'View tenancies',
  edit_tenancies: 'Edit tenancies',
  view_tenant_personal: 'View tenant personal data (names, contacts)',
  view_rent: 'View rent records & arrears',
  edit_rent: 'Edit rent records',
  view_compliance: 'View compliance certificates',
  edit_compliance: 'Add/edit compliance certificates',
  view_maintenance: 'View maintenance jobs',
  edit_maintenance: 'Add/edit maintenance jobs',
  view_financial: 'View financial data (mortgages, equity, yields)',
  edit_financial: 'Edit financial data',
  view_expenses: 'View expenses',
  edit_expenses: 'Add/edit expenses',
  manage_users: 'Invite/remove users',
  edit_company_settings: 'Edit company settings & branding',
  delete_company: 'Delete company / transfer ownership',
  access_billing: 'Access billing & subscription',
  download_reports: 'Download reports & exports',
}

// Permission groups (for organizing the UI)
export const PERMISSION_GROUPS = [
  { label: 'Properties', keys: ['view_properties','edit_properties'] },
  { label: 'Tenancies', keys: ['view_tenancies','edit_tenancies','view_tenant_personal'] },
  { label: 'Rent', keys: ['view_rent','edit_rent'] },
  { label: 'Compliance', keys: ['view_compliance','edit_compliance'] },
  { label: 'Maintenance', keys: ['view_maintenance','edit_maintenance'] },
  { label: 'Financial', keys: ['view_financial','edit_financial'] },
  { label: 'Expenses', keys: ['view_expenses','edit_expenses'] },
  { label: 'Administration', keys: ['manage_users','edit_company_settings','delete_company','access_billing','download_reports'] },
]

// Resolve a user's effective permissions for a company
// accessRow can be undefined (non-member), then returns all-false
// If user is owner (company.owner_id === user.id), returns ROLE_DEFAULTS.owner
export function getEffectivePermissions(accessRow, isOwner = false) {
  if (isOwner) return { ...ROLE_DEFAULTS.owner }
  if (!accessRow) return Object.keys(ROLE_DEFAULTS.admin).reduce((acc,k)=>({...acc,[k]:false}),{})
  const role = accessRow.role || (accessRow.is_admin ? 'admin' : 'editor')
  const base = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.editor
  const overrides = accessRow.permissions || {}
  return { ...base, ...overrides }
}

// Check a single permission for a user on a company
export function hasPermission(accessRow, permissionKey, isOwner = false) {
  if (isOwner) return true
  const perms = getEffectivePermissions(accessRow, isOwner)
  return perms[permissionKey] === true
}


// ── COMPANY SETTINGS ──────────────────────────────────────
export async function fetchCompanySettings(companyId) {
  const { data, error } = await supabase.from('company_settings').select('*').eq('company_id', companyId).single()
  if (error) return null
  return data
}
export async function upsertCompanySettings(companyId, settings) {
  const userId = await uid()
  const { data, error } = await supabase.from('company_settings')
    .upsert({ ...settings, company_id: companyId, user_id: userId }, { onConflict: 'company_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── COMPLIANCE ────────────────────────────────────────────
export async function fetchCompliance(propertyId) {
  const { data, error } = await supabase.from('compliance_items').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}
export async function createCompliance(propertyId, item) {
  const { data, error } = await supabase.from('compliance_items').insert({ ...item, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}

/**
 * Convert a UK date string (DD/MM/YYYY, DD-MM-YYYY, or already YYYY-MM-DD)
 * to ISO YYYY-MM-DD. Returns null if unparseable.
 */
export function ukDateToISO(s) {
  if (!s || typeof s !== 'string') return null
  const trimmed = s.trim()
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (!m) return null
  let [, dd, mm, yyyy] = m
  if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? '19' : '20') + yyyy
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
}

/**
 * Given a property document with completed OCR extraction, build a
 * compliance_items row. Returns null if the doc isn't a recognisable cert
 * (no doc_type / no expiry_date).
 *
 * Maps DocumentsTab category codes to CANONICAL compliance cert types
 * (see lib/complianceCatalogue.js — 'gas' the doc category becomes
 * 'gas_safety' the cert_type; historical rows written as 'gas' still
 * match via the catalogue's alias map):
 *   gas      -> 'gas_safety' (Gas Safety Certificate)
 *   eicr     -> 'eicr'       (Electrical Installation Condition Report)
 *   epc      -> 'epc'        (Energy Performance Certificate)
 *   insurance-> 'insurance'
 */
export function buildComplianceFromDoc(doc) {
  if (!doc || !doc.extracted_fields) return null
  const f = doc.extracted_fields
  const expiry = ukDateToISO(f.expiry_date || f.cover_end || f.valid_to)
  if (!expiry) return null

  const certByCategory = {
    gas:       { cert_type: 'gas_safety', cert_name: 'Gas Safety (CP12)' },
    eicr:      { cert_type: 'eicr',       cert_name: 'EICR' },
    epc:       { cert_type: 'epc',        cert_name: 'EPC' },
    insurance: { cert_type: 'insurance',  cert_name: 'Landlord Insurance' },
  }
  const mapped = certByCategory[doc.category]
  if (!mapped) return null
  const { cert_type, cert_name } = mapped

  const issue = ukDateToISO(f.inspection_date || f.valid_from || f.cover_start)
  return {
    cert_type,
    cert_name,
    issue_date: issue,
    expiry_date: expiry,
    reminder_days: 30,
    notes: 'Auto-created from uploaded document.',
    document_id: doc.id,
  }
}

/**
 * Find an existing compliance item already linked to this document.
 * Returns the row if linked, else null.
 */
export async function fetchComplianceForDocument(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('compliance_items')
    .select('id, cert_type, cert_name, expiry_date')
    .eq('document_id', documentId)
    .limit(1)
  if (error) return null
  return data?.[0] || null
}
export async function updateCompliance(id, updates) {
  const { data, error } = await supabase.from('compliance_items').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Upload a certificate file and register it as a property document in one
// step (Compliance tab row attach). Unlike uploadDocument, returns the full
// inserted row so the caller can link property_documents.id onto the
// compliance item (compliance_items.document_id).
export async function attachComplianceDocument(propertyId, propertyName, file, category = 'other') {
  validateUpload(file)
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/properties/${propertyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data, error } = await supabase.from('property_documents').insert({
    property_id: propertyId, property_name: propertyName,
    name: file.name, file_path: path,
    size: file.size, type: file.type, category, user_id: userId,
  }).select().single()
  if (error) throw error
  return data
}

// Open-a-certificate helper: resolve a property_documents id to a fresh
// signed URL (private bucket — never cache).
export async function getDocumentSignedUrlById(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('property_documents')
    .select('file_path').eq('id', documentId).single()
  if (error || !data?.file_path) return null
  return getDocumentSignedUrl(data.file_path)
}
// Soft-delete. compliance_items has a deleted_at column; the Trash page
// expects rows to live for 30 days post-deletion so users can recover.
// Previously this did a hard .delete() which bypassed that guarantee.
export async function deleteCompliance(id) {
  const { error } = await supabase
    .from('compliance_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
export async function fetchAllCompliance(userId) {
  const { data, error } = await supabase.from('compliance_items')
    .select('*, property:properties(name,company_id)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}

// ── TENANCY DETAILS ───────────────────────────────────────
export async function upsertTenancyDetails(propertyId, details) {
  const { data, error } = await supabase.from('tenancy_details')
    .upsert({ ...details, property_id: propertyId, user_id: await uid() }, { onConflict: 'property_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── MAINTENANCE ───────────────────────────────────────────
export async function fetchMaintenance(propertyId) {
  const { data, error } = await supabase.from('maintenance_jobs').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createMaintenance(propertyId, job) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({ ...job, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateMaintenance(id, updates) {
  const { data, error } = await supabase.from('maintenance_jobs').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
// Soft-delete (see deleteCompliance for context).
export async function deleteMaintenance(id) {
  const { error } = await supabase
    .from('maintenance_jobs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── EXPENSES ─────────────────────────────────────────────
export async function fetchExpenses(propertyId) {
  const { data, error } = await supabase.from('property_expenses').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('date', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createExpense(propertyId, expense) {
  const { data, error } = await supabase.from('property_expenses').insert({ ...expense, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateExpense(id, updates) {
  const { data, error } = await supabase.from('property_expenses').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
// Soft-delete (see deleteCompliance for context).
export async function deleteExpense(id) {
  const { error } = await supabase
    .from('property_expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
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

// ── USER THEME PREFERENCE ─────────────────────────────────────────────────────
export async function fetchThemePreference(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('dark_mode').eq('user_id', userId).single()
    if (data && data.dark_mode !== null && data.dark_mode !== undefined) {
      return data.dark_mode
    }
  } catch(e) {}
  return null // null = not set yet, use default
}

export async function saveThemePreference(userId, email, darkMode) {
  try {
    await supabase.from('user_profiles').upsert(
      { user_id: userId, email, dark_mode: darkMode, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  } catch(e) { }
}

// ── USER PROFILE ──────────────────────────────────────────────────────────────
export async function fetchUserProfile(userId) {
  const { data } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single()
  return data || null
}

export async function upsertUserProfile(userId, email, updates) {
  const { data, error } = await supabase.from('user_profiles')
    .upsert({ ...updates, user_id: userId, email, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function updateUserEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail })
  if (error) throw error
}

export async function updateUserPassword(currentPassword, newPassword, email) {
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (signInErr) throw new Error('Current password is incorrect')
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function sendPasswordReset(email) {
  // redirectTo lands the recovery link on the app origin, where AuthContext's
  // PASSWORD_RECOVERY handler shows the set-new-password screen.
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  if (error) throw error
}

// ── PROPERTY NOTES ────────────────────────────────────────────────────────────
export async function fetchNotes(propertyId, category) {
  let q = supabase.from('property_notes').select('*').eq('property_id', propertyId)
  if (category) q = q.eq('category', category)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createNote(propertyId, content, category, userId, userEmail) {
  // The DB column is `note` (NOT NULL), and the UI renders `n.note`.
  // This insert wrote `content` since day one, so saving always failed with
  // "Could not find the 'content' column of 'property_notes'".
  const { data, error } = await supabase.from('property_notes')
    .insert({ property_id: propertyId, note: content, category, user_id: userId, user_email: userEmail })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('property_notes').delete().eq('id', id)
  if (error) throw error
}

// ── PROPERTY DOCUMENTS ────────────────────────────────────────────────────────
export async function fetchDocuments(propertyId) {
  const { data, error } = await supabase.from('property_documents')
    .select('*').eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// File upload validation — applied to every Storage write so the bucket
// can't be used as free file hosting / malware drop / runaway-bill source.
//
// Limits:
//   * Per-file size: 25 MB (covers a typical Gas Safety PDF, tenancy
//     agreement, large scanned mortgage offer). Images get a tighter
//     cap because the receipt-scan flow always re-encodes them anyway.
//   * MIME type allow-list: documents (pdf, docx, doc, xlsx, xls, csv,
//     txt), images (jpeg, png, webp, heic, heif), email exports (eml,
//     msg). Everything else is rejected at the client before any byte
//     hits Storage.
//
// The extension is taken from the filename for the storage path, but
// the MIME check is what gates the upload — extension alone is
// trivially spoofed.
const MAX_FILE_BYTES   = 25 * 1024 * 1024     // 25 MB
const MAX_IMAGE_BYTES  = 10 * 1024 * 1024     // 10 MB for raw images
const ALLOWED_MIME = new Set([
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  // images
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  // emails (statement importer)
  'message/rfc822', 'application/vnd.ms-outlook',
])
function validateUpload(file) {
  if (!file) throw new Error('No file selected.')
  if (file.size === 0) throw new Error('That file is empty (0 bytes).')
  const isImage = (file.type || '').startsWith('image/')
  const cap = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
  if (file.size > cap) {
    const mb = (cap / 1024 / 1024).toFixed(0)
    throw new Error(`File is too large. Maximum size for ${isImage ? 'images' : 'documents'} is ${mb} MB.`)
  }
  // Browsers occasionally leave file.type empty (e.g. some Safari paths
  // for .heic, or files dropped from Finder with no extension). Allow that
  // ONLY if the extension is in our allow-list, since extension is at
  // least a weak signal. Otherwise hard-reject.
  const type = (file.type || '').toLowerCase()
  if (type && !ALLOWED_MIME.has(type)) {
    throw new Error(`That file type (${type}) isn't allowed. Use PDF, Word, Excel, CSV, or images.`)
  }
  if (!type) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const okExts = ['pdf','doc','docx','xls','xlsx','csv','txt','jpg','jpeg','png','webp','heic','heif','eml','msg']
    if (!okExts.includes(ext)) {
      throw new Error('That file type isn\'t allowed. Use PDF, Word, Excel, CSV, or images.')
    }
  }
}

export async function uploadDocument(propertyId, propertyName, file, userId) {
  validateUpload(file)
  const ext = file.name.split('.').pop()
  // Path layout: {user_id}/properties/{propertyId}/{ts}.{ext}
  // Top-level folder = user id, so the storage RLS policy (which checks
  // foldername[1] = auth.uid()) admits the user's own writes.
  const path = `${userId}/properties/${propertyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  // Bucket is private — do NOT store a public URL. Always generate signed URLs
  // on demand via getDocumentSignedUrl(). file_path is the canonical reference.
  const { error: dbErr } = await supabase.from('property_documents').insert({
    property_id: propertyId, property_name: propertyName,
    name: file.name, file_path: path,
    size: file.size, type: file.type, user_id: userId,
  })
  if (dbErr) throw dbErr
  return path
}

/**
 * Get a short-lived signed URL for a private document.
 * Returns a URL that expires after `expiresIn` seconds (default 5 minutes).
 * Use this every time you need to surface a doc to the user — never cache it.
 */
export async function getDocumentSignedUrl(filePath, expiresIn = 300) {
  if (!filePath) return null
  const { data, error } = await supabase.storage
    .from('property-documents')
    .createSignedUrl(filePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

export async function deleteDocument(doc) {
  // Soft-delete: flip deleted_at. Storage file stays until 30-day purge/hard-delete.
  const userId = await uid()
  const { error } = await supabase.from('property_documents')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', doc.id)
  if (error) throw error
}

// Permanent removal: deletes Storage file AND the DB row. Use only from Trash purge.
export async function hardDeleteDocument(doc) {
  if (doc.file_path) {
    try { await supabase.storage.from('property-documents').remove([doc.file_path]) } catch(e) {}
  }
  const { error } = await supabase.from('property_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// ── COMPANY DOCUMENTS ─────────────────────────────────────────────────────────
export async function fetchCompanyDocuments(companyId) {
  const { data, error } = await supabase.from('company_documents')
    .select('*').eq('company_id', companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Attach an insurance policy schedule (etc.) as a company document,
// returning the inserted row so insurance_policies.document_id can link it.
export async function attachPolicyDocument(companyId, file) {
  validateUpload(file)
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/company_documents/${companyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data, error } = await supabase.from('company_documents').insert({
    company_id: companyId, name: file.name, file_path: path,
    size: file.size, type: file.type, category: 'insurance', user_id: userId,
  }).select().single()
  if (error) throw error
  return data
}

// Resolve a company_documents id to a fresh signed URL (same private bucket).
export async function getCompanyDocumentSignedUrlById(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('company_documents')
    .select('file_path').eq('id', documentId).single()
  if (error || !data?.file_path) return null
  return getDocumentSignedUrl(data.file_path)
}

export async function uploadCompanyDocument(companyId, file, userId) {
  validateUpload(file)
  const ext = file.name.split('.').pop()
  // {user_id}/company_documents/{companyId}/{ts}.{ext} — see uploadDocument for layout rationale
  const path = `${userId}/company_documents/${companyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  // Private bucket — no public URL storage.
  await supabase.from('company_documents').insert({
    company_id: companyId, name: file.name,
    file_path: path,
    size: file.size, type: file.type, user_id: userId,
  })
  return path
}

// Soft-delete. company_documents has deleted_at + deleted_by columns.
// We KEEP the storage file in place during the 30-day retention window
// so a restore from Trash gets the file back intact; the purge cron is
// responsible for removing the underlying blob when it hard-deletes.
export async function deleteCompanyDocument(doc) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('company_documents')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', doc.id)
  if (error) throw error
}

// ── USER ACCESS MANAGEMENT ────────────────────────────────────────────────────
export async function fetchAllUsers() {
  const { data, error } = await supabase.rpc('list_auth_users')
  if (error) throw error
  const users = data || []
  // Enrich with profile data (first_name, last_name, full_name, phone)
  try {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, full_name, phone')
    if (profiles) {
      const profileMap = {}
      profiles.forEach(p => { profileMap[p.user_id] = p })
      return users.map(u => ({ ...u, profile: profileMap[u.id] || null }))
    }
  } catch(e) { /* Fall back to basic user list if profile fetch fails */ }
  return users
}

export async function fetchAllAccessRows() {
  const { data, error } = await supabase.from('user_company_access').select('*')
  if (error) throw error
  return data || []
}

export async function grantCompanyAccess(userId, companyId, email) {
  const { error } = await supabase.from('user_company_access')
    .insert({ user_id: userId, company_id: companyId, email, is_admin: false })
  if (error) throw error
}

export async function revokeCompanyAccess(userId, companyId) {
  const { error } = await supabase.from('user_company_access')
    .delete().eq('user_id', userId).eq('company_id', companyId)
  if (error) throw error
}

export async function setAllCompanyAccess(userId, userEmail, companyIds) {
  await supabase.from('user_company_access').delete().eq('user_id', userId)
  if (companyIds.length > 0) {
    const rows = companyIds.map(cid => ({ user_id: userId, company_id: cid, email: userEmail, is_admin: false }))
    const { error } = await supabase.from('user_company_access').insert(rows)
    if (error) throw error
  }
}

export async function removeUserAccess(userId) {
  const { error } = await supabase.from('user_company_access').delete().eq('user_id', userId)
  if (error) throw error
}

// ── SORT ORDER ────────────────────────────────────────────────────────────────
export async function updatePropertySortOrder(id, sortOrder) {
  await supabase.from('properties').update({ sort_order: sortOrder }).eq('id', id)
}

// ── MULTI-TENANT: COMPANY CREATION ───────────────────────────────────────────
export async function createCompanyForOwner(name, abbr, color) {
  const { data, error } = await supabase.rpc('create_company_for_owner', {
    p_name: name, p_abbr: abbr, p_color: color
  })
  if (error) throw error
  return data // returns company_id
}

export async function fetchMyCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('name')
  if (error) throw error
  return data || []
}

// ── INVITATIONS ───────────────────────────────────────────────────────────────
export async function sendInvitation(companyIds, email, isAdmin = false) {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds]
  const userId = (await supabase.auth.getUser()).data.user.id

  // Create one invitation row per company
  const rows = ids.map(company_id => ({ company_id, invited_by: userId, email, is_admin: isAdmin }))
  const { data, error } = await supabase.from('invitations').insert(rows).select()
  if (error) throw error

  // Trigger edge function — sends ONE email listing all companies
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const fnRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ invitation_ids: data.map(d => d.id) }),
    })
    const fnData = await fnRes.json()
    if (!fnRes.ok) throw new Error(fnData.error || fnData.message || 'Edge function error')
    return { data, emailSent: true }
  } catch(e) {
    return { data, emailSent: false, emailError: e.message }
  }
}

export async function fetchPendingInvitations(companyId) {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('company_id', companyId)
    .eq('accepted', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function acceptInvitation(token) {
  const user = (await supabase.auth.getUser()).data.user
  const nowIso = new Date().toISOString()
  // Inviting someone to several companies creates one invitations row per
  // company, but the invite email carries only ONE row's token. A valid,
  // unexpired token for this email therefore redeems ALL of the email's
  // pending invitations (RLS restricts us to rows addressed to us anyway).
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('invitations')
    .select('id, expires_at')
    .eq('token', token)
    .eq('email', user.email)
    .maybeSingle()
  if (tokenErr) throw tokenErr
  if (!tokenRow) throw new Error('This invitation is not valid for this account. Sign in with the email address the invite was sent to')
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    throw new Error('This invitation has expired. Ask to be invited again')
  }
  const { data, error } = await supabase
    .from('invitations')
    .update({ accepted: true, accepted_at: nowIso })
    .eq('email', user.email)
    .eq('accepted', false)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select()
  if (error) throw error
  // Grant access to each company
  for (const inv of (data || [])) {
    await supabase.from('user_company_access').upsert({
      user_id: user.id,
      company_id: inv.company_id,
      email: inv.email,
      is_admin: inv.is_admin,
      is_owner: false,
    }, { onConflict: 'user_id,company_id' })
  }
  return data
}

export async function deleteInvitation(id) {
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  if (error) throw error
}

// ── COMPANY INVITES (shareable link/code) ─────────────────────────────────────
//
// Different from `invitations` (per-email). This is for owner-generated
// codes that can be shared as URLs or short codes, used multiple times,
// and revoked at any time.

/**
 * Generate a short human-friendly code like "HMD-7K3X" from the company name.
 * The hyphen makes it easier to read aloud and harder to confuse 0/O, 1/I etc.
 * Uses uppercase letters and numbers only — no easily confused characters.
 */
function generateInviteCode(companyName) {
  // Take up to 3 alphanumeric chars from the company name as a prefix
  const prefix = (companyName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X') // pad with X if name is too short
  // 4 random characters from a confusable-free alphabet
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += ALPH.charAt(Math.floor(Math.random() * ALPH.length))
  }
  return `${prefix}-${suffix}`
}

/**
 * Create a new shareable invite for a company. Returns the full row
 * including the generated code. The caller decides whether to display it
 * as a link or a short code (the underlying record is the same).
 */
export async function createCompanyInvite(companyId, opts = {}) {
  // Accepts both new `role` and legacy `isAdmin`. Role is preferred and is
  // one of 'admin' | 'editor' | 'viewer'. If only isAdmin is passed (older
  // callers), we map true → 'admin' and false → 'editor'.
  let { maxUses = null, expiresAt = null, role = null, isAdmin = false, label = '' } = opts
  if (!role) role = isAdmin ? 'admin' : 'editor'
  if (!['admin','editor','viewer'].includes(role)) role = 'editor'
  // Keep is_admin in sync with role for legacy code paths that still read
  // company_invites.is_admin without checking role.
  isAdmin = role === 'admin'

  const userId = (await supabase.auth.getUser()).data.user.id
  // Look up the company name to seed the code prefix
  const { data: co } = await supabase.from('companies').select('name').eq('id', companyId).single()

  // Generate a unique code. Retry on the rare collision.
  let code = generateInviteCode(co?.name)
  for (let attempts = 0; attempts < 3; attempts++) {
    const { data: existing } = await supabase.from('company_invites')
      .select('id').eq('code', code).maybeSingle()
    if (!existing) break
    code = generateInviteCode(co?.name)
  }

  const { data, error } = await supabase.from('company_invites').insert({
    company_id: companyId,
    created_by: userId,
    code,
    max_uses:   maxUses,
    expires_at: expiresAt,
    role,
    is_admin:   isAdmin,
    label:      label || null,
  }).select().single()
  if (error) throw error
  return data
}

/**
 * List active (non-revoked) invites for a company. Owners/admins only
 * (enforced by RLS).
 */
export async function fetchCompanyInvites(companyId) {
  const { data, error } = await supabase
    .from('company_invites')
    .select('*')
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Revoke (soft-delete) an invite. Once revoked, the code can no longer be
 * redeemed. The row stays for audit purposes.
 */
export async function revokeCompanyInvite(inviteId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('company_invites')
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('id', inviteId)
  if (error) throw error
}

/**
 * Redeem an invite code — atomically validates and grants company access
 * to the calling user. Server-side function does all the work via
 * SECURITY DEFINER so we don't need to expose company_invites to anon.
 *
 * Throws on:
 * - 'not_signed_in' — user is anonymous
 * - 'invite_not_found' — bad code
 * - 'invite_revoked' / 'invite_expired' / 'invite_exhausted'
 *
 * Returns: { company_id, role, company_name }
 *   role is one of 'admin' | 'editor' | 'viewer'.
 */
export async function redeemCompanyInvite(code) {
  const { data, error } = await supabase.rpc('redeem_company_invite', { p_code: code })
  if (error) {
    // Map server-side error codes to friendlier messages here so callers can
    // just .catch and surface e.message to the user without translating.
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('not_signed_in'))     throw new Error('You need to sign in or sign up first')
    if (msg.includes('invite_not_found'))  throw new Error('That invite code is not valid')
    if (msg.includes('invite_revoked'))    throw new Error('This invite has been revoked')
    if (msg.includes('invite_expired'))    throw new Error('This invite has expired')
    if (msg.includes('invite_exhausted'))  throw new Error('This invite has reached its maximum uses')
    throw error
  }
  return Array.isArray(data) ? data[0] : data
}

/**
 * Find companies with names similar to the user's input. Used by the
 * duplicate-name guard at signup to suggest "did you mean to join an
 * existing one?" Limited to 5 results.
 */
export async function findCompaniesByNameFuzzy(query) {
  if (!query || query.trim().length < 3) return []
  const { data, error } = await supabase.rpc('find_companies_by_name_fuzzy', { p_query: query })
  if (error) {
    // Non-fatal — fail silently and let the user proceed with creation
    return []
  }
  return data || []
}

// ── DEVELOPER / PLATFORM ADMIN ────────────────────────────────────────────────
export async function fetchIsPlatformAdmin() {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('is_developer, platform_admin').eq('user_id', (await supabase.auth.getUser()).data.user.id).single()
    return data?.is_developer === true || data?.platform_admin === true
  } catch(e) { return false }
}

// ── BILLING ───────────────────────────────────────────────────────────────────
export async function fetchSubscriptions(companyIds) {
  if (!companyIds.length) return []
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .in('company_id', companyIds)
  if (error) throw error
  return data || []
}

export async function createCheckoutSession(companyId, action = 'checkout', tier = 'starter') {
  const { data: { session } } = await supabase.auth.getSession()
  // Send our window.origin so the edge function redirects back to the
  // SAME hostname the user is on (apex vs www). Browser session is
  // per-origin, so a cross-host redirect drops the user at the login
  // screen — that's the bug we just fixed.
  const returnOrigin = typeof window !== 'undefined' ? window.location.origin : null
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId, action, tier, return_origin: returnOrigin }),
  })
  const data = await res.json()
  if (!res.ok) {
    const e = new Error(data.error || 'Billing error')
    // Machine-readable error id (e.g. 'investor_unavailable') — lets the UI
    // branch on the failure kind without regex-matching the human message.
    e.code = data.code
    throw e
  }
  return data.url
}

export async function fetchAllCompaniesAdmin() {
  // Platform admin only — fetches all companies with owner emails + subs.
  // Two queries instead of embedded join — see fetchAdminAllCompanies for why.
  const [{ data: cos, error: ce }, { data: subs }] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('subscriptions').select('*'),
  ])
  if (ce) throw ce
  const subsByCo = {}
  for (const s of (subs || [])) (subsByCo[s.company_id] ||= []).push(s)
  return (cos || []).map(c => ({ ...c, subscriptions: subsByCo[c.id] || [] }))
}

export async function setCompanyFreeTier(companyId, isFreeTier, grantedBy) {
  const { error } = await supabase
    .from('companies')
    .update({
      is_free_tier: isFreeTier,
      free_tier_reason: isFreeTier ? 'Manually granted by admin' : null,
      free_tier_granted_by: isFreeTier ? grantedBy : null,
    })
    .eq('id', companyId)
  if (error) throw error
  // Update subscription status too
  await supabase
    .from('subscriptions')
    .update({ status: isFreeTier ? 'free_tier' : 'trialing' })
    .eq('company_id', companyId)
}

export async function fetchBillingStatus(companyId) {
  const { data } = await supabase
    .from('companies')
    .select('is_free_tier, trial_ends_at')
    .eq('id', companyId)
    .single()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('company_id', companyId)
    .single()
  return { company: data, subscription: sub }
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
export async function markOnboardingComplete(userId, email) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function fetchOnboardingStatus(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .single()
    return data?.onboarding_completed === true
  } catch(e) { return false }
}

// ── ADMIN: CREATE COMPANY FOR A SPECIFIC USER ────────────────────────────────
export async function adminCreateCompanyForUser(userId, userEmail, name, abbr, color) {
  // Creates a new company owned by a target user (admin action)
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  const { data: co, error } = await supabase
    .from('companies')
    .insert({ name, abbr: (abbr || name.slice(0,3)).toUpperCase(), color: color || '#C8A84B', owner_id: userId })
    .select()
    .single()
  if (error) throw error
  return co
}

// ── ADMIN: MERGE TWO COMPANIES (move all properties from source to target, delete source) ──
export async function adminMergeCompanies(sourceCompanyId, targetCompanyId) {
  // Move all properties from source to target
  const { error: pErr } = await supabase
    .from('properties')
    .update({ company_id: targetCompanyId })
    .eq('company_id', sourceCompanyId)
  if (pErr) throw pErr

  // Move access rows
  const { data: existingTarget } = await supabase.from('user_company_access').select('user_id').eq('company_id', targetCompanyId)
  const existingIds = new Set((existingTarget || []).map(r => r.user_id))
  const { data: sourceAccess } = await supabase.from('user_company_access').select('*').eq('company_id', sourceCompanyId)
  if (sourceAccess) {
    for (const row of sourceAccess) {
      if (!existingIds.has(row.user_id)) {
        await supabase.from('user_company_access').insert({ user_id: row.user_id, company_id: targetCompanyId, email: row.email })
      }
    }
    await supabase.from('user_company_access').delete().eq('company_id', sourceCompanyId)
  }

  // Delete the source company
  const { error: dErr } = await supabase.from('companies').delete().eq('id', sourceCompanyId)
  if (dErr) throw dErr
  return { success: true }
}

// ── ADMIN: TRANSFER COMPANY OWNERSHIP TO ANOTHER USER ────────────────────────
export async function adminTransferCompany(companyId, newOwnerId, newOwnerEmail) {
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  // Step 1: Update the company's owner
  const { error } = await supabase
    .from('companies')
    .update({ owner_id: newOwnerId })
    .eq('id', companyId)
  if (error) throw error

  // Step 2: Make sure the new owner has an access row with is_admin=true
  // (Upsert — if they already had shared access it gets promoted to admin; if not it creates a fresh row)
  try {
    await supabase.from('user_company_access')
      .upsert({ user_id: newOwnerId, company_id: companyId, email: newOwnerEmail, is_admin: true },
              { onConflict: 'user_id,company_id' })
  } catch (e) { /* Non-fatal — ownership transfer already succeeded */ }

  return { success: true }
}

// ── TOGGLE ADMIN RIGHTS for a shared user on a single company ────────────────
export async function setUserCompanyAdmin(userId, companyId, isAdmin) {
  const { error } = await supabase
    .from('user_company_access')
    .update({ is_admin: isAdmin })
    .eq('user_id', userId)
    .eq('company_id', companyId)
  if (error) throw error
  return { success: true }
}

// ── ADMIN: FULL COMPANY LIST WITH SUBS ───────────────────────────────────────
// Fetches all companies + their subscription status as a flat list for the
// admin dashboard. Previously used a PostgREST embedded join (`subscriptions(...)`)
// but that occasionally returned an empty `subscriptions` array even when
// the row clearly exists in the DB — turned out to be PostgREST schema
// cache flakiness on this particular relationship. Switched to two
// independent queries + a client-side merge: bulletproof.
export async function fetchAdminAllCompanies() {
  const [{ data: cos, error: ce }, { data: subs }, { data: propCounts }] = await Promise.all([
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('company_id, status, property_count, current_period_end, stripe_subscription_id, tier'),
    supabase.from('properties').select('company_id'),
  ])
  if (ce) throw ce

  // Group subscriptions by company_id (most companies have at most 1; defensive in case of dupes)
  const subsByCo = {}
  for (const s of (subs || [])) {
    (subsByCo[s.company_id] ||= []).push(s)
  }

  // Count properties per company
  const countMap = {}
  for (const p of (propCounts || [])) {
    countMap[p.company_id] = (countMap[p.company_id] || 0) + 1
  }

  // Attach owner emails from user_profiles
  const ownerIds = [...new Set((cos || []).map(c => c.owner_id).filter(Boolean))]
  let profileMap = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', ownerIds)
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p.email })
  }

  return (cos || []).map(c => ({
    ...c,
    subscriptions: subsByCo[c.id] || [],
    owner_email: profileMap[c.owner_id] || null,
    real_property_count: countMap[c.id] || 0,
    paid_property_count: subsByCo[c.id]?.[0]?.property_count || 0,
  }))
}

// ── DEALS ─────────────────────────────────────────────────────────────────────
export const DEFAULT_MILESTONES_STANDARD = [
  { key:'offer_submitted',       label:'Offer submitted',                    stage:'offer',       sort:1,  required:true,  toggleable:false },
  { key:'offer_accepted',        label:'Offer accepted (verbal)',             stage:'offer',       sort:2,  required:false, toggleable:true  },
  { key:'memorandum_received',   label:'Memorandum of sale received',        stage:'offer',       sort:3,  required:false, toggleable:true  },
  { key:'solicitor_instructed',  label:'Solicitor instructed',               stage:'professionals',sort:4,  required:false, toggleable:true  },
  { key:'broker_instructed',     label:'Mortgage broker instructed',         stage:'professionals',sort:5,  required:false, toggleable:true  },
  { key:'mortgage_applied',      label:'Mortgage application submitted',     stage:'professionals',sort:6,  required:false, toggleable:true  },
  { key:'survey_instructed',     label:'Survey instructed',                  stage:'professionals',sort:7,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'legal',       sort:8,  required:false, toggleable:true  },
  { key:'contract_pack_received',label:'Contract pack received',             stage:'legal',       sort:9,  required:false, toggleable:true  },
  { key:'survey_completed',      label:'Survey completed',                   stage:'legal',       sort:10, required:false, toggleable:true  },
  { key:'searches_received',     label:'Searches received',                  stage:'legal',       sort:11, required:false, toggleable:true  },
  { key:'enquiries_raised',      label:'Enquiries raised by solicitor',      stage:'legal',       sort:12, required:false, toggleable:true  },
  { key:'enquiries_satisfied',   label:'Enquiries satisfied',                stage:'legal',       sort:13, required:false, toggleable:true  },
  { key:'mortgage_offer',        label:'Mortgage offer received',            stage:'legal',       sort:14, required:false, toggleable:true  },
  { key:'insurance_arranged',    label:'Buildings insurance arranged',       stage:'exchange',    sort:15, required:false, toggleable:true  },
  { key:'deposit_paid',          label:'Deposit paid to solicitor',          stage:'exchange',    sort:16, required:false, toggleable:true  },
  { key:'insurance_active',      label:'Insurance active from exchange ✦',   stage:'exchange',    sort:17, required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged',                stage:'exchange',    sort:18, required:true,  toggleable:false },
  { key:'completion_date_set',   label:'Completion date confirmed',          stage:'exchange',    sort:19, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:20, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:21, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:22, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:23, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:24, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_AUCTION = [
  { key:'legal_pack_reviewed',   label:'Legal pack reviewed',                stage:'pre_auction', sort:1,  required:false, toggleable:true  },
  { key:'survey_pre_auction',    label:'Survey completed pre-auction',       stage:'pre_auction', sort:2,  required:false, toggleable:true  },
  { key:'finance_approved',      label:'Finance approved in principle',      stage:'pre_auction', sort:3,  required:false, toggleable:true  },
  { key:'insurance_quoted',      label:'Insurance quote obtained',           stage:'pre_auction', sort:4,  required:false, toggleable:true  },
  { key:'lot_won',               label:'Lot won at auction',                 stage:'auction_day', sort:5,  required:true,  toggleable:false },
  { key:'deposit_paid_auction',  label:'10% deposit paid on the day',        stage:'auction_day', sort:6,  required:true,  toggleable:false },
  { key:'insurance_active',      label:'Insurance active from today ✦',      stage:'auction_day', sort:7,  required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged on the day',     stage:'auction_day', sort:8,  required:true,  toggleable:false },
  { key:'solicitor_instructed',  label:'Solicitor instructed immediately',   stage:'completion',  sort:9,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'completion',  sort:10, required:false, toggleable:true  },
  { key:'finance_arranged',      label:'Bridging/mortgage finance arranged', stage:'completion',  sort:11, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:12, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:13, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:14, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:15, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:16, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_BRRR = [
  { key:'refurb_complete',       label:'Refurbishment complete',             stage:'brrr',        sort:1,  required:false, toggleable:true  },
  { key:'refi_valuation',        label:'Refinance valuation instructed',     stage:'brrr',        sort:2,  required:false, toggleable:true  },
  { key:'refi_applied',          label:'New mortgage application submitted', stage:'brrr',        sort:3,  required:false, toggleable:true  },
  { key:'refi_offer',            label:'Refinance mortgage offer received',  stage:'brrr',        sort:4,  required:false, toggleable:true  },
  { key:'capital_released',      label:'Capital released from deal',         stage:'brrr',        sort:5,  required:false, toggleable:true  },
]

export async function fetchDeals(userId) {
  // We deliberately DO NOT filter by user_id here. RLS handles visibility:
  // a deal is visible if (a) you created it, or (b) you have access to its
  // company. So the simplest correct query is "select all" — Postgres will
  // return only the rows you're allowed to see.
  //
  // We DO filter out soft-deleted rows here. Those are accessed separately
  // via the Trash page (fetchAllDeleted), not the main deals list.
  //
  // The userId param is kept for backwards-compat with callers that still
  // pass it; we just ignore it for filtering. Pre-RLS this function was the
  // gatekeeper, but now trust lives in the database.
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createDeal(userId, fields = {}) {
  const { data, error } = await supabase.from('deals')
    .insert({ user_id: userId, ...fields }).select().single()
  if (error) throw error
  return data
}

export async function updateDeal(id, fields) {
  const { data, error } = await supabase.from('deals')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteDeal(id, userId) {
  // Soft-delete: marks the row as trashed rather than removing it. Goes to
  // Trash and auto-purges after 30 days (handled by purgeExpiredTrash).
  // userId is captured in deleted_by so Trash can show "deleted by [name]"
  // if we ever surface that, and so RLS could allow restore by the deleter.
  const { error } = await supabase.from('deals')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId || null,
    })
    .eq('id', id)
  if (error) throw error
  if (userId) {
    try { await logAction(userId, null, 'deal.deleted', 'deal', id, null) } catch(_) {}
  }
}

// Copy a deal, carrying over only the parts the user ticked in the Copy
// dialog (see src/lib/dealCopy.js for the groups). Identity, timestamps and
// trash markers are never copied, and the copy is owned by whoever clicked
// Copy — a collaborator duplicating a colleague's deal used to produce a copy
// still owned by the original creator.
//
// Child records are best-effort: a failure on one contact or one photo is
// collected as a warning rather than aborting a copy that already exists.
// Returns { deal, counts, warnings }.
export async function copyDeal(deal, userId, options = DEFAULT_COPY_OPTIONS) {
  const owner = userId || deal.user_id
  const row = buildDealCopyFields(deal, options, { userId: owner })
  const { data: copy, error } = await supabase.from('deals').insert(row).select().single()
  if (error) throw error

  const counts = { milestones: 0, contacts: 0, photos: 0, documents: 0 }
  const warnings = []

  // Tracker. Ticked: clone the original's own steps (progress optionally).
  // Unticked: a fresh tracker built from the user's master milestone defaults,
  // exactly as a brand-new deal gets.
  try {
    if (isCopyOptionActive(options, 'tracker')) {
      const source = await fetchDealMilestones(deal.id)
      const rows = buildMilestoneCopies(source, copy.id, options)
      if (rows.length) {
        const { error: mErr } = await supabase.from('deal_milestones').insert(rows)
        if (mErr) throw mErr
        counts.milestones = rows.filter(r => r.is_enabled).length
      } else {
        const cfg = await fetchMilestoneDefaults(owner)
        await initialiseMilestones(copy.id, copy.is_auction, copy.deal_type === 'brrr', cfg)
      }
    } else {
      const cfg = await fetchMilestoneDefaults(owner)
      await initialiseMilestones(copy.id, copy.is_auction, copy.deal_type === 'brrr', cfg)
    }
  } catch (e) {
    warnings.push(`Purchase tracker: ${e.message || 'could not be copied'}`)
  }

  if (isCopyOptionActive(options, 'contacts')) {
    try {
      const source = await fetchDealContacts(deal.id)
      const rows = source.map(({ id, deal_id, created_at, ...rest }) => ({ ...rest, deal_id: copy.id }))
      if (rows.length) {
        const { error: cErr } = await supabase.from('deal_contacts').insert(rows)
        if (cErr) throw cErr
        counts.contacts = rows.length
      }
    } catch (e) {
      warnings.push(`Contacts: ${e.message || 'could not be copied'}`)
    }
  }

  const wantPhotos = isCopyOptionActive(options, 'photos')
  const wantDocs = isCopyOptionActive(options, 'documents')
  if (wantPhotos || wantDocs) {
    try {
      const source = await fetchDealDocuments(deal.id)
      for (const doc of source) {
        const isPhoto = isDealPhoto(doc)
        if (isPhoto ? !wantPhotos : !wantDocs) continue
        if (!doc.file_path) continue
        try {
          // Server-side object copy — the file never round-trips through the
          // browser. The destination sits under the copier's own uid folder,
          // which is what the storage policy lets them write to.
          const rawExt = (doc.file_path.split('.').pop() || '').toLowerCase()
          const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
          const path = `${owner}/deals/${copy.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
          const { error: sErr } = await supabase.storage.from('property-documents').copy(doc.file_path, path)
          if (sErr) throw sErr
          const { error: dErr } = await supabase.from('deal_documents').insert({
            deal_id: copy.id, name: doc.name, file_path: path,
            size: doc.size, type: doc.type, user_id: owner,
            caption: doc.caption || null, uploaded_by: doc.uploaded_by || null,
          })
          if (dErr) {
            // Don't leave an orphan file behind if the row insert was refused.
            try { await supabase.storage.from('property-documents').remove([path]) } catch (_) {}
            throw dErr
          }
          if (isPhoto) counts.photos += 1; else counts.documents += 1
        } catch (e) {
          warnings.push(`${doc.name || 'File'}: ${e.message || 'could not be copied'}`)
        }
      }
    } catch (e) {
      warnings.push(`Files: ${e.message || 'could not be copied'}`)
    }
  }

  return { deal: copy, counts, warnings }
}

export async function fetchDealMilestones(dealId) {
  const { data, error } = await supabase.from('deal_milestones')
    .select('*').eq('deal_id', dealId).order('sort_order')
  if (error) throw error
  return data || []
}

export async function initialiseMilestones(dealId, isAuction, isBRRR, milestoneConfig = {}) {
  const base = isAuction ? DEFAULT_MILESTONES_AUCTION : DEFAULT_MILESTONES_STANDARD
  const milestones = isBRRR ? [...base, ...DEFAULT_MILESTONES_BRRR] : base
  const rows = milestones.map(m => ({
    deal_id: dealId, milestone_key: m.key, label: m.label,
    stage: m.stage, sort_order: m.sort, is_required: m.required,
    // Apply user's master settings — if key is false in config, disable it
    is_enabled: milestoneConfig[m.key] !== false,
    completed: false,
  }))
  const { error } = await supabase.from('deal_milestones').insert(rows)
  if (error) throw error
}

export async function updateMilestone(id, fields) {
  const { error } = await supabase.from('deal_milestones').update(fields).eq('id', id)
  if (error) throw error
}

export async function fetchDealContacts(dealId) {
  const { data, error } = await supabase.from('deal_contacts')
    .select('*').eq('deal_id', dealId).order('created_at')
  if (error) throw error
  return data || []
}

export async function upsertDealContact(dealId, contact) {
  if (contact.id) {
    const { data, error } = await supabase.from('deal_contacts').update(contact).eq('id', contact.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('deal_contacts').insert({ ...contact, deal_id: dealId }).select().single()
  if (error) throw error
  return data
}

export async function deleteDealContact(id) {
  const { error } = await supabase.from('deal_contacts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDealDocuments(dealId) {
  const { data, error } = await supabase.from('deal_documents')
    .select('*').eq('deal_id', dealId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// True for rows that should show in the photo gallery rather than the
// document list. Falls back to the extension for the odd browser that
// leaves file.type blank on HEIC / dropped files.
export function isDealPhoto(doc) {
  if ((doc?.type || '').toLowerCase().startsWith('image/')) return true
  const ext = ((doc?.name || doc?.file_path || '').split('.').pop() || '').toLowerCase()
  return ['jpg','jpeg','png','webp','heic','heif','gif'].includes(ext)
}

// Resolve the current user's display name once per upload batch so the
// gallery can say who added a photo. user_profiles is self-readable only,
// so this is denormalised onto the row at upload time.
async function currentUploaderName(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('full_name, first_name, last_name, email').eq('user_id', userId).maybeSingle()
    if (!data) return null
    return data.full_name
      || [data.first_name, data.last_name].filter(Boolean).join(' ')
      || data.email || null
  } catch(_) { return null }
}

export async function uploadDealDocument(dealId, file, userId, opts = {}) {
  validateUpload(file)
  const rawExt = (file.name.split('.').pop() || '').toLowerCase()
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
  // {user_id}/deals/{dealId}/{ts}_{n}.{ext} — see uploadDocument for layout
  // rationale. The random suffix keeps two files from the same multi-select
  // batch from colliding on Date.now().
  const path = `${userId}/deals/${dealId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents')
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (uploadErr) throw uploadErr
  const uploaded_by = opts.uploadedBy ?? await currentUploaderName(userId)
  // Private bucket — no public URL stored. View links generated on demand
  // via getDocumentSignedUrl() against file_path.
  const { data, error } = await supabase.from('deal_documents').insert({
    deal_id: dealId, name: file.name, file_path: path,
    size: file.size, type: file.type, user_id: userId,
    caption: opts.caption || null, uploaded_by,
  }).select().single()
  if (error) {
    // Don't leave an orphan file behind if the row insert was refused.
    try { await supabase.storage.from('property-documents').remove([path]) } catch(_) {}
    throw error
  }
  return data
}

// Upload several files (photos from a multi-select or drag-drop) in
// sequence. Resolves the uploader name once. Returns { done, failed } so the
// UI can report partial success instead of stopping at the first error.
export async function uploadDealDocuments(dealId, files, userId, onProgress) {
  const uploadedBy = await currentUploaderName(userId)
  const list = Array.from(files || [])
  const done = [], failed = []
  for (const file of list) {
    try { done.push(await uploadDealDocument(dealId, file, userId, { uploadedBy })) }
    catch (e) { failed.push({ name: file.name, error: e.message || 'Upload failed' }) }
    if (onProgress) { try { onProgress(done.length + failed.length, list.length) } catch(_) {} }
  }
  return { done, failed }
}

export async function updateDealDocument(id, fields) {
  const { data, error } = await supabase.from('deal_documents')
    .update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Per-deal photo / document counts for badges on the list and pipeline
// cards. One query, RLS-scoped; grouped client-side (PostgREST can't
// GROUP BY, and deal document volumes are small).
export async function fetchDealDocumentCounts() {
  const { data, error } = await supabase.from('deal_documents')
    .select('deal_id, type, name, file_path').order('created_at', { ascending: true })
  if (error) throw error
  // Oldest photo is the cover, so the thumbnail doesn't change every upload.
  const out = {}
  for (const row of data || []) {
    const c = out[row.deal_id] || (out[row.deal_id] = { photos: 0, documents: 0, cover: null })
    if (isDealPhoto(row)) { c.photos += 1; if (!c.cover) c.cover = row.file_path }
    else c.documents += 1
  }
  return out
}

export async function deleteDealDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('deal_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// ── DEAL → PROPERTY ATTACHMENT CARRY-OVER ────────────────────────────────────
// When a completed deal is converted into a property, its photos and
// documents come with it. Each file is COPIED to a new path under the
// converting user's folder rather than re-referenced, for two reasons:
//   1. the path-ownership trigger on property_documents only accepts paths in
//      the caller's own folder, and a deal file may have been uploaded by a
//      colleague;
//   2. the deal goes to Trash and its files are removed when it is purged, so
//      a shared path would break the property's copy 30 days later.
// Photos land in the 'photos' category (rendered as a gallery on the property
// Documents tab); documents are filed by a name heuristic, 'other' otherwise.
export async function carryDealAttachmentsToProperty(dealId, propertyId, userId) {
  const docs = await fetchDealDocuments(dealId)
  const result = { photos: 0, documents: 0, failed: [] }
  for (const d of docs) {
    if (!d.file_path) { result.failed.push({ name: d.name, error: 'No file stored' }); continue }
    const rawExt = (d.file_path.split('.').pop() || '').toLowerCase()
    const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
    const dest = `${userId}/properties/${propertyId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error: copyErr } = await supabase.storage.from('property-documents').copy(d.file_path, dest)
    if (copyErr) { result.failed.push({ name: d.name, error: copyErr.message || 'Copy failed' }); continue }
    const photo = isDealPhoto(d)
    const { error } = await supabase.from('property_documents').insert({
      property_id: propertyId, user_id: userId,
      name: d.caption || d.name, file_path: dest,
      file_type: d.type || null, file_size: d.size || null,
      category: photo ? 'photos' : dealDocToPropertyCategory(d),
    })
    if (error) {
      try { await supabase.storage.from('property-documents').remove([dest]) } catch (_) {}
      result.failed.push({ name: d.name, error: error.message })
      continue
    }
    if (photo) result.photos += 1
    else result.documents += 1
  }
  return result
}

// Stamp duty calculator (UK 2024 rates)
export function calcStampDuty(price, isAdditional = true, isFirstTimeBuyer = false) {
  // UK SDLT rates — updated April 2025 / October 2024
  // Standard bands from 1 April 2025 (temporary nil-rate threshold ended):
  //   £0–£125,000:        0%
  //   £125,001–£250,000:  2%
  //   £250,001–£925,000:  5%
  //   £925,001–£1.5m:    10%
  //   Over £1.5m:        12%
  // Additional property surcharge: 5% on full price (increased from 3%, 31 Oct 2024)
  // FTB relief from 1 April 2025:
  //   £0–£300,000:        0%
  //   £300,001–£500,000:  5% on the excess
  //   Over £500,000:      standard rates (no FTB relief)
  if (!price || price <= 0) return 0
  let duty = 0

  if (isFirstTimeBuyer && !isAdditional) {
    if (price <= 300000) return 0
    if (price <= 500000) {
      duty = (price - 300000) * 0.05
      return Math.round(duty)
    }
    // Over £500k — no FTB relief, fall through to standard rates
  }

  // Standard banded rates
  if (price > 125000) duty += (Math.min(price, 250000) - 125000) * 0.02
  if (price > 250000) duty += (Math.min(price, 925000) - 250000) * 0.05
  if (price > 925000) duty += (Math.min(price, 1500000) - 925000) * 0.10
  if (price > 1500000) duty += (price - 1500000) * 0.12

  // Additional property surcharge: 5% on full purchase price (from 31 Oct 2024)
  if (isAdditional) duty += price * 0.05

  return Math.round(duty)
}

// Mortgage repayment calculator
export function calcMonthlyRepayment(principal, ratePercent, termYears, interestOnly = false) {
  if (!principal || !ratePercent) return 0
  if (interestOnly) {
    // Interest only: (loan × rate) / 12
    return Math.round(principal * (ratePercent / 100) / 12)
  }
  // Repayment: standard amortisation formula
  if (!termYears) return 0
  const r = (ratePercent / 100) / 12
  const n = termYears * 12
  return Math.round(principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1))
}

// ── MASTER MILESTONE SETTINGS ─────────────────────────────────────────────────
export async function fetchMilestoneDefaults(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('milestone_config').eq('user_id', userId).single()
    return data?.milestone_config || {}
  } catch(e) { return {} }
}

export async function saveMilestoneDefaults(userId, email, config) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    milestone_config: config,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

// ── COMPANY BRANDING & REPORT SETTINGS ───────────────────────────────────────
export async function saveReportSettings(companyId, settings) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, ...settings, updated_at: new Date().toISOString() },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}


// ── REPORTS DATA FETCHING ─────────────────────────────────────────────────────
export async function fetchAllComplianceItems(userId) {
  const { data, error } = await supabase.from('compliance_items')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}

export async function fetchAllMaintenanceJobs(userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllTenancies(userId) {
  const { data, error } = await supabase.from('tenancy_details')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchAllRentPayments(userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllExpenses(userId) {
  const { data, error } = await supabase.from('property_expenses')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveCompanyYearType(companyId, yearType) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, year_type: yearType },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}

export async function uploadCompanyLogo(companyId, file) {
  // Logos go to the public-assets bucket so they remain accessible without
  // authentication (e.g. embedded in PDFs, dashboards). Stored under the
  // landlord's user-folder so RLS limits writes/deletes to the owner.
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/company_logos/${companyId}.${ext}`
  // Best-effort cleanup of any older logo (different ext, etc) to avoid orphans.
  await supabase.storage.from('public-assets').remove([path]).catch(()=>{})
  const { error: upErr } = await supabase.storage.from('public-assets').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data: { publicUrl } } = supabase.storage.from('public-assets').getPublicUrl(path)
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, logo_url: publicUrl, logo_path: path },
    { onConflict: 'company_id' }
  )
  if (error) throw error
  return publicUrl
}

// ── ADDRESS BOOK ──────────────────────────────────────────────────────────────
export async function fetchAddressBook(userId) {
  const { data, error } = await supabase.from('address_book')
    .select('*').eq('user_id', userId).order('name')
  if (error) throw error
  return data || []
}

export async function saveToAddressBook(userId, contact) {
  const { id, deal_id, created_at, ...fields } = contact
  const { data, error } = await supabase.from('address_book')
    .insert({ ...fields, user_id: userId, updated_at: new Date().toISOString() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateAddressBookEntry(id, fields) {
  const { data, error } = await supabase.from('address_book')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteAddressBookEntry(id) {
  const { error } = await supabase.from('address_book').delete().eq('id', id)
  if (error) throw error
}

// ── DELETE USER (platform admin only, calls edge function) ────────────────────
export async function deleteUser(targetUserId) {
  const { data: { session } } = await supabase.auth.getSession()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(
    `${supabaseUrl}/functions/v1/delete-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ target_user_id: targetUserId }),
    }
  )
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── ADMIN SUITE ───────────────────────────────────────────────────────────────
export async function fetchAdminNotes(companyId) {
  const { data, error } = await supabase.from('admin_notes')
    .select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addAdminNote(adminId, companyId, note) {
  const { data, error } = await supabase.from('admin_notes')
    .insert({ admin_id: adminId, company_id: companyId, note }).select().single()
  if (error) throw error
  return data
}

export async function deleteAdminNote(id) {
  const { error } = await supabase.from('admin_notes').delete().eq('id', id)
  if (error) throw error
}

export async function setCompanyFlag(companyId, flagged) {
  const { error } = await supabase.from('companies').update({ flagged }).eq('id', companyId)
  if (error) throw error
}

// Fetch the statement-email inbox token for a company. Used by the
// CompanyInboxPanel to display the per-company forwarding address.
export async function fetchCompanyInboxToken(companyId) {
  const { data, error } = await supabase
    .from('companies').select('statement_email_token')
    .eq('id', companyId).single()
  if (error) throw error
  return data?.statement_email_token || null
}

// Rotate the token (in case the address leaks / spam starts coming in).
// Server-side RPC only: it owns the address format (<company-slug>-<key>)
// and the owner/admin permission check. Returns the new token.
export async function rotateCompanyInboxToken(companyId) {
  const { data, error } = await supabase.rpc('regenerate_statement_email_token', { p_company_id: companyId })
  if (error) throw error
  return data
}

export async function extendTrial(companyId, days) {
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + days)
  const { error } = await supabase.from('companies')
    .update({ trial_ends_at: newDate.toISOString() }).eq('id', companyId)
  if (error) throw error
  return newDate
}

// Force-end a trial right now. Sets companies.trial_ends_at = now() so
// the trial period is over, and flips any matching subscription row to
// 'past_due' so the BillingPage shows the "Add payment method" CTA
// the next time the customer signs in (existing logic at
// BillingPage.jsx:126 — past_due renders the upgrade prompt). After
// this, only payment via Stripe Checkout restores access.
//
// Returns true on success; throws on the company update so the admin
// UI can surface a clear error. The subscription update is best-effort
// (some companies don't have a subscription row yet — that's fine, the
// trial_ends_at change alone forces re-billing once they sign in).
export async function endTrialNow(companyId) {
  const now = new Date()
  const { error: coErr } = await supabase.from('companies')
    .update({ trial_ends_at: now.toISOString() }).eq('id', companyId)
  if (coErr) throw coErr
  // Mirror on subscriptions if a row exists — best-effort.
  try {
    await supabase.from('subscriptions')
      .update({ status: 'past_due', updated_at: now.toISOString() })
      .eq('company_id', companyId)
      .in('status', ['trialing', 'free_tier'])
  } catch (_) { /* swallow — companies update is the source of truth */ }
  return now
}

export async function fetchAnnouncements() {
  const { data } = await supabase.from('admin_announcements')
    .select('*').eq('is_active', true).order('created_at', { ascending: false })
  return data || []
}

export async function createAnnouncement(msg, type, linkText, linkUrl, adminId) {
  const { data, error } = await supabase.from('admin_announcements')
    .insert({ message: msg, type, link_text: linkText, link_url: linkUrl, created_by: adminId, is_active: true })
    .select().single()
  if (error) throw error
  return data
}

export async function deactivateAnnouncement(id) {
  const { error } = await supabase.from('admin_announcements').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function sendAdminEmail(session, to, subject, message) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const res = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ to, subject, message })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── SUBDOMAIN / COMPANY LOOKUP ────────────────────────────────────────────────
// Public, anon-callable branding lookup for the branded tenant login at
// <sub>.ownproperly.com. Goes through the get_company_branding_by_subdomain
// SECURITY DEFINER RPC — a logged-out visitor has no row-level SELECT on
// `companies`, and the RPC returns only public-safe branding fields
// ({ id, name, abbr, color, logo_url, tenant_portal_enabled }). Returns null
// when the subdomain is unknown or the lookup fails.
export async function fetchCompanyBySubdomain(subdomain) {
  if (!subdomain) return null
  const { data, error } = await supabase.rpc('get_company_branding_by_subdomain', {
    p_subdomain: String(subdomain).toLowerCase(),
  })
  if (error || !data) return null
  return data
}

export async function fetchCompanyBankDetails(companyId) {
  const { data } = await supabase.from('company_settings')
    .select('bank_name, bank_sort_code, bank_account_no, bank_reference_prefix, logo_url')
    .eq('company_id', companyId).single()
  return data || {}
}

export async function saveCompanyBankDetails(companyId, details) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, ...details },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}

export async function saveCompanySubdomain(companyId, subdomain) {
  const { error } = await supabase.from('companies')
    .update({ subdomain: subdomain.toLowerCase() }).eq('id', companyId)
  if (error) throw error
}

export async function uploadMaintenancePhoto(jobId, file) {
  // Maintenance photos can show home interiors so they live in the private
  // bucket. Stored under the landlord's user-folder for RLS scoping. We DO
  // NOT return a public URL — callers should use getDocumentSignedUrl when
  // they need to display the photo. The `path` is the durable identifier;
  // signed URLs are generated on-demand and expire after 5 minutes.
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/maintenance/${jobId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('property-documents').upload(path, file, { upsert: true })
  if (error) throw error
  // Return path only — caller fetches a signed URL when displaying.
  return { path, name: file.name }
}

export async function attachPhotosToJob(jobId, photos) {
  const { error } = await supabase.from('maintenance_jobs')
    .update({ photos: photos }).eq('id', jobId)
  if (error) throw error
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

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
export async function logAction(userId, companyId, action, entityType, entityId, entityName, metadata = {}) {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId, company_id: companyId, action,
      entity_type: entityType, entity_id: entityId,
      entity_name: entityName, metadata,
    })
  } catch(e) {} // Never block the main action if logging fails
}

export async function fetchAuditLog(userId, companyId, limit = 100) {
  const q = supabase.from('audit_log').select('*')
  if (companyId) q.eq('company_id', companyId)
  else q.eq('user_id', userId)
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return data || []
}

// ── SOFT DELETE ───────────────────────────────────────────────────────────────
export async function softDeleteProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.deleted', 'property', propertyId, null)
}

export async function restoreProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.restored', 'property', propertyId, null)
}

export async function fetchDeletedProperties(userId) {
  const { data, error } = await supabase.from('properties')
    .select('*, company:companies(name,abbr,color)')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── SOFT-DELETE FOR ALL ENTITY TYPES ──────────────────────────────────────────
// Generic helper: soft-delete any row in any table by ID
export async function softDeleteEntity(table, id, userId) {
  const { error } = await supabase.from(table)
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', id)
  if (error) throw error
}

export async function restoreEntity(table, id) {
  const { error } = await supabase.from(table)
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', id)
  if (error) throw error
}

// Permanent hard delete (only for admins or from trash after 30 days).
// Files first, then the row — see STORAGE_PATH_SOURCES.
export async function hardDeleteEntity(table, id) {
  const paths = await collectStoragePaths(table, [id])
  if (paths.length) await removeStorageFiles(paths)
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

// ── COMPANY CASCADE SOFT-DELETE ──────────────────────────────────────────────
// When a company is soft-deleted, all its (currently-active) properties are
// soft-deleted with the same `deletion_batch_id`. On restore, we use that
// batch ID to re-link them. We deliberately do NOT touch properties that
// were already soft-deleted before the company delete — those keep their
// original deleted_at / deleted_by and won't auto-restore later.

/**
 * Returns a preview of what would be removed if a company were deleted.
 * Used to populate the confirmation modal. Read-only — no side effects.
 */
export async function getCompanyDeletionPreview(companyId) {
  // Active properties that would cascade-delete
  const { count: activeProps } = await supabase.from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('deleted_at', null)
  // Tenancies on those active properties
  const { data: propRows } = await supabase.from('properties')
    .select('id').eq('company_id', companyId).is('deleted_at', null)
  const propIds = (propRows || []).map(p => p.id)
  let tenancies = 0, documents = 0
  if (propIds.length > 0) {
    const { count: tCount } = await supabase.from('tenancy_details')
      .select('*', { count: 'exact', head: true })
      .in('property_id', propIds)
      .is('deleted_at', null)
    tenancies = tCount || 0
    const { count: dCount } = await supabase.from('property_documents')
      .select('*', { count: 'exact', head: true })
      .in('property_id', propIds)
      .is('deleted_at', null)
    documents = dCount || 0
  }
  // Direct company-level documents
  const { count: companyDocs } = await supabase.from('company_documents')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
  return {
    properties:       activeProps || 0,
    tenancies,
    documents,
    company_documents: companyDocs || 0,
  }
}

/**
 * Soft-delete a company and all its currently-active properties as one batch.
 * Sets deletion_batch_id on every affected row so restore can be exact.
 * Does NOT touch properties that were already soft-deleted independently.
 *
 * Note: tenancies, documents, etc. are NOT explicitly soft-deleted here. They
 * become invisible automatically because the property they belong to is gone
 * (queries that join on properties will filter them out, and the Trash page
 * will hide rows whose parent property is deleted).
 */
export async function softDeleteCompanyCascade(companyId, userId) {
  // Generate a fresh batch ID — a UUID via crypto.randomUUID (browser-safe)
  const batchId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = new Date().toISOString()

  // Step 1 — soft-delete the active properties for this company, tagged with batchId
  const { error: pErr } = await supabase.from('properties')
    .update({ deleted_at: now, deleted_by: userId, deletion_batch_id: batchId })
    .eq('company_id', companyId)
    .is('deleted_at', null)
  if (pErr) throw pErr

  // Step 2 — soft-delete the company with the same batchId
  const { error: cErr } = await supabase.from('companies')
    .update({ deleted_at: now, deleted_by: userId, deletion_batch_id: batchId })
    .eq('id', companyId)
  if (cErr) throw cErr

  // Audit log (best effort — don't fail the delete if this errors)
  try { await logAction(userId, companyId, 'company.deleted', 'company', companyId, null) } catch (e) {}
  return { batchId }
}

/**
 * Restore a soft-deleted company AND any properties that were cascade-deleted
 * with it (matching deletion_batch_id). Does NOT restore properties that were
 * deleted independently before the company delete.
 */
export async function restoreCompanyAndCascade(companyId, userId) {
  // Find the deletion_batch_id for the company
  const { data: co, error: cErr } = await supabase.from('companies')
    .select('deletion_batch_id')
    .eq('id', companyId).single()
  if (cErr) throw cErr
  const batchId = co?.deletion_batch_id

  // Restore the company itself
  const { error: rcErr } = await supabase.from('companies')
    .update({ deleted_at: null, deleted_by: null, deletion_batch_id: null })
    .eq('id', companyId)
  if (rcErr) throw rcErr

  // Restore properties that share this batch ID (i.e. cascade-deleted together)
  if (batchId) {
    const { error: rpErr } = await supabase.from('properties')
      .update({ deleted_at: null, deleted_by: null, deletion_batch_id: null })
      .eq('deletion_batch_id', batchId)
    if (rpErr) throw rpErr
  }

  try { await logAction(userId, companyId, 'company.restored', 'company', companyId, null) } catch (e) {}
}

// ── FETCH ALL DELETED ITEMS (for Trash page) ──────────────────────────────────
// ── AUTO-PURGE EXPIRED TRASH ─────────────────────────────────────────────────
// Hard-deletes any rows whose deleted_at is older than the retention window.
// Called lazily by fetchAllDeleted so the Trash page only ever shows
// recoverable items. Best-effort: errors on individual tables are swallowed
// so a failure on one table doesn't block the rest.
//
// Retention window is currently 30 days. Tables with cascade-aware deletes
// (companies, properties) are purged just like the others — when a company
// is hard-deleted via this purge, its still-soft-deleted properties also
// reach their 30 day mark in the same time frame, so they purge alongside.
const TRASH_RETENTION_DAYS = 30

// ── STORAGE CLEAN-UP ON PURGE ────────────────────────────────────────────────
// Postgres cascades the document ROWS away when a trashed entity is hard-
// deleted, but nothing removes the FILES from the private bucket, so every
// purge used to leave orphans behind (six were found in Sept 2026). For each
// purgeable table this says where its files are referenced. Paths are
// collected BEFORE the rows go: the storage read/delete permission for a
// colleague's upload comes from those very rows.
const STORAGE_PATH_SOURCES = {
  deals:              [{ table: 'deal_documents',       fk: 'deal_id',     col: 'file_path' }],
  properties:         [{ table: 'property_documents',   fk: 'property_id', col: 'file_path' },
                       { table: 'property_inspections', fk: 'property_id', col: 'photos' },
                       { table: 'maintenance_jobs',     fk: 'property_id', col: 'photos' }],
  companies:          [{ table: 'company_documents',    fk: 'company_id',  col: 'file_path' }],
  maintenance_jobs:   [{ table: 'maintenance_jobs',     fk: 'id',          col: 'photos' }],
  property_documents: [{ table: 'property_documents',   fk: 'id',          col: 'file_path' }],
}

export async function collectStoragePaths(table, ids) {
  const sources = STORAGE_PATH_SOURCES[table]
  if (!sources || !ids?.length) return []
  const paths = []
  for (const src of sources) {
    try {
      const { data, error } = await supabase.from(src.table).select(src.col).in(src.fk, ids)
      if (!error) paths.push(...extractStoragePaths(data, src.col))
    } catch (_) { /* best effort: a missing table must not block the purge */ }
  }
  return [...new Set(paths)]
}

// Best effort, in chunks of 100 (the Storage API's comfortable batch size).
// Objects the caller isn't allowed to delete are simply not returned by the
// API; they are counted as failed rather than thrown.
export async function removeStorageFiles(paths) {
  let removed = 0, failed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    try {
      const { data, error } = await supabase.storage.from('property-documents').remove(chunk)
      if (error) failed += chunk.length
      else { removed += (data || []).length; failed += chunk.length - (data || []).length }
    } catch (_) { failed += chunk.length }
  }
  return { removed, failed }
}

export async function purgeExpiredTrash(userId) {
  if (!userId) return { purged: 0, filesRemoved: 0 }
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const tables = [
    { table: 'properties',         scope: { col: 'user_id',  val: userId } },
    { table: 'companies',          scope: { col: 'owner_id', val: userId } },
    { table: 'tenancy_details',    scope: { col: 'user_id',  val: userId } },
    { table: 'compliance_items',   scope: { col: 'user_id',  val: userId } },
    { table: 'maintenance_jobs',   scope: { col: 'user_id',  val: userId } },
    { table: 'property_expenses',  scope: { col: 'user_id',  val: userId } },
    { table: 'deals',              scope: { col: 'user_id',  val: userId } },
    { table: 'property_documents', scope: { col: 'user_id',  val: userId } },
  ]
  let purged = 0, filesRemoved = 0
  for (const { table, scope } of tables) {
    try {
      // Find what is about to go, remove its files while the rows (and so
      // our storage permissions) still exist, then delete the rows. The
      // delete repeats the trash conditions so a row restored between the
      // two calls survives.
      const { data: rows, error: selErr } = await supabase.from(table)
        .select('id')
        .eq(scope.col, scope.val)
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
      if (selErr || !rows?.length) continue
      const ids = rows.map(r => r.id)
      const paths = await collectStoragePaths(table, ids)
      if (paths.length) filesRemoved += (await removeStorageFiles(paths)).removed
      const { error, count } = await supabase.from(table)
        .delete({ count: 'exact' })
        .in('id', ids)
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
      if (!error && count) purged += count
    } catch (e) { /* table-level error: continue with the others */ }
  }
  return { purged, filesRemoved, retentionDays: TRASH_RETENTION_DAYS }
}

export async function fetchAllDeleted(userId) {
  // Lazy auto-purge: removes expired trash before showing what remains.
  // We don't await this on a critical path because it's "best effort".
  // We DO await it here because we want the Trash page to reflect the
  // state immediately after purge — otherwise the user sees rows that
  // are about to vanish on the next reload.
  try { await purgeExpiredTrash(userId) } catch (e) {}

  // Query each table in parallel for deleted rows belonging to the user
  const safe = (p) => p.then(r => r.data || []).catch(() => [])

  const [props, companies, tenancies, compliance, maintenance, expenses, deals, documents] = await Promise.all([
    safe(supabase.from('properties').select('id, name, address, deleted_at, deleted_by, company_id, company:companies(name,abbr,color)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('companies').select('id, name, abbr, color, deleted_at, deleted_by').eq('owner_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('tenancy_details').select('id, tenant_name, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('compliance_items').select('id, cert_type, cert_name, expiry_date, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('maintenance_jobs').select('id, title, description, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_expenses').select('id, description, amount, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('deals').select('id, name, address, deleted_at, deleted_by, company_id, company:companies(name,abbr,color)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_documents').select('id, name, file_path, file_url, category, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
  ])

  return {
    properties: props.map(r => ({ ...r, _type: 'properties', _label: 'Property', _name: r.name || r.address })),
    companies: companies.map(r => ({ ...r, _type: 'companies', _label: 'Company', _name: r.name })),
    tenancies: tenancies.map(r => ({ ...r, _type: 'tenancy_details', _label: 'Tenancy', _name: `${r.tenant_name || 'Tenant'} @ ${r.property?.name || '—'}` })),
    compliance: compliance.map(r => ({ ...r, _type: 'compliance_items', _label: 'Certificate', _name: `${r.cert_type || r.cert_name || 'Certificate'} @ ${r.property?.name || '—'}` })),
    maintenance: maintenance.map(r => ({ ...r, _type: 'maintenance_jobs', _label: 'Repair job', _name: `${r.title || r.description} @ ${r.property?.name || '—'}` })),
    expenses: expenses.map(r => ({ ...r, _type: 'property_expenses', _label: 'Expense', _name: `${r.description} (£${r.amount}) @ ${r.property?.name || '—'}` })),
    deals: deals.map(r => ({ ...r, _type: 'deals', _label: 'Deal', _name: r.name || r.address || 'Untitled deal' })),
    documents: documents.map(r => ({ ...r, _type: 'property_documents', _label: 'Document', _name: `${r.name} @ ${r.property?.name || '—'}` })),
  }
}

// Backup + GDPR export functions moved to ./backups.js.
// downloadFullBackup, fetchUserBackups, downloadBackupById,
// createManualBackup, deleteBackup, exportUserData are re-exported via
// src/lib/api/index.js so callers still use `import * as api from '../lib/api'`.

// ── TENANT INBOX ──────────────────────────────────────────────────────────────
export async function fetchTenantInbox(userId) {
  // Get all properties for this user
  const { data: props } = await supabase
    .from('properties')
    .select('id, name, address, company_id')
    .eq('user_id', userId)

  if (!props || props.length === 0) return { messages: [], maintenance: [] }

  const propIds = props.map(p => p.id)
  const propMap = Object.fromEntries(props.map(p => [p.id, p]))

  // Fetch unread tenant messages
  const { data: messages } = await supabase
    .from('tenant_messages')
    .select('*')
    .in('property_id', propIds)
    .eq('sender_type', 'tenant')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  // Fetch recent tenant-reported maintenance jobs
  const { data: maintenance } = await supabase
    .from('maintenance_jobs')
    .select('*')
    .in('property_id', propIds)
    .eq('reported_by_tenant', true)
    .order('created_at', { ascending: false })
    .limit(20)

  return {
    messages: (messages || []).map(m => ({ ...m, property: propMap[m.property_id] })),
    maintenance: (maintenance || []).map(m => ({ ...m, property: propMap[m.property_id] })),
  }
}

export async function markTenantMessageReadByLandlord(messageId) {
  await supabase.from('tenant_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
}

export async function replyToTenantMessage(propertyId, tenantUserId, message) {
  const { data, error } = await supabase.from('tenant_messages')
    .insert({ property_id: propertyId, tenant_user_id: tenantUserId, message, sender_type: 'landlord' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchAllTenantMessages(propertyId) {
  const { data } = await supabase.from('tenant_messages')
    .select('*').eq('property_id', propertyId).order('created_at')
  return data || []
}

export async function saveTenantNotificationEmail(companyId, email) {
  const { error } = await supabase.from('company_settings')
    .upsert({ company_id: companyId, tenant_notification_email: email }, { onConflict: 'company_id' })
  if (error) throw error
}

// ── RIGHT TO RENT ─────────────────────────────────────────────────────────────
export async function fetchRightToRent(propertyId) {
  const { data, error } = await supabase.from('right_to_rent')
    .select('*').eq('property_id', propertyId).order('check_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveRightToRent(record) {
  const { data, error } = await supabase.from('right_to_rent')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

export async function deleteRightToRent(id) {
  const { error } = await supabase.from('right_to_rent').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAllRightToRent(userId) {
  const { data: props } = await supabase.from('properties').select('id,name,address').eq('user_id', userId)
  if (!props?.length) return []
  const propIds = props.map(p => p.id)
  const propMap = Object.fromEntries(props.map(p => [p.id, p]))
  const { data } = await supabase.from('right_to_rent').select('*').in('property_id', propIds).order('expiry_date')
  return (data || []).map(r => ({ ...r, property: propMap[r.property_id] }))
}

// ── PORTFOLIO VALUATION ───────────────────────────────────────────────────────
export async function updatePropertyValuation(propertyId, value) {
  const { error } = await supabase.from('properties')
    .update({ current_value: value, value_updated_at: new Date().toISOString() })
    .eq('id', propertyId)
  if (error) throw error
}

// ── REFERRALS ─────────────────────────────────────────────────────────────────
export async function fetchOrCreateReferralCode(userId, email) {
  const { data: existing } = await supabase.from('user_profiles')
    .select('referral_code').eq('user_id', userId).single()
  if (existing?.referral_code) return existing.referral_code
  const code = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'') + Math.random().toString(36).substring(2,6)
  await supabase.from('user_profiles').update({ referral_code: code }).eq('user_id', userId)
  return code
}

export async function fetchReferrals(userId) {
  const { data } = await supabase.from('referrals').select('*').eq('referrer_id', userId).order('created_at', { ascending: false })
  return data || []
}

// ── TENANT INVITE EMAIL ───────────────────────────────────────────────────────
export async function sendTenantInviteEmail(session, tenantEmail, propertyId, propertyAddress, companyName) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const res = await fetch(`${supabaseUrl}/functions/v1/send-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ tenant_email: tenantEmail, property_id: propertyId, property_address: propertyAddress, company_name: companyName })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── ONBOARDING EMAIL ──────────────────────────────────────────────────────────
// No-op stub. The /functions/v1/onboarding-email edge function was
// never deployed, so every call from App.jsx login → 404 + CORS spam
// in the logs (was firing on every page load). Kept the export so we
// don't have to rip the call site out; when we want real onboarding
// emails, build the edge function and replace this body.
export async function sendOnboardingEmail(_email, _name, _sequence) {
  return null
}

// ── PROPERTY HEALTH SCORE ─────────────────────────────────────────────────────
export function calcPropertyHealthScore(property, compliance=[], tenancy=null, maintenance=[], rentPayments=[]) {
  // Returns 0-100 score with breakdown
  let score = 100
  const issues = []
  const today = new Date()

  // Compliance (max -40 points)
  const expiryFields = [
    { key:'gas_safety_expiry',    label:'Gas Safety', critical:true },
    { key:'eicr_expiry',          label:'EICR',        critical:true },
    { key:'epc_expiry',           label:'EPC',         critical:false },
    { key:'hmo_licence_expiry',   label:'HMO Licence', critical:true },
  ]
  compliance.forEach(c => {
    if (!c.expiry_date) return
    const exp = new Date(c.expiry_date)
    const daysLeft = (exp - today) / (1000*60*60*24)
    if (daysLeft < 0) { score -= 20; issues.push({ type:'error', text:`${c.title || c.item_type} expired` }) }
    else if (daysLeft < 30) { score -= 10; issues.push({ type:'warning', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
    else if (daysLeft < 90) { score -= 3; issues.push({ type:'info', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
  })

  // Rent arrears (max -25 points). 'missed' is the legacy value for
  // pre-2026-05-25 rows; we accept either until the DB is fully migrated.
  const overduePayments = rentPayments.filter(p => p.status === 'overdue' || p.status === 'missed')
  if (overduePayments.length > 0) {
    score -= Math.min(25, overduePayments.length * 10)
    issues.push({ type:'error', text:`${overduePayments.length} overdue rent payment${overduePayments.length>1?'s':''}` })
  }

  // Open maintenance (max -20 points)
  const openJobs = maintenance.filter(m => m.status !== 'complete')
  const urgentJobs = openJobs.filter(m => m.priority === 'urgent')
  if (urgentJobs.length) { score -= 15; issues.push({ type:'error', text:`${urgentJobs.length} urgent repair${urgentJobs.length>1?'s':''} open` }) }
  else if (openJobs.length) { score -= Math.min(10, openJobs.length * 3); issues.push({ type:'warning', text:`${openJobs.length} open repair job${openJobs.length>1?'s':''}` }) }

  // Tenancy (max -15 points)
  if (tenancy?.tenancy_end) {
    const end = new Date(tenancy.tenancy_end)
    const daysToEnd = (end - today) / (1000*60*60*24)
    if (daysToEnd < 0) { score -= 15; issues.push({ type:'error', text:'Tenancy has ended' }) }
    else if (daysToEnd < 30) { score -= 10; issues.push({ type:'warning', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
    else if (daysToEnd < 90) { score -= 5; issues.push({ type:'info', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
  }

  // Vacant property
  if (property.status === 'vacant') {
    score -= 5
    issues.push({ type:'info', text:'Property currently vacant' })
  }

  const clamped = Math.max(0, Math.min(100, score))
  const grade = clamped >= 90 ? 'A' : clamped >= 75 ? 'B' : clamped >= 60 ? 'C' : clamped >= 40 ? 'D' : 'F'
  const color = clamped >= 90 ? '#2ECC8A' : clamped >= 75 ? '#4B8FE0' : clamped >= 60 ? '#C8A84B' : clamped >= 40 ? '#E0943A' : '#E05555'
  return { score: clamped, grade, color, issues }
}

// ── DEPOSIT PROTECTION ────────────────────────────────────────────────────────
export async function deleteDepositProtection(id) {
  const { error } = await supabase.from('deposit_protection').delete().eq('id', id)
  if (error) throw error
}

// ── LEGAL NOTICES ─────────────────────────────────────────────────────────────
export async function fetchLegalNotices(propertyId) {
  const { data, error } = await supabase.from('legal_notices').select('*').eq('property_id', propertyId).order('served_date', { ascending: false })
  if (error) throw error; return data || []
}
export async function saveLegalNotice(record) {
  const { data, error } = await supabase.from('legal_notices').upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error; return data
}
export async function deleteLegalNotice(id) {
  const { error } = await supabase.from('legal_notices').delete().eq('id', id)
  if (error) throw error
}

// ── RENT INCREASES ────────────────────────────────────────────────────────────
export async function fetchRentIncreases(propertyId) {
  const { data, error } = await supabase.from('rent_increases').select('*').eq('property_id', propertyId).order('effective_date', { ascending: false })
  if (error) throw error; return data || []
}
export async function saveRentIncrease(record) {
  const { data, error } = await supabase.from('rent_increases').upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error; return data
}

// ── BULK PROPERTY ACTIONS ─────────────────────────────────────────────────────
export async function bulkUpdateProperties(ids, updates) {
  const { error } = await supabase.from('properties').update(updates).in('id', ids)
  if (error) throw error
}
export async function bulkSoftDeleteProperties(ids, userId) {
  const { error } = await supabase.from('properties').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).in('id', ids)
  if (error) throw error
}

// ── DEPOSIT PROTECTION ────────────────────────────────────────────────────────
export async function fetchDepositProtection(propertyId) {
  const { data, error } = await supabase.from('deposit_protection')
    .select('*').eq('property_id', propertyId).order('registered_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveDepositProtection(record) {
  const { data, error } = await supabase.from('deposit_protection')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── LEGAL NOTICES ─────────────────────────────────────────────────────────────
export async function fetchNotices(propertyId) {
  const { data, error } = await supabase.from('legal_notices')
    .select('*').eq('property_id', propertyId).order('served_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveNotice(record) {
  const { data, error } = await supabase.from('legal_notices')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── RENT HISTORY ──────────────────────────────────────────────────────────────
export async function fetchRentHistory(propertyId) {
  const { data, error } = await supabase.from('rent_history')
    .select('*').eq('property_id', propertyId).order('effective_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveRentHistory(record) {
  const { data, error } = await supabase.from('rent_history')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── TENANCY DETAILS UPDATE ────────────────────────────────────────────────────
export async function updateTenancyDetails(propertyId, fields) {
  const { error } = await supabase.from('tenancy_details')
    .update(fields).eq('property_id', propertyId)
  if (error) throw error
}
export async function fetchTenancyDetails(propertyId) {
  const { data } = await supabase.from('tenancy_details')
    .select('*').eq('property_id', propertyId).single()
  return data
}

// ── LETTINGS PROGRESSIONS ─────────────────────────────────────────────────────
export async function fetchLettingsProgressions(userId) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .select('*, property:properties(id,name,address,rent_pcm,company_id), company:companies(id,name,abbr,color)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createLettingsProgression(userId, fields = {}) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .insert({ user_id: userId, checklist: {}, ...fields })
    .select().single()
  if (error) throw error
  return data
}

export async function updateLettingsProgression(id, fields) {
  const { data, error } = await supabase
    .from('lettings_progressions')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function archiveLettingsProgression(id) {
  const { error } = await supabase
    .from('lettings_progressions')
    .update({ archived_at: new Date().toISOString(), stage: 'let' })
    .eq('id', id)
  if (error) throw error
}

export async function deleteLettingsProgression(id) {
  const { error } = await supabase.from('lettings_progressions').delete().eq('id', id)
  if (error) throw error
}

// ═════════════════════════════════════════════════════════════════════════════
// DEAL SCORING — DSCR, ROI, Stress Test, Overall Score (0-100)
// ═════════════════════════════════════════════════════════════════════════════

// Debt Service Coverage Ratio: annual rent / annual mortgage payment
// Lenders typically want 1.25+, stress-tested at 5.5%-6% interest rates
export function calcDSCR(annualRent, annualMortgagePayment) {
  if (!annualMortgagePayment || annualMortgagePayment <= 0) return null  // cash purchase
  return annualRent / annualMortgagePayment
}

// Stress test: DSCR at higher interest rates
export function calcStressTest(loanAmount, termYears, annualRent, currentRate) {
  // No loan = no stress test to do (cash purchase, or unanalysed deal).
  // Return null so callers can simply skip rendering — they all guard with
  // `stressData && stressData.map(...)`. (Previously this returned
  // `{ cash: true }` which is truthy but not an array, causing
  // `stressData.map is not a function` on brand-new empty deals.)
  if (!loanAmount || loanAmount <= 0) return null
  const rates = [currentRate, currentRate + 1, currentRate + 2, currentRate + 3]
  return rates.map(rate => {
    // Interest-only mortgage payment approximation (more conservative)
    const monthlyPayment = (loanAmount * (rate / 100)) / 12
    const annualPayment = monthlyPayment * 12
    const dscr = annualPayment > 0 ? annualRent / annualPayment : null
    return {
      rate,
      monthlyPayment,
      annualPayment,
      dscr,
      passes: dscr !== null && dscr >= 1.25,
    }
  })
}

// Cash-on-cash return: annual profit / cash invested
export function calcCashOnCash(annualProfit, totalCashInvested) {
  if (!totalCashInvested || totalCashInvested <= 0) return null
  return (annualProfit / totalCashInvested) * 100
}

// LTV (loan-to-value) percentage
export function calcLTV(loanAmount, propertyValue) {
  if (!propertyValue || propertyValue <= 0) return null
  return (loanAmount / propertyValue) * 100
}

// Overall deal score 0-100 — weighted across key metrics
export function calcDealScore(deal) {
  const purchasePrice = deal.purchase_price || 0
  if (purchasePrice <= 0) return { score: 0, breakdown: {}, rating: 'insufficient-data' }

  const grossRentPcm = deal.expected_rent || deal.rent_pcm || 0
  const annualRent = grossRentPcm * 12
  const grossYield = (annualRent / purchasePrice) * 100

  const isCash = deal.purchase_type === 'cash'
  const depositPercent = deal.deposit_percent || 25
  const loanAmount = isCash ? 0 : purchasePrice * (1 - depositPercent / 100)
  const mortgageRate = deal.mortgage_rate || 5
  const annualMortgage = isCash ? 0 : loanAmount * (mortgageRate / 100) // interest-only approx

  const operatingCosts = (deal.insurance || 0) + (deal.maintenance_budget || annualRent * 0.1) + (deal.management_fee_percent ? annualRent * (deal.management_fee_percent / 100) : 0)
  const annualProfit = annualRent - annualMortgage - operatingCosts

  const sd = deal.stamp_duty_override ?? 0
  const totalCost = purchasePrice + sd + (deal.legal_fees || 0) + (deal.survey_cost || 0) + (deal.refurb_cost || 0) + (deal.other_costs || 0)
  const cashIn = isCash ? totalCost : totalCost - loanAmount

  const dscr = calcDSCR(annualRent, annualMortgage)
  const cashOnCash = calcCashOnCash(annualProfit, cashIn)
  const ltv = isCash ? 0 : calcLTV(loanAmount, purchasePrice)

  // Stress test — does DSCR at +2% interest still pass?
  const stressRate = mortgageRate + 2
  const stressAnnualMortgage = isCash ? 0 : loanAmount * (stressRate / 100)
  const stressDscr = isCash ? null : annualRent / stressAnnualMortgage
  const stressPasses = isCash || (stressDscr !== null && stressDscr >= 1.25)

  // Scoring (0-100 weighted)
  let score = 0
  const breakdown = {}

  // Gross yield (25 points)
  const yieldPoints = grossYield >= 10 ? 25 : grossYield >= 8 ? 22 : grossYield >= 6 ? 17 : grossYield >= 5 ? 12 : grossYield >= 4 ? 7 : 2
  breakdown.yield = { value: grossYield.toFixed(2) + '%', points: yieldPoints, max: 25 }
  score += yieldPoints

  // DSCR (25 points) — only for mortgaged deals
  if (!isCash) {
    const dscrPoints = dscr >= 1.5 ? 25 : dscr >= 1.25 ? 20 : dscr >= 1.1 ? 12 : dscr >= 1.0 ? 5 : 0
    breakdown.dscr = { value: dscr?.toFixed(2), points: dscrPoints, max: 25 }
    score += dscrPoints
  } else {
    breakdown.dscr = { value: 'Cash (N/A)', points: 25, max: 25 }
    score += 25
  }

  // Stress test resilience (20 points)
  const stressPoints = stressPasses ? 20 : isCash ? 20 : stressDscr >= 1.0 ? 10 : 0
  breakdown.stress = { value: isCash ? 'Cash (resilient)' : `${stressDscr?.toFixed(2)} @ +2%`, points: stressPoints, max: 20 }
  score += stressPoints

  // Cash-on-cash return (15 points)
  const cocPoints = cashOnCash >= 15 ? 15 : cashOnCash >= 10 ? 12 : cashOnCash >= 7 ? 9 : cashOnCash >= 5 ? 6 : cashOnCash >= 3 ? 3 : 0
  breakdown.cash_on_cash = { value: (cashOnCash || 0).toFixed(1) + '%', points: cocPoints, max: 15 }
  score += cocPoints

  // LTV (15 points) — lower LTV is safer
  const ltvPoints = isCash ? 15 : ltv <= 60 ? 15 : ltv <= 70 ? 12 : ltv <= 75 ? 9 : ltv <= 80 ? 5 : 2
  breakdown.ltv = { value: isCash ? 'Cash (0%)' : ltv?.toFixed(0) + '%', points: ltvPoints, max: 15 }
  score += ltvPoints

  const rating = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'marginal' : 'poor'

  return {
    score: Math.round(score),
    rating,
    breakdown,
    metrics: {
      grossYield,
      dscr,
      stressDscr,
      stressPasses,
      cashOnCash,
      ltv,
      annualRent,
      annualMortgage,
      annualProfit,
      cashIn,
      loanAmount,
    },
  }
}

// ── FEATURE FLAGS ─────────────────────────────────────────────────────────────
export async function fetchFeatureFlags() {
  const { data, error } = await supabase.from('feature_flags').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function fetchFlagUserOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_users').select('*, user:user_id').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function fetchFlagCompanyOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_companies').select('*, company:companies(name,abbr,color)').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function createFeatureFlag({ key, name, description, enabled_globally }) {
  const { data, error } = await supabase.from('feature_flags').insert({ key, name, description, enabled_globally }).select().single()
  if (error) throw error
  return data
}

export async function updateFeatureFlag(key, updates) {
  const { error } = await supabase.from('feature_flags').update({ ...updates, updated_at: new Date().toISOString() }).eq('key', key)
  if (error) throw error
}

export async function deleteFeatureFlag(key) {
  const { error } = await supabase.from('feature_flags').delete().eq('key', key)
  if (error) throw error
}

export async function setFlagUserOverride(flagKey, userId, enabled) {
  const { error } = await supabase.from('feature_flag_users').upsert({ flag_key: flagKey, user_id: userId, enabled }, { onConflict: 'flag_key,user_id' })
  if (error) throw error
}

export async function removeFlagUserOverride(flagKey, userId) {
  const { error } = await supabase.from('feature_flag_users').delete().eq('flag_key', flagKey).eq('user_id', userId)
  if (error) throw error
}

export async function setFlagCompanyOverride(flagKey, companyId, enabled) {
  const { error } = await supabase.from('feature_flag_companies').upsert({ flag_key: flagKey, company_id: companyId, enabled }, { onConflict: 'flag_key,company_id' })
  if (error) throw error
}

export async function removeFlagCompanyOverride(flagKey, companyId) {
  const { error } = await supabase.from('feature_flag_companies').delete().eq('flag_key', flagKey).eq('company_id', companyId)
  if (error) throw error
}

// Check if a feature is enabled for current user (checks user override → company override → global)
export async function fetchMyActiveFlags() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return new Set()
    const [flagsRes, userOverridesRes, companyOverridesRes] = await Promise.all([
      supabase.from('feature_flags').select('key, enabled_globally'),
      supabase.from('feature_flag_users').select('flag_key, enabled').eq('user_id', u.id),
      supabase.from('feature_flag_companies').select('flag_key, enabled')
    ])
    const globalMap = {}
    ;(flagsRes.data || []).forEach(f => { globalMap[f.key] = f.enabled_globally })
    const userMap = {}
    ;(userOverridesRes.data || []).forEach(o => { userMap[o.flag_key] = o.enabled })
    const companyMap = {}
    ;(companyOverridesRes.data || []).forEach(o => {
      // If ANY of the user's companies has the flag ON, it's on
      if (o.enabled && companyMap[o.flag_key] !== true) companyMap[o.flag_key] = true
      else if (!o.enabled && companyMap[o.flag_key] === undefined) companyMap[o.flag_key] = false
    })
    const active = new Set()
    Object.keys(globalMap).forEach(k => {
      // Priority: user override → company override → global
      if (userMap[k] !== undefined) {
        if (userMap[k]) active.add(k)
      } else if (companyMap[k] !== undefined) {
        if (companyMap[k]) active.add(k)
      } else if (globalMap[k]) {
        active.add(k)
      }
    })
    return active
  } catch(e) {
    return new Set()
  }
}

// ── PERMISSIONS HELPER ────────────────────────────────────────────────────────
// Given a user + company, return their effective permission object
// Uses isDeveloper flag to grant everything to dev users
export async function fetchMyPermissionsForCompany(companyId, isDeveloper = false) {
  if (isDeveloper) return { ...ROLE_DEFAULTS.owner, _role: 'developer' }
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return Object.keys(ROLE_DEFAULTS.admin).reduce((a,k)=>({...a,[k]:false}),{ _role: 'none' })
    // Check ownership
    const { data: co } = await supabase.from('companies').select('owner_id').eq('id', companyId).single()
    if (co?.owner_id === user.id) return { ...ROLE_DEFAULTS.owner, _role: 'owner' }
    // Check access row
    const { data: access } = await supabase.from('user_company_access').select('role, is_admin, permissions').eq('company_id', companyId).eq('user_id', user.id).single()
    if (!access) return Object.keys(ROLE_DEFAULTS.admin).reduce((a,k)=>({...a,[k]:false}),{ _role: 'none' })
    const perms = getEffectivePermissions(access, false)
    return { ...perms, _role: access.role || (access.is_admin ? 'admin' : 'editor') }
  } catch(e) {
    return Object.keys(ROLE_DEFAULTS.admin).reduce((a,k)=>({...a,[k]:false}),{ _role: 'none' })
  }
}

// Bulk version: permissions for ALL my accessible companies
export async function fetchMyPermissionsMap(isDeveloper = false) {
  const map = {}
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return map
    if (isDeveloper) {
      const { data: cos } = await supabase.from('companies').select('id')
      ;(cos || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'developer' } })
      return map
    }
    const [ownedRes, accessRes] = await Promise.all([
      supabase.from('companies').select('id').eq('owner_id', user.id),
      supabase.from('user_company_access').select('company_id, role, is_admin, permissions').eq('user_id', user.id),
    ])
    ;(ownedRes.data || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'owner' } })
    ;(accessRes.data || []).forEach(a => {
      if (!map[a.company_id]) {
        map[a.company_id] = { ...getEffectivePermissions(a, false), _role: a.role || (a.is_admin ? 'admin' : 'editor') }
      }
    })
    return map
  } catch(e) {
    return map
  }
}

// ── DASHBOARD WIDGET PREFS ────────────────────────────────────────────────────
// Stored per-user in user_profiles.dashboard_widgets as JSONB array of { key, enabled }
export async function fetchWidgetPrefs() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return null
    const { data } = await supabase.from('user_profiles').select('dashboard_widgets').eq('user_id', u.id).single()
    return data?.dashboard_widgets || null
  } catch(e) { return null }
}

export async function saveWidgetPrefs(widgets) {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return
    await supabase.from('user_profiles').update({ dashboard_widgets: widgets }).eq('user_id', u.id)
  } catch(e) { console.error('save widget prefs failed', e) }
}


// ── DOCUMENT OCR EXTRACTION ──────────────────────────────────────────────────
// Works with the existing property_documents table which has:
//   name, file_url, file_path, file_type, file_size, category
// OCR adds: extraction_status, extracted_fields, extraction_error, extracted_at

// Map UI category -> Anthropic extraction schema key
export const OCR_TYPE_MAP = {
  tenancy: 'tenancy_agreement',
  gas: 'gas_cert',
  eicr: 'eicr',
  epc: 'epc',
  insurance: 'insurance',
  mortgage: 'mortgage_offer',
  inventory: 'other',
  legal: 'other',
  maintenance: 'other',
  other: 'other',
}

// Trigger OCR extraction for a document. Only works for PDFs and images.
export async function triggerDocumentOCR(documentId) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session) throw new Error('Not signed in')
  const url = supabase.supabaseUrl.replace(/\/$/, '') + '/functions/v1/extract-document'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': supabase.supabaseKey,
    },
    body: JSON.stringify({ document_id: documentId }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error('OCR failed: ' + err.slice(0, 200))
  }
  return await res.json()
}

// Mark extraction as queued in the DB (called right before invoking the Edge Function)
export async function markDocumentForExtraction(documentId) {
  const { error } = await supabase
    .from('property_documents')
    .update({ extraction_status: 'pending', extraction_error: null })
    .eq('id', documentId)
  if (error) throw error
}

// Upload a PDF/image to storage, register it as a property document,
// trigger extraction, and return the extracted fields synchronously.
//
// Used by BuildingMortgageModal's "Scan mortgage PDF" flow so the
// user can drop in a Handelsbanken-style facility agreement (or any
// mortgage offer) and have the form pre-fill with lender, loan amount,
// rate, term, type, fees, monthly payment. Saves them from typing.
//
// The doc is associated with `firstPropertyId` because the schema
// requires a property_id; for building-level mortgages we pick the
// first unit as the document owner. The PDF stays attached there in
// the Documents tab, so users can find it later.
export async function uploadAndExtractMortgageDocument(file, firstPropertyId, category = 'mortgage') {
  const uid = (await supabase.auth.getUser()).data.user.id
  if (!file)            throw new Error('No file provided')
  if (!firstPropertyId) throw new Error('Need at least one property to attach the document to')

  // Storage path: userId/propertyId/timestamp_filename
  const safeName = (file.name || 'mortgage.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `${uid}/${firstPropertyId}/${Date.now()}_${safeName}`
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false,
  })
  if (upErr) throw upErr

  // Create the document row
  const { data: doc, error: docErr } = await supabase.from('property_documents').insert({
    property_id: firstPropertyId,
    user_id: uid,
    name: file.name || 'Mortgage document',
    file_path: path,
    file_type: file.type || 'application/pdf',
    file_size: file.size || 0,
    category,
    extraction_status: 'pending',
  }).select().single()
  if (docErr) throw docErr

  // Trigger extraction (synchronous — waits for Claude response)
  await triggerDocumentOCR(doc.id)

  // Read back the extracted fields
  const final = await fetchDocumentExtraction(doc.id)
  if (final?.extraction_status === 'failed') throw new Error(final.extraction_error || 'Extraction failed')
  return { document: doc, extracted: final?.extracted_fields || null }
}

// Fetch extraction status + fields for a document
export async function fetchDocumentExtraction(documentId) {
  const { data, error } = await supabase
    .from('property_documents')
    .select('extraction_status, extracted_fields, extraction_error, extracted_at')
    .eq('id', documentId)
    .single()
  if (error) throw error
  return data
}

// ── MTD ITSA (Making Tax Digital — Income Tax Self Assessment) ────────────────
// HMRC mandate hits 6 Apr 2026 for landlords > £50k income, 6 Apr 2027 > £30k.
// We provide per-user HMRC settings (NINO + business ID + OAuth tokens) and
// per-quarter submission rows with the aggregated income/expenses snapshot.

export async function fetchMtdSettings() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  // Explicit column list — never pull the OAuth tokens back to the client.
  // Token presence is exposed as the boolean `hmrc_oauth_connected` so the
  // UI can show whether the user has done the gov.uk handshake without
  // sending the actual token over the wire.
  const { data, error } = await supabase
    .from('mtd_settings')
    .select('user_id, nino, mtd_business_id, sandbox_mode, cash_basis, property_business_type, hmrc_token_expires_at, created_at, updated_at')
    .eq('user_id', uid).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    // Synthetic flag for UI gating — true if a non-expired access token exists.
    hmrc_access_token: !!(data.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function saveMtdSettings(patch) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  // Never let the client write OAuth tokens directly — those land via the
  // mtd-submit edge function during the HMRC OAuth callback.
  const safe = { ...patch }
  delete safe.hmrc_access_token
  delete safe.hmrc_refresh_token
  delete safe.hmrc_token_expires_at
  const { data, error } = await supabase
    .from('mtd_settings')
    .upsert({ user_id: uid, ...safe }, { onConflict: 'user_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchMtdSubmissions(taxYear) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  let q = supabase.from('mtd_submissions').select('*').eq('user_id', uid)
  if (taxYear) q = q.eq('tax_year', taxYear)
  const { data, error } = await q.order('quarter_number', { ascending: true })
  if (error) throw error
  return data || []
}

export async function upsertMtdSubmission({ tax_year, quarter_number, period_from, period_to, deadline, summary_json, status = 'draft' }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('mtd_submissions')
    .upsert({
      user_id: uid, tax_year, quarter_number, period_from, period_to, deadline,
      summary_json, status,
    }, { onConflict: 'user_id,tax_year,quarter_number' })
    .select().single()
  if (error) throw error
  return data
}

// Aggregate the user's rent + expenses for a given period across ALL their
// properties. Returns the raw rows so the caller can run buildQuarterlySummary
// from src/lib/mtdItsa.js client-side (keeps tax logic in one place).
export async function fetchMtdRawForPeriod({ periodFrom, periodTo, propertyIds = null }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')

  // Default: all user's non-deleted properties. We also need mortgage_amount
  // + mortgage_rate so we can compute the period's mortgage interest accrual
  // (residential financial cost — gets 20% basic-rate relief under S24).
  let propIds = propertyIds
  let mortgageProps = []
  if (!propIds) {
    const { data: props, error: pe } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .eq('user_id', uid).is('deleted_at', null)
    if (pe) throw pe
    propIds = (props || []).map(p => p.id)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  } else {
    const { data: props } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .in('id', propIds).is('deleted_at', null)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  }
  if (propIds.length === 0) return { payments: [], expenses: [], mortgageInterest: 0 }

  // Legacy rows carry only year/month (period_start IS NULL) — a plain
  // gte/lte on period_start silently excludes them, understating MTD income.
  // Fetch NULL-period rows too, synthesise whole-month period dates from
  // year/month, then re-filter to the requested window client-side.
  const [paymentsRes, expensesRes] = await Promise.all([
    supabase.from('rent_payments').select('id, property_id, amount, period_start, period_end, status, year, month')
      .in('property_id', propIds)
      .eq('status', 'paid')
      .or(`and(period_start.gte.${periodFrom},period_start.lte.${periodTo}),period_start.is.null`),
    supabase.from('property_expenses').select('id, property_id, amount, date, category, description')
      .in('property_id', propIds)
      .is('deleted_at', null)
      .gte('date', periodFrom).lte('date', periodTo),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (expensesRes.error) throw expensesRes.error

  const pad2 = (n) => String(n).padStart(2, '0')
  const payments = (paymentsRes.data || [])
    .map(p => {
      if (p.period_start || !p.year || !p.month) return p
      const lastDay = new Date(p.year, p.month, 0).getDate()
      return {
        ...p,
        period_start: `${p.year}-${pad2(p.month)}-01`,
        period_end: p.period_end || `${p.year}-${pad2(p.month)}-${pad2(lastDay)}`,
      }
    })
    .filter(p => p.period_start && p.period_start >= periodFrom && p.period_start <= periodTo)

  // Mortgage interest accrued over the period =
  //   sum(balance × annual_rate) × (period_days / 365)
  // mortgage_rate is stored as DECIMAL (0.05 for 5%). Year-one approximation
  // (true interest declines as principal is paid down on repayment mortgages).
  const from = new Date(periodFrom)
  const to   = new Date(periodTo)
  const periodDays = Math.max(0, Math.round((to - from) / 86400000) + 1)
  const annualInterest = mortgageProps.reduce((s, p) =>
    s + (Number(p.mortgage_amount) * Number(p.mortgage_rate)), 0)
  const mortgageInterest = Math.round((annualInterest * periodDays / 365) * 100) / 100

  return { payments, expenses: expensesRes.data || [], mortgageInterest }
}

// Start the HMRC gov.uk OAuth flow. Returns nothing — performs a
// full-page redirect to HMRC's authorize endpoint. After the user
// consents, HMRC redirects back to our hmrc-oauth-callback edge
// function which stores tokens + bounces user back here with
// ?hmrc_connected=1.
export async function startHmrcOAuth() {
  const { data, error } = await supabase.functions.invoke('hmrc-oauth-callback', {
    body: { action: 'start', return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('HMRC OAuth not configured — Justin needs to set HMRC_CLIENT_ID and add the redirect URI to the HMRC dev hub app.')
  window.location.href = data.authorize_url
}

// Clear the stored HMRC access + refresh tokens (next submission falls
// back to the local mock path). Keeps NINO / business ID / cash basis
// settings intact.
export async function disconnectHmrc() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase.from('mtd_settings').update({
    hmrc_access_token: null,
    hmrc_refresh_token: null,
    hmrc_token_expires_at: null,
  }).eq('user_id', uid)
  if (error) throw error
}

// Submit (or re-submit) a quarterly summary to HMRC via the mtd-submit
// edge function. In sandbox mode the edge function returns a mock
// reference; otherwise we collect Gov-Client-* fraud prevention headers
// (mandatory per HMRC's Fraud Prevention Spec — submissions without
// them are increasingly rejected in sandbox and always rejected in
// production) and pass them along so the edge function can forward
// them to HMRC.
export async function submitMtdQuarter(submissionId) {
  const fraudHeaders = await collectClientFraudHeaders()
  const { data, error } = await supabase.functions.invoke('mtd-submit', {
    body: { submission_id: submissionId, fraud_headers: fraudHeaders }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── XERO INTEGRATION ─────────────────────────────────────────────────────────
//
// Phase 2 (24 May 2026): multi-company. xero_connections is now keyed by
// (user_id, company_id) so a user with multiple OwnProperly companies can
// link a SEPARATE Xero org per company. Most helpers take companyId.

// Returns ALL of the user's Xero connections (one per company).
export async function fetchXeroConnections() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('xero_connections')
    .select('user_id, company_id, tenant_id, tenant_name, expires_at, scopes, last_sync_at, last_sync_status, last_sync_error, created_at')
    .eq('user_id', uid)
  if (error) throw error
  return data || []
}

// Convenience: fetch the connection for a specific company (or null).
export async function fetchXeroConnection(companyId) {
  if (!companyId) return null
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('xero_connections')
    .select('user_id, company_id, tenant_id, tenant_name, expires_at, scopes, last_sync_at, last_sync_status, last_sync_error, created_at')
    .eq('user_id', uid).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return data
}

// Start the Xero OAuth flow for a SPECIFIC company. The companyId is
// encoded in the state token so the callback knows which company to
// associate the new tokens with.
export async function startXeroOAuth(companyId) {
  if (!companyId) throw new Error('companyId required — Xero connections are per-company')
  const { data, error } = await supabase.functions.invoke('xero-oauth-callback', {
    body: { action: 'start', company_id: companyId, return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('Xero auth not configured — Justin needs to set XERO_CLIENT_ID')
  window.location.href = data.authorize_url
}

export async function disconnectXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase
    .from('xero_connections').delete()
    .eq('user_id', uid).eq('company_id', companyId)
  if (error) throw error
}

export async function runXeroSync(companyId, direction = 'to_xero') {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { direction, company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchXeroSyncLog(companyId, limit = 20) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  let q = supabase.from('xero_sync_log').select('*').eq('user_id', uid)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
    .order('started_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// ── Per-(user,company) Xero sync settings ──────────────────────────────

export async function fetchXeroSyncSettings(companyId) {
  if (!companyId) return null
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('xero_sync_settings').select('*')
    .eq('user_id', uid).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveXeroSyncSettings(companyId, patch) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const safe = { ...patch }
  // Server-managed fields the client shouldn't write
  delete safe.user_id; delete safe.company_id
  delete safe.created_at; delete safe.updated_at
  const { data, error } = await supabase
    .from('xero_sync_settings')
    .upsert({ user_id: uid, company_id: companyId, ...safe }, { onConflict: 'user_id,company_id' })
    .select().single()
  if (error) throw error
  return data
}

// Live-fetch the user's chart of accounts + bank accounts from Xero so
// the UI can render <select> dropdowns for the user to pick which
// account codes to use. Calls xero-sync with action='list_accounts'.
export async function fetchXeroAccounts(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'list_accounts', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.accounts || []
}

// Sync only specific properties (per-property "Sync just this one" button).
export async function runXeroSyncForProperties(companyId, propertyIds) {
  if (!companyId) throw new Error('companyId required')
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) throw new Error('propertyIds required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'both', company_id: companyId, property_ids: propertyIds }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Wipe the sync map for this (user, company). After this, the next
// normal sync re-pushes everything. Used by the "Re-sync everything"
// button after the user has cleared records on the Xero side.
export async function resyncAllXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'resync_all', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.cleared || 0
}

// Toggle the daily reconciliation cron on/off for this (user, company).
// Row in xero_cron_schedules exists ↔ cron is enabled.
export async function setXeroCronEnabled(companyId, enabled) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  if (enabled) {
    const { error } = await supabase.from('xero_cron_schedules')
      .upsert({ user_id: uid, company_id: companyId }, { onConflict: 'user_id,company_id' })
    if (error) throw error
  } else {
    const { error } = await supabase.from('xero_cron_schedules')
      .delete().eq('user_id', uid).eq('company_id', companyId)
    if (error) throw error
  }
  return enabled
}

export async function fetchXeroCronStatus(companyId) {
  if (!companyId) return null
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const { data } = await supabase.from('xero_cron_schedules')
    .select('*').eq('user_id', uid).eq('company_id', companyId).maybeSingle()
  return data
}

