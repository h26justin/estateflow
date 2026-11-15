// EPC register sync — pulls real EPCs from the official England & Wales
// register and logs them against properties (flag: epc_planner).
//
// Register: "Get energy performance of buildings data"
// (get-energy-performance-data.communities.gov.uk — the service that replaced
// epc.opendatacommunities.org in May 2026). Auth is a personal bearer token
// copied from the account page after signing in with GOV.UK One Login.
// Rate limit is 6000 requests / 5 min / IP, far above anything we do here.
//
// Input (user JWT):
//   { action: 'sync_property', property_id }  — one property (write access req.)
//   { action: 'sync_all' }                    — every property the caller can
//                                               write to (RLS-scoped list)
// Input (cron, x-cron-secret header):
//   {}                                        — live properties not checked in
//                                               the last RECHECK_DAYS, oldest
//                                               check first, at most
//                                               EPC_SYNC_BATCH per run and
//                                               within a time budget, so each
//                                               run makes progress and the
//                                               next one picks up the rest
//
// Per property:
//   1. Parse the postcode out of the free-text address (properties has no
//      postcode column — the address string carries it).
//   2. Search the register by postcode, pick the best address match, and of
//      that address's certificates keep the most recently registered one.
//   3. Fetch the full certificate record (expiry, potential rating, …).
//   4. Upsert epc_certificates, stamp properties.epc_* headline fields, and
//      upsert the compliance_items 'epc' row so the Compliance tab, expiry
//      badges, reminder emails and Autopilot all see it.
//
// The official certificate itself is a web page (the register stopped issuing
// PDFs), so we store its canonical URL:
//   https://find-energy-certificate.service.gov.uk/energy-certificate/<number>
//
// Scotland has a separate register with no API — Scottish postcodes simply
// come back not_found.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { secretMatches } from './secrets.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET      = Deno.env.get('CRON_SECRET') || ''
// Bearer token from get-energy-performance-data.communities.gov.uk (sign in
// with GOV.UK One Login → "My Bearer Token"). Inert-but-graceful when unset.
const EPC_API_TOKEN    = Deno.env.get('EPC_API_TOKEN') || ''

const REGISTER_BASE   = 'https://api.get-energy-performance-data.communities.gov.uk/api'
// Per-request timeout for register calls, the cron batch size, how long a
// check stays fresh, and the cron run's time budget (well inside the edge
// wall clock).
const REGISTER_TIMEOUT_MS = 15_000
const CRON_BATCH = (() => { const n = Number(Deno.env.get('EPC_SYNC_BATCH')); return Number.isInteger(n) && n > 0 && n <= 1000 ? n : 200 })()
const RECHECK_DAYS = 25
const CRON_BUDGET_MS = 110_000
const PUBLIC_CERT_URL = 'https://find-energy-certificate.service.gov.uk/energy-certificate/'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(status: number, message: string) {
  return json(status, { error: message })
}

const RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
function normaliseRating(r: unknown): string | null {
  if (typeof r !== 'string') return null
  const up = r.trim().toUpperCase()
  return RATINGS.includes(up) ? up : null
}

// Same pattern as src/lib/addressUtils.js — the postcode lives inside the
// free-text address ("5 Thomas Street, Sunderland, SR1 1AA").
const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
function extractPostcode(address: string | null): string | null {
  if (!address) return null
  const m = String(address).match(UK_POSTCODE_RE)
  if (!m) return null
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`
}

// ── Address matching ─────────────────────────────────────────────────────────
// The register's addresses are structured (addressLine1..4, postTown) while
// ours is one free-text string, so we match on token overlap. Numbers must
// agree exactly: every number token in the candidate must be in ours and
// every number token in ours must be in the candidate (flat number AND
// building number), so Flat 2 never takes Flat 3's certificate and a named
// house never takes a numbered neighbour's. Anything below MIN_SCORE, or a
// tie between two different addresses, is left as not_found for review
// rather than written.
const MIN_SCORE = 6

const NOISE_TOKENS = new Set([
  'flat', 'apartment', 'apt', 'unit', 'room', 'house', 'the',
  'street', 'st', 'road', 'rd', 'lane', 'ln', 'avenue', 'ave', 'close',
  'court', 'ct', 'drive', 'dr', 'place', 'pl', 'terrace', 'way', 'grove',
])

function tokenise(s: string): string[] {
  return s.toLowerCase()
    .replace(UK_POSTCODE_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function candidateAddress(row: Record<string, unknown>): string {
  return [row.addressLine1, row.addressLine2, row.addressLine3, row.addressLine4, row.postTown]
    .filter(Boolean).join(', ')
}

// Address lines only — the post town is scored separately (weakly) so that
// "Sunderland" matching every Sunderland candidate can't carry a match.
function candidateLineText(row: Record<string, unknown>): string {
  return [row.addressLine1, row.addressLine2, row.addressLine3, row.addressLine4]
    .filter(Boolean).join(', ')
}

const isNum = (t: string) => /\d/.test(t)

// Score a register row against the property address. Returns -1 when the
// candidate must be rejected.
//
// Two acceptance regimes:
//   • Either side has a number: the number tokens must be the same set on
//     both sides ("Flat 2, 5 Thomas Street" ≠ "Flat 3, 5 Thomas Street" or
//     "5 Thomas Street"; "Rose Cottage, High Street" ≠ "3 High Street"), and
//     when the candidate has street/building name tokens at least one must
//     be ours ("5 Thomas Street" ≠ "5 Other Road" in the same postcode).
//   • Neither side has a number (named buildings / houses): accept only on
//     ≥2 distinct name-token matches, or when every name token the candidate
//     has is contained in the property address (so "Rose Cottage" matches
//     "Rose Cottage, High Street" but "Thomas Street Community Centre" never
//     matches "Thomas Street House").
function scoreCandidate(propTokens: string[], candLineTokens: string[], candTownTokens: string[]): number {
  const propSet = new Set(propTokens)
  const propNums = [...new Set(propTokens.filter(isNum))]
  const candNums = [...new Set(candLineTokens.filter(isNum))]
  const candReal = [...new Set(candLineTokens.filter(t => !isNum(t) && !NOISE_TOKENS.has(t)))]
  const matchedReal = candReal.filter(t => propSet.has(t))

  if (candNums.length > 0 || propNums.length > 0) {
    if (!candNums.every(n => propSet.has(n))) return -1
    if (!propNums.every(n => candNums.includes(n))) return -1
    if (candReal.length > 0 && matchedReal.length === 0) return -1
  } else {
    const fullyContained = matchedReal.length >= 1 && matchedReal.length === candReal.length
    if (!(matchedReal.length >= 2 || fullyContained)) return -1
  }

  const candLineSet = new Set(candLineTokens)
  const candTownSet = new Set(candTownTokens)
  let score = 0
  for (const t of propSet) {
    if (candLineSet.has(t)) {
      if (isNum(t)) score += 5              // number agreement is strong
      else if (NOISE_TOKENS.has(t)) score += 1 // "street"/"road" is weak signal
      else score += 3                        // real name token
    } else if (candTownSet.has(t)) {
      score += 1                             // town match is weak signal
    }
  }
  return score
}

// ── Register client ──────────────────────────────────────────────────────────

class RegisterAuthError extends Error {}

async function registerGet(path: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(REGISTER_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${EPC_API_TOKEN}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
  })
}

// Search all domestic certificates for a postcode. 404 = none. Paginates
// defensively although a single postcode never comes near 5000 rows.
async function searchByPostcode(postcode: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let page = 1
  for (;;) {
    const res = await registerGet('/domestic/search', {
      postcode, current_page: String(page), page_size: '5000',
    })
    if (res.status === 404) return rows
    if (res.status === 401 || res.status === 403) {
      throw new RegisterAuthError('EPC register rejected the API token — refresh EPC_API_TOKEN from your account at get-energy-performance-data.communities.gov.uk')
    }
    if (!res.ok) throw new Error(`EPC register search failed (HTTP ${res.status})`)
    const data = await res.json()
    rows.push(...(Array.isArray(data?.data) ? data.data : []))
    const next = data?.pagination?.nextPage
    if (!next || page >= 10) return rows
    page = next
  }
}

// Full certificate record — richer than the search row (expiry, potential
// rating, …). Field names vary by schema version so read defensively; never
// throws, the search row alone is enough to log the certificate.
async function fetchCertificateDetail(certificateNumber: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await registerGet('/certificate', { certificate_number: certificateNumber })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.data && typeof data.data === 'object') ? data.data : null
  } catch {
    return null
  }
}

function pick(obj: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!obj) return null
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k]
  }
  return null
}

function toISODate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// Same day N years on; 29 February becomes 28 February in a non-leap year.
function addYears(iso: string, years: number): string {
  const [y, mo, d] = iso.split('-').map(Number)
  const ny = y + years
  const dim = new Date(Date.UTC(ny, mo, 0)).getUTCDate()
  return `${ny}-${String(mo).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`
}

// ── Core: sync one property ──────────────────────────────────────────────────

type PropertyRow = {
  id: string
  user_id: string
  company_id: string | null
  name: string | null
  address: string | null
}

type SyncResult = {
  property_id: string
  name: string | null
  status: 'found' | 'not_found' | 'no_postcode' | 'error' | 'skipped_no_permission'
  rating?: string | null
  certificate_number?: string
  expiry_date?: string | null
  certificate_url?: string
  error?: string
}

// deno-lint-ignore no-explicit-any
async function syncProperty(admin: any, prop: PropertyRow, postcodeCache: Map<string, Record<string, unknown>[]>): Promise<SyncResult> {
  const now = new Date().toISOString()
  const stamp = (fields: Record<string, unknown>) =>
    admin.from('properties').update({ epc_last_checked_at: now, ...fields }).eq('id', prop.id)

  const postcode = extractPostcode(prop.address)
  if (!postcode) {
    await stamp({ epc_sync_status: 'no_postcode' })
    return { property_id: prop.id, name: prop.name, status: 'no_postcode' }
  }

  let rows = postcodeCache.get(postcode)
  if (!rows) {
    rows = await searchByPostcode(postcode)
    postcodeCache.set(postcode, rows)
  }

  // Best address match; the register returns every historical certificate,
  // so collect all rows for the winning address and keep the newest.
  const propTokens = tokenise(prop.address || '')
  let bestScore = -1
  let best: Record<string, unknown> | null = null
  let tied = false
  const passing: Record<string, unknown>[] = []
  for (const row of rows) {
    const score = scoreCandidate(propTokens, tokenise(candidateLineText(row)), tokenise(String(row.postTown || '')))
    if (score < 0) continue
    passing.push(row)
    if (score > bestScore) { bestScore = score; best = row; tied = false }
    else if (score === bestScore && best && candidateAddress(row).toLowerCase() !== candidateAddress(best).toLowerCase()) tied = true
  }
  let matchedBy: string = 'address'
  if (best && (tied || bestScore < MIN_SCORE)) best = null
  // A postcode with exactly one address is safe to accept on a weak token
  // match (rural addresses often share almost no tokens with our free-text
  // form) — but only when that address passed the number rules above.
  if (!best && !tied && rows.length > 0 && passing.length === rows.length) {
    const uniqueAddrs = new Set(rows.map(r => candidateAddress(r).toLowerCase()))
    if (uniqueAddrs.size === 1) { best = rows[0]; matchedBy = 'postcode_single' }
  }
  if (!best) {
    // Nothing written: a weak or ambiguous match needs a person to check it.
    await stamp({ epc_sync_status: 'not_found' })
    return { property_id: prop.id, name: prop.name, status: 'not_found', ...(tied || passing.length ? { error: 'No confident address match on the register; check and add the EPC manually' } : {}) }
  }

  const bestAddr = candidateAddress(best).toLowerCase()
  const sameAddress = rows.filter(r => candidateAddress(r).toLowerCase() === bestAddr)
  sameAddress.sort((a, b) => String(b.registrationDate || '').localeCompare(String(a.registrationDate || '')))
  const latest = sameAddress[0]

  const certificateNumber = String(latest.certificateNumber || '')
  if (!certificateNumber) {
    await stamp({ epc_sync_status: 'error' })
    return { property_id: prop.id, name: prop.name, status: 'error', error: 'Register row had no certificate number' }
  }

  const detail = await fetchCertificateDetail(certificateNumber)
  const rating = normaliseRating(
    pick(detail, 'current_energy_efficiency_band', 'current_energy_rating', 'currentEnergyEfficiencyBand')
    ?? latest.currentEnergyEfficiencyBand,
  )
  const potential = normaliseRating(
    pick(detail, 'potential_energy_efficiency_band', 'potential_energy_rating', 'potentialEnergyEfficiencyBand'),
  )
  const lodged = toISODate(pick(detail, 'registration_date', 'lodgement_date', 'registrationDate') ?? latest.registrationDate)
  // Domestic EPCs are valid 10 years; prefer the register's own expiry when
  // the schema exposes it.
  const expiry = toISODate(pick(detail, 'expiry_date', 'expiryDate', 'valid_until'))
    ?? (lodged ? addYears(lodged, 10) : null)
  const uprn = pick(detail, 'uprn') ?? latest.uprn
  const certificateUrl = PUBLIC_CERT_URL + certificateNumber

  const { error: upsertErr } = await admin
    .from('epc_certificates')
    .upsert({
      property_id: prop.id,
      company_id: prop.company_id,
      user_id: prop.user_id,
      certificate_number: certificateNumber,
      uprn: uprn != null ? String(uprn) : null,
      register_address: candidateAddress(latest),
      current_rating: rating,
      potential_rating: potential,
      lodgement_date: lodged,
      expiry_date: expiry,
      certificate_url: certificateUrl,
      matched_by: matchedBy,
      raw: detail ?? latest,
      fetched_at: now,
    }, { onConflict: 'property_id,certificate_number' })
  if (upsertErr) {
    await stamp({ epc_sync_status: 'error' })
    return { property_id: prop.id, name: prop.name, status: 'error', error: upsertErr.message }
  }

  await stamp({
    epc_sync_status: 'found',
    epc_rating: rating,
    epc_expiry_date: expiry,
    epc_certificate_number: certificateNumber,
  })

  // Compliance tab / reminders / autopilot integration: keep the property's
  // 'epc' compliance row current. Only date/name fields are touched so a
  // manually attached document (document_id) is never clobbered.
  const certName = rating ? `EPC — band ${rating}` : 'EPC'
  const notes = `Auto-fetched from the EPC register. Certificate: ${certificateUrl}`
  const { data: existing } = await admin
    .from('compliance_items')
    .select('id')
    .eq('property_id', prop.id)
    .eq('cert_type', 'epc')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing?.id) {
    await admin.from('compliance_items')
      .update({ cert_name: certName, issue_date: lodged, expiry_date: expiry, notes })
      .eq('id', existing.id)
  } else {
    await admin.from('compliance_items').insert({
      property_id: prop.id,
      user_id: prop.user_id,
      cert_type: 'epc',
      cert_name: certName,
      issue_date: lodged,
      expiry_date: expiry,
      reminder_days: 90,
      notes,
    })
  }

  return {
    property_id: prop.id, name: prop.name, status: 'found',
    rating, certificate_number: certificateNumber, expiry_date: expiry,
    certificate_url: certificateUrl,
  }
}

// deno-lint-ignore no-explicit-any
async function syncMany(admin: any, props: PropertyRow[], deadline = Infinity): Promise<{ checked: number; found: number; results: SyncResult[]; stopped_early?: boolean }> {
  const cache = new Map<string, Record<string, unknown>[]>()
  const results: SyncResult[] = []
  for (const prop of props) {
    // Out of time: leave the rest for the next run (oldest check first).
    if (Date.now() >= deadline) return { checked: results.length, found: results.filter(r => r.status === 'found').length, results, stopped_early: true }
    try {
      results.push(await syncProperty(admin, prop, cache))
    } catch (e) {
      if (e instanceof RegisterAuthError) throw e // bad token — stop the run
      results.push({ property_id: prop.id, name: prop.name, status: 'error', error: (e as Error).message })
      try {
        await admin.from('properties')
          .update({ epc_last_checked_at: new Date().toISOString(), epc_sync_status: 'error' })
          .eq('id', prop.id)
      } catch { /* best effort */ }
    }
  }
  return {
    checked: results.length,
    found: results.filter(r => r.status === 'found').length,
    results,
  }
}

const PROPERTY_COLS = 'id, user_id, company_id, name, address, status, archived_at, deleted_at'
function isLiveProperty(p: Record<string, unknown>): boolean {
  return !p.deleted_at && !p.archived_at && p.status !== 'sold'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed')

  if (!EPC_API_TOKEN) {
    return jsonError(503, 'EPC register access is not configured yet. Create a free account at get-energy-performance-data.communities.gov.uk and add your bearer token as the EPC_API_TOKEN secret.')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    // ── Cron mode: refresh every live property (fail-closed) ────────────────
    const cronHeader = req.headers.get('x-cron-secret')
    if (cronHeader !== null) {
      if (!secretMatches(cronHeader, CRON_SECRET)) return jsonError(403, 'Forbidden')
      // Oldest check first, a bounded batch per run: every run makes
      // progress and the next one picks up where it stopped.
      const staleBefore = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString()
      const { data: props, error } = await admin.from('properties').select(PROPERTY_COLS)
        // Sold is filtered here too, or never-stamped sold rows would hold
        // the front of the queue forever.
        .is('deleted_at', null).is('archived_at', null).neq('status', 'sold')
        .or(`epc_last_checked_at.is.null,epc_last_checked_at.lt.${staleBefore}`)
        .order('epc_last_checked_at', { ascending: true, nullsFirst: true })
        .order('id')
        .limit(CRON_BATCH)
      if (error) throw error
      const live = (props || []).filter(isLiveProperty) as unknown as PropertyRow[]
      const summary = await syncMany(admin, live, Date.now() + CRON_BUDGET_MS)
      return json(200, { ...summary, batch: CRON_BATCH })
    }

    // ── User mode: JWT + per-property write check ────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return jsonError(401, 'Missing Authorization header')
    // Verify the token explicitly (the pattern proven by lodgify-sync et al —
    // no-arg getUser() on a session-less server client is unreliable); the
    // caller-scoped client is still what runs RLS-scoped reads and RPCs.
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return jsonError(401, 'Invalid or expired session')
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const body = await req.json().catch(() => ({}))
    const action: string = body.action || 'sync_property'

    if (action === 'sync_property') {
      const propertyId: string | undefined = body.property_id
      if (!propertyId) return jsonError(400, 'property_id required')
      const { data: canWrite, error: permErr } = await userClient
        .rpc('has_property_permission', { p_property_id: propertyId, p_action: 'write' })
      if (permErr) throw new Error('Access check failed: ' + permErr.message)
      if (canWrite !== true) return jsonError(403, 'Forbidden')

      const { data: prop, error } = await admin
        .from('properties').select(PROPERTY_COLS).eq('id', propertyId).single()
      if (error || !prop) return jsonError(404, 'Property not found')
      const summary = await syncMany(admin, [prop as unknown as PropertyRow])
      return json(200, { ...summary, ...summary.results[0] })
    }

    if (action === 'sync_all') {
      // RLS-scoped list: the caller only ever sees their accessible properties.
      const { data: props, error } = await userClient.from('properties').select(PROPERTY_COLS)
      if (error) throw error
      const live = (props || []).filter(isLiveProperty)
      const writable: PropertyRow[] = []
      const results: SyncResult[] = []
      for (const p of live) {
        const { data: canWrite } = await userClient
          .rpc('has_property_permission', { p_property_id: p.id, p_action: 'write' })
        if (canWrite === true) writable.push(p as unknown as PropertyRow)
        else results.push({ property_id: p.id as string, name: (p.name as string) ?? null, status: 'skipped_no_permission' })
      }
      const summary = await syncMany(admin, writable)
      summary.results.push(...results)
      summary.checked += results.length
      return json(200, summary)
    }

    return jsonError(400, `Unknown action: ${action}`)
  } catch (e) {
    if (e instanceof RegisterAuthError) return jsonError(502, e.message)
    console.error('epc-sync failed:', (e as Error)?.message || e)
    return jsonError(500, 'Unexpected error')
  }
})
