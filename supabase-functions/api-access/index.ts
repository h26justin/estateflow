// Read-only API access for external clients (e.g. a Claude session).
//
// Lets a user mint a personal access token in the app, then point any tool
// they trust at this function to READ their portfolio data. Two auth modes:
//
//   1. Token management routes — require a normal Supabase user JWT
//      (called from the app's Settings → Security → API Access panel):
//        POST   /api-access/tokens        { name?, expires_in_days? }
//                 → mints a token, returns { token } ONCE plus metadata
//        GET    /api-access/tokens        → list token metadata
//        DELETE /api-access/tokens/:id    → revoke (sets revoked_at)
//
//   2. Data routes — require `Authorization: Bearer opat_<64 hex>`:
//        GET /api-access/me
//        GET /api-access/summary
//        GET /api-access/companies
//        GET /api-access/properties      ?company_id=&status=&limit=&offset=
//        GET /api-access/tenancies       ?property_id=&limit=&offset=
//        GET /api-access/rent-payments   ?property_id=&from=&to=&limit=&offset=
//        GET /api-access/expenses        ?property_id=&from=&to=&limit=&offset=
//        GET /api-access/compliance      ?property_id=&limit=&offset=
//        GET /api-access/maintenance     ?property_id=&status=&limit=&offset=
//
// IMPORTANT — deploy with verify_jwt OFF (like ingest-statement-email):
// API tokens are not gateway JWTs, so the gateway must not pre-reject them.
// All auth is enforced in this file and fails closed.
//
// Security model:
//   - Tokens are 32 random bytes, stored as SHA-256 hashes only
//     (api_access_tokens). Plaintext is returned exactly once at mint time.
//   - Data routes are GET-only and read from fixed column whitelists —
//     no secrets columns (statement_email_token etc.), no cross-tenant data.
//   - Scoping mirrors the RLS rules: the user's own rows plus rows of
//     companies they own or have user_company_access to. Soft-deleted rows
//     are excluded. Service role is used the same way the other edge
//     functions use it; RLS remains untouched.
//   - No writes of any kind to portfolio data. The only writes here are the
//     token rows themselves and last_used_at stamping.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const TOKEN_PREFIX = 'opat_' // "OwnProperly access token"
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
const MAX_TOKENS_PER_USER = 10

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return hexEncode(new Uint8Array(digest))
}

// Column whitelists per resource. Deliberately excludes internal/admin and
// secret-bearing columns (companies.statement_email_token, free-tier admin
// fields, geocode plumbing) and tenant contact details (tenant_email/phone).
const PROPERTY_COLS = 'id, company_id, name, address, prop_type, status, purchase_price, purchase_date, refurb_cost, current_value, est_value, rent_pcm, rent_due_day, tenant_name, tenant_since, tenancy_end, arrears, mortgage_amount, mortgage_rate, mortgage_term, mortgage_type, mortgage_monthly_payment, mortgage_product_end_date, deposit, is_hmo, epc_rating, epc_expiry_date, licensing_scheme, managed_by, vacant_since, sale_price, sale_date, notes, created_at, updated_at'
const COMPANY_COLS = 'id, name, abbr, company_type, contact_mode, created_at'
const RENT_COLS = 'id, property_id, year, month, month_label, status, amount, period_start, period_end, notes, created_at'
const EXPENSE_COLS = 'id, property_id, category, description, amount, date, recurring, recurring_freq, notes, created_at'
const COMPLIANCE_COLS = 'id, property_id, cert_type, cert_name, issue_date, expiry_date, notes, created_at'
const TENANCY_COLS = 'id, property_id, tenant_names, tenancy_start, tenancy_end, deposit_amount, deposit_scheme, rent_review_date, break_clause, notice_period, notes, created_at, updated_at'
const MAINTENANCE_COLS = 'id, property_id, title, description, category, priority, status, contractor, quoted_cost, actual_cost, date_raised, date_resolved, notes, created_at'

// ── Access scoping — mirrors the RLS helpers (owner + shared companies) ──

async function accessibleCompanyIds(admin: any, userId: string): Promise<string[]> {
  const [owned, shared] = await Promise.all([
    admin.from('companies').select('id').eq('owner_id', userId).is('deleted_at', null),
    admin.from('user_company_access').select('company_id').eq('user_id', userId),
  ])
  const ids = new Set<string>()
  for (const r of owned.data || []) ids.add(r.id)
  for (const r of shared.data || []) if (r.company_id) ids.add(r.company_id)
  return [...ids]
}

async function accessiblePropertyIds(admin: any, userId: string, companyIds: string[]): Promise<string[]> {
  const orClause = companyIds.length
    ? `user_id.eq.${userId},company_id.in.(${companyIds.join(',')})`
    : `user_id.eq.${userId}`
  const { data, error } = await admin
    .from('properties').select('id').or(orClause).is('deleted_at', null)
  if (error) throw error
  return (data || []).map((r: any) => r.id)
}

function parsePaging(params: URLSearchParams) {
  const limit = Math.min(Math.max(parseInt(params.get('limit') || '') || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(parseInt(params.get('offset') || '') || 0, 0)
  return { limit, offset }
}

// Filter a caller-supplied property_id down to ones the token can see.
// Returns null when the filter excludes everything (caller gets []).
function scopeToParam(scopedIds: string[], requested: string | null): string[] | null {
  if (!requested) return scopedIds
  return scopedIds.includes(requested) ? [requested] : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const url = new URL(req.url)
  // Path after the function name: /api-access/<route...>
  const segments = url.pathname.split('/').filter(Boolean)
  const fnIdx = segments.indexOf('api-access')
  const route = segments.slice(fnIdx + 1) // e.g. ['tokens'], ['properties']

  const authHeader = req.headers.get('Authorization') || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return json({ error: 'Missing Authorization header' }, 401)

  // ─────────────────────────────────────────────────────────────────────
  // Token management (Supabase user JWT)
  // ─────────────────────────────────────────────────────────────────────
  if (route[0] === 'tokens') {
    const { data: userData } = await admin.auth.getUser(bearer)
    const user = userData?.user
    if (!user) return json({ error: 'Unauthorised — token management requires a signed-in session' }, 401)

    if (req.method === 'POST' && route.length === 1) {
      let body: any = {}
      try { body = await req.json() } catch { /* empty body is fine */ }
      const name = (typeof body.name === 'string' && body.name.trim().slice(0, 80)) || 'Claude'
      const expiresDays = Number(body.expires_in_days)
      const expiresAt = Number.isFinite(expiresDays) && expiresDays > 0
        ? new Date(Date.now() + Math.min(expiresDays, 365) * 86_400_000).toISOString()
        : null

      const { count } = await admin.from('api_access_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).is('revoked_at', null)
      if ((count || 0) >= MAX_TOKENS_PER_USER) {
        return json({ error: `Token limit reached (${MAX_TOKENS_PER_USER}). Revoke an existing token first.` }, 409)
      }

      const raw = new Uint8Array(32)
      crypto.getRandomValues(raw)
      const token = TOKEN_PREFIX + hexEncode(raw)
      const tokenHash = await sha256Hex(token)

      const { data: row, error } = await admin.from('api_access_tokens').insert({
        user_id: user.id,
        name,
        token_prefix: token.slice(0, 12),
        token_hash: tokenHash,
        expires_at: expiresAt,
      }).select('id, name, token_prefix, scopes, created_at, expires_at').single()
      if (error) return json({ error: 'Failed to create token' }, 500)

      // The ONLY time the plaintext leaves the server.
      return json({ token, ...row }, 201)
    }

    if (req.method === 'GET' && route.length === 1) {
      const { data, error } = await admin.from('api_access_tokens')
        .select('id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) return json({ error: 'Failed to list tokens' }, 500)
      return json({ tokens: data || [] })
    }

    if (req.method === 'DELETE' && route.length === 2) {
      const { data, error } = await admin.from('api_access_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', route[1]).eq('user_id', user.id).is('revoked_at', null)
        .select('id')
      if (error) return json({ error: 'Failed to revoke token' }, 500)
      if (!data?.length) return json({ error: 'Token not found or already revoked' }, 404)
      return json({ revoked: route[1] })
    }

    return json({ error: 'Unknown token route' }, 404)
  }

  // ─────────────────────────────────────────────────────────────────────
  // Data routes (API token)
  // ─────────────────────────────────────────────────────────────────────
  if (req.method !== 'GET') return json({ error: 'Data routes are read-only — GET only' }, 405)
  if (!bearer.startsWith(TOKEN_PREFIX)) {
    return json({ error: `Data routes require an API token (${TOKEN_PREFIX}…). Create one in Settings → Security → API Access.` }, 401)
  }

  const tokenHash = await sha256Hex(bearer)
  const { data: tok } = await admin.from('api_access_tokens')
    .select('id, user_id, scopes, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!tok || tok.revoked_at) return json({ error: 'Invalid or revoked token' }, 401)
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: 'Token expired' }, 401)
  if (!(tok.scopes || []).includes('read')) return json({ error: 'Token lacks read scope' }, 403)

  // Fire-and-forget usage stamp.
  admin.from('api_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id)
    .then(() => {}, () => {})

  const userId = tok.user_id
  const params = url.searchParams
  const { limit, offset } = parsePaging(params)

  try {
    const companyIds = await accessibleCompanyIds(admin, userId)

    switch (route[0]) {
      case 'me': {
        const { data: profile } = await admin.from('user_profiles')
          .select('full_name, email, account_type').eq('user_id', userId).maybeSingle()
        return json({
          user_id: userId,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          account_type: profile?.account_type || null,
          company_ids: companyIds,
        })
      }

      case 'companies': {
        if (!companyIds.length) return json({ data: [] })
        const { data, error } = await admin.from('companies')
          .select(COMPANY_COLS).in('id', companyIds).is('deleted_at', null)
          .order('created_at').range(offset, offset + limit - 1)
        if (error) throw error
        return json({ data, limit, offset })
      }

      case 'properties': {
        const requestedCompany = params.get('company_id')
        if (requestedCompany && !companyIds.includes(requestedCompany)) return json({ data: [], limit, offset })
        let q = admin.from('properties').select(PROPERTY_COLS).is('deleted_at', null)
        if (requestedCompany) {
          q = q.eq('company_id', requestedCompany)
        } else {
          q = q.or(companyIds.length
            ? `user_id.eq.${userId},company_id.in.(${companyIds.join(',')})`
            : `user_id.eq.${userId}`)
        }
        if (params.get('status')) q = q.eq('status', params.get('status'))
        const { data, error } = await q.order('created_at').range(offset, offset + limit - 1)
        if (error) throw error
        return json({ data, limit, offset })
      }

      case 'summary': {
        const propIds = await accessiblePropertyIds(admin, userId, companyIds)
        if (!propIds.length) return json({ properties: 0 })
        const { data: props, error } = await admin.from('properties')
          .select('status, purchase_price, refurb_cost, current_value, est_value, rent_pcm, arrears, mortgage_amount')
          .in('id', propIds)
        if (error) throw error
        const num = (v: any) => Number(v) || 0
        const active = (props || []).filter((p: any) => p.status !== 'sold')
        const sum = (f: (p: any) => number) => active.reduce((a: number, p: any) => a + f(p), 0)
        const in60d = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
        const [{ count: expiring }, { count: openJobs }] = await Promise.all([
          admin.from('compliance_items').select('id', { count: 'exact', head: true })
            .in('property_id', propIds).is('deleted_at', null).lte('expiry_date', in60d),
          admin.from('maintenance_jobs').select('id', { count: 'exact', head: true })
            .in('property_id', propIds).is('deleted_at', null).not('status', 'in', '(resolved,closed,completed)'),
        ])
        return json({
          properties: active.length,
          companies: companyIds.length,
          total_purchase_cost: sum(p => num(p.purchase_price) + num(p.refurb_cost)),
          total_current_value: sum(p => num(p.current_value) || num(p.est_value)),
          total_rent_pcm: sum(p => num(p.rent_pcm)),
          total_arrears: sum(p => num(p.arrears)),
          total_mortgage_debt: sum(p => num(p.mortgage_amount)),
          compliance_expiring_60d: expiring || 0,
          open_maintenance_jobs: openJobs || 0,
        })
      }

      case 'tenancies':
      case 'rent-payments':
      case 'expenses':
      case 'compliance':
      case 'maintenance': {
        const propIds = await accessiblePropertyIds(admin, userId, companyIds)
        const scoped = scopeToParam(propIds, params.get('property_id'))
        if (!scoped || !scoped.length) return json({ data: [], limit, offset })

        const table = {
          'tenancies': 'tenancy_details',
          'rent-payments': 'rent_payments',
          'expenses': 'property_expenses',
          'compliance': 'compliance_items',
          'maintenance': 'maintenance_jobs',
        }[route[0]]!
        const cols = {
          'tenancies': TENANCY_COLS,
          'rent-payments': RENT_COLS,
          'expenses': EXPENSE_COLS,
          'compliance': COMPLIANCE_COLS,
          'maintenance': MAINTENANCE_COLS,
        }[route[0]]!

        let q = admin.from(table).select(cols).in('property_id', scoped)
        // tenancy_details and rent_payments have no deleted_at column.
        if (route[0] === 'expenses' || route[0] === 'compliance' || route[0] === 'maintenance') {
          q = q.is('deleted_at', null)
        }
        if (route[0] === 'rent-payments') {
          if (params.get('from')) q = q.gte('period_start', params.get('from'))
          if (params.get('to')) q = q.lte('period_start', params.get('to'))
        }
        if (route[0] === 'expenses') {
          if (params.get('from')) q = q.gte('date', params.get('from'))
          if (params.get('to')) q = q.lte('date', params.get('to'))
        }
        if (route[0] === 'maintenance' && params.get('status')) q = q.eq('status', params.get('status'))

        const { data, error } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
        if (error) throw error
        return json({ data, limit, offset })
      }

      default:
        return json({
          error: 'Unknown route',
          routes: ['me', 'summary', 'companies', 'properties', 'tenancies', 'rent-payments', 'expenses', 'compliance', 'maintenance'],
        }, 404)
    }
  } catch (e) {
    console.error('api-access error:', e)
    return json({ error: 'Internal error' }, 500)
  }
})
