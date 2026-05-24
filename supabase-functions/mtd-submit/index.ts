// MTD ITSA quarterly submission to HMRC.
//
// Input: { submission_id: string }
// Reads the mtd_submissions row + the user's mtd_settings, validates
// readiness, and POSTs to HMRC's Property Business API (or returns a
// mocked success in sandbox mode).
//
// HMRC endpoint (cash basis, UK property):
//   POST /individuals/business/property/uk/{nino}/{businessId}/cumulative-summary/{taxYear}
// Headers must include:
//   Authorization: Bearer <hmrc_access_token>
//   Accept: application/vnd.hmrc.2.0+json
//   Gov-Client-* fraud-prevention headers (TODO when live)
//
// Status:
//   - Sandbox mode: returns a mock reference + marks submission accepted.
//   - Live mode: requires HMRC_CLIENT_ID + HMRC_CLIENT_SECRET env vars and
//     a valid OAuth user token stored on mtd_settings. Falls back to
//     sandbox if either is missing so the UI never breaks.
//
// Justin's TODO: once HMRC dev credentials land (4-week lead time
// from gov.uk dev hub) set:
//   supabase secrets set HMRC_CLIENT_ID=...
//   supabase secrets set HMRC_CLIENT_SECRET=...
//   supabase secrets set HMRC_BASE_URL=https://test-api.service.hmrc.gov.uk
// then flip mtd_settings.sandbox_mode = false to go live.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HMRC_BASE_URL      = Deno.env.get('HMRC_BASE_URL') || 'https://test-api.service.hmrc.gov.uk'
const HMRC_CLIENT_ID     = Deno.env.get('HMRC_CLIENT_ID') || ''
const HMRC_CLIENT_SECRET = Deno.env.get('HMRC_CLIENT_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authenticate the caller
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  try {
    const { submission_id } = await req.json()
    if (!submission_id) throw new Error('submission_id required')

    // Fetch submission + ownership check
    const { data: sub, error: sErr } = await admin
      .from('mtd_submissions').select('*').eq('id', submission_id).single()
    if (sErr || !sub) throw new Error('Submission not found')
    if (sub.user_id !== caller.id) return jsonError(403, 'Forbidden')
    if (sub.status === 'submitted' || sub.status === 'accepted') {
      throw new Error('This quarter has already been submitted')
    }
    if (!sub.summary_json) throw new Error('No summary data — save a draft first')

    // Fetch user's HMRC settings
    const { data: settings } = await admin
      .from('mtd_settings').select('*').eq('user_id', caller.id).maybeSingle()

    if (!settings?.nino) throw new Error('Missing NINO in HMRC settings')
    if (!settings?.mtd_business_id) throw new Error('Missing HMRC property business ID')

    const goSandbox = settings.sandbox_mode || !HMRC_CLIENT_ID || !HMRC_CLIENT_SECRET || !settings.hmrc_access_token

    if (goSandbox) {
      // Mock HMRC response — succeeds locally so the user can rehearse the
      // full flow before live creds land.
      const mockRef = `SANDBOX-${sub.tax_year}-Q${sub.quarter_number}-${Date.now().toString(36).toUpperCase()}`
      await admin.from('mtd_submissions').update({
        status: 'submitted',
        hmrc_reference: mockRef,
        hmrc_response: { mock: true, message: 'Sandbox submission — no real HMRC call made.' },
        submitted_at: new Date().toISOString(),
      }).eq('id', submission_id)

      return new Response(JSON.stringify({
        sandbox: true,
        reference: mockRef,
        message: 'Sandbox submission accepted. Configure HMRC live credentials to file for real.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── LIVE HMRC PATH ──
    // Token refresh (if expired)
    let accessToken = settings.hmrc_access_token
    const expires = settings.hmrc_token_expires_at ? new Date(settings.hmrc_token_expires_at) : null
    if (expires && expires.getTime() <= Date.now() + 60_000 && settings.hmrc_refresh_token) {
      const refreshRes = await fetch(`${HMRC_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: settings.hmrc_refresh_token,
          client_id: HMRC_CLIENT_ID,
          client_secret: HMRC_CLIENT_SECRET,
        }),
      })
      if (!refreshRes.ok) throw new Error('HMRC token refresh failed: ' + await refreshRes.text())
      const tokenData = await refreshRes.json()
      accessToken = tokenData.access_token
      const newExpiry = new Date(Date.now() + (tokenData.expires_in || 14400) * 1000).toISOString()
      await admin.from('mtd_settings').update({
        hmrc_access_token: accessToken,
        hmrc_refresh_token: tokenData.refresh_token || settings.hmrc_refresh_token,
        hmrc_token_expires_at: newExpiry,
      }).eq('user_id', caller.id)
    }

    // Build HMRC payload from our summary
    const summary = sub.summary_json
    const payload = {
      fromDate: summary.fromDate,
      toDate: summary.toDate,
      ukProperty: {
        income: {
          periodAmount: summary.income?.periodAmount || 0,
          taxDeducted: summary.income?.taxDeducted || 0,
        },
        expenses: summary.expenses || {},
      },
    }

    // POST to HMRC — endpoint shape per the Property Business API v6.0
    const businessType = settings.property_business_type === 'foreign-property' ? 'foreign'
                       : settings.property_business_type === 'fhl-property' ? 'uk' : 'uk'
    const url = `${HMRC_BASE_URL}/individuals/business/property/${businessType}/${encodeURIComponent(settings.nino)}/${encodeURIComponent(settings.mtd_business_id)}/period/${sub.tax_year}`

    const hmrcRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.hmrc.6.0+json',
        'Content-Type': 'application/json',
        // Fraud-prevention headers (Gov-Client-*) MUST be added before
        // production. HMRC rejects submissions missing them.
        // See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
      },
      body: JSON.stringify(payload),
    })

    const respBody = await hmrcRes.json().catch(() => ({}))

    if (!hmrcRes.ok) {
      await admin.from('mtd_submissions').update({
        status: 'rejected',
        hmrc_response: { status: hmrcRes.status, body: respBody },
      }).eq('id', submission_id)
      return jsonError(hmrcRes.status, 'HMRC rejected submission: ' + (respBody?.message || JSON.stringify(respBody).slice(0, 200)))
    }

    await admin.from('mtd_submissions').update({
      status: 'submitted',
      hmrc_reference: respBody?.submissionId || respBody?.id || null,
      hmrc_response: respBody,
      submitted_at: new Date().toISOString(),
    }).eq('id', submission_id)

    return new Response(JSON.stringify({
      sandbox: false,
      reference: respBody?.submissionId || respBody?.id,
      hmrc_response: respBody,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
