// Compliance certificates and their attached documents.
import { supabase } from '../supabase'
import { uid } from './_shared'
import { validateUpload, getDocumentSignedUrl } from './documents'

// ── COMPLIANCE ────────────────────────────────────────────
export async function fetchCompliance(propertyId) {
  const { data, error } = await supabase.from('compliance_items').select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}
export async function createCompliance(propertyId, item) {
  const { data, error } = await supabase.from('compliance_items').insert({ ...item, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}

/**
 * Convert a UK date string (DD/MM/YYYY, DD-MM-YYYY, or already YYYY-MM-DD)
 * to ISO YYYY-MM-DD. Returns null if unparseable.
 */
export function ukDateToISO(s) {
  if (!s || typeof s !== 'string') return null
  const trimmed = s.trim()
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (!m) return null
  let [, dd, mm, yyyy] = m
  if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? '19' : '20') + yyyy
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
}

/**
 * Given a property document with completed OCR extraction, build a
 * compliance_items row. Returns null if the doc isn't a recognisable cert
 * (no doc_type / no expiry_date).
 *
 * Maps DocumentsTab category codes to CANONICAL compliance cert types
 * (see lib/complianceCatalogue.js — 'gas' the doc category becomes
 * 'gas_safety' the cert_type; historical rows written as 'gas' still
 * match via the catalogue's alias map):
 *   gas      -> 'gas_safety' (Gas Safety Certificate)
 *   eicr     -> 'eicr'       (Electrical Installation Condition Report)
 *   epc      -> 'epc'        (Energy Performance Certificate)
 *   insurance-> 'insurance'
 */
export function buildComplianceFromDoc(doc) {
  if (!doc || !doc.extracted_fields) return null
  const f = doc.extracted_fields
  // extract-document stores the type-specific values under `fields` and the
  // headline expiry as `primary_expiry_date`; older / hand-built rows carry
  // them at the top level.
  const ff = (f.fields && typeof f.fields === 'object') ? f.fields : {}
  const first = (...vals) => vals.find(v => v != null && v !== '') ?? null
  const expiry = ukDateToISO(first(ff.expiry_date, ff.cover_end, ff.valid_to, f.primary_expiry_date, f.expiry_date, f.cover_end, f.valid_to))
  if (!expiry) return null

  const certByCategory = {
    gas:       { cert_type: 'gas_safety', cert_name: 'Gas Safety (CP12)' },
    eicr:      { cert_type: 'eicr',       cert_name: 'EICR' },
    epc:       { cert_type: 'epc',        cert_name: 'EPC' },
    insurance: { cert_type: 'insurance',  cert_name: 'Landlord Insurance' },
  }
  // The document's category first; when that is not a certificate type
  // (left as 'other', or recategorising was skipped on a medium-confidence
  // read) fall back to the type the extraction detected.
  const byDocType = { gas_cert: 'gas', eicr: 'eicr', epc: 'epc', insurance: 'insurance' }
  const mapped = certByCategory[doc.category] || certByCategory[byDocType[f.document_type]]
  if (!mapped) return null
  const { cert_type, cert_name } = mapped

  const issue = ukDateToISO(first(ff.inspection_date, ff.valid_from, ff.cover_start, f.inspection_date, f.valid_from, f.cover_start))
  return {
    cert_type,
    cert_name,
    issue_date: issue,
    expiry_date: expiry,
    reminder_days: 30,
    notes: 'Auto-created from uploaded document.',
    document_id: doc.id,
  }
}

// Why extract-document did not add the certificate to Compliance itself
// (extracted_fields.compliance_review_reason), in plain English. Null when
// the extraction was not staged for review.
const COMPLIANCE_REVIEW_REASONS = {
  no_property_match: 'the address on the document did not match one of your properties',
  match_confidence_medium: 'the address on the document only partly matched this property',
  match_confidence_low: 'the address on the document only loosely matched a property',
  match_conflicts_with_document_property: 'the address on the document matches a different property from the one it is filed under',
  expiry_date_invalid: 'the expiry date could not be read as a real date',
  extraction_confidence_medium: 'the document type was not read with high confidence',
  extraction_confidence_low: 'the document type was not read with high confidence',
  extraction_confidence_unknown: 'the document type was not read with high confidence',
  no_statutory_cycle: 'this certificate type has no standard renewal cycle to check the dates against',
  issue_date_missing: 'no issue or inspection date was found to check the expiry against',
  expiry_not_after_issue: 'the expiry date is not after the issue date',
  expiry_beyond_statutory_cycle: 'the expiry date is further out than this certificate normally lasts',
  existing_compliance_differs: 'Compliance already has this certificate with a different expiry date',
  compliance_write_failed: 'saving it to Compliance failed',
}
export function complianceReviewReason(doc) {
  const f = doc?.extracted_fields
  if (!f || !f.compliance_needs_review) return null
  const code = f.compliance_review_reason
  return COMPLIANCE_REVIEW_REASONS[code] || (code ? 'it needs checking before it is added' : null)
}

/**
 * Find an existing compliance item already linked to this document.
 * Returns the row if linked, else null.
 */
export async function fetchComplianceForDocument(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('compliance_items')
    .select('id, cert_type, cert_name, expiry_date')
    .eq('document_id', documentId)
    .limit(1)
  if (error) return null
  return data?.[0] || null
}
export async function updateCompliance(id, updates) {
  // If the expiry date moves, restart the reminder schedule: the daily
  // compliance-reminders job works out which stage was last sent from
  // last_reminder_sent_at and the *current* expiry, so pulling the date
  // earlier would otherwise skip a milestone email.
  let patch = updates
  if ('expiry_date' in updates) {
    const { data: prev } = await supabase.from('compliance_items').select('expiry_date').eq('id', id).maybeSingle()
    if ((prev?.expiry_date || null) !== (updates.expiry_date || null)) patch = { ...updates, last_reminder_sent_at: null }
  }
  const { data, error } = await supabase.from('compliance_items').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Upload a certificate file and register it as a property document in one
// step (Compliance tab row attach). Unlike uploadDocument, returns the full
// inserted row so the caller can link property_documents.id onto the
// compliance item (compliance_items.document_id).
export async function attachComplianceDocument(propertyId, propertyName, file, category = 'other') {
  validateUpload(file)
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/properties/${propertyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  // Live columns are file_type / file_size (there is no size, type or
  // property_name column, so this insert always failed). propertyName is
  // kept in the signature for callers but not stored.
  const { data, error } = await supabase.from('property_documents').insert({
    property_id: propertyId,
    name: file.name, file_path: path,
    file_size: file.size, file_type: file.type || null, category, user_id: userId,
  }).select().single()
  if (error) {
    // Don't leave an orphaned file in the bucket.
    try { await supabase.storage.from('property-documents').remove([path]) } catch (_) { /* best effort */ }
    throw error
  }
  return data
}

// Open-a-certificate helper: resolve a property_documents id to a fresh
// signed URL (private bucket — never cache).
export async function getDocumentSignedUrlById(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('property_documents')
    .select('file_path').eq('id', documentId).single()
  if (error || !data?.file_path) return null
  return getDocumentSignedUrl(data.file_path)
}
// Soft-delete. compliance_items has a deleted_at column; the Trash page
// expects rows to live for 30 days post-deletion so users can recover.
// Previously this did a hard .delete() which bypassed that guarantee.
export async function deleteCompliance(id) {
  const { error } = await supabase
    .from('compliance_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
