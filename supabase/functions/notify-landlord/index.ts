import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { type, property_id, message, title, priority, photos } = await req.json()

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    )

    // Get property + company + notification email
    const { data: property } = await adminClient
      .from('properties')
      .select('*, company:companies(*, company_settings:company_settings(tenant_notification_email))')
      .eq('id', property_id)
      .single()

    if (!property) throw new Error('Property not found')

    const notifyEmail = property.company?.company_settings?.[0]?.tenant_notification_email
      || property.company?.owner_email

    if (!notifyEmail) {
      return new Response(JSON.stringify({ skipped: true, reason: 'No notification email set' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const propName = property.address || property.name || 'Your property'
    const companyName = property.company?.name || 'OwnProperly'

    const isRepair = type === 'maintenance'
    const priorityColour = priority === 'urgent' ? '#E05555' : priority === 'high' ? '#E0943A' : '#4B8FE0'

    const photoHtml = photos && photos.length > 0
      ? `<div style="margin-top:16px">
          <p style="color:#666;font-size:13px;margin-bottom:8px">Photos attached by tenant:</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${photos.map((p: any) => `<a href="${p.url}" target="_blank"><img src="${p.url}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb"/></a>`).join('')}
          </div>
        </div>`
      : ''

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2D3C4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <span style="color:#C8A84B;font-size:18px;font-weight:bold">OwnProperly</span>
          <div style="color:#7A8899;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin-top:2px">PROPERTY MANAGEMENT</div>
        </div>
        <span style="background:${priorityColour}22;color:${priorityColour};font-size:11px;font-weight:bold;padding:4px 12px;border-radius:20px;border:1px solid ${priorityColour}44">
          ${isRepair ? (priority === 'urgent' ? '⚑ URGENT REPAIR' : priority === 'high' ? '⚑ HIGH PRIORITY REPAIR' : '🔧 REPAIR REQUEST') : '✉ TENANT MESSAGE'}
        </span>
      </div>
      <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <h2 style="color:#2D3C4A;font-size:20px;margin:0 0 6px">${isRepair ? (title || 'New repair request') : 'New message from tenant'}</h2>
        <p style="color:#999;font-size:12px;font-family:monospace;margin:0 0 20px">📍 ${propName} · ${companyName}</p>

        <div style="background:#f8f9fa;border-left:4px solid ${isRepair ? '#E0943A' : '#C8A84B'};border-radius:4px;padding:16px;margin-bottom:20px">
          <p style="color:#2D3C4A;font-size:14px;line-height:1.7;margin:0">${message || title || '—'}</p>
        </div>

        ${photoHtml}

        <a href="https://www.ownproperly.com" style="display:inline-block;margin-top:20px;background:#C8A84B;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">
          View in OwnProperly →
        </a>

        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
        <p style="color:#999;font-size:11px;margin:0">You are receiving this because a tenant submitted a ${isRepair ? 'repair request' : 'message'} at ${propName}. To manage notification settings, visit OwnProperly → Settings → Tenant Portal.</p>
      </div>
    </div>`

    const subject = isRepair
      ? `${priority === 'urgent' ? '⚑ URGENT: ' : priority === 'high' ? '⚑ ' : ''}New repair request — ${propName}`
      : `New tenant message — ${propName}`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'OwnProperly <notifications@ownproperly.com>',
        to: [notifyEmail],
        subject,
        html,
      }),
    })

    const result = await res.json()
    return new Response(JSON.stringify({ success: true, emailId: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
