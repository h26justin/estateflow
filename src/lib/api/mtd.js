// MTD ITSA: HMRC settings, quarterly submissions and OAuth.
import { supabase } from '../supabase'
import { collectClientFraudHeaders } from '../hmrcFraudHeaders'
import { RECEIVED_STATUSES, estimateMortgageInterest } from '../mtdItsa'

// ── MTD ITSA (Making Tax Digital — Income Tax Self Assessment) ────────────────
// HMRC mandate hits 6 Apr 2026 for landlords > £50k income, 6 Apr 2027 > £30k.
// We provide per-user HMRC settings (NINO + business ID + OAuth tokens) and
// per-quarter submission rows with the aggregated income/expenses snapshot.

// Never select the HMRC token columns: anon/authenticated have no SELECT on
// them (2026-10-14_integration_token_column_grants.sql), so '*' would fail.
const MTD_SETTINGS_SAFE_COLS = 'user_id, nino, mtd_business_id, sandbox_mode, cash_basis, property_business_type, hmrc_token_expires_at, created_at, updated_at'

export async function fetchMtdSettings() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  // Explicit column list — never pull the OAuth tokens back to the client.
  // Token presence is exposed as the boolean `hmrc_oauth_connected` so the
  // UI can show whether the user has done the gov.uk handshake without
  // sending the actual token over the wire.
  const { data, error } = await supabase
    .from('mtd_settings')
    .select(MTD_SETTINGS_SAFE_COLS)
    .eq('user_id', uid).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    // Synthetic flag for UI gating — true if a non-expired access token exists.
    hmrc_access_token: !!(data.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function saveMtdSettings(patch) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  // Never let the client write OAuth tokens directly — those land via the
  // mtd-submit edge function during the HMRC OAuth callback.
  const safe = { ...patch }
  delete safe.hmrc_access_token
  delete safe.hmrc_refresh_token
  delete safe.encrypted_hmrc_access_token
  delete safe.encrypted_hmrc_refresh_token
  delete safe.hmrc_token_expires_at
  const { data, error } = await supabase
    .from('mtd_settings')
    .upsert({ user_id: uid, ...safe }, { onConflict: 'user_id' })
    .select(MTD_SETTINGS_SAFE_COLS).single()
  if (error) throw error
  return {
    ...data,
    // Same synthetic flag as fetchMtdSettings (the token itself is never read).
    hmrc_access_token: !!(data?.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function fetchMtdSubmissions(taxYear) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  let q = supabase.from('mtd_submissions').select('*').eq('user_id', uid)
  if (taxYear) q = q.eq('tax_year', taxYear)
  const { data, error } = await q.order('quarter_number', { ascending: true })
  if (error) throw error
  return data || []
}

export async function upsertMtdSubmission({ tax_year, quarter_number, period_from, period_to, deadline, summary_json, status = 'draft' }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('mtd_submissions')
    .upsert({
      user_id: uid, tax_year, quarter_number, period_from, period_to, deadline,
      summary_json, status,
    }, { onConflict: 'user_id,tax_year,quarter_number' })
    .select().single()
  if (error) throw error
  return data
}

// Aggregate the user's rent + expenses for a given period across ALL their
// personally held properties. Returns the raw rows so the caller can run
// buildQuarterlySummary from src/lib/mtdItsa.js client-side (keeps tax logic
// in one place).
export async function fetchMtdRawForPeriod({ periodFrom, periodTo, propertyIds = null }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')

  // Default: all user's non-deleted properties. Companies are also used as
  // plain portfolio groups (nearly every property has a company_id), so
  // company_id can't tell a limited-company holding from a personal one;
  // excluding company properties needs an explicit ownership flag first.
  // We also need mortgage_amount +
  // mortgage_rate so we can compute the period's mortgage interest accrual
  // (residential financial cost — gets 20% basic-rate relief under S24).
  let propIds = propertyIds
  let mortgageProps = []
  if (!propIds) {
    const { data: props, error: pe } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .eq('user_id', uid).is('deleted_at', null)
    if (pe) throw pe
    propIds = (props || []).map(p => p.id)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  } else {
    const { data: props } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .in('id', propIds).is('deleted_at', null)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  }
  if (propIds.length === 0) return { payments: [], expenses: [], mortgageInterest: 0 }

  // Legacy rows carry only year/month (period_start IS NULL) — a plain
  // gte/lte on period_start silently excludes them, understating MTD income.
  // Fetch NULL-period rows too, synthesise whole-month period dates from
  // year/month, then re-filter to the requested window client-side.
  const [paymentsRes, expensesRes] = await Promise.all([
    supabase.from('rent_payments').select('id, property_id, amount, period_start, period_end, status, year, month')
      .in('property_id', propIds)
      .in('status', RECEIVED_STATUSES)
      .or(`and(period_start.gte.${periodFrom},period_start.lte.${periodTo}),period_start.is.null`),
    supabase.from('property_expenses').select('id, property_id, amount, date, category, description')
      .in('property_id', propIds)
      .is('deleted_at', null)
      .gte('date', periodFrom).lte('date', periodTo),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (expensesRes.error) throw expensesRes.error

  const pad2 = (n) => String(n).padStart(2, '0')
  const payments = (paymentsRes.data || [])
    .map(p => {
      if (p.period_start || !p.year || !p.month) return p
      const lastDay = new Date(p.year, p.month, 0).getDate()
      return {
        ...p,
        period_start: `${p.year}-${pad2(p.month)}-01`,
        period_end: p.period_end || `${p.year}-${pad2(p.month)}-${pad2(lastDay)}`,
      }
    })
    .filter(p => p.period_start && p.period_start >= periodFrom && p.period_start <= periodTo)

  // Estimated mortgage interest accrued over the period =
  //   sum(balance × annual_rate) × (period_days / 365)
  // mortgage_rate is stored as DECIMAL (0.05 for 5%). Year-one approximation
  // (true interest declines as principal is paid down on repayment mortgages).
  // Properties with actual 'mortgage_interest' expenses recorded in the
  // period are left out of the estimate: the recorded figure is used instead.
  const expenses = expensesRes.data || []
  const mortgageInterest = estimateMortgageInterest({ mortgageProps, expenses, periodFrom, periodTo })

  return { payments, expenses, mortgageInterest }
}

// Start the HMRC gov.uk OAuth flow. Returns nothing — performs a
// full-page redirect to HMRC's authorize endpoint. After the user
// consents, HMRC redirects back to our hmrc-oauth-callback edge
// function which stores tokens + bounces user back here with
// ?hmrc_connected=1.
export async function startHmrcOAuth() {
  const { data, error } = await supabase.functions.invoke('hmrc-oauth-callback', {
    body: { action: 'start', return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('HMRC OAuth not configured — Justin needs to set HMRC_CLIENT_ID and add the redirect URI to the HMRC dev hub app.')
  window.location.href = data.authorize_url
}

// Clear the stored HMRC access + refresh tokens (next submission falls
// back to the local mock path). Keeps NINO / business ID / cash basis
// settings intact.
export async function disconnectHmrc() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase.from('mtd_settings').update({
    hmrc_access_token: null,
    hmrc_refresh_token: null,
    encrypted_hmrc_access_token: null,
    encrypted_hmrc_refresh_token: null,
    hmrc_token_expires_at: null,
  }).eq('user_id', uid)
  if (error) throw error
}

// Submit (or re-submit) a quarterly summary to HMRC via the mtd-submit
// edge function. In sandbox mode the edge function returns a mock
// reference; otherwise we collect Gov-Client-* fraud prevention headers
// (mandatory per HMRC's Fraud Prevention Spec — submissions without
// them are increasingly rejected in sandbox and always rejected in
// production) and pass them along so the edge function can forward
// them to HMRC.
export async function submitMtdQuarter(submissionId) {
  const fraudHeaders = await collectClientFraudHeaders()
  const { data, error } = await supabase.functions.invoke('mtd-submit', {
    body: { submission_id: submissionId, fraud_headers: fraudHeaders }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Is live HMRC filing switched on server-side (production credentials and
// API host)? Anything else, including an older function deploy that doesn't
// know the probe, reads as not live: the honest default.
export async function fetchMtdLiveStatus() {
  try {
    const { data, error } = await supabase.functions.invoke('mtd-submit', { body: { action: 'status' } })
    if (error) return false
    return data?.live_filing_available === true
  } catch {
    return false
  }
}
