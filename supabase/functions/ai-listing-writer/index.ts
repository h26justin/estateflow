import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { bedrooms, bathrooms, property_type, location, features, tone, target } = await req.json()
    
    const prompt = `Write a compelling UK property listing description for:
- Type: ${property_type || 'flat'}
- Bedrooms: ${bedrooms || 2}, Bathrooms: ${bathrooms || 1}
- Location: ${location || 'town centre'}
- Key features: ${features || 'modern kitchen, parking, garden'}
- Tone: ${tone || 'professional'} 
- Target tenant: ${target || 'professional couple'}

Write 3 paragraphs. First paragraph: strong opening that sells the lifestyle. Second: key features and room highlights. Third: location benefits and practical details. Do not use "we" or mention the agent. End with a call to action. Max 200 words. UK English.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    return new Response(JSON.stringify({ description: text }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
