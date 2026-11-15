// Tenant referencing / Right-to-Rent order request — INERT SCAFFOLD.
//
// Creates a referencing_checks record for a property as a 'draft'. No partner
// provider is wired yet (the contract is provider-specific: Goodlord /
// RentProfile / OpenRent etc.), so the function is fully inert: without
// REFERENCING_PROVIDER_API_KEY it returns inert:true so the UI can show
// "configure provider to enable"; with the key set it fails closed (422) and
// never marks a check 'ordered' when no order was placed.
//
// Body shape:
//   {
//     property_id: uuid,             // required
//     applicant_name: string,        // required
//     applicant_email?: string,
//     check_type?: 'reference' | 'right_to_rent'  // default 'reference'
//   }
//
// New secret (optional): REFERENCING_PROVIDER_API_KEY — when unset the
// provider-order path is skipped and the check stays 'draft'.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!
const PROVIDER_API_KEY = Deno.env.get('REFERENCING_PROVIDER_API_KEY') || ''

const VALID_TYPES = ['reference', 'right_to_rent']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Verify the token explicitly (the pattern proven by lodgify-sync et al —
  // no-arg getUser() on a session-less server client is unreliable).
  const token = authHeader.replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(token)
  const user = userData?.user
  if (!user) return json({ error: 'Unauthorised' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const property_id = body.property_id
  const applicant_name = (body.applicant_name || '').trim()
  const applicant_email = (body.applicant_email || '').trim() || null
  const check_type = VALID_TYPES.includes(body.check_type) ? body.check_type : 'reference'

  if (!property_id || !applicant_name) {
    return json({ error: 'property_id and applicant_name required' }, 400)
  }

  // Server-side access check: caller must have write permission on the
  // property (using their own JWT so RLS-backed helpers see auth.uid()).
  const { data: canWrite, error: permErr } = await userClient.rpc(
    'has_property_permission', { p_property_id: property_id, p_action: 'write' },
  )
  if (permErr) {
    console.error('has_property_permission failed', permErr)
    return json({ error: 'Could not check access' }, 500)
  }
  if (!canWrite) return json({ error: 'Forbidden' }, 403)

  // Resolve company_id from the property for scoping/liveness.
  const { data: prop } = await admin
    .from('properties')
    .select('id, company_id')
    .eq('id', property_id)
    .maybeSingle()
  if (!prop) return json({ error: 'Property not found' }, 404)

  const { data: row, error: insErr } = await admin
    .from('referencing_checks')
    .insert({
      company_id: prop.company_id,
      user_id: user.id,
      property_id,
      applicant_name,
      applicant_email,
      check_type,
      status: 'draft',
    })
    .select()
    .single()
  if (insErr) {
    console.error('referencing_checks insert failed', insErr)
    return json({ error: 'Could not save the referencing check' }, 500)
  }

  // ── Provider order path — INERT until REFERENCING_PROVIDER_API_KEY set ──
  if (!PROVIDER_API_KEY) {
    return json({
      ok: true,
      inert: true,
      check: row,
      message: 'Referencing provider not configured. Check saved as draft. Set REFERENCING_PROVIDER_API_KEY to enable live ordering.',
    })
  }

  // A key is configured, but no provider integration is wired yet. Fail
  // closed (as esign-envelope does): never mark the check 'ordered' or stamp
  // ordered_at when no order has been placed with anyone. The check stays a
  // draft. Wire the chosen partner's order POST here, and only move the row
  // to 'ordered' (with provider_ref) once that call has succeeded.
  console.error('referencing-request: REFERENCING_PROVIDER_API_KEY is set but no provider integration is wired')
  return json({
    error: 'Referencing provider integration not wired yet',
    detail: 'The check was saved as a draft. No order has been placed.',
    inert: true,
    check: row,
  }, 422)
})
