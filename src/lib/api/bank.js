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
// partner_data holds the Plaid / TrueLayer tokens and is not readable by the
// browser (2026-10-14_integration_token_column_grants.sql) — never select '*'.
export const BANK_CONNECTION_SAFE_COLS = 'id, user_id, provider, provider_consent_id, institution_id, institution_name, status, last_synced_at, created_at, updated_at'

export async function fetchBankConnections() {
  const { data, error } = await supabase
    .from('bank_connections')
    .select(BANK_CONNECTION_SAFE_COLS)
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
    .select(BANK_CONNECTION_SAFE_COLS)
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

// ── Manual match / unmatch ──────────────────────────────────────────────
// The rent row's `notes` gets one line per bank match so unmatch can find
// and remove exactly what match wrote. The line ends with a machine-readable
// marker recording what the match changed, so unmatch is its exact inverse:
//   Matched from bank · J Smith [bm tx=<id> mode=add|set|link prev=<status> amt=<amount before> d=<amount added>]
const MATCH_NOTE_PREFIX = 'Matched from bank'
const matchNote = (tx) => `${MATCH_NOTE_PREFIX} · ${tx.counterparty || ''}`.trim()
const round2 = (n) => Math.round(n * 100) / 100
const MARKER_RE = /\s*\[bm ([^\]]*)\]$/
// Statuses that mean money is already recorded as received on the row.
const MONEY_STATUSES = new Set(['paid', 'partial', 'late'])
// Statuses that mean the FULL rent is already recorded as received.
const SETTLED_STATUSES = new Set(['paid', 'late'])

function parseMarker(line) {
  const m = MARKER_RE.exec(line)
  if (!m) return null
  const out = {}
  for (const part of m[1].split(' ')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1))
  }
  return out
}

// What a match writes to the rent row. Three cases, by the row's status:
//   link — paid/late and the row already records at least the bank amount
//          (within 50p): this bank line is evidence of that same payment, so
//          only the note is added; status and amount are left alone.
//   add  — paid/partial/late (money already received): the bank amount is
//          added to what is recorded, and the row becomes paid.
//   set  — any other status (void/overdue/pending/…): an amount on such a
//          row is not money received (an old unmatch or status toggle left
//          it), so the amount is SET to the bank amount, not added to.
// Existing notes are kept; the match line is appended. Pure.
export function planBankMatch(rentRow, tx) {
  const status = rentRow?.status || null
  const before = rentRow?.amount == null || rentRow?.amount === '' ? null : Number(rentRow.amount)
  const existing = Number(before) || 0
  const txAmount = round2(Number(tx?.amount) || 0)
  let mode, patch
  if (SETTLED_STATUSES.has(status) && existing >= txAmount - 0.5) {
    mode = 'link'; patch = {}
  } else if (MONEY_STATUSES.has(status)) {
    mode = 'add'; patch = { status: 'paid', amount: round2(existing + txAmount) }
  } else {
    mode = 'set'; patch = { status: 'paid', amount: txAmount }
  }
  const marker = [
    'bm',
    tx?.id ? `tx=${encodeURIComponent(tx.id)}` : null,
    `mode=${mode}`,
    `prev=${encodeURIComponent(status || '')}`,
    `amt=${before == null || Number.isNaN(before) ? '' : round2(before)}`,
    `d=${mode === 'link' ? 0 : txAmount}`,
  ].filter(Boolean).join(' ')
  const notes = [rentRow?.notes, `${matchNote(tx)} [${marker}]`].filter(Boolean).join('\n')
  return { ...patch, notes }
}

// What an unmatch writes back: the exact inverse of what planBankMatch did,
// read from the marker on its note line (found by transaction id, else the
// last line for this counterparty).
//   link — only the note line goes.
//   add  — the bank amount comes back off and the prior status returns.
//   set  — the prior status and prior amount return. If another bank match
//          still sits on the row, only this transaction's amount comes off
//          and the status stays (that other money is still received).
// A line written before markers existed falls back to: take the bank amount
// off; if money remains the status is left alone, else the row returns to an
// empty 'void' slot. Pure.
export function planBankUnmatch(rentRow, tx) {
  const base = matchNote(tx)
  const lines = String(rentRow?.notes || '').split('\n')
  const isOurs = (l) => l === base || (l.startsWith(base + ' [bm ') && MARKER_RE.test(l))
  const lastIndex = (pred) => { for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i])) return i; return -1 }
  let idx = -1
  if (tx?.id) idx = lastIndex(l => isOurs(l) && parseMarker(l)?.tx === String(tx.id))
  if (idx < 0) idx = lastIndex(isOurs)
  const marker = idx >= 0 ? parseMarker(lines[idx]) : null
  if (idx >= 0) lines.splice(idx, 1)
  const notes = lines.filter(Boolean).join('\n') || null
  const current = Number(rentRow?.amount) || 0
  const txAmount = round2(Number(tx?.amount) || 0)

  if (marker?.mode === 'link') return { notes }
  if (marker?.mode === 'add' || marker?.mode === 'set') {
    const delta = Number(marker.d)
    const d = Number.isFinite(delta) ? delta : txAmount
    const prev = marker.prev || null
    const prevAmount = marker.amt === '' || marker.amt == null ? null : Number(marker.amt)
    if (marker.mode === 'add') {
      const left = round2(current - d)
      return { status: prev || 'paid', amount: left === 0 && prevAmount == null ? null : left, notes }
    }
    const otherMatch = lines.some(l => l.startsWith(MATCH_NOTE_PREFIX + ' ·') && MARKER_RE.test(l))
    if (otherMatch) return { amount: round2(current - d), notes }
    return { status: prev || 'void', amount: prevAmount, notes }
  }
  const remaining = round2(current - txAmount)
  if (remaining > 0) return { amount: remaining, notes }
  return { status: 'void', amount: null, notes }
}

// Manual click-to-match: link a bank_transaction to a rent_payment and
// record the bank amount on the rent row. The rent row is scoped by RLS, not
// by creator: a team-mate's match used to update 0 rows (`.eq('user_id')`)
// and still report "Matched.". Exactly one row must change, or it throws.
export async function matchTransactionToRentPayment(transactionId, rentPaymentId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data: tx, error: tErr } = await supabase
    .from('bank_transactions').select('amount, counterparty, matched_rent_payment_id')
    .eq('id', transactionId).eq('user_id', userId).single()
  if (tErr) throw tErr
  if (tx.matched_rent_payment_id) throw new Error('This transaction is already matched — unmatch it first')
  const { data: rent, error: rgErr } = await supabase.from('rent_payments')
    .select('id, status, amount, notes').eq('id', rentPaymentId).maybeSingle()
  if (rgErr) throw rgErr
  if (!rent) throw new Error('Rent record not found, or you do not have access to it')
  const { data: txRows, error: uErr } = await supabase.from('bank_transactions')
    .update({
      matched_rent_payment_id: rentPaymentId,
      matched_at: new Date().toISOString(),
      match_confidence: 1.0, // manual = certain
    })
    .eq('id', transactionId).eq('user_id', userId)
    .select('id')
  if (uErr) throw uErr
  if (!txRows || txRows.length !== 1) throw new Error('Transaction not matched — it may have been removed')
  const { data: rentRows, error: rErr } = await supabase.from('rent_payments')
    .update(planBankMatch(rent, { ...tx, id: transactionId }))
    .eq('id', rentPaymentId)
    .select('id')
  if (rErr || !rentRows || rentRows.length !== 1) {
    // Don't leave the transaction pointing at a rent row we failed to update.
    await supabase.from('bank_transactions')
      .update({ matched_rent_payment_id: null, matched_at: null, match_confidence: null })
      .eq('id', transactionId).eq('user_id', userId)
    if (rErr) throw rErr
    throw new Error('Rent record not updated — you may not have permission to edit rent on this property')
  }
}

export async function unmatchTransaction(transactionId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data: tx, error: tErr } = await supabase.from('bank_transactions')
    .select('amount, counterparty, matched_rent_payment_id').eq('id', transactionId).eq('user_id', userId).single()
  if (tErr) throw tErr
  let rent = null
  if (tx?.matched_rent_payment_id) {
    const { data, error } = await supabase.from('rent_payments')
      .select('id, status, amount, notes').eq('id', tx.matched_rent_payment_id).maybeSingle()
    if (error) throw error
    rent = data
  }
  const { data: txRows, error: uErr } = await supabase.from('bank_transactions')
    .update({ matched_rent_payment_id: null, matched_at: null, match_confidence: null })
    .eq('id', transactionId).eq('user_id', userId)
    .select('id')
  if (uErr) throw uErr
  if (!txRows || txRows.length !== 1) throw new Error('Transaction not unmatched — it may have been removed')
  if (rent) {
    const { data: rentRows, error: rErr } = await supabase.from('rent_payments')
      .update(planBankUnmatch(rent, { ...tx, id: transactionId }))
      .eq('id', rent.id)
      .select('id')
    if (rErr) throw rErr
    if (!rentRows || rentRows.length !== 1) throw new Error('Unmatched, but the rent record could not be updated — check it on the Rent tab')
  }
}
