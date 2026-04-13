import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { url } = await req.json()
    if (!url || !url.includes('rightmove.co.uk') && !url.includes('zoopla.co.uk') && !url.includes('onthemarket.com')) {
      throw new Error('Please provide a Rightmove, Zoopla or OnTheMarket URL')
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      }
    })
    const html = await res.text()

    // Extract price
    let price = null
    const pricePatterns = [
      /£([\d,]+)\s*(?:pcm|per month|pm)/i,
      /"price":\s*"£?([\d,]+)"/,
      /data-price="([\d,]+)"/,
      /"displayPrice":"£([\d,]+)"/,
      /property-price[^>]*>.*?£([\d,]+)/s,
      /£([\d,]+)(?:\s*pcm)?/,
    ]
    for (const p of pricePatterns) {
      const m = html.match(p)
      if (m) { price = parseInt(m[1].replace(/,/g, '')); break }
    }

    // Extract address
    let address = null
    const addrPatterns = [
      /"displayAddress":"([^"]+)"/,
      /data-address="([^"]+)"/,
      /<h1[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)</i,
      /"address":\s*"([^"]+)"/,
    ]
    for (const p of addrPatterns) {
      const m = html.match(p)
      if (m) { address = m[1].replace(/\\u003c/g,'<').replace(/\\u003e/g,'>').replace(/\\"/g,'"').trim(); break }
    }

    // Extract bedrooms
    let bedrooms = null
    const bedPatterns = [/"bedrooms":(\d+)/, /(\d+)\s*bed(?:room)?s?/i, /data-bedrooms="(\d+)"/]
    for (const p of bedPatterns) {
      const m = html.match(p)
      if (m) { bedrooms = parseInt(m[1]); break }
    }

    // Extract property type
    let propertyType = null
    const typePatterns = [/"propertySubType":"([^"]+)"/, /"type":"([^"]+)"/]
    for (const p of typePatterns) {
      const m = html.match(p)
      if (m) { propertyType = m[1]; break }
    }

    return new Response(JSON.stringify({ price, address, bedrooms, propertyType, success: !!(price || address) }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
