// Xero sync — Phase 2 (multi-company + granular controls + reconciliation pull-back).
//
// Actions (request body):
//   { action: 'list_accounts', company_id }
//     → Returns the user's chart of accounts (for UI dropdowns)
//
//   { action: 'sync' | 'to_xero' | 'both', company_id, direction? }
//     → Default. Honours xero_sync_settings per (user,company).
//       Pushes rent + expenses + (optionally) mortgage interest, with
//       per-property bank account mapping and tracking categories.
//       If pull_reconciliation=true also fetches IsReconciled status
//       from Xero and mirrors it into rent_payments / property_expenses.
//
// Connection model: xero_connections is keyed (user_id, company_id) so
// one user can have separate Xero orgs per OwnProperly company.
//
// Settings model: xero_sync_settings has the toggles + account-code
// overrides + bank account mappings + tracking category state.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, resolveToken } from './encryption.ts'
import { secretMatches } from './secrets.ts'
import { companyRoleFor, roleCanWrite } from './authz.ts'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY           = Deno.env.get('SUPABASE_ANON_KEY')!
const XERO_CLIENT_ID     = Deno.env.get('XERO_CLIENT_ID') || ''
const XERO_CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function refreshIfNeeded(admin: any, conn: any) {
  // Resolve current access token from encrypted or legacy plaintext column.
  const currentAccess = await resolveToken({ encrypted: conn.encrypted_access_token, plaintext: conn.access_token })
  const expires = new Date(conn.expires_at)
  if (expires.getTime() > Date.now() + 60_000 && currentAccess) return currentAccess
  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new Error('Xero client credentials not configured')

  const currentRefresh = await resolveToken({ encrypted: conn.encrypted_refresh_token, plaintext: conn.refresh_token })
  if (!currentRefresh) throw new Error('No refresh token on Xero connection — please reconnect')

  const basic = btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: currentRefresh }),
  })
  if (!res.ok) throw new Error('Xero token refresh failed: ' + await res.text())
  const t = await res.json()
  // Persist refreshed tokens — encrypted if key configured, else plaintext fallback.
  const encA = await encryptToken(t.access_token)
  const encR = await encryptToken(t.refresh_token)
  // Xero rotates the refresh token on every refresh: if this write is lost
  // the stored one is dead and the connection needs a manual reconnect.
  // Abort the run rather than carry on with a token we failed to keep.
  const { data: saved, error: saveErr } = await admin.from('xero_connections').update({
    access_token:           encA ? null : t.access_token,
    refresh_token:          encR ? null : t.refresh_token,
    encrypted_access_token:  encA || null,
    encrypted_refresh_token: encR || null,
    expires_at: new Date(Date.now() + (t.expires_in || 1800) * 1000).toISOString(),
  }).eq('user_id', conn.user_id).eq('company_id', conn.company_id).select('user_id')
  if (saveErr || !saved || saved.length === 0) {
    throw new Error('Could not save the refreshed Xero token' + (saveErr ? `: ${saveErr.message}` : '') + ' — stopped before syncing. If Xero sync keeps failing, use Reconnect.')
  }
  return t.access_token
}

// Every row a query matches, a page at a time. PostgREST stops at its row
// cap (1,000) without saying so, and every "load all" read here decides
// what to post: a truncated sync map re-posts records already in Xero.
// build() must return a fresh, stably ordered query each call.
async function fetchAllRows(build: () => any, pageSize = 1000): Promise<any[]> {
  const out: any[] = []
  for (let page = 0; page < 1000; page++) {
    const from = page * pageSize
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message || 'query failed')
    const batch = data || []
    out.push(...batch)
    if (batch.length < pageSize) return out
  }
  throw new Error('fetchAllRows: too many pages — is the query ordered and ranged?')
}

// Can xero_sync_map hold this entity_type? The live CHECK constraint only
// allowed property/rent_payment/expense/contact until migration
// 2026-11-15_01, and a map write that fails AFTER the Xero POST means the
// next sync posts the same record again. Probe with an insert that can
// never be kept: a CHECK violation (23514) is raised before the user_id
// foreign key is checked, so 23514 means "not allowed" and the FK error
// (23503) means "allowed". No row survives either way; if one somehow
// does (no FK), it is deleted at once. Anything unexpected counts as no.
const NO_USER = '00000000-0000-0000-0000-000000000000'
async function mapAcceptsEntityType(admin: any, companyId: string, entityType: string): Promise<boolean> {
  const { data, error } = await admin.from('xero_sync_map').insert({
    user_id: NO_USER, company_id: companyId, entity_type: entityType,
    local_id: crypto.randomUUID(), xero_id: 'probe', xero_kind: 'probe',
  }).select('id')
  if (!error) {
    for (const r of (data || [])) await admin.from('xero_sync_map').delete().eq('id', r.id)
    return true
  }
  return error.code === '23503'
}

// Has migration 2026-11-15_01 added xero_sync_map.origin yet?
async function mapHasOrigin(admin: any): Promise<boolean> {
  const { error } = await admin.from('xero_sync_map').select('origin').limit(1)
  return !error
}

// Synthetic local_id for one month's mortgage interest on one property:
// xero_sync_map.local_id is a UUID, so "<property_id>:<YYYY-MM>" is stored
// as a SHA-256-derived UUID. Push and preview must compute the same value.
async function mortgageLocalIdUuid(localId: string): Promise<string> {
  const hashHexBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(localId))
  const hashBytesArr = new Uint8Array(hashHexBuf)
  const hexStr = Array.from(hashBytesArr).slice(0, 16).map(b => b.toString(16).padStart(2,'0')).join('')
  return `${hexStr.slice(0,8)}-${hexStr.slice(8,12)}-${hexStr.slice(12,16)}-${hexStr.slice(16,20)}-${hexStr.slice(20,32)}`
}
const currentYyyymm = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
}

// Plain-English label + reason for a push block the sync map can't record yet.
const MAP_BLOCK_LABEL: Record<string, string> = {
  mortgage_interest: 'Mortgage interest accruals',
  deposit: 'Tenancy deposits',
  refurb: 'Refurb costs',
}
const mapBlockedReason = (entityType: string) =>
  `${MAP_BLOCK_LABEL[entityType] || entityType} not posted: the sync map can't record them yet (database update pending), so they could be posted twice.`

// Xero's JSON gives Date as "/Date(1439434356790+0000)/" and DateString as ISO.
function xeroDateISO(t: any): string | null {
  if (t?.DateString) return String(t.DateString).slice(0, 10)
  const m = /\/Date\((\d+)/.exec(String(t?.Date || ''))
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10)
  const s = String(t?.Date || '')
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
// Our expense categories are a short fixed list; Xero account codes and line
// descriptions are free text. Keyword rules, 'other' when nothing matches.
function categoriseXeroSpend(accountCode: string | undefined, text: string): string {
  const s = `${accountCode || ''} ${text || ''}`.toLowerCase()
  if (/insurance/.test(s)) return 'insurance'
  if (/mortgage|loan interest|\binterest\b/.test(s)) return 'mortgage'
  if (/management fee|letting fee|\bagent|agency|propertunity|\brms\b|\bpne\b/.test(s)) return 'agent_fees'
  if (/repair|plumb|electric|boiler|roof|leak|glazing|handyman|decorat|joiner|maintenance|clean|gas safe|eicr|epc/.test(s)) return 'repairs'
  return 'other'
}

async function xeroFetch(token: string, tenantId: string, path: string, init: RequestInit = {}) {
  return await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  })
}

// Parse Xero's ValidationException into a one-line summary.
async function xeroErrorSummary(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text)
    const elements = body?.Elements || []
    const validationMsgs: string[] = []
    for (const el of elements) {
      for (const v of (el?.ValidationErrors || [])) {
        if (v?.Message) validationMsgs.push(v.Message)
      }
    }
    if (validationMsgs.length > 0) return validationMsgs.join('; ')
    return body?.Message || body?.Detail || text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

// Ensure a "Property" TrackingCategory exists in the user's Xero org and
// that every OwnProperly property has a TrackingOption under it. Returns
// the updated property → option ID map.
async function ensureTrackingCategories(token: string, tenantId: string, settings: any, properties: any[]) {
  let categoryId = settings.tracking_category_id as string | null
  const optionMap: Record<string, string> = { ...(settings.property_tracking_options || {}) }

  // 1. Find or create the tracking category
  if (!categoryId) {
    // Look for an existing one called "Property"
    const listRes = await xeroFetch(token, tenantId, 'TrackingCategories')
    if (listRes.ok) {
      const json = await listRes.json()
      const existing = (json.TrackingCategories || []).find((c: any) =>
        c.Name?.toLowerCase() === 'property' && c.Status === 'ACTIVE')
      if (existing) categoryId = existing.TrackingCategoryID
    }
  }
  if (!categoryId) {
    // Create it
    const createRes = await xeroFetch(token, tenantId, 'TrackingCategories', {
      method: 'POST',
      body: JSON.stringify({ Name: 'Property' }),
    })
    if (createRes.ok) {
      const json = await createRes.json()
      categoryId = json.TrackingCategories?.[0]?.TrackingCategoryID
    }
  }
  if (!categoryId) {
    throw new Error('Could not create Xero "Property" tracking category — Xero may have hit its 2-category limit')
  }

  // 2. Fetch the existing options under this category once
  let xeroOptions: any[] = []
  const optsRes = await xeroFetch(token, tenantId, `TrackingCategories/${categoryId}`)
  if (optsRes.ok) {
    const json = await optsRes.json()
    xeroOptions = json.TrackingCategories?.[0]?.Options || []
  }
  const xeroOptionByName = new Map<string, string>()
  for (const o of xeroOptions) {
    if (o.Status === 'ACTIVE') xeroOptionByName.set(String(o.Name || '').toLowerCase(), o.TrackingOptionID)
  }

  // 3. Ensure each property has an option
  for (const prop of properties) {
    if (optionMap[prop.id]) continue
    const name = prop.name || prop.address || prop.id.slice(0, 8)
    const lower = String(name).toLowerCase()
    if (xeroOptionByName.has(lower)) {
      optionMap[prop.id] = xeroOptionByName.get(lower)!
      continue
    }
    // Create the option
    const createOptRes = await xeroFetch(token, tenantId, `TrackingCategories/${categoryId}/Options`, {
      method: 'POST',
      body: JSON.stringify({ Options: [{ Name: name }] }),
    })
    if (createOptRes.ok) {
      const json = await createOptRes.json()
      const opt = json.Options?.[0]?.TrackingOptionID
      if (opt) optionMap[prop.id] = opt
    }
  }

  return { categoryId, optionMap }
}

// Records already posted to Xero for this (user, company), as
// "<entity_type>:<local_id>".
// Throws on a read error: an empty set would re-post everything.
async function loadSyncedSet(admin: any, userId: string, companyId: string) {
  const data = await fetchAllRows(() => admin.from('xero_sync_map')
    .select('entity_type, local_id')
    .eq('user_id', userId).eq('company_id', companyId)
    .order('id', { ascending: true }))
  return new Set<string>(data.map((r: any) => `${r.entity_type}:${r.local_id}`))
}

// Nothing is posted to Xero until the company has explicitly chosen where
// it goes. On 7 Oct 2026 a fresh ExH connection with blank settings fell
// back to the first bank account + first revenue code and posted 219
// historic rent receipts (GBP 99,976.68, back to Dec 2024) on one click.
// Returns the human-readable list of what is still missing.
function pushSetupMissing(settings: any): string[] {
  const missing: string[] = []
  if (!settings?.default_bank_account_id) missing.push('a bank account')
  if (!settings?.income_account_code) missing.push('a rent income account')
  if (!settings?.expense_account_code) missing.push('an expense account')
  if (!settings?.push_from_date) missing.push('a "post from" date')
  return missing
}

// Actions that only READ (the caller's own Xero org, or what a push would
// post). Everything else writes: posts / deletes in Xero, rewrites the sync
// map, or (reconciliation, reverse sync, pull_expenses) writes Xero data
// back into the company's rent_payments / property_expenses with the
// service role. Those need write access to the company, not just access.
const READ_ONLY_ACTIONS = new Set(['list_accounts', 'preview'])

// The write rule (public.has_company_write) plus company liveness
// (public.company_is_live) — the same pair the RLS write policies use —
// for callers WITHOUT a JWT (cron path). See ./authz.ts.
async function userCanWriteCompany(admin: any, userId: string, companyId: string): Promise<boolean> {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  if (!u?.user) return false
  if (!roleCanWrite(await companyRoleFor(admin, userId, u.user.email, companyId))) return false
  const { data: live } = await admin.rpc('company_is_live', { p_company_id: companyId })
  return live === true
}

const rentDate = (p: any) => p.period_start
  || (p.year && p.month ? `${p.year}-${String(p.month).padStart(2, '0')}-01` : null)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const body = await req.json().catch(() => ({}))
  const action = body.action || body.direction || 'to_xero'
  const companyId: string | undefined = body.company_id

  if (!companyId) return jsonError(400, 'company_id required')

  // Cron path: xero-cron-reconcile invokes us with a shared secret +
  // explicit user_id header instead of a JWT. The header alone is not
  // enough to act as an arbitrary user: cron callers may only run the
  // non-push reconcile path, and only for (user, company) pairs the
  // server itself queued — an opt-in xero_cron_schedules row or a
  // webhook-flagged pending sync. Otherwise fall through to JWT auth.
  const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
  const cronSecret = req.headers.get('x-cron-secret') || ''
  const cronUserId = req.headers.get('x-cron-user-id') || ''
  let caller: any = null
  if (secretMatches(cronSecret, CRON_SECRET) && cronUserId) {
    if (action !== 'reconcile_only') return jsonError(403, 'Cron callers may only run reconcile_only')
    const { data: sched } = await admin.from('xero_cron_schedules')
      .select('user_id')
      .eq('user_id', cronUserId).eq('company_id', companyId)
      .maybeSingle()
    let bound = !!sched
    if (!bound) {
      const { data: pendingConn } = await admin.from('xero_connections')
        .select('user_id')
        .eq('user_id', cronUserId).eq('company_id', companyId)
        .not('pending_sync_at', 'is', null)
        .maybeSingle()
      bound = !!pendingConn
    }
    if (!bound) return jsonError(403, 'No scheduled or pending sync for this user/company')
    // No JWT on this path. reconcile_only WRITES (reconciliation flags,
    // reverse-sync amount/date edits, pulled expenses), so the connection's
    // user must STILL have write access to a live company: a user since
    // demoted to viewer, or removed, can't be acted for by a stale schedule
    // row or a webhook-flagged pending sync.
    if (!(await userCanWriteCompany(admin, cronUserId, companyId))) {
      return jsonError(403, 'Forbidden')
    }
    caller = { id: cronUserId }
  } else {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return jsonError(401, 'Missing Authorization')
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    caller = userData?.user
    if (userErr || !caller) return jsonError(401, 'Invalid session')
    // Company access under the caller's own JWT (same rules as RLS):
    // read-only actions need access; everything else needs write access
    // to a live company (has_company_write AND company_is_live, as the
    // RLS write policies use). Viewers can preview but not push or pull.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    if (READ_ONLY_ACTIONS.has(action)) {
      const { data: hasAccess } = await userClient.rpc('has_company_access', { p_company_id: companyId })
      if (hasAccess !== true) return jsonError(403, 'Forbidden')
    } else {
      const [{ data: canWrite }, { data: live }] = await Promise.all([
        userClient.rpc('has_company_write', { p_company_id: companyId }),
        userClient.rpc('company_is_live', { p_company_id: companyId }),
      ])
      if (canWrite !== true) return jsonError(403, 'You have read-only access to this company — Xero sync needs an owner, admin or editor')
      if (live !== true) return jsonError(403, 'This company\'s subscription is not active — Xero sync is paused')
    }
  }

  // Every property of this company. Pull-back writes into rent_payments /
  // property_expenses (reconciliation flags, reverse-sync edits) are
  // constrained to these ids so a sync-map row can never touch another
  // company's records via the service-role client.
  let allowedPropIds: string[]
  try {
    const companyProps = await fetchAllRows(() => admin.from('properties')
      .select('id').eq('company_id', companyId).order('id', { ascending: true }))
    allowedPropIds = companyProps.map((p: any) => p.id)
  } catch (e) {
    return jsonError(500, 'Could not load this company\'s properties: ' + (e as Error).message)
  }

  // Load the connection for this (user, company)
  const { data: conn, error: ce } = await admin
    .from('xero_connections').select('*')
    .eq('user_id', caller.id).eq('company_id', companyId).single()
  if (ce || !conn) return jsonError(404, 'No Xero connection for this company. Connect Xero first.')

  // The access token is fetched (and, if due, refreshed) only by the
  // actions that call Xero, and for the writing ones only once the sync
  // lock is held, so two overlapping runs don't both rotate the refresh
  // token. resync_all never calls Xero.
  let accessToken = ''
  const ensureToken = async () => {
    if (!accessToken) accessToken = await refreshIfNeeded(admin, conn)
    return accessToken
  }

  // ── action=resync_all → wipe the sync map for this (user, company) ──
  // After this, the next normal sync will re-push everything. The Xero-side
  // records aren't touched — typically the user has already deleted them
  // in Xero before triggering this.
  if (action === 'resync_all') {
    const { count, error: delErr } = await admin
      .from('xero_sync_map').delete({ count: 'exact' })
      .eq('user_id', caller.id).eq('company_id', companyId)
    if (delErr) return jsonError(500, 'Failed to clear sync map: ' + delErr.message)
    return new Response(JSON.stringify({ ok: true, cleared: count || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── action=list_accounts → return chart of accounts for UI dropdowns ──
  if (action === 'list_accounts') {
    try { await ensureToken() } catch (e) { return jsonError(502, (e as Error).message) }
    const r = await xeroFetch(accessToken, conn.tenant_id, 'Accounts?where=Status=="ACTIVE"')
    if (!r.ok) return jsonError(r.status, 'Failed to list accounts: ' + await xeroErrorSummary(r))
    const j = await r.json()
    const accounts = (j.Accounts || []).map((a: any) => ({
      AccountID: a.AccountID, Code: a.Code, Name: a.Name, Type: a.Type, BankAccountNumber: a.BankAccountNumber || null,
    }))
    return new Response(JSON.stringify({ accounts }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Sync flow ────────────────────────────────────────────────────────
  // Load per-(user,company) settings; insert defaults if missing.
  let { data: settings } = await admin
    .from('xero_sync_settings').select('*')
    .eq('user_id', caller.id).eq('company_id', companyId).maybeSingle()
  if (!settings) {
    await admin.from('xero_sync_settings').insert({ user_id: caller.id, company_id: companyId })
    settings = (await admin.from('xero_sync_settings').select('*')
      .eq('user_id', caller.id).eq('company_id', companyId).single()).data
  }

  // What a push WOULD post, computed without posting. Counts every block a
  // confirmed push would post (same filters, same toggles, same
  // property_ids scope as the push below), so the dialog never under-states
  // what lands in the customer's ledger. A block the sync map can't record
  // yet is reported in `blocked`, not counted. Used by action=preview and,
  // to check the preview token, by every push.
  const computePushPreview = async () => {
    const missing = pushSetupMissing(settings)
    const floor = settings.push_from_date ? String(settings.push_from_date).slice(0, 10) : null
    const scoped = Array.isArray(body.property_ids) && body.property_ids.length > 0
    const props = await fetchAllRows(() => {
      let q = admin.from('properties')
        .select('id, mortgage_amount, mortgage_rate')
        .eq('user_id', caller.id).eq('company_id', companyId).is('deleted_at', null)
      if (scoped) q = q.in('id', body.property_ids)
      return q.order('id', { ascending: true })
    })
    const propIds = props.map((p: any) => p.id)
    const syncedSet = await loadSyncedSet(admin, caller.id, companyId)
    const block = () => ({ count: 0, total: 0, earliest: null as string | null })
    const rent = block(), expenses = block(), mortgage_interest = block(), deposits = block(), refurb = block()
    // Every item counted, as `entity_type:local_id` (the sync-map key): the
    // preview token is a hash over this list, so a push can prove it posts
    // the list the user reviewed.
    const keys: string[] = []
    const add = (b: any, amount: number, d: string, key: string) => {
      b.count++; b.total += amount
      if (!b.earliest || d < b.earliest) b.earliest = d
      keys.push(key)
    }
    const blocked: string[] = []
    let skippedPulled = 0
    if (propIds.length && settings.sync_rent) {
      const data = await fetchAllRows(() => admin.from('rent_payments')
        .select('id, amount, period_start, year, month')
        .in('property_id', propIds).eq('status', 'paid').gt('amount', 0)
        .order('id', { ascending: true }))
      for (const p of data) {
        const d = rentDate(p)
        if (!d || syncedSet.has(`rent_payment:${p.id}`) || (floor && d < floor)) continue
        add(rent, Number(p.amount), d, `rent_payment:${p.id}`)
      }
    }
    if (propIds.length && settings.sync_expenses) {
      const data = await fetchAllRows(() => admin.from('property_expenses')
        .select('id, amount, date, source_ref')
        .in('property_id', propIds).is('deleted_at', null).gt('amount', 0)
        .order('id', { ascending: true }))
      for (const e of data) {
        if (!e.date || syncedSet.has(`expense:${e.id}`) || (floor && e.date < floor)) continue
        if (String(e.source_ref || '').startsWith('xero:')) { skippedPulled++; continue }
        add(expenses, Number(e.amount), e.date, `expense:${e.id}`)
      }
    }
    if (propIds.length && settings.sync_mortgage_interest) {
      if (!(await mapAcceptsEntityType(admin, companyId, 'mortgage_interest'))) blocked.push(mapBlockedReason('mortgage_interest'))
      else {
        const yyyymm = currentYyyymm()
        for (const p of props) {
          if (!(Number(p.mortgage_amount) > 0) || !(Number(p.mortgage_rate) > 0)) continue
          const monthlyInterest = (Number(p.mortgage_amount) * Number(p.mortgage_rate)) / 12
          if (monthlyInterest <= 0) continue
          const localIdUuid = await mortgageLocalIdUuid(`${p.id}:${yyyymm}`)
          if (syncedSet.has(`mortgage_interest:${localIdUuid}`)) continue
          add(mortgage_interest, Math.round(monthlyInterest * 100) / 100, `${yyyymm}-01`, `mortgage_interest:${localIdUuid}`)
        }
      }
    }
    if (propIds.length && settings.sync_deposits_separate) {
      if (!(await mapAcceptsEntityType(admin, companyId, 'deposit'))) blocked.push(mapBlockedReason('deposit'))
      else {
        const data = await fetchAllRows(() => admin.from('tenancy_details')
          .select('id, deposit_amount, tenancy_start')
          .in('property_id', propIds).gt('deposit_amount', 0)
          .order('id', { ascending: true }))
        for (const t of data) {
          const d = t.tenancy_start || new Date().toISOString().slice(0, 10)
          if (syncedSet.has(`deposit:${t.id}`) || (floor && d < floor)) continue
          add(deposits, Number(t.deposit_amount), d, `deposit:${t.id}`)
        }
      }
    }
    if (propIds.length && settings.sync_refurb_separate) {
      if (!(await mapAcceptsEntityType(admin, companyId, 'refurb'))) blocked.push(mapBlockedReason('refurb'))
      else {
        const data = await fetchAllRows(() => admin.from('refurb_costs')
          .select('id, cost, date')
          .in('property_id', propIds).eq('paid', true).gt('cost', 0)
          .order('id', { ascending: true }))
        for (const r of data) {
          if (!r.date || syncedSet.has(`refurb:${r.id}`) || (floor && r.date < floor)) continue
          add(refurb, Number(r.cost), r.date, `refurb:${r.id}`)
        }
      }
    }
    for (const b of [rent, expenses, mortgage_interest, deposits, refurb]) b.total = Math.round(b.total * 100) / 100
    return { missing, floor, rent, expenses, mortgage_interest, deposits, refurb, blocked, skippedPulled, keys }
  }

  // The preview token: SHA-256 (hex) over the company, the property scope and
  // the sorted list of `entity_type:local_id` items the preview counted. A
  // push must carry the token of the preview the user confirmed; the push
  // recomputes it and refuses when the list has changed since.
  const previewScope = Array.isArray(body.property_ids) && body.property_ids.length > 0
    ? [...body.property_ids].map(String).sort().join(',') : 'all'
  const previewTokenFor = async (keys: string[]) => {
    const material = `${companyId}|${previewScope}|${[...keys].sort().join(',')}`
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // ── action=preview → what a push WOULD post, without posting ──
  // The UI shows this in a confirm dialog before every manual push, and
  // passes preview_token back with the push.
  if (action === 'preview') {
    try {
      const { missing, floor, rent, expenses, mortgage_interest, deposits, refurb, blocked, skippedPulled, keys } = await computePushPreview()
      let bankName: string | null = null
      if (settings.default_bank_account_id) {
        await ensureToken()
        const r = await xeroFetch(accessToken, conn.tenant_id, `Accounts/${settings.default_bank_account_id}`)
        if (r.ok) bankName = (await r.json()).Accounts?.[0]?.Name || null
      }
      return new Response(JSON.stringify({
        preview: true, configured: missing.length === 0, missing,
        org: conn.tenant_name, bank: bankName, from: floor,
        rent, expenses, mortgage_interest, deposits, refurb,
        blocked, skipped_pulled_expenses: skippedPulled,
        preview_token: await previewTokenFor(keys),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (e) {
      return jsonError(500, 'Could not prepare the Xero preview: ' + (e as Error).message)
    }
  }

  // ── action=undo_push → delete what one push posted to Xero ──
  // Targets the transactions recorded in xero_sync_map since `since`
  // (default: the start of the run that wrote the newest map row, so a
  // later read-only run doesn't hide the push). Sets each to DELETED
  // in Xero; Xero refuses reconciled ones, which are reported and kept.
  // Successfully deleted ones leave the sync map. dry_run only counts.
  //
  // Only transactions Properly PUSHED are ever targeted. The map also holds
  // SPEND transactions pulled FROM Xero (entity_type 'expense'): those are
  // the customer's own Xero records and must never be deleted by an undo.
  // Rows carry origin ('pushed' | 'pulled') since migration 2026-11-15_01.
  // Older rows (origin NULL, or the column not there yet) count as pushed
  // only when provably so: every type except 'expense' is only ever written
  // by a push; an 'expense' row is pushed only if its local expense still
  // exists and was not created by a pull (source_ref 'xero:…'). Anything
  // unproven is left alone and reported as `excluded`.
  if (action === 'undo_push') {
    const hasOrigin = await mapHasOrigin(admin)
    let since: string | null = body.since || null
    if (!since) {
      let newestQ = admin.from('xero_sync_map').select('last_synced_at')
        .eq('user_id', caller.id).eq('company_id', companyId).eq('xero_kind', 'BankTransaction')
      if (hasOrigin) newestQ = newestQ.or('origin.is.null,origin.eq.pushed')
      const { data: newest } = await newestQ
        .order('last_synced_at', { ascending: false }).limit(1).maybeSingle()
      if (newest?.last_synced_at) {
        const { data: run } = await admin.from('xero_sync_log').select('started_at')
          .eq('user_id', caller.id).eq('company_id', companyId).eq('direction', 'to_xero')
          .lte('started_at', newest.last_synced_at)
          .order('started_at', { ascending: false }).limit(1).maybeSingle()
        since = run?.started_at || null
      }
    }
    if (!since) return jsonError(404, 'No push to undo for this company')
    let rows: any[]
    try {
      rows = await fetchAllRows(() => admin.from('xero_sync_map')
        .select(hasOrigin ? 'id, entity_type, local_id, xero_id, origin' : 'id, entity_type, local_id, xero_id')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .eq('xero_kind', 'BankTransaction').gte('last_synced_at', since)
        .order('id', { ascending: true }))
    } catch (e) {
      return jsonError(500, 'Could not read the sync map: ' + (e as Error).message)
    }
    // Local expenses behind origin-less 'expense' rows: amount for the
    // summary, source_ref to tell a pushed expense from a pulled one.
    const unknownExpIds = rows
      .filter((r: any) => r.entity_type === 'expense' && (!hasOrigin || r.origin == null))
      .map((r: any) => r.local_id)
    const provenPushedExp = new Set<string>()
    for (let i = 0; i < unknownExpIds.length; i += 200) {
      const { data, error } = await admin.from('property_expenses').select('id, source_ref')
        .in('id', unknownExpIds.slice(i, i + 200)).in('property_id', allowedPropIds)
      if (error) return jsonError(500, 'Could not check which expenses Properly pushed: ' + error.message)
      for (const e of (data || [])) {
        if (!String(e.source_ref || '').startsWith('xero:')) provenPushedExp.add(e.id)
      }
    }
    const isPushed = (r: any) => {
      if (hasOrigin && r.origin === 'pushed') return true
      if (hasOrigin && r.origin === 'pulled') return false
      if (r.entity_type !== 'expense') return true
      return provenPushedExp.has(r.local_id)
    }
    const targets = rows.filter(isPushed)
    const pulledExcluded = rows.filter((r: any) => hasOrigin && r.origin === 'pulled').length
    const excluded = rows.length - targets.length
    const rentIds = targets.filter((r: any) => r.entity_type === 'rent_payment').map((r: any) => r.local_id)
    const expIds = targets.filter((r: any) => r.entity_type === 'expense').map((r: any) => r.local_id)
    let total = 0
    for (let i = 0; i < rentIds.length; i += 200) {
      const { data } = await admin.from('rent_payments').select('amount').in('id', rentIds.slice(i, i + 200)).in('property_id', allowedPropIds)
      for (const r of (data || [])) total += Number(r.amount || 0)
    }
    for (let i = 0; i < expIds.length; i += 200) {
      const { data } = await admin.from('property_expenses').select('amount').in('id', expIds.slice(i, i + 200)).in('property_id', allowedPropIds)
      for (const r of (data || [])) total -= Number(r.amount || 0)
    }
    const summary = { since, count: targets.length, rent: rentIds.length, expenses: expIds.length,
      other: targets.length - rentIds.length - expIds.length,
      excluded, excluded_unproven: excluded - pulledExcluded,
      net_total: Math.round(total * 100) / 100, org: conn.tenant_name }
    if (body.dry_run) {
      return new Response(JSON.stringify({ dry_run: true, ...summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: undoLock, error: undoLockErr } = await admin
      .rpc('acquire_xero_sync_lock', { p_user_id: caller.id, p_company_id: companyId, p_ttl_seconds: 600 })
    if (!undoLockErr && undoLock !== true) {
      return jsonError(409, 'A Xero sync is already running for this company — try again in a minute')
    }
    let deleted = 0
    const failures: string[] = []
    try {
      if (targets.length) await ensureToken()
      for (let i = 0; i < targets.length; i += 50) {
        const batch = targets.slice(i, i + 50)
        const r = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions?summarizeErrors=false', {
          method: 'POST',
          body: JSON.stringify({ BankTransactions: batch.map((t: any) => ({ BankTransactionID: t.xero_id, Status: 'DELETED' })) }),
        })
        if (!r.ok) { failures.push(`batch ${i / 50 + 1}: ${await xeroErrorSummary(r)}`); continue }
        const out = (await r.json()).BankTransactions || []
        const gone = new Set<string>()
        for (const t of out) {
          if (t.Status === 'DELETED') gone.add(t.BankTransactionID)
          else failures.push(`${t.BankTransactionID}: ${(t.ValidationErrors || []).map((v: any) => v.Message).join('; ') || t.Status}`)
        }
        const goneRows = batch.filter((t: any) => gone.has(t.xero_id))
        for (const t of goneRows) {
          const { error: mapDelErr } = await admin.from('xero_sync_map').delete()
            .eq('user_id', caller.id).eq('company_id', companyId)
            .eq('entity_type', t.entity_type).eq('local_id', t.local_id)
          if (mapDelErr) failures.push(`${t.xero_id}: deleted in Xero but still in the sync map (${mapDelErr.message})`)
        }
        deleted += goneRows.length
      }
    } catch (e) {
      failures.push((e as Error).message)
    } finally {
      if (!undoLockErr) await admin.rpc('release_xero_sync_lock', { p_user_id: caller.id, p_company_id: companyId })
    }
    return new Response(JSON.stringify({ ...summary, deleted, failed: failures.length, errors: failures.slice(0, 10) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Preview binding ──
  // A run that can post (anything but reconcile_only, which never posts and
  // is what the cron uses) must carry the preview_token of the preview the
  // user confirmed. The list is recomputed now; a missing token, or one for
  // a different list (records added, edited, synced or deleted since the
  // review, or a different property scope), posts nothing.
  if (action !== 'reconcile_only') {
    let currentToken = ''
    try {
      currentToken = await previewTokenFor((await computePushPreview()).keys)
    } catch (e) {
      return jsonError(500, 'Could not check the Xero preview: ' + (e as Error).message)
    }
    const given = typeof body.preview_token === 'string' ? body.preview_token : ''
    if (!given || given !== currentToken) {
      return new Response(JSON.stringify({
        error: given
          ? 'The list of transactions to post to Xero changed since you reviewed it — review again. Nothing was posted.'
          : 'Review what will be posted to Xero first — nothing was posted.',
        code: 'preview_changed',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  }

  // Concurrency guard — one sync per (user, company) at a time. Two
  // overlapping runs would both read the same sync map snapshot and
  // double-post BankTransactions (Xero's POST isn't idempotent). Lock
  // has a TTL so a crashed run can't wedge the connection. If the lock
  // RPC isn't installed yet (migration pending) we proceed unguarded
  // rather than blocking live syncs.
  const { data: gotLock, error: lockErr } = await admin
    .rpc('acquire_xero_sync_lock', { p_user_id: caller.id, p_company_id: companyId, p_ttl_seconds: 600 })
  if (lockErr) {
    console.warn('acquire_xero_sync_lock unavailable — proceeding without lock:', lockErr.message)
  } else if (gotLock !== true) {
    return jsonError(409, 'A Xero sync is already running for this company — try again in a minute')
  }
  const releaseLock = async () => {
    if (lockErr) return
    await admin.rpc('release_xero_sync_lock', { p_user_id: caller.id, p_company_id: companyId })
  }

  // Open log row
  const { data: logRow } = await admin.from('xero_sync_log').insert({
    user_id: caller.id, company_id: companyId,
    direction: action === 'reconcile_only' ? 'from_xero' : 'to_xero', status: 'running',
  }).select().single()

  let created = 0, updated = 0, failed = 0
  const errors: string[] = []

  try {
    // Token refresh happens under the lock (see ensureToken).
    await ensureToken()

    // Properties for THIS company only. Optionally narrowed to the
    // user-specified subset (per-property sync from the UI's
    // "Sync this property only" button).
    const props = await fetchAllRows(() => {
      let propsQuery = admin.from('properties')
        .select('id, name, address')
        .eq('user_id', caller.id).eq('company_id', companyId).is('deleted_at', null)
      if (Array.isArray(body.property_ids) && body.property_ids.length > 0) {
        propsQuery = propsQuery.in('id', body.property_ids)
      }
      return propsQuery.order('id', { ascending: true })
    })
    if (!props || props.length === 0) throw new Error('No properties in this company to sync')
    const propMap = new Map(props.map(p => [p.id, p]))
    const propIds = props.map(p => p.id)

    // Pull chart of accounts once for: default bank account lookup, income/expense code pick, validation
    const accountsRes = await xeroFetch(accessToken, conn.tenant_id, 'Accounts?where=Status=="ACTIVE"')
    if (!accountsRes.ok) throw new Error('Failed to list Xero accounts: ' + await xeroErrorSummary(accountsRes))
    const allAccounts: any[] = (await accountsRes.json()).Accounts || []
    const bankAccounts = allAccounts.filter(a => a.Type === 'BANK')

    // Default bank account: only ever the one chosen in settings (no fallback)
    let defaultBankId = settings.default_bank_account_id
    if (defaultBankId && !bankAccounts.find(a => a.AccountID === defaultBankId)) {
      // User's chosen account no longer exists or isn't active
      defaultBankId = null
    }

    // Resolve income + expense account codes
    const incomeCode = settings.income_account_code
      || allAccounts.find(a => ['REVENUE','SALES','OTHERINCOME'].includes(a.Type))?.Code
    const expenseCode = settings.expense_account_code
      || allAccounts.find(a => ['EXPENSE','OVERHEADS','DIRECTCOSTS'].includes(a.Type))?.Code
    const mortgageInterestCode = settings.mortgage_interest_account_code
      || expenseCode  // Fallback to expense code if no specific one set
    if (!incomeCode) throw new Error('No revenue account in Xero — add one (Settings → Chart of Accounts)')
    if (!expenseCode) throw new Error('No expense account in Xero — add one (Settings → Chart of Accounts)')

    // Per-property bank account picker (override → default)
    const propBankMap: Record<string, string> = (settings.per_property_bank_accounts || {})
    const bankAccountFor = (propId: string) => {
      const override = propBankMap[propId]
      if (override && bankAccounts.find(a => a.AccountID === override)) return override
      return defaultBankId
    }

    // Tracking categories (per-property)
    let trackingCategoryId: string | null = null
    let trackingOptionMap: Record<string, string> = (settings.property_tracking_options || {})
    // Creating the category/options writes to Xero, so it only happens on a
    // run that is allowed to post. Otherwise use what was stored last time.
    const mayWrite = action !== 'reconcile_only' && pushSetupMissing(settings).length === 0 && !!defaultBankId
    if (settings.sync_tracking_categories && !mayWrite) {
      trackingCategoryId = settings.tracking_category_id || null
    } else if (settings.sync_tracking_categories) {
      try {
        const tc = await ensureTrackingCategories(accessToken, conn.tenant_id, settings, props)
        trackingCategoryId = tc.categoryId
        trackingOptionMap = tc.optionMap
        // Persist updated state so subsequent syncs skip the create calls
        await admin.from('xero_sync_settings').update({
          tracking_category_id: trackingCategoryId,
          property_tracking_options: trackingOptionMap,
        }).eq('user_id', caller.id).eq('company_id', companyId)
      } catch (e) {
        errors.push(`tracking categories: ${(e as Error).message}`)
        trackingCategoryId = null
      }
    }

    // Helper to attach a tracking value to a LineItem if enabled + mapped
    const trackingForProperty = (propId: string) => {
      if (!trackingCategoryId) return undefined
      const optId = trackingOptionMap[propId]
      if (!optId) return undefined
      return [{ TrackingCategoryID: trackingCategoryId, TrackingOptionID: optId }]
    }

    // Already-synced records skip set (per-company scope)
    const syncedSet = await loadSyncedSet(admin, caller.id, companyId)

    // Optionally pre-fetch tenancy_details for real-contact mode.
    // Two levels:
    //   sync_real_tenant_contacts → use the tenant name
    //   sync_real_tenant_emails   → also push email + phone into the Xero contact
    // Returns a richer object per property when emails are enabled so we can
    // build a full Xero Contact { Name, EmailAddress, Phones } payload.
    type TenantInfo = { name: string; email?: string; phone?: string }
    const tenantContactMap: Record<string, TenantInfo> = {}
    if (settings.sync_real_tenant_contacts) {
      const tenancies = await fetchAllRows(() => admin.from('tenancy_details')
        .select('property_id, tenant_names, tenant_email, tenant_phone')
        .in('property_id', propIds)
        .order('id', { ascending: true }))
      for (const t of tenancies) {
        if (!t.tenant_names) continue
        tenantContactMap[t.property_id] = {
          name: String(t.tenant_names).split(',')[0]?.trim() || 'Tenant',
          email: settings.sync_real_tenant_emails && t.tenant_email ? t.tenant_email : undefined,
          phone: settings.sync_real_tenant_emails && t.tenant_phone ? t.tenant_phone : undefined,
        }
      }
    }

    // Helper: build a Xero Contact payload for a rent transaction. Honours
    // both the name toggle and the email/phone toggle. Falls back to the
    // generic placeholder when toggles are off OR no tenant_details exist.
    const contactForRent = (propId: string) => {
      const info = tenantContactMap[propId]
      const prop = propMap.get(propId)
      if (!info) return { Name: `${prop?.name || 'Property'} — Tenant` }
      const out: any = { Name: info.name }
      if (info.email) out.EmailAddress = info.email
      if (info.phone) out.Phones = [{ PhoneType: 'MOBILE', PhoneNumber: info.phone }]
      return out
    }

    // Cron-driven reconcile_only runs skip ALL push blocks, and nothing is
    // posted until pushSetupMissing() is empty. Pulling reconciliation/edits
    // back is idempotent and safe unattended; posting is not.
    const missing = pushSetupMissing(settings)
    if (settings.default_bank_account_id && !defaultBankId) missing.push('a bank account that exists in Xero')
    const anyPushToggle = settings.sync_rent || settings.sync_expenses || settings.sync_mortgage_interest
      || settings.sync_deposits_separate || settings.sync_refurb_separate
    if (action !== 'reconcile_only' && anyPushToggle && missing.length) {
      errors.push(`Nothing posted to Xero: choose ${missing.join(', ')} in this company's Xero settings first.`)
    }
    const pushEnabled = action !== 'reconcile_only' && missing.length === 0
    const floor = settings.push_from_date ? String(settings.push_from_date).slice(0, 10) : ''
    // Stop posting well inside the 150s edge-function limit so a big
    // backlog ends as a clean partial run (log + lock closed) rather than
    // a 504 halfway through. The next Sync now carries on.
    const deadline = Date.now() + 100_000
    let stoppedEarly = false
    const outOfTime = () => {
      if (Date.now() < deadline) return false
      if (!stoppedEarly) errors.push('Stopped early to stay inside the time limit. Run Sync now again to post the rest.')
      stoppedEarly = true
      return true
    }

    // Recording a posted transaction in the sync map is what stops it being
    // posted again. If that write fails the run stops at once (caught
    // below: log closed, lock released, error returned) and the record is
    // not counted as created — carrying on would re-post on the next run.
    const hasOrigin = await mapHasOrigin(admin)
    const recordPushed = async (entityType: string, localId: string, xid: string | undefined, label: string) => {
      if (!xid) {
        throw new Error(`${label}: Xero accepted it but returned no transaction id, so it can't be recorded. ` +
          'Sync stopped so it is not posted twice — check Xero before syncing again.')
      }
      const { error } = await admin.from('xero_sync_map').upsert({
        user_id: caller.id, company_id: companyId, entity_type: entityType, local_id: localId,
        xero_id: xid, xero_kind: 'BankTransaction', ...(hasOrigin ? { origin: 'pushed' } : {}),
      }, { onConflict: 'user_id,company_id,entity_type,local_id' })
      if (error) {
        throw new Error(`${label}: in Xero as ${xid} but could not be recorded in the sync map (${error.message}). ` +
          'Sync stopped so it is not posted twice — check that transaction in Xero before syncing again.')
      }
      created++
    }
    // Blocks whose entity_type the sync map can't hold yet are skipped
    // whole, BEFORE anything is posted, rather than posted then lost.
    const skippedBlocks: string[] = []
    const mapReady = async (on: boolean, entityType: string) => {
      if (!on) return false
      if (await mapAcceptsEntityType(admin, companyId, entityType)) return true
      const reason = mapBlockedReason(entityType)
      skippedBlocks.push(reason); errors.push(reason)
      return false
    }

    // ── PUSH: rent_payments → BankTransaction RECEIVE ──
    if (pushEnabled && settings.sync_rent) {
      const payments = await fetchAllRows(() => admin.from('rent_payments')
        .select('id, property_id, amount, status, period_start, period_end, year, month')
        .in('property_id', propIds).eq('status', 'paid').gt('amount', 0)
        .order('id', { ascending: true }))
      for (const p of payments) {
        if (syncedSet.has(`rent_payment:${p.id}`)) continue
        const prop = propMap.get(p.property_id)
        const txnDate = rentDate(p)
        if (!txnDate) { failed++; errors.push(`rent ${p.id}: missing date — skipping`); continue }
        if (txnDate < floor) continue
        if (outOfTime()) break
        const tracking = trackingForProperty(p.property_id)
        const lineItem: any = {
          Description: `Rent ${p.period_start || ''} → ${p.period_end || ''}`.trim(),
          Quantity: 1,
          UnitAmount: Number(p.amount),
          AccountCode: incomeCode,
        }
        if (tracking) lineItem.Tracking = tracking
        const txnBody = {
          BankTransactions: [{
            Type: 'RECEIVE',
            Date: txnDate,
            Contact: contactForRent(p.property_id),
            BankAccount: { AccountID: bankAccountFor(p.property_id) },
            Reference: `Rent — ${prop?.name || 'Property'}`,
            LineItems: [lineItem],
          }],
        }
        const r = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
          method: 'POST', body: JSON.stringify(txnBody),
        })
        if (!r.ok) { failed++; errors.push(`rent ${p.id}: ${await xeroErrorSummary(r)}`); continue }
        const data = await r.json()
        await recordPushed('rent_payment', p.id, data.BankTransactions?.[0]?.BankTransactionID, `rent ${p.id}`)
      }
    }

    // ── PUSH: property_expenses → BankTransaction SPEND ──
    if (pushEnabled && settings.sync_expenses) {
      const expenses = await fetchAllRows(() => admin.from('property_expenses')
        .select('id, property_id, amount, date, category, description, source_ref')
        .in('property_id', propIds).is('deleted_at', null).gt('amount', 0)
        .order('id', { ascending: true }))
      let skippedPulled = 0
      for (const e of expenses) {
        if (syncedSet.has(`expense:${e.id}`)) continue
        // Pulled from Xero in the first place: posting it back would
        // duplicate the customer's own Xero spend.
        if (String(e.source_ref || '').startsWith('xero:')) { skippedPulled++; continue }
        const prop = propMap.get(e.property_id)
        if (!e.date) { failed++; errors.push(`expense ${e.id}: missing date — skipping`); continue }
        if (e.date < floor) continue
        if (outOfTime()) break
        const supplierName = e.description?.split(' ')?.[0] && settings.sync_real_tenant_contacts
          ? e.description.slice(0, 60)
          : `${prop?.name || 'Property'} — Supplier`
        const tracking = trackingForProperty(e.property_id)
        const lineItem: any = {
          Description: e.description || e.category || 'Property expense',
          Quantity: 1,
          UnitAmount: Number(e.amount),
          AccountCode: expenseCode,
        }
        if (tracking) lineItem.Tracking = tracking
        const txnBody = {
          BankTransactions: [{
            Type: 'SPEND',
            Date: e.date,
            Contact: { Name: supplierName },
            BankAccount: { AccountID: bankAccountFor(e.property_id) },
            Reference: `${e.category || 'Expense'} — ${prop?.name || 'Property'}`,
            LineItems: [lineItem],
          }],
        }
        const r = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
          method: 'POST', body: JSON.stringify(txnBody),
        })
        if (!r.ok) { failed++; errors.push(`expense ${e.id}: ${await xeroErrorSummary(r)}`); continue }
        const data = await r.json()
        await recordPushed('expense', e.id, data.BankTransactions?.[0]?.BankTransactionID, `expense ${e.id}`)
      }
      if (skippedPulled) errors.push(`${skippedPulled} expense(s) pulled from Xero were not posted back to it`)
    }

    // ── PUSH: monthly mortgage interest accruals ──
    // Computed from properties.mortgage_amount * mortgage_rate / 12 for
    // properties marked interest_only. Posts one txn per month per property
    // for any month that hasn't been pushed yet (idempotency via the
    // synthetic entity_type 'mortgage_interest' + a local_id of
    // <property_id>:<YYYY-MM>).
    if (pushEnabled && await mapReady(!!settings.sync_mortgage_interest, 'mortgage_interest')) {
      // Scoped to propIds so a per-property sync posts only that property's
      // interest (and matches the preview the user confirmed).
      const propsWithMortgage = await fetchAllRows(() => admin.from('properties')
        .select('id, name, mortgage_amount, mortgage_rate, mortgage_type, mortgage_product_end_date')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .in('id', propIds)
        .is('deleted_at', null)
        .gt('mortgage_amount', 0)
        .gt('mortgage_rate', 0)
        .order('id', { ascending: true }))
      for (const p of propsWithMortgage) {
        if (outOfTime()) break
        // properties.mortgage_rate is stored as a DECIMAL (e.g. 0.05 = 5%)
        // by PropertyModal which divides user input by 100 at save time.
        // Do NOT divide by 100 again here — that would post 100× too small.
        const monthlyInterest = (Number(p.mortgage_amount) * Number(p.mortgage_rate)) / 12
        if (monthlyInterest <= 0) continue
        // Post for the current month if not already posted
        const yyyymm = currentYyyymm()
        const localId = `${p.id}:${yyyymm}`
        // The dedupe check MUST use the same hashed-UUID local_id that gets
        // stored in xero_sync_map below — comparing against the raw
        // "<property_id>:<YYYY-MM>" string never matches, which re-posted the
        // same month's interest SPEND to Xero on every sync.
        const localIdUuid = await mortgageLocalIdUuid(localId)
        if (syncedSet.has(`mortgage_interest:${localIdUuid}`)) continue
        const txnDate = `${yyyymm}-01`
        const tracking = trackingForProperty(p.id)
        const lineItem: any = {
          Description: `Mortgage interest ${yyyymm}`,
          Quantity: 1,
          UnitAmount: Math.round(monthlyInterest * 100) / 100,
          AccountCode: mortgageInterestCode,
        }
        if (tracking) lineItem.Tracking = tracking
        const txnBody = {
          BankTransactions: [{
            Type: 'SPEND',
            Date: txnDate,
            Contact: { Name: `${p.name || 'Property'} — Mortgage Lender` },
            BankAccount: { AccountID: bankAccountFor(p.id) },
            Reference: `Mortgage interest — ${p.name || 'Property'}`,
            LineItems: [lineItem],
          }],
        }
        const r = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
          method: 'POST', body: JSON.stringify(txnBody),
        })
        if (!r.ok) { failed++; errors.push(`mortgage ${localId}: ${await xeroErrorSummary(r)}`); continue }
        const data = await r.json()
        // xero_sync_map.local_id is a UUID column, so the synthetic
        // "<property_id>:<YYYY-MM>" key is stored as the SHA-256-derived
        // UUID computed above (the dedupe check uses the same value).
        await recordPushed('mortgage_interest', localIdUuid, data.BankTransactions?.[0]?.BankTransactionID, `mortgage ${localId}`)
      }
    }

    // ── PUSH: tenancy deposits → BankTransaction RECEIVE (separate account) ──
    // Posts one transaction per tenancy that has deposit_amount > 0, using
    // the deposits_account_code (typically a liability account like 'Customer
    // Deposits'). Idempotent per tenancy_details.id (entity_type='deposit').
    if (pushEnabled && await mapReady(!!settings.sync_deposits_separate, 'deposit')) {
      const depositCode = settings.deposits_account_code
        || allAccounts.find(a => a.Type === 'CURRLIAB')?.Code
        || incomeCode
      const tenancies = await fetchAllRows(() => admin.from('tenancy_details')
        .select('id, property_id, tenant_names, deposit_amount, deposit_scheme, tenancy_start')
        .in('property_id', propIds).gt('deposit_amount', 0)
        .order('id', { ascending: true }))
      for (const t of tenancies) {
        if (syncedSet.has(`deposit:${t.id}`)) continue
        if ((t.tenancy_start || new Date().toISOString().slice(0, 10)) < floor) continue
        if (outOfTime()) break
        const prop = propMap.get(t.property_id)
        const tracking = trackingForProperty(t.property_id)
        const lineItem: any = {
          Description: `Tenancy deposit${t.deposit_scheme ? ` (${t.deposit_scheme})` : ''}`,
          Quantity: 1,
          UnitAmount: Number(t.deposit_amount),
          AccountCode: depositCode,
        }
        if (tracking) lineItem.Tracking = tracking
        const txnBody = {
          BankTransactions: [{
            Type: 'RECEIVE',
            Date: t.tenancy_start || new Date().toISOString().slice(0,10),
            Contact: contactForRent(t.property_id),
            BankAccount: { AccountID: bankAccountFor(t.property_id) },
            Reference: `Deposit — ${prop?.name || 'Property'}`,
            LineItems: [lineItem],
          }],
        }
        const r = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
          method: 'POST', body: JSON.stringify(txnBody),
        })
        if (!r.ok) { failed++; errors.push(`deposit ${t.id}: ${await xeroErrorSummary(r)}`); continue }
        const data = await r.json()
        await recordPushed('deposit', t.id, data.BankTransactions?.[0]?.BankTransactionID, `deposit ${t.id}`)
      }
    }

    // ── PUSH: refurb_costs → BankTransaction SPEND (separate account) ──
    // One transaction per refurb_costs row that's marked paid=true. The
    // refurb_account_code is typically a fixed-asset or capex account.
    // Capital-vs-revenue split is the user's call — we just post.
    if (pushEnabled && await mapReady(!!settings.sync_refurb_separate, 'refurb')) {
      const refurbCode = settings.refurb_account_code
        || allAccounts.find(a => a.Type === 'FIXED')?.Code
        || expenseCode
      const refurbs = await fetchAllRows(() => admin.from('refurb_costs')
        .select('id, property_id, trade, cost, paid, date, notes')
        .in('property_id', propIds).eq('paid', true).gt('cost', 0)
        .order('id', { ascending: true }))
      for (const r of refurbs) {
        if (syncedSet.has(`refurb:${r.id}`)) continue
        const prop = propMap.get(r.property_id)
        if (!r.date) { failed++; errors.push(`refurb ${r.id}: missing date — skipping`); continue }
        if (r.date < floor) continue
        if (outOfTime()) break
        const tracking = trackingForProperty(r.property_id)
        const lineItem: any = {
          Description: `${r.trade || 'Refurb'}${r.notes ? ' — ' + String(r.notes).slice(0, 80) : ''}`,
          Quantity: 1,
          UnitAmount: Number(r.cost),
          AccountCode: refurbCode,
        }
        if (tracking) lineItem.Tracking = tracking
        const txnBody = {
          BankTransactions: [{
            Type: 'SPEND',
            Date: r.date,
            Contact: { Name: `${prop?.name || 'Property'} — ${r.trade || 'Refurb'}` },
            BankAccount: { AccountID: bankAccountFor(r.property_id) },
            Reference: `Refurb — ${prop?.name || 'Property'}`,
            LineItems: [lineItem],
          }],
        }
        const apiRes = await xeroFetch(accessToken, conn.tenant_id, 'BankTransactions', {
          method: 'POST', body: JSON.stringify(txnBody),
        })
        if (!apiRes.ok) { failed++; errors.push(`refurb ${r.id}: ${await xeroErrorSummary(apiRes)}`); continue }
        const data = await apiRes.json()
        await recordPushed('refurb', r.id, data.BankTransactions?.[0]?.BankTransactionID, `refurb ${r.id}`)
      }
    }

    // ── PULL: reconciliation status from Xero ──
    if (settings.pull_reconciliation && !stoppedEarly) {
      // Pull all synced bank txns for this company in one go. Xero allows
      // GET /BankTransactions?where=...&page=N. For our scale (hundreds)
      // a single page is fine; pagination loop added when we cross 100.
      const syncedMap = await fetchAllRows(() => admin.from('xero_sync_map')
        .select('entity_type, local_id, xero_id')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .order('id', { ascending: true }))
      const xeroIdToLocal = new Map<string, { type: string; id: string }>()
      for (const m of syncedMap) {
        xeroIdToLocal.set(m.xero_id, { type: m.entity_type, id: m.local_id })
      }
      if (xeroIdToLocal.size > 0) {
        let page = 1
        const reconciledByType: Record<string, string[]> = { rent_payment: [], expense: [] }
        // We just fetch ALL and intersect — simpler than batching IDs
        // (Xero doesn't support IN() filters in their WHERE syntax for v2 API).
        while (true) {
          if (Date.now() > deadline + 25_000) { errors.push('reconciliation pull stopped at the time limit'); break }
          const r = await xeroFetch(accessToken, conn.tenant_id, `BankTransactions?page=${page}`)
          if (!r.ok) { errors.push(`reconciliation fetch failed: ${await xeroErrorSummary(r)}`); break }
          const j = await r.json()
          const list = j.BankTransactions || []
          if (list.length === 0) break
          for (const t of list) {
            const match = xeroIdToLocal.get(t.BankTransactionID)
            if (match && t.IsReconciled === true) {
              if (match.type === 'rent_payment') reconciledByType.rent_payment.push(match.id)
              else if (match.type === 'expense') reconciledByType.expense.push(match.id)
            }
          }
          if (list.length < 100) break
          page++
          // Cap raised from 20 → 200 (20,000 txns per company). At our
          // scale this is years of history. Cap exists only to prevent
          // an infinite loop if Xero's pagination semantics ever change.
          if (page > 200) { errors.push('reconciliation pull capped at 200 pages'); break }
        }
        if (reconciledByType.rent_payment.length > 0) {
          const { data: rd, error: re } = await admin.from('rent_payments').update({
            xero_reconciled: true, xero_reconciled_at: new Date().toISOString(),
          }).in('id', reconciledByType.rent_payment).in('property_id', allowedPropIds).select('id')
          if (!re) updated += (rd || []).length
        }
        if (reconciledByType.expense.length > 0) {
          const { data: ed, error: ee } = await admin.from('property_expenses').update({
            xero_reconciled: true, xero_reconciled_at: new Date().toISOString(),
          }).in('id', reconciledByType.expense).in('property_id', allowedPropIds).select('id')
          if (!ee) updated += (ed || []).length
        }
      }
    }

    // ── PULL: reverse-sync amount/date edits from Xero ───────────────────
    // When sync_reverse_changes is on AND a synced record has been edited
    // in Xero (amount or date), pull the edit back into OwnProperly.
    // Uses last_xero_fingerprint = sha256(amount|date) to detect changes.
    // Refurb/deposit/mortgage entity types aren't reverse-synced because
    // they're derived/synthesised on our side — editing them in Xero
    // would create a confusing source-of-truth conflict.
    if (settings.sync_reverse_changes && !stoppedEarly) {
      const syncedMap = await fetchAllRows(() => admin.from('xero_sync_map')
        .select('entity_type, local_id, xero_id, last_xero_fingerprint')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .in('entity_type', ['rent_payment', 'expense'])
        .order('id', { ascending: true }))
      const xeroIdToMapRow = new Map<string, any>()
      for (const m of syncedMap) xeroIdToMapRow.set(m.xero_id, m)
      if (xeroIdToMapRow.size > 0) {
        // We've already pulled all BankTransactions in the reconciliation
        // block. Doing it again here is fine for now (Xero rate limits
        // are 60/min per tenant — well within bounds). Future optimisation
        // would share the fetch across both pull paths.
        let page = 1
        while (true) {
          if (Date.now() > deadline + 25_000) { errors.push('reverse-sync pull stopped at the time limit'); break }
          const r = await xeroFetch(accessToken, conn.tenant_id, `BankTransactions?page=${page}`)
          if (!r.ok) { errors.push(`reverse-sync fetch failed: ${await xeroErrorSummary(r)}`); break }
          const j = await r.json()
          const list = j.BankTransactions || []
          if (list.length === 0) break
          for (const t of list) {
            const map = xeroIdToMapRow.get(t.BankTransactionID)
            if (!map) continue
            // Same amount and date as the expense pull stores (and
            // fingerprints): the transaction Total, and Xero's
            // "/Date(…)/" decoded by xeroDateISO.
            const xeroAmount = t.Total ?? t.SubTotal ?? t.LineItems?.[0]?.LineAmount ?? 0
            const xeroDate = xeroDateISO(t) || ''
            const fingerprint = `${Number(xeroAmount).toFixed(2)}|${xeroDate}`
            if (fingerprint === map.last_xero_fingerprint) continue
            // Apply the change to our local record
            const table = map.entity_type === 'rent_payment' ? 'rent_payments' : 'property_expenses'
            const dateCol = map.entity_type === 'rent_payment' ? 'period_start' : 'date'
            const patch: any = { amount: Number(xeroAmount) }
            if (xeroDate) patch[dateCol] = xeroDate
            const { data: upRows, error: upErr } = await admin.from(table).update(patch)
              .eq('id', map.local_id).in('property_id', allowedPropIds).select('id')
            if (upErr) {
              errors.push(`reverse-sync ${map.entity_type} ${map.local_id}: ${upErr.message}`)
              continue
            }
            if (!upRows || upRows.length === 0) {
              errors.push(`reverse-sync ${map.entity_type} ${map.local_id}: not a record of this company — skipped`)
              continue
            }
            await admin.from('xero_sync_map').update({
              last_xero_fingerprint: fingerprint,
              last_xero_synced_at: new Date().toISOString(),
            }).eq('user_id', caller.id).eq('company_id', companyId)
              .eq('entity_type', map.entity_type).eq('local_id', map.local_id)
            updated++
          }
          if (list.length < 100) break
          page++
          if (page > 200) break
        }
      }
    }

    // ── PULL: Xero SPEND bank transactions → property_expenses ──────────
    // Properly's P&L reads property_expenses, and until September 2026 that
    // table held ~£8k against ~£60k/month of rent because spend lives in
    // Xero. When pull_expenses is on, every SPEND bank transaction carrying
    // this company's Property tracking option becomes one property_expenses
    // row, keyed by Xero id in xero_sync_map so it is never pulled twice and
    // never pushed back (the push loop above skips anything in the map).
    if (settings.pull_expenses && trackingCategoryId && !stoppedEarly) {
      const optionToProperty: Record<string, string> = {}
      for (const [pid, oid] of Object.entries(trackingOptionMap)) optionToProperty[oid] = pid
      const knownRows = await fetchAllRows(() => admin.from('xero_sync_map').select('xero_id')
        .eq('user_id', caller.id).eq('company_id', companyId).eq('entity_type', 'expense')
        .order('id', { ascending: true }))
      const known = new Set<string>(knownRows.map((r: any) => r.xero_id))
      const since = String(settings.pull_expenses_since || `${new Date().getUTCFullYear()}-01-01`).slice(0, 10)
      const [sy, sm, sd] = since.split('-').map(Number)
      const where = encodeURIComponent(`Type=="SPEND"&&Status=="AUTHORISED"&&Date>=DateTime(${sy},${sm},${sd})`)
      let page = 1, pulled = 0, skippedNoProperty = 0
      while (true) {
        if (Date.now() > deadline + 25_000) { errors.push('expense pull stopped at the time limit'); break }
        const r = await xeroFetch(accessToken, conn.tenant_id, `BankTransactions?where=${where}&page=${page}`)
        if (!r.ok) { errors.push(`expense pull failed: ${await xeroErrorSummary(r)}`); break }
        const j = await r.json()
        const list = j.BankTransactions || []
        if (list.length === 0) break
        for (const t of list) {
          if (known.has(t.BankTransactionID)) continue
          const line = (t.LineItems || [])[0] || {}
          const opt = (line.Tracking || []).find((x: any) => x.TrackingCategoryID === trackingCategoryId)?.TrackingOptionID
          const propertyId = opt ? optionToProperty[opt] : null
          if (!propertyId || !propMap.has(propertyId)) { skippedNoProperty++; continue }
          const date = xeroDateISO(t)
          if (!date) { skippedNoProperty++; continue }
          const amount = Number(t.Total ?? t.SubTotal ?? line.LineAmount ?? 0)
          if (!(amount > 0)) continue
          const contact = t.Contact?.Name || ''
          const description = [contact, line.Description || t.Reference || ''].filter(Boolean).join(' · ').slice(0, 200)
          const { data: ins, error: insErr } = await admin.from('property_expenses').insert({
            property_id: propertyId, user_id: caller.id,
            category: categoriseXeroSpend(line.AccountCode, `${contact} ${line.Description || ''} ${t.Reference || ''}`),
            description: description || 'Xero expense', amount, date,
            notes: `Pulled from Xero · ${t.BankTransactionID}`, source_ref: `xero:${t.BankTransactionID}`,
            xero_reconciled: t.IsReconciled === true, xero_reconciled_at: t.IsReconciled === true ? new Date().toISOString() : null,
          }).select('id').single()
          if (insErr || !ins) { failed++; errors.push(`expense pull ${t.BankTransactionID}: ${insErr?.message || 'insert failed'}`); continue }
          // Without its map row this local expense would be pulled again
          // next run and, worse, look like a Properly expense to push. So a
          // failed map write removes the row just inserted and stops.
          const { error: mapErr } = await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId, entity_type: 'expense', local_id: ins.id,
            xero_id: t.BankTransactionID, xero_kind: 'BankTransaction',
            last_xero_fingerprint: `${amount.toFixed(2)}|${date}`, last_xero_synced_at: new Date().toISOString(),
            ...(hasOrigin ? { origin: 'pulled' } : {}),
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          if (mapErr) {
            const { error: undoErr } = await admin.from('property_expenses').delete().eq('id', ins.id)
            throw new Error(`expense pull ${t.BankTransactionID}: could not be recorded in the sync map (${mapErr.message}). ` +
              (undoErr ? `The pulled expense ${ins.id} could not be removed either (${undoErr.message}). ` : 'The pulled expense was removed again. ') +
              'Sync stopped.')
          }
          known.add(t.BankTransactionID); pulled++; created++
        }
        if (list.length < 100) break
        page++
        if (page > 200) { errors.push('expense pull capped at 200 pages'); break }
      }
      if (skippedNoProperty) errors.push(`expense pull: ${skippedNoProperty} SPEND transaction(s) skipped — no Property tracking option we recognise`)
    }

    // Finalise log + connection
    await admin.from('xero_sync_log').update({
      finished_at: new Date().toISOString(),
      status: failed > 0 ? 'partial' : 'ok',
      records_created: created, records_updated: updated, records_failed: failed,
      details: errors.length ? { errors: errors.slice(0, 50) } : null,
    }).eq('id', logRow!.id)

    await admin.from('xero_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: failed > 0 ? 'partial' : 'ok',
      last_sync_error: errors.length ? errors[0] : null,
      pending_sync_at: null,  // webhook-queued work has now been pulled
    }).eq('user_id', caller.id).eq('company_id', companyId)

    await releaseLock()

    return new Response(JSON.stringify({
      ok: true, created, updated, failed,
      stopped_early: stoppedEarly, push_blocked: !pushEnabled && action !== 'reconcile_only',
      skipped_blocks: skippedBlocks,
      errors: errors.slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    const msg = (e as Error).message
    await admin.from('xero_sync_log').update({
      finished_at: new Date().toISOString(),
      status: 'error', error_message: msg,
      records_created: created, records_updated: updated, records_failed: failed,
    }).eq('id', logRow!.id)
    await admin.from('xero_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: msg.slice(0, 500),
    }).eq('user_id', caller.id).eq('company_id', companyId)
    await releaseLock()
    return jsonError(500, msg)
  }
})
