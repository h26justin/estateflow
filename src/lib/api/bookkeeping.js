// AI bookkeeping rules — list/manage txn_rules, run categorisation, and
// accept/reject AI category suggestions.
//
// Rules are deterministic and applied server-side immediately. AI
// suggestions are DRAFTS: the bookkeeping-ai function returns them, the
// user reviews them here, and only an explicit accept persists the
// category onto the bank_transactions row.

import { supabase } from '../supabase'

const FUNCTION = 'bookkeeping-ai'

// Standard UK landlord bookkeeping categories (kept aligned with the edge
// function + receipt OCR taxonomy so manual + AI categories merge cleanly).
export const BOOKKEEPING_CATEGORIES = [
  'rent_income', 'maintenance', 'utilities', 'insurance', 'mortgage_interest',
  'agent_fees', 'professional', 'cleaning', 'garden', 'compliance',
  'service_charge', 'ground_rent', 'travel', 'office', 'bank_charges',
  'other',
]

// ── Rules ─────────────────────────────────────────────────────────────────
export async function listRules(companyId) {
  let q = supabase
    .from('txn_rules')
    .select('id, company_id, match_field, match_pattern, set_category, set_property_id, priority, active, created_at')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createRule({ companyId, matchField = 'description', matchPattern, setCategory, setPropertyId = null, priority = 100, active = true }) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('txn_rules')
    .insert({
      company_id: companyId,
      user_id: userId,
      match_field: matchField,
      match_pattern: matchPattern,
      set_category: setCategory,
      set_property_id: setPropertyId,
      priority,
      active,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRule(id, patch) {
  const { data, error } = await supabase
    .from('txn_rules')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRule(id) {
  const { error } = await supabase.from('txn_rules').delete().eq('id', id)
  if (error) throw error
}

// ── Categorisation run ──────────────────────────────────────────────────
// Applies rules server-side (immediately) and returns AI DRAFT suggestions
// for the remainder. Shape: { applied, suggestions, ai_available, disclaimer }.
export async function runCategorisation(companyId, { limit = 50 } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke(FUNCTION, {
    body: { company_id: companyId, limit },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    let msg = error.message || 'Categorisation failed'
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

// ── Accept / reject AI suggestions ──────────────────────────────────────
// Accepting persists the drafted category onto the transaction. Confidence
// stored as the AI's estimate so the UI can still flag low-confidence rows.
export async function acceptSuggestion(transactionId, category, confidence = null) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('bank_transactions')
    .update({
      ai_category: category,
      ai_category_confidence: confidence == null ? 0.5 : confidence,
    })
    .eq('id', transactionId)
    .eq('user_id', userId)
  if (error) throw error
}

// Rejecting simply discards the draft client-side — nothing is written.
// Provided as a no-op API so callers have a symmetric verb and we can
// later record rejections for rule-learning without changing call sites.
export async function rejectSuggestion(_transactionId) {
  return true
}

// ── MTD-ready quarterly figures ─────────────────────────────────────────
// Sums categorised transactions per category for a date window so the
// MTD ITSA page / bank inbox can show quarter-to-date income vs expenses.
export async function quarterlyFigures(companyId, { from, to } = {}) {
  const { data: accounts, error: aErr } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('company_id', companyId)
  if (aErr) throw aErr
  const accountIds = (accounts || []).map(a => a.id)
  if (accountIds.length === 0) return { byCategory: {}, income: 0, expenses: 0 }

  let q = supabase
    .from('bank_transactions')
    .select('amount, ai_category')
    .in('account_id', accountIds)
    .not('ai_category', 'is', null)
  if (from) q = q.gte('posted_at', from)
  if (to) q = q.lte('posted_at', to)
  const { data, error } = await q
  if (error) throw error

  const byCategory = {}
  let income = 0
  let expenses = 0
  for (const t of data || []) {
    const cat = t.ai_category || 'other'
    const amt = Number(t.amount) || 0
    byCategory[cat] = (byCategory[cat] || 0) + amt
    if (amt >= 0) income += amt
    else expenses += amt
  }
  return { byCategory, income, expenses }
}
