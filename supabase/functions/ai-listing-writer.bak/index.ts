import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { propertyType, bedrooms, bathrooms, location, features, target, tone } = await req.json()

    const prompt = `Write a property listing description for ${target === 'rightmove' ? 'Rightmove' : target === 'zoopla' ? 'Zoopla' : 'a property portal'}.

Property details:
- Type: ${propertyType}
- Bedrooms: ${bedrooms}
- Bathrooms: ${bathrooms}
- Location: ${location}
- Key features: ${features}
- Tone: ${tone}

Write a compelling, accurate listing description of 150-200 words. Do not invent features not listed above. Use UK English spelling. Do not include a headline or title — just the body paragraph(s). Start directly with the description.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await response.json()
    const text = data.content?.[0]?.text

    if (!text) throw new Error('No response from AI')

    return new Response(JSON.stringify({ description: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
