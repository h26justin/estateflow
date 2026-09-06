// Nightly production audit.
//
// Runs every night at 05:15 UTC via pg_cron (see
// supabase-migrations/2026-08-09_nightly_audit.sql), sweeps the whole stack,
// and emails a tick/cross digest:
//
//   Website     — marketing site, legal pages, blog + SEO landing pages,
//                 JS bundle, service-worker build age, tenant-portal
//                 subdomains (HTTP + branding RPC)
//   Platform    — Supabase auth health, REST reachability, cron job health,
//                 pg_net failures, signup canary (the full user → profile →
//                 company chain, incl. the pgcrypto statement-token trigger
//                 that silently killed signups May–Aug 2026)
//   Money       — Stripe key validity, webhook endpoint enabled, undelivered
//                 events, DB↔Stripe subscription drift, past-due subs, trials
//   Users       — signups, orphan auth users, trial emails, invites
//   Syncs       — autopilot, Lodgify STL, Xero, compliance reminders, EPC,
//                 weekly backups
//   Security    — RLS coverage, SECURITY DEFINER search_path pinning,
//                 soft-delete purge horizon
//
// SQL-side checks live in public.nightly_audit_checks() (service-role only).
// Every run is stored in public.nightly_audit_runs.
//
// Env vars required:
//   CRON_SECRET                  (x-cron-secret gate, fail-closed)
//   RESEND_API_KEY               (digest email; also used for domain check)
//   STRIPE_SECRET_KEY            (read-only API checks)
//   AUDIT_EMAIL_TO               (default justin@forta.productions)
//   FROM_EMAIL                   (default Justin at Properly <justin@ownproperly.com>)
//   APP_BASE_URL                 (default https://www.ownproperly.com)
//
// Body flags (JSON): { "dry_run": true }     — skip the email
//                    { "skip_canary": true } — skip the synthetic signup

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const CRON_SECRET    = Deno.env.get('CRON_SECRET') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const STRIPE_KEY     = Deno.env.get('STRIPE_SECRET_KEY') || ''
const AUDIT_EMAIL_TO = Deno.env.get('AUDIT_EMAIL_TO') || 'justin@forta.productions'
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') || 'Justin at Properly <justin@ownproperly.com>'
const BASE           = Deno.env.get('APP_BASE_URL') || 'https://www.ownproperly.com'
const APEX           = BASE.replace('://www.', '://')

type Status = 'ok' | 'warn' | 'fail'
interface Check {
  name: string
  group: 'website' | 'platform' | 'money' | 'users' | 'syncs' | 'security'
  label: string
  status: Status
  detail: string
}

const EMOJI: Record<Status, string> = { ok: '🟢', warn: '🟡', fail: '🔴' }

// ── HTTP probe helper ──────────────────────────────────────────────────
async function probe(url: string, marker?: string, timeoutMs = 10000, headers?: Record<string, string>):
  Promise<{ ok: boolean; status: number; ms: number; body: string; err?: string }> {
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers })
    const body = await res.text()
    clearTimeout(timer)
    const markerOk = marker ? body.includes(marker) : true
    return { ok: res.status === 200 && markerOk, status: res.status, ms: Date.now() - started, body }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, body: '', err: String(e).slice(0, 120) }
  }
}

// ── Website checks ─────────────────────────────────────────────────────
async function websiteChecks(subdomains: string[]): Promise<Check[]> {
  const checks: Check[] = []

  const [home, apex, privacy, terms, security, blog, mtd, s24, best, sitemap, robots, sw] =
    await Promise.all([
      probe(`${BASE}/`, '<title>Properly'),
      probe(`${APEX}/`, '<title>Properly'),
      probe(`${BASE}/privacy`), probe(`${BASE}/terms`), probe(`${BASE}/security`),
      probe(`${BASE}/blog/`, 'Properly Blog'),
      probe(`${BASE}/mtd-itsa-landlord-software/`, 'MTD ITSA'),
      probe(`${BASE}/section-24-calculator/`, 'Section 24'),
      probe(`${BASE}/best-landlord-software-uk/`, 'Best Landlord Software'),
      probe(`${BASE}/sitemap.xml`, '<urlset'),
      probe(`${BASE}/robots.txt`, 'Sitemap'),
      probe(`${BASE}/sw.js`, 'BUILD_ID'),
    ])

  const legalUp = [privacy, terms, security].filter(p => p.ok).length
  checks.push({
    name: 'site', group: 'website', label: 'Marketing site',
    status: home.ok && apex.ok && legalUp === 3 ? 'ok' : 'fail',
    detail: `www ${home.status} in ${home.ms}ms · apex ${apex.status} · legal pages ${legalUp}/3`
            + (home.err ? ` · ${home.err}` : ''),
  })

  const lps = [blog, mtd, s24, best]
  const lpsUp = lps.filter(p => p.ok).length
  checks.push({
    name: 'landing', group: 'website', label: 'Blog & landing pages',
    status: lpsUp === 4 ? 'ok' : (lpsUp >= 2 ? 'warn' : 'fail'),
    detail: `${lpsUp}/4 up with markers (blog, MTD, S24, comparison)`,
  })

  checks.push({
    name: 'seo_files', group: 'website', label: 'Sitemap & robots',
    status: sitemap.ok && robots.ok ? 'ok' : 'warn',
    detail: `sitemap ${sitemap.status} · robots ${robots.status}`,
  })

  // JS bundle: pull the hashed asset out of the SPA shell and fetch it —
  // catches a deploy that serves HTML but broken assets.
  let bundleCheck: Check = {
    name: 'bundle', group: 'website', label: 'App bundle',
    status: 'fail', detail: 'could not find bundle URL in index.html',
  }
  const m = home.body.match(/src="(\/assets\/[^"]+\.js)"/)
  if (m) {
    const asset = await probe(`${BASE}${m[1]}`)
    bundleCheck = {
      name: 'bundle', group: 'website', label: 'App bundle',
      status: asset.ok ? 'ok' : 'fail',
      detail: `${m[1].slice(0, 40)} → ${asset.status} in ${asset.ms}ms`,
    }
  }
  // Service-worker BUILD_ID is a base-36 ms timestamp → deploy age for free.
  const swm = sw.body.match(/const BUILD_ID = '([a-z0-9]+)'/)
  if (swm && swm[1] !== 'dev') {
    const ageDays = (Date.now() - parseInt(swm[1], 36)) / 86400000
    bundleCheck.detail += ` · build ${swm[1]} (${ageDays.toFixed(1)}d old)`
  } else {
    bundleCheck.status = bundleCheck.status === 'ok' ? 'warn' : bundleCheck.status
    bundleCheck.detail += ' · SW BUILD_ID missing/dev'
  }
  checks.push(bundleCheck)

  // Tenant portals: wildcard DNS + Vercel domain + branding RPC, per subdomain.
  const anon = createClient(SUPABASE_URL, ANON_KEY)
  const portalResults = await Promise.all(subdomains.map(async sub => {
    const [http, rpc] = await Promise.all([
      probe(`https://${sub}.ownproperly.com/`, '<title>Properly'),
      anon.rpc('get_company_branding_by_subdomain', { p_subdomain: sub }),
    ])
    const rpcOk = !rpc.error && rpc.data != null
    return { sub, ok: http.ok && rpcOk, why: !http.ok ? `http ${http.status}` : (!rpcOk ? 'branding RPC null' : '') }
  }))
  const badPortals = portalResults.filter(p => !p.ok)
  checks.push({
    name: 'portals', group: 'website', label: 'Tenant portals',
    status: badPortals.length === 0 ? 'ok' : 'warn',
    detail: `${portalResults.length - badPortals.length}/${portalResults.length} subdomains live + branded`
            + (badPortals.length ? ` · failing: ${badPortals.map(p => `${p.sub} (${p.why})`).join(', ')}` : ''),
  })

  return checks
}

// ── Platform checks (auth + REST) ──────────────────────────────────────
async function platformChecks(): Promise<Check[]> {
  // Auth health sits behind the API gateway, so it needs the anon apikey —
  // without it it 401s even when perfectly healthy (first-run lesson).
  const auth = await probe(`${SUPABASE_URL}/auth/v1/health`, undefined, 10000, { apikey: ANON_KEY })
  // REST liveness: the /rest/v1/ root is service-role-only on this project,
  // so probe the one RPC that is anon-callable by design. Empty subdomain
  // returns null with a 200 — proves PostgREST + Postgres end to end.
  let restOk = false, restStatus = 0
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_company_branding_by_subdomain`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_subdomain: '' }),
    })
    restOk = res.status === 200; restStatus = res.status
  } catch { /* unreachable */ }
  return [
    { name: 'auth_health', group: 'platform', label: 'Auth service',
      status: auth.ok ? 'ok' : 'fail', detail: auth.ok ? `healthy (${auth.ms}ms)` : `status ${auth.status}` },
    { name: 'rest', group: 'platform', label: 'REST API',
      status: restOk ? 'ok' : 'fail', detail: restOk ? 'reachable' : `status ${restStatus}` },
  ]
}

// ── Signup canary ──────────────────────────────────────────────────────
// Exercises the real chain a new customer hits: auth signup → RLS'd
// user_profiles upsert → create_company_for_owner RPC (fires the pgcrypto
// statement-token trigger + trial grant). Cleans up after itself.
async function signupCanary(admin: any): Promise<Check> {
  const email = `audit-canary+${Date.now()}@ownproperly.com`
  const password = crypto.randomUUID() + 'Aa1!'
  const started = Date.now()
  let uid: string | null = null
  let companyId: string | null = null
  const fail = (detail: string): Check =>
    ({ name: 'canary', group: 'platform', label: 'Signup canary', status: 'fail', detail })

  try {
    const { data: created, error: cErr } =
      await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (cErr || !created?.user) return fail(`createUser: ${cErr?.message || 'no user'}`)
    uid = created.user.id

    // Sign in as the canary so every following step runs under RLS like a
    // real browser session would.
    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { error: sErr } = await userClient.auth.signInWithPassword({ email, password })
    if (sErr) return fail(`signIn: ${sErr.message}`)

    const { error: pErr } = await userClient.from('user_profiles')
      .upsert({ user_id: uid, email, full_name: 'Audit Canary' }, { onConflict: 'user_id' })
    if (pErr) return fail(`profile upsert: ${pErr.message}`)

    const { data: cid, error: rErr } = await userClient
      .rpc('create_company_for_owner', { p_name: 'Audit Canary Co', p_abbr: 'AUD', p_color: '#888888' })
    if (rErr) return fail(`create_company_for_owner: ${rErr.message}`)
    companyId = typeof cid === 'string' ? cid : (cid?.id ?? null)

    // Verify what the trigger chain should have produced.
    const { data: co, error: coErr } = await admin.from('companies')
      .select('id, statement_email_token, trial_ends_at')
      .eq('owner_id', uid).limit(1).single()
    if (coErr || !co) return fail(`company row missing: ${coErr?.message || '?'}`)
    companyId = co.id
    // Token format is <name-slug>-<12 hex chars from pgcrypto gen_random_bytes>;
    // the hex tail is the part that proves the pgcrypto trigger chain works.
    if (!/-[0-9a-f]{12}$/i.test(co.statement_email_token || ''))
      return fail(`statement_email_token malformed ('${String(co.statement_email_token).slice(0, 24)}…') — pgcrypto trigger regression?`)
    const trialDays = (new Date(co.trial_ends_at).getTime() - Date.now()) / 86400000
    if (!(trialDays > 7 && trialDays < 32))
      return fail(`trial_ends_at ${trialDays.toFixed(1)}d out (expected ~14d)`)

    return {
      name: 'canary', group: 'platform', label: 'Signup canary', status: 'ok',
      detail: `user → profile → company chain OK in ${((Date.now() - started) / 1000).toFixed(1)}s (token + ${trialDays.toFixed(0)}d trial verified)`,
    }
  } catch (e) {
    return fail(String(e).slice(0, 160))
  } finally {
    // Cleanup is best-effort but loud: a leftover canary shows up in the
    // next run's orphan/company counts if this ever breaks.
    try {
      if (companyId) {
        const del = await admin.from('companies').delete().eq('id', companyId)
        if (del.error) await admin.from('companies')
          .update({ deleted_at: new Date().toISOString() }).eq('id', companyId)
      }
      if (uid) {
        await admin.from('user_profiles').delete().eq('user_id', uid)
        await admin.auth.admin.deleteUser(uid)
      }
    } catch (e) {
      console.error('[nightly-audit] canary cleanup failed:', e)
    }
  }
}

// ── Stripe checks (read-only) ──────────────────────────────────────────
async function stripeChecks(admin: any): Promise<Check[]> {
  if (!STRIPE_KEY) {
    return [{ name: 'stripe', group: 'money', label: 'Stripe',
      status: 'warn', detail: 'STRIPE_SECRET_KEY not set — checks skipped' }]
  }
  const sget = async (path: string) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    })
    return { status: res.status, json: res.status === 200 ? await res.json() : null }
  }
  try {
    const dayAgo = Math.floor(Date.now() / 1000) - 86400
    const [hooks, events, subs, dbSubs] = await Promise.all([
      sget('webhook_endpoints?limit=10'),
      sget(`events?limit=100&created[gte]=${dayAgo}`),
      sget('subscriptions?status=all&limit=100'),
      admin.from('subscriptions').select('stripe_subscription_id, status'),
    ])
    if (hooks.status === 401) {
      return [{ name: 'stripe', group: 'money', label: 'Stripe',
        status: 'fail', detail: 'API key rejected (401)' }]
    }

    const checks: Check[] = []
    const hook = (hooks.json?.data || [])
      .find((h: any) => (h.url || '').includes('/functions/v1/stripe-webhook'))
    checks.push({
      name: 'stripe_webhook', group: 'money', label: 'Stripe webhook endpoint',
      status: hook && hook.status === 'enabled' ? 'ok' : 'fail',
      detail: hook ? `${hook.status} → …/stripe-webhook` : 'no endpoint pointing at stripe-webhook',
    })

    const evts = events.json?.data || []
    const undelivered = evts.filter((e: any) =>
      e.pending_webhooks > 0 && e.created < Math.floor(Date.now() / 1000) - 7200).length
    checks.push({
      name: 'stripe_delivery', group: 'money', label: 'Stripe events (API)',
      status: undelivered > 0 ? 'warn' : 'ok',
      detail: `${evts.length} event(s) 24h · ${undelivered} undelivered >2h`,
    })

    // DB ↔ Stripe drift on subscription status.
    const stripeMap = new Map<string, string>(
      (subs.json?.data || []).map((s: any) => [s.id, s.status]))
    const drift = (dbSubs.data || []).filter((r: any) =>
      r.stripe_subscription_id &&
      stripeMap.has(r.stripe_subscription_id) &&
      stripeMap.get(r.stripe_subscription_id) !== r.status)
    const missing = (dbSubs.data || []).filter((r: any) =>
      r.stripe_subscription_id && !stripeMap.has(r.stripe_subscription_id))
    checks.push({
      name: 'stripe_drift', group: 'money', label: 'Stripe ↔ DB drift',
      status: drift.length > 0 || missing.length > 0 ? 'warn' : 'ok',
      detail: `${drift.length} status mismatch(es) · ${missing.length} DB sub(s) unknown to Stripe`
              + (drift.length ? ` — ${drift.map((d: any) =>
                  `${d.stripe_subscription_id.slice(0, 14)}… db=${d.status}/stripe=${stripeMap.get(d.stripe_subscription_id)}`).join(', ')}` : ''),
    })
    return checks
  } catch (e) {
    return [{ name: 'stripe', group: 'money', label: 'Stripe',
      status: 'warn', detail: `API unreachable: ${String(e).slice(0, 100)}` }]
  }
}

// ── Resend deliverability ──────────────────────────────────────────────
async function resendCheck(): Promise<Check> {
  if (!RESEND_API_KEY) {
    return { name: 'resend', group: 'platform', label: 'Resend',
      status: 'warn', detail: 'RESEND_API_KEY not set — digest cannot email' }
  }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    })
    if (res.status !== 200) return { name: 'resend', group: 'platform', label: 'Resend',
      status: 'warn', detail: `domains API ${res.status}` }
    const doms = (await res.json())?.data || []
    const d = doms.find((x: any) => x.name === 'ownproperly.com')
    return {
      name: 'resend', group: 'platform', label: 'Resend',
      status: d && d.status === 'verified' ? 'ok' : 'warn',
      detail: d ? `ownproperly.com ${d.status}` : 'ownproperly.com not found in Resend',
    }
  } catch (e) {
    return { name: 'resend', group: 'platform', label: 'Resend',
      status: 'warn', detail: String(e).slice(0, 100) }
  }
}

// ── Digest assembly ────────────────────────────────────────────────────
const GROUPS: Array<[Check['group'], string]> = [
  ['website', 'Website'], ['platform', 'Platform'], ['money', 'Money'],
  ['users', 'Users & onboarding'], ['syncs', 'Syncs & jobs'], ['security', 'Security'],
]

function buildReport(checks: Check[], ranAt: Date): { overall: string; text: string } {
  const overall = checks.some(c => c.status === 'fail') ? 'RED'
    : checks.some(c => c.status === 'warn') ? 'AMBER' : 'GREEN'
  const head = overall === 'RED' ? '🔴' : overall === 'AMBER' ? '🟡' : '🟢'
  const when = ranAt.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })

  const lines: string[] = [
    `${head} Properly nightly audit — ${overall} · ${when} UTC`,
    '',
  ]
  for (const [key, title] of GROUPS) {
    const group = checks.filter(c => c.group === key)
    if (!group.length) continue
    lines.push(title)
    for (const c of group) lines.push(`${EMOJI[c.status]} ${c.label} — ${c.detail}`)
    lines.push('')
  }

  const attention = checks.filter(c => c.status !== 'ok')
  if (attention.length) {
    lines.push('Needs attention:')
    for (const c of attention) lines.push(`• ${c.label} — ${c.detail}`)
  } else {
    lines.push('All clear — no actions needed.')
  }
  lines.push('', `→ history: nightly_audit_runs · function: nightly-audit · cron: nightly-audit-daily (05:15 UTC)`)
  return { overall, text: lines.join('\n') }
}

async function sendEmail(subject: string, text: string): Promise<void> {
  if (!RESEND_API_KEY) { console.warn('[nightly-audit] no RESEND_API_KEY — email skipped'); return }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL, to: [AUDIT_EMAIL_TO],
      reply_to: FROM_EMAIL.replace(/^.*<|>$/g, '').trim(),
      subject, text,
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

// ── Main ───────────────────────────────────────────────────────────────
serve(async (req) => {
  // CRON-only function — no JWT auth. Gate with shared secret.
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  let flags: any = {}
  try { flags = await req.json() } catch { /* empty body is fine */ }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const ranAt = new Date()
  const checks: Check[] = []

  // SQL-side checks first — they also tell us which subdomains to probe.
  let subdomains: string[] = []
  try {
    const { data, error } = await admin.rpc('nightly_audit_checks')
    if (error) throw error
    checks.push(...(data?.checks || []))
    subdomains = data?.subdomains || []
  } catch (e) {
    checks.push({ name: 'db_checks', group: 'platform', label: 'DB checks',
      status: 'fail', detail: `nightly_audit_checks(): ${String(e).slice(0, 140)}` })
  }

  const [web, platform, canary, stripe, resend] = await Promise.all([
    websiteChecks(subdomains),
    platformChecks(),
    flags.skip_canary
      ? Promise.resolve<Check>({ name: 'canary', group: 'platform', label: 'Signup canary',
          status: 'warn', detail: 'skipped by flag' })
      : signupCanary(admin),
    stripeChecks(admin),
    resendCheck(),
  ])
  checks.push(...web, ...platform, canary, ...stripe, resend)

  // Stable ordering inside each group for a readable digest.
  const order = ['site', 'landing', 'seo_files', 'bundle', 'portals',
    'auth_health', 'rest', 'canary', 'cron', 'http_calls', 'db_checks', 'resend',
    'stripe_webhook', 'stripe_delivery', 'stripe_drift', 'stripe', 'stripe_events',
    'subscriptions', 'trials',
    'signups', 'orphan_users', 'trial_emails', 'invites',
    'autopilot', 'lodgify', 'xero', 'compliance_reminders', 'epc', 'backups',
    'rls', 'definers', 'purge']
  checks.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))

  const { overall, text } = buildReport(checks, ranAt)

  const errors: string[] = []
  try {
    const ins = await admin.from('nightly_audit_runs')
      .insert({ ran_at: ranAt.toISOString(), overall, report: text, results: checks })
    if (ins.error) errors.push(`store: ${ins.error.message}`)
  } catch (e) { errors.push(`store: ${String(e).slice(0, 100)}`) }

  if (!flags.dry_run) {
    try {
      const head = overall === 'RED' ? '🔴' : overall === 'AMBER' ? '🟡' : '🟢'
      await sendEmail(`${head} Properly nightly audit — ${overall}`, text)
    } catch (e) { errors.push(`email: ${String(e).slice(0, 100)}`) }
  }

  console.log(`[nightly-audit] ${overall} · ${checks.length} checks · errors: ${errors.join('; ') || 'none'}`)
  return new Response(JSON.stringify({ overall, checks, errors, report: text }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
