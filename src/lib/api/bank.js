// Open Banking — Plaid UK Data API integration.
//
// Switched from TrueLayer in May 2026. TrueLayer rejected our application
// over portfolio docs; Plaid offers Sandbox same-day signup and a cleaner
// hosted-widget UX. The bank-truelayer edge function stays in the repo
// as deprecated reference until any TrueLayer pilot accounts are migrated.
//
// Plaid flow differs from TrueLayer's redirect approach:
//   1. createPlaidLinkToken() → backend returns a short-lived link_token
//   2. Browser lazy-loads Plaid Link.js, opens the widget with that token
//   3. User picks bank + signs in inside the widget
//   4. Widget hands back a public_token via JS callback
//   5. exchangePlaidPublicToken(public_token) → backend swaps for an
//      access_token and writes bank_connections + bank_accounts rows
//
// Until the Supabase secrets are set (PLAID_CLIENT_ID + PLAID_SECRET +
// PLAID_ENV), the bank-plaid function returns 503 and the UI falls back
// to "register interest".

import { supabase } from '../supabase'

const FUNCTION = 'bank-plaid'

async function invoke(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke(FUNCTION, {
    body: { action, ...payload },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    let msg = error.message || 'Bank feed request failed'
    try {
      const ctxBody = await error.context?.json?.()
      if (ctxBody?.error) msg = ctxBody.error
    } catch { /* ignore */ }
    const e = new Error(msg)
    e.cause = error
    throw e
  }
  return data
}

// ── Connections ────────────────────────────────────────────────────────
export async function fetchBankConnections() {
  const { data, error } = await supabase
    .from('bank_connections')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function deleteBankConnection(id) {
  const { error } = await supabase.from('bank_connections').delete().eq('id', id)
  if (error) throw error
}

// Legacy: pre-partnership interest form. Kept as a fallback if the live
// integration is unreachable (503 from listInstitutions).
export async function registerBankInterest(provider = 'pending-partner', institutionName = '') {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('bank_connections')
    .insert({
      user_id: userId,
      provider,
      institution_name: institutionName || null,
      status: 'requested',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Plaid flow ─────────────────────────────────────────────────────────

// No-op success when creds are set; 503 when not. UI uses this to decide
// whether to show "live" mode (Plaid Link widget) or "interest" mode.
export async function listBankInstitutions(_country = 'gb') {
  return invoke('list_institutions')
}

// New: replaces startBankConnect for Plaid Link flow. Returns a link_token
// that the frontend feeds to Plaid Link.js.
export async function createPlaidLinkToken() {
  return invoke('create_link_token')
}

// Exchange the public_token returned by Plaid Link for a stored access_token.
// Returns { connection_id, accounts }.
export async function exchangePlaidPublicToken(publicToken, institutionId = null, institutionName = null) {
  return invoke('exchange_public_token', {
    public_token: publicToken,
    institution_id: institutionId,
    institution_name: institutionName,
  })
}

// LEGACY shim — kept so callers that still reference startBankConnect
// degrade gracefully (will throw a clear error). Once BankConnectionsModal
// is on Plaid, remove this.
export async function startBankConnect() {
  throw new Error('startBankConnect() is deprecated — switch to createPlaidLinkToken() + Plaid Link widget.')
}

// LEGACY shim — same reason.
export async function finalizeBankConnect() {
  throw new Error('finalizeBankConnect() is deprecated — Plaid Link returns public_token directly to the browser; use exchangePlaidPublicToken().')
}

// Pulls fresh transactions for all active accounts; auto-matches what it can.
export async function syncBankTransactions() {
  return invoke('sync')
}

// ── Transactions ────────────────────────────────────────────────────────
export async function fetchBankTransactions({ limit = 200, unmatchedOnly = false } = {}) {
  let q = supabase
    .from('bank_transactions')
    .select(`
      id, posted_at, amount, currency, description, counterparty,
      matched_rent_payment_id, matched_at, match_confidence,
      account:bank_accounts(id, display_name, account_number_last4),
      rent_payment:rent_payments!matched_rent_payment_id(id, year, month, month_label, property_id, property:properties(address))
    `)
    .order('posted_at', { ascending: false })
    .limit(limit)
  if (unmatchedOnly) q = q.is('matched_rent_payment_id', null)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Manual click-to-match: link a bank_transaction to a rent_payment.
// Also flips the rent_payment row to paid with the bank amount.
export async function matchTransactionToRentPayment(transactionId, rentPaymentId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data: tx, error: tErr } = await supabase
    .from('bank_transactions').select('amount, counterparty')
    .eq('id', transactionId).eq('user_id', userId).single()
  if (tErr) throw tErr
  const { error: uErr } = await supabase.from('bank_transactions')
    .update({
      matched_rent_payment_id: rentPaymentId,
      matched_at: new Date().toISOString(),
      match_confidence: 1.0, // manual = certain
    })
    .eq('id', transactionId).eq('user_id', userId)
  if (uErr) throw uErr
  const { error: rErr } = await supabase.from('rent_payments')
    .update({
      status: 'paid',
      amount: tx.amount,
      notes: `Matched from bank · ${tx.counterparty || ''}`.trim(),
    })
    .eq('id', rentPaymentId).eq('user_id', userId)
  if (rErr) throw rErr
}

export async function unmatchTransaction(transactionId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data: tx } = await supabase.from('bank_transactions')
    .select('matched_rent_payment_id').eq('id', transactionId).eq('user_id', userId).single()
  await supabase.from('bank_transactions')
    .update({ matched_rent_payment_id: null, matched_at: null, match_confidence: null })
    .eq('id', transactionId).eq('user_id', userId)
  if (tx?.matched_rent_payment_id) {
    await supabase.from('rent_payments')
      .update({ status: 'void' })
      .eq('id', tx.matched_rent_payment_id).eq('user_id', userId)
  }
}
