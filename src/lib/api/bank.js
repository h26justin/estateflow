// Open Banking — TrueLayer Data API integration.
//
// Migrated from GoCardless Bank Account Data in May 2026 after GoCardless
// paused new BAD signups. Heavy lifting lives in the `bank-truelayer`
// edge function so credentials never touch the browser.
//
// Until the Supabase secrets are set (TRUELAYER_CLIENT_ID +
// TRUELAYER_CLIENT_SECRET), the function returns 503 and the UI falls
// back to "register interest".

import { supabase } from '../supabase'

async function invoke(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke('bank-truelayer', {
    body: { action, ...payload },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    // FunctionsHttpError has the body in `context`
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

// ── GoCardless flow ─────────────────────────────────────────────────────

// Returns { institutions: [{ id, name, logo, bic, transaction_total_days }] }
export async function listBankInstitutions(country = 'gb') {
  return invoke('list_institutions', { country })
}

// Pre-creates a pending connection row and returns the TrueLayer auth URL.
// The caller redirects the browser to auth_url — TrueLayer hosts the
// bank picker itself, so no institution params from us. Returns:
//   { auth_url, connection_id }
export async function startBankConnect() {
  return invoke('start_connect')
}

// Finalises a returning OAuth handoff. Pass through:
//   - connectionId: from the `state` query param (our row UUID)
//   - code:         from the `code` query param (TrueLayer auth code)
//   - error:        optional, from `error` query param if user denied
export async function finalizeBankConnect(connectionId, code, error = null) {
  return invoke('finalize', { connection_id: connectionId, code, error })
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
