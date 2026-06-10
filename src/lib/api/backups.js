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
import { logAction } from './_monolith'
import { createNotification } from './notifications'

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
    supabase.from('property_documents').select('id,name,file_url,file_path,file_type,file_size,category,created_at').eq('user_id', userId).then(r=>{ if (r.error) throw r.error; return r.data||[] }),
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
    documents: documents.map(d=>({ id:d.id, name:d.name, created_at:d.created_at, file_url:d.file_url, file_path:d.file_path, file_type:d.file_type, file_size:d.file_size, category:d.category })),
  }
}
