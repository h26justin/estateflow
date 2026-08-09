// Company ownership + estate-agent management fees.
//
// Three small tables (2026-08-09_company_ownership_agents.sql):
//   company_shareholders — name-based cap table per company; optional soft
//                          link to an auth user via user_id/email
//   estate_agents        — per-account directory of letting/managing agents
//   company_agent_fees   — % of rent collected each company pays each agent
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

export async function addShareholder({ companyId, name, email = null, userId = null, percentage, taxBand = null, notes = null }) {
  const me = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase.from('company_shareholders')
    .insert({
      company_id: companyId, name, email: email || null, user_id: userId || null,
      percentage, tax_band: taxBand || null, notes, created_by: me?.id || null,
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

export async function addEstateAgent({ name, contactName = null, email = null, phone = null, notes = null }) {
  const me = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase.from('estate_agents')
    .insert({ user_id: me.id, name, contact_name: contactName, email, phone, notes })
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

// ── Company ↔ agent fees ─────────────────────────────────────────────────

export async function fetchAgentFees(companyId) {
  const { data, error } = await supabase.from('company_agent_fees')
    .select('*, agent:estate_agents(id,name,email,phone)')
    .eq('company_id', companyId)
    .order('created_at')
  if (error) throw error
  return data || []
}

export async function fetchAllAgentFees() {
  const { data, error } = await supabase.from('company_agent_fees')
    .select('*, agent:estate_agents(id,name,email,phone)')
    .order('created_at')
  if (error) throw error
  return data || []
}

export async function upsertAgentFee({ companyId, agentId, feePercent, vatTreatment = 'inc_vat', notes = null }) {
  const me = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase.from('company_agent_fees')
    .upsert(
      { company_id: companyId, agent_id: agentId, fee_percent: feePercent, vat_treatment: vatTreatment, notes, created_by: me?.id || null },
      { onConflict: 'company_id,agent_id' }
    )
    .select('*, agent:estate_agents(id,name,email,phone)').single()
  if (error) throw error
  return data
}

export async function deleteAgentFee(id) {
  const { error } = await supabase.from('company_agent_fees').delete().eq('id', id)
  if (error) throw error
}
