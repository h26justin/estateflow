// Xero sync — pushes rent_payments and property_expenses into Xero as
// BankTransactions (RECEIVE for rent, SPEND for expenses).
//
// Phase 1: TO_XERO only (one-way push). FROM_XERO + reconciliation comes
// in Phase 2 once Justin has chosen which Xero bank accounts each
// property maps to.
//
// Input: { direction: 'to_xero' | 'from_xero' | 'both' }
//
// Approach:
//   1. Load user's xero_connections row + refresh token if near expiry
//   2. For TO_XERO:
//      a. Find unsynced rent_payments (status='paid', no row in xero_sync_map)
//      b. Find unsynced property_expenses (amount > 0, no row in xero_sync_map)
//      c. For each, POST BankTransaction to Xero, store the returned
//         BankTransactionID in xero_sync_map
//   3. Write a xero_sync_log row with counts
//
// Bank account selection: needs a default bank account ID. Until the user
// configures per-property bank accounts, we use the first ACTIVE bank
// account from /Accounts on first sync (cached on connection row).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const XERO_CLIENT_ID     = Deno.env.get('XERO_CLIENT_ID') || ''
const XERO_CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function refreshIfNeeded(admin: any, conn: any) {
  const expires = new Date(conn.expires_at)
  if (expires.getTime() > Date.now() + 60_000) return conn.access_token
  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new Error('Xero client credentials not configured')

  const basic = btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  if (!res.ok) throw new Error('Xero token refresh failed: ' + await res.text())
  const t = await res.json()
  await admin.from('xero_connections').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in || 1800) * 1000).toISOString(),
  }).eq('user_id', conn.user_id)
  return t.access_token
}

async function xeroFetch(token: string, tenantId: string, path: string, init: RequestInit = {}) {
  return await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  })
}

// Parse Xero's ValidationException into a clean one-line summary.
// Xero responses look like:
//   { "ErrorNumber":10, "Type":"ValidationException", "Message":"...",
//     "Elements":[{ ...echo..., "ValidationErrors":[{"Message":"Account code XXX not found"}] }] }
async function xeroErrorSummary(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text)
    const elements = body?.Elements || []
    const validationMsgs: string[] = []
    for (const el of elements) {
      for (const v of (el?.ValidationErrors || [])) {
        if (v?.Message) validationMsgs.push(v.Message)
      }
    }
    if (validationMsgs.length > 0) return validationMsgs.join('; ')
    return body?.Message || body?.Detail || text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
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

  const { direction = 'to_xero' } = await req.json().catch(() => ({}))

  // Open the log row immediately so we can show "running…" in the UI
  const { data: logRow } = await admin.from('xero_sync_log').insert({
    user_id: caller.id, direction, status: 'running',
  }).select().single()

  let created = 0, updated = 0, failed = 0
  const errors: string[] = []

  try {
    const { data: conn, error: ce } = await admin
      .from('xero_connections').select('*').eq('user_id', caller.id).single()
    if (ce || !conn) throw new Error('Not connected to Xero')

    const accessToken = await refreshIfNeeded(admin, conn)

    if (direction !== 'to_xero' && direction !== 'both') {
      throw new Error('Only to_xero direction supported in Phase 1')
    }

    // Pull ALL active accounts in one call — we need:
    //   - A BANK account to post the BankTransaction against
    //   - A REVENUE/SALES account code for rent LineItems
    //   - An EXPENSE/OVERHEADS/DIRECTCOSTS code for expense LineItems
    // Hardcoded codes (200, 404) don't exist in every Xero org — only the
    // Xero Demo Company comes with those. ExH and other real orgs use a
    // custom chart of accounts.
    const accountsRes = await xeroFetch(accessToken, conn.tenant_id, 'Accounts?where=Status=="ACTIVE"')
    if (!accountsRes.ok) throw new Error('Failed to list Xero accounts: ' + await accountsRes.text())
    const accountsJson = await accountsRes.json()
    const allAccounts: any[] = accountsJson.Accounts || []

    const bankAccount = allAccounts.find(a => a.Type === 'BANK')
    if (!bankAccount?.AccountID) throw new Error('No active Xero bank account found — add one in Xero first')
    const bankAccountId = bankAccount.AccountID

    // Pick the first matching code. Xero account types per docs:
    //   REVENUE / SALES / OTHERINCOME → income side (for rent)
    //   EXPENSE / OVERHEADS / DIRECTCOSTS → expense side (for property costs)
    const incomeAccount = allAccounts.find(a => ['REVENUE','SALES','OTHERINCOME'].includes(a.Type))
    const expenseAccount = allAccounts.find(a => ['EXPENSE','OVERHEADS','DIRECTCOSTS'].includes(a.Type))
    if (!incomeAccount?.Code) throw new Error('No revenue account in Xero — add one (Settings → Chart of Accounts) and retry')
    if (!expenseAccount?.Code) throw new Error('No expense account in Xero — add one (Settings → Chart of Accounts) and retry')
    const INCOME_CODE = incomeAccount.Code
    const EXPENSE_CODE = expenseAccount.Code

    // Fetch what's already been synced so we skip those
    const { data: synced } = await admin.from('xero_sync_map')
      .select('entity_type, local_id').eq('user_id', caller.id)
    const syncedSet = new Set((synced || []).map(s => `${s.entity_type}:${s.local_id}`))

    // Properties (user's own, non-deleted)
    const { data: props } = await admin.from('properties')
      .select('id, name').eq('user_id', caller.id).is('deleted_at', null)
    const propMap = new Map((props || []).map(p => [p.id, p]))
    const propIds = (props || []).map(p => p.id)

    if (propIds.length === 0) {
      throw new Error('No properties to sync')
    }

    // RENT PAYMENTS → Xero RECEIVE
    // Schema: only paid rows have an amount we want to push.
    // Xero requires a Contact on every BankTransaction. We use a generic
    // "<Property name> — Tenant" or "<Property name> — Supplier" so the
    // user can later merge/rename in Xero's Contacts list.
    const { data: payments } = await admin.from('rent_payments')
      .select('id, property_id, amount, status, period_start, period_end')
      .in('property_id', propIds)
      .eq('status', 'paid')
      .gt('amount', 0)
    for (const p of (payments || [])) {
      if (syncedSet.has(`rent_payment:${p.id}`)) continue
      const prop = propMap.get(p.property_id)
      const txnDate = p.period_start
      if (!txnDate) { failed++; continue }
      const body = {
        BankTransactions: [{
          Type: 'RECEIVE',
          Date: txnDate,
          Contact: { Name: `${prop?.name || 'Property'} — Tenant` },
          BankAccount: { AccountID: bankAccountId },
          Reference: `Rent — ${prop?.name || 'Property'}`,
          LineItems: [{
            Description: `Rent ${p.period_start || ''} → ${p.period_end || ''}`.trim(),
            Quantity: 1,
            UnitAmount: Number(p.amount),
            AccountCode: INCOME_CODE, // first REVENUE/SALES account in user's chart
          }],
        }],
      }
      const res = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
        method: 'POST', body: JSON.stringify(body),
      })
      if (!res.ok) {
        failed++; errors.push(`rent ${p.id}: ${await xeroErrorSummary(res)}`); continue
      }
      const data = await res.json()
      const xid = data.BankTransactions?.[0]?.BankTransactionID
      if (xid) {
        await admin.from('xero_sync_map').upsert({
          user_id: caller.id, entity_type: 'rent_payment', local_id: p.id,
          xero_id: xid, xero_kind: 'BankTransaction',
        }, { onConflict: 'user_id,entity_type,local_id' })
        created++
      }
    }

    // EXPENSES → Xero SPEND
    const { data: expenses } = await admin.from('property_expenses')
      .select('id, property_id, amount, date, category, description')
      .in('property_id', propIds).is('deleted_at', null).gt('amount', 0)
    for (const e of (expenses || [])) {
      if (syncedSet.has(`expense:${e.id}`)) continue
      const prop = propMap.get(e.property_id)
      if (!e.date) { failed++; continue }
      const body = {
        BankTransactions: [{
          Type: 'SPEND',
          Date: e.date,
          Contact: { Name: `${prop?.name || 'Property'} — Supplier` },
          BankAccount: { AccountID: bankAccountId },
          Reference: `${e.category || 'Expense'} — ${prop?.name || 'Property'}`,
          LineItems: [{
            Description: e.description || e.category || 'Property expense',
            Quantity: 1,
            UnitAmount: Number(e.amount),
            AccountCode: EXPENSE_CODE, // first EXPENSE/OVERHEADS account in user's chart
          }],
        }],
      }
      const res = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
        method: 'POST', body: JSON.stringify(body),
      })
      if (!res.ok) {
        failed++; errors.push(`expense ${e.id}: ${await xeroErrorSummary(res)}`); continue
      }
      const data = await res.json()
      const xid = data.BankTransactions?.[0]?.BankTransactionID
      if (xid) {
        await admin.from('xero_sync_map').upsert({
          user_id: caller.id, entity_type: 'expense', local_id: e.id,
          xero_id: xid, xero_kind: 'BankTransaction',
        }, { onConflict: 'user_id,entity_type,local_id' })
        created++
      }
    }

    // Finalise log + connection summary
    await admin.from('xero_sync_log').update({
      finished_at: new Date().toISOString(),
      status: failed > 0 ? 'partial' : 'ok',
      records_created: created, records_updated: updated, records_failed: failed,
      details: errors.length ? { errors: errors.slice(0, 50) } : null,
    }).eq('id', logRow!.id)

    await admin.from('xero_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: failed > 0 ? 'partial' : 'ok',
      last_sync_error: errors.length ? errors[0] : null,
    }).eq('user_id', caller.id)

    return new Response(JSON.stringify({
      ok: true, created, updated, failed,
      errors: errors.slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    const msg = (e as Error).message
    await admin.from('xero_sync_log').update({
      finished_at: new Date().toISOString(),
      status: 'error', error_message: msg,
      records_created: created, records_updated: updated, records_failed: failed,
    }).eq('id', logRow!.id)
    await admin.from('xero_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: msg.slice(0, 500),
    }).eq('user_id', caller.id)
    return jsonError(500, msg)
  }
})
