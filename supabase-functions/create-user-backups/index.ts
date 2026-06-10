// supabase/functions/create-user-backups/index.ts
// Creates a backup for every user and stores in Supabase Storage.
// Triggered weekly by pg_cron. Also callable on-demand for a single user.
// Deploy: `supabase functions deploy create-user-backups`
//
// POST payload (optional): { user_id: "uuid" } to back up one user only.
// With no payload: backs up every user.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function backupOneUser(admin: any, userId: string, userEmail: string, triggerSource: string) {
  // Pull all user data
  const [companies, properties, compliance, maintenance, expenses, rentPayments, tenancies, deals, rightToRent, depositProtection, legalNotices, documents] = await Promise.all([
    admin.from('companies').select('*').eq('owner_id', userId).then((r: any) => r.data || []),
    admin.from('properties').select('*').eq('user_id', userId).then((r: any) => r.data || []),
    admin.from('compliance_items').select('*').eq('user_id', userId).then((r: any) => r.data || []),
    admin.from('maintenance_jobs').select('*').eq('user_id', userId).then((r: any) => r.data || []),
    admin.from('property_expenses').select('*').eq('user_id', userId).then((r: any) => r.data || []),
    admin.from('rent_payments').select('*').eq('user_id', userId).then((r: any) => r.data || []),
    admin.from('tenancy_details').select('*').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
    admin.from('deals').select('*').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
    admin.from('right_to_rent').select('*').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
    admin.from('deposit_protection').select('*').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
    admin.from('legal_notices').select('*').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
    admin.from('property_documents').select('id,name,file_url,file_path,file_type,file_size,category,created_at').eq('user_id', userId).then((r: any) => r.data || []).catch(() => []),
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
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
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

    // Auth: the cron path passes the service-role key in the Authorization
    // header (set by pg_cron). User-initiated manual backups pass the
    // signed-in user's JWT. We must verify *which* of those is happening and
    // gate access accordingly — without this, any logged-in user could POST
    // `{ user_id: "<victim>" }` and trigger an admin-level dump of another
    // user's data.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const isServiceCall = !!token && token === SERVICE_ROLE_KEY

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
      const { data } = await admin.from('user_profiles').select('user_id, email')
      profiles = data || []
    }

    if (profiles.length === 0) {
      return new Response(JSON.stringify({ error: 'No users found' }), { status: 404 })
    }

    const results = []
    for (const p of profiles) {
      try {
        const r = await backupOneUser(admin, p.user_id, p.email, triggerSource)
        results.push({ ...r, status: 'ok' })
      } catch (e) {
        results.push({ user_id: p.user_id, email: p.email, status: 'error', error: (e as Error).message })
      }
    }

    // Prune old backups (keep latest 12 per user)
    // Prune old backups (ignore errors — not critical)
    try { await admin.rpc('prune_old_backups') } catch (_) {}

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
})
