// Property expenses.
import { supabase } from '../supabase'
import { uid } from './_shared'

// ── EXPENSES ─────────────────────────────────────────────
export async function fetchExpenses(propertyId) {
  const { data, error } = await supabase.from('property_expenses').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('date', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createExpense(propertyId, expense) {
  const { data, error } = await supabase.from('property_expenses').insert({ ...expense, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
// Soft-delete (see deleteCompliance for context).
export async function deleteExpense(id) {
  const { error } = await supabase
    .from('property_expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
