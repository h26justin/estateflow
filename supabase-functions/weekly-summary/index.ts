// Weekly portfolio summary: a short Monday-morning email to every landlord who
// has switched on Settings > Notifications > Weekly Summary
// (user_profiles.notifications.weekly_summary = true).
//
// Content (src/lib/weeklySummary.js, bundled into ./summary.bundle.js by
// scripts/build-weekly-summary.mjs so it runs the same rent engine as the
// Rent Tracker): rent due last week and month to date against what came in,
// arrears and the properties owing most, compliance due or overdue in the
// next 30 days, tenancies ending in the next 60 days, empty properties, and a
// link to the app and to the notification settings.
//
// Recipients, all must hold:
//   - user_profiles.notifications.weekly_summary === true
//   - user_profiles.email_unsubscribed is not true
//   - the user has an auth email and is not banned; the email goes to that
//     address only, never to anyone else
//   - at least one LIVE company (company_is_live rules) that the user owns
//     (companies.owner_id) or holds a user_company_access row for; only those
//     companies' properties are read, and each section is shown only where the
//     user's role allows it (view_rent / view_compliance / view_tenancies)
//   - not already sent this week (weekly_summary_log, PK user_id + week_start)
//
// This function uses the service role, which bypasses RLS: every query below
// is scoped by the user's own company ids, and buildWeeklySummary() drops any
// property outside them a second time.
//
// Scheduling: pg_cron calls this hourly (see
// supabase-migrations/2026-10-15_weekly_summary_log.sql). A run sends only on
// the send weekday at or after the send hour in Europe/London (Monday 07:00 by
// default), so a UTC cron covers GMT and BST. Each run sends at most
// WEEKLY_SUMMARY_BATCH emails; later runs that Monday pick up the rest, and
// the log row (claimed before sending, released if the send fails) stops
// repeats.
//
// Auth: x-cron-secret only (fails closed). Body options, all optional:
//   { "user_id": "<uuid>" }  only this user (all rules above still apply)
//   { "dry_run": true }      send nothing, write nothing; return the counts
//   { "preview": true }      needs user_id: send now, subject marked Preview,
//                            ignores the day / hour and the weekly log (does
//                            not mark the week sent). Opt-in, unsubscribe and
//                            scoping rules still apply.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY.
// Optional: APP_BASE_URL (default https://www.ownproperly.com),
// WEEKLY_SUMMARY_FROM (default "Properly <GMAIL_SENDER or
// noreply@ownproperly.com>"), WEEKLY_SUMMARY_WEEKDAY (0 = Sunday, default 1),
// WEEKLY_SUMMARY_HOUR (UK hour, default 7), WEEKLY_SUMMARY_BATCH (default 40).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { scopeCompanies, buildWeeklySummary, weeklySummaryEmail, weekStartFor } from './summary.bundle.js'
import { secretMatches } from './secrets.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
const FROM = Deno.env.get('WEEKLY_SUMMARY_FROM') || `Properly <${Deno.env.get('GMAIL_SENDER') || 'noreply@ownproperly.com'}>`
const intEnv = (k: string, d: number, lo: number, hi: number) => {
  const n = Number(Deno.env.get(k))
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d
}
const SEND_WEEKDAY = intEnv('WEEKLY_SUMMARY_WEEKDAY', 1, 0, 6)
const SEND_HOUR = intEnv('WEEKLY_SUMMARY_HOUR', 7, 0, 23)
const BATCH = intEnv('WEEKLY_SUMMARY_BATCH', 40, 1, 500)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validEmail = (e: string) => /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(e)

// Same joins the rent engine needs as fetchProperties, plus the compliance
// opt-outs. rent_payments.notes is read only for the engine's Xero
// net-of-fees rule and never reaches the email. No values, mortgage or tenant
// name / contact fields.
const PROPERTY_SELECT = 'id,user_id,company_id,name,status,rent_pcm,rent_due_day,tenancy_end,tenant_since,vacant_since,deleted_at,archived_at,compliance_optout,' +
  'company:companies(id,name),' +
  'rent_payments(id,property_id,year,month,month_label,status,amount,period_start,period_end,notes),' +
  'stl_bookings(id,rent_payment_id),' +
  'rent_receipts(id,received_date,amount,kind,payer,source,review_status,reverses_receipt_id,rent_allocations(id,rent_payment_id,target,amount,payment_plan_id)),' +
  'non_chargeable_periods(id,start_date,end_date,reason),' +
  'rent_overrides(id,rent_payment_id,state,reason,expected_amount,created_at),' +
  'tenancies(id,tenancy_start,tenancy_end,notice_received_date,expected_move_out,rent_amount,rent_frequency,rent_due_day,payment_window_days,status,payment_source,benefit_type,benefit_contribution,tenant_contribution,benefit_frequency,benefit_next_payment_date,benefit_paid_to,opening_arrears,opening_arrears_date)'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Weekday (0 = Sunday), hour and ISO date in Europe/London.
function londonNow(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { weekday, hour: Number(p.hour), iso: `${p.year}-${p.month}-${p.day}` }
}

// Every row of a query, past PostgREST's 1,000-row page.
async function allRows(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}
const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

// Everything one user's email needs, scoped to the companies they can see.
async function loadUser(admin: any, userId: string, now: Date) {
  const [owned, access] = await Promise.all([
    allRows((a, b) => admin.from('companies').select('id,name,owner_id,is_free_tier,trial_ends_at,deleted_at')
      .eq('owner_id', userId).is('deleted_at', null).order('id').range(a, b)),
    allRows((a, b) => admin.from('user_company_access').select('*').eq('user_id', userId).order('company_id').range(a, b)),
  ])
  const ownedIds = new Set(owned.map((c: any) => c.id))
  const sharedIds = [...new Set(access.map((r: any) => r.company_id).filter((id: string) => id && !ownedIds.has(id)))]
  const shared = sharedIds.length
    ? await allRows((a, b) => admin.from('companies').select('id,name,owner_id,is_free_tier,trial_ends_at,deleted_at')
        .in('id', sharedIds).is('deleted_at', null).order('id').range(a, b))
    : []
  const companies = [...owned, ...shared]
  const allIds = companies.map((c: any) => c.id)
  const subscriptions = allIds.length
    ? await allRows((a, b) => admin.from('subscriptions').select('company_id,status,stripe_subscription_id,current_period_end').in('company_id', allIds).order('company_id').range(a, b))
    : []
  const scoped = scopeCompanies({ userId, companies, access, subscriptions, now })
  if (!scoped.length) return { scoped, properties: [], complianceItems: [] }

  const scopedIds = new Set(scoped.map((c: any) => c.id))
  const properties = (await allRows((a, b) => admin.from('properties').select(PROPERTY_SELECT)
    .in('company_id', [...scopedIds]).is('deleted_at', null).is('archived_at', null).order('id').range(a, b)))
    .filter((p: any) => scopedIds.has(p.company_id))
  const complianceItems: any[] = []
  for (const ids of chunks(properties.map((p: any) => p.id), 100)) {
    complianceItems.push(...await allRows((a, b) => admin.from('compliance_items')
      .select('id,property_id,cert_type,cert_name,expiry_date,issue_date,deleted_at')
      .in('property_id', ids).is('deleted_at', null).order('id').range(a, b)))
  }
  return { scoped, properties, complianceItems }
}

async function sendEmail(to: string, subject: string, html: string, text: string, prefsUrl: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to], subject, html, text,
      headers: { 'List-Unsubscribe': `<${prefsUrl}>, <mailto:unsubscribe@ownproperly.com?subject=weekly-summary>` },
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!secretMatches(cronSecret, CRON_SECRET)) return new Response('Forbidden', { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch (_) { body = {} }
  const dryRun = body.dry_run === true
  const preview = body.preview === true && !dryRun
  const onlyUser = typeof body.user_id === 'string' ? body.user_id : null
  if (onlyUser && !UUID.test(onlyUser)) return json({ error: 'user_id must be a uuid' }, 400)
  if (preview && !onlyUser) return json({ error: 'preview needs user_id' }, 400)

  const nowDate = new Date()
  const now = londonNow(nowDate)
  const weekStart = weekStartFor(now.iso)
  const due = now.weekday === SEND_WEEKDAY && now.hour >= SEND_HOUR
  if (!preview && !dryRun && !due) return json({ london: now, skipped: 'not due' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  let profiles: any[]
  try {
    profiles = await allRows((a, b) => {
      let q = admin.from('user_profiles').select('user_id,first_name,notifications,email_unsubscribed')
        .eq('notifications->>weekly_summary', 'true').order('user_id').range(a, b)
      if (onlyUser) q = q.eq('user_id', onlyUser)
      return q
    })
  } catch (e) { return json({ error: (e as Error).message }, 500) }
  // Belt and braces on the opt-in and the opt-out.
  profiles = profiles.filter(p => p.user_id && p.notifications?.weekly_summary === true && p.email_unsubscribed !== true)

  // Users already sent this week.
  const sent = new Set<string>()
  if (!preview) {
    for (const ids of chunks(profiles.map(p => p.user_id), 200)) {
      const { data, error } = await admin.from('weekly_summary_log').select('user_id').eq('week_start', weekStart).in('user_id', ids)
      if (error) return json({ error: error.message }, 500)
      for (const r of data || []) sent.add(r.user_id)
    }
  }

  const results: any[] = []
  let attempted = 0
  for (const prof of profiles) {
    const uid = prof.user_id
    if (sent.has(uid)) { results.push({ user_id: uid, skipped: 'already sent this week' }); continue }
    if (!dryRun && attempted >= BATCH) { results.push({ user_id: uid, skipped: 'batch full, next run' }); continue }
    let claimed = false
    try {
      const { data: au, error: auErr } = await admin.auth.admin.getUserById(uid)
      if (auErr) throw new Error(auErr.message)
      const user = au?.user
      const email = String(user?.email || '').trim()
      if (!user || !validEmail(email)) { results.push({ user_id: uid, skipped: 'no email' }); continue }
      if (user.banned_until && new Date(user.banned_until).getTime() > nowDate.getTime()) { results.push({ user_id: uid, skipped: 'banned' }); continue }

      const { scoped, properties, complianceItems } = await loadUser(admin, uid, nowDate)
      if (!scoped.length) { results.push({ user_id: uid, skipped: 'no live company' }); continue }
      const model = buildWeeklySummary({ properties, companies: scoped, complianceItems, asOf: now.iso })
      if (!model.properties) { results.push({ user_id: uid, skipped: 'no properties' }); continue }

      if (dryRun) {
        results.push({
          user_id: uid, companies: model.companies, properties: model.properties,
          rent: model.rent && { lastWeek: model.rent.lastWeek, monthToDate: model.rent.monthToDate, arrears: model.rent.arrears.total, owing: model.rent.arrears.count },
          compliance: model.compliance && { overdue: model.compliance.overdue.length, dueSoon: model.compliance.dueSoon.length },
          tenanciesEnding: model.tenancies && model.tenancies.length, vacancy: model.vacancy,
        })
        continue
      }

      attempted++
      if (!preview) {
        // Claim the week first so an overlapping run cannot send twice.
        const { error: claimErr } = await admin.from('weekly_summary_log').insert({ user_id: uid, week_start: weekStart })
        if (claimErr) {
          if ((claimErr as any).code === '23505') { results.push({ user_id: uid, skipped: 'already sent this week' }); continue }
          throw new Error(`log: ${claimErr.message}`)
        }
        claimed = true
      }
      const mail = weeklySummaryEmail(model, { appUrl: APP_BASE_URL, firstName: prof.first_name || '', preview })
      await sendEmail(email, mail.subject, mail.html, mail.text, `${APP_BASE_URL.replace(/\/+$/, '')}/#/settings/notifications`)
      results.push({ user_id: uid, sent: true, preview, properties: model.properties })
    } catch (e) {
      const msg = (e as Error).message || String(e)
      console.error('[weekly-summary]', uid, msg)
      // Release the claim so the next hourly run can retry.
      if (claimed) await admin.from('weekly_summary_log').delete().eq('user_id', uid).eq('week_start', weekStart)
      results.push({ user_id: uid, error: msg.slice(0, 200) })
    }
  }

  const count = (k: string) => results.filter(r => r[k]).length
  return json({ london: now, week_start: weekStart, dry_run: dryRun, preview, candidates: profiles.length, sent: count('sent'), errors: count('error'), results })
})
