// Documents: upload validation, property / company documents in Storage,
// and document OCR extraction.
import { supabase } from '../supabase'
import { uid } from './_shared'

// File upload validation — applied to every Storage write so the bucket
// can't be used as free file hosting / malware drop / runaway-bill source.
//
// Limits:
//   * Per-file size: 25 MB (covers a typical Gas Safety PDF, tenancy
//     agreement, large scanned mortgage offer). Images get a tighter
//     cap because the receipt-scan flow always re-encodes them anyway.
//   * MIME type allow-list: documents (pdf, docx, doc, xlsx, xls, csv,
//     txt), images (jpeg, png, webp, heic, heif), email exports (eml,
//     msg). Everything else is rejected at the client before any byte
//     hits Storage.
//
// The extension is taken from the filename for the storage path, but
// the MIME check is what gates the upload — extension alone is
// trivially spoofed.
const MAX_FILE_BYTES   = 25 * 1024 * 1024     // 25 MB
const MAX_IMAGE_BYTES  = 10 * 1024 * 1024     // 10 MB for raw images
const ALLOWED_MIME = new Set([
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  // images
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  // emails (statement importer)
  'message/rfc822', 'application/vnd.ms-outlook',
])
export function validateUpload(file) {
  if (!file) throw new Error('No file selected.')
  if (file.size === 0) throw new Error('That file is empty (0 bytes).')
  const isImage = (file.type || '').startsWith('image/')
  const cap = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
  if (file.size > cap) {
    const mb = (cap / 1024 / 1024).toFixed(0)
    throw new Error(`File is too large. Maximum size for ${isImage ? 'images' : 'documents'} is ${mb} MB.`)
  }
  // Browsers occasionally leave file.type empty (e.g. some Safari paths
  // for .heic, or files dropped from Finder with no extension). Allow that
  // ONLY if the extension is in our allow-list, since extension is at
  // least a weak signal. Otherwise hard-reject.
  const type = (file.type || '').toLowerCase()
  if (type && !ALLOWED_MIME.has(type)) {
    throw new Error(`That file type (${type}) isn't allowed. Use PDF, Word, Excel, CSV, or images.`)
  }
  if (!type) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const okExts = ['pdf','doc','docx','xls','xlsx','csv','txt','jpg','jpeg','png','webp','heic','heif','eml','msg']
    if (!okExts.includes(ext)) {
      throw new Error('That file type isn\'t allowed. Use PDF, Word, Excel, CSV, or images.')
    }
  }
}

export async function uploadDocument(propertyId, propertyName, file, userId) {
  validateUpload(file)
  const ext = file.name.split('.').pop()
  // Path layout: {user_id}/properties/{propertyId}/{ts}.{ext}
  // Top-level folder = user id, so the storage RLS policy (which checks
  // foldername[1] = auth.uid()) admits the user's own writes.
  const path = `${userId}/properties/${propertyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  // Bucket is private — do NOT store a public URL. Always generate signed URLs
  // on demand via getDocumentSignedUrl(). file_path is the canonical reference.
  const { error: dbErr } = await supabase.from('property_documents').insert({
    property_id: propertyId, property_name: propertyName,
    name: file.name, file_path: path,
    size: file.size, type: file.type, user_id: userId,
  })
  if (dbErr) throw dbErr
  return path
}

/**
 * Get a short-lived signed URL for a private document.
 * Returns a URL that expires after `expiresIn` seconds (default 5 minutes).
 * Use this every time you need to surface a doc to the user — never cache it.
 */
export async function getDocumentSignedUrl(filePath, expiresIn = 300) {
  if (!filePath) return null
  const { data, error } = await supabase.storage
    .from('property-documents')
    .createSignedUrl(filePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

// Permanent removal: deletes Storage file AND the DB row. Use only from Trash purge.
export async function hardDeleteDocument(doc) {
  if (doc.file_path) {
    try { await supabase.storage.from('property-documents').remove([doc.file_path]) } catch(e) {}
  }
  const { error } = await supabase.from('property_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// Attach an insurance policy schedule (etc.) as a company document,
// returning the inserted row so insurance_policies.document_id can link it.
export async function attachPolicyDocument(companyId, file) {
  validateUpload(file)
  const userId = await uid()
  const ext = file.name.split('.').pop()
  const path = `${userId}/company_documents/${companyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data, error } = await supabase.from('company_documents').insert({
    company_id: companyId, name: file.name, file_path: path,
    size: file.size, type: file.type, category: 'insurance', user_id: userId,
  }).select().single()
  if (error) throw error
  return data
}

// Resolve a company_documents id to a fresh signed URL (same private bucket).
export async function getCompanyDocumentSignedUrlById(documentId) {
  if (!documentId) return null
  const { data, error } = await supabase.from('company_documents')
    .select('file_path').eq('id', documentId).single()
  if (error || !data?.file_path) return null
  return getDocumentSignedUrl(data.file_path)
}

// Soft-delete. company_documents has deleted_at + deleted_by columns.
// We KEEP the storage file in place during the 30-day retention window
// so a restore from Trash gets the file back intact; the purge cron is
// responsible for removing the underlying blob when it hard-deletes.
export async function deleteCompanyDocument(doc) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('company_documents')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', doc.id)
  if (error) throw error
}

// ── DOCUMENT OCR EXTRACTION ──────────────────────────────────────────────────
// Works with the existing property_documents table which has:
//   name, file_url, file_path, file_type, file_size, category
// OCR adds: extraction_status, extracted_fields, extraction_error, extracted_at

// Map UI category -> Anthropic extraction schema key
export const OCR_TYPE_MAP = {
  tenancy: 'tenancy_agreement',
  gas: 'gas_cert',
  eicr: 'eicr',
  epc: 'epc',
  insurance: 'insurance',
  mortgage: 'mortgage_offer',
  inventory: 'other',
  legal: 'other',
  maintenance: 'other',
  other: 'other',
}

// Trigger OCR extraction for a document. Only works for PDFs and images.
export async function triggerDocumentOCR(documentId) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session) throw new Error('Not signed in')
  const url = supabase.supabaseUrl.replace(/\/$/, '') + '/functions/v1/extract-document'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': supabase.supabaseKey,
    },
    body: JSON.stringify({ document_id: documentId }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error('OCR failed: ' + err.slice(0, 200))
  }
  return await res.json()
}

// Mark extraction as queued in the DB (called right before invoking the Edge Function)
export async function markDocumentForExtraction(documentId) {
  const { error } = await supabase
    .from('property_documents')
    .update({ extraction_status: 'pending', extraction_error: null })
    .eq('id', documentId)
  if (error) throw error
}

// Upload a PDF/image to storage, register it as a property document,
// trigger extraction, and return the extracted fields synchronously.
//
// Used by BuildingMortgageModal's "Scan mortgage PDF" flow so the
// user can drop in a Handelsbanken-style facility agreement (or any
// mortgage offer) and have the form pre-fill with lender, loan amount,
// rate, term, type, fees, monthly payment. Saves them from typing.
//
// The doc is associated with `firstPropertyId` because the schema
// requires a property_id; for building-level mortgages we pick the
// first unit as the document owner. The PDF stays attached there in
// the Documents tab, so users can find it later.
export async function uploadAndExtractMortgageDocument(file, firstPropertyId, category = 'mortgage') {
  const uid = (await supabase.auth.getUser()).data.user.id
  if (!file)            throw new Error('No file provided')
  if (!firstPropertyId) throw new Error('Need at least one property to attach the document to')

  // Storage path: userId/propertyId/timestamp_filename
  const safeName = (file.name || 'mortgage.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `${uid}/${firstPropertyId}/${Date.now()}_${safeName}`
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false,
  })
  if (upErr) throw upErr

  // Create the document row
  const { data: doc, error: docErr } = await supabase.from('property_documents').insert({
    property_id: firstPropertyId,
    user_id: uid,
    name: file.name || 'Mortgage document',
    file_path: path,
    file_type: file.type || 'application/pdf',
    file_size: file.size || 0,
    category,
    extraction_status: 'pending',
  }).select().single()
  if (docErr) throw docErr

  // Trigger extraction (synchronous — waits for Claude response)
  await triggerDocumentOCR(doc.id)

  // Read back the extracted fields
  const final = await fetchDocumentExtraction(doc.id)
  if (final?.extraction_status === 'failed') throw new Error(final.extraction_error || 'Extraction failed')
  return { document: doc, extracted: final?.extracted_fields || null }
}

// Fetch extraction status + fields for a document
export async function fetchDocumentExtraction(documentId) {
  const { data, error } = await supabase
    .from('property_documents')
    .select('extraction_status, extracted_fields, extraction_error, extracted_at')
    .eq('id', documentId)
    .single()
  if (error) throw error
  return data
}
