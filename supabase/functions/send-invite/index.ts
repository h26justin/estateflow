import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { tenant_email, property_id, property_address, company_name, landlord_name } = await req.json()

    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader! } }
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const baseUrl = 'https://www.ownproperly.com'
    const inviteLink = `${baseUrl}?tenant_property=${property_id}`

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2D3C4A;padding:24px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#C8A84B;font-size:22px;font-weight:bold;">OwnProperly</span>
        <div style="color:#7A8899;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin-top:2px;">PROPERTY MANAGEMENT</div>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <h2 style="color:#2D3C4A;margin:0 0 8px;">You've been invited to your tenant portal</h2>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:20px;">
          ${landlord_name || company_name || 'Your landlord'} has set up a tenant portal for <strong>${property_address || 'your property'}</strong>.
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:24px;">
          Through your portal you can view your rent history, download documents, submit maintenance requests and send messages directly to your landlord.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${inviteLink}" style="background:#C8A84B;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">
            Set up your portal →
          </a>
        </div>
        <p style="color:#6B7280;font-size:13px;line-height:1.7;">
          You'll be asked to create a password to secure your account. Your portal is private — only you can see your information.
        </p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
        <p style="color:#9CA3AF;font-size:12px;">
          This invitation was sent by ${company_name || 'your landlord'} via OwnProperly · ownproperly.com
        </p>
      </div>
    </div>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'OwnProperly <invites@ownproperly.com>',
        to: [tenant_email],
        subject: `Your tenant portal is ready — ${property_address || 'your property'}`,
        html,
      }),
    })
    if (!res.ok) throw new Error('Failed to send email')
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch(err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
