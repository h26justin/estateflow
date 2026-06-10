// AI Maintenance Triage — Claude-powered repair triage.
//
// Input: { job_id: string }
//
// Flow:
//   1. Authenticate the caller (landlord, collaborator, or tenant who reported).
//   2. Load the maintenance_jobs row (title, description, category, priority,
//      photos[], property_id, company_id via the property).
//   3. Verify the caller has WRITE access to the property AND the company is
//      live (triage writes ai_* columns back to the row).
//   4. Generate short-lived signed URLs for the job's photos, download each,
//      base64-encode, and send the images + the repair text to Claude.
//   5. Claude returns { severity, category, suggested_trade, diagnosis,
//      suggested_priority, contractor_brief, confidence }.
//   6. Persist the blob to maintenance_jobs.ai_triage (+ flattened ai_severity,
//      ai_triaged_at) and return it.
//
// Everything is a DRAFT — the landlord reviews and applies. The function never
// changes the job's real priority/status/contractor itself.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Same model constants as extract-document for consistency.
const MODEL_PRIMARY  = 'claude-sonnet-4-5'
const MODEL_FALLBACK = 'claude-opus-4-7'

const STORAGE_BUCKET = 'property-documents'
const MAX_PHOTOS     = 6

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

const TRIAGE_PROMPT = `You are an experienced UK property maintenance manager triaging a repair
report for a landlord. You are given the tenant/landlord's description of the
problem and (where available) photo(s) of the issue.

Analyse the evidence and return a triage assessment. Be specific and practical
for the UK rental market. If the photos contradict or add detail beyond the
written description, trust what you can see.

Classify SEVERITY as exactly one of:
  - "emergency"  immediate risk to health/safety or the building (gas leak,
                 major water ingress, no heating in winter, electrical danger,
                 security breach) — landlord legally/practically must act now.
  - "high"       significant problem causing real disruption or that will
                 worsen/cost more if left (active leak, broken boiler, damp
                 spreading).
  - "medium"     should be fixed soon but not urgent (dripping tap, single
                 faulty socket, minor damp patch).
  - "low"        cosmetic or non-disruptive (chipped paint, sticky door, worn
                 sealant).

Pick a suggested_priority that maps sensibly to severity using the app's scale
(one of: "low", "medium", "high", "urgent"). Emergency -> "urgent".

suggested_trade should be the single most appropriate UK trade, one of:
  plumber, electrician, gas_engineer, roofer, builder, decorator,
  damp_specialist, glazier, locksmith, handyman, appliance_engineer,
  pest_control, drainage, other.

Return ONLY a single JSON object with this exact shape (no markdown, no prose):

{
  "severity": "emergency|high|medium|low",
  "category": "plumbing|electrical|structural|appliance|decoration|roofing|damp|other",
  "suggested_trade": "<one of the trades above>",
  "suggested_priority": "low|medium|high|urgent",
  "diagnosis": "2-4 sentences: likely cause and what you can see. Plain English.",
  "contractor_brief": "A short brief the landlord can paste to a contractor: what the job is, what to bring, what to check. 2-5 sentences.",
  "confidence": "high|medium|low"
}

If you genuinely cannot tell from the evidence, say so in the diagnosis and set
confidence to "low" — never invent detail that isn't supported.`

const VALID_SEVERITY = ['emergency', 'high', 'medium', 'low']
const VALID_PRIORITY = ['low', 'medium', 'high', 'urgent']
const DISCLAIMER = 'AI-generated triage — review before acting. Not a substitute for a qualified inspection.'

type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

// Call Claude with the repair text + any photo image blocks. Returns the
// parsed JSON object, or a salvageable error envelope.
async function callClaude(model: string, jobText: string, images: ImageBlock[]): Promise<any> {
  const content: any[] = [...images, { type: 'text', text: `${TRIAGE_PROMPT}\n\n--- REPAIR REPORT ---\n${jobText}` }]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content }] }),
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
    return { _parse_error: (e as Error).message, _raw_response: textResponse.slice(0, 500) }
  }
}

// First pass fell short if it didn't parse or confidence is low.
function needsFallback(extracted: any): boolean {
  if (!extracted || extracted._parse_error) return true
  if (extracted.confidence === 'low') return true
  return false
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Caller-scoped client (carries the user's JWT) for the access-check RPCs so
  // they evaluate against auth.uid() of the caller, not the service role.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  let jobId: string | null = null

  try {
    const body = await req.json()
    jobId = body.job_id
    if (!jobId) throw new Error('job_id required')

    // Load the job (service role — access enforced below via RPC).
    const { data: job, error: jobErr } = await admin
      .from('maintenance_jobs')
      .select('id, title, description, category, priority, photos, property_id, user_id')
      .eq('id', jobId)
      .single()
    if (jobErr || !job) throw new Error('Maintenance job not found')
    if (!job.property_id) throw new Error('Job has no property association')

    // Resolve the property's company for the liveness gate.
    const { data: prop, error: propErr } = await admin
      .from('properties')
      .select('company_id')
      .eq('id', job.property_id)
      .single()
    if (propErr || !prop) throw new Error('Property not found')

    // Access check: caller must have WRITE on the property (triage persists
    // ai_* columns back to the job). Evaluated as the caller, not service role.
    const { data: canWrite, error: permErr } = await userClient
      .rpc('has_property_permission', { p_property_id: job.property_id, p_action: 'write' })
    if (permErr) throw new Error('Access check failed: ' + permErr.message)
    if (canWrite !== true) return jsonError(403, 'Forbidden')

    // Liveness gate: never run paid AI for a company that isn't live.
    if (prop.company_id) {
      const { data: live } = await userClient
        .rpc('company_is_live', { p_company_id: prop.company_id })
      if (live !== true) return jsonError(402, 'Company subscription is not active')
    }

    // ── Gather photos → signed URLs → base64 image blocks ─────────────
    const photos: { path?: string; name?: string }[] = Array.isArray(job.photos) ? job.photos : []
    const images: ImageBlock[] = []
    for (const p of photos.slice(0, MAX_PHOTOS)) {
      if (!p?.path) continue
      const { data: signed, error: signErr } = await admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(p.path, 300)
      if (signErr || !signed?.signedUrl) continue
      try {
        const fileRes = await fetch(signed.signedUrl)
        if (!fileRes.ok) continue
        const mime = fileRes.headers.get('content-type') || 'image/jpeg'
        if (!mime.startsWith('image/')) continue
        const buf = await fileRes.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.byteLength; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
        }
        images.push({ type: 'image', source: { type: 'base64', media_type: mime, data: btoa(binary) } })
      } catch {
        // Skip an unreadable photo rather than failing the whole triage.
      }
    }

    const jobText = [
      job.title ? `Title: ${job.title}` : '',
      job.category ? `Category (landlord-set): ${job.category}` : '',
      job.priority ? `Current priority (landlord-set): ${job.priority}` : '',
      job.description ? `Description: ${job.description}` : '',
      images.length === 0 ? '(No photos were attached — triage from the text only.)' : `(${images.length} photo(s) attached.)`,
    ].filter(Boolean).join('\n')

    // PASS 1: Sonnet.
    let result = await callClaude(MODEL_PRIMARY, jobText, images)
    let modelUsed = MODEL_PRIMARY
    let fellBack = false

    // PASS 2 (conditional): Opus on low confidence / parse failure.
    if (needsFallback(result)) {
      try {
        const opus = await callClaude(MODEL_FALLBACK, jobText, images)
        if (!opus._parse_error) { result = opus; modelUsed = MODEL_FALLBACK; fellBack = true }
      } catch (e) {
        console.warn('[maintenance-triage] Opus fallback failed:', (e as Error).message)
      }
    }

    if (result._parse_error) throw new Error('Could not parse AI response')

    // Normalise / clamp the model output.
    const severity = VALID_SEVERITY.includes(result.severity) ? result.severity : 'medium'
    const suggested_priority = VALID_PRIORITY.includes(result.suggested_priority)
      ? result.suggested_priority
      : (severity === 'emergency' ? 'urgent' : severity === 'high' ? 'high' : severity === 'low' ? 'low' : 'medium')

    const triage = {
      severity,
      category: result.category || job.category || 'other',
      suggested_trade: result.suggested_trade || 'other',
      suggested_priority,
      diagnosis: result.diagnosis || '',
      contractor_brief: result.contractor_brief || '',
      confidence: result.confidence || 'low',
      model_used: modelUsed,
      fell_back_to_opus: fellBack,
      photos_analysed: images.length,
      disclaimer: DISCLAIMER,
    }

    const triagedAt = new Date().toISOString()
    await admin.from('maintenance_jobs').update({
      ai_triage: triage,
      ai_severity: severity,
      ai_triaged_at: triagedAt,
    }).eq('id', jobId)

    return new Response(JSON.stringify({ success: true, triage, ai_triaged_at: triagedAt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
