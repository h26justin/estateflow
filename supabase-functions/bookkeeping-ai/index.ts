// AI bookkeeping — categorise a company's recent uncategorised bank
// transactions.
//
// Input: { company_id: string, limit?: number }
//
// Flow:
//   1. Authenticate caller, verify company access via has_company_access RPC.
//   2. Load the company's active txn_rules (priority order) and recent
//      bank_transactions that have no ai_category yet.
//   3. RULES PASS — for each txn, the first matching rule (lowest priority
//      number wins) sets ai_category + ai_category_confidence=1.0 and
//      optionally a property. These are APPLIED immediately (deterministic,
//      user-authored — not an AI guess).
//   4. AI PASS — the remaining unmatched txns are sent to Claude, which
//      DRAFTS a category + confidence + reasoning per txn. These are
//      RETURNED ONLY (never written) — the user accepts/rejects them in
//      the UI, at which point the client persists the chosen category.
//
// The AI never finalises: it drafts. Acceptance is a separate user action.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const MODEL_PRIMARY = 'claude-sonnet-4-5'

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

// Standard UK landlord bookkeeping categories — kept aligned with the
// receipt OCR taxonomy (extract-document) so manual + AI categories merge
// cleanly into MTD quarterly figures.
const CATEGORIES = [
  'rent_income', 'maintenance', 'utilities', 'insurance', 'mortgage_interest',
  'agent_fees', 'professional', 'cleaning', 'garden', 'compliance',
  'service_charge', 'ground_rent', 'travel', 'office', 'bank_charges',
  'other',
]

const PROMPT = `You are a UK landlord bookkeeping assistant. For each bank transaction below, suggest the single best accounting category.

Valid categories (use EXACTLY one of these strings):
${CATEGORIES.join(', ')}

Rules:
- A positive amount is usually income (often rent_income); a negative amount is an expense.
- Use the description and counterparty to decide. Mortgage payments → mortgage_interest. Council/water/energy → utilities. Letting agent → agent_fees. Accountant/solicitor → professional. Repairs/trades → maintenance.
- If genuinely unclear, use "other" with low confidence.
- confidence is a number 0..1 (your certainty).

Return ONLY a JSON array, one object per transaction in the SAME ORDER as given:
[{ "id": "<txn id>", "category": "<one valid category>", "confidence": 0.0, "reason": "<short why>" }]

No markdown fences, no prose. Transactions:`

async function callClaude(txns: any[]): Promise<any[]> {
  const lines = txns.map(t =>
    `id=${t.id} amount=${t.amount} ${t.currency || 'GBP'} counterparty="${t.counterparty || ''}" description="${t.description || ''}"`
  ).join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_PRIMARY,
      max_tokens: 2000,
      messages: [{ role: 'user', content: [{ type: 'text', text: `${PROMPT}\n${lines}` }] }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${MODEL_PRIMARY} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const text: string = data.content?.[0]?.text || ''
  const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try {
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// First active rule (lowest priority number) whose pattern is a
// case-insensitive substring of the chosen field wins.
function applyRules(txn: any, rules: any[]): any | null {
  for (const r of rules) {
    const field = r.match_field === 'counterparty' ? (txn.counterparty || '') : (txn.description || '')
    if (!r.match_pattern) continue
    if (field.toLowerCase().includes(String(r.match_pattern).toLowerCase())) {
      return r
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Verify the token explicitly (the pattern proven by lodgify-sync et al —
  // no-arg getUser() on a session-less server client is unreliable).
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  // Caller-scoped client for the access check (respects the caller's JWT).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const body = await req.json()
    const companyId: string | undefined = body.company_id
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 200)
    if (!companyId) throw new Error('company_id required')

    // Server-side access check via RPC (caller-scoped client).
    const { data: hasAccess } = await userClient.rpc('has_company_access', {
      p_company_id: companyId,
    })
    if (hasAccess !== true) return jsonError(403, 'Forbidden')

    // Accounts belonging to this company.
    const { data: accounts } = await admin
      .from('bank_accounts')
      .select('id')
      .eq('company_id', companyId)
    const accountIds = (accounts || []).map(a => a.id)
    if (accountIds.length === 0) {
      return new Response(JSON.stringify({ applied: [], suggestions: [], note: 'No bank accounts linked to this company.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Active rules, priority ascending (lowest number = highest precedence).
    const { data: rules } = await admin
      .from('txn_rules')
      .select('id, match_field, match_pattern, set_category, set_property_id, priority')
      .eq('company_id', companyId)
      .eq('active', true)
      .order('priority', { ascending: true })

    // Uncategorised transactions for this company's accounts.
    const { data: txns } = await admin
      .from('bank_transactions')
      .select('id, posted_at, amount, currency, description, counterparty')
      .in('account_id', accountIds)
      .is('ai_category', null)
      .order('posted_at', { ascending: false })
      .limit(limit)

    const all = txns || []

    // ── RULES PASS — deterministic, applied immediately. ──────────────
    const applied: any[] = []
    const remainder: any[] = []
    for (const t of all) {
      const rule = applyRules(t, rules || [])
      if (rule) {
        const update: Record<string, any> = {
          ai_category: rule.set_category,
          ai_category_confidence: 1.0,
        }
        await admin.from('bank_transactions').update(update).eq('id', t.id)
        applied.push({
          id: t.id,
          category: rule.set_category,
          set_property_id: rule.set_property_id || null,
          rule_id: rule.id,
        })
      } else {
        remainder.push(t)
      }
    }

    // ── AI PASS — DRAFT only, never written. ──────────────────────────
    let suggestions: any[] = []
    let aiAvailable = false
    if (remainder.length > 0 && ANTHROPIC_API_KEY) {
      aiAvailable = true
      const raw = await callClaude(remainder)
      const byId = new Map(remainder.map(t => [t.id, t]))
      suggestions = raw
        .filter(s => s && byId.has(s.id))
        .map(s => ({
          id: s.id,
          category: CATEGORIES.includes(s.category) ? s.category : 'other',
          confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0.5,
          reason: typeof s.reason === 'string' ? s.reason.slice(0, 200) : '',
          amount: byId.get(s.id).amount,
          description: byId.get(s.id).description,
          counterparty: byId.get(s.id).counterparty,
          posted_at: byId.get(s.id).posted_at,
        }))
    }

    return new Response(JSON.stringify({
      applied,
      suggestions,
      ai_available: aiAvailable,
      disclaimer: 'AI-generated suggestions — review before accepting. Categories are drafts until you accept them.',
      note: !ANTHROPIC_API_KEY && remainder.length > 0
        ? 'Configure ANTHROPIC_API_KEY to enable AI suggestions; rules were still applied.'
        : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
