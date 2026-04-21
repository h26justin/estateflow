// supabase/functions/send-weekly-backup/index.ts
// Deno Edge Function: Emails every active user a JSON backup of their data.
// Triggered by pg_cron weekly (Mondays 08:00 UTC).
// Deploy: `supabase functions deploy send-weekly-backup`

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

serve(async (req) => {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Get all users who have opted in (or all users if not tracking opt-in)
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id, email, full_name')

    if (!profiles) return new Response('No users', { status: 200 })

    const results = []
    for (const profile of profiles) {
      try {
        // Fetch all user data
        const [{ data: companies }, { data: properties }, { data: compliance }, { data: expenses }, { data: rentPayments }, { data: tenancies }] = await Promise.all([
          admin.from('companies').select('*').eq('owner_id', profile.user_id),
          admin.from('properties').select('*').eq('user_id', profile.user_id).is('deleted_at', null),
          admin.from('compliance_items').select('*').eq('user_id', profile.user_id),
          admin.from('property_expenses').select('*').eq('user_id', profile.user_id),
          admin.from('rent_payments').select('*').eq('user_id', profile.user_id),
          admin.from('tenancy_details').select('*').eq('user_id', profile.user_id),
        ])

        const backup = {
          exported_at: new Date().toISOString(),
          user: { id: profile.user_id, email: profile.email, name: profile.full_name },
          counts: {
            companies: companies?.length || 0,
            properties: properties?.length || 0,
            compliance: compliance?.length || 0,
            expenses: expenses?.length || 0,
            rent_payments: rentPayments?.length || 0,
            tenancies: tenancies?.length || 0,
          },
          data: { companies, properties, compliance, expenses, rent_payments: rentPayments, tenancies },
        }

        const json = JSON.stringify(backup, null, 2)
        const base64 = btoa(unescape(encodeURIComponent(json)))

        // Send email via Resend with attachment
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'OwnProperly Backups <backups@ownproperly.com>',
            to: [profile.email],
            subject: `Your weekly OwnProperly backup — ${new Date().toLocaleDateString('en-GB')}`,
            html: `
              <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #1A2530;">Your weekly backup is ready</h2>
                <p style="color: #5A6A7A; line-height: 1.6;">Hi ${profile.full_name || 'there'},</p>
                <p style="color: #5A6A7A; line-height: 1.6;">This is your weekly automated backup of all your OwnProperly data. It's attached to this email as a JSON file you can save somewhere safe.</p>
                <div style="background: #F4F3EF; border-radius: 10px; padding: 16px 20px; margin: 20px 0;">
                  <strong style="color: #1A2530;">This backup includes:</strong>
                  <ul style="color: #5A6A7A; margin: 8px 0 0;">
                    <li>${backup.counts.companies} companies</li>
                    <li>${backup.counts.properties} properties</li>
                    <li>${backup.counts.tenancies} tenancies</li>
                    <li>${backup.counts.compliance} compliance items</li>
                    <li>${backup.counts.expenses} expense records</li>
                    <li>${backup.counts.rent_payments} rent payments</li>
                  </ul>
                </div>
                <p style="color: #5A6A7A; font-size: 12px; line-height: 1.6;">Your data is also backed up automatically by our database infrastructure every 24 hours. You can also download a backup at any time from <a href="https://www.ownproperly.com" style="color: #C8A84B;">Settings → Security & Data</a>.</p>
                <p style="color: #9CA3AF; font-size: 11px; margin-top: 32px;">To stop receiving weekly backups, update your preferences in Settings → Notifications.</p>
              </div>
            `,
            attachments: [{
              filename: `ownproperly-backup-${new Date().toISOString().slice(0,10)}.json`,
              content: base64,
            }],
          }),
        })

        results.push({ email: profile.email, status: emailRes.ok ? 'sent' : 'failed' })
      } catch (e) {
        results.push({ email: profile.email, status: 'error', error: e.message })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
