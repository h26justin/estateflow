// scrape-listing — pulls price, type, bedrooms and address off a Rightmove,
// Zoopla or OnTheMarket listing URL for the Deals yield calculator.
//
// Auth and safety: deploy with verify_jwt = TRUE. Until 2026-09-07 this
// function ran with the JWT check off and fetched ANY URL a caller supplied,
// which made it an open proxy (and a server-side request forgery vector into
// anything the edge runtime can reach). It now accepts only https URLs on the
// three portal hosts, follows no redirects off them, and caps the body read.
//
// Source of record: this file. Pulled into the repo from the deployed v22.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALLOWED_HOSTS = ['www.rightmove.co.uk', 'rightmove.co.uk', 'www.zoopla.co.uk', 'zoopla.co.uk', 'www.onthemarket.com', 'onthemarket.com']
const MAX_BYTES = 2_000_000

function allowedUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('Not a valid URL') }
  if (u.protocol !== 'https:') throw new Error('Only https listing URLs are accepted')
  if (!ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) throw new Error('Only Rightmove, Zoopla and OnTheMarket listings are supported')
  return u
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { url } = await req.json()
    if (!url) throw new Error('No URL provided')
    const target = allowedUrl(String(url))

    const res = await fetch(target.toString(), {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.5',
      }
    })

    if (res.status >= 300 && res.status < 400) throw new Error('Listing redirected; open the final listing page and paste that URL')
    if (!res.ok) throw new Error(`Failed to fetch listing: ${res.status}`)
    const html = (await res.text()).slice(0, MAX_BYTES)

    let price: number | null = null
    let propertyType: string | null = null
    let bedrooms: number | null = null
    let address: string | null = null
    let source = 'unknown'

    if (target.hostname.endsWith('rightmove.co.uk')) {
      source = 'rightmove'
      const pricePatterns = [
        /"price":\{"amount":(\d+)/,
        /"displayPrice":"£([\d,]+)"/,
        /£([\d,]+)\s*(?:guide price|asking price|offers over)?/i,
      ]
      for (const pat of pricePatterns) {
        const m = html.match(pat)
        if (m) {
          price = parseInt(m[1].replace(/,/g, ''))
          if (price > 10000) break
          price = null
        }
      }
      const typePatterns = [/"propertySubType":"([^"]+)"/, /"propertyType":"([^"]+)"/]
      for (const pat of typePatterns) {
        const m = html.match(pat)
        if (m) { propertyType = m[1].toLowerCase(); break }
      }
      const bedMatch = html.match(/"bedrooms":(\d+)/) || html.match(/(\d+)\s+bedroom/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])
      const addrMatch = html.match(/"displayAddress":"([^"]+)"/) || html.match(/<title>([^<]+?)\s*\|/)
      if (addrMatch) address = addrMatch[1].replace(/\s+for sale.*/i, '').trim()
    }

    else if (target.hostname.endsWith('zoopla.co.uk')) {
      source = 'zoopla'
      const priceMatch = html.match(/"price":(\d+)/) || html.match(/£([\d,]+)/)
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''))
      const typeMatch = html.match(/"propertyType":"([^"]+)"/) || html.match(/(\d+)\s+bedroom\s+(\w+)/i)
      if (typeMatch) propertyType = typeMatch[typeMatch.length > 2 ? 2 : 1]
      const bedMatch = html.match(/"numBedrooms":(\d+)/) || html.match(/(\d+)\s+bed/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])
      const addrMatch = html.match(/"address":"([^"]+)"/) || html.match(/<title>([^<|]+)/)
      if (addrMatch) address = addrMatch[1].trim()
    }

    else if (target.hostname.endsWith('onthemarket.com')) {
      source = 'onthemarket'
      const priceMatch = html.match(/£([\d,]+)/)
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''))
      const typeMatch = html.match(/(\d+)\s+bedroom\s+(\w+)/i)
      if (typeMatch) propertyType = typeMatch[2]
      const bedMatch = html.match(/(\d+)\s+bedroom/i)
      if (bedMatch) bedrooms = parseInt(bedMatch[1])
    }

    const typeMap: Record<string, string> = {
      'flat': 'flat', 'apartment': 'flat', 'maisonette': 'flat',
      'terraced': 'terraced', 'terrace': 'terraced', 'end of terrace': 'terraced',
      'semi-detached': 'semi-detached', 'detached': 'detached',
      'bungalow': 'bungalow', 'house': 'terraced', 'studio': 'flat',
    }
    if (propertyType) {
      const lower = propertyType.toLowerCase()
      for (const [key, val] of Object.entries(typeMap)) {
        if (lower.includes(key)) { propertyType = val; break }
      }
    }

    return new Response(JSON.stringify({ price, propertyType, bedrooms, address, source, success: !!(price || propertyType) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message, success: false }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
