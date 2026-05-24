// Gmail API sender — for outbound transactional email via Google Workspace.
//
// Uses a Google Cloud service account with Domain-Wide Delegation so we can
// impersonate noreply@ownproperly.com (or whatever address) without storing
// per-user OAuth tokens. This is the standard pattern for "send-as a workspace
// user from a backend" — it's how Postmark, Sendgrid etc. used to suggest you
// hook into Gmail before they existed.
//
// Setup (one-time, see top-level handover doc):
//   1. Google Cloud Console → new project → enable Gmail API
//   2. IAM → Create Service Account → download JSON key
//   3. Workspace Admin → Security → API Controls → Domain-wide delegation
//      Add the SA client_id, scope: https://www.googleapis.com/auth/gmail.send
//   4. Supabase secrets:
//      GOOGLE_SA_KEY    = <full JSON contents>
//      GMAIL_SENDER     = noreply@ownproperly.com
//
// File is colocated with compliance-reminders. If another edge function
// needs to send email, copy this file into its directory (Deno deploys are
// per-function isolated, so we can't symlink). Acceptable duplication while
// only one function sends mail.

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

// Cache the access token across invocations within a single Deno container
// (Supabase keeps containers warm for several minutes). Saves ~200ms per
// send by avoiding the OAuth round-trip when we already have a fresh token.
let _tokenCache: { token: string; expiresAt: number } | null = null

// ── JWT signing with Web Crypto (no external deps) ────────────────────
// Google expects an RS256-signed JWT with these claims:
//   { iss: SA email, scope, aud: token uri, iat, exp, sub: user to impersonate }
async function signJwt(sa: ServiceAccount, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    sub: subject,
  }
  const b64u = (s: string) => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const headerB64 = b64u(JSON.stringify(header))
  const claimsB64 = b64u(JSON.stringify(claims))
  const toSign = `${headerB64}.${claimsB64}`

  // Parse PEM-encoded private key
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')
  const binaryDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${toSign}.${sigB64}`
}

// Exchange a signed JWT for a short-lived Bearer token usable against the
// Gmail API. Google's token endpoint returns { access_token, expires_in }.
async function fetchAccessToken(sa: ServiceAccount, sender: string): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) return _tokenCache.token
  const jwt = await signJwt(sa, sender)
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
  return data.access_token
}

// Build a MIME multipart/alternative message (text + HTML). Encodes the
// Subject header as RFC 2047 UTF-8 so emojis don't get mangled.
function buildMime({ from, to, subject, html, text }: {
  from: string; to: string; subject: string; html: string; text?: string
}): string {
  const boundary = '=_OwnProperly_' + crypto.randomUUID()
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`
  const plainBody = text || html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    plainBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n')
}

// URL-safe base64 of a UTF-8 string — Gmail expects this for the `raw` field.
function gmailBase64(str: string): string {
  const utf8 = unescape(encodeURIComponent(str))
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Send a single email. Returns { id, threadId } from Gmail.
//
// Throws on any failure — caller should wrap in try/catch and log.
//
// `from` MUST be a workspace user that the service account is authorised
// to impersonate (set up via Domain-Wide Delegation in Workspace Admin).
// `from` accepts either bare email or "Display Name <email>".
export async function sendGmail({ from, to, subject, html, text }: {
  from?: string
  to: string
  subject: string
  html: string
  text?: string
}) {
  const saJson = Deno.env.get('GOOGLE_SA_KEY')
  if (!saJson) throw new Error('GOOGLE_SA_KEY not configured')
  const sender = Deno.env.get('GMAIL_SENDER') || 'noreply@ownproperly.com'
  const fromHeader = from || `OwnProperly <${sender}>`

  let sa: ServiceAccount
  try { sa = JSON.parse(saJson) }
  catch (e) { throw new Error('GOOGLE_SA_KEY is not valid JSON: ' + (e as Error).message) }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GOOGLE_SA_KEY missing client_email or private_key')
  }

  const accessToken = await fetchAccessToken(sa, sender)
  const mime = buildMime({ from: fromHeader, to, subject, html, text })
  const raw = gmailBase64(mime)

  const sendRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    },
  )

  if (!sendRes.ok) {
    const body = await sendRes.text()
    // If the token cache was stale, force a refresh next time
    if (sendRes.status === 401) _tokenCache = null
    throw new Error(`Gmail API ${sendRes.status}: ${body.slice(0, 300)}`)
  }
  return await sendRes.json() as { id: string; threadId: string }
}
