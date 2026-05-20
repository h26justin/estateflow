// GoCardless Bank Account Data integration.
//
// One function, multiple actions, switched by body.action:
//   - list_institutions  → returns UK banks for the picker
//   - start_connect      → creates a requisition + bank_connections row,
//                          returns the auth URL to redirect the user to
//   - finalize           → after user consents at their bank, exchange the
//                          requisition for accounts + mark connection active
//   - sync               → pull recent transactions for all active accounts,
//                          attempt auto-match against rent_payments
//
// All actions require an authenticated caller. We use the user's JWT for
// row-level identity but call GoCardless with platform credentials stored
// as edge secrets (GOCARDLESS_BAD_SECRET_ID / GOCARDLESS_BAD_SECRET_KEY).
//
// Until the platform creds are provisioned, the function returns a clear
// error to the client so the UI can show the "still in onboarding" message.
// Justin is doing the GoCardless application async; deploy can wait.
//
// GoCardless BAD API docs: https://bankaccountdata.gocardless.com/api/docs

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY              = Deno.env.get('SUPABASE_ANON_KEY')!
const GC_SECRET_ID          = Deno.env.get('GOCARDLESS_BAD_SECRET_ID') || ''
const GC_SECRET_KEY         = Deno.env.get('GOCARDLESS_BAD_SECRET_KEY') || ''
// Redirect uses a query param on the root URL so we don't need any
// server-side rewrites for the hash-routed SPA. The reference (= our
// connection_id) is appended by GoCardless as `&ref=<uuid>`.
const BANK_REDIRECT_BASE    = Deno.env.get('BANK_REDIRECT_BASE') || 'https://ownproperly.com/?bank_callback=1'

const GC_BASE = 'https://bankaccountdata.gocardless.com/api/v2'

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

// ── GoCardless token cache (per-invocation; cold-starts fine) ────────────
let cachedToken: { access: string; expires: number } | null = null

async function getAccessToken(): Promise<string> {
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    throw new Error('Bank feeds not yet enabled — partner credentials pending')
  }
  if (cachedToken && cachedToken.expires > Date.now() + 30_000) {
    return cachedToken.access
  }
  const res = await fetch(`${GC_BASE}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ secret_id: GC_SECRET_ID, secret_key: GC_SECRET_KEY }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GoCardless token request failed: ${res.status} ${text}`)
  }
  const body = await res.json() as { access: string; access_expires: number }
  cachedToken = {
    access: body.access,
    expires: Date.now() + (body.access_expires * 1000),
  }
  return cachedToken.access
}

async function gc(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${GC_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = body?.summary || body?.detail || body?.message || `GoCardless ${path} → ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return body
}

// ── Action: list_institutions ────────────────────────────────────────────
// Cached in-memory per cold start (it changes once a month at most).
let cachedInstitutions: any[] | null = null
async function listInstitutions(country = 'gb') {
  if (cachedInstitutions) return cachedInstitutions
  const list = await gc(`/institutions/?country=${encodeURIComponent(country)}`)
  cachedInstitutions = (list as any[]).map(i => ({
    id: i.id,
    name: i.name,
    bic: i.bic,
    logo: i.logo,
    transaction_total_days: i.transaction_total_days,
  }))
  return cachedInstitutions
}

// ── Action: start_connect ────────────────────────────────────────────────
async function startConnect(supabaseUser: any, body: any) {
  const { institution_id, institution_name } = body
  if (!institution_id) throw new Error('institution_id required')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Pre-create connection row so we can use its UUID as the reference and
  // recognise the user on callback without trusting query params.
  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .insert({
      user_id: supabaseUser.id,
      provider: 'gocardless-bad',
      institution_id,
      institution_name: institution_name || null,
      status: 'pending',
    })
    .select()
    .single()
  if (connErr) throw connErr

  // 90-day max consent (PSD2 ceiling). After this the user re-auths.
  const agreement = await gc('/agreements/enduser/', {
    method: 'POST',
    body: JSON.stringify({
      institution_id,
      max_historical_days: 90,
      access_valid_for_days: 90,
      access_scope: ['balances', 'transactions', 'details'],
    }),
  })

  const requisition = await gc('/requisitions/', {
    method: 'POST',
    body: JSON.stringify({
      redirect: BANK_REDIRECT_BASE,
      institution_id,
      reference: conn.id,
      agreement: agreement.id,
      user_language: 'EN',
    }),
  })

  await admin
    .from('bank_connections')
    .update({
      provider_consent_id: requisition.id,
      partner_data: { agreement_id: agreement.id, requisition_id: requisition.id },
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id)

  return { auth_url: requisition.link, connection_id: conn.id }
}

// ── Action: finalize ─────────────────────────────────────────────────────
// Called by the /bank/callback page after the bank redirects back.
async function finalize(supabaseUser: any, body: any) {
  const { connection_id } = body
  if (!connection_id) throw new Error('connection_id required')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .select('*')
    .eq('id', connection_id)
    .eq('user_id', supabaseUser.id) // RLS-equivalent guard
    .single()
  if (connErr || !conn) throw new Error('Connection not found')

  const requisitionId = conn.provider_consent_id
  if (!requisitionId) throw new Error('Connection has no requisition')

  const req = await gc(`/requisitions/${requisitionId}/`)
  if (!req.accounts || req.accounts.length === 0) {
    throw new Error('No accounts authorised at the bank — try again')
  }

  // Persist account stubs; details fetched lazily on first sync.
  for (const acctId of req.accounts) {
    let details: any = {}
    try {
      const d = await gc(`/accounts/${acctId}/details/`)
      details = d?.account || {}
    } catch { /* details are nice-to-have */ }

    await admin.from('bank_accounts').upsert({
      connection_id: conn.id,
      user_id: supabaseUser.id,
      provider_account_id: acctId,
      display_name: details.name || details.product || null,
      iban: details.iban || null,
      currency: details.currency || 'GBP',
    }, { onConflict: 'connection_id,provider_account_id' })
  }

  await admin
    .from('bank_connections')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', conn.id)

  return { ok: true, accounts: req.accounts.length }
}

// ── Action: sync ─────────────────────────────────────────────────────────
async function sync(supabaseUser: any, _body: any) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: accts, error: aErr } = await admin
    .from('bank_accounts')
    .select('id, provider_account_id, connection_id')
    .eq('user_id', supabaseUser.id)
  if (aErr) throw aErr

  let inserted = 0
  let matched = 0

  for (const acct of accts || []) {
    // 90-day lookback (provider cap on most banks)
    const dateFrom = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
    let txs: any
    try {
      txs = await gc(`/accounts/${acct.provider_account_id}/transactions/?date_from=${dateFrom}`)
    } catch (e) {
      console.error('tx fetch failed', acct.id, e)
      continue
    }
    const booked = txs?.transactions?.booked || []
    for (const t of booked) {
      const providerId = t.transactionId || t.internalTransactionId
      if (!providerId) continue
      const amount = parseFloat(t.transactionAmount?.amount || '0')
      const currency = t.transactionAmount?.currency || 'GBP'
      const postedAt = t.bookingDate || t.valueDate || new Date().toISOString().slice(0, 10)
      const counterparty =
        t.debtorName || t.creditorName ||
        t.remittanceInformationUnstructured || null
      const description =
        t.remittanceInformationUnstructured ||
        (Array.isArray(t.remittanceInformationUnstructuredArray)
          ? t.remittanceInformationUnstructuredArray.join(' ')
          : null) ||
        null

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

      // Attempt auto-match (only for incoming positive amounts in GBP).
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
          // Reflect the match on the rent_payment side.
          await admin
            .from('rent_payments')
            .update({ status: 'paid', amount, notes: `Auto-matched from bank · ${counterparty || ''}`.trim() })
            .eq('id', row.matched_rent_payment_id)
            .eq('user_id', supabaseUser.id)
          matched++
        }
      }
    }
  }

  await admin
    .from('bank_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', supabaseUser.id)
    .eq('status', 'active')

  return { ok: true, inserted, matched }
}

// Heuristic match: amount within £5 of expected rent for an unpaid month,
// dated within ±10 days of period_start. Confidence is heuristic 0–1.
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
    // Period check — if period_start known, must be within 10 days
    let dateOk = true
    if (c.period_start) {
      const ps = new Date(c.period_start)
      const days = Math.abs((posted.getTime() - ps.getTime()) / 86400_000)
      dateOk = days <= 10
    }
    if (!dateOk) continue
    // Address hint match boosts confidence
    let confidence = 0.7
    if (diff < 0.5) confidence += 0.15
    const addr = (c.properties?.address || '').toLowerCase()
    if (hint && addr && hint.toLowerCase().includes(addr.split(',')[0]?.trim() || '~~')) confidence += 0.1
    if (!best || confidence > best.confidence) best = { id: c.id, confidence }
  }
  if (best && best.confidence >= 0.75) return best
  return null
}

// ── Router ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Auth: use the user's JWT to identify them.
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
        return json({ institutions: await listInstitutions(body.country || 'gb') })
      case 'start_connect':
        return json(await startConnect(user, body))
      case 'finalize':
        return json(await finalize(user, body))
      case 'sync':
        return json(await sync(user, body))
      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = msg.includes('not yet enabled') ? 503 : 400
    return json({ error: msg }, status)
  }
})
