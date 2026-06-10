// E-signing (SCAFFOLD, flag: esign).
//
// Send a generated document (e.g. a tenancy agreement) for e-signature.
// Provider-agnostic: the envelope lifecycle is fully built, but the actual
// send is INERT until ESIGN_PROVIDER_API_KEY is configured on the
// esign-envelope edge function. sendEsignEnvelope surfaces that inert state
// to the UI rather than throwing a generic error.

import { supabase } from '../supabase'

async function callEsign(payload) {
  const s = (await supabase.auth.getSession()).data.session
  if (!s) throw new Error('Not signed in')
  const res = await fetch(supabase.supabaseUrl + '/functions/v1/esign-envelope', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + s.access_token,
      apikey: supabase.supabaseKey,
    },
    body: JSON.stringify(payload),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  return { res, data }
}

export async function fetchEsignEnvelopes({ propertyId, companyId } = {}) {
  let q = supabase.from('esign_envelopes')
    .select('*')
    .order('created_at', { ascending: false })
  if (propertyId) q = q.eq('property_id', propertyId)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createEsignEnvelope({ propertyId, companyId, documentId, signerName, signerEmail }) {
  const { res, data } = await callEsign({
    action: 'create',
    property_id: propertyId || null,
    company_id: companyId || null,
    document_id: documentId || null,
    signer_name: signerName,
    signer_email: signerEmail,
  })
  if (!res.ok) throw new Error(data.error || 'Could not create envelope')
  return data.envelope
}

// Returns { envelope } on success, or { inert: true, message } when the
// provider key is not configured (HTTP 422 inert path) so the UI can show
// an "awaiting provider setup" state instead of a hard error.
export async function sendEsignEnvelope(envelopeId) {
  const { res, data } = await callEsign({ action: 'send', envelope_id: envelopeId })
  if (res.status === 422 && data.inert) {
    return { inert: true, message: data.detail || data.error }
  }
  if (!res.ok) throw new Error(data.detail || data.error || 'Send failed')
  return { envelope: data.envelope }
}

export async function voidEsignEnvelope(envelopeId) {
  const { res, data } = await callEsign({ action: 'void', envelope_id: envelopeId })
  if (!res.ok) throw new Error(data.error || 'Could not void envelope')
  return data.envelope
}

export async function deleteEsignEnvelope(id) {
  const { error } = await supabase.from('esign_envelopes').delete().eq('id', id)
  if (error) throw error
}
