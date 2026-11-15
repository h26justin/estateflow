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
//                              auto-match against unpaid rent_payments
//                              (posted GBP credits only, transaction date
//                              within the rent period's window, never a
//                              rent row that already records money, and
//                              only where the caller has has_company_write
//                              on a live company); Plaid modified/removed
//                              items update or undo earlier matches.
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
const ANON_KEY           = Deno.env.get('SUPABASE_ANON_KEY')!
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
        // No `webhook`: transactions are pulled by the 'sync' action, and no
        // Plaid webhook receiver exists (bank-plaid-webhook was never built or
        // deployed). Registering a dead URL only made Plaid post item events
        // into a 404. Add a webhook here only alongside a real, verified
        // receiver (Plaid webhook JWT verification).
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
        console.error('Plaid token encryption failed (check OWNPROPERLY_TOKEN_KEY):', (e as Error).message)
        return new Response(JSON.stringify({
          error: 'The bank connection could not be stored securely. Please contact support.',
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
      // Caller-scoped client for the write / liveness checks (same pair the
      // RLS write policies and bookkeeping-ai use).
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      })
      // company_id → may the caller write rent records there right now?
      const companyOk = new Map<string, boolean>()
      const canWriteCompany = async (companyId: string | null | undefined): Promise<boolean> => {
        if (!companyId) return false
        if (!companyOk.has(companyId)) {
          const [{ data: canWrite, error: wErr }, { data: live, error: lErr }] = await Promise.all([
            userClient.rpc('has_company_write', { p_company_id: companyId }),
            userClient.rpc('company_is_live', { p_company_id: companyId }),
          ])
          companyOk.set(companyId, !wErr && !lErr && canWrite === true && live === true)
        }
        return companyOk.get(companyId)!
      }
      // property_id → company_id (for candidates found on unscoped accounts).
      const propCompany = new Map<string, string | null>()
      const companyOfProperty = async (propertyId: string): Promise<string | null> => {
        if (!propCompany.has(propertyId)) {
          const { data: prop } = await admin.from('properties').select('company_id').eq('id', propertyId).maybeSingle()
          propCompany.set(propertyId, prop?.company_id || null)
        }
        return propCompany.get(propertyId)!
      }

      // Undo an AUTOMATIC match (match_confidence < 1) whose bank transaction
      // was withdrawn or changed by the bank. The rent row is put back to
      // 'void' (as unmatchTransaction does) only if it still carries our
      // auto-match note — anything the user has since edited is left alone.
      // A manual match is never undone here; the user is told instead.
      const AUTO_NOTE = 'Auto-matched from bank'
      const revertMatch = async (row: any, reason: string) => {
        if (!row?.matched_rent_payment_id) return
        const isAuto = row.match_confidence != null && Number(row.match_confidence) < 1
        const { data: rp } = await admin.from('rent_payments')
          .select('id, status, notes, property_id').eq('id', row.matched_rent_payment_id).maybeSingle()
        if (isAuto && rp && rp.status === 'paid' && String(rp.notes || '').startsWith(AUTO_NOTE)
            && await canWriteCompany(await companyOfProperty(rp.property_id))) {
          await admin.from('bank_transactions')
            .update({ matched_rent_payment_id: null, matched_at: null, match_confidence: null }).eq('id', row.id)
          await admin.from('rent_payments').update({ status: 'void' }).eq('id', rp.id).eq('status', 'paid')
        }
        await admin.from('notifications').insert({
          user_id: caller.id,
          type: 'rent',
          title: 'Bank payment changed after matching',
          body: `A bank transaction of £${Number(row.amount).toFixed(2)} that was matched to rent was ${reason} by the bank. ${isAuto ? 'The automatic match has been undone where the rent record was unchanged — check' : 'Check'} the rent record in the Bank Inbox.`,
          metadata: { rent_payment_id: row.matched_rent_payment_id, bank_transaction_id: row.id },
        })
      }

      // Pull all active Plaid connections for this user
      const { data: conns } = await admin.from('bank_connections')
        .select('id, partner_data, status')
        .eq('user_id', caller.id)
        .eq('provider', 'plaid')
        .eq('status', 'active')

      let inserted = 0, matched = 0, removedCount = 0
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
        // so each call returns only what's new since last sync. A pending
        // transaction and its posted replacement arrive as separate items
        // (the pending one later in `removed`), so pending ones are skipped
        // and `modified` / `removed` are applied below.
        let cursor = pd.cursor || null
        let hasMore = true
        const newTxns: any[] = []
        const modifiedTxns: any[] = []
        const removedIds: string[] = []
        while (hasMore) {
          const result = await plaidPost('/transactions/sync', {
            access_token: accessToken,
            cursor,
            count: 500,
          })
          newTxns.push(...(result.added || []))
          modifiedTxns.push(...(result.modified || []))
          for (const r of (result.removed || [])) if (r?.transaction_id) removedIds.push(r.transaction_id)
          cursor = result.next_cursor
          hasMore = result.has_more
        }

        // Map Plaid account_id → our bank_accounts row (company_id scopes
        // the rent auto-match below to that company's properties).
        const { data: accs } = await admin.from('bank_accounts')
          .select('id, provider_account_id, company_id').eq('connection_id', c.id)
        const accountMap = new Map((accs || []).map(a => [a.provider_account_id, a.id]))
        const accountCompany = new Map((accs || []).map(a => [a.provider_account_id, a.company_id]))
        const ourAccountIds = (accs || []).map(a => a.id)

        // Removed by the bank (typically a pending item replaced by its
        // posted version): undo any match and drop the row.
        if (removedIds.length && ourAccountIds.length) {
          const { data: gone } = await admin.from('bank_transactions')
            .select('id, amount, matched_rent_payment_id, match_confidence')
            .in('account_id', ourAccountIds).in('provider_transaction_id', removedIds)
          for (const row of (gone || [])) {
            await revertMatch(row, 'withdrawn')
            await admin.from('bank_transactions').delete().eq('id', row.id)
            removedCount++
          }
        }

        // Cache of company_id → property ids, resolved on first use.
        const companyProps = new Map<string, string[]>()
        const propertyIdsForCompany = async (companyId: string): Promise<string[]> => {
          if (!companyProps.has(companyId)) {
            const { data: props } = await admin.from('properties')
              .select('id').eq('company_id', companyId)
            companyProps.set(companyId, (props || []).map((p: any) => p.id))
          }
          return companyProps.get(companyId)!
        }

        const addDays = (iso: string, n: number) => {
          const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() + n)
          return d.toISOString().slice(0, 10)
        }
        // Rent rows already linked to this run's transactions, so one rent
        // period can never be claimed twice in a batch.
        const claimed = new Set<string>()

        const upsertTx = async (tx: any, accountId: string) => {
          const amount = -Number(tx.amount) // Plaid: positive = money out. We use positive = money in.
          const { data: row, error: txErr } = await admin.from('bank_transactions').upsert({
            user_id: caller.id,
            account_id: accountId,
            provider_transaction_id: tx.transaction_id,
            posted_at: tx.date,                // YYYY-MM-DD; Postgres casts to timestamptz at midnight UTC
            amount,
            currency: tx.iso_currency_code || 'GBP',
            description: tx.name || tx.merchant_name || '',
            counterparty: tx.merchant_name || tx.name || null,
          }, { onConflict: 'account_id,provider_transaction_id' })
            .select('id, amount, matched_rent_payment_id, match_confidence').single()
          return { amount, row: txErr ? null : row }
        }

        // Modified by the bank: refresh the stored details; an automatic
        // match whose amount no longer agrees with the rent is undone.
        for (const tx of modifiedTxns) {
          const accountId = accountMap.get(tx.account_id)
          if (!accountId || tx.pending) continue
          const { amount, row } = await upsertTx(tx, accountId)
          if (!row?.matched_rent_payment_id) continue
          const { data: rp } = await admin.from('rent_payments').select('amount').eq('id', row.matched_rent_payment_id).maybeSingle()
          if (!rp || Math.abs(Number(rp.amount) - amount) > 0.5) await revertMatch(row, 'changed')
        }

        for (const tx of newTxns) {
          const accountId = accountMap.get(tx.account_id)
          if (!accountId) continue
          // Pending: not money yet, and its posted replacement arrives as a
          // separate transaction — never stored or matched.
          if (tx.pending) continue
          const { amount, row } = await upsertTx(tx, accountId)
          if (row) inserted++

          // Auto-match rent: positive incoming GBP amount matching a void /
          // overdue rent_payment within 50p, whose period starts between 35
          // days before and 7 days after the transaction date (i.e. paid
          // from a week early to 35 days late) and within the last 35 days,
          // scoped to the properties of the company the bank account belongs
          // to (when set). Skipped when the transaction is already matched,
          // and the rent row must have no receipt allocated and no other
          // bank transaction linked — a row that already records money is
          // never overwritten. 'partial' rows are excluded for the same
          // reason (their amount is money already received).
          if (amount > 0 && row && !row.matched_rent_payment_id && (tx.iso_currency_code || 'GBP') === 'GBP' && /^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || '').slice(0, 10))) {
            const txDate = String(tx.date).slice(0, 10)
            const nowCutoff = new Date(Date.now() - 35*24*60*60*1000).toISOString().slice(0,10)
            const winFrom = addDays(txDate, -35)
            const winTo = addDays(txDate, 7)
            const from = winFrom > nowCutoff ? winFrom : nowCutoff
            // Rows written before period stamping shipped have NULL
            // period_start — fall back to the (year, month) of the
            // transaction and the month before; checked precisely below.
            const txY = Number(txDate.slice(0, 4)), txM = Number(txDate.slice(5, 7))
            const prevD = new Date(Date.UTC(txY, txM - 2, 1))
            const prevY = prevD.getUTCFullYear(), prevM = prevD.getUTCMonth() + 1

            let query = admin
              .from('rent_payments')
              .select('id, amount, property_id, period_start, year, month')
              .eq('user_id', caller.id)
              .in('status', ['void','overdue'])
              .is('deleted_at', null)
              .or(`and(period_start.gte.${from},period_start.lte.${winTo}),and(period_start.is.null,year.eq.${txY},month.eq.${txM}),and(period_start.is.null,year.eq.${prevY},month.eq.${prevM})`)
              .gte('amount', amount - 5)
              .lte('amount', amount + 5)
              .order('year', { ascending: false })
              .order('month', { ascending: false })
              .order('id', { ascending: true })
              .limit(10)

            const companyId = accountCompany.get(tx.account_id)
            let scopeOk = true
            if (companyId) {
              const propIds = await propertyIdsForCompany(companyId)
              if (propIds.length === 0) scopeOk = false
              else query = query.in('property_id', propIds)
            }

            const { data: rawCandidates } = scopeOk ? await query : { data: [] }
            // Precise window check (covers the NULL period_start fallback).
            const candidates = (rawCandidates || []).filter((cand: any) => {
              if (claimed.has(cand.id)) return false
              const start = cand.period_start
                ? String(cand.period_start).slice(0, 10)
                : `${cand.year}-${String(cand.month).padStart(2, '0')}-01`
              return start >= from && start <= winTo
            })
            // Deterministic pick: closest amount, ties resolved by the
            // ordered query (latest period first, then id).
            let candidate: any = null
            for (const cand of candidates) {
              if (!candidate || Math.abs(Number(cand.amount) - amount) < Math.abs(Number(candidate.amount) - amount)) {
                candidate = cand
              }
            }
            if (candidate?.id) {
              // Never overwrite a rent row that already records money: no
              // allocated receipt, no other bank transaction linked.
              const [{ count: allocCount }, { count: linkCount }] = await Promise.all([
                admin.from('rent_allocations').select('id', { count: 'exact', head: true }).eq('rent_payment_id', candidate.id),
                admin.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('matched_rent_payment_id', candidate.id),
              ])
              const free = (allocCount ?? 1) === 0 && (linkCount ?? 1) === 0
              const allowed = free && await canWriteCompany(await companyOfProperty(candidate.property_id))
              const diff = Math.abs(Number(candidate.amount) - amount)
              if (allowed && diff <= 0.5) {
                claimed.add(candidate.id)
                // Close enough to call paid. Never overwrite the recorded
                // rent amount — notes capture the bank figure for audit.
                await admin.from('bank_transactions').update({
                  matched_rent_payment_id: candidate.id,
                  matched_at: new Date().toISOString(),
                  match_confidence: 0.8,
                }).eq('id', row.id).is('matched_rent_payment_id', null)
                await admin.from('rent_payments').update({
                  status: 'paid',
                  notes: `${AUTO_NOTE} ${tx.date} · £${amount.toFixed(2)} received · ${(tx.merchant_name || tx.name || '').slice(0, 100)}`,
                }).eq('id', candidate.id).in('status', ['void', 'overdue'])
                matched++
              } else if (free) {
                // Amount differs, or the caller cannot write rent records
                // in that company — don't touch the payment; flag for review.
                await admin.from('notifications').insert({
                  user_id: caller.id,
                  type: 'rent',
                  title: 'Bank payment needs review',
                  body: diff <= 0.5
                    ? `Received £${amount.toFixed(2)} on ${tx.date} — matches an expected rent, but it was not matched automatically. Review and match it manually.`
                    : `Received £${amount.toFixed(2)} on ${tx.date} — close to an expected rent of £${Number(candidate.amount).toFixed(2)} but not an exact match. Review and match it manually.`,
                  metadata: {
                    rent_payment_id: candidate.id,
                    property_id: candidate.property_id,
                    provider_transaction_id: tx.transaction_id,
                    bank_amount: amount,
                  },
                })
              }
            }
          }
        }

        // Persist cursor for next sync — only AFTER the batch has been
        // processed. If anything above throws, the cursor stays put and
        // Plaid re-delivers the same transactions next sync (the upsert
        // on provider_transaction_id makes reprocessing safe, and an
        // already-matched transaction is never matched again).
        await admin.from('bank_connections').update({
          partner_data: { ...pd, cursor, last_synced_at: new Date().toISOString() },
        }).eq('id', c.id)
      }
      return jsonResp(200, { inserted, matched, removed: removedCount })
    }

    if (action === 'list_institutions') {
      // Plaid Link picks the bank itself — kept as a no-op success so the
      // existing UI mode-detection code path works.
      return jsonResp(200, { ok: true })
    }

    return jsonError(400, 'Unknown action: ' + action)
  } catch (e: any) {
    // Plaid / DB error text is developer-facing — log it, return a summary.
    if (e?.plaid) {
      console.error('Plaid error:', e.status, JSON.stringify(e.plaid).slice(0, 1000))
      const code = typeof e.plaid?.error_code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.plaid.error_code) ? ` (${e.plaid.error_code})` : ''
      return jsonError(e.status || 502, `Bank provider error${code} — please try again`)
    }
    console.error('bank-plaid failed:', e)
    return jsonError(500, 'Something went wrong — please try again')
  }
})
