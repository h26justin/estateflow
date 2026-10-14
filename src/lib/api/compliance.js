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
  const expiry = ukDateToISO(f.expiry_date || f.cover_end || f.valid_to)
  if (!expiry) return null

  const certByCategory = {
    gas:       { cert_type: 'gas_safety', cert_name: 'Gas Safety (CP12)' },
    eicr:      { cert_type: 'eicr',       cert_name: 'EICR' },
    epc:       { cert_type: 'epc',        cert_name: 'EPC' },
    insurance: { cert_type: 'insurance',  cert_name: 'Landlord Insurance' },
  }
  const mapped = certByCategory[doc.category]
  if (!mapped) return null
  const { cert_type, cert_name } = mapped

  const issue = ukDateToISO(f.inspection_date || f.valid_from || f.cover_start)
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
  const { data, error } = await supabase.from('compliance_items').update(updates).eq('id', id).select().single()
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
  const { data, error } = await supabase.from('property_documents').insert({
    property_id: propertyId, property_name: propertyName,
    name: file.name, file_path: path,
    size: file.size, type: file.type, category, user_id: userId,
  }).select().single()
  if (error) throw error
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
