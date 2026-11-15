// Backups & GDPR export.
//
// Three flavours of backup live in the product:
//   1. "Quick download" — assembles the user's data in-memory and triggers
//      a JSON file download. Free, instant, no storage cost.
//   2. "Manual backup now" — calls the `create-user-backups` edge function
//      which writes a snapshot to Storage and registers a `user_backups`
//      row. The bell icon picks up the event via createNotification.
//   3. The same edge function also runs nightly via pg_cron (separate
//      schedule, not orchestrated here).
//
// Plus a GDPR data-export helper that the Subject Access Request flow
// uses — same shape as the quick download but without the file dialog.
//
// Storage path layout: `user-backups/<user_id>/<backup_id>.json`,
// signed URL with 60s TTL for downloads (RLS prevents cross-user access).

import { supabase } from '../supabase'
import { logAction } from './audit'
import { createNotification } from './notifications'
import { fetchAllPages } from '../paginate'

// ── Quick download (no Storage round-trip) ─────────────────────────────
export async function downloadFullBackup(userId, userEmail) {
  const data = await exportUserData(userId)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ownproperly-backup-${userEmail?.split('@')[0] || userId}-${new Date().toISOString().slice(0,10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  await logAction(userId, null, 'backup.downloaded', 'backup', null, `Quick backup · ${data.properties?.length || 0} properties`)
}

// ── List a user's stored backups ───────────────────────────────────────
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

// ── Download a specific stored backup ──────────────────────────────────
export async function downloadBackupById(backupId, userId) {
  const { data: backup, error } = await supabase
    .from('user_backups')
    .select('*')
    .eq('id', backupId)
    .eq('user_id', userId)
    .single()
  if (error) throw error

  // 60s TTL is enough for the browser fetch below; RLS on the bucket
  // means even the URL can't be reused by a different user.
  const { data: urlData, error: urlErr } = await supabase.storage
    .from('user-backups')
    .createSignedUrl(backup.storage_path, 60)
  if (urlErr) throw urlErr

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

// ── Trigger an immediate stored backup via the edge function ───────────
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
  // Bell notification — fire-and-forget; backup already succeeded.
  try {
    await createNotification({
      type: 'backup',
      title: 'Backup created',
      body: 'A manual backup of your portfolio data has been saved.',
      link: '#/settings/backups',
    })
  } catch (_) {}
  return data
}

// ── Delete a stored backup (both row + storage object) ─────────────────
export async function deleteBackup(backupId, userId) {
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

// ── GDPR Subject Access Request export ─────────────────────────────────
// Used by both the quick-download path above and the explicit SAR flow.
// Returns a plain object (caller decides how to deliver it).
//
// 2026-11: every table used to be ONE unpaginated select filtered by the
// creator user_id, and `.then(r => r.data || [])` turned an error into an
// empty table — so a backup silently missed rows past the 1,000-row cap,
// rows a team-mate created, and whole tables on any error, then reported
// success. Now: scoped by the companies the user owns or has access to (and
// their properties), paginated, chunked, and any error throws so the UI
// shows a failure instead of a hollow file. The Rent Tracker, refurb, loan
// and short-let tables are included.
const ID_CHUNK = 100   // keeps .in() lists well under URL length limits

async function fetchAllIn(table, column, ids, select = '*') {
  const out = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK)
    out.push(...await fetchAllPages(() => supabase.from(table).select(select).in(column, part).order('id')))
  }
  return out
}

function mergeById(...lists) {
  const byId = new Map()
  for (const list of lists) for (const row of list) if (!byId.has(row.id)) byId.set(row.id, row)
  return [...byId.values()]
}

const ids = (rows) => rows.map(r => r.id)

export async function exportUserData(userId) {
  const { data: profile, error: profileErr } = await supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (profileErr) throw profileErr

  // Companies the user owns or has been given access to.
  const [owned, accessRows] = await Promise.all([
    fetchAllPages(() => supabase.from('companies').select('id').eq('owner_id', userId).order('id')),
    fetchAllPages(() => supabase.from('user_company_access').select('id, company_id').eq('user_id', userId).order('id')),
  ])
  const companyIds = [...new Set([...owned.map(c => c.id), ...accessRows.map(a => a.company_id)].filter(Boolean))]
  const companies = await fetchAllIn('companies', 'id', companyIds)

  // Properties in those companies, plus any the user created with no company.
  const properties = mergeById(
    await fetchAllIn('properties', 'company_id', companyIds),
    await fetchAllPages(() => supabase.from('properties').select('*').eq('user_id', userId).is('company_id', null).order('id')),
  )
  const propertyIds = ids(properties)

  const deals = mergeById(
    await fetchAllPages(() => supabase.from('deals').select('*').eq('user_id', userId).order('id')),
    await fetchAllIn('deals', 'company_id', companyIds),
  )

  const byProperty = (table, select) => fetchAllIn(table, 'property_id', propertyIds, select)
  const [
    compliance, maintenance, expenses, tenancyDetails, rentPayments, documents,
    tenancies, rentReceipts, nonChargeable, rentOverrides, paymentPlans,
    refurbProjects, stlBookings, stlAdjustments, refurbInvoices, externalLoans,
  ] = await Promise.all([
    byProperty('compliance_items'),
    byProperty('maintenance_jobs'),
    byProperty('property_expenses'),
    byProperty('tenancy_details'),
    byProperty('rent_payments'),
    byProperty('property_documents', 'id,property_id,name,file_url,file_path,file_type,file_size,category,created_at'),
    byProperty('tenancies'),
    byProperty('rent_receipts'),
    byProperty('non_chargeable_periods'),
    byProperty('rent_overrides'),
    byProperty('payment_plans'),
    byProperty('refurb_projects'),
    byProperty('stl_bookings'),
    byProperty('stl_adjustments'),
    fetchAllIn('refurb_invoices', 'company_id', companyIds),
    fetchAllIn('external_loans', 'company_id', companyIds),
  ])
  const [rentAllocations, refurbLines, refurbInvoiceAllocations, externalLoanPayments] = await Promise.all([
    fetchAllIn('rent_allocations', 'receipt_id', ids(rentReceipts)),
    fetchAllIn('refurb_lines', 'project_id', ids(refurbProjects)),
    fetchAllIn('refurb_invoice_allocations', 'invoice_id', ids(refurbInvoices)),
    fetchAllIn('external_loan_payments', 'loan_id', ids(externalLoans)),
  ])

  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile: profile || null,
    companies,
    properties,
    deals,
    compliance_items: compliance,
    maintenance_jobs: maintenance,
    expenses,
    // `tenancies` has always held tenancy_details rows; the Rent Tracker's
    // tenancies table is exported as rent_tracker_tenancies.
    tenancies: tenancyDetails,
    rent_payments: rentPayments,
    documents: documents.map(d=>({ id:d.id, property_id:d.property_id, name:d.name, created_at:d.created_at, file_url:d.file_url, file_path:d.file_path, file_type:d.file_type, file_size:d.file_size, category:d.category })),
    rent_tracker_tenancies: tenancies,
    rent_receipts: rentReceipts,
    rent_allocations: rentAllocations,
    non_chargeable_periods: nonChargeable,
    rent_overrides: rentOverrides,
    payment_plans: paymentPlans,
    refurb_projects: refurbProjects,
    refurb_lines: refurbLines,
    refurb_invoices: refurbInvoices,
    refurb_invoice_allocations: refurbInvoiceAllocations,
    external_loans: externalLoans,
    external_loan_payments: externalLoanPayments,
    stl_bookings: stlBookings,
    stl_adjustments: stlAdjustments,
  }
}
