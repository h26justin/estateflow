// Assisted import approval queue (Deals brief §9). Values suggested from a
// deal document wait in public.extracted_fields until a person approves or
// rejects them (supabase-migrations/2026-11-19_report_snapshots_extracted_fields.sql).
//
// RLS: insert by deal writers; UPDATE only while the row is pending, and the
// update must set reviewed_by = auth.uid(). There is no delete policy, so a
// suggestion is never removed: a wrong one is rejected. created_by and status
// are left to the column defaults (auth.uid(), 'pending') and never sent.
import { supabase } from '../supabase'
import { uid } from './_shared'
import { logAction } from './audit'

const COLS = 'id, deal_id, document_id, field, value_number, value_text, page, quote, confidence, status, applied_to, reviewed_by, reviewed_at, created_by, created_at'
const INSERT_FIELDS = ['deal_id', 'document_id', 'field', 'value_number', 'value_text', 'page', 'quote', 'confidence']
const REVIEW_STATUSES = ['approved', 'rejected']

const clip = (v, n) => (v == null ? null : String(v).slice(0, n))

function cleanRow(r) {
  if (!r || !r.deal_id) throw new Error('A suggestion needs a deal')
  const field = String(r.field || '').trim()
  if (!field) throw new Error('A suggestion needs a field name')
  const out = {}
  for (const k of INSERT_FIELDS) if (r[k] !== undefined) out[k] = r[k] === '' ? null : r[k]
  out.field = field.slice(0, 80)
  if (out.value_text != null) out.value_text = clip(out.value_text, 500)
  if (out.quote != null) out.quote = clip(out.quote, 1000)
  if (out.value_number != null) {
    const n = Number(out.value_number)
    if (!Number.isFinite(n)) throw new Error('A suggested amount must be a number')
    out.value_number = Math.round(n * 100) / 100
  }
  if (out.page != null) out.page = Number.isInteger(Number(out.page)) ? Number(out.page) : null
  if (out.confidence != null) {
    const c = Number(out.confidence)
    out.confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, Math.round(c * 1000) / 1000)) : null
  }
  return out
}

/** Store suggestions (status pending). Returns the inserted rows. */
export async function addExtractedFields(rows) {
  const list = (rows || []).map(cleanRow)
  if (!list.length) return []
  const { data, error } = await supabase.from('extracted_fields').insert(list).select(COLS)
  if (error) throw error
  return data || []
}

/** Suggestions for a deal, oldest first. Optionally one document's only. */
export async function fetchExtractedFields(dealId, { documentId } = {}) {
  if (!dealId) return []
  let q = supabase.from('extracted_fields').select(COLS).eq('deal_id', dealId)
  if (documentId) q = q.eq('document_id', documentId)
  const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Approve or reject one pending suggestion. Sets reviewed_by (the signed-in
 * user, as the RLS check requires) and reviewed_at. `applied_to` records
 * what approving wrote (a deal_cost_lines id); `value_number` records the
 * value as approved when the reviewer edited it. Only a pending row can be
 * decided: an already-reviewed one is never changed.
 */
export async function reviewExtractedField(id, { status, applied_to = null, value_number } = {}) {
  if (!id) throw new Error('No suggestion to review')
  if (!REVIEW_STATUSES.includes(status)) throw new Error('Status must be approved or rejected')
  const reviewer = await uid()
  const patch = { status, reviewed_by: reviewer, reviewed_at: new Date().toISOString() }
  if (status === 'approved') {
    patch.applied_to = applied_to == null ? null : String(applied_to)
    if (value_number !== undefined && value_number !== null && value_number !== '') {
      const n = Number(value_number)
      if (!Number.isFinite(n)) throw new Error('The approved amount must be a number')
      patch.value_number = Math.round(n * 100) / 100
    }
  }
  const { data, error } = await supabase.from('extracted_fields').update(patch)
    .eq('id', id).eq('status', 'pending').select(COLS).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This suggestion has already been reviewed')
  // Financial records are logged; never block the decision on the log.
  try {
    await logAction(reviewer, null, `extracted_field.${status}`, 'extracted_field', id, data.field,
      { deal_id: data.deal_id, document_id: data.document_id, value_number: data.value_number, applied_to: data.applied_to })
  } catch (_) { /* best effort */ }
  return data
}
