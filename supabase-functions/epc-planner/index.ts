// EPC C retrofit planner — Claude-powered guidance (Feature 10, flag: epc_planner).
//
// Input:  { property_id: string, current_rating?: "A".."G", property_type?: string,
//           region?: string, floor_area_sqm?: number, save?: boolean }
// Output: { current_rating, target_rating: "C", measures: [...], est_total_cost,
//           deadline: "2030-12-31", source: "epc_register"|"manual"|"unknown",
//           disclaimer, saved_id?: string }
//
// Flow:
//   1. Authenticate caller (JWT) and confirm write access to the property via
//      the has_property_permission RPC (a viewer can read but not generate/save).
//   2. Prefer the property's register-synced rating (properties.epc_rating,
//      populated by the epc-sync edge function from the official register).
//      Falls back to the caller-supplied manual current_rating when absent.
//   3. Ask Claude for a prioritised retrofit plan (measures, rough costs,
//      expected SAP uplift) to reach the target rating. AI DRAFTS guidance only.
//   4. Optionally persist the result to epc_assessments (save:true) using a
//      service-role client; RLS already gates this but we re-check write access
//      server-side so an unsaved generate is also access-controlled.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Reuse the same model constants as extract-document for consistency.
const MODEL_PRIMARY  = 'claude-sonnet-4-5'
const MODEL_FALLBACK = 'claude-opus-4-7'

const TARGET_RATING = 'C'
const DEADLINE      = '2030-12-31'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(status: number, message: string) {
  return json(status, { error: message })
}

const RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

function normaliseRating(r: unknown): string | null {
  if (typeof r !== 'string') return null
  const up = r.trim().toUpperCase()
  return RATINGS.includes(up) ? up : null
}

function buildPrompt(rating: string | null, propertyType: string, region: string, floorArea: number | null): string {
  return `You are a UK domestic energy-efficiency adviser. A landlord needs to bring a rental property up to EPC band ${TARGET_RATING} to meet the proposed 2030 Minimum Energy Efficiency Standard (MEES) for the private rented sector.

Property details:
- Current EPC rating: ${rating || 'unknown (assume band D/E typical of UK rental stock)'}
- Property type: ${propertyType || 'unknown'}
- Region: ${region || 'unknown (UK)'}
- Floor area: ${floorArea ? floorArea + ' sqm' : 'unknown'}

Produce a PRIORITISED retrofit plan: the cheapest, most cost-effective route to reach band ${TARGET_RATING}. Order measures by best SAP-uplift-per-pound first ("fabric first"). Use realistic UK installed-cost ranges (2026 money). Be conservative — these are rough planning estimates, not quotes.

Return ONLY a single JSON object, no markdown fences, with this shape:
{
  "assumed_current_rating": "A|B|C|D|E|F|G",
  "measures": [
    {
      "name": "string (e.g. Loft insulation top-up to 270mm)",
      "category": "insulation|heating|glazing|renewables|controls|ventilation|other",
      "rough_cost_gbp": number,
      "expected_sap_uplift": number,
      "priority": 1,
      "notes": "string (one short sentence — why / caveats)"
    }
  ],
  "est_total_cost_gbp": number,
  "projected_rating_after": "A|B|C|D|E|F|G",
  "summary": "string (2-3 sentences on the recommended route)"
}

Rules:
- Include only measures actually needed to reach band ${TARGET_RATING}; stop once the projected band reaches ${TARGET_RATING}.
- "priority" is 1-based, 1 = do first.
- "est_total_cost_gbp" must equal the sum of the measures' rough_cost_gbp.
- All costs are GBP integers, no currency symbol.`
}

async function callClaude(model: string, prompt: string): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${model} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const textResponse: string = data.content?.[0]?.text || ''
  const clean = textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch (e) {
    return { _parse_error: (e as Error).message, _raw_response: textResponse }
  }
}

function needsFallback(plan: any): boolean {
  if (!plan || plan._parse_error) return true
  if (!Array.isArray(plan.measures) || plan.measures.length === 0) return true
  return false
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed')

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonError(401, 'Missing Authorization header')

  // Caller-scoped client: verifies the JWT AND lets us run access-check RPCs
  // as the caller (has_property_permission reads auth.uid()).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const body = await req.json().catch(() => ({}))
    const propertyId: string | undefined = body.property_id
    if (!propertyId) return jsonError(400, 'property_id required')

    // Server-side access check (RLS-independent gate for the generate path).
    const { data: canWrite, error: permErr } = await userClient
      .rpc('has_property_permission', { p_property_id: propertyId, p_action: 'write' })
    if (permErr) throw new Error('Access check failed: ' + permErr.message)
    if (canWrite !== true) return jsonError(403, 'Forbidden')

    // Load the property for rating context (service role; access already
    // checked). epc_rating is the register-synced band written by epc-sync.
    const { data: prop } = await admin
      .from('properties')
      .select('id, company_id, address, epc_rating')
      .eq('id', propertyId)
      .single()

    const manualRating = normaliseRating(body.current_rating)
    const propertyType: string = body.property_type || ''
    const region: string = body.region || ''
    const floorArea: number | null =
      typeof body.floor_area_sqm === 'number' ? body.floor_area_sqm : null

    // Register-synced rating wins; transparently falls back to the manual one.
    let source: 'epc_register' | 'manual' | 'unknown' = manualRating ? 'manual' : 'unknown'
    let currentRating = manualRating
    const registerRating = normaliseRating(prop?.epc_rating)
    if (registerRating) {
      currentRating = registerRating
      source = 'epc_register'
    }

    // Ask Claude for the prioritised plan; fall back to Opus on a poor first pass.
    const prompt = buildPrompt(currentRating, propertyType, region, floorArea)
    let plan = await callClaude(MODEL_PRIMARY, prompt)
    let modelUsed = MODEL_PRIMARY
    if (needsFallback(plan)) {
      plan = await callClaude(MODEL_FALLBACK, prompt)
      modelUsed = MODEL_FALLBACK
    }
    if (needsFallback(plan)) {
      return jsonError(502, 'AI could not produce a retrofit plan. Please try again.')
    }

    const measures = Array.isArray(plan.measures) ? plan.measures : []
    // Trust the AI sum but recompute defensively from the measures.
    const computedTotal = measures.reduce(
      (s: number, m: any) => s + (Number(m?.rough_cost_gbp) || 0), 0,
    )
    const estTotal = Number.isFinite(plan.est_total_cost_gbp) ? plan.est_total_cost_gbp : computedTotal
    const effectiveCurrent = currentRating || normaliseRating(plan.assumed_current_rating)

    const result: Record<string, unknown> = {
      property_id: propertyId,
      current_rating: effectiveCurrent,
      target_rating: TARGET_RATING,
      deadline: DEADLINE,
      measures,
      est_total_cost: estTotal,
      projected_rating_after: normaliseRating(plan.projected_rating_after) || TARGET_RATING,
      summary: typeof plan.summary === 'string' ? plan.summary : '',
      source,
      model_used: modelUsed,
      disclaimer: 'AI-generated planning guidance, not a survey or quote. Review with a qualified retrofit assessor before acting.',
    }

    // Optional persistence. RLS also enforces write+liveness, but we already
    // confirmed write access above, so this is the only insert path.
    if (body.save === true) {
      const { data: row, error: insErr } = await admin
        .from('epc_assessments')
        .insert({
          property_id: propertyId,
          company_id: prop?.company_id ?? null,
          user_id: caller.id,
          current_rating: effectiveCurrent,
          target_rating: TARGET_RATING,
          measures,
          est_total_cost: estTotal,
          deadline: DEADLINE,
        })
        .select('id')
        .single()
      if (insErr) throw new Error('Could not save plan: ' + insErr.message)
      result.saved_id = row?.id
    }

    return json(200, result)
  } catch (e) {
    return jsonError(500, (e as Error).message || 'Unexpected error')
  }
})
