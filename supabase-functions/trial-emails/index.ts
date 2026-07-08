// Trial-onboarding email sender.
//
// Triggered daily by a pg_cron job. Looks at every user whose
// auth.users.created_at falls on one of the offset days (1, 3, 7, 11, 13),
// picks the right email template, and sends it via Resend.
//
// Suppression rules (any one = skip):
//   - User has a paid subscription (subscriptions.status='active' on any company)
//   - User opted out (user_profiles.email_unsubscribed=true)
//   - Already sent this template (trial_email_log row exists)
//   - User signed up via an invitation (no companies owned)
//
// Schedule (set up once via Supabase Dashboard → Database → Cron):
//
//   SELECT cron.schedule(
//     'trial-emails-daily',
//     '30 9 * * *',                                                       -- 09:30 UK every day
//     $$
//       SELECT net.http_post(
//         url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/trial-emails',
//         headers := jsonb_build_object(
//           'Content-Type', 'application/json',
//           'x-cron-secret', 'YOUR_CRON_SECRET_VALUE'
//         ),
//         body := jsonb_build_object('action', 'run_daily')
//       );
//     $$
//   );
//
// Env vars required:
//   RESEND_API_KEY
//   CRON_SECRET                  (so external callers can't trigger it)
//   APP_BASE_URL                 (default https://www.ownproperly.com)
//   CAL_BOOKING_URL              (default https://cal.com/ownproperly/onboarding)
//   FROM_EMAIL                   (default justin@ownproperly.com)

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') || ''
const CRON_SECRET     = Deno.env.get('CRON_SECRET') || ''
const APP_BASE_URL    = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
const CAL_URL         = Deno.env.get('CAL_BOOKING_URL') || 'https://cal.com/ownproperly/onboarding'
const FROM_EMAIL      = Deno.env.get('FROM_EMAIL') || 'Justin at OwnProperly <justin@ownproperly.com>'

// Day-offset → template-key lookup. Keep these in sync with EMAIL_SEQUENCES.md.
const TEMPLATES: Record<number, string> = {
  1:  'add_first_property',
  3:  'compliance_check',
  7:  'mtd_itsa_pitch',
  11: 'pricing_reminder',
  13: 'last_day',
}

// ── Email bodies ───────────────────────────────────────────────────────
// Plain-text only for simplicity (Resend renders this as text/plain; better
// deliverability than HTML for these "from a human" emails). If you want
// rich HTML versions later, add them to the same record under .html.
const BODY: Record<string, (ctx: any) => { subject: string; text: string }> = {
  add_first_property: ({ firstName, appUrl }) => ({
    subject: 'Quick start: your first property in 90 seconds',
    text: `Hi ${firstName},

Noticed you haven't added a property yet — totally normal, most people don't until they have 5 minutes spare.

Here's the fastest way to get value from the trial:

→ Add your first property: ${appUrl}/#/properties

You only need three fields to get going:
- Name (e.g. "Flat 1, Station Road")
- Full address
- Status (most likely "Rented" if it's already let)

Mortgage, value, rent — all those are optional and you can fill in over time. The app gets smarter the more you add but works fine with the basics.

If you have a block of flats, hit the "+ Add Block" button instead — it adds the whole building in one shot.

Justin
`,
  }),
  compliance_check: ({ firstName, appUrl }) => ({
    subject: 'The 4 expiry dates that catch landlords out',
    text: `Hi ${firstName},

Quick midweek tip. Most landlord fines I've seen don't come from "doing something wrong" — they come from missing an expiry date.

The four UK landlord compliance dates that catch people out:

· Gas Safety (CP12) — every 12 months. Unlimited fine + 6 months prison + automatic Section 21 invalidation.
· EICR (electrical) — every 5 years. Up to £30,000 fine.
· EPC — every 10 years (or when re-let if E or below). Up to £5,000 fine.
· Right to Rent — per tenant, ongoing for time-limited. Up to £20,000 per occupier.

OwnProperly emails you 90, 60, 30 and 7 days before each one expires. So you never have to remember.

→ Add your compliance dates: ${appUrl}/#/properties (click any property → Compliance tab)

If you've got a Gas Safety cert sitting in a pile of paper somewhere, take 30 seconds and type the expiry date in now. You'll thank yourself in 11 months.

Justin

P.S. Reply if anything's confusing about which certificates apply to your situation — happy to help directly.
`,
  }),
  mtd_itsa_pitch: ({ firstName, appUrl }) => ({
    subject: 'MTD ITSA — your first quarterly is due 5 August 2026',
    text: `Hi ${firstName},

If you've got rental income over £50,000, Making Tax Digital for Income Tax (MTD ITSA) goes live on 6 April 2026. From that day you have to file quarterly digital submissions to HMRC — annual self-assessment is gone.

The good news: this is one of the main reasons we built OwnProperly. Most other landlord tools haven't shipped MTD ITSA yet.

Timeline:
· April 2026 — mandatory if your previous-year rental income was above £50,000
· April 2027 — threshold drops to £30,000
· Quarterly submissions: four per year, each due one month + 7 days after quarter end
· First quarter (April–July 2026) is due 5 August 2026

In OwnProperly, you can practice the full submission flow today against HMRC's sandbox — no risk, no real data sent. Most landlords run 2-3 practice submissions before they trust the live flow.

→ Start MTD ITSA setup: ${appUrl}/#/mtd

It's a 3-minute setup: enter your NINO, click "Connect HMRC", sign in via gov.uk. Then run a practice quarter.

Justin

P.S. Section 24 mortgage interest restriction is baked into the calculations — your quarterly figures automatically include the 20% basic-rate credit so you don't have to remember.
`,
  }),
  pricing_reminder: ({ firstName, appUrl }) => ({
    subject: 'Your trial ends in 3 days — questions?',
    text: `Hi ${firstName},

Your free trial ends in 3 days. No pressure — but a heads-up so it doesn't surprise you.

Quick recap on pricing:
· £2/property/month — every feature, no minimums, no per-user fees
· Billed monthly, only for what you have
· Add/remove properties anytime, billed pro-rata

For most landlords that's £10–£50/month total. Less than the cost of one missed Gas Safety cert.

→ Add your card and continue: ${appUrl}/#/settings/billing

If you've decided OwnProperly isn't right, that's fine — you can just let the trial expire and your account moves to read-only. Your data stays safe and you can come back later.

If anything's holding you back, hit reply and tell me what's missing. Genuinely useful feedback.

Justin
`,
  }),
  last_day: ({ firstName, appUrl, calUrl }) => ({
    subject: 'Last day of your trial — want a call instead?',
    text: `Hi ${firstName},

Your trial ends tomorrow. Two options:

1. Add a card: ${appUrl}/#/settings/billing — continue with everything you've set up
2. Book a 15-min call with me: ${calUrl} — tell me what didn't work, get a personal walkthrough of anything you're stuck on

I want to know if we're not delivering for you. The fastest way to fix it is a real conversation, not another email. So if you're on the fence, please pick option 2.

If you decide OwnProperly isn't right after that, fine — but at least I'll have learnt something.

Justin
`,
  }),
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[trial-emails] No RESEND_API_KEY — would have sent to', to, ':', subject)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      reply_to: FROM_EMAIL.replace(/^.*<|>$/g, '').trim(),
      subject,
      text,
      headers: {
        'List-Unsubscribe': `<mailto:unsubscribe@ownproperly.com?subject=unsub-${encodeURIComponent(to)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`)
  }
}

serve(async (req) => {
  // CRON-only function — no JWT auth. Gate with shared secret.
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let totalSent = 0
  const errors: string[] = []

  for (const dayOffset of Object.keys(TEMPLATES).map(Number)) {
    const tplKey = TEMPLATES[dayOffset]
    const tplBuilder = BODY[tplKey]
    if (!tplBuilder) continue

    // Date range for users whose created_at = (today - dayOffset)
    const from = new Date(today); from.setDate(from.getDate() - dayOffset)
    const to   = new Date(from);  to.setDate(to.getDate() + 1)
    const fromStr = from.toISOString()
    const toStr   = to.toISOString()

    // Query candidates. Use auth.users via the admin API since the
    // service role can read it; we also pull user_profiles for name/optout.
    // Paginate — a single page:1 call silently stops covering anyone beyond
    // the first 200 accounts as the user base grows.
    const allUsers: any[] = []
    for (let page = 1; page <= 50; page++) {
      const { data: users, error: uerr } = await admin
        .auth.admin.listUsers({ page, perPage: 200 })
      if (uerr) { errors.push(`list users p${page}: ${uerr.message}`); break }
      const batch = users?.users || []
      allUsers.push(...batch)
      if (batch.length < 200) break
    }

    const candidates = allUsers.filter(u => {
      const c = u.created_at ? new Date(u.created_at).toISOString() : ''
      return c >= fromStr && c < toStr && !!u.email
    })

    if (candidates.length === 0) continue

    // Bulk-look up profiles + subscription status + already-sent log
    const ids = candidates.map(u => u.id)
    const [profilesRes, subsRes, logRes, companiesRes] = await Promise.all([
      admin.from('user_profiles').select('user_id, first_name, email_unsubscribed').in('user_id', ids),
      // Has-paid lookup: any company they own where subscriptions.status='active'
      admin.from('companies').select('id, owner_id, subscriptions!subscriptions_company_id_fkey(status)').in('owner_id', ids),
      admin.from('trial_email_log').select('user_id').in('user_id', ids).eq('day_offset', dayOffset),
      admin.from('companies').select('id, owner_id').in('owner_id', ids),
    ])

    const profileMap: Record<string, any> = {}
    for (const p of (profilesRes.data || [])) profileMap[p.user_id] = p
    const alreadySent = new Set((logRes.data || []).map((r: any) => r.user_id))
    const hasPaidUserIds = new Set<string>()
    for (const co of (subsRes.data || [])) {
      const subs = (co as any).subscriptions
      const sub = Array.isArray(subs) ? subs[0] : subs
      if (sub?.status === 'active') hasPaidUserIds.add((co as any).owner_id)
    }
    const ownedCompaniesByUser = new Set<string>()
    for (const co of (companiesRes.data || [])) ownedCompaniesByUser.add((co as any).owner_id)

    for (const user of candidates) {
      try {
        if (alreadySent.has(user.id)) continue
        if (hasPaidUserIds.has(user.id)) continue
        if (!ownedCompaniesByUser.has(user.id)) continue // tenant/collaborator, not trial customer
        const profile = profileMap[user.id] || {}
        if (profile.email_unsubscribed) continue

        const firstName = profile.first_name || (user.email || '').split('@')[0] || 'there'
        const tpl = tplBuilder({ firstName, appUrl: APP_BASE_URL, calUrl: CAL_URL })

        await sendEmail(user.email!, tpl.subject, tpl.text)

        await admin.from('trial_email_log').upsert({
          user_id: user.id,
          day_offset: dayOffset,
          template: tplKey,
        }, { onConflict: 'user_id,day_offset' })

        totalSent++
      } catch (e) {
        errors.push(`user ${user.id} day ${dayOffset}: ${(e as Error).message}`)
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true, sent: totalSent, errors: errors.slice(0, 50), date: ymd(today),
  }), { headers: { 'Content-Type': 'application/json' } })
})
