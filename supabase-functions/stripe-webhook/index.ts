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
import { countBillableProperties } from './billing.ts'

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY       = Deno.env.get('SERVICE_ROLE_KEY')!
// Optional here: used only to READ the current subscription from Stripe so
// out-of-order deliveries can't apply stale state. Without it the handler
// falls back to the event payload (previous behaviour).
const STRIPE_SECRET_KEY      = Deno.env.get('STRIPE_SECRET_KEY') || ''

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

// Tier comes from the metadata create-checkout stamps on the session and
// on subscription_data (so it propagates to subscription.* events). Only
// known values are persisted — anything else is ignored so a forged or
// missing value can't corrupt the subscriptions row.
function resolveTier(obj: any): string | null {
  const t = obj.metadata?.tier || obj.subscription_data?.metadata?.tier || null
  return t === 'starter' || t === 'investor' ? t : null
}

// Null-safe Unix-seconds-to-ISO conversion. Stripe sometimes leaves
// period_start/end null on freshly-created subscriptions that haven't
// been billed yet — guarding so the upsert doesn't 500 on Invalid Date.
function toIso(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || typeof unixSeconds !== 'number') return null
  return new Date(unixSeconds * 1000).toISOString()
}

// ── Ordering guard ──────────────────────────────────────────────────────
// Stripe does not guarantee delivery order, and a retried event can arrive
// long after newer ones. Rather than trusting the (possibly stale) event
// payload, read the subscription's CURRENT state from Stripe (read-only)
// and apply that — Stripe's recommended pattern. Returns null when the
// secret isn't configured; throws on a Stripe error so the event is retried.
async function fetchLiveSubscription(subId: string | null | undefined): Promise<any | null> {
  if (!STRIPE_SECRET_KEY || !subId) return null
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`stripe subscription read: ${data?.error?.message || res.status}`)
  return data
}

// Statuses under which a subscription is still the customer's billing
// relationship (paying, trialing, or failing payment).
const LIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'unpaid']

// The company's stored subscription row (id + status), or null if none.
async function storedSubscription(companyId: string): Promise<{ stripe_subscription_id: string | null, status: string | null } | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, status')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw new Error(`subscriptions read: ${error.message}`)
  return data
}

// May an event about subscription `incomingId` (current status `status`)
// write the company's row? Always when it IS the stored subscription.
// Otherwise only a live subscription may take over (a new signup), or an
// 'incomplete' one when nothing is stored yet (checkout in progress). An
// ended or orphaned subscription that isn't the stored one never overwrites
// it — e.g. a delayed subscription.updated after subscription.deleted.
function mayWriteSubscription(storedId: string | null | undefined, incomingId: string | null | undefined, status: string | null | undefined): boolean {
  if (!incomingId) return false
  if (storedId === incomingId) return true
  if (LIVE_SUB_STATUSES.includes(status || '')) return true
  return !storedId && status === 'incomplete'
}

// Period bounds moved from the subscription onto its items in newer Stripe
// API versions; the live read may use a different version than the event.
const periodStart = (s: any) => s.current_period_start ?? s.items?.data?.[0]?.current_period_start
const periodEnd   = (s: any) => s.current_period_end   ?? s.items?.data?.[0]?.current_period_end

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

  // Idempotency: Stripe retries delivery, so each event_id is recorded once
  // and a duplicate is skipped. The event is recorded only AFTER it has
  // been handled successfully (below) — recording it first meant a crash or
  // timeout after the claim lost the event, because Stripe's retry was then
  // skipped as a duplicate. Handlers are idempotent upserts/updates, so a
  // concurrent double delivery re-applies the same state at worst. If the
  // stripe_events table doesn't exist yet, log and proceed without dedupe —
  // the webhook must never 500 on this.
  try {
    const { data: seen, error: evErr } = await supabase
      .from('stripe_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle()
    if (evErr) {
      console.warn('stripe_events dedupe unavailable (continuing without):', evErr.message)
    } else if (seen) {
      console.log('Duplicate Stripe event skipped:', event.id, event.type)
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (e) {
    console.warn('stripe_events dedupe failed (continuing without):', (e as Error).message)
  }

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
        const sessionTier = resolveTier(obj)
        // Use the subscription's current status when we can read it — a
        // delayed session event must not re-activate a since-cancelled one.
        // 'incomplete' (payment still confirming) keeps the previous
        // behaviour of 'active' on a completed checkout.
        const liveSub = await fetchLiveSubscription(obj.subscription)
        const sessionStatus = !liveSub?.status || liveSub.status === 'incomplete' ? 'active' : liveSub.status
        const storedForSession = await storedSubscription(companyId)
        if (!mayWriteSubscription(storedForSession?.stripe_subscription_id, obj.subscription, sessionStatus)) {
          console.warn('checkout.session.completed: stale or superseded subscription, not applied', obj.subscription, sessionStatus)
        } else {
          await must('checkout.session.completed upsert', supabase.from('subscriptions').upsert({
            company_id: companyId,
            stripe_customer_id: obj.customer,
            stripe_subscription_id: obj.subscription,
            status: sessionStatus,
            ...(sessionTier ? { tier: sessionTier } : {}),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_id' }))
        }

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
        // Current state from Stripe, not the (possibly stale) payload.
        const cur = (await fetchLiveSubscription(obj.id)) || obj
        const stored = await storedSubscription(companyId)
        if (!mayWriteSubscription(stored?.stripe_subscription_id, obj.id, cur.status)) {
          console.warn(`${event.type}: stale or superseded subscription, not applied`, obj.id, cur.status)
          break
        }
        const subTier = resolveTier(cur) || resolveTier(obj)
        // property_count is the company's real billable count, read live —
        // the Stripe quantity can be higher because of the £10 minimum.
        const liveCount = await countBillableProperties(supabase, companyId)
        await must(`${event.type} upsert`, supabase.from('subscriptions').upsert({
          company_id: companyId,
          stripe_customer_id: cur.customer,
          stripe_subscription_id: obj.id,
          stripe_price_id: cur.items?.data?.[0]?.price?.id || null,
          status: cur.status,
          ...(subTier ? { tier: subTier } : {}),
          property_count: liveCount ?? cur.items?.data?.[0]?.quantity ?? 0,
          current_period_start: toIso(periodStart(cur)),
          current_period_end:   toIso(periodEnd(cur)),
          cancel_at_period_end: cur.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' }))
        break
      }

      case 'customer.subscription.deleted': {
        if (!companyId) { console.warn('customer.subscription.deleted: no company_id'); break }
        // Only the company's CURRENT subscription ending cancels the company.
        // Cancelling an orphaned / older subscription on the same customer
        // must not lock out a company that is paying on another one.
        const storedDel = await storedSubscription(companyId)
        const storedDelId = storedDel?.stripe_subscription_id || null
        if (storedDelId && storedDelId !== obj.id) {
          console.warn('customer.subscription.deleted: not the stored subscription, ignored', obj.id)
          break
        }
        const delQuery = supabase.from('subscriptions').update({
          status: 'canceled',
          stripe_subscription_id: null,
          updated_at: new Date().toISOString(),
        }).eq('company_id', companyId)
        // Conditional on the id we just compared, so a concurrent takeover
        // by a new subscription isn't overwritten.
        await must('subscription.deleted update', storedDelId
          ? delQuery.eq('stripe_subscription_id', storedDelId)
          : delQuery.is('stripe_subscription_id', null))
        break
      }

      case 'invoice.payment_succeeded': {
        const subId = obj.subscription
        if (!subId) break
        // Matches only the row whose STORED subscription is this one, so an
        // old / replaced subscription's invoice can't touch the company.
        // Status is the subscription's current one when readable (a delayed
        // success after a later failure must not force 'active').
        const paidSub = await fetchLiveSubscription(subId)
        await must('invoice.payment_succeeded update', supabase.from('subscriptions').update({
          status: paidSub?.status || 'active',
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subId))
        break
      }

      case 'invoice.payment_failed': {
        const subId = obj.subscription
        if (!subId) break
        // past_due unless the subscription's current state says otherwise:
        // Stripe may not have flipped an 'active' subscription yet when this
        // arrives, but a failure for an invoice that is no longer the latest
        // (a later payment succeeded) or a subscription that has since moved
        // on (unpaid / canceled / incomplete) keeps that current status.
        const failedSub = await fetchLiveSubscription(subId)
        const latestInvoice = typeof failedSub?.latest_invoice === 'string' ? failedSub.latest_invoice : failedSub?.latest_invoice?.id
        const failedStatus = !failedSub ? 'past_due'
          : (failedSub.status === 'active' && (!latestInvoice || latestInvoice === obj.id)) ? 'past_due'
          : failedSub.status
        await must('invoice.payment_failed update', supabase.from('subscriptions').update({
          status: failedStatus,
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
    // Nothing is recorded in stripe_events on failure, so Stripe's retry is
    // processed in full.
    return new Response(JSON.stringify({ error: e.message, event: event.type }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Handled — record the event so a redelivery is skipped. Best-effort: if
  // this write fails the redelivery just re-applies the same state.
  try {
    const { error: markErr } = await supabase
      .from('stripe_events')
      .upsert({ event_id: event.id, type: event.type }, { onConflict: 'event_id', ignoreDuplicates: true })
    if (markErr) console.warn('stripe_events record failed:', markErr.message)
  } catch (e) {
    console.warn('stripe_events record failed:', (e as Error).message)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

async function verifyStripeSignature(payload: string, header: string, secret: string) {
  // The header can carry several v1 signatures (e.g. during a webhook
  // secret roll); any one matching is valid, as in Stripe's own libraries.
  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') timestamp = v
    else if (k === 'v1' && v) signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) throw new Error('Malformed signature header')
  // Replay protection — Stripe's reference implementation rejects events
  // whose signed timestamp is outside a 5-minute tolerance window.
  const skewSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(skewSeconds) || skewSeconds > 300) {
    throw new Error('Timestamp outside tolerance')
  }
  const signed    = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  // Compare against every candidate (no early exit) to keep timing flat.
  let matched = false
  for (const signature of signatures) {
    if (timingSafeEqual(expected, signature)) matched = true
  }
  if (!matched) throw new Error('Invalid signature')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
