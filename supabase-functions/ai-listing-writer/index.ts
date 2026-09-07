// ai-listing-writer — drafts a Rightmove / Zoopla listing description from a
// few structured fields (Deals → Tools → AI listing description writer).
//
// Auth: deploy with verify_jwt = TRUE. Until 2026-09-07 this function ran
// with the JWT check off and no in-code auth, so anyone on the internet could
// spend the project's Anthropic budget by POSTing to it. The client always
// calls it through supabase.functions.invoke while signed in, which attaches
// the session token, so requiring the JWT costs the app nothing.
//
// Source of record: this file. Pulled into the repo from the deployed v22.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Keep the free-text inputs bounded so a caller cannot smuggle a novel into
// the prompt (and the bill).
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json()
    const propertyType = clip(body.propertyType, 60)
    const bedrooms = clip(body.bedrooms, 3)
    const bathrooms = clip(body.bathrooms, 3)
    const location = clip(body.location, 160)
    const features = clip(body.features, 600)
    const target = body.target === 'rightmove' ? 'Rightmove' : 'Zoopla'
    const tone = ['professional', 'warm', 'luxury'].includes(String(body.tone)) ? String(body.tone) : 'professional'
    if (!propertyType || !location) throw new Error('propertyType and location are required')

    const prompt = `Write a ${tone} property listing for ${target}. Type: ${propertyType}, ${bedrooms} bed, ${bathrooms} bath, ${location}. Features: ${features}. 150-200 words, UK English, no headline, just body text.`
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: Deno.env.get('LISTING_WRITER_MODEL') || 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    })
    const data = await response.json()
    return new Response(JSON.stringify({ description: data.content?.[0]?.text }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
