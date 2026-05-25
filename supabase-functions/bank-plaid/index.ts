// Plaid UK Open Banking — Data API integration.
//
// Replaces TrueLayer (which itself replaced GoCardless BAD after they
// paused new signups). Justin has a Plaid call this week to get sandbox
// credentials. Until then this function returns 503 with a friendly
// message and the UI falls back to "register interest" mode.
//
// Plaid Link flow (different from TrueLayer's hosted redirect):
//   1. create_link_token   → backend creates a short-lived link_token for
//                              the user; returns it to the frontend.
//   2. <Plaid Link.js opens in browser> User picks bank, signs in, grants
//      consent. Plaid returns a one-time public_token to our JS callback.
//   3. exchange_public_token → backend swaps public_token for a long-
//                              lived access_token, fetches accounts, writes
//                              bank_connections + bank_accounts rows.
//   4. sync                → pull transactions for all active connections,
//                              auto-match against unpaid rent_payments.
//
// Schema is identical to bank-truelayer: bank_connections / bank_accounts /
// bank_transactions. partner_data jsonb stores Plaid-specific tokens:
//   { provider: 'plaid', access_token, item_id, institution_id, institution_name }
//
// Env vars (set via supabase secrets once Justin has Plaid creds):
//   PLAID_CLIENT_ID
//   PLAID_SECRET
//   PLAID_ENV          ('sandbox' | 'development' | 'production')
//   BANK_REDIRECT_BASE (where to bounce after OAuth, e.g. https://ownproperly.com)
//
// Plaid UK Data API docs: https://plaid.com/docs/api/

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, decryptToken } from './encryption.ts'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLAID_CLIENT_ID    = Deno.env.get('PLAID_CLIENT_ID') || ''
const PLAID_SECRET       = Deno.env.get('PLAID_SECRET') || ''
const PLAID_ENV          = (Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase()
const BANK_REDIRECT_BASE = Deno.env.get('BANK_REDIRECT_BASE') || 'https://ownproperly.com'

const PLAID_HOST = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
}[PLAID_ENV] || 'https://sandbox.plaid.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(status: number, message: string) { return jsonResp(status, { error: message }) }

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error_message || json?.error?.message || ('Plaid HTTP ' + res.status)
    const e: any = new Error(msg)
    e.status = res.status; e.plaid = json
    throw e
  }
  return json
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid session')

  // Soft-fail to "creds not configured" so the UI can show "register interest"
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    return jsonError(503, 'Plaid credentials not configured yet. Connect your bank manually for now — we\'ll email you when live.')
  }

  let action = ''
  try {
    const body = await req.json()
    action = body.action

    if (action === 'create_link_token') {
      // user.client_user_id must be stable per user. caller.id is fine.
      const result = await plaidPost('/link/token/create', {
        user: { client_user_id: caller.id },
        client_name: 'OwnProperly',
        products: ['transactions'],
        country_codes: ['GB'],
        language: 'en',
        webhook: `${SUPABASE_URL}/functions/v1/bank-plaid-webhook`,
        redirect_uri: BANK_REDIRECT_BASE,
      })
      return jsonResp(200, { link_token: result.link_token, expiration: result.expiration })
    }

    if (action === 'exchange_public_token') {
      const { public_token, institution_id, institution_name } = body
      if (!public_token) return jsonError(400, 'public_token required')

      // Exchange
      const exch = await plaidPost('/item/public_token/exchange', { public_token })
      const accessToken = exch.access_token
      const itemId = exch.item_id

      // Pull accounts
      const accountsRes = await plaidPost('/accounts/get', { access_token: accessToken })
      const inst = accountsRes.item?.institution_id
        ? await plaidPost('/institutions/get_by_id', { institution_id: accountsRes.item.institution_id, country_codes: ['GB'] }).catch(() => null)
        : null
      const resolvedInstName = institution_name || inst?.institution?.name || 'Bank'

      // Encrypt the Plaid access_token before writing to partner_data.
      // When OWNPROPERLY_TOKEN_KEY is configured we store ciphertext under
      // `access_token_enc` and leave `access_token` null. The sync path
      // (below) prefers the encrypted column, falling back to plaintext
      // for legacy connections written before encryption shipped.
      let encAccess: string | null = null
      try { encAccess = await encryptToken(accessToken) }
      catch (e) {
        return new Response(JSON.stringify({
          error: 'Token encryption failed: ' + (e as Error).message +
                 ' — check the OWNPROPERLY_TOKEN_KEY supabase secret (must be 64 hex chars).',
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Write the connection row
      const { data: conn, error: cErr } = await admin.from('bank_connections').insert({
        user_id: caller.id,
        provider: 'plaid',
        institution_id: institution_id || accountsRes.item?.institution_id || null,
        institution_name: resolvedInstName,
        status: 'active',
        partner_data: {
          provider: 'plaid',
          item_id: itemId,
          // Plaintext column kept nullable for the legacy path; null when encrypted.
          access_token:     encAccess ? null : accessToken,
          access_token_enc: encAccess || null,
          institution_id: institution_id || accountsRes.item?.institution_id || null,
          institution_name: resolvedInstName,
        },
      }).select().single()
      if (cErr) throw cErr

      // Write each account
      for (const a of (accountsRes.accounts || [])) {
        await admin.from('bank_accounts').upsert({
          connection_id: conn.id,
          user_id: caller.id,
          provider_account_id: a.account_id,
          display_name: a.name || a.official_name || 'Account',
          account_number_last4: a.mask || null,
          currency: a.balances?.iso_currency_code || 'GBP',
          balance: a.balances?.current ?? null,
          balance_at: new Date().toISOString(),
        }, { onConflict: 'connection_id,provider_account_id' })
      }

      return jsonResp(200, { connection_id: conn.id, accounts: accountsRes.accounts?.length || 0 })
    }

    if (action === 'sync') {
      // Pull all active Plaid connections for this user
      const { data: conns } = await admin.from('bank_connections')
        .select('id, partner_data, status')
        .eq('user_id', caller.id)
        .eq('provider', 'plaid')
        .eq('status', 'active')

      let inserted = 0, matched = 0
      for (const c of (conns || [])) {
        const pd = c.partner_data as any
        // Resolve the access token: prefer encrypted column, fall back to
        // legacy plaintext for connections created before encryption shipped.
        let accessToken: string | null = null
        if (pd?.access_token_enc) {
          accessToken = await decryptToken(pd.access_token_enc)
        }
        if (!accessToken) accessToken = pd?.access_token || null
        if (!accessToken) continue

        // /transactions/sync — Plaid's recommended endpoint; uses cursor
        // so each call returns only what's new since last sync.
        let cursor = pd.cursor || null
        let hasMore = true
        const newTxns: any[] = []
        while (hasMore) {
          const result = await plaidPost('/transactions/sync', {
            access_token: accessToken,
            cursor,
            count: 500,
          })
          newTxns.push(...(result.added || []))
          cursor = result.next_cursor
          hasMore = result.has_more
        }

        // Persist cursor for next sync
        await admin.from('bank_connections').update({
          partner_data: { ...pd, cursor, last_synced_at: new Date().toISOString() },
        }).eq('id', c.id)

        // Map Plaid account_id → our bank_accounts.id
        const { data: accs } = await admin.from('bank_accounts')
          .select('id, provider_account_id').eq('connection_id', c.id)
        const accountMap = new Map((accs || []).map(a => [a.provider_account_id, a.id]))

        for (const tx of newTxns) {
          const accountId = accountMap.get(tx.account_id)
          if (!accountId) continue
          const amount = -Number(tx.amount) // Plaid: positive = money out. We use positive = money in.
          const { error: txErr } = await admin.from('bank_transactions').upsert({
            user_id: caller.id,
            account_id: accountId,
            provider_transaction_id: tx.transaction_id,
            posted_at: tx.date,                // YYYY-MM-DD; Postgres casts to timestamptz at midnight UTC
            amount,
            currency: tx.iso_currency_code || 'GBP',
            description: tx.name || tx.merchant_name || '',
            counterparty: tx.merchant_name || tx.name || null,
          }, { onConflict: 'account_id,provider_transaction_id' })
          if (!txErr) inserted++

          // Auto-match rent: positive incoming amount matching a void/pending
          // rent_payment within ±£5 in the last 35 days. Light heuristic;
          // user can fix mismatches via the UI.
          if (amount > 0) {
            const { data: candidate } = await admin
              .from('rent_payments')
              .select('id, amount, property_id')
              .eq('user_id', caller.id)
              .in('status', ['void','overdue','partial'])
              .gte('period_start', new Date(Date.now() - 35*24*60*60*1000).toISOString().slice(0,10))
              .gte('amount', amount - 5)
              .lte('amount', amount + 5)
              .limit(1)
              .maybeSingle()
            if (candidate?.id) {
              await admin.from('bank_transactions').update({
                matched_rent_payment_id: candidate.id,
                matched_at: new Date().toISOString(),
                match_confidence: 0.8,
              }).eq('provider_transaction_id', tx.transaction_id).eq('user_id', caller.id)
              // Schema: rent_payments has `amount` + `status` (no paid_amount/paid_at).
              // We update amount to what the bank actually received and flip status.
              // Notes capture the matched bank counterparty for audit.
              await admin.from('rent_payments').update({
                status: 'paid',
                amount,
                notes: `Auto-matched from bank ${tx.date} · ${(tx.merchant_name || tx.name || '').slice(0, 100)}`,
              }).eq('id', candidate.id)
              matched++
            }
          }
        }
      }
      return jsonResp(200, { inserted, matched })
    }

    if (action === 'list_institutions') {
      // Plaid Link picks the bank itself — kept as a no-op success so the
      // existing UI mode-detection code path works.
      return jsonResp(200, { ok: true })
    }

    return jsonError(400, 'Unknown action: ' + action)
  } catch (e: any) {
    return jsonError(e.status || 500, e.message || 'Unknown error')
  }
})
