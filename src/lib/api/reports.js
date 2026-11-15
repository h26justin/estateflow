// Reports data fetching across the portfolio.
//
// Scope: rows are NOT filtered by user_id. user_id on these tables is whoever
// created the row, so a creator filter hid team-mates' rows and anything a
// tenant reported. Visibility is RLS's job; the caller narrows to the
// properties it is reporting on by passing { propertyIds } (the Reports page
// passes its non-deleted property list, so rows on deleted properties drop
// out too). Every query is paged past the PostgREST row cap with a stable
// order ending in id.
//
// The first argument (the signed-in user's id) is kept so existing callers
// keep working; it no longer narrows the result.
import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'

const PROP_EMBED = 'property:properties(id,name,company_id,company:companies(name,abbr,color))'
const PROP_EMBED_RENT = 'property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))'

// Property ids are sent in the URL, so chunk them to stay under URL limits.
const ID_CHUNK = 200
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// build(ids) returns a fresh, ordered query; ids is null when the caller
// gave no property scope (RLS alone decides).
async function fetchScoped(opts, build) {
  const propertyIds = opts?.propertyIds
  if (!Array.isArray(propertyIds)) return fetchAllPages(() => build(null))
  const ids = [...new Set(propertyIds.filter(Boolean))]
  if (!ids.length) return []
  const out = []
  for (const part of chunk(ids, ID_CHUNK)) out.push(...await fetchAllPages(() => build(part)))
  return out
}

// ── REPORTS DATA FETCHING ─────────────────────────────────────────────────────
export async function fetchAllComplianceItems(_userId, opts = {}) {
  return fetchScoped(opts, ids => {
    let q = supabase.from('compliance_items').select(`*, ${PROP_EMBED}`).is('deleted_at', null)
    if (ids) q = q.in('property_id', ids)
    return q.order('expiry_date', { nullsFirst: false }).order('id')
  })
}

export async function fetchAllMaintenanceJobs(_userId, opts = {}) {
  return fetchScoped(opts, ids => {
    let q = supabase.from('maintenance_jobs').select(`*, ${PROP_EMBED}`).is('deleted_at', null)
    if (ids) q = q.in('property_id', ids)
    return q.order('created_at', { ascending: false }).order('id')
  })
}

export async function fetchAllTenancies(_userId, opts = {}) {
  return fetchScoped(opts, ids => {
    // tenancy_details has no deleted_at column (a filter on it fails the
    // whole request with 42703).
    let q = supabase.from('tenancy_details').select(`*, ${PROP_EMBED_RENT}`)
    if (ids) q = q.in('property_id', ids)
    return q.order('id')
  })
}

export async function fetchAllRentPayments(_userId, opts = {}) {
  const rows = await fetchScoped(opts, ids => {
    let q = supabase.from('rent_payments').select(`*, ${PROP_EMBED_RENT}`)
    if (ids) q = q.in('property_id', ids)
    return q
      .order('period_start', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id')
  })
  // rent_payments gained a deleted_at column in some environments only, so
  // filter here rather than in the query (a filter on a missing column fails
  // the whole request).
  return rows.filter(r => !r.deleted_at)
}

export async function fetchAllExpenses(_userId, opts = {}) {
  return fetchScoped(opts, ids => {
    let q = supabase.from('property_expenses').select(`*, ${PROP_EMBED}`).is('deleted_at', null)
    if (ids) q = q.in('property_id', ids)
    return q.order('date', { ascending: false }).order('id')
  })
}
