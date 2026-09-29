// External loans API: external_loans + external_loan_payments (the ticks).
//
// The schedule is worked out client-side from the loan's terms
// (lib/externalLoans.js); a tick only records that one period was paid.
// Deletes are soft on both tables. A write that touches zero rows throws, so
// a missing RLS grant can never look like success.
//
// Export names must stay unique across src/lib/api (index.js uses export *).
import { supabase } from '../supabase'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const LOAN_SELECT = '*, external_loan_payments(*)'
const LOAN_FIELDS = ['company_id', 'property_id', 'lender_name', 'lender_type', 'reference', 'principal', 'received_date',
  'term_months', 'annual_rate', 'repayment_type', 'first_payment_date', 'purpose', 'notes']

const clean = fields => Object.fromEntries(LOAN_FIELDS.filter(k => k in fields).map(k => [k, fields[k] === '' ? null : fields[k]]))

export async function fetchExternalLoans() {
  const { data, error } = await supabase.from('external_loans').select(LOAN_SELECT)
    .is('deleted_at', null).order('received_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createExternalLoan(fields) {
  const { data, error } = await supabase.from('external_loans')
    .insert({ ...clean(fields), user_id: await uid() }).select(LOAN_SELECT).single()
  if (error) throw error
  return data
}

export async function updateExternalLoan(id, fields) {
  const { data, error } = await supabase.from('external_loans').update(clean(fields)).eq('id', id).select(LOAN_SELECT).single()
  if (error) throw error
  if (!data) throw new Error('Loan not found or no permission to edit it')
  return data
}

export async function deleteExternalLoan(id) {
  const { data, error } = await supabase.from('external_loans')
    .update({ deleted_at: new Date().toISOString(), deleted_by: await uid() }).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Loan not found or no permission to delete it')
  return true
}

// Record that one scheduled period has been paid.
export async function tickExternalLoanPayment(loanId, { period, due_date, amount, paid_date, notes }) {
  const { data, error } = await supabase.from('external_loan_payments').insert({
    loan_id: loanId, user_id: await uid(), period, due_date: due_date || null,
    amount, paid_date: paid_date || undefined, notes: notes || null,
  }).select().single()
  if (error) {
    if (error.code === '23505') throw new Error('That month is already ticked off.')
    throw error
  }
  return data
}

export async function untickExternalLoanPayment(paymentId) {
  const { data, error } = await supabase.from('external_loan_payments')
    .update({ deleted_at: new Date().toISOString(), deleted_by: await uid() }).eq('id', paymentId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Payment not found or no permission to change it')
  return true
}

// Correct the amount or date on a tick (paid late, or a different amount).
export async function updateExternalLoanPayment(paymentId, { amount, paid_date, notes }) {
  const fields = {}
  if (amount !== undefined) fields.amount = amount
  if (paid_date !== undefined) fields.paid_date = paid_date
  if (notes !== undefined) fields.notes = notes || null
  const { data, error } = await supabase.from('external_loan_payments').update(fields).eq('id', paymentId).select().single()
  if (error) throw error
  if (!data) throw new Error('Payment not found or no permission to change it')
  return data
}
