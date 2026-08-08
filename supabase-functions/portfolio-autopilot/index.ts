// Portfolio Autopilot — daily cron agent.
//
// Runs daily via pg_cron (see supabase-migrations/2026-06-11_autopilot.sql).
// For every LIVE company it scans the portfolio and produces a prioritised
// list of DRAFTED actions:
//   - chase rent arrears (with a drafted reminder message)
//   - book gas / EICR / EPC (and other certs) before they expire
//   - flag tenancy renewals with a proposed rent
//   - flag mortgage product end dates (remortgage prompt)
//   - flag insurance policies that have expired or expire within 60 days
//   - flag vacant properties (lost rent) and given-notice re-let prep
//   - flag let properties with no gas / EICR / EPC certificate on file at all
//
// Human decisions stick: a dedupe key acted-on or dismissed within the last
// 30 days is not resurfaced by subsequent runs.
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
  // Keep in sync with src/lib/complianceCatalogue.js (canonical keys +
  // legacy aliases both listed so old rows still label correctly).
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
  return labels[(type || '').toLowerCase()] || type || 'Certificate'
}

// ── Action candidate type ────────────────────────────────────────────────────
type Candidate = {
  company_id: string
  user_id: string
  property_id: string | null
  kind: 'arrears' | 'compliance' | 'tenancy_renewal' | 'mortgage' | 'insurance' | 'void'
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
//
// Calls are chunked: ~15 two-to-four-sentence drafts fit comfortably in the
// 1800-token response budget, whereas one big call truncates mid-JSON and
// silently loses the whole batch to template fallbacks.
const POLISH_CHUNK = 15

async function polishDrafts(candidates: Candidate[]): Promise<void> {
  if (!ANTHROPIC_API_KEY || candidates.length === 0) return
  for (let start = 0; start < candidates.length; start += POLISH_CHUNK) {
    await polishChunk(candidates, start, Math.min(start + POLISH_CHUNK, candidates.length))
  }
}

async function polishChunk(candidates: Candidate[], start: number, end: number): Promise<void> {
  const items = []
  for (let i = start; i < end; i++) {
    items.push({
      i,
      kind: candidates[i].kind,
      context: candidates[i].title,
      facts: candidates[i].metadata,
    })
  }

  const prompt = `You are drafting short, professional messages a UK landlord can review and send. For each action below, write a concise draft (2-4 sentences, British English, polite, no placeholders like [NAME] unless a fact is genuinely missing). Arrears = a reminder to the tenant. Compliance = an internal note on booking the inspection (facts with missing:true mean no certificate is on file at all — the note is about booking the inspection and uploading the certificate). Tenancy renewal = a note proposing terms. Mortgage = an internal note to review remortgage options. Insurance = an internal note on renewing cover before it lapses. Void = an internal note on getting a vacant property re-let (or preparing a re-let after notice).

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
    if (!res.ok) {
      console.warn(`polishDrafts: API ${res.status} — keeping template drafts for items ${start}-${end - 1}`)
      return
    }
    const data = await res.json()
    if (data.stop_reason === 'max_tokens') {
      console.warn(`polishDrafts: response truncated at max_tokens for items ${start}-${end - 1}`)
    }
    const text: string = data.content?.[0]?.text || ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return
    for (const row of parsed) {
      if (typeof row?.i === 'number' && candidates[row.i] && typeof row.draft === 'string' && row.draft.trim()) {
        candidates[row.i].draft_body = row.draft.trim()
      }
    }
  } catch (e) {
    // Non-fatal — deterministic template drafts remain in place.
    console.warn(`polishDrafts: keeping template drafts for items ${start}-${end - 1}: ${(e as Error).message}`)
  }
}

// Page through a PostgREST query in 1000-row chunks so large result sets are
// never silently truncated by the server's max-rows cap, and surface errors
// instead of treating a failed query as an empty result. The builder must
// apply a stable .order() for paging to be deterministic.
const PAGE_SIZE = 1000
async function fetchAllRows(
  build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
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
      const { data: properties, error: propErr } = await admin
        .from('properties')
        .select('id, name, address, rent_pcm, status, arrears, mortgage_product_end_date, user_id, deleted_at, has_gas_supply, is_hmo, licensing_scheme, compliance_optout, epc_rating')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (propErr) {
        console.error(`autopilot: properties query failed for company ${companyId} — skipping this run: ${propErr.message}`)
        continue
      }

      const props = (properties || []).filter((p: any) => p.status !== 'sold')
      if (props.length === 0) continue
      const propIds = props.map((p: any) => p.id)
      const propById: Record<string, any> = {}
      for (const p of props) propById[p.id] = p

      // Every query is error-checked and paged (fetchAllRows): a transient
      // failure or a silently capped result must NOT read as "nothing on
      // file" — the missing-certificate detector (3b2) infers from absence,
      // so a bad read here would mass-flag compliant properties. On any
      // failure, skip the company this run and try again tomorrow.
      let compliance: any[], tenancies: any[], rents: any[], policies: any[]
      try {
        ;[compliance, tenancies, rents, policies] = await Promise.all([
          // No expiry filter here: items without an expiry date still count as
          // "on file" for the missing-certificate check (3b2); the expiring
          // check (3b) skips null expiries itself.
          fetchAllRows((from, to) => admin.from('compliance_items')
            .select('id, property_id, cert_type, cert_name, issue_date, expiry_date, created_at, deleted_at')
            .in('property_id', propIds).is('deleted_at', null)
            .order('id').range(from, to)),
          fetchAllRows((from, to) => admin.from('tenancy_details')
            .select('id, property_id, tenant_names, tenancy_start, tenancy_end, rent_review_date')
            .in('property_id', propIds)
            .order('id').range(from, to)),
          fetchAllRows((from, to) => admin.from('rent_payments')
            .select('id, property_id, status, amount, year, month, month_label')
            .in('property_id', propIds).in('status', ['overdue', 'late', 'partial'])
            .order('id').range(from, to)),
          fetchAllRows((from, to) => admin.from('insurance_policies')
            .select('id, policy_name, policy_type, provider, expiry_date, premium, previous_policy_id, insurance_policy_properties(property_id)')
            .eq('company_id', companyId).is('deleted_at', null)
            .order('id').range(from, to)),
        ])
      } catch (e) {
        console.error(`autopilot: portfolio queries failed for company ${companyId} — skipping this run: ${(e as Error).message}`)
        continue
      }

      const candidates: Candidate[] = []
      const ownerOf = (p: any) => (p?.user_id as string) || ownerId

      // 3a. Arrears — property-level arrears field and overdue rent rows.
      for (const p of props) {
        if (Number(p.arrears) > 0) {
          // The dedupe key encodes how much is owed (months of rent, or a
          // £100 bucket when rent is unknown): acting on last month's arrears
          // must not suppress a NEW missed month or a severity escalation
          // via the 30-day rule in 3g. Unchanged facts keep the same key.
          const rent = Number(p.rent_pcm || 0)
          const owedBucket = rent > 0
            ? `${Math.max(1, Math.ceil(Number(p.arrears) / rent))}m`
            : `£${Math.round(Number(p.arrears) / 100) * 100}`
          candidates.push({
            company_id: companyId,
            user_id: ownerOf(p),
            property_id: p.id,
            kind: 'arrears',
            severity: Number(p.arrears) >= Number(p.rent_pcm || 0) ? 'high' : 'medium',
            title: `Rent arrears on ${p.name || p.address || 'a property'}`,
            draft_body: `Our records show outstanding rent of ${fmtGBP(Number(p.arrears))} on ${p.name || p.address}. Please arrange payment at your earliest convenience, or get in touch if you would like to discuss a payment plan.`,
            due_date: null,
            dedupe_key: `arrears:${p.id}:${owedBucket}`,
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
          // Count in the key: a decision on "1 unpaid period" doesn't
          // suppress the escalated "2 unpaid periods" item (see 3g).
          dedupe_key: `arrears_rows:${pid}:${agg.count}`,
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

      // 3b2. Missing core certificates — gas / EICR / EPC are legal
      //      requirements for let property in England & Wales. Flag let
      //      properties with no certificate of each type on file at all, so
      //      the landlord can book the inspection and upload the document.
      //      Short-term-let listings are skipped (often per-room/per-listing
      //      rows that would duplicate one building's certificates).
      const LET_STATUSES = new Set(['rented', 'notice_given', 'let_agreed'])
      // aliases: legacy cert_type spellings that satisfy the requirement
      // (see src/lib/complianceCatalogue.js). appliesTo uses the property's
      // applicability flags — unset flags default to "required" so nothing
      // silently stops being chased on properties that predate the columns.
      // optKey: the catalogue key checked against properties.compliance_optout
      // (a per-property "don't track this" toggle from the Compliance tab).
      type RequiredCert = { type: string; aliases: string[]; optKey: string; label: string; note: string; appliesTo?: (p: any) => boolean }
      const isHmoProp = (p: any) => !!p.is_hmo || ['mandatory_hmo', 'additional_hmo'].includes(p.licensing_scheme || '')
      const REQUIRED_CERTS: RequiredCert[] = [
        { type: 'gas', aliases: ['gas_safety', 'gas_cert'], optKey: 'gas_safety', label: 'Gas Safety Certificate (CP12)', note: 'an annual gas safety inspection is a legal requirement if the property has gas appliances',
          appliesTo: (p) => p.has_gas_supply !== false },
        { type: 'eicr', aliases: [], optKey: 'eicr', label: 'Electrical Safety Report (EICR)', note: 'an EICR is legally required at least every 5 years' },
        { type: 'epc', aliases: [], optKey: 'epc', label: 'Energy Performance Certificate (EPC)', note: 'a valid EPC (minimum rating E) is required to let the property' },
        { type: 'hmo', aliases: ['hmo_licence'], optKey: 'hmo', label: 'HMO Licence', note: 'letting a licensable HMO without a licence is an offence with unlimited fines and rent repayment orders',
          appliesTo: isHmoProp },
        { type: 'selective_licence', aliases: [], optKey: 'selective_licence', label: 'Selective Licence', note: 'this property is flagged as being in a selective-licensing area, where letting without a licence is an offence',
          appliesTo: (p) => (p.licensing_scheme || '') === 'selective' },
      ]
      const certTypesByProp: Record<string, Set<string>> = {}
      for (const c of (compliance || [])) {
        (certTypesByProp[c.property_id] ||= new Set()).add((c.cert_type || '').toLowerCase())
      }
      for (const p of props) {
        if (!LET_STATUSES.has(p.status)) continue
        const have = certTypesByProp[p.id] || new Set()
        for (const rc of REQUIRED_CERTS) {
          if (rc.appliesTo && !rc.appliesTo(p)) continue
          if ((p.compliance_optout || {})[rc.optKey] === true) continue
          if (have.has(rc.type) || rc.aliases.some(a => have.has(a))) continue
          candidates.push({
            company_id: companyId,
            user_id: ownerOf(p),
            property_id: p.id,
            kind: 'compliance',
            severity: 'medium',
            title: `No ${rc.label} on file for ${p.name || p.address || 'a property'}`,
            draft_body: `There is no ${rc.label} recorded for ${p.name || p.address} — ${rc.note}. If you hold a valid certificate, upload it to the property's compliance tab so expiry reminders can track it; otherwise book the inspection now.`,
            due_date: null,
            dedupe_key: `compliance_missing:${rc.type}:${p.id}`,
            metadata: { cert_type: rc.type, missing: true, property: p.name || p.address },
          })
        }
      }

      // 3b3. MEES floor breach — band E has been the legal minimum to let
      //      since April 2020, so a let property at F or G is a LIVE breach
      //      (fines up to £5,000 per property), not a future problem.
      //      epc_rating is the register-synced band written by epc-sync.
      for (const p of props) {
        if (!LET_STATUSES.has(p.status)) continue
        const band = String(p.epc_rating || '').trim().toUpperCase()
        if (band !== 'F' && band !== 'G') continue
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: p.id,
          kind: 'compliance',
          severity: 'high',
          title: `EPC band ${band} — below the legal minimum at ${p.name || p.address || 'a property'}`,
          draft_body: `${p.name || p.address} has an EPC of band ${band}, below the MEES legal minimum of E for let property — penalties run up to £5,000 per property. Book improvement works to reach at least band E (the EPC Planner has a costed plan), or register a valid exemption on the PRS Exemptions Register.`,
          due_date: null,
          dedupe_key: `epc_mees_floor:${p.id}:${band}`,
          metadata: { epc_rating: band, property: p.name || p.address },
        })
      }

      // 3b4. Stale tenancy paperwork — deposit protection, Right to Rent,
      //      the agreement, the RRA info sheet and the inventory are
      //      per-tenancy. A row recorded before the CURRENT tenancy started
      //      reads as "held" but belongs to the last tenant. One action per
      //      tenancy listing what needs re-serving. Respects per-property
      //      opt-outs (properties.compliance_optout).
      const TENANCY_PAPERWORK = new Set(['tenancy_agreement', 'deposit_protection', 'right_to_rent', 'rra_info_sheet', 'inventory'])
      for (const t of (tenancies || [])) {
        const p = propById[t.property_id]
        if (!p || !LET_STATUSES.has(p.status) || !t.tenancy_start) continue
        const start = new Date(t.tenancy_start)
        if (isNaN(start.getTime()) || start > new Date()) continue
        const optout = (p.compliance_optout || {}) as Record<string, boolean>
        const stale = (compliance || []).filter((c: any) => {
          if (c.property_id !== t.property_id) return false
          const key = (c.cert_type || '').toLowerCase()
          if (!TENANCY_PAPERWORK.has(key) || optout[key] === true) return false
          const ref = c.issue_date || c.created_at
          return ref && new Date(ref) < start
        })
        if (stale.length === 0) continue
        const labels = [...new Set(stale.map((c: any) => c.cert_name || certLabel(c.cert_type)))]
        candidates.push({
          company_id: companyId,
          user_id: ownerOf(p),
          property_id: t.property_id,
          kind: 'compliance',
          severity: 'medium',
          title: `Tenancy paperwork pre-dates the current tenancy at ${p.name || p.address || 'a property'}`,
          draft_body: `The current tenancy at ${p.name || p.address} started on ${fmtDate(t.tenancy_start)}, but ${labels.join(', ')} on file ${stale.length === 1 ? 'was' : 'were'} recorded before that date and belong${stale.length === 1 ? 's' : ''} to the previous tenancy. Re-serve and re-record them on the property's Compliance tab — deposit protection and its Prescribed Information in particular block possession if not done.`,
          due_date: null,
          dedupe_key: `tenancy_paperwork_stale:${t.id}`,
          metadata: { tenancy_start: t.tenancy_start, stale_items: labels, property: p.name || p.address },
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

      // 3e. Insurance — policies expired or expiring within 60 days. A policy
      //     that has been superseded by a renewal (another policy pointing at
      //     it via previous_policy_id) is skipped.
      const supersededPolicyIds = new Set((policies || []).map((pl: any) => pl.previous_policy_id).filter(Boolean))
      for (const pl of (policies || [])) {
        if (supersededPolicyIds.has(pl.id)) continue
        const d = daysUntil(pl.expiry_date)
        if (d === null || d > 60) continue
        const linkIds = (pl.insurance_policy_properties || [])
          .map((l: any) => l.property_id)
          .filter((id: string) => propById[id])
        const single = linkIds.length === 1 ? propById[linkIds[0]] : null
        const label = pl.policy_name || [pl.provider, pl.policy_type].filter(Boolean).join(' — ') || 'Insurance policy'
        const scope = single
          ? (single.name || single.address)
          : linkIds.length > 1 ? `${linkIds.length} properties` : (co.name || 'the company')
        const expired = d < 0
        candidates.push({
          company_id: companyId,
          user_id: single ? ownerOf(single) : ownerId,
          property_id: single ? single.id : null,
          kind: 'insurance',
          severity: expired || d <= 14 ? 'high' : 'medium',
          title: expired
            ? `Insurance EXPIRED: ${label}`
            : `Insurance expires in ${d}d: ${label}`,
          draft_body: expired
            ? `The policy "${label}"${pl.provider ? ` with ${pl.provider}` : ''} covering ${scope} expired ${Math.abs(d)} day(s) ago — cover may have lapsed. Contact the provider or broker today to renew or arrange replacement cover, then record the new policy on the Insurance page.`
            : `The policy "${label}"${pl.provider ? ` with ${pl.provider}` : ''} covering ${scope} expires on ${fmtDate(pl.expiry_date)}. Request renewal terms now and compare quotes so cover continues without a gap, then record the renewal on the Insurance page.`,
          due_date: pl.expiry_date,
          dedupe_key: `insurance:${pl.id}`,
          metadata: { provider: pl.provider, policy_type: pl.policy_type, days: d, premium: Number(pl.premium || 0), scope },
        })
      }

      // 3f. Voids — vacant properties (lost rent every month) and given-notice
      //     tenancies (get the re-let moving before the void starts).
      for (const p of props) {
        const rent = Number(p.rent_pcm || 0)
        if (p.status === 'vacant') {
          candidates.push({
            company_id: companyId,
            user_id: ownerOf(p),
            property_id: p.id,
            kind: 'void',
            severity: 'medium',
            title: `${p.name || p.address || 'A property'} is sitting vacant`,
            draft_body: rent > 0
              ? `${p.name || p.address} is vacant and generating no income — roughly ${fmtGBP(rent)} of rent is lost for each month it stays empty. Get it listed for let (or review the asking rent if it is already marketed), and use the void to clear any outstanding compliance or refurb work.`
              : `${p.name || p.address} is vacant. Get it listed for let, and use the void period to clear any outstanding compliance or refurb work.`,
            due_date: null,
            dedupe_key: `void:${p.id}`,
            metadata: { rent_pcm: rent, status: p.status, property: p.name || p.address },
          })
        } else if (p.status === 'notice_given') {
          candidates.push({
            company_id: companyId,
            user_id: ownerOf(p),
            property_id: p.id,
            kind: 'void',
            severity: 'medium',
            title: `Notice given at ${p.name || p.address || 'a property'} — plan the re-let`,
            draft_body: `The tenant at ${p.name || p.address} has given notice. Start marketing now to minimise the void: prepare the listing, book the check-out inspection, and line up any works or certificate renewals for the changeover.`,
            due_date: null,
            dedupe_key: `void_notice:${p.id}`,
            metadata: { rent_pcm: rent, status: p.status, property: p.name || p.address },
          })
        }
      }

      if (candidates.length === 0) continue

      // 3g. Human decisions stick: drop any candidate whose dedupe key was
      //     acted on or dismissed in the last 30 days, so daily re-runs don't
      //     resurface items the landlord has already dealt with.
      const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString()
      const { data: recentClosed } = await admin.from('autopilot_actions')
        .select('user_id, dedupe_key')
        .in('user_id', [...new Set(candidates.map((c) => c.user_id))])
        .neq('status', 'open')
        .gte('updated_at', cutoff)
      const closedKeys = new Set((recentClosed || []).map((r: any) => `${r.user_id}:${r.dedupe_key}`))
      const active = candidates.filter((c) => !closedKeys.has(`${c.user_id}:${c.dedupe_key}`))
      if (active.length === 0) continue

      // 4. Optionally polish the human-readable drafts with Claude (modest
      //    tokens). polishDrafts chunks its API calls so a big batch degrades
      //    per-chunk rather than wholesale; still cap the total and polish
      //    high-severity items first — the rest keep deterministic templates.
      const toPolish = [...active]
        .sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1))
        .slice(0, 40)
      await polishDrafts(toPolish)

      // 5. Upsert candidates. The partial unique index on (user_id, dedupe_key)
      //    where status='open' lets us refresh existing open rows in place.
      const rows = active.map((c) => ({
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
      for (const uid of [...new Set(active.map((c) => c.user_id))]) {
        const userCands = active.filter((c) => c.user_id === uid)
        const userKeys = userCands.map((c) => c.dedupe_key)
        await admin.from('autopilot_actions')
          .delete()
          .eq('user_id', uid)
          .eq('status', 'open')
          .in('dedupe_key', userKeys)
        // Arrears keys encode the amount owed and change as the facts change
        // (and were fact-free before 2026-08-08), so also clear this user's
        // open arrears rows on the same properties — otherwise stale
        // variants of the same debt would pile up alongside the fresh one.
        const arrearsPropIds = [...new Set(
          userCands.filter((c) => c.kind === 'arrears' && c.property_id).map((c) => c.property_id as string),
        )]
        if (arrearsPropIds.length > 0) {
          await admin.from('autopilot_actions')
            .delete()
            .eq('user_id', uid)
            .eq('status', 'open')
            .eq('kind', 'arrears')
            .in('property_id', arrearsPropIds)
        }
      }
      const { error: insErr } = await admin.from('autopilot_actions').insert(rows)
      if (insErr) throw insErr
      totalActions += rows.length

      // 6. One summary notification per user (group candidates by user).
      const byUser: Record<string, Candidate[]> = {}
      for (const c of active) {
        (byUser[c.user_id] ||= []).push(c)
      }
      for (const [uid, list] of Object.entries(byUser)) {
        const high = list.filter((c) => c.severity === 'high').length
        const title = `Autopilot: ${list.length} action${list.length === 1 ? '' : 's'} need your review`
        const body = high > 0
          ? `${high} high-priority — arrears, compliance, insurance and lettings across ${co.name || 'your portfolio'}. All items are drafted for your approval; nothing has been sent.`
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
