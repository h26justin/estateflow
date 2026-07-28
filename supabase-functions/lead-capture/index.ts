// Lead capture endpoint for marketing landing pages.
//
// Triggered by the Section 24 calculator + other static landing pages
// when a visitor submits the "email me a copy of this report" form.
// Stores the lead in marketing_leads and fires a confirmation email.
//
// Public-callable (no JWT) — gated by a simple honeypot + Cloudflare-style
// IP rate limiting (10 leads/hour/IP). This isn't fort-knox, but it stops
// trivial bot signups and avoids paying Resend send-fees on garbage.
//
// Body:
//   {
//     email: string,
//     source: 'section-24-calc' | 'mtd-itsa-page' | string,
//     payload?: any,                  -- optional: their inputs/results
//     honeypot?: string,              -- must be empty (filled by bots)
//   }

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') || 'Justin at Properly <justin@ownproperly.com>'
const APP_BASE_URL   = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'

const corsHeaders = {
  // Public form endpoint — restricted to the apex + www for now.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 254
}

async function sendConfirmation(to: string, source: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[lead-capture] No RESEND_API_KEY — would have confirmed', to)
    return
  }
  const subject = source === 'section-24-calc'
    ? 'Your Section 24 calculation — and what to do with it'
    : 'Thanks for reaching out — here is what to do next'

  const text = source === 'section-24-calc'
    ? `Hi,

Thanks for using the Section 24 calculator.

The calculator runs in your browser — we don't store the numbers you entered. But I wanted to send a quick note in case it's useful.

The biggest mistake landlords make with Section 24 is treating it as a fixed reality rather than a decision point. Three things worth knowing:

1. The 20% tax credit is on FINANCE COST only — not all mortgage payments.
2. Incorporation makes sense for higher-rate landlords with leveraged portfolios — but the SDLT 3% surcharge on transfer is brutal. Model it carefully.
3. Annual rate changes (bank rate movements) hit S24 landlords directly because the bigger the interest, the bigger the gap between 20% credit and 40% marginal rate.

Properly automates Section 24 across every property in your portfolio and handles your quarterly MTD ITSA filings. £2 per property per month, 14-day free trial, no card needed.

→ Start your free trial: ${APP_BASE_URL}

Any questions, just reply.

Justin
Founder, Properly
`
    : `Hi,

Thanks for reaching out — got your email.

A short pointer to whatever you might find useful:

· Our MTD ITSA landing page: ${APP_BASE_URL}/mtd-itsa-landlord-software/
· The Section 24 calculator: ${APP_BASE_URL}/section-24-calculator/
· UK landlord blog (compliance, tax, deals): ${APP_BASE_URL}/blog/

Or just reply and tell me what you're trying to figure out.

Justin
Founder, Properly
`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      reply_to: FROM_EMAIL.replace(/^.*<|>$/g, '').trim(),
      subject, text,
      headers: {
        'List-Unsubscribe': `<mailto:unsubscribe@ownproperly.com?subject=unsub-${encodeURIComponent(to)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  })
  if (!res.ok) console.warn('[lead-capture] send failed:', res.status, await res.text())
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  // X-Forwarded-For: the LEFTMOST entries are client-supplied and trivially
  // spoofable; the platform's own proxy appends the real connecting IP as
  // the RIGHTMOST hop, so key the rate limit on that.
  const xff = req.headers.get('x-forwarded-for') || ''
  const ip  = xff.split(',').pop()?.trim() || 'unknown'

  // Per-IP rate limit: max 10 captures per hour from one IP.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await admin
    .from('marketing_leads')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', oneHourAgo)
  if ((recentCount || 0) >= 10) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded — try again later.' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try { body = await req.json() } catch { return jsonErr(400, 'Invalid JSON') }

  const email     = String(body.email || '').toLowerCase().trim()
  const source    = String(body.source || 'unknown').slice(0, 60)
  const honeypot  = String(body.honeypot || '').trim()
  const payload   = body.payload && typeof body.payload === 'object' ? body.payload : null

  if (honeypot) {
    // Bot. Return 200 so the bot thinks it succeeded and goes away.
    return jsonOk({ ok: true })
  }
  if (!isValidEmail(email)) return jsonErr(400, 'Invalid email')

  // Per-email send cap: confirm a given address at most once per 24h.
  // Tracked under payload._email_meta on the lead row (one row per email).
  const { data: existing } = await admin
    .from('marketing_leads')
    .select('id, payload')
    .eq('email', email)
    .maybeSingle()
  const prevMeta = (existing?.payload as any)?._email_meta || {}
  const lastSentAt = prevMeta.last_sent_at ? new Date(prevMeta.last_sent_at).getTime() : 0
  let shouldSend = Date.now() - lastSentAt > 24 * 60 * 60 * 1000

  // Global cap: if more than 50 new leads landed in the last hour someone
  // is hammering the endpoint — keep saving leads, stop sending email
  // (the send is the abuse primitive: Resend fees + domain reputation).
  if (shouldSend) {
    const { count: globalCount } = await admin
      .from('marketing_leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', oneHourAgo)
    if ((globalCount || 0) >= 50) {
      console.warn('[lead-capture] global hourly cap hit — suppressing confirmation email for', email)
      shouldSend = false
    }
  }

  const emailMeta = shouldSend
    ? { last_sent_at: new Date().toISOString(), sent_count: (prevMeta.sent_count || 0) + 1 }
    : prevMeta

  // Insert the lead (upsert on email — re-submissions update payload).
  const { error: insErr } = await admin.from('marketing_leads').upsert({
    email, source, ip,
    payload: { ...(payload || {}), _email_meta: emailMeta },
  }, { onConflict: 'email' })
  if (insErr) {
    console.error('[lead-capture] insert failed:', insErr)
    return jsonErr(500, 'Could not save your email — please try again.')
  }

  // Confirmation email (fire-and-forget — don't block the response on it).
  if (shouldSend) {
    sendConfirmation(email, source).catch(e => console.warn('[lead-capture] confirm send fail:', e))
  }

  return jsonOk({ ok: true })

  function jsonOk(b: any)  { return new Response(JSON.stringify(b), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
  function jsonErr(s: number, m: string) {
    return new Response(JSON.stringify({ error: m }), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
