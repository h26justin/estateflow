// Tenant referencing / Right-to-Rent order request — INERT SCAFFOLD.
//
// Creates a referencing_checks record for a property and, if a partner
// provider is configured (REFERENCING_PROVIDER_API_KEY set), places the
// order with that provider and moves the row to 'ordered'. Partner-agnostic:
// the actual POST shape is left as a clearly-marked stub because the contract
// is provider-specific (Goodlord / RentProfile / OpenRent etc.). Without the
// key the function is fully inert — it only creates the local 'draft' row and
// returns inert:true so the UI can show "configure provider to enable".
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
  if (permErr) return json({ error: permErr.message }, 500)
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
    return json({ error: insErr.message }, 500)
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

  // Provider is configured — place the order. The exact request/response
  // contract is provider-specific; this is a partner-agnostic stub that
  // records the order intent and moves the row to 'ordered'. Wire the real
  // POST to the chosen partner's API here, then map provider_ref + result.
  try {
    // const resp = await fetch('<PROVIDER_ORDER_ENDPOINT>', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${PROVIDER_API_KEY}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ applicant_name, applicant_email, check_type, property_ref: property_id }),
    // })
    // const data = await resp.json()
    const orderedAt = new Date().toISOString()
    const { data: updated, error: updErr } = await admin
      .from('referencing_checks')
      .update({
        status: 'ordered',
        ordered_at: orderedAt,
        // provider_ref: data.reference,
      })
      .eq('id', row.id)
      .select()
      .single()
    if (updErr) throw updErr
    return json({ ok: true, inert: false, check: updated })
  } catch (e) {
    console.error('provider order failed', e)
    await admin.from('referencing_checks').update({ status: 'failed' }).eq('id', row.id)
    return json({ error: 'Provider order failed', detail: String(e) }, 502)
  }
})
