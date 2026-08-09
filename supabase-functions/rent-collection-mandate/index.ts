// Rent collection mandate — RECORD management ONLY (INERT SCAFFOLD).
//
// This function creates and cancels a rent_collection_mandates RECORD and
// appends audit rows to rent_collection_attempts. It deliberately performs
// NO money movement.
//
// The `initiate` action is a STUB: it throws and NEVER contacts a payments
// endpoint. Open-banking VRP collection cannot be switched on until:
//   1. FCA authorisation (or agent/PISP cover) is in place, AND
//   2. a TrueLayer VRP agreement is signed, AND
//   3. the TRUELAYER_CLIENT_ID / TRUELAYER_CLIENT_SECRET / TRUELAYER_REDIRECT
//      secrets are configured.
// Even with those set, this scaffold still refuses to initiate — wiring the
// real payment call is a separate, reviewed change.
//
// Body shape:
//   { action: 'create',  property_id, tenant_user_id?, company_id,
//                         amount_pcm?, day_of_month?, provider? }
//   { action: 'cancel',  mandate_id }
//   { action: 'initiate', mandate_id }   <-- always throws (stub)

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!

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

  const action = body.action
  if (!action) return json({ error: 'action required' }, 400)

  // ── initiate: the hard stop. No payments endpoint is ever contacted. ──────
  if (action === 'initiate') {
    try {
      const { data: m } = await admin
        .from('rent_collection_mandates')
        .select('property_id')
        .eq('id', body.mandate_id)
        .maybeSingle()
      if (m?.property_id) {
        await admin.from('rent_collection_attempts').insert({
          mandate_id: body.mandate_id,
          property_id: m.property_id,
          event: 'initiate_blocked',
          detail: 'Initiation refused — feature is inert (pending FCA authorisation and TrueLayer VRP agreement).',
          created_by: user.id,
        })
      }
    } catch (_e) { /* audit is best-effort; never let it mask the hard stop */ }

    return json({
      error: 'Rent collection is not yet enabled — pending FCA authorisation and TrueLayer VRP agreement',
      code: 'RENT_COLLECTION_DISABLED',
    }, 501)
  }

  // ── create: write a mandate RECORD only ───────────────────────────────────
  if (action === 'create') {
    const { property_id, tenant_user_id, company_id, amount_pcm, day_of_month, provider } = body
    if (!property_id || !company_id) {
      return json({ error: 'property_id and company_id required' }, 400)
    }

    const { data: canWrite, error: permErr } = await userClient
      .rpc('has_property_permission', { p_property_id: property_id, p_action: 'write' })
    if (permErr || !canWrite) return json({ error: 'Forbidden' }, 403)

    const { data: live } = await userClient
      .rpc('company_is_live', { p_company_id: company_id })
    if (!live) return json({ error: 'Company is not live' }, 403)

    const { data: mandate, error } = await admin
      .from('rent_collection_mandates')
      .insert({
        property_id,
        tenant_user_id: tenant_user_id || null,
        company_id,
        amount_pcm: amount_pcm ?? null,
        day_of_month: day_of_month ?? null,
        provider: provider || 'truelayer',
        status: 'draft',
      })
      .select()
      .single()
    if (error) return json({ error: error.message }, 400)

    await admin.from('rent_collection_attempts').insert({
      mandate_id: mandate.id,
      property_id,
      event: 'mandate_created',
      detail: 'Draft mandate recorded (no payment set up — feature inert).',
      amount: amount_pcm ?? null,
      created_by: user.id,
    })

    return json({ mandate })
  }

  // ── cancel: flip a mandate RECORD to cancelled ────────────────────────────
  if (action === 'cancel') {
    const { mandate_id } = body
    if (!mandate_id) return json({ error: 'mandate_id required' }, 400)

    const { data: existing } = await admin
      .from('rent_collection_mandates')
      .select('property_id')
      .eq('id', mandate_id)
      .maybeSingle()
    if (!existing) return json({ error: 'Mandate not found' }, 404)

    const { data: canWrite, error: permErr } = await userClient
      .rpc('has_property_permission', { p_property_id: existing.property_id, p_action: 'write' })
    if (permErr || !canWrite) return json({ error: 'Forbidden' }, 403)

    const { data: mandate, error } = await admin
      .from('rent_collection_mandates')
      .update({ status: 'cancelled' })
      .eq('id', mandate_id)
      .select()
      .single()
    if (error) return json({ error: error.message }, 400)

    await admin.from('rent_collection_attempts').insert({
      mandate_id,
      property_id: existing.property_id,
      event: 'mandate_cancelled',
      detail: 'Mandate cancelled by landlord.',
      created_by: user.id,
    })

    return json({ mandate })
  }

  return json({ error: 'Unknown action' }, 400)
})
