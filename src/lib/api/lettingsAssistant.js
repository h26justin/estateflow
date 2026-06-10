// AI Lettings Assistant — client API.
//
// CRUD for inbound applicant enquiries plus the AI triage call (draft
// reply + pre-screen + lead score). The triage runs server-side in the
// `lettings-assistant` edge function; everything it returns is a DRAFT
// the landlord reviews before acting.

import { supabase } from '../supabase'

export async function fetchEnquiries(propertyId) {
  let q = supabase.from('letting_enquiries')
    .select('id, property_id, company_id, user_id, applicant_name, applicant_email, message, ai_reply_draft, ai_score, ai_screening, status, created_at')
    .order('created_at', { ascending: false })
  if (propertyId) q = q.eq('property_id', propertyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createEnquiry({ property_id, company_id = null, applicant_name = '', applicant_email = '', message = '' }) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('letting_enquiries')
    .insert({
      property_id,
      company_id,
      user_id: userId,
      applicant_name,
      applicant_email,
      message,
      status: 'new',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEnquiry(id, fields) {
  const { data, error } = await supabase
    .from('letting_enquiries')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteEnquiry(id) {
  const { error } = await supabase.from('letting_enquiries').delete().eq('id', id)
  if (error) throw error
}

// Run AI triage: draft reply + screening + score. `criteria` is optional
// landlord pre-screen context (max_budget, pets_allowed, min_tenancy_months, notes).
// Returns the AI envelope and also persists drafts onto the row server-side.
export async function triageEnquiry(enquiryId, criteria = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lettings-assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ enquiry_id: enquiryId, criteria }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'AI triage failed')
  return data
}
