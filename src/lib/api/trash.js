// Soft delete, company cascade delete / restore, Trash listing and purge.
import { supabase } from '../supabase'
import { extractStoragePaths } from '../attachments'
import { logAction } from './audit'

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
