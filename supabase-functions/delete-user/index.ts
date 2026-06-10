// Platform-admin user deletion.
//
// Called by AdminDashboard via api.deleteUser(targetUserId), which POSTs
// { target_user_id } with the caller's JWT. Deleting the auth.users row
// cascades through every FK declared with ON DELETE CASCADE (companies,
// properties, rent_payments, bank_connections, user_profiles, ...).
//
// Authorisation is server-side: the caller's JWT is verified, then their
// user_profiles row must have is_developer (new) or platform_admin
// (legacy) set — mirroring the client's isPlatformAdmin gating, which is
// cosmetic only. Self-deletion is blocked. The action is audit-logged.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(status: number, message: string) { return jsonResp(status, { error: message }) }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return jsonError(405, 'POST only')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authenticate the caller
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid session')

  // Authorise: platform admin only, checked server-side against
  // user_profiles — never trust the client's isPlatformAdmin flag.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('is_developer, platform_admin')
    .eq('user_id', caller.id)
    .maybeSingle()
  const isPlatformAdmin = profile?.is_developer === true || profile?.platform_admin === true
  if (!isPlatformAdmin) return jsonError(403, 'Platform admin access required')

  let body: any = {}
  try { body = await req.json() } catch { return jsonError(400, 'Invalid JSON') }
  const targetUserId = String(body.target_user_id || '').trim()
  if (!targetUserId) return jsonError(400, 'target_user_id required')
  if (targetUserId === caller.id) return jsonError(400, 'You cannot delete your own account from here')

  // Capture the target's email for the audit trail before it's gone.
  const { data: targetData, error: targetErr } = await admin.auth.admin.getUserById(targetUserId)
  if (targetErr || !targetData?.user) return jsonError(404, 'User not found')
  const targetEmail = targetData.user.email || null

  const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId)
  if (delErr) {
    console.error('[delete-user] deletion failed:', delErr.message)
    return jsonError(500, 'Deletion failed: ' + delErr.message)
  }

  // Audit log — best-effort; the deletion already happened.
  const { error: auditErr } = await admin.from('audit_log').insert({
    user_id: caller.id,
    action: 'admin.user_deleted',
    entity_type: 'user',
    entity_id: targetUserId,
    entity_name: targetEmail,
    metadata: { deleted_by_email: caller.email, target_email: targetEmail },
  })
  if (auditErr) console.warn('[delete-user] audit log failed:', auditErr.message)

  return jsonResp(200, { ok: true, deleted_user_id: targetUserId })
})
