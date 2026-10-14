// Reports data fetching across the portfolio.
import { supabase } from '../supabase'

// ── REPORTS DATA FETCHING ─────────────────────────────────────────────────────
export async function fetchAllComplianceItems(userId) {
  const { data, error } = await supabase.from('compliance_items')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}

export async function fetchAllMaintenanceJobs(userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllTenancies(userId) {
  const { data, error } = await supabase.from('tenancy_details')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchAllRentPayments(userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllExpenses(userId) {
  const { data, error } = await supabase.from('property_expenses')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('date', { ascending: false })
  if (error) throw error
  return data || []
}
