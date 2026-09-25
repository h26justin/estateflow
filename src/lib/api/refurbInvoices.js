// Refurb invoices API: refurb_invoices + refurb_invoice_allocations, and
// payments logged against an invoice (refurb_lines with invoice_id).
//
// An invoice is a cost, never a payment. Creating one writes the header and
// its allocations (plus 'extra' lines for allocations flagged as variations)
// in one transaction via the create_refurb_invoice RPC, which refuses an
// allocation that does not reconcile. Payments are separate calls.
//
// Export names must stay unique across src/lib/api (index.js uses export *).
import { supabase } from '../supabase'
import { validateUpload } from './_monolith'
import { splitPayment } from '../refurbInvoices'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const INVOICE_SELECT = '*, refurb_invoice_allocations(*)'

export async function fetchRefurbInvoices() {
  const { data, error } = await supabase.from('refurb_invoices').select(INVOICE_SELECT)
    .is('deleted_at', null).order('invoice_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data || []
}

// Store the original PDF as a company document so every member with company
// access can open it (storage policy: companies/<uid>/… on upload, then the
// company_documents row grants read to the company).
export async function uploadRefurbInvoiceFile(companyId, file) {
  validateUpload(file)
  const userId = await uid()
  const safe = String(file.name || 'invoice.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `companies/${userId}/refurb-invoices/${companyId}/${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, { contentType: file.type || 'application/pdf' })
  if (upErr) throw upErr
  const { data, error } = await supabase.from('company_documents').insert({
    company_id: companyId, user_id: userId, name: file.name, file_path: path,
    size: file.size, type: file.type || 'application/pdf', category: 'refurb_invoice',
  }).select().single()
  if (error) throw error
  return data
}

export async function createRefurbInvoice(invoice, allocations) {
  const { data: id, error } = await supabase.rpc('create_refurb_invoice', { p_invoice: invoice, p_allocations: allocations })
  if (error) {
    if (error.code === '23505') throw new Error('This supplier and invoice number are already imported for this company.')
    throw error
  }
  const { data, error: e2 } = await supabase.from('refurb_invoices').select(INVOICE_SELECT).eq('id', id).single()
  if (e2) throw e2
  // Variation extras written by the RPC, so the caller can patch its state.
  const { data: extras, error: e3 } = await supabase.from('refurb_lines').select('*').eq('invoice_id', id).eq('kind', 'extra')
  if (e3) throw e3
  return { invoice: data, extras: extras || [] }
}

export async function updateRefurbInvoice(id, fields) {
  const { data, error } = await supabase.from('refurb_invoices').update(fields).eq('id', id).select(INVOICE_SELECT).single()
  if (error) throw error
  if (!data) throw new Error('Invoice not found or no permission to edit it')
  return data
}

// Soft delete. Its variation extras go with it (they only existed because of
// the invoice). Payments already logged are real money and are kept.
export async function deleteRefurbInvoice(id) {
  const now = new Date().toISOString(), by = await uid()
  const { data, error } = await supabase.from('refurb_invoices').update({ deleted_at: now, deleted_by: by }).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Invoice not found or no permission to delete it')
  const { data: extras, error: e2 } = await supabase.from('refurb_lines').update({ deleted_at: now, deleted_by: by })
    .eq('invoice_id', id).eq('kind', 'extra').is('deleted_at', null).select('id, project_id')
  if (e2) throw e2
  return { removedExtras: extras || [] }
}

// Log money actually paid (or refunded) against an invoice. One payment is
// split across the invoice's allocations pro rata, one line per project,
// each linked by invoice_id. Returns the created lines.
export async function logRefurbInvoicePayment(invoice, { amount, date, payee, description, kind = 'payment' }) {
  const parts = splitPayment(amount, invoice.refurb_invoice_allocations || []).filter(p => p.amount > 0)
  if (!parts.length) throw new Error('This invoice has no allocations to pay against')
  const by = await uid()
  const rows = parts.map(p => ({
    project_id: p.project_id, kind, amount: p.amount, date, payee: payee || invoice.supplier_name,
    description: description || `${kind === 'credit' ? 'Refund on' : 'Payment on'} invoice ${invoice.invoice_number || '(no number)'}`,
    invoice_id: invoice.id, created_by: by,
  }))
  const { data, error } = await supabase.from('refurb_lines').insert(rows).select()
  if (error) throw error
  return data || []
}
