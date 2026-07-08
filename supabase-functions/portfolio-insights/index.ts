// Portfolio insights generator.
//
// Triggered on-demand from the dashboard widget. Loads a summary of the
// caller's portfolio (properties, compliance, deals, insurance) and asks
// Claude to identify actionable observations. Stores the result in
// portfolio_insights for the widget to read; the widget polls the cached
// row rather than calling this function on every load.
//
// POST (no body required). Caller's JWT identifies the user.
// Response: { id, insights, stats, generated_at } (the row that was stored).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Don't allow the same user to regenerate insights more than once every
// REGEN_COOLDOWN_MIN minutes. Each call costs a few cents in Claude tokens;
// this caps the damage from runaway clients or curious users.
const REGEN_COOLDOWN_MIN = 30

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Builds the data summary that gets sent to Claude. We deliberately send
// summary-level data only — no tenant PII, no document text, just numbers
// and headline labels. Keeps the prompt cheap and the privacy surface small.
function buildPortfolioSummary(data: any) {
  const props = data.properties || []
  const compliance = data.compliance || []
  const insurance = data.insurance || []
  const deals = data.deals || []
  const rentPayments = data.rentPayments || []

  const num = (v: any) => Number(v) || 0
  const active = props.filter((p: any) => p.status !== 'sold' && !p.deleted_at)

  // Per-property summary kept short — name, type, key money fields, yield
  const propLines = active.map((p: any) => {
    const baseCost = num(p.purchase_price) + num(p.refurb_cost)
    const grossYield = baseCost > 0 && num(p.rent_pcm) > 0
      ? ((num(p.rent_pcm) * 12) / baseCost * 100).toFixed(1)
      : 'n/a'
    return `${p.name || p.address || 'Unnamed'} (${p.prop_type || 'unknown type'}, status: ${p.status}) — `
      + `purchase £${num(p.purchase_price).toLocaleString()}, `
      + `value £${num(p.current_value || p.est_value).toLocaleString()}, `
      + `rent £${num(p.rent_pcm).toLocaleString()}/mo, `
      + `mortgage £${num(p.mortgage_amount).toLocaleString()} @ ${(num(p.mortgage_rate) * 100).toFixed(2)}%, `
      + `arrears £${num(p.arrears).toLocaleString()}, `
      + `gross yield ${grossYield}%`
  }).join('\n')

  // Compliance items with days-to-expiry
  const now = new Date()
  const compLines = compliance
    .filter((c: any) => !c.deleted_at && c.expiry_date)
    .map((c: any) => {
      const days = Math.floor((new Date(c.expiry_date).getTime() - now.getTime()) / 86_400_000)
      return `${c.cert_type} for property ${c.property_id} — ${days < 0 ? `EXPIRED ${Math.abs(days)}d ago` : `expires in ${days}d`}`
    })
    .filter(Boolean)
    .join('\n')

  const insLines = insurance
    .filter((i: any) => !i.deleted_at)
    .map((i: any) => `${i.policy_type || 'policy'} with ${i.provider || 'unknown insurer'} — £${num(i.premium).toLocaleString()}/yr, expires ${i.expiry_date || 'unknown'}`)
    .join('\n')

  const dealLines = deals
    .filter((d: any) => !d.deleted_at && d.status !== 'dead' && d.status !== 'completed')
    .map((d: any) => `${d.name || d.address || 'Deal'} (${d.status}, ${d.purchase_type || 'mortgage'}) — purchase £${num(d.purchase_price).toLocaleString()}, refurb £${num(d.refurb_cost).toLocaleString()}, est rent £${num(d.monthly_rent).toLocaleString()}/mo`)
    .join('\n')

  // Aggregate stats — these also get returned to the client for the widget
  // to display "context" alongside each insight.
  const totalValue = active.reduce((s: number, p: any) => s + num(p.current_value || p.est_value), 0)
  const totalMortgage = active.reduce((s: number, p: any) => s + num(p.mortgage_amount), 0)
  const totalRent = active.reduce((s: number, p: any) => s + num(p.rent_pcm), 0)
  const totalArrears = active.reduce((s: number, p: any) => s + num(p.arrears), 0)
  const rented = active.filter((p: any) => p.status === 'rented' || p.status === 'notice_given').length
  const occupancy = active.length > 0 ? Math.round(rented / active.length * 100) : 0
  const equity = totalValue - totalMortgage
  const ltv = totalValue > 0 ? Math.round(totalMortgage / totalValue * 100) : 0
  const baseCost = active.reduce((s: number, p: any) => s + num(p.purchase_price) + num(p.refurb_cost), 0)
  const portfolioYield = baseCost > 0 ? Number(((totalRent * 12) / baseCost * 100).toFixed(2)) : 0

  const stats = {
    property_count: active.length,
    total_value: totalValue,
    total_mortgage: totalMortgage,
    total_equity: equity,
    monthly_rent: totalRent,
    annual_rent: totalRent * 12,
    total_arrears: totalArrears,
    occupancy_percent: occupancy,
    ltv_percent: ltv,
    gross_yield_percent: portfolioYield,
  }

  const summary = `
PORTFOLIO OVERVIEW
${active.length} active properties · £${totalValue.toLocaleString()} total value · £${totalMortgage.toLocaleString()} mortgage · ${ltv}% LTV
£${totalRent.toLocaleString()}/mo rent · £${totalArrears.toLocaleString()} arrears · ${occupancy}% occupancy · ${portfolioYield}% gross yield

PROPERTIES
${propLines || '(none)'}

COMPLIANCE
${compLines || '(none recorded)'}

INSURANCE
${insLines || '(none recorded)'}

ACTIVE DEALS
${dealLines || '(none in progress)'}
`.trim()

  return { summary, stats }
}

const SYSTEM_PROMPT = `You are an analyst reviewing a UK landlord's property portfolio. Identify 4-7 SPECIFIC, ACTIONABLE observations. Return ONLY valid JSON.

Output schema (return EXACTLY this shape, no markdown, no explanation):
{
  "insights": [
    {
      "category": "yield" | "rent" | "compliance" | "expenses" | "arrears" | "opportunity" | "risk",
      "severity": "info" | "opportunity" | "warning" | "critical",
      "title": "string (under 80 chars)",
      "body": "string (1-2 sentences explaining the observation and what to do)",
      "action_label": "string|null (short CTA, e.g. 'Review tenancy')",
      "action_link": "string|null (hash route, e.g. '#/properties' or '#/detail/<id>/compliance')"
    }
  ]
}

Rules:
- Each insight must be specific (mention a property name, certificate type, percentage, or amount).
- Avoid generic advice that applies to every landlord.
- Prefer observations grounded in the data above bland tips.
- Use UK terminology (HMO, BTL, EPC, EICR, gas safe, S21, S24).
- "critical" = imminent legal/financial risk; "warning" = should look at soon; "opportunity" = positive but worth acting on; "info" = noteworthy context.
- Sort highest severity first.
- Maximum 7 insights.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authenticate
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  try {
    // Rate-limit per user
    const { data: latest } = await admin
      .from('portfolio_insights')
      .select('id, generated_at')
      .eq('user_id', caller.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest?.generated_at) {
      const ageMin = (Date.now() - new Date(latest.generated_at).getTime()) / 60_000
      if (ageMin < REGEN_COOLDOWN_MIN) {
        const wait = Math.ceil(REGEN_COOLDOWN_MIN - ageMin)
        return jsonError(429, `Insights were generated recently. Try again in ~${wait} minute(s).`)
      }
    }

    // Pull the data we need. All server-side, scoped to the caller.
    const [propsRes, complianceRes, insuranceRes, dealsRes] = await Promise.all([
      admin.from('properties').select('id, name, address, prop_type, status, purchase_price, refurb_cost, current_value, est_value, rent_pcm, mortgage_amount, mortgage_rate, arrears, deleted_at').eq('user_id', caller.id),
      admin.from('compliance_items').select('id, cert_type, expiry_date, property_id, deleted_at').eq('user_id', caller.id),
      admin.from('insurance_policies').select('id, policy_type, provider, premium, expiry_date, deleted_at').eq('user_id', caller.id).then((r: any) => r),
      // deals has no estimated_rent column (it's monthly_rent) — selecting it
      // errored the query and silently blanked deals out of the AI insights.
      admin.from('deals').select('id, name, address, status, purchase_type, purchase_price, refurb_cost, monthly_rent, deleted_at').eq('user_id', caller.id).then((r: any) => r),
    ])

    const data = {
      properties: propsRes.data || [],
      compliance: complianceRes.data || [],
      insurance: insuranceRes.data || [],
      deals: dealsRes.data || [],
    }

    if ((data.properties as any[]).filter((p: any) => !p.deleted_at).length === 0) {
      return jsonError(400, 'Add at least one property before generating insights.')
    }

    const { summary, stats } = buildPortfolioSummary(data)

    // Call Claude. Haiku-4.5 is plenty for this — it's pattern-spotting on a
    // small structured summary, not deep reasoning. Cheap + fast.
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: summary }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error(`Anthropic API error (${anthropicRes.status}): ${errText.slice(0, 300)}`)
    }

    const anthropicData = await anthropicRes.json()
    const textResponse = anthropicData.content?.[0]?.text || ''
    const tokensIn = anthropicData.usage?.input_tokens || null
    const tokensOut = anthropicData.usage?.output_tokens || null

    // Parse Claude's JSON. Strip ```json fences just in case.
    let parsed: any
    try {
      const clean = textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      parsed = JSON.parse(clean)
    } catch (_) {
      throw new Error('AI returned a response that could not be parsed.')
    }

    const insights = Array.isArray(parsed?.insights) ? parsed.insights : []
    if (insights.length === 0) {
      throw new Error('AI did not return any insights.')
    }

    // Persist
    const { data: row, error: insErr } = await admin
      .from('portfolio_insights')
      .insert({
        user_id: caller.id,
        insights,
        stats,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
      })
      .select('id, insights, stats, generated_at, tokens_input, tokens_output')
      .single()
    if (insErr) throw insErr

    return new Response(JSON.stringify(row), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
