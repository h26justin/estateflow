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
// Source of record: this file. Pulled into the repo from the deployed v28.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_URL           = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
const FROM_EMAIL        = Deno.env.get('INVITE_FROM_EMAIL') || 'invites@ownproperly.com'
const BRAND             = 'Properly'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Minimal HTML escaping for the few user-supplied strings that reach the email.
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Who is calling? The gateway has already validated the JWT (verify_jwt);
    // resolve it to a user so we can check they own the invitation.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Not signed in' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'Not signed in' }, 401)

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
    const { data: inviterProfile } = await supabase
      .from('user_profiles')
      .select('full_name, email')
      .eq('user_id', inv.invited_by)
      .single()

    const inviterName = esc(inviterProfile?.full_name || inviterProfile?.email || 'Someone')
    const acceptUrl   = `${APP_URL}?invite=${encodeURIComponent(inv.token)}`

    const companyRows = invites.map(i => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #E2DFD8;">
          <span style="display:inline-block;background:${esc(i.company?.color || '#C8A84B')}22;color:${esc(i.company?.color || '#C8A84B')};font-family:'Courier New',monospace;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:8px;">${esc(i.company?.abbr || '?')}</span>
          <span style="font-size:13px;color:#1A1C26;">${esc(i.company?.name || 'Unknown')}</span>
          ${i.is_admin ? '<span style="margin-left:8px;font-family:monospace;font-size:10px;background:#C8A84B22;color:#A8862E;padding:2px 6px;border-radius:4px;">Admin</span>' : ''}
        </td>
      </tr>
    `).join('')

    const companySummary = invites.length === 1
      ? esc(invites[0].company?.name || 'their company')
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

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${BRAND} <${FROM_EMAIL}>`,
        to: [email],
        subject: `${inviterProfile?.full_name || inviterProfile?.email || 'Someone'} invited you to join ${invites.length === 1 ? (invites[0].company?.name || 'their company') : `${invites.length} companies`} on ${BRAND}`,
        html,
      }),
    })

    const resData = await res.json()
    if (!res.ok) throw new Error(resData.message || 'Resend error')

    return json({ success: true, email_id: resData.id })
  } catch (err) {
    console.error('send-invite error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
