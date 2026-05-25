// HMRC gov.uk OAuth 2.0 — Authorization Code flow for MTD ITSA.
//
// Without this, the mtd-submit edge function falls back to its mock path
// (the SANDBOX-xxxxx reference) because no per-user access token exists.
// After this flow completes, mtd_settings has hmrc_access_token +
// hmrc_refresh_token + hmrc_token_expires_at, and mtd-submit hits the
// real HMRC sandbox (or production) Property Business API.
//
// Two modes:
//   action='start' (POST, JWT-authed) → builds the gov.uk authorize URL
//                                       and returns it; client redirects.
//   GET ?code=&state=                 → HMRC redirects user here after
//                                       consent. We exchange the code for
//                                       tokens, persist them, redirect
//                                       the user back into the app.
//
// State token format: base64(JSON({ user_id, return_to, nonce })). Light
// signing — HMAC would be stronger; deferred until we go production.
//
// Env vars (set on Supabase already by Justin earlier today):
//   HMRC_CLIENT_ID
//   HMRC_CLIENT_SECRET
//   HMRC_BASE_URL          (https://test-api.service.hmrc.gov.uk for sandbox)
//   HMRC_OAUTH_REDIRECT    (https://<ref>.supabase.co/functions/v1/hmrc-oauth-callback)
//                           — MUST also be registered in the HMRC dev hub app
//                           or HMRC rejects with redirect_uri_mismatch
//   APP_RETURN_BASE        (https://ownproperly.com — where to bounce
//                           the user after success/failure)
//
// Required scopes for MTD ITSA Property Business:
//   read:self-assessment  write:self-assessment
//   (HMRC also issues finer-grained scopes per API but these cover all
//    the MTD ITSA endpoints we call.)

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken } from './encryption.ts'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HMRC_CLIENT_ID      = Deno.env.get('HMRC_CLIENT_ID') || ''
const HMRC_CLIENT_SECRET  = Deno.env.get('HMRC_CLIENT_SECRET') || ''
const HMRC_BASE_URL       = Deno.env.get('HMRC_BASE_URL') || 'https://test-api.service.hmrc.gov.uk'
const HMRC_OAUTH_REDIRECT = Deno.env.get('HMRC_OAUTH_REDIRECT') || `${SUPABASE_URL}/functions/v1/hmrc-oauth-callback`
const APP_RETURN_BASE     = Deno.env.get('APP_RETURN_BASE') || 'https://ownproperly.com'

const SCOPES = 'read:self-assessment write:self-assessment'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function encodeState(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload))
}

function decodeState(s: string): Record<string, any> {
  try { return JSON.parse(atob(s)) } catch { return {} }
}

// Friendly HTML for callback failures so the user sees something useful
// instead of raw JSON if they hit the GET endpoint directly.
function htmlPage(title: string, body: string, returnTo: string) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1a1f2e;line-height:1.5}
h1{color:#1a1f2e;letter-spacing:-0.02em}.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:14px 16px;color:#991B1B;font-family:Menlo,monospace;font-size:13px}
a.btn{display:inline-block;margin-top:18px;padding:10px 18px;background:#C8A84B;color:white;border-radius:8px;text-decoration:none;font-weight:600}</style></head>
<body><h1>${title}</h1>${body}<a class="btn" href="${returnTo}">← Back to OwnProperly</a></body></html>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const url = new URL(req.url)

  // ── HMRC redirected user back with ?code=&state= ──
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
    const state = decodeState(url.searchParams.get('state') || '')
    const returnTo = state.return_to || APP_RETURN_BASE
    const oauthError = url.searchParams.get('error')

    if (oauthError) {
      // User denied at HMRC, or HMRC rejected something
      const desc = url.searchParams.get('error_description') || ''
      return htmlPage(
        'HMRC connection cancelled',
        `<p>HMRC returned: <span class="err">${oauthError}${desc ? ' — ' + desc : ''}</span></p>
         <p>You can try again from <strong>Settings → MTD Tax</strong>.</p>`,
        returnTo,
      )
    }

    if (!state.user_id) {
      return htmlPage('Invalid OAuth state',
        `<p class="err">The state parameter from HMRC didn't include a user id. This usually means the link was forged or tampered with.</p>`,
        APP_RETURN_BASE)
    }

    if (!HMRC_CLIENT_ID || !HMRC_CLIENT_SECRET) {
      return htmlPage('HMRC not configured',
        `<p class="err">Server-side HMRC credentials aren't set. Justin needs to add HMRC_CLIENT_ID + HMRC_CLIENT_SECRET to Supabase secrets.</p>`,
        returnTo)
    }

    const code = url.searchParams.get('code')!

    // Exchange code for tokens.
    // HMRC uses POST form-encoded with client_id + client_secret in the body
    // (NOT Basic auth, unlike many providers).
    const tokenRes = await fetch(`${HMRC_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HMRC_CLIENT_ID,
        client_secret: HMRC_CLIENT_SECRET,
        redirect_uri: HMRC_OAUTH_REDIRECT,
        code,
      }),
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      return htmlPage('HMRC token exchange failed',
        `<p>HMRC rejected our token exchange request.</p>
         <p class="err">${tokenRes.status}: ${txt.slice(0, 400)}</p>
         <p>Common causes: redirect URI mismatch in HMRC dev hub, or wrong env (sandbox vs production).</p>`,
        returnTo)
    }

    const tokens = await tokenRes.json()
    // HMRC token response shape:
    //   { access_token, refresh_token, expires_in, scope, token_type }
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 14400) * 1000).toISOString()

    // Encrypt tokens at rest when OWNPROPERLY_TOKEN_KEY is configured.
    // Returns null when the key is absent → caller falls back to plaintext
    // columns so existing deployments without the secret keep working.
    let encAccess: string | null = null
    let encRefresh: string | null = null
    try {
      encAccess  = await encryptToken(tokens.access_token)
      encRefresh = await encryptToken(tokens.refresh_token)
    } catch (e) {
      // Bad OWNPROPERLY_TOKEN_KEY (wrong length etc) — surface clearly
      // instead of silently saving plaintext and giving the user a false
      // sense of security.
      return htmlPage('HMRC token encryption failed',
        `<p class="err">${(e as Error).message}</p>
         <p>Check the OWNPROPERLY_TOKEN_KEY supabase secret (must be exactly 64 hex chars).</p>`,
        returnTo)
    }

    // Persist tokens on the user's mtd_settings row. Upsert so this also
    // works if the user hasn't yet saved any other settings.
    const { error: upErr } = await admin.from('mtd_settings').upsert({
      user_id: state.user_id,
      // When we have ciphertext, NULL the plaintext column so a DB dump
      // alone can't impersonate the user. When we don't have a key, fall
      // back to plaintext so the legacy path keeps working.
      hmrc_access_token:           encAccess  ? null : tokens.access_token,
      hmrc_refresh_token:          encRefresh ? null : tokens.refresh_token,
      encrypted_hmrc_access_token:  encAccess  || null,
      encrypted_hmrc_refresh_token: encRefresh || null,
      hmrc_token_expires_at: expiresAt,
    }, { onConflict: 'user_id' })

    if (upErr) {
      return htmlPage('Could not save HMRC tokens',
        `<p class="err">${upErr.message}</p>`,
        returnTo)
    }

    // Success — bounce the user back into the app with a marker so the
    // MTD page can show a "Connected ✓" toast on first load.
    const sep = returnTo.includes('?') ? '&' : '?'
    return new Response(null, {
      status: 302,
      headers: { Location: `${returnTo}${sep}hmrc_connected=1` },
    })
  }

  // ── Programmatic "start" — return the authorize URL ──
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  try {
    const body = await req.json().catch(() => ({}))
    if (body.action !== 'start') return jsonError(400, 'Unknown action — expected {action:"start"}')

    if (!HMRC_CLIENT_ID) {
      return jsonError(503, 'HMRC OAuth not configured — set HMRC_CLIENT_ID supabase secret.')
    }

    const state = encodeState({
      user_id: caller.id,
      return_to: body.return_to || APP_RETURN_BASE,
      nonce: crypto.randomUUID(),
    })

    // HMRC's authorize URL lives on test-www / www tax.service.hmrc.gov.uk,
    // NOT on the api host. Derive from HMRC_BASE_URL.
    const isSandbox = HMRC_BASE_URL.includes('test-api')
    const authHost = isSandbox
      ? 'https://test-www.tax.service.hmrc.gov.uk'
      : 'https://www.tax.service.hmrc.gov.uk'

    const authorizeUrl = `${authHost}/oauth/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: HMRC_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: HMRC_OAUTH_REDIRECT,
      state,
    }).toString()

    return new Response(JSON.stringify({ authorize_url: authorizeUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }
})
