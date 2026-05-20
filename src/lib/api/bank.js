// Open Banking — pre-partnership stage.
//
// bank_connections rows store user expressions of interest. Real OAuth
// handoff to TrueLayer / Plaid / GoCardless Bank Account Data comes when
// we sign a partner contract. Schema and policies already in place via
// 2026-05-19_bank_connections.sql.

import { supabase } from '../supabase'

export async function fetchBankConnections() {
  const { data, error } = await supabase
    .from('bank_connections')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function registerBankInterest(provider = 'pending-partner', institutionName = '') {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('bank_connections')
    .insert({
      user_id: userId,
      provider,
      institution_name: institutionName || null,
      status: 'requested',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBankConnection(id) {
  const { error } = await supabase.from('bank_connections').delete().eq('id', id)
  if (error) throw error
}
