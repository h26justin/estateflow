// Company ownership + estate-agent management fees.
//
// Two tables (2026-08-09_company_ownership_agents.sql, reshaped by
// 2026-08-09_agent_fees_on_agents.sql):
//   company_shareholders — name-based cap table per company; optional soft
//                          link to an auth user via user_id/email. Rows are
//                          people or companies (shareholder_type, added by
//                          2026-08-30_corporate_shareholders.sql); a corporate
//                          shareholder may link to its own companies row via
//                          shareholder_company_id for holding-chain look-through
//   estate_agents        — directory of letting/managing agents carrying the
//                          agency's standard fee (fee_percent + vat_treatment).
//                          Properties link to their agent via
//                          properties.managed_by_agent_id, so changing an
//                          agency's fee updates every property it manages.
//
// RLS scopes reads to companies the caller can access, so the fetchAll*
// variants need no explicit filter — they return rows for every accessible
// company (used by ReportsPage for the Company P&L).

import { supabase } from '../supabase'

// ── Shareholders ──────────────────────────────────────────────────────────

export async function fetchShareholders(companyId) {
  const { data, error } = await supabase.from('company_shareholders')
    .select('*')
    .eq('company_id', companyId)
    .order('percentage', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllShareholders() {
  const { data, error } = await supabase.from('company_shareholders')
    .select('*')
    .order('percentage', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addShareholder({ companyId, name, email = null, userId = null, percentage, taxBand = null, notes = null, shareholderType = 'individual', shareholderCompanyId = null }) {
  const me = (await supabase.auth.getUser()).data.user
  const corporate = shareholderType === 'company'
  const { data, error } = await supabase.from('company_shareholders')
    .insert({
      company_id: companyId, name, email: email || null, user_id: userId || null,
      percentage, tax_band: corporate ? null : (taxBand || null), notes, created_by: me?.id || null,
      shareholder_type: corporate ? 'company' : 'individual',
      // Only company rows may link to a holding company (DB check enforces it).
      shareholder_company_id: corporate ? (shareholderCompanyId || null) : null,
    })
    .select().single()
  if (error) throw error
  return data
}

export async function updateShareholder(id, patch) {
  const { data, error } = await supabase.from('company_shareholders')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteShareholder(id) {
  const { error } = await supabase.from('company_shareholders').delete().eq('id', id)
  if (error) throw error
}

// ── Estate agents ─────────────────────────────────────────────────────────

export async function fetchEstateAgents() {
  const { data, error } = await supabase.from('estate_agents')
    .select('*')
    .order('name')
  if (error) throw error
  return data || []
}

export async function addEstateAgent({ name, feePercent = null, vatTreatment = 'ex_vat', contactName = null, email = null, phone = null, notes = null }) {
  const me = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase.from('estate_agents')
    .insert({ user_id: me.id, name, fee_percent: feePercent, vat_treatment: vatTreatment, contact_name: contactName, email, phone, notes })
    .select().single()
  if (error) throw error
  return data
}

export async function updateEstateAgent(id, patch) {
  const { data, error } = await supabase.from('estate_agents')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteEstateAgent(id) {
  const { error } = await supabase.from('estate_agents').delete().eq('id', id)
  if (error) throw error
}

// ── Property ↔ managing agent ────────────────────────────────────────────

export async function setPropertyManagingAgent(propertyId, agentId, agentName = null) {
  // Keeps the legacy free-text managed_by in step with the FK so older
  // screens still show the right name.
  const patch = { managed_by_agent_id: agentId || null }
  if (agentName != null) patch.managed_by = agentName || null
  const { data, error } = await supabase.from('properties')
    .update(patch).eq('id', propertyId).select('id, managed_by, managed_by_agent_id').single()
  if (error) throw error
  return data
}
