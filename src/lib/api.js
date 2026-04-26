import { supabase } from './supabase'

const uid = async () => (await supabase.auth.getUser()).data.user.id

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
  const { data, error } = await supabase
    .from('properties')
    .select('*, company:companies(id,name,abbr,color), refurb_phases(*), refurb_costs(*), rent_payments(*)')
    .is('deleted_at', null)
    .order('sort_order', {ascending:true})
    .order('name', {ascending:true})
  if (error) throw error
  return data
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
  return { ...data, refurb_phases: [], refurb_costs: [], rent_payments: [] }
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
 * data but a new ID. Children (refurb_phases, refurb_costs, compliance_items,
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
  return { ...created, refurb_phases: [], refurb_costs: [], rent_payments: [] }
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
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
      s.onload = res; s.onerror = () => rej(new Error('Could not load PDF library'))
      document.head.appendChild(s)
    })
  }
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
  doc.text('OwnProperly — Property Summary', margin, 290)

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

export async function createRefurbPhase(propertyId, phase) {
  const { data, error } = await supabase
    .from('refurb_phases').insert({ ...phase, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateRefurbPhase(id, fields) {
  const { data, error } = await supabase
    .from('refurb_phases').update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteRefurbPhase(id) {
  const { error } = await supabase.from('refurb_phases').delete().eq('id', id)
  if (error) throw error
}
export async function createRefurbCost(propertyId, cost) {
  const { data, error } = await supabase
    .from('refurb_costs').insert({ ...cost, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateRefurbCost(id, fields) {
  const { data, error } = await supabase
    .from('refurb_costs').update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteRefurbCost(id) {
  const { error } = await supabase.from('refurb_costs').delete().eq('id', id)
  if (error) throw error
}

export async function upsertRentPayment(propertyId, year, month, status, amount, notes, periodStart, periodEnd) {
  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const payload = { property_id: propertyId, user_id: await uid(), year, month, month_label: monthLabel, status, amount, notes }
  if (periodStart) payload.period_start = periodStart
  if (periodEnd)   payload.period_end   = periodEnd
  const { data, error } = await supabase
    .from('rent_payments')
    .upsert(payload, { onConflict: 'property_id,year,month' })
    .select().single()
  if (error) throw error
  return data
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
  const { data, error } = await supabase.from('compliance_items').select('*').eq('property_id', propertyId).order('expiry_date')
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
 * Maps DocumentsTab category codes to compliance cert types:
 *   gas      -> 'gas'   (Gas Safety Certificate)
 *   eicr     -> 'eicr'  (Electrical Installation Condition Report)
 *   epc      -> 'epc'   (Energy Performance Certificate)
 *   insurance-> 'insurance'
 */
export function buildComplianceFromDoc(doc) {
  if (!doc || !doc.extracted_fields) return null
  const f = doc.extracted_fields
  const expiry = ukDateToISO(f.expiry_date || f.cover_end || f.valid_to)
  if (!expiry) return null

  const certNames = {
    gas:       'Gas Safety Certificate',
    eicr:      'EICR',
    epc:       'EPC',
    insurance: 'Landlord Insurance',
  }
  const cert_type = doc.category
  const cert_name = certNames[cert_type]
  if (!cert_name) return null

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
export async function deleteCompliance(id) {
  const { error } = await supabase.from('compliance_items').delete().eq('id', id)
  if (error) throw error
}
export async function fetchAllCompliance(userId) {
  const { data, error } = await supabase.from('compliance_items').select('*, property:properties(name,company_id)').eq('user_id', userId).order('expiry_date')
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
  const { data, error } = await supabase.from('maintenance_jobs').select('*').eq('property_id', propertyId).order('created_at', {ascending:false})
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
export async function deleteMaintenance(id) {
  const { error } = await supabase.from('maintenance_jobs').delete().eq('id', id)
  if (error) throw error
}

// ── EXPENSES ─────────────────────────────────────────────
export async function fetchExpenses(propertyId) {
  const { data, error } = await supabase.from('property_expenses').select('*').eq('property_id', propertyId).order('date', {ascending:false})
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
export async function deleteExpense(id) {
  const { error } = await supabase.from('property_expenses').delete().eq('id', id)
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
          status: 'void'
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
  const { error } = await supabase.auth.resetPasswordForEmail(email)
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
  const { data, error } = await supabase.from('property_notes')
    .insert({ property_id: propertyId, content, category, user_id: userId, user_email: userEmail })
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

export async function uploadDocument(propertyId, propertyName, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `${propertyId}/${Date.now()}.${ext}`
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
    .select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadCompanyDocument(companyId, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `company_${companyId}/${Date.now()}.${ext}`
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

export async function deleteCompanyDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('company_documents').delete().eq('id', doc.id)
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
  const { data, error } = await supabase
    .from('invitations')
    .update({ accepted: true, accepted_at: new Date().toISOString() })
    .eq('token', token)
    .eq('email', (await supabase.auth.getUser()).data.user.email)
    .select().single()
  if (error) throw error
  // Grant access to the company
  if (data) {
    await supabase.from('user_company_access').upsert({
      user_id: (await supabase.auth.getUser()).data.user.id,
      company_id: data.company_id,
      email: data.email,
      is_admin: data.is_admin,
      is_owner: false,
    }, { onConflict: 'user_id,company_id' })
  }
  return data
}

export async function deleteInvitation(id) {
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  if (error) throw error
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

export async function createCheckoutSession(companyId, action = 'checkout') {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId, action }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Billing error')
  return data.url
}

export async function fetchAllCompaniesAdmin() {
  // Platform admin only — fetches all companies with owner emails
  const { data, error } = await supabase
    .from('companies')
    .select('*, subscriptions(*)')
    .order('name')
  if (error) throw error
  return data || []
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
export async function fetchAdminAllCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select(`
      *,
      subscriptions ( status, property_count, current_period_end, stripe_subscription_id )
    `)
    .order('created_at', { ascending: false })
  if (error) throw error

  // Get real property counts directly from properties table
  const { data: propCounts } = await supabase
    .from('properties')
    .select('company_id')
  const countMap = {}
  if (propCounts) {
    propCounts.forEach(p => {
      countMap[p.company_id] = (countMap[p.company_id] || 0) + 1
    })
  }

  // Attach owner emails from user_profiles
  const ownerIds = [...new Set((data || []).map(c => c.owner_id).filter(Boolean))]
  let profileMap = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', ownerIds)
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p.email })
  }

  return (data || []).map(c => ({
    ...c,
    owner_email: profileMap[c.owner_id] || null,
    real_property_count: countMap[c.id] || 0,           // actual props on platform
    paid_property_count: c.subscriptions?.[0]?.property_count || 0, // Stripe billed count
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
  const { data, error } = await supabase.from('deals').select('*').eq('user_id', userId).order('created_at', { ascending: false })
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

export async function deleteDeal(id) {
  const { error } = await supabase.from('deals').delete().eq('id', id)
  if (error) throw error
}

export async function duplicateDeal(deal) {
  const { id, created_at, updated_at, ...rest } = deal
  const { data, error } = await supabase.from('deals')
    .insert({ ...rest, name: rest.name + ' (copy)', status: 'analysing' }).select().single()
  if (error) throw error
  return data
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

export async function uploadDealDocument(dealId, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `deal_${dealId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  // Private bucket — no public URL stored. View links generated on demand
  // via getDocumentSignedUrl() against file_path.
  const { error } = await supabase.from('deal_documents').insert({
    deal_id: dealId, name: file.name, file_path: path,
    size: file.size, type: file.type, user_id: userId,
  })
  if (error) throw error
  return path
}

export async function deleteDealDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('deal_documents').delete().eq('id', doc.id)
  if (error) throw error
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
    .eq('user_id', userId).order('expiry_date')
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
    .eq('user_id', userId).order('payment_date', { ascending: false })
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
  const ext = file.name.split('.').pop()
  const path = `company_logos/${companyId}.${ext}`
  await supabase.storage.from('property-documents').remove([path]).catch(()=>{})
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
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

export async function extendTrial(companyId, days) {
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + days)
  const { error } = await supabase.from('companies')
    .update({ trial_ends_at: newDate.toISOString() }).eq('id', companyId)
  if (error) throw error
  return newDate
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

// ── TENANT PORTAL ─────────────────────────────────────────────────────────────
export async function checkIsTenant(userId) {
  try {
    const { data } = await supabase.from('tenant_profiles')
      .select('*, property:properties(*, company:companies(*))').eq('user_id', userId)
    return data || []
  } catch(e) { return [] }
}

export async function inviteTenant(propertyId, email, invitedBy) {
  // Create a Supabase auth invite
  const { data, error } = await supabase.auth.admin ? 
    { error: new Error('Use edge function') } : { error: new Error('Use edge function') }
  // Store pending invite in a simple way - email the tenant with a signup link
  const baseUrl = window.location.origin
  const signupUrl = `${baseUrl}?tenant_property=${propertyId}`
  return { signupUrl, email }
}

export async function registerTenantProfile(userId, propertyId) {
  const { data, error } = await supabase.from('tenant_profiles')
    .upsert({ user_id: userId, property_id: propertyId }, { onConflict: 'user_id,property_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchTenantProperty(userId) {
  const { data, error } = await supabase.from('tenant_profiles')
    .select(`
      *,
      property:properties(
        *,
        company:companies(*, contact_mode, agent_name, agent_phone, agent_email)
      )
    `)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data
}

export async function fetchTenantRentPayments(propertyId, userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*').eq('property_id', propertyId).order('payment_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchTenantDocuments(propertyId) {
  const { data, error } = await supabase.from('property_documents')
    .select('*').eq('property_id', propertyId).eq('shared_with_tenant', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchTenantMaintenance(propertyId, userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*').eq('property_id', propertyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function submitMaintenanceRequest(propertyId, tenantUserId, title, description, priority, photos = []) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({
    property_id: propertyId, title, description, priority, status: 'open',
    reported_by_tenant: true, user_id: tenantUserId, photos
  }).select().single()
  if (error) throw error
  // Notify landlord via edge function
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${supabaseUrl}/functions/v1/notify-landlord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type: 'maintenance', property_id: propertyId, title, message: description, priority, photos })
    })
  } catch(e) {} // Never block submission if notification fails
  return data
}

export async function fetchTenantMessages(propertyId, tenantUserId) {
  const { data, error } = await supabase.from('tenant_messages')
    .select('*').eq('property_id', propertyId).order('created_at')
  if (error) throw error
  return data || []
}

export async function sendTenantMessage(propertyId, tenantUserId, message, senderType = 'tenant') {
  const { data, error } = await supabase.from('tenant_messages')
    .insert({ property_id: propertyId, tenant_user_id: tenantUserId, message, sender_type: senderType })
    .select().single()
  if (error) throw error
  // Notify landlord only when tenant sends (not landlord reply)
  if (senderType === 'tenant') {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${supabaseUrl}/functions/v1/notify-landlord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ type: 'message', property_id: propertyId, message })
      })
    } catch(e) {}
  }
  return data
}

export async function markMessagesRead(propertyId, tenantUserId) {
  await supabase.from('tenant_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('property_id', propertyId).eq('sender_type', 'landlord').is('read_at', null)
}

export async function setDocumentSharedWithTenant(docId, shared) {
  const { error } = await supabase.from('property_documents')
    .update({ shared_with_tenant: shared }).eq('id', docId)
  if (error) throw error
}

export async function saveCompanyContactMode(companyId, mode, agentName, agentPhone, agentEmail) {
  const { error } = await supabase.from('companies')
    .update({ contact_mode: mode, agent_name: agentName, agent_phone: agentPhone, agent_email: agentEmail })
    .eq('id', companyId)
  if (error) throw error
}

export async function savePropertyContactOverride(propertyId, override) {
  const { error } = await supabase.from('properties')
    .update({ contact_mode_override: override }).eq('id', propertyId)
  if (error) throw error
}

// ── SUBDOMAIN / COMPANY LOOKUP ────────────────────────────────────────────────
export async function fetchCompanyBySubdomain(subdomain) {
  const { data, error } = await supabase
    .from('companies')
    .select('*, company_settings:company_settings(*)')
    .eq('subdomain', subdomain.toLowerCase())
    .single()
  if (error) return null
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
  const ext = file.name.split('.').pop()
  const path = `maintenance/${jobId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('property-documents').upload(path, file, { upsert: true })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  return { url: publicUrl, path, name: file.name }
}

export async function attachPhotosToJob(jobId, photos) {
  const { error } = await supabase.from('maintenance_jobs')
    .update({ photos: photos }).eq('id', jobId)
  if (error) throw error
}

export async function fetchTenantPaymentTracker(propertyId) {
  // Get last 12 months of rent payments
  const { data } = await supabase.from('rent_payments')
    .select('*').eq('property_id', propertyId)
    .order('payment_date', { ascending: false })
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

// Permanent hard delete (only for admins or from trash after 30 days)
export async function hardDeleteEntity(table, id) {
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

export async function purgeExpiredTrash(userId) {
  if (!userId) return { purged: 0 }
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
  let purged = 0
  for (const { table, scope } of tables) {
    try {
      const { error, count } = await supabase.from(table)
        .delete({ count: 'exact' })
        .eq(scope.col, scope.val)
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
      if (!error && count) purged += count
    } catch (e) { /* table-level error: continue with the others */ }
  }
  return { purged, retentionDays: TRASH_RETENTION_DAYS }
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
    safe(supabase.from('compliance_items').select('id, item_type, expiry_date, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('maintenance_jobs').select('id, title, description, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_expenses').select('id, description, amount, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('deals').select('id, title, address, deleted_at, deleted_by').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_documents').select('id, name, file_path, file_url, category, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
  ])

  return {
    properties: props.map(r => ({ ...r, _type: 'properties', _label: 'Property', _name: r.name || r.address })),
    companies: companies.map(r => ({ ...r, _type: 'companies', _label: 'Company', _name: r.name })),
    tenancies: tenancies.map(r => ({ ...r, _type: 'tenancy_details', _label: 'Tenancy', _name: `${r.tenant_name || 'Tenant'} @ ${r.property?.name || '—'}` })),
    compliance: compliance.map(r => ({ ...r, _type: 'compliance_items', _label: 'Certificate', _name: `${r.item_type} @ ${r.property?.name || '—'}` })),
    maintenance: maintenance.map(r => ({ ...r, _type: 'maintenance_jobs', _label: 'Repair job', _name: `${r.title || r.description} @ ${r.property?.name || '—'}` })),
    expenses: expenses.map(r => ({ ...r, _type: 'property_expenses', _label: 'Expense', _name: `${r.description} (£${r.amount}) @ ${r.property?.name || '—'}` })),
    deals: deals.map(r => ({ ...r, _type: 'deals', _label: 'Deal', _name: r.title || r.address })),
    documents: documents.map(r => ({ ...r, _type: 'property_documents', _label: 'Document', _name: `${r.name} @ ${r.property?.name || '—'}` })),
  }
}

// ── MANUAL BACKUP: downloads complete user data as a single JSON file ─────────
export async function downloadFullBackup(userId, userEmail) {
  const data = await exportUserData(userId)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ownproperly-backup-${userEmail?.split('@')[0] || userId}-${new Date().toISOString().slice(0,10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  // Log the backup event
  await logAction(userId, null, 'backup.downloaded', 'backup', null, `Quick backup · ${data.properties?.length || 0} properties`)
}

// ── BACKUP HISTORY: list all backups for a user ──────────────────────────────
export async function fetchUserBackups(userId) {
  const { data, error } = await supabase
    .from('user_backups')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

// ── DOWNLOAD A SPECIFIC BACKUP FROM STORAGE ──────────────────────────────────
export async function downloadBackupById(backupId, userId) {
  // Get the storage path
  const { data: backup, error } = await supabase
    .from('user_backups')
    .select('*')
    .eq('id', backupId)
    .eq('user_id', userId)
    .single()
  if (error) throw error

  // Get a signed URL for the storage file (valid 60 seconds)
  const { data: urlData, error: urlErr } = await supabase.storage
    .from('user-backups')
    .createSignedUrl(backup.storage_path, 60)
  if (urlErr) throw urlErr

  // Fetch the file and trigger download
  const resp = await fetch(urlData.signedUrl)
  if (!resp.ok) throw new Error('Failed to fetch backup file')
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ownproperly-backup-${new Date(backup.created_at).toISOString().slice(0,10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)

  await logAction(userId, null, 'backup.downloaded', 'backup', backupId, 'Stored backup')
  return backup
}

// ── CREATE A MANUAL BACKUP NOW (via Edge Function) ───────────────────────────
export async function createManualBackup(userId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user-backups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ user_id: userId, trigger: 'user_manual' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Backup failed')
  return data
}

// ── DELETE A SPECIFIC BACKUP ─────────────────────────────────────────────────
export async function deleteBackup(backupId, userId) {
  // Get storage path
  const { data: backup } = await supabase
    .from('user_backups')
    .select('storage_path')
    .eq('id', backupId)
    .eq('user_id', userId)
    .single()
  if (backup?.storage_path) {
    await supabase.storage.from('user-backups').remove([backup.storage_path])
  }
  const { error } = await supabase.from('user_backups').delete().eq('id', backupId).eq('user_id', userId)
  if (error) throw error
}

// ── GDPR DATA EXPORT ──────────────────────────────────────────────────────────
export async function exportUserData(userId) {
  const [
    profile, companies, properties, deals,
    compliance, maintenance, expenses, tenancies,
    rentPayments, documents
  ] = await Promise.all([
    supabase.from('user_profiles').select('*').eq('user_id', userId).single().then(r=>r.data),
    supabase.from('companies').select('*').eq('owner_id', userId).then(r=>r.data||[]),
    supabase.from('properties').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('deals').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('compliance_items').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('maintenance_jobs').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('property_expenses').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('tenancy_details').select('*').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
    supabase.from('rent_payments').select('*').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
    supabase.from('property_documents').select('id,name,created_at,url').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
  ])
  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile,
    companies,
    properties,
    deals,
    compliance_items: compliance,
    maintenance_jobs: maintenance,
    expenses,
    tenancies,
    rent_payments: rentPayments,
    documents: documents.map(d=>({ id:d.id, name:d.name, created_at:d.created_at, url:d.url })),
  }
}

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
export async function sendOnboardingEmail(email, name, sequence) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const { data: { session } } = await supabase.auth.getSession()
  await fetch(`${supabaseUrl}/functions/v1/onboarding-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ email, name, sequence })
  })
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

  // Rent arrears (max -25 points)
  const overduePayments = rentPayments.filter(p => p.status === 'overdue')
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
  if (tenancy?.tenancy_end_date) {
    const end = new Date(tenancy.tenancy_end_date)
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
  if (!loanAmount || loanAmount <= 0) return { cash: true }
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
