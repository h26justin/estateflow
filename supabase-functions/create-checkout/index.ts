// Stripe Checkout session creator.
//
// Creates (or reuses) a Stripe customer per company, then opens a
// Checkout Session for either initial subscription signup ('checkout'
// action) or the customer portal ('portal' action).
//
// CRITICAL FIXES (May 2026 vs prior version):
//
//   1. Redirect domain — previously hard-coded to www.ownproperly.com.
//      Users on the apex `ownproperly.com` got bounced to www after
//      payment, lost their browser session (localStorage is per-origin
//      and the two hostnames are different origins), and landed back at
//      the login screen. Now reads from the request body's
//      `return_origin` (which the client sends as window.location.origin)
//      with a safe-list of allowed origins. Falls back to apex.
//
//   2. Session metadata — previously only set metadata on
//      `subscription_data` and `customer`. The `checkout.session.completed`
//      webhook event reads `obj.metadata` (i.e. the session's own
//      metadata) and was silently skipping because that was empty.
//      Now sets it at session level too so the webhook can look it up.
//
//   3. Cancel URL points back through the trial gate, not /billing
//      success page. Cleaner UX — user just lands where they were.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_SECRET_KEY  = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SERVICE_ROLE_KEY')!
const STRIPE_PRICE_ID    = Deno.env.get('STRIPE_PRICE_ID')!

// Safe-list of origins we'll honour for return_url. Anything else
// falls back to APEX_URL — defence against open-redirect via the
// optional `return_origin` request param.
const APEX_URL = 'https://ownproperly.com'
const ALLOWED_ORIGINS = new Set([
  'https://ownproperly.com',
  'https://www.ownproperly.com',
  'http://localhost:5173',
  'http://localhost:3000',
])

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Unauthorized', 401)

    const { data: { user } } = await createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!)
      .auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return err('Unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const { company_id, action, return_origin } = body

    if (!company_id) return err('company_id required')

    // Resolve the redirect base — honour client's origin if it's in
    // the safe-list, else apex. This means localhost devs return to
    // localhost; production users stay on whichever domain they came in on.
    const baseUrl = ALLOWED_ORIGINS.has(return_origin) ? return_origin : APEX_URL

    const { data: company } = await supabase.from('companies').select('*').eq('id', company_id).single()
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('company_id', company_id).single()

    // SECURITY: verify the caller actually has the right to manage billing
    // for THIS company. Without this check an authenticated attacker can:
    //   * call action='portal' with any company_id → receive a billing-
    //     portal URL pointing at the victim's Stripe customer, then cancel
    //     or modify the victim's subscription.
    //   * call action='checkout' with another tenant's company_id →
    //     overwrite their stripe_customer_id with the attacker's metadata,
    //     diverting future invoice events to the attacker's row.
    //
    // Allowed: company owner, OR a row in user_company_access with
    // is_owner / is_admin (mirrors the in-app "Billing" panel gating).
    if (!company) return err('Company not found', 404)
    let allowed = company.owner_id === user.id
    if (!allowed) {
      const { data: access } = await supabase
        .from('user_company_access')
        .select('is_owner, is_admin')
        .eq('user_id', user.id).eq('company_id', company_id)
        .maybeSingle()
      allowed = !!(access?.is_owner || access?.is_admin)
    }
    if (!allowed) return err('You do not have permission to manage billing for this company', 403)

    if (action === 'portal') {
      if (!sub?.stripe_customer_id) return err('No subscription found')
      const portalRes = await stripe('POST', '/billing_portal/sessions', {
        customer: sub.stripe_customer_id,
        return_url: `${baseUrl}?billing=success`,
      })
      return ok({ url: portalRes.url })
    }

    const propertyCount = await supabase
      .from('properties').select('id', { count: 'exact' }).eq('company_id', company_id)
      .then(r => r.count || 1)

    let customerId = sub?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe('POST', '/customers', {
        email: user.email,
        name: company?.name || user.email,
        metadata: { company_id, owner_id: user.id },
      })
      customerId = customer.id
      await supabase.from('subscriptions').upsert({
        company_id, owner_id: user.id,
        stripe_customer_id: customerId,
        status: 'trialing',
        property_count: propertyCount,
      }, { onConflict: 'company_id' })
    }

    const session = await stripe('POST', '/checkout/sessions', {
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: Math.max(1, propertyCount) }],
      // Metadata at THREE levels:
      //   - session.metadata        → read by checkout.session.completed
      //   - subscription_data       → propagates to subscription.created
      //   - customer.metadata       → set when we created the customer above
      // This way any one of the webhook events can identify the company.
      metadata: { company_id, owner_id: user.id },
      subscription_data: { metadata: { company_id, owner_id: user.id } },
      success_url: `${baseUrl}?billing=success`,
      cancel_url: `${baseUrl}?billing=cancelled`,
      allow_promotion_codes: true,
    })

    return ok({ url: session.url })

  } catch (e) {
    console.error('checkout error:', e)
    return err(e.message)
  }
})

async function stripe(method: string, path: string, body: object) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encode(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'Stripe error')
  return data
}

function encode(obj: object, prefix = ''): string {
  return Object.entries(obj).map(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object' && v !== null) return encode(v as object, key)
    return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`
  }).join('&')
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}
function ok(data: object) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}
