// Keeps each Stripe subscription's quantity in step with the company's
// portfolio. Runs daily via pg_cron (x-cron-secret).
//
// Why: checkout sets quantity = property count once, and nothing changed it
// afterwards — a landlord who subscribed with 3 properties and added 20 more
// kept paying for 3 (and one who removed properties kept paying for them).
//
// Rules:
//   * quantity = max(billable properties, minimum). Billable = not in Trash
//     (see ./billing.ts).
//   * minimum = the £10 floor (5 Starter / 2 Investor) for subscriptions
//     created since the floor was enforced — marked by `min_quantity` in the
//     subscription metadata. Older subscriptions keep a minimum of 1: we don't
//     silently raise their price to the floor.
//   * proration_behavior = 'none': the new quantity takes effect from the next
//     invoice. No mid-cycle charges or credits are created by this job.
//   * metadata.quantity_locked = 'true' on a subscription opts it out (manual
//     pricing agreed with a customer).
//   * Only active / trialing / past_due subscriptions are touched.
//
// This only changes a subscription quantity; it never creates a charge,
// refund or payment itself. Every change is written to audit_log.
//
// POST body (optional): { "dry_run": true } — report what would change
// without calling Stripe's write API. Use this for the first run after deploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { secretMatches } from './secrets.ts'
import { billedQuantity, countBillableProperties, floorQuantity } from './billing.ts'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SERVICE_ROLE_KEY')!
const CRON_SECRET       = Deno.env.get('CRON_SECRET') || ''

const SYNCABLE = ['active', 'trialing', 'past_due']

Deno.serve(async (req) => {
  // CRON-only — fails closed when CRON_SECRET isn't configured.
  if (!secretMatches(req.headers.get('x-cron-secret') || '', CRON_SECRET)) {
    return new Response('Forbidden', { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dry_run === true
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('company_id, owner_id, stripe_subscription_id, tier, status, property_count')
    .in('status', SYNCABLE)
    .not('stripe_subscription_id', 'is', null)
  if (error) return json({ error: error.message }, 500)

  const results: any[] = []
  for (const row of subs || []) {
    try {
      const count = await countBillableProperties(supabase, row.company_id)
      if (count === null) { results.push({ company_id: row.company_id, status: 'skipped', reason: 'count failed' }); continue }

      const sub = await stripe('GET', `/subscriptions/${row.stripe_subscription_id}`)
      if (!SYNCABLE.includes(sub.status)) { results.push({ company_id: row.company_id, status: 'skipped', reason: `stripe status ${sub.status}` }); continue }
      if (sub.metadata?.quantity_locked === 'true') { results.push({ company_id: row.company_id, status: 'skipped', reason: 'quantity_locked' }); continue }
      const item = sub.items?.data?.[0]
      if (!item || (sub.items?.data?.length ?? 0) > 1) { results.push({ company_id: row.company_id, status: 'skipped', reason: 'unexpected line items' }); continue }

      const tier = sub.metadata?.tier || row.tier || 'starter'
      const minQuantity = sub.metadata?.min_quantity ? floorQuantity(tier) : 1
      const desired = billedQuantity(count, minQuantity)
      const current = item.quantity

      if (row.property_count !== count && !dryRun) {
        await supabase.from('subscriptions').update({ property_count: count, updated_at: new Date().toISOString() }).eq('company_id', row.company_id)
      }
      if (desired === current) { results.push({ company_id: row.company_id, status: 'ok', quantity: current }); continue }

      if (!dryRun) {
        await stripe('POST', `/subscription_items/${item.id}`, { quantity: desired, proration_behavior: 'none' })
        await supabase.from('audit_log').insert({
          user_id: row.owner_id,
          action: 'billing.quantity_synced',
          entity_type: 'subscription',
          metadata: { company_id: row.company_id, stripe_subscription_id: row.stripe_subscription_id, from: current, to: desired, properties: count, min_quantity: minQuantity, tier },
        })
      }
      results.push({ company_id: row.company_id, status: dryRun ? 'would_change' : 'changed', from: current, to: desired, properties: count })
    } catch (e) {
      results.push({ company_id: row.company_id, status: 'error', error: (e as Error).message })
    }
  }

  const summary = results.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
  return json({ dry_run: dryRun, summary, results })
})

async function stripe(method: string, path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`)
  return data
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
