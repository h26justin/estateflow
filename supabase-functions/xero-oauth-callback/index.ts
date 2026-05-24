// Xero OAuth 2.0 — both the "start" and "callback" stages.
//
// Two modes (selected by request body or query string):
//   1. action=start  → returns an authorize URL with state encoding the
//                       user_id + return_to; client redirects there.
//   2. (GET with ?code=...&state=...)  → Xero redirects user here after
//                       consent; we exchange the code for tokens, fetch
//                       the tenant connection, write xero_connections,
//                       then redirect the user back to return_to.
//
// Env vars:
//   XERO_CLIENT_ID
//   XERO_CLIENT_SECRET
//   XERO_REDIRECT_URI   (e.g. https://<ref>.supabase.co/functions/v1/xero-oauth-callback)
//
// State token is signed-ish: { user_id, return_to, nonce } base64-encoded.
// HMAC signing would be stronger — TODO when we ship live.
//
// Justin: register app at https://developer.xero.com/myapps with the
// above redirect URI, then set the three secrets via:
//   supabase secrets set XERO_CLIENT_ID=...
//   supabase secrets set XERO_CLIENT_SECRET=...
//   supabase secrets set XERO_REDIRECT_URI=...

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const XERO_CLIENT_ID     = Deno.env.get('XERO_CLIENT_ID') || ''
const XERO_CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET') || ''
const XERO_REDIRECT_URI  = Deno.env.get('XERO_REDIRECT_URI') || `${SUPABASE_URL}/functions/v1/xero-oauth-callback`

// Granular Xero scopes (post-2-Mar-2026 scope model). Apps created after
// that cutoff CANNOT request the old broad scopes (`accounting.transactions`,
// `accounting.settings`, etc.) — Xero rejects with `invalid_scope`.
//
// Minimum scopes for our push-bank-transactions-on-user's-behalf use case:
//   - openid / profile / email      → OpenID Connect identity claims (mandatory)
//   - offline_access                → refresh tokens
//   - accounting.banktransactions   → CREATE/READ bank transactions (rent + expenses)
//   - accounting.contacts           → CREATE/READ contacts (tenants, suppliers we attach to txns)
//   - accounting.settings.read      → READ chart of accounts + tracking categories
//                                      (so we can pick which bank account + which P&L code)
//
// We deliberately don't request reports / payroll / files / invoices etc. —
// minimum-permission principle. If we add report viewing later, add the
// specific granular scope (e.g. `accounting.reports.profitandloss.read`).
const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.banktransactions',
  'accounting.contacts',
  'accounting.settings.read',
].join(' ')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function encodeState(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload))
}

function decodeState(s: string): Record<string, any> {
  try { return JSON.parse(atob(s)) } catch { return {} }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const url = new URL(req.url)

  // ── Callback from Xero (GET ?code=...&state=...) ──
  if (req.method === 'GET' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code')!
    const state = decodeState(url.searchParams.get('state') || '')
    if (!state.user_id) return new Response('Invalid state', { status: 400 })

    if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) {
      return new Response('Xero not configured. Justin needs to set XERO_CLIENT_ID + XERO_CLIENT_SECRET.', { status: 500 })
    }

    // Exchange code for tokens
    const basic = btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: XERO_REDIRECT_URI,
      }),
    })
    if (!tokenRes.ok) {
      const t = await tokenRes.text()
      return new Response('Xero token exchange failed: ' + t, { status: 500 })
    }
    const tokens = await tokenRes.json()

    // Fetch the tenants this user authorised
    const tenantsRes = await fetch('https://api.xero.com/connections', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    })
    if (!tenantsRes.ok) {
      return new Response('Xero connections fetch failed', { status: 500 })
    }
    const tenants = await tenantsRes.json()
    const first = Array.isArray(tenants) ? tenants[0] : null
    if (!first) return new Response('No Xero tenant authorised', { status: 400 })

    await admin.from('xero_connections').upsert({
      user_id: state.user_id,
      tenant_id: first.tenantId,
      tenant_name: first.tenantName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString(),
      scopes: (tokens.scope || '').split(' '),
    }, { onConflict: 'user_id' })

    // Redirect back into the app
    const returnTo = state.return_to || '/'
    return new Response(null, { status: 302, headers: { Location: returnTo } })
  }

  // ── Programmatic "start" — returns authorize URL ──
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid session')

  try {
    const body = await req.json().catch(() => ({}))
    if (body.action !== 'start') return jsonError(400, 'Unknown action')

    if (!XERO_CLIENT_ID) {
      return jsonError(503, 'Xero not configured. Set XERO_CLIENT_ID supabase secret.')
    }

    const state = encodeState({
      user_id: caller.id,
      return_to: body.return_to || '',
      nonce: crypto.randomUUID(),
    })

    const authorizeUrl = `https://login.xero.com/identity/connect/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: XERO_CLIENT_ID,
      redirect_uri: XERO_REDIRECT_URI,
      scope: SCOPES,
      state,
    }).toString()

    return new Response(JSON.stringify({ authorize_url: authorizeUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
