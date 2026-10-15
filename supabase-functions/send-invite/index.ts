// send-invite — emails a company-access invitation (Settings → Team & Access
// → Manage User Access → Invite). Called by the app with the invitation ids it
// has just inserted into public.invitations.
//
// Auth: deploy with verify_jwt = TRUE, and the caller must be the person who
// created the invitation(s). Until 2026-09-07 this function ran with the JWT
// check off and no in-code auth, so anyone who could guess an invitation id
// could make the platform email it. The client always calls it through
// supabase.functions.invoke while signed in, which attaches the session token.
//
// Anti-relay (15 Oct 2026): anyone can sign up, own a company and invite any
// address, so this function is rate-limited from public.invite_email_log
// (migration 2026-10-15_invite_email_log.sql — apply it BEFORE deploying; the
// function fails closed without it): per sender 8/hour and 20/day, per
// recipient 3/day across all senders, and the same invitation at most once an
// hour. The sender's email must be confirmed. Company / inviter names are
// attacker-controlled: in the subject they are reduced to a short single line
// with URLs stripped; in the HTML they are escaped.
//
// Source of record: this file. Pulled into the repo from the deployed v28.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { subjectSafe } from './sanitise.ts'

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_URL           = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
const FROM_EMAIL        = Deno.env.get('INVITE_FROM_EMAIL') || 'invites@ownproperly.com'
const BRAND             = 'Properly'

const SENDER_PER_HOUR     = 8
const SENDER_PER_DAY      = 20
const RECIPIENT_PER_DAY   = 3
const RESEND_INTERVAL_SEC = 3600

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Minimal HTML escaping for the few user-supplied strings that reach the email.
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const tooMany = (message: string, retryAfterSec: number) =>
  new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
  })

// Count invite_email_log rows matching `filter` since `seconds` ago.
// Throws on any DB error (callers fail closed).
async function countSince(seconds: number, filter: (q: any) => any): Promise<number> {
  const since = new Date(Date.now() - seconds * 1000).toISOString()
  const { count, error } = await filter(
    supabase.from('invite_email_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
  )
  if (error) throw new Error('invite_email_log count failed: ' + error.message)
  return count ?? 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // invite_email_log row reserved for this send; released if the email is
  // not actually sent, so a failed attempt doesn't burn the caller's quota.
  let reservedId: number | null = null
  let sent = false
  try {
    // Who is calling? The gateway has already validated the JWT (verify_jwt);
    // resolve it to a user so we can check they own the invitation.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Not signed in' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'Not signed in' }, 401)
    if (!user.email_confirmed_at) {
      return json({ error: 'Please confirm your email address before inviting others.' }, 403)
    }

    const { invitation_ids } = await req.json()
    if (!Array.isArray(invitation_ids) || !invitation_ids.length) return json({ error: 'Missing invitation_ids' }, 400)
    if (invitation_ids.length > 20) return json({ error: 'Too many invitations in one call' }, 400)

    const { data: invites, error: invErr } = await supabase
      .from('invitations')
      .select('*, company:companies(name, abbr, color)')
      .in('id', invitation_ids)

    if (invErr || !invites?.length) return json({ error: 'Invitations not found' }, 404)
    // Every invitation in the batch must have been created by the caller, and
    // all must be for the same recipient (one email per call).
    if (invites.some(i => i.invited_by !== user.id)) return json({ error: 'You can only send invitations you created' }, 403)
    const email = invites[0].email
    if (invites.some(i => i.email !== email)) return json({ error: 'All invitations in one call must be for the same person' }, 400)

    const inv = invites[0]

    // ── Anti-relay caps (fail closed on any counter error) ──────────────
    const recipient = String(email || '').trim().toLowerCase()
    if (!recipient) return json({ error: 'Invitation has no email address' }, 400)
    const ids = invites.map(i => i.id)
    try {
      if (await countSince(3600, q => q.eq('sender_id', user.id)) >= SENDER_PER_HOUR) {
        return tooMany(`You can send up to ${SENDER_PER_HOUR} invitation emails an hour. Please try again later.`, 3600)
      }
      if (await countSince(86_400, q => q.eq('sender_id', user.id)) >= SENDER_PER_DAY) {
        return tooMany(`You can send up to ${SENDER_PER_DAY} invitation emails a day. Please try again tomorrow.`, 86_400)
      }
      if (await countSince(86_400, q => q.eq('recipient_email', recipient)) >= RECIPIENT_PER_DAY) {
        return tooMany('This person has already been sent several invitations today. Please try again tomorrow.', 86_400)
      }
      if (await countSince(RESEND_INTERVAL_SEC, q => q.overlaps('invitation_ids', ids)) > 0) {
        return tooMany('This invitation was sent less than an hour ago. Please wait before re-sending.', RESEND_INTERVAL_SEC)
      }
      const { data: logRow, error: logErr } = await supabase
        .from('invite_email_log')
        .insert({ sender_id: user.id, recipient_email: recipient, invitation_ids: ids })
        .select('id')
        .single()
      if (logErr) throw new Error('invite_email_log insert failed: ' + logErr.message)
      reservedId = logRow?.id ?? null
    } catch (e) {
      console.error('send-invite rate-limit check failed:', (e as Error).message)
      return json({ error: 'Invitations are temporarily unavailable — please try again shortly.' }, 503)
    }
    const { data: inviterProfile } = await supabase
      .from('user_profiles')
      .select('full_name, email')
      .eq('user_id', inv.invited_by)
      .single()

    // Display names are attacker-controlled: single line, URLs stripped, capped,
    // then HTML-escaped. The inviter's (confirmed) email is the fallback.
    const inviterName = esc(subjectSafe(inviterProfile?.full_name, '', 80) || inviterProfile?.email || 'Someone')
    const acceptUrl   = `${APP_URL}?invite=${encodeURIComponent(inv.token)}`

    // Company colour lands in a style attribute — accept a plain hex colour only.
    const colourOf = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#C8A84B')
    const companyRows = invites.map(i => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #E2DFD8;">
          <span style="display:inline-block;background:${colourOf(i.company?.color)}22;color:${colourOf(i.company?.color)};font-family:'Courier New',monospace;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:8px;">${esc(subjectSafe(i.company?.abbr, '?', 8))}</span>
          <span style="font-size:13px;color:#1A1C26;">${esc(subjectSafe(i.company?.name, 'Unknown', 80))}</span>
          ${i.is_admin ? '<span style="margin-left:8px;font-family:monospace;font-size:10px;background:#C8A84B22;color:#A8862E;padding:2px 6px;border-radius:4px;">Admin</span>' : ''}
        </td>
      </tr>
    `).join('')

    const companySummary = invites.length === 1
      ? esc(subjectSafe(invites[0].company?.name, 'their company', 80))
      : `${invites.length} companies`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>You're invited to ${BRAND}</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#14202A;border-radius:14px 14px 0 0;padding:20px 28px;">
    <span style="display:inline-block;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">${BRAND}</span>
  </div>
  <div style="background:#ffffff;padding:32px 28px;border-left:1px solid #E2DFD8;border-right:1px solid #E2DFD8;">
    <p style="color:#6B7191;font-size:13px;font-family:'Courier New',monospace;margin:0 0 16px;">Hi there,</p>
    <h2 style="color:#1A1C26;font-size:22px;margin:0 0 12px;font-weight:600;">You've been invited to join ${BRAND}</h2>
    <p style="color:#4A4A4A;line-height:1.7;font-family:'Courier New',monospace;font-size:13px;margin:0 0 20px;">
      <strong>${inviterName}</strong> has invited you to access <strong>${companySummary}</strong> on ${BRAND}, a property portfolio management platform.
    </p>
    <div style="border:1px solid #E2DFD8;border-radius:10px;overflow:hidden;margin:0 0 24px;">
      <div style="background:#F4F3EF;padding:10px 12px;border-bottom:1px solid #E2DFD8;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#6B7191;text-transform:uppercase;letter-spacing:0.1em;">${invites.length === 1 ? 'Invited to' : `Invited to ${invites.length} companies`}</span>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">${companyRows}</table>
      <div style="padding:10px 12px;background:#F4F3EF;">
        <span style="font-family:'Courier New',monospace;font-size:11px;color:#6B7191;">Invited by ${inviterName}</span>
      </div>
    </div>
    <a href="${acceptUrl}" style="display:inline-block;background:#14202A;color:white;font-family:'Courier New',monospace;font-size:13px;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:24px;">Accept invitation →</a>
    <div style="border-top:1px solid #E2DFD8;padding-top:16px;font-family:'Courier New',monospace;font-size:11px;color:#6B7191;line-height:1.8;">
      <strong>How to accept:</strong><br>
      1. Click the button above<br>
      2. Create your ${BRAND} account (or sign in if you already have one)<br>
      3. Your access will be activated automatically<br><br>
      This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.
    </div>
  </div>
  <div style="background:#F4F3EF;border:1px solid #E2DFD8;border-top:none;border-radius:0 0 14px 14px;padding:16px 28px;">
    <p style="margin:0;font-family:'Courier New',monospace;font-size:11px;color:#6B7191;">${BRAND} · Property Portfolio Management · <a href="${APP_URL}" style="color:#6B7191;">${APP_URL}</a></p>
  </div>
</div>
</body>
</html>`

    const subjectInviter = subjectSafe(inviterProfile?.full_name, 'A colleague')
    const subjectCompany = invites.length === 1
      ? subjectSafe(invites[0].company?.name, 'their company')
      : `${invites.length} companies`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${BRAND} <${FROM_EMAIL}>`,
        to: [email],
        subject: `${subjectInviter} invited you to join ${subjectCompany} on ${BRAND}`,
        html,
      }),
    })

    const resData = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(resData.message || 'Resend error')
    sent = true

    return json({ success: true, email_id: resData.id })
  } catch (err) {
    console.error('send-invite error:', err)
    if (reservedId && !sent) {
      const { error: relErr } = await supabase.from('invite_email_log').delete().eq('id', reservedId)
      if (relErr) console.error('send-invite: could not release log row:', relErr.message)
    }
    return json({ error: 'Could not send the invitation — please try again' }, 500)
  }
})
