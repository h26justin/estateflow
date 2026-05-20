// TrueLayer Data API integration.
//
// Single function, four actions selected by body.action:
//   - start_connect  → build the TrueLayer auth URL (their hosted bank
//                      picker handles selection), pre-create a pending
//                      bank_connections row, return auth_url + state.
//   - finalize       → after the bank redirects back with ?code=&state=,
//                      exchange the code for access+refresh tokens, store
//                      both, fetch accounts, mark connection active.
//   - sync           → refresh the access token if needed, pull 90 days
//                      of transactions per account, auto-match against
//                      unpaid rent_payments.
//   - list_institutions  → kept as a no-op so the existing UI fallback
//                          path doesn't break. TrueLayer hosts its own
//                          picker so we don't need our own.
//
// Migrated from the GoCardless implementation (May 2026) after
// GoCardless paused new Bank Account Data signups. Schema is identical:
// bank_connections / bank_accounts / bank_transactions, plus we now
// store { access_token, refresh_token, expires_at } in partner_data.
//
// TrueLayer Data API docs: https://docs.truelayer.com/docs/data-api

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY           = Deno.env.get('SUPABASE_ANON_KEY')!
const TL_CLIENT_ID       = Deno.env.get('TRUELAYER_CLIENT_ID') || ''
const TL_CLIENT_SECRET   = Deno.env.get('TRUELAYER_CLIENT_SECRET') || ''
const TL_ENV             = (Deno.env.get('TRUELAYER_ENV') || 'sandbox').toLowerCase()
const BANK_REDIRECT_BASE = Deno.env.get('BANK_REDIRECT_BASE') || 'https://ownproperly.com/?bank_callback=1'

// Sandbox vs production endpoint switching. Sandbox connects to
// TrueLayer's mock banks (provider_id=uk-cs-mock); production hits real
// UK Open Banking. Same code path — just different hosts.
const IS_SANDBOX = TL_ENV === 'sandbox'
const AUTH_HOST  = IS_SANDBOX ? 'auth.truelayer-sandbox.com' : 'auth.truelayer.com'
const API_HOST   = IS_SANDBOX ? 'api.truelayer-sandbox.com'  : 'api.truelayer.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// ── OAuth: exchange auth code for tokens ────────────────────────────────
async function exchangeCode(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: TL_CLIENT_ID,
    client_secret: TL_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch(`https://${AUTH_HOST}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  const text = await res.text()
  let payload: any = null; try { payload = JSON.parse(text) } catch { payload = text }
  if (!res.ok) {
    const msg = payload?.error_description || payload?.error || `token exchange ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return payload as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string }
}

// ── OAuth: refresh an access token ──────────────────────────────────────
// TrueLayer access tokens last ~1 hour. Refresh tokens are good for up
// to 90 days (PSD2 cap). We refresh on demand whenever the stored token
// has <2 minutes left, returning the new pair to the caller.
async function refreshToken(refresh: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: TL_CLIENT_ID,
    client_secret: TL_CLIENT_SECRET,
    refresh_token: refresh,
  })
  const res = await fetch(`https://${AUTH_HOST}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  const text = await res.text()
  let payload: any = null; try { payload = JSON.parse(text) } catch { payload = text }
  if (!res.ok) {
    const msg = payload?.error_description || payload?.error || `token refresh ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return payload as { access_token: string; refresh_token?: string; expires_in: number }
}

// Returns a still-valid access_token for the connection, refreshing if
// needed. Mutates the connection row to persist refreshed credentials.
async function ensureFreshToken(admin: any, conn: any): Promise<string> {
  const pd = (conn.partner_data || {}) as any
  const expiresAt = pd.expires_at ? new Date(pd.expires_at).getTime() : 0
  const now = Date.now()
  if (pd.access_token && expiresAt - now > 120_000) {
    return pd.access_token
  }
  if (!pd.refresh_token) {
    throw new Error('Connection is missing a refresh token — please reconnect this bank')
  }
  const fresh = await refreshToken(pd.refresh_token)
  const newPd = {
    ...pd,
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || pd.refresh_token,
    expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  }
  await admin.from('bank_connections')
    .update({ partner_data: newPd, updated_at: new Date().toISOString() })
    .eq('id', conn.id)
  return fresh.access_token
}

// Generic authed GET to the TrueLayer data API.
async function tlGet(path: string, accessToken: string): Promise<any> {
  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })
  const text = await res.text()
  let payload: any = null; try { payload = JSON.parse(text) } catch { payload = text }
  if (!res.ok) {
    const msg = payload?.error_description || payload?.error || `TL ${path} → ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return payload
}

// ── Action: list_institutions ───────────────────────────────────────────
// Kept as a no-op success so the existing modal's two-mode logic still
// works (success → live mode → "Connect bank" button; failure → fallback
// to "register interest"). TrueLayer hosts its own picker so we don't
// need our own list.
function listInstitutionsStub() {
  if (!TL_CLIENT_ID || !TL_CLIENT_SECRET) {
    throw new Error('Bank feeds not yet enabled — partner credentials pending')
  }
  return { institutions: [], hostedPicker: true }
}

// ── Action: start_connect ───────────────────────────────────────────────
async function startConnect(supabaseUser: any) {
  if (!TL_CLIENT_ID || !TL_CLIENT_SECRET) {
    throw new Error('Bank feeds not yet enabled — partner credentials pending')
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Pre-create the connection row so its UUID becomes our `state`. This
  // lets us trust the callback without parsing a signed cookie — RLS
  // confirms the row belongs to the caller in finalize().
  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .insert({
      user_id: supabaseUser.id,
      provider: 'truelayer',
      status: 'pending',
    })
    .select()
    .single()
  if (connErr) throw connErr

  // Build the TrueLayer authorize URL. Their hosted page lists the
  // available providers (banks) and the user picks one. `enable_mock`
  // adds the sandbox mock bank to the picker.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TL_CLIENT_ID,
    scope: 'info accounts balance transactions cards offline_access',
    redirect_uri: BANK_REDIRECT_BASE,
    providers: 'uk-cs-mock uk-ob-all uk-oauth-all',
    state: conn.id,
  })
  if (IS_SANDBOX) params.set('enable_mock', 'true')

  return { auth_url: `https://${AUTH_HOST}/?${params.toString()}`, connection_id: conn.id }
}

// ── Action: finalize ────────────────────────────────────────────────────
async function finalize(supabaseUser: any, body: any) {
  const { connection_id, code, error } = body
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (error) {
    // User denied at the bank — mark revoked, surface the message
    if (connection_id) {
      await admin.from('bank_connections')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', connection_id).eq('user_id', supabaseUser.id)
    }
    throw new Error(`Authorisation cancelled at bank (${error})`)
  }
  if (!connection_id) throw new Error('connection_id required')
  if (!code) throw new Error('code required')

  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .select('*')
    .eq('id', connection_id)
    .eq('user_id', supabaseUser.id)
    .single()
  if (connErr || !conn) throw new Error('Connection not found')

  // Exchange code for tokens
  const tokens = await exchangeCode(code, BANK_REDIRECT_BASE)

  // Identify which bank we connected to (for institution_name display)
  let institutionName: string | null = null
  try {
    const me = await tlGet('/data/v1/me', tokens.access_token)
    institutionName = me?.results?.[0]?.provider?.display_name || null
  } catch { /* nice to have, not blocking */ }

  // Fetch accounts attached to the consent
  const accountsRes = await tlGet('/data/v1/accounts', tokens.access_token)
  const accounts = accountsRes?.results || []
  if (accounts.length === 0) {
    throw new Error('No accounts authorised at the bank — try again')
  }

  // Persist tokens + accounts
  const partnerData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope,
  }
  await admin.from('bank_connections')
    .update({
      status: 'active',
      institution_name: institutionName,
      partner_data: partnerData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id)

  for (const acct of accounts) {
    await admin.from('bank_accounts').upsert({
      connection_id: conn.id,
      user_id: supabaseUser.id,
      provider_account_id: acct.account_id,
      display_name: acct.display_name || acct.account_type || null,
      account_number_last4: acct.account_number?.number?.slice(-4) || null,
      sort_code: acct.account_number?.sort_code || null,
      iban: acct.account_number?.iban || null,
      currency: acct.currency || 'GBP',
    }, { onConflict: 'connection_id,provider_account_id' })
  }

  return { ok: true, accounts: accounts.length, institution: institutionName }
}

// ── Action: sync ────────────────────────────────────────────────────────
async function sync(supabaseUser: any) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Load active connections + their accounts in one go
  const { data: conns } = await admin
    .from('bank_connections')
    .select('id, partner_data, status')
    .eq('user_id', supabaseUser.id)
    .eq('status', 'active')

  if (!conns || conns.length === 0) {
    return { ok: true, inserted: 0, matched: 0, message: 'No active connections to sync' }
  }

  let inserted = 0, matched = 0

  for (const conn of conns) {
    let accessToken: string
    try {
      accessToken = await ensureFreshToken(admin, conn)
    } catch (e) {
      console.error('token refresh failed for connection', conn.id, e)
      // If refresh token has expired (>90 days), mark expired so the UI
      // can prompt the user to reconnect.
      await admin.from('bank_connections')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', conn.id)
      continue
    }

    const { data: accts } = await admin
      .from('bank_accounts')
      .select('id, provider_account_id')
      .eq('connection_id', conn.id)
      .eq('user_id', supabaseUser.id)

    const fromDate = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

    for (const acct of accts || []) {
      let txs: any
      try {
        txs = await tlGet(`/data/v1/accounts/${acct.provider_account_id}/transactions?from=${fromDate}`, accessToken)
      } catch (e) {
        console.error('tx fetch failed', acct.id, e)
        continue
      }
      const results = txs?.results || []
      for (const t of results) {
        const providerId = t.transaction_id
        if (!providerId) continue

        // TrueLayer puts the sign on the amount + a separate
        // transaction_type (CREDIT/DEBIT). We just trust the sign;
        // credits are positive incoming money.
        const amount = Number(t.amount) || 0
        const currency = t.currency || 'GBP'
        const postedAt = t.timestamp || new Date().toISOString()
        const counterparty = t.merchant_name || t.meta?.provider_merchant_name || null
        const description = t.description || t.transaction_classification?.[0] || null

        const row: any = {
          account_id: acct.id,
          user_id: supabaseUser.id,
          provider_transaction_id: providerId,
          posted_at: postedAt,
          amount,
          currency,
          description,
          counterparty,
        }

        // Auto-match only positive GBP credits
        if (amount > 0 && currency === 'GBP') {
          const match = await tryAutoMatch(admin, supabaseUser.id, amount, postedAt, counterparty || description || '')
          if (match) {
            row.matched_rent_payment_id = match.id
            row.matched_at = new Date().toISOString()
            row.match_confidence = match.confidence
          }
        }

        const { error: insErr } = await admin
          .from('bank_transactions')
          .upsert(row, { onConflict: 'account_id,provider_transaction_id' })
        if (!insErr) {
          inserted++
          if (row.matched_rent_payment_id) {
            await admin.from('rent_payments')
              .update({ status: 'paid', amount, notes: `Auto-matched from bank · ${counterparty || ''}`.trim() })
              .eq('id', row.matched_rent_payment_id)
              .eq('user_id', supabaseUser.id)
            matched++
          }
        }
      }
    }

    await admin.from('bank_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', conn.id)
  }

  return { ok: true, inserted, matched }
}

// Identical heuristic to the GoCardless build — schema is the same.
async function tryAutoMatch(admin: any, userId: string, amount: number, postedAt: string, hint: string) {
  const { data: candidates } = await admin
    .from('rent_payments')
    .select('id, property_id, year, month, amount, status, period_start, properties:property_id(rent_pcm, address)')
    .eq('user_id', userId)
    .in('status', ['void', 'late', 'partial'])
    .is('deleted_at', null)
  if (!candidates || candidates.length === 0) return null

  const posted = new Date(postedAt)
  let best: { id: string; confidence: number } | null = null

  for (const c of candidates) {
    const expected = c.amount || c.properties?.rent_pcm || 0
    if (!expected) continue
    const diff = Math.abs(expected - amount)
    if (diff > Math.max(5, expected * 0.02)) continue
    let dateOk = true
    if (c.period_start) {
      const ps = new Date(c.period_start)
      const days = Math.abs((posted.getTime() - ps.getTime()) / 86400_000)
      dateOk = days <= 10
    }
    if (!dateOk) continue
    let confidence = 0.7
    if (diff < 0.5) confidence += 0.15
    const addr = (c.properties?.address || '').toLowerCase()
    if (hint && addr && hint.toLowerCase().includes(addr.split(',')[0]?.trim() || '~~')) confidence += 0.1
    if (!best || confidence > best.confidence) best = { id: c.id, confidence }
  }
  if (best && best.confidence >= 0.75) return best
  return null
}

// ── Router ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Unauthorised' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* allow empty */ }

  const action = body.action
  try {
    switch (action) {
      case 'list_institutions':
        return json(listInstitutionsStub())
      case 'start_connect':
        return json(await startConnect(user))
      case 'finalize':
        return json(await finalize(user, body))
      case 'sync':
        return json(await sync(user))
      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = msg.includes('not yet enabled') ? 503 : 400
    return json({ error: msg }, status)
  }
})
