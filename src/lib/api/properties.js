// Properties: CRUD, bulk create, duplicate, archive / sold, summary PDF,
// notes and sort order.
import { supabase } from '../supabase'
import { loadJsPDF } from '../pdfLibs'
import { sortPropertiesCanonically } from '../addressUtils'
import { uid } from './_shared'
import { geocodeProperty } from './geocoding'

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
  const jsPDF = await loadJsPDF()
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

// ── SORT ORDER ────────────────────────────────────────────────────────────────
export async function updatePropertySortOrder(id, sortOrder) {
  await supabase.from('properties').update({ sort_order: sortOrder }).eq('id', id)
}
