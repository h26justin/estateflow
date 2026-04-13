import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { url } = await req.json()
    if (!url) throw new Error('No URL provided')

    // Fetch the listing page
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.5',
      }
    })

    if (!res.ok) throw new Error(`Failed to fetch listing: ${res.status}`)
    const html = await res.text()

    let price: number | null = null
    let propertyType: string | null = null
    let bedrooms: number | null = null
    let address: string | null = null
    let source = 'unknown'

    // ── RIGHTMOVE ─────────────────────────────────────────────────
    if (url.includes('rightmove.co.uk')) {
      source = 'rightmove'

      // Price — multiple patterns
      const pricePatterns = [
        /"price":\{"amount":(\d+)/,
        /property-header-price[^>]*>.*?£([\d,]+)/s,
        /"price":{"amount":(\d+)/,
        /data-testid="price"[^>]*>.*?£([\d,]+)/s,
        /"displayPrice":"£([\d,]+)"/,
        /£([\d,]+)\s*(?:guide price|asking price|offers over|oieo|oiro|fixed price)?/i,
      ]
      for (const pat of pricePatterns) {
        const m = html.match(pat)
        if (m) {
          price = parseInt(m[1].replace(/,/g, ''))
          if (price > 10000) break // sanity check
          price = null
        }
      }

      // Property type
      const typePatterns = [
        /"propertySubType":"([^"]+)"/,
        /"propertyType":"([^"]+)"/,
        /property-header-title[^>]*>\s*(?:\d+\s+bedroom\s+)?([^<\n]+?)(?:\s+for sale)?<\/h1>/i,
        /"bedrooms":(\d+).*?"propertySubType":"([^"]+)"/s,
      ]
      for (const pat of typePatterns) {
        const m = html.match(pat)
        if (m) { propertyType = m[m.length > 2 ? 2 : 1].toLowerCase(); break }
      }

      // Bedrooms
      const bedMatch = html.match(/"bedrooms":(\d+)/) || html.match(/(\d+)\s+bedroom/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])

      // Address
      const addrMatch = html.match(/"displayAddress":"([^"]+)"/) || html.match(/<title>([^<]+?)\s*\|/)
      if (addrMatch) address = addrMatch[1].replace(/\s+for sale.*/i, '').trim()
    }

    // ── ZOOPLA ─────────────────────────────────────────────────────
    else if (url.includes('zoopla.co.uk')) {
      source = 'zoopla'

      const priceMatch = html.match(/"price":(\d+)/) || 
                        html.match(/£([\d,]+)/) 
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''))

      const typeMatch = html.match(/"propertyType":"([^"]+)"/) ||
                       html.match(/(\d+)\s+bedroom\s+(\w+)/i)
      if (typeMatch) propertyType = typeMatch[typeMatch.length > 2 ? 2 : 1]

      const bedMatch = html.match(/"numBedrooms":(\d+)/) || html.match(/(\d+)\s+bed/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])

      const addrMatch = html.match(/"address":"([^"]+)"/) || html.match(/<title>([^<|]+)/)
      if (addrMatch) address = addrMatch[1].trim()
    }

    // ── ONTHEMARKET ────────────────────────────────────────────────
    else if (url.includes('onthemarket.com')) {
      source = 'onthemarket'

      const priceMatch = html.match(/£([\d,]+)/)
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''))

      const typeMatch = html.match(/(\d+)\s+bedroom\s+(\w+)/i)
      if (typeMatch) propertyType = typeMatch[2]

      const bedMatch = html.match(/(\d+)\s+bedroom/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])
    }

    // Normalise property type
    const typeMap: Record<string, string> = {
      'flat': 'flat', 'apartment': 'flat', 'maisonette': 'flat',
      'terraced': 'terraced', 'terrace': 'terraced', 'end of terrace': 'terraced',
      'semi-detached': 'semi-detached', 'semi detached': 'semi-detached',
      'detached': 'detached', 'bungalow': 'bungalow',
      'cottage': 'detached', 'house': 'terraced',
      'studio': 'flat', 'room': 'flat',
    }
    if (propertyType) {
      const lower = propertyType.toLowerCase()
      for (const [key, val] of Object.entries(typeMap)) {
        if (lower.includes(key)) { propertyType = val; break }
      }
    }

    return new Response(JSON.stringify({
      price,
      propertyType,
      bedrooms,
      address,
      source,
      success: !!(price || propertyType),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message, success: false }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
