// ai-listing-writer — drafts a Rightmove / Zoopla listing description from a
// few structured fields (Deals → Tools → AI listing description writer).
//
// Auth: deploy with verify_jwt = TRUE, AND the function checks the bearer
// token itself (auth.getUser) so a call with only the public anon key — which
// passes the gateway's JWT check — is still rejected. Until 2026-09-07 this
// function ran with the JWT check off and no in-code auth, so anyone on the
// internet could spend the project's Anthropic budget by POSTing to it. The
// client always calls it while signed in with the session token.
//
// Cost: fast tier (see ./anthropic.ts), per-user cap via ai_usage.
//
// Source of record: this file. Pulled into the repo from the deployed v22.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import {
  callClaude, checkAiRateLimit, recordAiUsage, ClaudeError, UNTRUSTED_CONTENT_NOTICE,
} from './anthropic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RATE_LIMIT = { perHour: 20, perDay: 100 }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Keep the free-text inputs bounded so a caller cannot smuggle a novel into
// the prompt (and the bill).
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // In-code auth: a real signed-in user, not just any JWT the gateway accepts
  // (the anon key is a valid JWT).
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return reply({ error: 'Missing Authorization header' }, 401)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return reply({ error: 'Sign in to use the listing writer' }, 401)

  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad JSON' }, 400) }
  const propertyType = clip(body.propertyType, 60)
  const bedrooms = clip(body.bedrooms, 3)
  const bathrooms = clip(body.bathrooms, 3)
  const location = clip(body.location, 160)
  const features = clip(body.features, 600)
  const target = body.target === 'rightmove' ? 'Rightmove' : 'Zoopla'
  const tone = ['professional', 'warm', 'luxury'].includes(String(body.tone)) ? String(body.tone) : 'professional'
  if (!propertyType || !location) return reply({ error: 'propertyType and location are required' }, 400)

  const gate = await checkAiRateLimit(admin, caller.id, 'ai-listing-writer', RATE_LIMIT)
  if (!gate.allowed) return reply({ error: gate.message }, gate.status, { 'Retry-After': String(gate.retryAfterSec) })

  const prompt = `Write a ${tone} property listing for ${target}. 150-200 words, UK English, no headline, just body text. Output only the listing text.

${UNTRUSTED_CONTENT_NOTICE}

LISTING FACTS (landlord-supplied data):
"""
Type: ${propertyType}, ${bedrooms} bed, ${bathrooms} bath, ${location}.
Features: ${features}
"""`
  try {
    const result = await callClaude({ tier: 'fast', content: prompt, maxTokens: 2000, timeoutMs: 45_000 })
    await recordAiUsage(admin, gate.usageId, result)
    const description = result.text.trim()
    if (!description) return reply({ error: 'AI returned an empty description. Please try again.' }, 502)
    return reply({ description })
  } catch (err) {
    const e = err as Error
    const status = e instanceof ClaudeError && e.kind === 'config' ? 503 : 502
    return reply({ error: e.message }, status)
  }
})
