// E-signing envelope lifecycle (SCAFFOLD).
//
// Feature flag: esign. This function manages esign_envelopes records and
// owns the (currently inert) "send to provider" path. It is PROVIDER-AGNOSTIC
// and INERT: the actual provider API call is gated behind ESIGN_PROVIDER_API_KEY.
// When that secret is unset the send path returns a clear 422 telling the
// caller to configure it — it NEVER fabricates a provider or external call.
//
// Actions (body.action):
//   'create' — create a draft envelope row (document_id, signer_name,
//              signer_email; property_id OR company_id). Returns the row.
//   'send'   — move a draft envelope to 'sent' via the configured provider.
//              Inert (422) without ESIGN_PROVIDER_API_KEY.
//   'void'   — cancel an envelope (status -> 'voided').
//
// No money movement, no irreversible action. Server-side access checks via
// has_property_permission / has_company_access; writes use service-role.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!

// Provider config — when unset the send path is inert.
const ESIGN_PROVIDER_API_KEY = Deno.env.get('ESIGN_PROVIDER_API_KEY') || ''
const ESIGN_PROVIDER         = Deno.env.get('ESIGN_PROVIDER') || ''

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

  const action = body.action || 'create'

  // Server-side access check against a property or a company.
  async function canWrite(propertyId?: string | null, companyId?: string | null): Promise<boolean> {
    if (propertyId) {
      const { data } = await userClient.rpc('has_property_permission', {
        p_property_id: propertyId, p_action: 'write',
      })
      if (!data) return false
      // company liveness gate (same as RLS)
      const { data: prop } = await admin
        .from('properties').select('company_id').eq('id', propertyId).maybeSingle()
      if (prop?.company_id) {
        const { data: live } = await userClient.rpc('company_is_live', { p_company_id: prop.company_id })
        return !!live
      }
      return true
    }
    if (companyId) {
      const { data: access } = await userClient.rpc('has_company_access', { p_company_id: companyId })
      if (!access) return false
      const { data: live } = await userClient.rpc('company_is_live', { p_company_id: companyId })
      return !!live
    }
    return false
  }

  // ── CREATE ────────────────────────────────────────────────────────────
  if (action === 'create') {
    const { document_id, signer_name, signer_email } = body
    const property_id = body.property_id || null
    let company_id = body.company_id || null

    if (!signer_name || !signer_email) {
      return json({ error: 'signer_name and signer_email required' }, 400)
    }
    if (!property_id && !company_id) {
      return json({ error: 'property_id or company_id required' }, 400)
    }
    if (!(await canWrite(property_id, company_id))) {
      return json({ error: 'No write access (or company is not live)' }, 403)
    }
    // Resolve company_id from the property when only a property was given.
    if (property_id && !company_id) {
      const { data: prop } = await admin
        .from('properties').select('company_id').eq('id', property_id).maybeSingle()
      company_id = prop?.company_id || null
    }

    const { data: row, error } = await admin
      .from('esign_envelopes')
      .insert({
        company_id,
        user_id: user.id,
        property_id,
        document_id: document_id || null,
        signer_name: String(signer_name).slice(0, 200),
        signer_email: String(signer_email).slice(0, 320),
        status: 'draft',
      })
      .select()
      .single()
    if (error) {
      console.error('esign create failed', error)
      return json({ error: 'Could not create envelope' }, 500)
    }
    return json({ ok: true, envelope: row })
  }

  // ── SEND ──────────────────────────────────────────────────────────────
  if (action === 'send') {
    const { envelope_id } = body
    if (!envelope_id) return json({ error: 'envelope_id required' }, 400)

    const { data: env } = await admin
      .from('esign_envelopes').select('*').eq('id', envelope_id).maybeSingle()
    if (!env) return json({ error: 'Envelope not found' }, 404)
    if (!(await canWrite(env.property_id, env.company_id))) {
      return json({ error: 'No write access (or company is not live)' }, 403)
    }
    if (env.status !== 'draft') {
      return json({ error: `Envelope is '${env.status}', only draft envelopes can be sent` }, 409)
    }

    // INERT GATE — no provider configured. We do NOT fabricate a provider or
    // make any external call. The envelope stays in 'draft'.
    if (!ESIGN_PROVIDER_API_KEY) {
      return json({
        error: 'E-signing provider not configured',
        detail: 'Set ESIGN_PROVIDER_API_KEY (and ESIGN_PROVIDER) on the esign-envelope edge function to enable sending.',
        inert: true,
      }, 422)
    }

    // ── Provider integration point (only reached once a key is set) ───────
    // Provider-agnostic envelope lifecycle. The concrete provider HTTP call
    // belongs here, keyed off ESIGN_PROVIDER. Until a provider is chosen and
    // wired, fail closed rather than guess an API contract.
    try {
      // const providerEnvelopeId = await sendViaProvider(ESIGN_PROVIDER, ESIGN_PROVIDER_API_KEY, env)
      throw new Error('No provider implementation wired for ' + (ESIGN_PROVIDER || '<unset ESIGN_PROVIDER>'))

      // const { data: updated } = await admin
      //   .from('esign_envelopes')
      //   .update({ status: 'sent', provider: ESIGN_PROVIDER, provider_envelope_id: providerEnvelopeId, sent_at: new Date().toISOString() })
      //   .eq('id', envelope_id).select().single()
      // return json({ ok: true, envelope: updated })
    } catch (e) {
      await admin.from('esign_envelopes')
        .update({ status: 'error', error_message: String((e as Error).message).slice(0, 500) })
        .eq('id', envelope_id)
      return json({ error: 'Provider send failed', detail: String((e as Error).message) }, 502)
    }
  }

  // ── VOID ──────────────────────────────────────────────────────────────
  if (action === 'void') {
    const { envelope_id } = body
    if (!envelope_id) return json({ error: 'envelope_id required' }, 400)

    const { data: env } = await admin
      .from('esign_envelopes').select('*').eq('id', envelope_id).maybeSingle()
    if (!env) return json({ error: 'Envelope not found' }, 404)
    if (!(await canWrite(env.property_id, env.company_id))) {
      return json({ error: 'No write access' }, 403)
    }
    if (env.status === 'signed') {
      return json({ error: 'A signed envelope cannot be voided' }, 409)
    }

    const { data: updated, error } = await admin
      .from('esign_envelopes')
      .update({ status: 'voided' })
      .eq('id', envelope_id)
      .select().single()
    if (error) return json({ error: 'Could not void envelope' }, 500)
    return json({ ok: true, envelope: updated })
  }

  return json({ error: `Unknown action '${action}'` }, 400)
})
