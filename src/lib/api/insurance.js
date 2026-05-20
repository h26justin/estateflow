// Insurance policies.
//
// Tracks landlord/buildings/etc insurance policies. Each renewal creates a
// new row pointing at the previous one via previous_policy_id so we can
// build year-over-year history. Policies link to companies (always) and
// to properties (zero, one or many) through the insurance_policy_properties
// join table.

import { supabase } from '../supabase'

const uid = async () => (await supabase.auth.getUser()).data.user.id

export const POLICY_TYPES = [
  { v: 'buildings',        l: 'Buildings' },
  { v: 'contents',         l: 'Contents' },
  { v: 'landlord',         l: 'Landlord (combined)' },
  { v: 'rent_guarantee',   l: 'Rent Guarantee' },
  { v: 'public_liability', l: 'Public Liability' },
  { v: 'hmo',              l: 'HMO-specific' },
  { v: 'other',            l: 'Other' },
]

/**
 * Fetch all insurance policies the user can see, with their linked
 * properties hydrated. RLS scopes to companies you have access to.
 * Excludes soft-deleted rows.
 */
export async function fetchInsurancePolicies() {
  const { data, error } = await supabase
    .from('insurance_policies')
    .select(`
      *,
      company:companies(id, name, abbr, color),
      insurance_policy_properties(property_id, property:properties(id, name, address))
    `)
    .is('deleted_at', null)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return (data || []).map(p => ({
    ...p,
    properties: (p.insurance_policy_properties || [])
      .map(jp => jp.property)
      .filter(Boolean),
  }))
}

/**
 * Create a new policy and link it to selected properties.
 * propertyIds: array of property UUIDs (empty for company-wide policy).
 */
export async function createInsurancePolicy(policy, propertyIds = []) {
  const userId = await uid()
  const { data, error } = await supabase
    .from('insurance_policies')
    .insert({ ...policy, user_id: userId })
    .select()
    .single()
  if (error) throw error
  if (propertyIds.length > 0) {
    const links = propertyIds.map(pid => ({ policy_id: data.id, property_id: pid }))
    const { error: linkErr } = await supabase
      .from('insurance_policy_properties')
      .insert(links)
    if (linkErr) throw linkErr
  }
  return data
}

/**
 * Update a policy. Optionally also replaces its property links: if
 * propertyIds is passed, we wipe and re-create all link rows. Pass
 * undefined to leave property links alone.
 */
export async function updateInsurancePolicy(id, updates, propertyIds) {
  const { data, error } = await supabase
    .from('insurance_policies')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  if (Array.isArray(propertyIds)) {
    await supabase.from('insurance_policy_properties').delete().eq('policy_id', id)
    if (propertyIds.length > 0) {
      const links = propertyIds.map(pid => ({ policy_id: id, property_id: pid }))
      const { error: linkErr } = await supabase
        .from('insurance_policy_properties')
        .insert(links)
      if (linkErr) throw linkErr
    }
  }
  return data
}

/**
 * Soft-delete a policy.
 */
export async function deleteInsurancePolicy(id, userId) {
  const { error } = await supabase
    .from('insurance_policies')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId || null,
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Renew an existing policy: creates a NEW policy row pre-filled with the
 * old one's details, dates shifted forward by 1 year by default, and the
 * previous_policy_id pointing back to the old one so we can walk the chain.
 * Property links are copied over.
 */
export async function renewInsurancePolicy(oldPolicyId, overrides = {}) {
  const userId = await uid()
  const { data: old, error: readErr } = await supabase
    .from('insurance_policies')
    .select('*, insurance_policy_properties(property_id)')
    .eq('id', oldPolicyId)
    .single()
  if (readErr) throw readErr

  const oldExpiry = new Date(old.expiry_date)
  const newStart = oldExpiry.toISOString().slice(0, 10)
  const newExpiry = new Date(oldExpiry)
  newExpiry.setFullYear(newExpiry.getFullYear() + 1)
  const newExpiryStr = newExpiry.toISOString().slice(0, 10)

  const newPolicy = {
    company_id:       old.company_id,
    user_id:          userId,
    policy_type:      old.policy_type,
    policy_name:      old.policy_name,
    provider:         old.provider,
    broker:           old.broker,
    policy_number:    old.policy_number,
    start_date:       newStart,
    expiry_date:      newExpiryStr,
    premium:          old.premium,
    payment_freq:     old.payment_freq,
    previous_policy_id: oldPolicyId,
    notes:            old.notes,
    reminder_days:    old.reminder_days,
    ...overrides,
  }

  const propertyIds = (old.insurance_policy_properties || []).map(j => j.property_id)
  return createInsurancePolicy(newPolicy, propertyIds)
}
