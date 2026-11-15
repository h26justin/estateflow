// Trial-onboarding email sender.
//
// Triggered daily by a pg_cron job. Looks at every user whose
// auth.users.created_at falls on one of the offset days (1, 3, 7, 11, 13),
// picks the right email template, and sends it via Resend.
//
// Day 0 (`welcome`) goes on the same daily run to users created in the last
// WELCOME_WINDOW_HOURS (36h, so a run that starts a little late still covers
// everyone since the previous run; trial_email_log stops a second send). It
// replaced the old client-side sendOnboardingEmail stub. Because the welcome
// and the day-1 email would otherwise land on the same run for anyone who
// signed up after the previous run, day 1 also looks at users created two
// days ago and holds off for anyone whose welcome went out in the last
// DAY1_GAP_HOURS: they get day 1 on the next run instead.
//
// Suppression rules (any one = skip):
//   - User has a paid subscription: any Stripe-backed live subscription on a
//     company they own (active / past_due, or trialing with a Stripe
//     subscription behind it — the subscription half of company_is_live)
//   - User opted out (user_profiles.email_unsubscribed=true)
//   - User is banned
//   - Already sent this template (trial_email_log row exists)
//   - User signed up via an invitation (no companies owned)
//
// Send-once: the trial_email_log row is claimed (plain insert; a unique
// violation means another run already has it) BEFORE sending and deleted
// again if the send fails, so overlapping runs cannot double-send and a
// failed send is retried next run. Nothing is logged when nothing was sent.
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
import { secretMatches } from './secrets.ts'
import { MONTHLY_FLOOR_GBP, PRICE_PER_PROPERTY_GBP } from './billing.ts'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') || ''
const CRON_SECRET     = Deno.env.get('CRON_SECRET') || ''
const APP_BASE_URL    = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
// The old fallback (cal.com/ownproperly/onboarding) 404'd — that Cal.com
// username was never registered — so the day-13 "last day" email sent every
// trialling user to a dead page. Fall back to a plain email ask; set the
// CAL_BOOKING_URL secret once a real booking page exists.
const CAL_URL         = Deno.env.get('CAL_BOOKING_URL') || 'hello@ownproperly.com (just reply to this email)'
const FROM_EMAIL      = Deno.env.get('FROM_EMAIL') || 'Justin at Properly <justin@ownproperly.com>'

// Day-offset → template-key lookup. Keep these in sync with EMAIL_SEQUENCES.md.
const TEMPLATES: Record<number, string> = {
  0:  'welcome',
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
  welcome: ({ firstName, appUrl }) => ({
    subject: 'Welcome to Properly: 14 days, no card needed',
    text: `Hi ${firstName},

Welcome to Properly. You've got 14 days to put it through its paces, every feature unlocked, no card needed.

Most landlords get a useful first win within 10 minutes. Three things worth doing today:

1. Add your company (one per legal entity: your own name if you own personally, or your SPV's name)
2. Add a property, or use "+ Add Block" if you've got a block of flats
3. Record one rent payment to see how the tracker works

→ Open Properly: ${appUrl}

If you'd rather be shown around, reply to this email and I'll set up a 15-minute call to walk you through it.

Anything broken or confusing? Just reply. It comes straight to me.

Justin
Founder, Properly

P.S. Making Tax Digital for Income Tax is live. Properly's MTD practice mode runs against HMRC's sandbox, so you can rehearse a quarterly submission today with zero risk.
`,
  }),
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

· Gas Safety (CP12) — every 12 months. Unlimited fine + up to 6 months in prison.
· EICR (electrical) — every 5 years. Up to £30,000 fine.
· EPC — every 10 years (or when re-let if E or below). Up to £5,000 fine.
· Right to Rent — per tenant, ongoing for time-limited. Up to £20,000 per occupier.

Properly emails you 30 days before each one expires, again 7 days before and on the day, then weekly for a few weeks if it lapses. Want more notice? Set an earlier reminder (say 90 days) on any certificate and you'll get 90- and 60-day reminders too.

→ Add your compliance dates: ${appUrl}/#/properties (click any property → Compliance tab)

If you've got a Gas Safety cert sitting in a pile of paper somewhere, take 30 seconds and type the expiry date in now. You'll thank yourself in 11 months.

Justin

P.S. Reply if anything's confusing about which certificates apply to your situation — happy to help directly.
`,
  }),
  mtd_itsa_pitch: ({ firstName, appUrl }) => ({
    subject: 'Making Tax Digital for landlords: what it means for you',
    text: `Hi ${firstName},

A quick one on Making Tax Digital for Income Tax (MTD ITSA), because it now applies to a lot of landlords.

Since 6 April 2026, landlords and sole traders whose qualifying income (rental plus self-employment, before expenses) is over £50,000 have to keep digital records and send HMRC quarterly updates from compatible software. The threshold is due to fall to £30,000 from April 2027.

The quarterly updates are due by:
· 7 August
· 7 November
· 7 February
· 7 May

You still finalise the year with HMRC after it ends, as now.

Properly is built for this. You can practise the full submission flow against HMRC's sandbox first: no risk, no real data sent.

→ Start MTD ITSA setup: ${appUrl}/#/mtd

It's a few minutes: enter your NINO, click "Connect HMRC", sign in via gov.uk. Then run a practice quarter.

If you're not sure whether MTD applies to you yet, check on gov.uk or ask your accountant.

Justin
`,
  }),
  pricing_reminder: ({ firstName, appUrl }) => ({
    subject: 'Your trial ends in 3 days — questions?',
    text: `Hi ${firstName},

Your free trial ends in 3 days. No pressure — but a heads-up so it doesn't surprise you.

Quick recap on pricing:
· Starter: £${PRICE_PER_PROPERTY_GBP.starter}/property/month
· Investor: £${PRICE_PER_PROPERTY_GBP.investor}/property/month
· Minimum £${MONTHLY_FLOOR_GBP}/month, no per-user fees
· Billed monthly; add or remove properties any time

Less than the cost of one missed Gas Safety cert.

→ Add your card and continue: ${appUrl}/#/settings/billing

If you've decided Properly isn't right, that's fine — you can just let the trial expire and your account moves to read-only. Your data stays safe and you can come back later.

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

If you decide Properly isn't right after that, fine — but at least I'll have learnt something.

Justin
`,
  }),
}

// Day 0 window and the minimum gap between the welcome and day 1.
const WELCOME_WINDOW_HOURS = 36
const DAY1_GAP_HOURS = 20
const HOUR = 3600 * 1000

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Subscription half of company_is_live (src/lib/subscriptionLive.js): a
// Stripe-backed live subscription counts as paid, including a card-backed
// trial and a past_due grace period.
function subscriptionIsPaid(s: any, now: Date): boolean {
  if (!s) return false
  if (s.status === 'active' || s.status === 'past_due') return true
  if (s.status !== 'trialing') return false
  if (s.stripe_subscription_id) return true
  return !!s.current_period_end && new Date(s.current_period_end).getTime() > now.getTime()
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  // Never report a send that did not happen (the caller logs on success).
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
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
      // mailto only: List-Unsubscribe-Post (one-click) needs an https URL
      // that unsubscribes on POST, which we do not have.
      headers: {
        'List-Unsubscribe': `<mailto:unsubscribe@ownproperly.com?subject=unsub-${encodeURIComponent(to)}>`,
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
  if (!secretMatches(cronSecret, CRON_SECRET)) {
    return new Response('Forbidden', { status: 403 })
  }

  // No provider: send nothing and log nothing.
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ ok: false, sent: 0, error: 'RESEND_API_KEY is not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  let totalSent = 0
  const errors: string[] = []

  // Query candidates. Use auth.users via the admin API since the
  // service role can read it; we also pull user_profiles for name/optout.
  // Paginate — a single page:1 call silently stops covering anyone beyond
  // the first 200 accounts as the user base grows. Listed once per run and
  // shared by every template.
  const allUsers: any[] = []
  for (let page = 1; page <= 50; page++) {
    const { data: users, error: uerr } = await admin
      .auth.admin.listUsers({ page, perPage: 200 })
    if (uerr) { errors.push(`list users p${page}: ${uerr.message}`); break }
    const batch = users?.users || []
    allUsers.push(...batch)
    if (batch.length < 200) break
  }

  // Ascending offsets: the welcome (0) is processed, and logged, before
  // day 1 checks for it.
  for (const dayOffset of Object.keys(TEMPLATES).map(Number).sort((a, b) => a - b)) {
    const tplKey = TEMPLATES[dayOffset]
    const tplBuilder = BODY[tplKey]
    if (!tplBuilder) continue

    // Date range for users whose created_at = (today - dayOffset). The
    // welcome uses a rolling window instead; day 1 reaches back one more
    // day for anyone held over because their welcome had only just gone.
    let fromStr: string, toStr: string
    if (dayOffset === 0) {
      fromStr = new Date(now.getTime() - WELCOME_WINDOW_HOURS * HOUR).toISOString()
      toStr = now.toISOString()
    } else {
      const from = new Date(today); from.setDate(from.getDate() - dayOffset - (dayOffset === 1 ? 1 : 0))
      const to   = new Date(today); to.setDate(to.getDate() - dayOffset + 1)
      fromStr = from.toISOString()
      toStr   = to.toISOString()
    }

    const candidates = allUsers.filter(u => {
      const c = u.created_at ? new Date(u.created_at).toISOString() : ''
      return c >= fromStr && c < toStr && !!u.email
    })

    if (candidates.length === 0) continue

    // Bulk-look up profiles + subscription status + already-sent log
    const ids = candidates.map(u => u.id)
    const [profilesRes, subsRes, logRes, companiesRes, welcomeRes] = await Promise.all([
      admin.from('user_profiles').select('user_id, first_name, email_unsubscribed').in('user_id', ids),
      // Has-paid lookup straight off subscriptions.owner_id — checks every
      // subscription row rather than only the first of a joined array (this
      // is also the variant that was live in prod).
      admin.from('subscriptions').select('owner_id, status, stripe_subscription_id, current_period_end').in('owner_id', ids),
      admin.from('trial_email_log').select('user_id').in('user_id', ids).eq('day_offset', dayOffset),
      admin.from('companies').select('id, owner_id').in('owner_id', ids),
      // Day 1 only: welcomes sent too recently to follow up yet.
      dayOffset === 1
        ? admin.from('trial_email_log').select('user_id').in('user_id', ids).eq('day_offset', 0)
            .gt('sent_at', new Date(now.getTime() - DAY1_GAP_HOURS * HOUR).toISOString())
        : Promise.resolve({ data: [] as any[], error: null }),
    ])
    // Fail closed on the lookups that suppress a send: a failed read must
    // never look like "not paid / not sent / not unsubscribed".
    const lookupErr = [profilesRes, subsRes, logRes, companiesRes, welcomeRes].find((r: any) => r.error) as any
    if (lookupErr) { errors.push(`day ${dayOffset} lookups: ${lookupErr.error.message}`); continue }
    const welcomedRecently = new Set((welcomeRes.data || []).map((r: any) => r.user_id))

    const profileMap: Record<string, any> = {}
    for (const p of (profilesRes.data || [])) profileMap[p.user_id] = p
    const alreadySent = new Set((logRes.data || []).map((r: any) => r.user_id))
    const hasPaidUserIds = new Set<string>()
    for (const s of (subsRes.data || [])) {
      if (subscriptionIsPaid(s, now)) hasPaidUserIds.add((s as any).owner_id)
    }
    const ownedCompaniesByUser = new Set<string>()
    for (const co of (companiesRes.data || [])) ownedCompaniesByUser.add((co as any).owner_id)

    for (const user of candidates) {
      try {
        if (alreadySent.has(user.id)) continue
        if (welcomedRecently.has(user.id)) continue // day 1 goes on the next run
        if (hasPaidUserIds.has(user.id)) continue
        if (!ownedCompaniesByUser.has(user.id)) continue // tenant/collaborator, not trial customer
        const profile = profileMap[user.id] || {}
        if (profile.email_unsubscribed) continue
        if (user.banned_until && new Date(user.banned_until).getTime() > now.getTime()) continue

        const firstName = profile.first_name || (user.email || '').split('@')[0] || 'there'
        const tpl = tplBuilder({ firstName, appUrl: APP_BASE_URL, calUrl: CAL_URL })

        // Claim the template first: a unique violation means another run
        // already sent (or is sending) it.
        const { error: claimErr } = await admin.from('trial_email_log').insert({
          user_id: user.id,
          day_offset: dayOffset,
          template: tplKey,
        })
        if (claimErr) {
          if ((claimErr as any).code === '23505') continue
          throw new Error(`log: ${claimErr.message}`)
        }
        try {
          await sendEmail(user.email!, tpl.subject, tpl.text)
        } catch (e) {
          // Release the claim so the next run retries.
          await admin.from('trial_email_log').delete().eq('user_id', user.id).eq('day_offset', dayOffset)
          throw e
        }

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
