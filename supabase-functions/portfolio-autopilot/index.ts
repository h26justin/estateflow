// Portfolio Autopilot — daily cron agent.
//
// Runs daily via pg_cron (see supabase-migrations/2026-06-11_autopilot.sql).
// For every LIVE company it scans the portfolio and produces a prioritised
// list of DRAFTED actions:
//   - chase rent arrears (with a drafted reminder message)
//   - book gas / EICR / EPC (and other certs) before they expire
//   - flag tenancy renewals with a proposed rent
//   - flag mortgage product end dates (remortgage prompt)
//
// Every action is written to autopilot_actions with status 'open'. NOTHING is
// auto-sent or auto-executed — the landlord reviews/approves/dismisses each
// item in the Autopilot panel. Claude is used (optionally) only to polish the
// human-readable draft_body per action; token use is kept modest.
//
// Auth: CRON-only. Gated on the x-cron-secret header matching the CRON_SECRET
// function secret. Fails closed (403) if CRON_SECRET is unset. No JWT.
//
// Secrets used: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
// ANTHROPIC_API_KEY (optional — if unset, drafts fall back to deterministic
// templates so the feature still works).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

// Reuse the same model constant as extract-document for consistency.
const MODEL_PRIMARY = 'claude-sonnet-4-5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const DAY_MS = 86_400_000

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  if (isNaN(target.getTime())) return null
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / DAY_MS)
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return 'an upcoming date'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function certLabel(type: string | null): string {
  const labels: Record<string, string> = {
    gas: 'Gas Safety Certificate (CP12)',
    gas_safety: 'Gas Safety Certificate (CP12)',
    eicr: 'Electrical Installation Condition Report (EICR)',
    epc: 'Energy Performance Certificate (EPC)',
    pat: 'PAT Test',
    fire: 'Fire Risk Assessment',
    hmo: 'HMO Licence',
    legionella: 'Legionella Risk Assessment',
    alarm: 'Smoke/CO Alarm Test',
    insurance: 'Landlord Insurance',
  }
  return labels[(type || '').toLowerCase()] || type || 'Certificate'
}

// ── Action candidate type ────────────────────────────────────────────────────
type Candidate = {
  company_id: string
  user_id: string
  property_id: string | null
  kind: 'arrears' | 'compliance' | 'tenancy_renewal' | 'mortgage'
  severity: 'high' | 'medium' | 'low'
  title: string
  draft_body: string
  due_date: string | null
  dedupe_key: string
  metadata: Record<string, unknown>
}

// ── Claude draft polishing (optional, batched, modest tokens) ────────────────
// We send Claude a compact list of candidate actions and ask it to return a
// short, professional draft message per action. PII is minimised — tenant
// names are passed only where the action is a direct tenant communication
// (arrears chase / renewal) and the landlord will review before sending.
async function polishDrafts(candidates: Candidate[]): Promise<void> {
  if (!ANTHROPIC_API_KEY || candidates.length === 0) return

  const items = candidates.map((c, i) => ({
    i,
    kind: c.kind,
    context: c.title,
    facts: c.metadata,
  }))

  const prompt = `You are drafting short, professional messages a UK landlord can review and send. For each action below, write a concise draft (2-4 sentences, British English, polite, no placeholders like [NAME] unless a fact is genuinely missing). Arrears = a reminder to the tenant. Compliance = an internal note on booking the inspection. Tenancy renewal = a note proposing terms. Mortgage = an internal note to review remortgage options.

Return ONLY a JSON array of objects {"i": number, "draft": string} — no markdown, no commentary.

Actions:
${JSON.stringify(items, null, 2)}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_PRIMARY,
        max_tokens: 1800,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })
    if (!res.ok) return // keep template drafts on any API issue
    const data = await res.json()
    const text: string = data.content?.[0]?.text || ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return
    for (const row of parsed) {
      if (typeof row?.i === 'number' && candidates[row.i] && typeof row.draft === 'string' && row.draft.trim()) {
        candidates[row.i].draft_body = row.draft.trim()
      }
    }
  } catch (_) {
    // Non-fatal — deterministic template drafts remain in place.
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Fail closed: no JWT here, only the cron secret.
  if (!CRON_SECRET || (req.headers.get('x-cron-secret') || '') !== CRON_SECRET) {
    return json(403, { error: 'Forbidden' })
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 1. Live, non-deleted companies. Liveness mirrors company_is_live:
    //    free-tier companies are always live; paid companies are live while
    //    within trial OR holding an active subscription.
    const { data: companies, error: coErr } = await admin
      .from('companies')
      .select('id, owner_id, name, is_free_tier, trial_ends_at, deleted_at, subscriptions!subscriptions_company_id_fkey(status)')
      .is('deleted_at', null)
    if (coErr) throw coErr

    const now = Date.now()
    const liveCompanies = (companies || []).filter((co: any) => {
      if (co.is_free_tier) return true
      const trialOk = co.trial_ends_at && new Date(co.trial_ends_at).getTime() > now
      const subActive = Array.isArray(co.subscriptions)
        ? co.subscriptions.some((s: any) => s?.status === 'active')
        : co.subscriptions?.status === 'active'
      return Boolean(trialOk || subActive)
    })

    let totalActions = 0
    let notifiedUsers = 0

    for (const co of liveCompanies) {
      const companyId = co.id as string
      const ownerId = co.owner_id as string
      if (!ownerId) continue

      // 2. Pull this company's portfolio data.
      // properties has no postcode column — selecting it errors the query,
      // leaving every company with zero properties and no autopilot actions.
      const { data: properties } = await admin
        .from('properties')
        .select('id, name, address, rent_pcm, status, arrears, mortgage_product_end_date, user_id, deleted_at')
        .eq('company_id', companyId)
        .is('deleted_at', null)

      const props = (properties || []).filter((p: any) => p.status !== 'sold')
      if (props.length === 0) continue
      const propIds = props.map((p: any) => p.id)
      const propById: Record<string, any> = {}
      for (const p of props) propById[p.id] = p

      const [{ data: compliance }, { data: tenancies }, { data: rents }] = await Promise.all([
        admin.from('compliance_items')
          .select('id, property_id, cert_type, cert_name, expiry_date, deleted_at')
          .in('property_id', propIds).is('deleted_at', null).not('expiry_date', 'is', null),
        admin.from('tenancy_details')
          .select('id, property_id, tenant_names, tenancy_end, rent_review_date')
          .in('property_id', propIds),
        admin.from('rent_payments')
          .select('id, property_id, status, amount, year, month, month_label')
          .in('property_id', propIds).in('status', ['overdue', 'late', 'partial']),
      ])

      const candidates: Candidate[] = []
      const ownerOf = (p: any) => (p?.user_id as string) || ownerId

      // 3a. Arrears — property-level arrears field and overdue rent rows.
      for (const p of props) {
        if (Number(p.arrears) > 0) {
          candidates.push({
            company_id: companyId,
            user_id: ownerOf(p),
            property_id: p.id,
            kind: 'arrears',
            severity: Number(p.arrears) >= Number(p.rent_pcm || 0) ? 'high' : 'medium',
            title: `Rent arrears on ${p.name || p.address || 'a property'}`,
            draft_body: `Our records show outstanding rent of ${fmtGBP(Number(p.arrears))} on ${p.name || p.address}. Please arrange payment at your earliest convenience, or get in touch if you would like to discuss a payment plan.`,
            due_date: null,
            dedupe_key: `arrears:${p.id}`,
            metadata: { arrears: Number(p.arrears), rent_pcm: Number(p.rent_pcm || 0), property: p.name || p.address },
          })
        }
      }
      // Overdue/late/partial rent rows grouped per property (count of months).
      const overdueByProp: Record<string, { count: number; total: number; labels: string[] }> = {}
      for (const r of (rents || [])) {
        const k = r.property_id as string
        if (!overdueByProp[k]) overdueByProp[k] = { count: 0, total: 0, labels: [] }
        overdueByProp[k].count++
        overdueByProp[k].total += Number(r.amount || 0)
        if (r.month_label) overdueByProp[k].labels.push(r.month_label)
      }
      for (const [pid, agg] of Object.entries(overdueByProp)) {
        const p = propById[pid]
        if (!p || Number(p.arrears) > 0) continue // already covered by arrears field above
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: pid,
          kind: 'arrears',
          severity: agg.count >= 2 ? 'high' : 'medium',
          title: `${agg.count} unpaid rent ${agg.count === 1 ? 'period' : 'periods'} on ${p.name || p.address || 'a property'}`,
          draft_body: `We have ${agg.count} unpaid rent ${agg.count === 1 ? 'period' : 'periods'}${agg.labels.length ? ` (${agg.labels.slice(0, 4).join(', ')})` : ''} totalling ${fmtGBP(agg.total)}. Please arrange payment, or contact us to agree a way forward.`,
          due_date: null,
          dedupe_key: `arrears_rows:${pid}`,
          metadata: { unpaid_periods: agg.count, total: agg.total, property: p.name || p.address },
        })
      }

      // 3b. Compliance — anything expired or expiring within 60 days.
      for (const c of (compliance || [])) {
        const p = propById[c.property_id]
        if (!p) continue
        const d = daysUntil(c.expiry_date)
        if (d === null || d > 60) continue
        const label = c.cert_name || certLabel(c.cert_type)
        const expired = d < 0
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: c.property_id,
          kind: 'compliance',
          severity: expired || d <= 30 ? 'high' : 'medium',
          title: expired
            ? `${label} EXPIRED on ${p.name || p.address || 'a property'}`
            : `${label} expires in ${d}d on ${p.name || p.address || 'a property'}`,
          draft_body: expired
            ? `The ${label} for ${p.name || p.address} expired ${Math.abs(d)} day(s) ago. Book a re-inspection as a priority to restore compliance and avoid penalties.`
            : `The ${label} for ${p.name || p.address} expires on ${fmtDate(c.expiry_date)}. Book the renewal inspection now to avoid a coverage gap.`,
          due_date: c.expiry_date,
          dedupe_key: `compliance:${c.id}`,
          metadata: { cert_type: c.cert_type, days: d, property: p.name || p.address },
        })
      }

      // 3c. Tenancy renewals — tenancy ending within 90 days, with a proposed
      //     rent (+3% rounded to nearest £5, a conservative default the
      //     landlord can override).
      for (const t of (tenancies || [])) {
        const p = propById[t.property_id]
        if (!p) continue
        const d = daysUntil(t.tenancy_end)
        if (d === null || d < 0 || d > 90) continue
        const currentRent = Number(p.rent_pcm || 0)
        const proposed = currentRent > 0 ? Math.round((currentRent * 1.03) / 5) * 5 : 0
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: t.property_id,
          kind: 'tenancy_renewal',
          severity: d <= 30 ? 'high' : 'medium',
          title: `Tenancy on ${p.name || p.address || 'a property'} ends in ${d}d`,
          draft_body: currentRent > 0
            ? `The tenancy at ${p.name || p.address} ends on ${fmtDate(t.tenancy_end)}. Consider offering a renewal. Current rent is ${fmtGBP(currentRent)}/month; a proposed renewal figure of ${fmtGBP(proposed)}/month (≈3% uplift) keeps pace with typical market movement — review against local comparables before confirming.`
            : `The tenancy at ${p.name || p.address} ends on ${fmtDate(t.tenancy_end)}. Decide whether to offer a renewal and on what terms.`,
          due_date: t.tenancy_end,
          dedupe_key: `tenancy:${t.id}`,
          metadata: { current_rent: currentRent, proposed_rent: proposed, days: d, property: p.name || p.address },
        })
      }

      // 3d. Mortgage product end dates — within 90 days.
      for (const p of props) {
        const d = daysUntil(p.mortgage_product_end_date)
        if (d === null || d < 0 || d > 90) continue
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: p.id,
          kind: 'mortgage',
          severity: d <= 30 ? 'high' : 'medium',
          title: `Mortgage product on ${p.name || p.address || 'a property'} ends in ${d}d`,
          draft_body: `The current mortgage rate product on ${p.name || p.address} ends on ${fmtDate(p.mortgage_product_end_date)}. Start comparing remortgage options now — reverting to the lender's SVR typically adds 1-3%/yr in interest. Allow several weeks for an application to complete.`,
          due_date: p.mortgage_product_end_date,
          dedupe_key: `mortgage:${p.id}`,
          metadata: { days: d, property: p.name || p.address },
        })
      }

      if (candidates.length === 0) continue

      // 4. Optionally polish the human-readable drafts with Claude (modest tokens).
      await polishDrafts(candidates)

      // 5. Upsert candidates. The partial unique index on (user_id, dedupe_key)
      //    where status='open' lets us refresh existing open rows in place.
      const rows = candidates.map((c) => ({
        company_id: c.company_id,
        user_id: c.user_id,
        property_id: c.property_id,
        kind: c.kind,
        severity: c.severity,
        title: c.title,
        draft_body: c.draft_body,
        due_date: c.due_date,
        status: 'open',
        dedupe_key: c.dedupe_key,
        metadata: c.metadata,
        updated_at: new Date().toISOString(),
      }))

      // upsert by (user_id, dedupe_key) — but the unique index is partial
      // (status='open'), so we manually clear prior open rows for these keys
      // then insert fresh. This keeps acted/dismissed history intact.
      const keys = candidates.map((c) => c.dedupe_key)
      for (const uid of [...new Set(candidates.map((c) => c.user_id))]) {
        const userKeys = candidates.filter((c) => c.user_id === uid).map((c) => c.dedupe_key)
        await admin.from('autopilot_actions')
          .delete()
          .eq('user_id', uid)
          .eq('status', 'open')
          .in('dedupe_key', userKeys)
      }
      const { error: insErr } = await admin.from('autopilot_actions').insert(rows)
      if (insErr) throw insErr
      totalActions += rows.length

      // 6. One summary notification per user (group candidates by user).
      const byUser: Record<string, Candidate[]> = {}
      for (const c of candidates) {
        (byUser[c.user_id] ||= []).push(c)
      }
      for (const [uid, list] of Object.entries(byUser)) {
        const high = list.filter((c) => c.severity === 'high').length
        const title = `Autopilot: ${list.length} action${list.length === 1 ? '' : 's'} need your review`
        const body = high > 0
          ? `${high} high-priority — arrears, compliance and renewals across ${co.name || 'your portfolio'}. All items are drafted for your approval; nothing has been sent.`
          : `${list.length} drafted action${list.length === 1 ? '' : 's'} across ${co.name || 'your portfolio'}, ready for your review and approval.`
        await admin.from('notifications').insert({
          user_id: uid,
          type: 'autopilot',
          title,
          body,
          link: '#/autopilot',
          metadata: { company_id: companyId, action_count: list.length, high_count: high },
        })
        notifiedUsers++
      }
    }

    return json(200, {
      ok: true,
      companies_scanned: liveCompanies.length,
      actions_written: totalActions,
      users_notified: notifiedUsers,
    })
  } catch (e) {
    return json(500, { error: (e as Error).message })
  }
})
