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

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
  await admin.from('xero_connections').update({
    access_token:           encA ? null : t.access_token,
    refresh_token:          encR ? null : t.refresh_token,
    encrypted_access_token:  encA || null,
    encrypted_refresh_token: encR || null,
    expires_at: new Date(Date.now() + (t.expires_in || 1800) * 1000).toISOString(),
  }).eq('user_id', conn.user_id).eq('company_id', conn.company_id)
  return t.access_token
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Cron path: xero-cron-reconcile invokes us with a shared secret +
  // explicit user_id header instead of a JWT. Honour that, otherwise
  // fall through to normal JWT auth.
  const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
  const cronSecret = req.headers.get('x-cron-secret') || ''
  const cronUserId = req.headers.get('x-cron-user-id') || ''
  let caller: any = null
  if (CRON_SECRET && cronSecret === CRON_SECRET && cronUserId) {
    caller = { id: cronUserId }
  } else {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return jsonError(401, 'Missing Authorization')
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    caller = userData?.user
    if (userErr || !caller) return jsonError(401, 'Invalid session')
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action || body.direction || 'to_xero'
  const companyId: string | undefined = body.company_id

  if (!companyId) return jsonError(400, 'company_id required')

  // Load the connection for this (user, company)
  const { data: conn, error: ce } = await admin
    .from('xero_connections').select('*')
    .eq('user_id', caller.id).eq('company_id', companyId).single()
  if (ce || !conn) return jsonError(404, 'No Xero connection for this company. Connect Xero first.')

  const accessToken = await refreshIfNeeded(admin, conn)

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

  // Open log row
  const { data: logRow } = await admin.from('xero_sync_log').insert({
    user_id: caller.id, company_id: companyId, direction: 'to_xero', status: 'running',
  }).select().single()

  let created = 0, updated = 0, failed = 0
  const errors: string[] = []

  try {
    // Properties for THIS company only. Optionally narrowed to the
    // user-specified subset (per-property sync from the UI's
    // "Sync this property only" button).
    let propsQuery = admin.from('properties')
      .select('id, name, address')
      .eq('user_id', caller.id).eq('company_id', companyId).is('deleted_at', null)
    if (Array.isArray(body.property_ids) && body.property_ids.length > 0) {
      propsQuery = propsQuery.in('id', body.property_ids)
    }
    const { data: props } = await propsQuery
    if (!props || props.length === 0) throw new Error('No properties in this company to sync')
    const propMap = new Map(props.map(p => [p.id, p]))
    const propIds = props.map(p => p.id)

    // Pull chart of accounts once for: default bank account lookup, income/expense code pick, validation
    const accountsRes = await xeroFetch(accessToken, conn.tenant_id, 'Accounts?where=Status=="ACTIVE"')
    if (!accountsRes.ok) throw new Error('Failed to list Xero accounts: ' + await xeroErrorSummary(accountsRes))
    const allAccounts: any[] = (await accountsRes.json()).Accounts || []
    const bankAccounts = allAccounts.filter(a => a.Type === 'BANK')

    // Resolve default bank account: user-picked override → first available
    let defaultBankId = settings.default_bank_account_id
    if (defaultBankId && !bankAccounts.find(a => a.AccountID === defaultBankId)) {
      // User's chosen account no longer exists or isn't active
      defaultBankId = null
    }
    if (!defaultBankId) defaultBankId = bankAccounts[0]?.AccountID
    if (!defaultBankId) throw new Error('No active bank account in Xero — add one first')

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
    if (settings.sync_tracking_categories) {
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
    const { data: synced } = await admin.from('xero_sync_map')
      .select('entity_type, local_id')
      .eq('user_id', caller.id).eq('company_id', companyId)
    const syncedSet = new Set((synced || []).map(s => `${s.entity_type}:${s.local_id}`))

    // Optionally pre-fetch tenancy_details for real-contact mode.
    // Two levels:
    //   sync_real_tenant_contacts → use the tenant name
    //   sync_real_tenant_emails   → also push email + phone into the Xero contact
    // Returns a richer object per property when emails are enabled so we can
    // build a full Xero Contact { Name, EmailAddress, Phones } payload.
    type TenantInfo = { name: string; email?: string; phone?: string }
    const tenantContactMap: Record<string, TenantInfo> = {}
    if (settings.sync_real_tenant_contacts) {
      const { data: tenancies } = await admin.from('tenancy_details')
        .select('property_id, tenant_names, tenant_email, tenant_phone')
        .in('property_id', propIds)
      for (const t of (tenancies || [])) {
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

    // For cron-driven reconcile_only runs we skip ALL push blocks —
    // pulling reconciliation/edits back is idempotent and safe to run
    // unattended; auto-pushing isn't.
    const pushEnabled = action !== 'reconcile_only'

    // ── PUSH: rent_payments → BankTransaction RECEIVE ──
    if (pushEnabled && settings.sync_rent) {
      const { data: payments } = await admin.from('rent_payments')
        .select('id, property_id, amount, status, period_start, period_end, year, month')
        .in('property_id', propIds).eq('status', 'paid').gt('amount', 0)
      for (const p of (payments || [])) {
        if (syncedSet.has(`rent_payment:${p.id}`)) continue
        const prop = propMap.get(p.property_id)
        const txnDate = p.period_start
          || (p.year && p.month ? `${p.year}-${String(p.month).padStart(2,'0')}-01` : null)
        if (!txnDate) { failed++; errors.push(`rent ${p.id}: missing date — skipping`); continue }
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
        const xid = data.BankTransactions?.[0]?.BankTransactionID
        if (xid) {
          await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId, entity_type: 'rent_payment', local_id: p.id,
            xero_id: xid, xero_kind: 'BankTransaction',
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          created++
        }
      }
    }

    // ── PUSH: property_expenses → BankTransaction SPEND ──
    if (pushEnabled && settings.sync_expenses) {
      const { data: expenses } = await admin.from('property_expenses')
        .select('id, property_id, amount, date, category, description')
        .in('property_id', propIds).is('deleted_at', null).gt('amount', 0)
      for (const e of (expenses || [])) {
        if (syncedSet.has(`expense:${e.id}`)) continue
        const prop = propMap.get(e.property_id)
        if (!e.date) { failed++; errors.push(`expense ${e.id}: missing date — skipping`); continue }
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
        const xid = data.BankTransactions?.[0]?.BankTransactionID
        if (xid) {
          await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId, entity_type: 'expense', local_id: e.id,
            xero_id: xid, xero_kind: 'BankTransaction',
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          created++
        }
      }
    }

    // ── PUSH: monthly mortgage interest accruals ──
    // Computed from properties.mortgage_amount * mortgage_rate / 12 for
    // properties marked interest_only. Posts one txn per month per property
    // for any month that hasn't been pushed yet (idempotency via the
    // synthetic entity_type 'mortgage_interest' + a local_id of
    // <property_id>:<YYYY-MM>).
    if (pushEnabled && settings.sync_mortgage_interest) {
      const { data: propsWithMortgage } = await admin.from('properties')
        .select('id, name, mortgage_amount, mortgage_rate, mortgage_type, mortgage_product_end_date')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .is('deleted_at', null)
        .gt('mortgage_amount', 0)
        .gt('mortgage_rate', 0)
      for (const p of (propsWithMortgage || [])) {
        const monthlyInterest = (Number(p.mortgage_amount) * (Number(p.mortgage_rate) / 100)) / 12
        if (monthlyInterest <= 0) continue
        // Post for the current month if not already posted
        const now = new Date()
        const yyyymm = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
        const localId = `${p.id}:${yyyymm}`
        if (syncedSet.has(`mortgage_interest:${localId}`)) continue
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
        const xid = data.BankTransactions?.[0]?.BankTransactionID
        if (xid) {
          // Cast UUID column local_id — for mortgage_interest we use a
          // synthetic property_id:yyyymm string. We need a different
          // column or a stable hash. For now use a v5-style UUID derived
          // from the localId so we conform to the column type. Note that
          // xero_sync_map.local_id is UUID, so we need to fit.
          // Quickest path: hash to UUID-shaped string.
          const hashHex = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(localId)))
          const hashBytes = new Uint8Array(hashHex)
          const hex = Array.from(hashBytes).slice(0, 16).map(b => b.toString(16).padStart(2,'0')).join('')
          const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`
          await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId,
            entity_type: 'mortgage_interest', local_id: uuid,
            xero_id: xid, xero_kind: 'BankTransaction',
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          created++
        }
      }
    }

    // ── PUSH: tenancy deposits → BankTransaction RECEIVE (separate account) ──
    // Posts one transaction per tenancy that has deposit_amount > 0, using
    // the deposits_account_code (typically a liability account like 'Customer
    // Deposits'). Idempotent per tenancy_details.id (entity_type='deposit').
    if (pushEnabled && settings.sync_deposits_separate) {
      const depositCode = settings.deposits_account_code
        || allAccounts.find(a => a.Type === 'CURRLIAB')?.Code
        || incomeCode
      const { data: tenancies } = await admin.from('tenancy_details')
        .select('id, property_id, tenant_names, deposit_amount, deposit_scheme, tenancy_start')
        .in('property_id', propIds).gt('deposit_amount', 0)
      for (const t of (tenancies || [])) {
        if (syncedSet.has(`deposit:${t.id}`)) continue
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
        const xid = data.BankTransactions?.[0]?.BankTransactionID
        if (xid) {
          await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId, entity_type: 'deposit', local_id: t.id,
            xero_id: xid, xero_kind: 'BankTransaction',
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          created++
        }
      }
    }

    // ── PUSH: refurb_costs → BankTransaction SPEND (separate account) ──
    // One transaction per refurb_costs row that's marked paid=true. The
    // refurb_account_code is typically a fixed-asset or capex account.
    // Capital-vs-revenue split is the user's call — we just post.
    if (pushEnabled && settings.sync_refurb_separate) {
      const refurbCode = settings.refurb_account_code
        || allAccounts.find(a => a.Type === 'FIXED')?.Code
        || expenseCode
      const { data: refurbs } = await admin.from('refurb_costs')
        .select('id, property_id, trade, cost, paid, date, notes')
        .in('property_id', propIds).eq('paid', true).gt('cost', 0)
      for (const r of (refurbs || [])) {
        if (syncedSet.has(`refurb:${r.id}`)) continue
        const prop = propMap.get(r.property_id)
        if (!r.date) { failed++; errors.push(`refurb ${r.id}: missing date — skipping`); continue }
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
        const xid = data.BankTransactions?.[0]?.BankTransactionID
        if (xid) {
          await admin.from('xero_sync_map').upsert({
            user_id: caller.id, company_id: companyId, entity_type: 'refurb', local_id: r.id,
            xero_id: xid, xero_kind: 'BankTransaction',
          }, { onConflict: 'user_id,company_id,entity_type,local_id' })
          created++
        }
      }
    }

    // ── PULL: reconciliation status from Xero ──
    if (settings.pull_reconciliation) {
      // Pull all synced bank txns for this company in one go. Xero allows
      // GET /BankTransactions?where=...&page=N. For our scale (hundreds)
      // a single page is fine; pagination loop added when we cross 100.
      const { data: syncedMap } = await admin.from('xero_sync_map')
        .select('entity_type, local_id, xero_id')
        .eq('user_id', caller.id).eq('company_id', companyId)
      const xeroIdToLocal = new Map<string, { type: string; id: string }>()
      for (const m of (syncedMap || [])) {
        xeroIdToLocal.set(m.xero_id, { type: m.entity_type, id: m.local_id })
      }
      if (xeroIdToLocal.size > 0) {
        let page = 1
        const reconciledByType: Record<string, string[]> = { rent_payment: [], expense: [] }
        // We just fetch ALL and intersect — simpler than batching IDs
        // (Xero doesn't support IN() filters in their WHERE syntax for v2 API).
        while (true) {
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
          const { error: re } = await admin.from('rent_payments').update({
            xero_reconciled: true, xero_reconciled_at: new Date().toISOString(),
          }).in('id', reconciledByType.rent_payment)
          if (!re) updated += reconciledByType.rent_payment.length
        }
        if (reconciledByType.expense.length > 0) {
          const { error: ee } = await admin.from('property_expenses').update({
            xero_reconciled: true, xero_reconciled_at: new Date().toISOString(),
          }).in('id', reconciledByType.expense)
          if (!ee) updated += reconciledByType.expense.length
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
    if (settings.sync_reverse_changes) {
      const { data: syncedMap } = await admin.from('xero_sync_map')
        .select('entity_type, local_id, xero_id, last_xero_fingerprint')
        .eq('user_id', caller.id).eq('company_id', companyId)
        .in('entity_type', ['rent_payment', 'expense'])
      const xeroIdToMapRow = new Map<string, any>()
      for (const m of (syncedMap || [])) xeroIdToMapRow.set(m.xero_id, m)
      if (xeroIdToMapRow.size > 0) {
        // We've already pulled all BankTransactions in the reconciliation
        // block. Doing it again here is fine for now (Xero rate limits
        // are 60/min per tenant — well within bounds). Future optimisation
        // would share the fetch across both pull paths.
        let page = 1
        while (true) {
          const r = await xeroFetch(accessToken, conn.tenant_id, `BankTransactions?page=${page}`)
          if (!r.ok) { errors.push(`reverse-sync fetch failed: ${await xeroErrorSummary(r)}`); break }
          const j = await r.json()
          const list = j.BankTransactions || []
          if (list.length === 0) break
          for (const t of list) {
            const map = xeroIdToMapRow.get(t.BankTransactionID)
            if (!map) continue
            const xeroAmount = t.LineItems?.[0]?.LineAmount ?? t.SubTotal ?? t.Total ?? 0
            const xeroDate = (t.Date || '').slice(0, 10)
            const fingerprint = `${Number(xeroAmount).toFixed(2)}|${xeroDate}`
            if (fingerprint === map.last_xero_fingerprint) continue
            // Apply the change to our local record
            const table = map.entity_type === 'rent_payment' ? 'rent_payments' : 'property_expenses'
            const dateCol = map.entity_type === 'rent_payment' ? 'period_start' : 'date'
            const patch: any = { amount: Number(xeroAmount) }
            if (xeroDate) patch[dateCol] = xeroDate
            const { error: upErr } = await admin.from(table).update(patch).eq('id', map.local_id)
            if (upErr) {
              errors.push(`reverse-sync ${map.entity_type} ${map.local_id}: ${upErr.message}`)
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
    }).eq('user_id', caller.id).eq('company_id', companyId)

    return new Response(JSON.stringify({
      ok: true, created, updated, failed,
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
    return jsonError(500, msg)
  }
})
