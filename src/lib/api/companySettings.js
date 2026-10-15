// Company settings: company_settings writes (report branding, year type,
// logo, bank details) and the public subdomain branding lookup.
import { supabase } from '../supabase'
import { uid } from './_shared'

// company_settings.user_id is NOT NULL and marks the company owner. Postgres
// checks NOT NULL on an upsert's candidate row before ON CONFLICT, so an upsert
// without user_id always fails, and one with the caller's id would hand
// ownership to whichever team member saved. Update the existing row instead,
// and only insert (owned by the company's owner) when there is none.
export async function upsertCompanySettings(companyId, settings) {
  const { data: updated, error: updErr } = await supabase.from('company_settings')
    .update(settings).eq('company_id', companyId).select()
  if (updErr) throw updErr
  if (updated?.length) return updated[0]
  const { data: co } = await supabase.from('companies').select('user_id').eq('id', companyId).maybeSingle()
  const userId = co?.user_id || await uid()
  const { data, error } = await supabase.from('company_settings')
    .insert({ ...settings, company_id: companyId, user_id: userId })
    .select().single()
  if (error) throw error
  return data
}

// ── COMPANY BRANDING & REPORT SETTINGS ───────────────────────────────────────
export async function saveReportSettings(companyId, settings) {
  await upsertCompanySettings(companyId, { ...settings, updated_at: new Date().toISOString() })
}

export async function saveCompanyYearType(companyId, yearType) {
  await upsertCompanySettings(companyId, { year_type: yearType })
}

export async function uploadCompanyLogo(companyId, file) {
  // Logos go to the public-assets bucket so they remain accessible without
  // authentication (e.g. embedded in PDFs, dashboards). Stored under the
  // landlord's user-folder so RLS limits writes/deletes to the owner.
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/company_logos/${companyId}.${ext}`
  // Best-effort cleanup of any older logo (different ext, etc) to avoid orphans.
  await supabase.storage.from('public-assets').remove([path]).catch(()=>{})
  const { error: upErr } = await supabase.storage.from('public-assets').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data } = supabase.storage.from('public-assets').getPublicUrl(path)
  // Same path on replace, so version the URL or the CDN keeps serving the old logo.
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`
  await upsertCompanySettings(companyId, { logo_url: publicUrl, logo_path: path })
  return publicUrl
}

// ── SUBDOMAIN / COMPANY LOOKUP ────────────────────────────────────────────────
// Public, anon-callable branding lookup for the branded tenant login at
// <sub>.ownproperly.com. Goes through the get_company_branding_by_subdomain
// SECURITY DEFINER RPC — a logged-out visitor has no row-level SELECT on
// `companies`, and the RPC returns only public-safe branding fields
// ({ id, name, abbr, color, logo_url, tenant_portal_enabled }). Returns null
// when the subdomain is unknown or the lookup fails.
export async function fetchCompanyBySubdomain(subdomain) {
  if (!subdomain) return null
  const { data, error } = await supabase.rpc('get_company_branding_by_subdomain', {
    p_subdomain: String(subdomain).toLowerCase(),
  })
  if (error || !data) return null
  return data
}

export async function fetchCompanyBankDetails(companyId) {
  const { data } = await supabase.from('company_settings')
    .select('bank_name, bank_sort_code, bank_account_no, bank_reference_prefix, logo_url')
    .eq('company_id', companyId).single()
  return data || {}
}

export async function saveCompanyBankDetails(companyId, details) {
  await upsertCompanySettings(companyId, details)
}

export async function saveCompanySubdomain(companyId, subdomain) {
  const { error } = await supabase.from('companies')
    .update({ subdomain: subdomain.toLowerCase() }).eq('id', companyId)
  if (error) throw error
}
