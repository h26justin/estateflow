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
 * propertyIds is passed, the links become exactly that set. Pass
 * undefined to leave property links alone.
 *
 * The links are diffed — missing ones inserted FIRST, then removed ones
 * deleted, every error checked — so a failure can no longer leave a policy
 * with no properties (it used to delete all links, ignore that error, then
 * re-insert).
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
    const { data: current, error: curErr } = await supabase
      .from('insurance_policy_properties').select('property_id').eq('policy_id', id)
    if (curErr) throw curErr
    const have = new Set((current || []).map(l => l.property_id))
    const want = new Set(propertyIds)
    const toAdd = [...want].filter(pid => !have.has(pid))
    const toRemove = [...have].filter(pid => !want.has(pid))
    if (toAdd.length > 0) {
      const { error: linkErr } = await supabase
        .from('insurance_policy_properties')
        .insert(toAdd.map(pid => ({ policy_id: id, property_id: pid })))
      if (linkErr) throw linkErr
    }
    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from('insurance_policy_properties')
        .delete().eq('policy_id', id).in('property_id', toRemove)
      if (delErr) throw delErr
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

// 'YYYY-MM-DD' + n years, as a string. 29 Feb lands on 28 Feb in a
// non-leap year. Exported for tests.
export function addYearsIso(iso, years) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const ny = y + years
  const leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0
  const day = (m === 2 && d === 29 && !leap) ? 28 : d
  return `${String(ny).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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

  // Date arithmetic on the ISO string: setFullYear on a UTC-parsed date ran
  // in local time and came out a day early across the October clock change
  // (2026-10-28 → 2027-10-27).
  const newStart = String(old.expiry_date).slice(0, 10)
  const newExpiryStr = addYearsIso(newStart, 1)

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
