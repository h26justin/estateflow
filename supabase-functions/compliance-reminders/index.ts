// Runs daily via pg_cron. Finds compliance items expiring within their reminder_days
// window and emails the property owner.
//
// Email provider: Gmail API via Google Workspace service account with
// Domain-Wide Delegation. See ./gmail.ts for the helper. Justin: set
// GOOGLE_SA_KEY (full JSON contents) and GMAIL_SENDER (e.g.
// noreply@ownproperly.com) as Supabase secrets.
//
// Migrated from Resend on 2026-05-24 to consolidate on the Google
// Workspace we're already paying for. RESEND_API_KEY env var no longer
// needed but kept in code as a fallback path during the transition.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { sendGmail } from './gmail.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const GMAIL_SENDER = Deno.env.get('GMAIL_SENDER') || 'noreply@ownproperly.com'
// Useful for testing without spamming real users
const EMAIL_TEST_MODE = Deno.env.get('EMAIL_TEST_MODE') === '1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function certTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    gas: 'Gas Safety Certificate (CP12)',
    eicr: 'Electrical Installation Condition Report (EICR)',
    epc: 'Energy Performance Certificate (EPC)',
    pat: 'PAT Test',
    fire: 'Fire Risk Assessment',
    hmo: 'HMO Licence',
    legionella: 'Legionella Risk Assessment',
    alarm: 'Smoke/CO Alarm Test',
    insurance: 'Landlord Insurance',
  }
  return labels[type?.toLowerCase()] || type || 'Certificate'
}

// Where to send users to book a renewal. For now we link to the relevant
// trade body's "find a tradesperson" search — those are authoritative and
// free to use. When we have partner contracts with national contractor
// networks (Gas Safe Direct, Trustmark, etc.) these can swap to deep-link
// affiliate URLs that pay a referral fee per booking.
function renewalBookingUrl(type: string, postcode?: string | null): { label: string; url: string } | null {
  const t = type?.toLowerCase()
  const pc = (postcode || '').replace(/\s+/g, '+').trim()
  const pcq = pc ? `?postcode=${pc}` : ''
  const renewalMap: Record<string, { label: string; url: string }> = {
    gas:         { label: 'Find a Gas Safe engineer',     url: `https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/${pcq}` },
    eicr:        { label: 'Find an NICEIC electrician',   url: `https://www.niceic.com/find-a-contractor${pcq}` },
    // Link targets verified live 2026-07: the previous NAPIT/IFSM paths 404
    // and lcaregister.com no longer resolves at all.
    epc:         { label: 'Find an EPC assessor',         url: 'https://www.gov.uk/get-new-energy-certificate' },
    pat:         { label: 'Find a PAT tester',            url: 'https://search.napit.org.uk/' },
    fire:        { label: 'Find a fire risk assessor',    url: 'https://www.ifsm.org.uk/' },
    legionella:  { label: 'Find a legionella assessor',   url: 'https://www.legionellacontrol.org.uk/' },
    alarm:       { label: 'Find an electrician',          url: `https://www.niceic.com/find-a-contractor${pcq}` },
    insurance:   { label: 'Compare landlord insurance',   url: 'https://www.simplybusiness.co.uk/landlord-insurance/' },
    hmo:         { label: 'Apply on your council site',   url: 'https://www.gov.uk/house-in-multiple-occupation-licence' },
  }
  return renewalMap[t] || null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // CRON-only function — no JWT auth. Gate with shared secret (mirrors
  // trial-emails). Fails closed when CRON_SECRET isn't configured.
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Fetch all active (non-deleted) compliance items with expiry dates
    const { data: items, error } = await admin
      .from('compliance_items')
      // NB: the column is `cert_type` — there was an older `item_type` reference
      // that's been removed (the column doesn't exist in this schema). The
      // `|| i.item_type` fallbacks elsewhere in this file are belt-and-braces
      // for forward compatibility if the column ever gets re-added.
      .select('id, cert_type, cert_name, expiry_date, reminder_days, user_id, property_id, property:properties(id, name, address, deleted_at), last_reminder_sent_at')
      .is('deleted_at', null)
      .not('expiry_date', 'is', null)

    if (error) throw error

    const now = new Date()
    const eligibleItems = (items || []).filter(item => {
      // Skip if property was deleted
      if (item.property?.deleted_at) return false
      const days = daysUntil(item.expiry_date)
      const reminderDays = item.reminder_days || 30
      // Fire when item is within reminderDays window (including expired, but cap at -30 to stop nagging forever)
      if (days > reminderDays) return false
      if (days < -30) return false
      // Don't send if we already sent a reminder in the last 24 hours
      if (item.last_reminder_sent_at) {
        const lastSent = new Date(item.last_reminder_sent_at)
        const hoursSince = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60)
        if (hoursSince < 24) return false
      }
      return true
    })

    // Group by user_id
    const byUser: Record<string, any[]> = {}
    for (const item of eligibleItems) {
      if (!byUser[item.user_id]) byUser[item.user_id] = []
      byUser[item.user_id].push(item)
    }

    // Fetch user profiles for email + notification preferences
    const userIds = Object.keys(byUser)
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: 'No reminders due' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id, email, full_name, first_name, notifications')
      .in('user_id', userIds)

    const profileMap: Record<string, any> = {}
    ;(profiles || []).forEach(p => { profileMap[p.user_id] = p })

    const results: any[] = []
    for (const userId of userIds) {
      const profile = profileMap[userId]
      if (!profile?.email) {
        results.push({ user_id: userId, status: 'skipped', reason: 'no email' })
        continue
      }
      // Respect notification preferences (if user has opted out of compliance_expiry)
      const prefs = profile.notifications || {}
      if (prefs.compliance_expiry === false) {
        results.push({ user_id: userId, status: 'skipped', reason: 'opted out' })
        continue
      }

      const userItems = byUser[userId]
      // Sort by urgency (expired first, then soonest)
      userItems.sort((a: any, b: any) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))

      const itemRows = userItems.map((i: any) => {
        const days = daysUntil(i.expiry_date)
        const urgency = days < 0 ? `<span style="color:#DC2626;font-weight:700">EXPIRED ${Math.abs(days)} days ago</span>`
          : days === 0 ? `<span style="color:#DC2626;font-weight:700">EXPIRES TODAY</span>`
          : days <= 7 ? `<span style="color:#E0943A;font-weight:700">${days} days</span>`
          : `<span style="color:#5A6A7A">${days} days</span>`
        const booking = renewalBookingUrl(i.cert_type || i.item_type, i.property?.postcode)
        const bookingLink = booking
          ? `<br><a href="${booking.url}" target="_blank" rel="noreferrer" style="color:#C8A84B;font-size:11px;text-decoration:underline">${booking.label} →</a>`
          : ''
        return `
          <tr style="border-bottom:1px solid #E5E7EB">
            <td style="padding:10px 6px;font-size:13px">${certTypeLabel(i.cert_type || i.item_type)}${bookingLink}</td>
            <td style="padding:10px 6px;font-size:13px">${i.property?.name || i.property?.address || '—'}</td>
            <td style="padding:10px 6px;font-size:13px">${new Date(i.expiry_date).toLocaleDateString('en-GB')}</td>
            <td style="padding:10px 6px;font-size:13px;text-align:right">${urgency}</td>
          </tr>`
      }).join('')

      const firstName = profile.first_name || profile.full_name?.split(' ')[0] || 'there'

      const subject = userItems.length === 1
        ? `⚠ ${certTypeLabel(userItems[0].cert_type || userItems[0].item_type)} expiring soon`
        : `⚠ ${userItems.length} compliance certificates need attention`

      const html = `
              <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1A2530;">
                <div style="text-align:center;margin-bottom:24px">
                  <img src="https://www.ownproperly.com/logo.svg" alt="OwnProperly" style="height:36px"/>
                </div>
                <h2 style="margin:0 0 8px;font-size:22px">Hi ${firstName},</h2>
                <p style="color:#5A6A7A;line-height:1.6;margin-top:0">
                  ${userItems.length === 1 ? 'One of your compliance certificates' : `${userItems.length} of your compliance certificates`} ${userItems.length === 1 ? 'is' : 'are'} approaching expiry or already overdue. Non-compliance can result in fines of up to £30,000 and invalidates your insurance.
                </p>
                <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#F4F3EF;border-radius:10px;overflow:hidden">
                  <thead>
                    <tr style="background:#1A2530;color:white">
                      <th style="padding:10px 6px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Certificate</th>
                      <th style="padding:10px 6px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Property</th>
                      <th style="padding:10px 6px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Expires</th>
                      <th style="padding:10px 6px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Status</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}</tbody>
                </table>
                <div style="text-align:center;margin:28px 0">
                  <a href="https://www.ownproperly.com/#/properties" style="display:inline-block;background:#C8A84B;color:#1A2530;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">Review in OwnProperly</a>
                </div>
                <div style="background:#FEF3C7;border-left:4px solid #E0943A;padding:14px 18px;border-radius:6px;margin:24px 0">
                  <strong style="color:#92400E">Quick tip:</strong>
                  <span style="color:#78350F">Book renewals before they expire to avoid service disruption. Most contractors can schedule within 7-14 days.</span>
                </div>
                <p style="color:#9CA3AF;font-size:12px;margin-top:32px;text-align:center">
                  You're receiving this because compliance reminders are enabled.<br>
                  Manage preferences in <a href="https://www.ownproperly.com/#/settings/notifications" style="color:#C8A84B">Settings → Notifications</a>
                </p>
              </div>
            `

      try {
        // In test mode: log the recipient + skip the actual send. Used during
        // staging / dry-runs so we don't email real users while testing.
        if (EMAIL_TEST_MODE) {
          console.log(`[EMAIL_TEST_MODE] Would send "${subject}" to ${profile.email}`)
        } else if (Deno.env.get('GOOGLE_SA_KEY')) {
          // Primary path — Gmail API via Workspace service account
          await sendGmail({
            from: `OwnProperly <${GMAIL_SENDER}>`,
            to: profile.email,
            subject,
            html,
          })
        } else if (RESEND_API_KEY) {
          // Fallback — Resend, kept available until Gmail is fully verified
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `OwnProperly <${GMAIL_SENDER}>`,
              to: [profile.email],
              subject,
              html,
            }),
          })
          if (!res.ok) {
            const err = await res.text()
            throw new Error(`Resend send failed (${res.status}): ${err.slice(0, 200)}`)
          }
        } else {
          throw new Error('No email provider configured — set GOOGLE_SA_KEY (preferred) or RESEND_API_KEY')
        }

        // Mirror into the in-app notification centre. One row per certificate
        // so the user can click straight through to the property. We fire-and-
        // forget here — a notification insert failure shouldn't block marking
        // reminders sent or fail the cron run.
        try {
          const rows = userItems.map((i: any) => {
            const days = daysUntil(i.expiry_date)
            const certLabel = certTypeLabel(i.cert_type || i.item_type)
            const propLabel = i.property?.name || i.property?.address || 'a property'
            const urgency = days < 0 ? `Expired ${Math.abs(days)} days ago`
              : days === 0 ? 'Expires today'
              : `Expires in ${days} day${days === 1 ? '' : 's'}`
            const booking = renewalBookingUrl(i.cert_type || i.item_type, i.property?.postcode)
            return {
              user_id: userId,
              type: 'compliance',
              title: `${certLabel} — ${urgency}`,
              body: propLabel,
              link: i.property_id ? `#/detail/${i.property_id}/compliance` : '#/properties',
              metadata: {
                compliance_item_id: i.id,
                property_id: i.property_id,
                days_until: days,
                booking_url: booking?.url || null,
                booking_label: booking?.label || null,
              },
            }
          })
          if (rows.length > 0) await admin.from('notifications').insert(rows)
        } catch (_) { /* non-fatal — email still went out */ }

        // Mark items as reminded
        const ids = userItems.map((i: any) => i.id)
        await admin.from('compliance_items').update({ last_reminder_sent_at: now.toISOString() }).in('id', ids)

        // Log in audit_log
        await admin.from('audit_log').insert({
          user_id: userId,
          action: 'compliance.reminder_sent',
          entity_type: 'compliance',
          metadata: { items_count: userItems.length, item_ids: ids },
        })

        results.push({ user_id: userId, items: userItems.length, status: 'sent' })
      } catch (e) {
        results.push({ user_id: userId, status: 'error', error: (e as Error).message })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
