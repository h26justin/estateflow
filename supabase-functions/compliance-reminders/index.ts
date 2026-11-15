// Runs daily via pg_cron. Finds compliance items that have reached a new
// reminder stage (see ./reminderStages.ts) and emails the people who
// currently look after the property.
//
// Recipients are resolved from CURRENT access, never from who created the
// row: the company owner (companies.owner_id) plus every member with a
// user_company_access row whose role still lets them view compliance. Each
// must have compliance_expiry reminders switched on, not be unsubscribed or
// banned, and the email goes only to their verified auth address. Companies
// that are not live (public.company_is_live) are skipped. Only the latest
// row per property + certificate type (alias-aware) can trigger a reminder,
// so a renewed certificate silences its expired predecessor.
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
import { secretMatches } from './secrets.ts'
import { shouldRemind } from './reminderStages.ts'

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

const validEmail = (e: string) => /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(e)
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// Legacy cert_type spellings → canonical catalogue key
// (src/lib/complianceCatalogue.js ALIAS_TO_KEY). Unknown types unchanged.
const CERT_ALIASES: Record<string, string> = {
  gas: 'gas_safety', gas_cert: 'gas_safety',
  alarm: 'smoke_alarm',
  hmo_licence: 'hmo',
  fire_risk_assessment: 'fire',
}
function canonicalCertType(t: string | null | undefined): string {
  const k = String(t || '').toLowerCase()
  return CERT_ALIASES[k] || k
}

// Every row of a query, past PostgREST's 1,000-row page. The builder must
// apply a stable .order().
async function fetchAllRows(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}
const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function certTypeLabel(type: string): string {
  // Keep in sync with src/lib/complianceCatalogue.js (canonical keys plus
  // legacy aliases — rows exist under both spellings).
  const labels: Record<string, string> = {
    gas: 'Gas Safety Certificate (CP12)',
    gas_safety: 'Gas Safety Certificate (CP12)',
    gas_cert: 'Gas Safety Certificate (CP12)',
    eicr: 'Electrical Installation Condition Report (EICR)',
    epc: 'Energy Performance Certificate (EPC)',
    pat: 'PAT Test',
    fire: 'Fire Risk Assessment',
    fire_risk_assessment: 'Fire Risk Assessment',
    fire_alarm_service: 'Fire Alarm Service',
    emergency_lighting: 'Emergency Lighting Test',
    hmo: 'HMO Licence',
    hmo_licence: 'HMO Licence',
    selective_licence: 'Selective Licence',
    legionella: 'Legionella Risk Assessment',
    alarm: 'Smoke/CO Alarm Test',
    smoke_alarm: 'Smoke Alarm Check',
    co_alarm: 'Carbon Monoxide Alarm Check',
    boiler_service: 'Boiler / Heating Service',
    chimney_sweep: 'Chimney Sweep',
    insurance: 'Landlord Insurance',
    tenancy_agreement: 'Tenancy Agreement',
    deposit_protection: 'Deposit Protection Certificate',
    right_to_rent: 'Right to Rent Check',
    rra_info_sheet: "Renters' Rights Information Sheet",
    inventory: 'Inventory / Check-in Report',
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
  // Canonical / expanded catalogue keys reuse the closest trade body above.
  const aliasMap: Record<string, string> = {
    gas_safety: 'gas', gas_cert: 'gas',
    hmo_licence: 'hmo',
    fire_risk_assessment: 'fire',
    smoke_alarm: 'alarm', co_alarm: 'alarm',
    fire_alarm_service: 'eicr',       // serviced by fire/electrical contractors
    emergency_lighting: 'eicr',
    boiler_service: 'gas',
  }
  const extras: Record<string, { label: string; url: string }> = {
    selective_licence: { label: 'Check your council’s licensing pages', url: 'https://www.gov.uk/find-local-council' },
    chimney_sweep:     { label: 'Find a registered chimney sweep',      url: 'https://www.findachimneysweep.co.uk/' },
  }
  return renewalMap[t] || renewalMap[aliasMap[t]] || extras[t] || null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // CRON-only function — no JWT auth. Gate with shared secret (mirrors
  // trial-emails). Fails closed when CRON_SECRET isn't configured.
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!secretMatches(cronSecret, CRON_SECRET)) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const now = new Date()

    // Non-deleted compliance items with an expiry, paged past the 1,000-row
    // cap. Lower bound only: anything that expired more than 30 days ago can
    // never remind (OVERDUE_CUTOFF) and, being earlier, can never supersede a
    // row that can. There is no safe upper bound — reminder_days is per item
    // and a far-future renewal must still be read so it supersedes the old
    // row it replaced.
    const cutoff = new Date(now)
    cutoff.setUTCDate(cutoff.getUTCDate() - 31)
    const cutoffIso = cutoff.toISOString().slice(0, 10)
    const items = await fetchAllRows((from, to) => admin
      .from('compliance_items')
      // NB: the column is `cert_type` — there was an older `item_type` reference
      // that's been removed (the column doesn't exist in this schema). The
      // `|| i.item_type` fallbacks elsewhere in this file are belt-and-braces
      // for forward compatibility if the column ever gets re-added.
      .select('id, cert_type, cert_name, expiry_date, reminder_days, user_id, property_id, property:properties(id, name, address, deleted_at, company_id), last_reminder_sent_at')
      .is('deleted_at', null)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', cutoffIso)
      .order('id')
      .range(from, to))

    // Collapse superseded certificates: only the latest expiry per property +
    // canonical certificate type can trigger a reminder (same rule as
    // src/lib/weeklySummary.js complianceSection).
    const latest = new Map<string, any>()
    for (const item of items) {
      if (!item.property || item.property.deleted_at || !item.property.company_id) continue
      const k = `${item.property_id}|${canonicalCertType(item.cert_type || item.item_type)}`
      const cur = latest.get(k)
      if (!cur || String(item.expiry_date) > String(cur.expiry_date)) latest.set(k, item)
    }

    const eligibleItems = [...latest.values()].filter(item =>
      // Staged: reminder_days, then 90/60/30/7/0 inside that window, then
      // weekly for 30 days after expiry. See ./reminderStages.ts.
      shouldRemind({
        days: daysUntil(item.expiry_date),
        reminderDays: item.reminder_days || 30, // 0/null → default window, as before
        lastSentAt: item.last_reminder_sent_at,
        now,
      }))

    // Group by the property's company.
    const byCompany: Record<string, any[]> = {}
    for (const item of eligibleItems) {
      const cid = item.property.company_id
      if (!byCompany[cid]) byCompany[cid] = []
      byCompany[cid].push(item)
    }

    const companyIds = Object.keys(byCompany)
    if (companyIds.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: 'No reminders due' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    // Recipients from CURRENT access: owner + members who may view compliance,
    // for live companies only.
    const companies: any[] = []
    for (const ids of chunks(companyIds, 100)) {
      companies.push(...await fetchAllRows((from, to) => admin.from('companies')
        .select('id, owner_id, deleted_at').in('id', ids).is('deleted_at', null).order('id').range(from, to)))
    }
    const members: any[] = []
    for (const ids of chunks(companyIds, 100)) {
      members.push(...await fetchAllRows((from, to) => admin.from('user_company_access')
        .select('*').in('company_id', ids).order('company_id').order('user_id').range(from, to)))
    }
    const byRecipient: Record<string, any[]> = {}
    for (const co of companies) {
      const { data: live, error: liveErr } = await admin.rpc('company_is_live', { p_company_id: co.id })
      if (liveErr) { results.push({ company_id: co.id, status: 'error', error: `company_is_live: ${liveErr.message}` }); continue }
      if (live !== true) { results.push({ company_id: co.id, status: 'skipped', reason: 'company not live' }); continue }
      const recips = new Set<string>()
      if (co.owner_id) recips.add(String(co.owner_id))
      for (const m of members) {
        // Pending email-only invitations (no user_id) do not count.
        if (m.company_id !== co.id || !m.user_id) continue
        if (m.permissions && m.permissions.view_compliance === false) continue
        recips.add(String(m.user_id))
      }
      for (const uid of recips) {
        if (!byRecipient[uid]) byRecipient[uid] = []
        byRecipient[uid].push(...byCompany[co.id])
      }
    }

    // Fetch user profiles for notification preferences
    const userIds = Object.keys(byRecipient)
    const profileMap: Record<string, any> = {}
    for (const ids of chunks(userIds, 200)) {
      const { data: profiles, error: profErr } = await admin
        .from('user_profiles')
        .select('user_id, full_name, first_name, notifications, email_unsubscribed')
        .in('user_id', ids)
      if (profErr) throw profErr
      ;(profiles || []).forEach(p => { profileMap[p.user_id] = p })
    }

    // Items already marked reminded in this run (one recipient's successful
    // send is enough; the stage dedupe in ./reminderStages.ts then stops a
    // repeat tomorrow).
    const marked = new Set<string>()

    for (const userId of userIds) {
      const profile = profileMap[userId] || {}
      // Respect notification preferences (if user has opted out of compliance_expiry)
      const prefs = profile.notifications || {}
      if (prefs.compliance_expiry === false) {
        results.push({ user_id: userId, status: 'skipped', reason: 'opted out' })
        continue
      }
      if (profile.email_unsubscribed === true) {
        results.push({ user_id: userId, status: 'skipped', reason: 'unsubscribed' })
        continue
      }

      // De-duplicate (a user can reach the same item through one company only,
      // but be defensive) and sort by urgency (expired first, then soonest).
      const userItems = [...new Map(byRecipient[userId].map((i: any) => [i.id, i] as [string, any])).values()]
      userItems.sort((a: any, b: any) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))

      try {
        // Only ever the verified auth address, never the user-editable
        // profile email.
        const { data: au, error: auErr } = await admin.auth.admin.getUserById(userId)
        if (auErr) throw new Error(auErr.message)
        const user = au?.user
        const email = String(user?.email || '').trim()
        if (!user || !validEmail(email)) { results.push({ user_id: userId, status: 'skipped', reason: 'no email' }); continue }
        if (user.banned_until && new Date(user.banned_until).getTime() > now.getTime()) {
          results.push({ user_id: userId, status: 'skipped', reason: 'banned' })
          continue
        }

        const itemRows = userItems.map((i: any) => {
          const days = daysUntil(i.expiry_date)
          const urgency = days < 0 ? `<span style="color:#DC2626;font-weight:700">EXPIRED ${Math.abs(days)} days ago</span>`
            : days === 0 ? `<span style="color:#DC2626;font-weight:700">EXPIRES TODAY</span>`
            : days <= 7 ? `<span style="color:#E0943A;font-weight:700">${days} days</span>`
            : `<span style="color:#5A6A7A">${days} days</span>`
          const booking = renewalBookingUrl(i.cert_type || i.item_type, i.property?.postcode)
          const bookingLink = booking
            ? `<br><a href="${esc(booking.url)}" target="_blank" rel="noreferrer" style="color:#C8A84B;font-size:11px;text-decoration:underline">${esc(booking.label)} →</a>`
            : ''
          return `
          <tr style="border-bottom:1px solid #E5E7EB">
            <td style="padding:10px 6px;font-size:13px">${esc(certTypeLabel(i.cert_type || i.item_type))}${bookingLink}</td>
            <td style="padding:10px 6px;font-size:13px">${esc(i.property?.name || i.property?.address || '—')}</td>
            <td style="padding:10px 6px;font-size:13px">${esc(new Date(i.expiry_date).toLocaleDateString('en-GB'))}</td>
            <td style="padding:10px 6px;font-size:13px;text-align:right">${urgency}</td>
          </tr>`
        }).join('')

        const firstName = profile.first_name || profile.full_name?.split(' ')[0] || 'there'

        // Subject is a header: no CR/LF from a free-text cert_type.
        const subject = (userItems.length === 1
          ? `⚠ ${certTypeLabel(userItems[0].cert_type || userItems[0].item_type)} expiring soon`
          : `⚠ ${userItems.length} compliance certificates need attention`).replace(/[\r\n]+/g, ' ')

        const html = `
              <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1A2530;">
                <div style="text-align:center;margin-bottom:24px">
                  <img src="https://www.ownproperly.com/brand/email-lockup.png" alt="Properly" style="height:40px;width:auto"/>
                </div>
                <h2 style="margin:0 0 8px;font-size:22px">Hi ${esc(firstName)},</h2>
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
                  <a href="https://www.ownproperly.com/#/properties" style="display:inline-block;background:#C8A84B;color:#1A2530;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">Review in Properly</a>
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

        // In test mode: log the recipient + skip the actual send. Used during
        // staging / dry-runs so we don't email real users while testing.
        if (EMAIL_TEST_MODE) {
          console.log(`[EMAIL_TEST_MODE] Would send "${subject}" to user ${userId}`)
        } else if (Deno.env.get('GOOGLE_SA_KEY')) {
          // Primary path — Gmail API via Workspace service account
          await sendGmail({
            from: `Properly <${GMAIL_SENDER}>`,
            to: email,
            subject,
            html,
          })
        } else if (RESEND_API_KEY) {
          // Fallback — Resend, kept available until Gmail is fully verified
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `Properly <${GMAIL_SENDER}>`,
              to: [email],
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

        // Mark items as reminded (once per item per run, however many
        // recipients it went to).
        const ids = userItems.map((i: any) => i.id)
        const toMark = ids.filter((id: string) => !marked.has(id))
        for (const part of chunks(toMark, 100)) {
          const { error: markErr } = await admin.from('compliance_items').update({ last_reminder_sent_at: now.toISOString() }).in('id', part)
          if (markErr) console.error('[compliance-reminders] mark failed:', markErr.message)
          else part.forEach((id: string) => marked.add(id))
        }

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
