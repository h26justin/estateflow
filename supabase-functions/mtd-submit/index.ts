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
//   - Sandbox mode (mtd_settings.sandbox_mode, the user's explicit toggle):
//     returns a clearly-labelled mock reference. The submission stays
//     'draft' — a rehearsal is never recorded as filed, and never locks
//     the quarter against a real submission later.
//   - Live mode: requires HMRC_CLIENT_ID + HMRC_CLIENT_SECRET env vars and
//     a valid (decryptable) OAuth user token stored on mtd_settings. If
//     either is missing the call FAILS with a clear error — it does not
//     quietly fall back to a mock. Set MTD_SANDBOX_FALLBACK=true (non-prod
//     only) to get the labelled mock instead.
//   - HMRC error bodies are logged server-side and kept on the submission
//     row; the caller only gets a sanitised summary.
//
// Justin's TODO: once HMRC dev credentials land (4-week lead time
// from gov.uk dev hub) set:
//   supabase secrets set HMRC_CLIENT_ID=...
//   supabase secrets set HMRC_CLIENT_SECRET=...
//   supabase secrets set HMRC_BASE_URL=https://test-api.service.hmrc.gov.uk
// then flip mtd_settings.sandbox_mode = false to go live.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, resolveToken } from './encryption.ts'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HMRC_BASE_URL      = Deno.env.get('HMRC_BASE_URL') || 'https://test-api.service.hmrc.gov.uk'
const HMRC_CLIENT_ID     = Deno.env.get('HMRC_CLIENT_ID') || ''
const HMRC_CLIENT_SECRET = Deno.env.get('HMRC_CLIENT_SECRET') || ''
// Explicit opt-in to the labelled mock when live creds/token are missing.
const MTD_SANDBOX_FALLBACK = Deno.env.get('MTD_SANDBOX_FALLBACK') === 'true'

// Only HMRC fraud-prevention headers may be forwarded from the browser.
// Anything else (Authorization, Host, Content-Type, X-* …) is dropped so a
// caller can't smuggle arbitrary headers into our request to HMRC.
const CLIENT_FRAUD_HEADER_RE = /^Gov-Client-[A-Za-z0-9-]{1,64}$/
function pickClientFraudHeaders(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!CLIENT_FRAUD_HEADER_RE.test(k)) continue
    if (typeof v !== 'string' || v.length === 0 || v.length > 2048) continue
    if (/[\r\n]/.test(v)) continue
    out[k] = v
  }
  return out
}

// Thrown for problems the user can act on; message is safe to return.
class UserFacingError extends Error {}

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
// Only HMRC's identifier-shaped codes / JSON paths ever reach the caller —
// HMRC's free-text messages are logged and stored, not returned.
function mapHmrcError(body: any, status: number): string {
  const safeCode = (c: unknown) => (typeof c === 'string' && /^[A-Z0-9_]{1,80}$/.test(c) ? c : '')
  const safePath = (p: unknown) => (typeof p === 'string' && /^[A-Za-z0-9_/[\].-]{1,120}$/.test(p) ? p : '')
  // Multi-error response (validation failure on multiple fields)
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const codes = body.errors.slice(0, 10)
      .map((e: any) => { const c = safeCode(e?.code) || 'UNKNOWN'; const p = safePath(e?.path); return p ? `${c} (${p})` : c })
      .join(', ')
    return `HMRC validation failed: ${codes}.`
  }
  const code = safeCode(body?.code)
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
  return `HMRC error (${status})${code ? ' ' + code : ''}. Please try again or contact support.`
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
    // Status probe for the MTD page: is live HMRC filing switched on? Live
    // means production credentials and the production API host, not the
    // sandbox. No secrets or URLs are returned.
    if (reqBody?.action === 'status') {
      const productionHost = /^https:\/\/api\.service\.hmrc\.gov\.uk\/?$/.test(HMRC_BASE_URL)
      const live = !!(HMRC_CLIENT_ID && HMRC_CLIENT_SECRET) && productionHost
      return new Response(JSON.stringify({ live_filing_available: live }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { submission_id } = reqBody
    // Gov-Client-* only; Gov-Vendor-* are always set server-side below.
    const fraudHeaders = pickClientFraudHeaders(reqBody?.fraud_headers)
    if (!submission_id) throw new UserFacingError('submission_id required')

    // Fetch submission + ownership check
    const { data: sub, error: sErr } = await admin
      .from('mtd_submissions').select('*').eq('id', submission_id).single()
    if (sErr || !sub) throw new UserFacingError('Submission not found')
    if (sub.user_id !== caller.id) return jsonError(403, 'Forbidden')
    if (sub.status === 'submitted' || sub.status === 'accepted') {
      throw new UserFacingError('This quarter has already been submitted')
    }
    if (!sub.summary_json) throw new UserFacingError('No summary data — save a draft first')

    // Fetch user's HMRC settings
    const { data: settings } = await admin
      .from('mtd_settings').select('*').eq('user_id', caller.id).maybeSingle()

    if (!settings?.nino) throw new UserFacingError('Missing NINO in HMRC settings')
    if (!settings?.mtd_business_id) throw new UserFacingError('Missing HMRC property business ID')

    // Foreign property uses a different HMRC endpoint AND payload shape
    // (foreignProperty, not ukProperty). Until that's implemented, refuse
    // loudly rather than posting an invalid UK-shaped body to the foreign
    // endpoint. FHL is fine: the FHL regime is abolished from 2025-26, so
    // FHL income files as ordinary UK property under API v6.0.
    if (settings.property_business_type === 'foreign-property') {
      throw new UserFacingError('Foreign property submissions aren\'t supported yet — OwnProperly currently files UK property businesses only. Please file this business via HMRC\'s own service or contact support.')
    }

    // Resolve the access + refresh tokens — prefer the encrypted column,
    // fall back to the legacy plaintext column for pre-encryption rows.
    const accessTokenStored = await resolveToken({
      encrypted: settings.encrypted_hmrc_access_token,
      plaintext: settings.hmrc_access_token,
    })
    const refreshTokenStored = await resolveToken({
      encrypted: settings.encrypted_hmrc_refresh_token,
      plaintext: settings.hmrc_refresh_token,
    })

    // Why the live path can't run, if it can't. Never silently mocked.
    let liveBlocker = ''
    if (!HMRC_CLIENT_ID || !HMRC_CLIENT_SECRET) {
      liveBlocker = 'HMRC filing is not configured on the server yet. Nothing was sent to HMRC.'
    } else if (!accessTokenStored) {
      const hadToken = !!(settings.encrypted_hmrc_access_token || settings.hmrc_access_token)
      if (hadToken) console.error('mtd-submit: stored HMRC token could not be decrypted for user', caller.id)
      liveBlocker = hadToken
        ? 'Your HMRC connection could not be read. Reconnect HMRC in Settings → MTD Tax, then submit again. Nothing was sent to HMRC.'
        : 'HMRC is not connected. Connect HMRC in Settings → MTD Tax, then submit again. Nothing was sent to HMRC.'
    }

    const goSandbox = settings.sandbox_mode === true || (!!liveBlocker && MTD_SANDBOX_FALLBACK)
    if (!goSandbox && liveBlocker) {
      return jsonError(409, liveBlocker)
    }

    if (goSandbox) {
      // Labelled mock — lets the user rehearse the flow. NOT a filing: the
      // submission stays 'draft' (no hmrc_reference, no submitted_at) so it
      // never reads as filed and never locks the quarter.
      const mockRef = `SANDBOX-${sub.tax_year}-Q${sub.quarter_number}-${Date.now().toString(36).toUpperCase()}`
      await admin.from('mtd_submissions').update({
        hmrc_response: {
          mock: true, sandbox_reference: mockRef, at: new Date().toISOString(),
          message: 'Sandbox rehearsal — no real HMRC call made. Not submitted.',
        },
      }).eq('id', submission_id)

      return new Response(JSON.stringify({
        sandbox: true,
        submitted: false,
        reference: mockRef,
        message: 'Sandbox rehearsal only — nothing was sent to HMRC and this quarter is NOT submitted.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── LIVE HMRC PATH ──
    // Token refresh (if expired). On refresh, re-encrypt the new tokens
    // and null out the plaintext columns. If encryption isn't configured
    // (no OWNPROPERLY_TOKEN_KEY), fall back to writing plaintext.
    if (!accessTokenStored) return jsonError(409, liveBlocker || 'HMRC is not connected.') // unreachable; narrows the type
    let accessToken: string = accessTokenStored
    const expires = settings.hmrc_token_expires_at ? new Date(settings.hmrc_token_expires_at) : null
    if (expires && expires.getTime() <= Date.now() + 60_000 && refreshTokenStored) {
      const refreshRes = await fetch(`${HMRC_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshTokenStored,
          client_id: HMRC_CLIENT_ID,
          client_secret: HMRC_CLIENT_SECRET,
        }),
      })
      if (!refreshRes.ok) {
        console.error('mtd-submit: HMRC token refresh failed', refreshRes.status, (await refreshRes.text()).slice(0, 500))
        throw new UserFacingError('Your HMRC session has expired. Reconnect HMRC in Settings → MTD Tax, then submit again.')
      }
      const tokenData = await refreshRes.json()
      accessToken = tokenData.access_token
      const newRefresh = tokenData.refresh_token || refreshTokenStored
      const newExpiry = new Date(Date.now() + (tokenData.expires_in || 14400) * 1000).toISOString()
      const encA = await encryptToken(accessToken)
      const encR = await encryptToken(newRefresh)
      await admin.from('mtd_settings').update({
        hmrc_access_token:           encA ? null : accessToken,
        hmrc_refresh_token:          encR ? null : newRefresh,
        encrypted_hmrc_access_token:  encA || null,
        encrypted_hmrc_refresh_token: encR || null,
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

    // POST to HMRC — endpoint shape per the Property Business API v6.0.
    // Always the UK endpoint: foreign-property is rejected above, and
    // fhl-property correctly files as UK property (FHL regime abolished).
    const url = `${HMRC_BASE_URL}/individuals/business/property/uk/${encodeURIComponent(settings.nino)}/${encodeURIComponent(settings.mtd_business_id)}/period/${sub.tax_year}`

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
      'Gov-Vendor-Forwarded': `by=${vendorPublicIp}&for=${(fraudHeaders['Gov-Client-Public-IP'] || '')}`,
      'Gov-Vendor-Product-Name': 'OwnProperly',
    }

    // Combine client + vendor + the always-on auth headers. Empty / falsy
    // entries are dropped — HMRC complains about literal empty values.
    const allFraudHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...fraudHeaders, ...vendorHeaders })) {
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
      // The raw body is logged + kept on the row; the caller gets only the
      // sanitised summary. HMRC's own 401/403 is not echoed as ours (it
      // would read as "your session expired" to the client).
      const friendly = mapHmrcError(respBody, hmrcRes.status)
      console.error('mtd-submit: HMRC rejected submission', submission_id, hmrcRes.status, JSON.stringify(respBody).slice(0, 2000))
      await admin.from('mtd_submissions').update({
        status: 'rejected',
        hmrc_response: { status: hmrcRes.status, body: respBody, friendly },
      }).eq('id', submission_id)
      return jsonError(hmrcRes.status >= 500 ? 502 : 422, friendly)
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
    if (e instanceof UserFacingError) return jsonError(400, e.message)
    console.error('mtd-submit failed:', (e as Error).message)
    return jsonError(500, 'Submission failed on our side. Please contact support before retrying.')
  }
})
