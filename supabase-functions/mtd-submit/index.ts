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

// Map HMRC's standardised error codes to plain-English guidance. Full list:
// https://developer.service.hmrc.gov.uk/api-documentation/docs/reference-guide
function mapHmrcError(body: any, status: number): string {
  // Multi-error response (validation failure on multiple fields)
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const codes = body.errors.map((e: any) => `${e.code}${e.path ? ` (${e.path})` : ''}`).join(', ')
    return `HMRC validation failed: ${codes}. ${body.errors[0]?.message || ''}`
  }
  const code = body?.code || ''
  const message = body?.message || ''
  const KNOWN: Record<string, string> = {
    INVALID_REQUEST: 'HMRC rejected the request as invalid. Re-build the draft and try again.',
    INVALID_NINO: 'Your National Insurance Number is invalid for HMRC. Check Settings and re-save.',
    INVALID_BUSINESS_ID: 'Your HMRC property business ID is invalid or doesn\'t belong to this NINO.',
    INVALID_TAX_YEAR: 'The tax year on this submission is rejected by HMRC.',
    INVALID_DATE_RANGE: 'The submission period dates are outside the allowed range for this tax year.',
    INVALID_PAYLOAD: 'HMRC rejected the submission shape. This is usually a software bug — please contact us.',
    BUSINESS_VALIDATION_FAILURE: 'HMRC business rules rejected this submission. See response for details.',
    DUPLICATE_SUBMISSION: 'You\'ve already filed this quarter. Use "Manage submission" on the HMRC website to amend.',
    RULE_TAX_YEAR_NOT_SUPPORTED: 'This tax year isn\'t yet supported by HMRC\'s MTD API.',
    RULE_TAX_YEAR_NOT_ENDED: 'You cannot file a submission for a tax year that hasn\'t ended yet.',
    RULE_PERIOD_OVERLAP: 'This period overlaps a previous submission.',
    CLIENT_OR_AGENT_NOT_AUTHORISED: 'HMRC says we\'re not authorised to file on this taxpayer\'s behalf. Reconnect HMRC in Settings.',
    INVALID_BEARER_TOKEN: 'Your HMRC session has expired. Reconnect from Settings → HMRC.',
    INVALID_CREDENTIALS: 'Our HMRC credentials are invalid. This is a server issue — please contact us.',
    MATCHING_RESOURCE_NOT_FOUND: 'HMRC can\'t find a matching business for this NINO. Check the Business ID.',
    TOO_MANY_REQUESTS: 'HMRC is rate-limiting us. Please try again in a few minutes.',
    SERVER_ERROR: 'HMRC is having an internal problem. Try again shortly.',
    SERVICE_UNAVAILABLE: 'HMRC is undergoing maintenance. Try again shortly.',
    MISSING_FRAUD_PREVENTION_HEADERS: 'Browser fingerprint data was missing. Refresh the page and try again — if it persists, your browser may be blocking required APIs.',
    INVALID_FRAUD_PREVENTION_HEADERS: 'HMRC rejected some of the device fingerprint headers. This is usually transient — try again.',
  }
  if (KNOWN[code]) return KNOWN[code]
  if (status === 401) return 'HMRC authorisation failed. Reconnect from Settings → HMRC.'
  if (status === 403) return 'HMRC denied access to this resource. Check your NINO + business ID.'
  if (status === 404) return 'HMRC couldn\'t find the requested resource. Check your Business ID.'
  if (status === 429) return 'HMRC is rate-limiting us. Wait a moment and retry.'
  if (status >= 500) return 'HMRC is having a problem on their end. Try again shortly.'
  return `HMRC error (${status})${code ? ' ' + code : ''}: ${message || 'Unknown'}`
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
    const reqBody = await req.json()
    const { submission_id, fraud_headers = {} } = reqBody
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

    // ── Fraud Prevention Headers (mandatory per HMRC spec) ──
    // Spec: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
    //
    // The Gov-Client-* headers come from the browser via the request body
    // (we don't trust them — but they're sent by us, and HMRC's anti-fraud
    // posture is "honest values from a compliant vendor"). The Gov-Vendor-*
    // headers describe THIS server's place in the chain.

    // Server-side vendor headers
    const forwardedFor = req.headers.get('x-forwarded-for') || ''
    const vendorPublicIp = forwardedFor.split(',')[0]?.trim() || ''
    const vendorHeaders: Record<string, string> = {
      'Gov-Vendor-Version': 'OwnProperly=1.0.0',
      'Gov-Vendor-License-IDs': '', // populated if we ever ship a desktop client
      'Gov-Vendor-Public-IP': vendorPublicIp,
      'Gov-Vendor-Forwarded': `by=${vendorPublicIp}&for=${(fraud_headers['Gov-Client-Public-IP'] || '')}`,
      'Gov-Vendor-Product-Name': 'OwnProperly',
    }

    // Combine client + vendor + the always-on auth headers. Empty / falsy
    // entries are dropped — HMRC complains about literal empty values.
    const allFraudHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...fraud_headers, ...vendorHeaders })) {
      if (typeof v === 'string' && v.length > 0) allFraudHeaders[k] = v
    }

    const hmrcRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.hmrc.6.0+json',
        'Content-Type': 'application/json',
        ...allFraudHeaders,
      },
      body: JSON.stringify(payload),
    })

    const respBody = await hmrcRes.json().catch(() => ({}))

    if (!hmrcRes.ok) {
      // Map HMRC-specific error codes to friendlier guidance per
      // https://developer.service.hmrc.gov.uk/api-documentation/docs/reference-guide
      // HMRC returns: { code: 'CLIENT_OR_AGENT_NOT_AUTHORISED', message: '...' }
      // or { errors: [{ code, message, path }, ...] } for multi-field validation
      const friendly = mapHmrcError(respBody, hmrcRes.status)
      await admin.from('mtd_submissions').update({
        status: 'rejected',
        hmrc_response: { status: hmrcRes.status, body: respBody, friendly },
      }).eq('id', submission_id)
      return jsonError(hmrcRes.status, friendly)
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
