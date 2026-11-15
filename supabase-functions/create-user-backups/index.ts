// supabase/functions/create-user-backups/index.ts
// Creates a backup for every user and stores in Supabase Storage.
// Triggered weekly by pg_cron. Also callable on-demand for a single user.
// Deploy: `supabase functions deploy create-user-backups`
//
// POST payload (optional): { user_id: "uuid" } to back up one user only.
// With no payload: backs up every user.
//
// Auth (two accepted paths, mirroring trial-emails / xero-cron-reconcile):
//   • Cron / service: `x-cron-secret: <CRON_SECRET>` header (preferred — survives
//     service-role key rotation), or a raw service-role key in the Authorization
//     bearer (legacy fallback).
//   • User-initiated manual backup: the signed-in user's JWT in the Authorization
//     bearer; the caller may only target their own user_id (platform admins aside).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { secretMatches } from './secrets.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

// Browser-callable (the Settings → Backups "Create backup now" button), so it
// needs CORS — without it the preflight has no Access-Control-Allow-Origin and
// the fetch rejects with "Failed to fetch" before any backup runs.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// PostgREST returns at most 1,000 rows per request, so every table is read
// in pages with a stable order. Any page error fails the whole user's backup
// (thrown) — a truncated backup must never be stored and counted as complete.
// optional = the table may not exist in this database (older schema); only
// a missing-table error is tolerated for those, nothing else.
const PAGE = 1000

function isMissingTable(error: any): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(String(error?.message || ''))
}

async function allRows(admin: any, table: string, cols: string, ownerCol: string, userId: string, optional = false, orderCol = 'id'): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(cols).eq(ownerCol, userId)
      .order(orderCol, { ascending: true }).range(from, from + PAGE - 1)
    if (error) {
      if (optional && from === 0 && isMissingTable(error)) return []
      throw new Error(`${table}: ${error.message}`)
    }
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

async function backupOneUser(admin: any, userId: string, userEmail: string, triggerSource: string) {
  // Pull all user data
  const [companies, properties, compliance, maintenance, expenses, rentPayments, tenancies, deals, rightToRent, depositProtection, legalNotices, documents] = await Promise.all([
    allRows(admin, 'companies', '*', 'owner_id', userId),
    allRows(admin, 'properties', '*', 'user_id', userId),
    allRows(admin, 'compliance_items', '*', 'user_id', userId),
    allRows(admin, 'maintenance_jobs', '*', 'user_id', userId),
    allRows(admin, 'property_expenses', '*', 'user_id', userId),
    allRows(admin, 'rent_payments', '*', 'user_id', userId),
    // tenancy_details is one row per property (upserted on property_id).
    allRows(admin, 'tenancy_details', '*', 'user_id', userId, true, 'property_id'),
    allRows(admin, 'deals', '*', 'user_id', userId, true),
    allRows(admin, 'right_to_rent', '*', 'user_id', userId, true),
    allRows(admin, 'deposit_protection', '*', 'user_id', userId, true),
    allRows(admin, 'legal_notices', '*', 'user_id', userId, true),
    allRows(admin, 'property_documents', 'id,name,file_url,file_path,file_type,file_size,category,created_at', 'user_id', userId, true),
  ])

  const counts = {
    companies: companies.length,
    properties: properties.length,
    tenancies: tenancies.length,
    compliance: compliance.length,
    maintenance: maintenance.length,
    expenses: expenses.length,
    rent_payments: rentPayments.length,
    deals: deals.length,
    right_to_rent: rightToRent.length,
    deposit_protection: depositProtection.length,
    legal_notices: legalNotices.length,
    documents: documents.length,
  }

  const backup = {
    version: 1,
    user_id: userId,
    user_email: userEmail,
    created_at: new Date().toISOString(),
    trigger: triggerSource,
    counts,
    data: {
      companies, properties, compliance_items: compliance, maintenance_jobs: maintenance,
      expenses, rent_payments: rentPayments, tenancies, deals, right_to_rent: rightToRent,
      deposit_protection: depositProtection, legal_notices: legalNotices, documents,
    },
  }

  const json = JSON.stringify(backup)
  const size = new TextEncoder().encode(json).length
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `${userId}/${timestamp}.json`

  // Upload to Storage
  const { error: uploadErr } = await admin.storage
    .from('user-backups')
    .upload(path, json, {
      contentType: 'application/json',
      upsert: false,
    })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  // Record metadata
  const { error: metaErr } = await admin.from('user_backups').insert({
    user_id: userId,
    type: triggerSource === 'weekly_cron' ? 'automatic' : 'manual',
    storage_path: path,
    size_bytes: size,
    counts,
    trigger: triggerSource,
  })

  if (metaErr) throw new Error(`Metadata failed: ${metaErr.message}`)

  return { user_id: userId, email: userEmail, size, counts, path }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Parse body first so we know whether this is a single-user or mass call.
    let targetUserId: string | null = null
    let triggerSource = 'weekly_cron'
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body?.user_id) targetUserId = body.user_id
        if (body?.trigger) triggerSource = body.trigger
      } catch (_) {}
    }

    // Auth: the cron path authenticates with a shared CRON_SECRET (preferred —
    // mirrors trial-emails / xero-cron-reconcile and survives service-role key
    // rotation) or, as a legacy fallback, a raw service-role key in the bearer.
    // User-initiated manual backups pass the signed-in user's JWT. We must
    // verify *which* of those is happening and gate access accordingly —
    // without this, any logged-in user could POST `{ user_id: "<victim>" }` and
    // trigger an admin-level dump of another user's data.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const cronSecret = req.headers.get('x-cron-secret') || ''
    const isServiceCall =
      secretMatches(cronSecret, CRON_SECRET) ||
      (!!token && secretMatches(token, SERVICE_ROLE_KEY))

    if (!isServiceCall) {
      if (!token) return jsonError(401, 'Missing Authorization header')
      const { data: userData, error: userErr } = await admin.auth.getUser(token)
      const caller = userData?.user
      if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

      // Non-service callers must target themselves (or be a platform admin).
      // A missing user_id is also rejected — mass-backup is service-only.
      if (!targetUserId) return jsonError(400, 'user_id required for user-initiated backups')
      if (targetUserId !== caller.id) {
        const { data: prof } = await admin
          .from('user_profiles')
          .select('is_developer, platform_admin')
          .eq('user_id', caller.id)
          .single()
        const isPlatformAdmin = prof?.is_developer === true || prof?.platform_admin === true
        if (!isPlatformAdmin) return jsonError(403, 'Forbidden')
      }
    }

    // Get target user list
    let profiles: { user_id: string; email: string }[] = []
    if (targetUserId) {
      const { data } = await admin.from('user_profiles').select('user_id, email').eq('user_id', targetUserId).single()
      if (data) profiles = [data]
    } else {
      // Every user, paged (a single select stops at 1,000 rows). A page error
      // aborts the run rather than silently backing up only some users.
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('user_profiles').select('user_id, email')
          .order('user_id', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw new Error(`user_profiles: ${error.message}`)
        profiles.push(...(data || []))
        if ((data || []).length < PAGE) break
      }
    }

    if (profiles.length === 0) {
      return new Response(JSON.stringify({ error: 'No users found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results = []
    for (const p of profiles) {
      try {
        const r = await backupOneUser(admin, p.user_id, p.email, triggerSource)
        results.push({ ...r, status: 'ok' })
      } catch (e) {
        console.error(`create-user-backups: backup failed for user ${p.user_id}:`, (e as Error).message)
        results.push({ user_id: p.user_id, email: p.email, status: 'error', error: 'Backup failed' })
      }
    }

    // Prune old backups (keep latest 12 per user)
    // Prune old backups (ignore errors — not critical)
    try { await admin.rpc('prune_old_backups') } catch (_) {}

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('create-user-backups: failed:', e)
    return new Response(JSON.stringify({ error: 'Backup failed — please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
