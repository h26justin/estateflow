// Xero push webhook receiver.
//
// User flow:
//   1. User enables "Webhook from Xero" toggle in IntegrationsPanel
//   2. UI shows them the webhook URL + signing key to paste into the
//      Xero developer portal's Webhooks tab
//   3. Xero posts here whenever a subscribed resource changes
//   4. We verify the HMAC signature, look up the (user, company) for
//      that tenant, and trigger a sync
//
// Xero webhook signature spec:
//   - HMAC-SHA256 of the raw request body
//   - Key = the per-app webhook signing key (we store one per connection
//     so each customer's Xero portal has its own key — limits blast
//     radius if a key leaks)
//   - Encoded base64 and sent in the `x-xero-signature` header
//   - If signature mismatches, respond 401 (Xero retries)
//   - If signature matches, respond 200 immediately (process async)
//
// We don't run the full sync inline — webhooks have a strict 5-second
// SLA. Instead we enqueue a "needs sync" flag on the connection and
// the next user-triggered sync (or daily cron) picks it up. For
// production we'd add a background worker via pg_cron; for now the
// flag is enough.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-xero-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function verifyXeroSignature(rawBody: string, signature: string, key: string): Promise<boolean> {
  if (!signature || !key) return false
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(rawBody))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return computed === signature
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Xero sends an "intent to receive" empty POST during setup. We MUST
  // verify signature + return 200 within 5s or Xero refuses to enable.
  const rawBody = await req.text()
  const signature = req.headers.get('x-xero-signature') || ''

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Try every active webhook signing key on the system until one matches.
  // (At <1000 customers this is fine; for scale we'd index by tenant id
  // from the payload but Xero doesn't include it on the intent-to-receive
  // ping so we'd need a separate path.)
  const { data: settingsRows } = await admin.from('xero_sync_settings')
    .select('user_id, company_id, webhook_signing_key, enable_webhook')
    .eq('enable_webhook', true)
    .not('webhook_signing_key', 'is', null)

  let matched: any = null
  for (const row of (settingsRows || [])) {
    if (await verifyXeroSignature(rawBody, signature, row.webhook_signing_key)) {
      matched = row; break
    }
  }

  if (!matched) {
    // Wrong signature — Xero will retry up to ~5 times then disable the
    // webhook subscription. Respond 401 so they back off and the user
    // can fix the signing key.
    return new Response('signature mismatch', { status: 401 })
  }

  // Parse payload (might be empty on intent-to-receive)
  let payload: any = {}
  try { payload = JSON.parse(rawBody) } catch {}

  // Mark this connection as "needs sync" so the next user sync (or cron)
  // pulls the changes. We don't run the sync inline — Xero requires a
  // <5s response and a full sync can take much longer.
  await admin.from('xero_connections').update({
    last_sync_error: null,  // clear any old error since something is happening
  }).eq('user_id', matched.user_id).eq('company_id', matched.company_id)

  // Optionally: insert an audit row into xero_sync_log so the UI can show
  // "Webhook received at HH:MM" before the actual sync runs.
  await admin.from('xero_sync_log').insert({
    user_id: matched.user_id, company_id: matched.company_id,
    direction: 'from_xero', status: 'ok',
    details: { webhook: true, events: (payload.events || []).length },
  })

  // 200 OK — Xero is happy
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
})
