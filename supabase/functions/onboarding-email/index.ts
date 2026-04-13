import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAILS: Record<string, { subject: string; heading: string; body: string }> = {
  welcome: {
    subject: 'Welcome to OwnProperly 🏠',
    heading: 'Welcome to OwnProperly',
    body: `<p>Thanks for signing up. You're now set up to manage your entire property portfolio in one place.</p>
    <p><strong>Here's how to get started in 3 steps:</strong></p>
    <ol style="color:#374151;line-height:2;">
      <li>Add your first property under the Properties tab</li>
      <li>Set up compliance certificates so you never miss an expiry</li>
      <li>Invite your tenants to their portal from Settings → Tenant Portal</li>
    </ol>
    <p>If you have any questions, just reply to this email.</p>`
  },
  day3: {
    subject: 'Did you know OwnProperly has a deal analyser?',
    heading: '3 features you might have missed',
    body: `<p>You've been on OwnProperly for a few days — here are three things worth exploring:</p>
    <p><strong>🔢 Deal analyser</strong> — Analyse BTL, HMO, SA and BRRR deals with automatic SDLT calculation, yield and cash-on-cash returns. Great for analysing potential purchases.</p>
    <p><strong>🏠 Tenant portal</strong> — Invite your tenants to a branded portal where they can view rent history, submit repairs and download documents. Goes to Settings → Tenant Portal.</p>
    <p><strong>📊 20 reports</strong> — From arrears to tax summaries, the Reports tab has everything your accountant needs at tax time.</p>`
  },
  day7: {
    subject: 'Your first week on OwnProperly',
    heading: 'How\'s it going?',
    body: `<p>You've been using OwnProperly for a week — we hope it's making your portfolio easier to manage.</p>
    <p>A few tips from landlords who've been using it:</p>
    <p><strong>Set up compliance alerts</strong> — add your gas safety, EICR and EPC expiry dates so you get alerts before they expire. It takes 5 minutes and keeps you legally covered.</p>
    <p><strong>Upload your documents</strong> — store tenancy agreements and certificates in the Documents tab so everything is in one place.</p>
    <p>Questions or feedback? Just reply to this email — we read everything.</p>
    <p>— The OwnProperly team</p>`
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { email, name, sequence } = await req.json()
    const emailData = EMAILS[sequence]
    if (!emailData) throw new Error(`Unknown sequence: ${sequence}`)

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2D3C4A;padding:24px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#C8A84B;font-size:22px;font-weight:bold;">OwnProperly</span>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <h2 style="color:#2D3C4A;margin:0 0 20px;">${emailData.heading}${name ? `, ${name.split(' ')[0]}` : ''}</h2>
        <div style="color:#374151;font-size:15px;line-height:1.7;">${emailData.body}</div>
        <div style="margin:28px 0;text-align:center;">
          <a href="https://www.ownproperly.com" style="background:#C8A84B;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">
            Open OwnProperly →
          </a>
        </div>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
        <p style="color:#9CA3AF;font-size:12px;">OwnProperly · ownproperly.com · <a href="https://www.ownproperly.com" style="color:#9CA3AF;">Unsubscribe</a></p>
      </div>
    </div>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'OwnProperly <hello@ownproperly.com>',
        to: [email],
        subject: emailData.subject,
        html,
      }),
    })
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
