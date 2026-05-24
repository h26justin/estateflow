// Notify landlord of tenant action.
//
// Called from tenant_portal.js when a tenant submits a maintenance
// request or sends a message. Looks up the property owner, inserts a
// notification row scoped to them (RLS won't let the tenant insert
// directly — that's why this needs a service-role edge function).
//
// Was referenced by submitMaintenanceRequest and sendTenantMessage
// but never deployed — meaning tenant-side actions silently failed
// to reach the landlord's bell. This commit fixes that gap.
//
// Body shape:
//   {
//     type: 'maintenance' | 'message',
//     property_id: uuid,
//     title: string,
//     message?: string,
//     priority?: 'low' | 'normal' | 'urgent',
//     photos?: array
//   }

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Auth — must be a valid tenant user. We don't lock down to "registered
  // tenant of this property" because that's a lot of policy for low
  // abuse risk; the worst case is a logged-in user spamming notifications
  // to a random landlord, which we can rate-limit later if needed.
  const authHeader = req.headers.get('Authorization') || ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Unauthorised' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const { type, property_id, title, message, priority, photos } = body
  if (!property_id || !title || !type) {
    return json({ error: 'property_id, type, title required' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Find the landlord (property owner). Property.user_id is the owner.
  const { data: prop } = await admin
    .from('properties')
    .select('id, name, address, user_id, company_id')
    .eq('id', property_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!prop) return json({ error: 'Property not found' }, 404)

  const propLabel = prop.name || prop.address || 'a property'
  const priorityTag = priority === 'urgent' ? '🔴 URGENT · ' : priority === 'high' ? '⚠️ HIGH · ' : ''

  const notif = type === 'maintenance'
    ? {
        user_id: prop.user_id,
        type: 'maintenance_ticket',
        title: `${priorityTag}🔧 Repair reported: ${title}`,
        body: `${propLabel} — ${message ? message.slice(0, 140) : 'Tenant has submitted a repair request.'}`,
        link: `#/detail/${property_id}/maintenance`,
        metadata: { property_id, priority: priority || 'normal', photos_count: (photos || []).length, sender_user_id: user.id },
      }
    : {
        user_id: prop.user_id,
        type: 'tenant_message',
        title: `💬 New message: ${propLabel}`,
        body: message ? message.slice(0, 200) : title,
        link: `#/detail/${property_id}/messages`,
        metadata: { property_id, sender_user_id: user.id },
      }

  const { error: insErr } = await admin.from('notifications').insert(notif)
  if (insErr) {
    console.error('notification insert failed', insErr)
    return json({ error: insErr.message }, 500)
  }

  return json({ ok: true, notified_user: prop.user_id })
})
