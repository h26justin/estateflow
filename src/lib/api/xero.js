// Xero integration: connections, OAuth, sync and sync settings.
import { supabase } from '../supabase'

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

// What a push would post (counts, totals, bank, start date) without
// posting. The UI shows it in a confirm dialog before every manual push.
export async function previewXeroSync(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'preview', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Delete from Xero the transactions the latest push posted. dryRun only
// counts them.
export async function undoXeroPush(companyId, { dryRun = false } = {}) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'undo_push', company_id: companyId, dry_run: dryRun }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
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
