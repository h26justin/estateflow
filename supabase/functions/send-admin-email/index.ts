import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { to, subject, message, broadcast_filter } = await req.json()

    // Verify platform admin
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader! } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const { data: profile } = await userClient.from('user_profiles').select('platform_admin').eq('user_id', user.id).single()
    if (!profile?.platform_admin) throw new Error('Not authorised')

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SERVICE_ROLE_KEY')!)

    // Build recipient list
    let recipients: string[] = []
    if (to) {
      recipients = [to]
    } else {
      // Broadcast
      const { data: profiles } = await adminClient.from('user_profiles').select('email')
      recipients = (profiles || []).map((p: any) => p.email).filter(Boolean)
    }

    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2D3C4A;padding:24px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#C8A84B;font-size:20px;font-weight:bold;">OwnProperly</span>
        <span style="color:#7A8899;font-size:11px;display:block;margin-top:2px;">PROPERTY MANAGEMENT</span>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <h2 style="color:#2D3C4A;margin:0 0 16px;">${subject}</h2>
        <div style="color:#374151;font-size:15px;line-height:1.7;">${message.replace(/\n/g, '<br>')}</div>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
        <p style="color:#9CA3AF;font-size:12px;">OwnProperly · Property Portfolio Management</p>
      </div>
    </div>`

    let sent = 0
    for (const email of recipients) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'OwnProperly <hello@ownproperly.com>', to: [email], subject, html })
      })
      if (res.ok) sent++
    }

    return new Response(JSON.stringify({ success: true, sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
