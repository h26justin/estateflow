// Nightly trash purge.
//
// Hard-deletes soft-deleted rows once they are past the 30-day retention
// window, removing their files from the private property-documents bucket
// FIRST. Runs daily at 04:30 UTC via pg_cron (purge-soft-deleted-daily), an
// hour before the nightly audit measures the purge horizon.
//
// Why an edge function and not SQL: the old purge_soft_deleted_older_than_30_days()
// deleted rows only, so every purged deal / property / company left its
// documents and photos orphaned in Storage (Postgres cascades the document
// rows away, nothing removes the blobs). Storage objects can only be removed
// through the Storage API, which SQL cannot call. It also referenced
// tenancy_details.deleted_at, a column that has never existed, so the job
// failed on its first scheduled run (2026-09-08) and never purged anything.
//
// This mirrors purgeExpiredTrash() in src/lib/api/_monolith.js (the lazy
// per-user purge the Trash page runs) with the service role, so trash is
// cleared even for users who never open the Trash page. Keep the table list
// and STORAGE_PATH_SOURCES in step with that file.
//
// Env vars required:
//   CRON_SECRET   (x-cron-secret gate, fail-closed)
//
// Body flags (JSON): { "dry_run": true } — report what would go, delete nothing.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET  = Deno.env.get('CRON_SECRET') || ''

const RETENTION_DAYS = 30
const BUCKET = 'property-documents'

// Each table is independent: companies.id is SET NULL on properties, so a
// company purge never takes properties (or their files) with it; deals,
// properties and companies cascade only to their own document rows.
const TABLES = [
  'companies', 'properties', 'deals', 'compliance_items', 'maintenance_jobs',
  'property_expenses', 'property_documents', 'company_documents',
]

type Source = { table: string; fk: string; col: 'file_path' | 'photos' }

// Where each purgeable table's files are referenced. Paths are collected
// BEFORE the rows go.
const STORAGE_PATH_SOURCES: Record<string, Source[]> = {
  deals:              [{ table: 'deal_documents',       fk: 'deal_id',     col: 'file_path' }],
  properties:         [{ table: 'property_documents',   fk: 'property_id', col: 'file_path' },
                       { table: 'property_inspections', fk: 'property_id', col: 'photos' },
                       { table: 'maintenance_jobs',     fk: 'property_id', col: 'photos' }],
  companies:          [{ table: 'company_documents',  fk: 'company_id', col: 'file_path' }],
  maintenance_jobs:   [{ table: 'maintenance_jobs',   fk: 'id',         col: 'photos' }],
  property_documents: [{ table: 'property_documents', fk: 'id',         col: 'file_path' }],
  company_documents:  [{ table: 'company_documents',  fk: 'id',         col: 'file_path' }],
}

// Same rules as extractStoragePaths() in src/lib/attachments.js: file_path is
// one path per row; photos is a JSONB array of { path } objects (bare strings
// on the oldest rows). Blank paths and public-URL-only legacy entries are
// skipped, there is nothing in the bucket for them.
function extractPaths(rows: any[], col: 'file_path' | 'photos'): string[] {
  const out: string[] = []
  for (const row of rows || []) {
    const v = row?.[col]
    if (col === 'photos') {
      if (!Array.isArray(v)) continue
      for (const item of v) {
        const p = typeof item === 'string' ? item : item?.path
        if (typeof p === 'string' && p.trim()) out.push(p.trim())
      }
    } else if (typeof v === 'string' && v.trim()) {
      out.push(v.trim())
    }
  }
  return [...new Set(out)]
}

async function pathsFor(admin: any, sources: Source[], ids: string[]): Promise<string[]> {
  const paths: string[] = []
  for (const src of sources) {
    try {
      const { data, error } = await admin.from(src.table).select(src.col).in(src.fk, ids)
      if (!error) paths.push(...extractPaths(data, src.col))
    } catch (_) { /* best effort: a missing table must not block the purge */ }
  }
  return paths
}

async function collectPaths(admin: any, table: string, ids: string[]): Promise<string[]> {
  return [...new Set(await pathsFor(admin, STORAGE_PATH_SOURCES[table] || [], ids))]
}

// Chunks of 100, the Storage API's comfortable batch size. Objects that no
// longer exist are simply absent from the response and counted as failed
// rather than thrown.
async function removeFiles(admin: any, paths: string[]): Promise<{ removed: number; failed: number }> {
  let removed = 0, failed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    try {
      const { data, error } = await admin.storage.from(BUCKET).remove(chunk)
      if (error) failed += chunk.length
      else { removed += (data || []).length; failed += chunk.length - (data || []).length }
    } catch (_) { failed += chunk.length }
  }
  return { removed, failed }
}

serve(async (req) => {
  // CRON-only function — no JWT auth. Gate with shared secret.
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  let flags: any = {}
  try { flags = await req.json() } catch { /* empty body is fine */ }
  const dryRun = flags?.dry_run === true

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
  const summary: Record<string, any> = {}
  const errors: string[] = []
  let rowsPurged = 0, filesRemoved = 0

  for (const table of TABLES) {
    try {
      const { data: rows, error: selErr } = await admin.from(table)
        .select('id')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff)
      if (selErr) { errors.push(`${table}: ${selErr.message}`); continue }
      const ids = (rows || []).map((r: any) => r.id)
      if (!ids.length) { summary[table] = { rows: 0 }; continue }

      const paths = await collectPaths(admin, table, ids)
      const entry: Record<string, any> = { rows: ids.length, files: paths.length }
      if (dryRun) {
        entry.ids = ids
        entry.paths = paths
      } else {
        if (paths.length) {
          const r = await removeFiles(admin, paths)
          entry.files_removed = r.removed
          entry.files_failed = r.failed
          filesRemoved += r.removed
        }
        // Repeat the trash conditions so a row restored between the select
        // and the delete survives.
        const { error: delErr, count } = await admin.from(table)
          .delete({ count: 'exact' })
          .in('id', ids)
          .not('deleted_at', 'is', null)
          .lt('deleted_at', cutoff)
        if (delErr) { errors.push(`${table}: ${delErr.message}`); entry.error = delErr.message }
        else { entry.rows_deleted = count ?? ids.length; rowsPurged += count ?? ids.length }
      }
      summary[table] = entry
    } catch (e) {
      errors.push(`${table}: ${String(e).slice(0, 200)}`)
    }
  }

  // Browser crash telemetry has no files and no soft-delete; it ages out.
  try {
    if (dryRun) {
      const { count } = await admin.from('client_errors').select('id', { count: 'exact', head: true }).lt('created_at', cutoff)
      summary.client_errors = { rows: count ?? 0 }
    } else {
      const { error, count } = await admin.from('client_errors').delete({ count: 'exact' }).lt('created_at', cutoff)
      if (error) errors.push(`client_errors: ${error.message}`)
      else { summary.client_errors = { rows_deleted: count ?? 0 }; rowsPurged += count ?? 0 }
    }
  } catch (e) {
    errors.push(`client_errors: ${String(e).slice(0, 200)}`)
  }

  console.log(`[purge-trash] ${dryRun ? 'DRY RUN · ' : ''}${rowsPurged} row(s) · ${filesRemoved} file(s) · errors: ${errors.join('; ') || 'none'}`)
  return new Response(JSON.stringify({
    dry_run: dryRun, retention_days: RETENTION_DAYS, cutoff,
    rows_purged: rowsPurged, files_removed: filesRemoved, tables: summary, errors,
  }), { headers: { 'Content-Type': 'application/json' } })
})
