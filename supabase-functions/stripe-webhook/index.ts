// Stripe webhook receiver.
//
// Receives every Stripe event we've subscribed to and updates our
// `subscriptions` table so the in-app trial gate / billing UI can see
// the truth. Stripe is the source of truth for billing; this function
// keeps Postgres in sync.
//
// CRITICAL FIXES (May 2026 vs prior version):
//
//   1. company_id lookup was metadata-only. If metadata was missing
//      from an event (which can happen for events that don't carry the
//      Checkout Session — e.g. invoice.* events fired by the renewal
//      cycle months later, or session events where metadata wasn't set),
//      the handler silently broke. Now we fall back to looking up by
//      stripe_customer_id (always present) and stripe_subscription_id.
//
//   2. current_period_start / current_period_end were unconditionally
//      converted via `new Date(x * 1000)`. For a subscription that
//      hasn't been billed yet (trialing without payment), these can be
//      null → `new Date(null * 1000)` → `1970-01-01T00:00:00Z` actually
//      works but `new Date(undefined * 1000)` → Invalid Date → DB
//      rejects the upsert with a 500. Now null-safe.
//
//   3. 500 responses now include the error message in the body so we
//      can see what went wrong in Stripe's webhook UI (and our logs).
//
//   4. Unhandled event types now return 200 explicitly with a log,
//      not a silent fall-through (was already 200 but makes intent clear).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY       = Deno.env.get('SERVICE_ROLE_KEY')!

// Meta Conversions API (server-side attribution). Lets us tell Meta that
// a user just bought, with their hashed email/IP/UA, so iOS 17+ ad
// attribution still works even when client-side Pixel calls are blocked.
// Both env vars must be set for server-side events to fire — otherwise
// the integration is silently inactive (no errors, no spurious events).
const META_PIXEL_ID      = Deno.env.get('META_PIXEL_ID') || ''
const META_CAPI_TOKEN    = Deno.env.get('META_CAPI_TOKEN') || ''  // long-lived access token
const META_TEST_EVENT_CODE = Deno.env.get('META_TEST_EVENT_CODE') || ''  // optional — for Meta Events Manager test mode

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// SHA-256 hex helper for Meta CAPI user_data fields (Meta requires PII to
// be hashed before transmission for compliance with their data-handling rules).
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Fire a server-side Meta Pixel event. No-op if META_PIXEL_ID +
// META_CAPI_TOKEN aren't set — that's the default state until Justin
// has a Pixel ID + access token from Meta Events Manager.
async function fireMetaCapi(opts: {
  eventName: string                 // 'Purchase' | 'StartTrial' | 'CompleteRegistration'
  eventId: string                   // For dedupe with the client-side Pixel
  userEmail?: string
  value?: number
  currency?: string
}): Promise<void> {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return  // not configured yet — silent no-op

  const userData: Record<string, string> = {}
  if (opts.userEmail) {
    userData.em = await sha256Hex(opts.userEmail)
  }

  const body: any = {
    data: [{
      event_name: opts.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: opts.eventId,              // dedupe key vs client Pixel
      action_source: 'website',
      event_source_url: 'https://www.ownproperly.com/',
      user_data: userData,
      custom_data: {
        currency: opts.currency || 'GBP',
        value: typeof opts.value === 'number' ? opts.value : undefined,
      },
    }],
  }
  if (META_TEST_EVENT_CODE) body.test_event_code = META_TEST_EVENT_CODE

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text()
      console.warn('[meta-capi] non-200:', res.status, t.slice(0, 200))
    }
  } catch (e) {
    // Never let an attribution failure break the Stripe webhook —
    // Stripe retries the whole webhook on 500, which would then
    // double-fire DB writes.
    console.warn('[meta-capi] failed:', (e as Error).message)
  }
}

// ── Helper: resolve which company row this event belongs to ──────────
// Tries every signal Stripe might give us, in order of reliability.
// Returns null only if absolutely nothing matches — at which point we
// can't act and we just log + return 200 (so Stripe doesn't retry forever).
async function resolveCompanyId(obj: any): Promise<string | null> {
  // 1. Direct metadata on the event object (sessions, subscriptions when
  //    we set it via subscription_data.metadata in create-checkout)
  if (obj.metadata?.company_id) return obj.metadata.company_id

  // 2. Checkout session has subscription_data.metadata
  if (obj.subscription_data?.metadata?.company_id) return obj.subscription_data.metadata.company_id

  // 3. By Stripe customer id — most reliable, almost always present
  const customerId = obj.customer || obj.customer_id
  if (customerId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('company_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (data?.company_id) return data.company_id
  }

  // 4. By subscription id — works for invoice.* events post-renewal
  const subId = obj.subscription || (obj.object === 'subscription' ? obj.id : null)
  if (subId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('company_id')
      .eq('stripe_subscription_id', subId)
      .maybeSingle()
    if (data?.company_id) return data.company_id
  }

  return null
}

// Null-safe Unix-seconds-to-ISO conversion. Stripe sometimes leaves
// period_start/end null on freshly-created subscriptions that haven't
// been billed yet — guarding so the upsert doesn't 500 on Invalid Date.
function toIso(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || typeof unixSeconds !== 'number') return null
  return new Date(unixSeconds * 1000).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const body = await req.text()
  const sig  = req.headers.get('stripe-signature') || ''

  try {
    await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('Webhook signature failed:', e.message)
    return new Response('Unauthorized', { status: 401 })
  }

  const event = JSON.parse(body)
  const obj   = event.data.object

  try {
    const companyId = await resolveCompanyId(obj)

    // Helper: any DB write inside this handler MUST return its { error }
    // to the catch below — Stripe will retry on 500 but accept 200 as
    // permanent success, so a silently-swallowed write means billing
    // state diverges from payment reality with no recovery path.
    const must = async (label: string, p: any) => {
      const { error } = await p
      if (error) throw new Error(`${label}: ${error.message} (code=${error.code || '?'})`)
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        if (!companyId) { console.warn('checkout.session.completed: no company_id'); break }
        await must('checkout.session.completed upsert', supabase.from('subscriptions').upsert({
          company_id: companyId,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.subscription,
          status: 'active',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' }))

        // Meta Conversions API — fire Purchase event with hashed email.
        // amount_total is in pence on Stripe (e.g. 200 = £2.00).
        await fireMetaCapi({
          eventName: 'Purchase',
          eventId: `stripe-${obj.id}`,         // dedupe with the client Pixel's purchase event
          userEmail: obj.customer_details?.email || obj.customer_email,
          value: typeof obj.amount_total === 'number' ? obj.amount_total / 100 : undefined,
          currency: (obj.currency || 'gbp').toUpperCase(),
        })
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        if (!companyId) { console.warn(`${event.type}: no company_id`); break }
        await must(`${event.type} upsert`, supabase.from('subscriptions').upsert({
          company_id: companyId,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          stripe_price_id: obj.items?.data?.[0]?.price?.id || null,
          status: obj.status,
          property_count: obj.items?.data?.[0]?.quantity || 0,
          current_period_start: toIso(obj.current_period_start),
          current_period_end:   toIso(obj.current_period_end),
          cancel_at_period_end: obj.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' }))
        break
      }

      case 'customer.subscription.deleted': {
        if (!companyId) { console.warn('customer.subscription.deleted: no company_id'); break }
        await must('subscription.deleted update', supabase.from('subscriptions').update({
          status: 'canceled',
          stripe_subscription_id: null,
          updated_at: new Date().toISOString(),
        }).eq('company_id', companyId))
        break
      }

      case 'invoice.payment_succeeded': {
        const subId = obj.subscription
        if (!subId) break
        await must('invoice.payment_succeeded update', supabase.from('subscriptions').update({
          status: 'active',
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subId))
        break
      }

      case 'invoice.payment_failed': {
        const subId = obj.subscription
        if (!subId) break
        await must('invoice.payment_failed update', supabase.from('subscriptions').update({
          status: 'past_due',
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subId))
        break
      }

      default:
        console.log('Unhandled event type:', event.type)
    }
  } catch (e) {
    // Surface the real error message so we can debug from Stripe's
    // webhook UI (it shows the response body inline).
    console.error('Webhook handler error:', e)
    return new Response(JSON.stringify({ error: e.message, event: event.type }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

async function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = header.split(',').reduce((acc: Record<string, string>, part) => {
    const [k, v] = part.split('=')
    acc[k] = v
    return acc
  }, {})
  const timestamp = parts['t']
  const signature = parts['v1']
  const signed    = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (expected !== signature) throw new Error('Invalid signature')
}
