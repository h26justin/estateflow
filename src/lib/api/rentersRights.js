// Renters Rights Act compliance copilot — client API.
//
// Reads/writes rra_compliance (one tracker row per company, optionally
// scoped to a property) and derives Awaab's-Law repair timers at read-time
// from maintenance_jobs. Notice drafting is delegated to the rra-notice
// edge function (AI draft only — never auto-served).

import { supabase } from '../supabase'

const uid = async () => (await supabase.auth.getUser()).data.user.id

// Awaab's-Law style expectations (guidance, not statute): emergency hazards
// addressed within 24h, other significant hazards investigated within 14 days.
export const REPAIR_SLA_DAYS = { emergency: 1, standard: 14 }

export const NOTICE_TYPES = [
  { v: 'periodic_conversion',     l: 'Periodic tenancy conversion letter' },
  { v: 'possession_ground_8',     l: 'Possession notice (rent arrears ground)' },
  { v: 'repair_acknowledgement',  l: 'Repair acknowledgement (Awaab\'s Law)' },
  { v: 'general_compliance',      l: 'General compliance update letter' },
]

export const RRA_CHECKLIST = [
  { key: 'prs_registered',       label: 'Registered on the PRS database',                field: 'prs_registered',       ref: 'prs_reference' },
  { key: 'ombudsman_registered', label: 'Joined the landlord ombudsman scheme',          field: 'ombudsman_registered', ref: 'ombudsman_reference' },
  { key: 'periodic_converted',   label: 'Tenancy converted to periodic (no fixed term)', field: 'periodic_converted',   dateField: 'periodic_converted_at' },
]

// Fetch the RRA tracker rows the user can see. RLS scopes to accessible
// companies/properties. Returns rows (company-level rows have property_id null).
export async function fetchRraCompliance(companyId) {
  let q = supabase.from('rra_compliance')
    // properties has no postcode column — selecting it fails the whole query
    // and blanked the Renters Rights page.
    .select('*, property:properties(id,name,address)')
    .order('updated_at', { ascending: false })
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Get-or-create a tracker row for a (company, property?) scope so the
// checklist always has something to bind to.
export async function ensureRraRow(companyId, propertyId = null) {
  if (!companyId) throw new Error('companyId required')
  let q = supabase.from('rra_compliance').select('*').eq('company_id', companyId)
  q = propertyId ? q.eq('property_id', propertyId) : q.is('property_id', null)
  const { data: existing, error: selErr } = await q.maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing

  const { data, error } = await supabase.from('rra_compliance')
    .insert({ company_id: companyId, property_id: propertyId, user_id: await uid() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateRraCompliance(id, updates) {
  const allowed = [
    'prs_registered', 'prs_reference', 'ombudsman_registered',
    'ombudsman_reference', 'periodic_converted', 'periodic_converted_at', 'notes',
  ]
  const patch = {}
  for (const k of allowed) if (k in updates) patch[k] = updates[k]
  const { data, error } = await supabase.from('rra_compliance')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Awaab's-Law repair timers, derived from maintenance_jobs. Open jobs
// (status not 'complete') are aged against the relevant SLA; 'urgent'/'high'
// priority maps to the emergency 24h window. Returns enriched job rows.
export async function fetchRepairTimers(propertyId) {
  if (!propertyId) return []
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('id, title, description, status, priority, category, reported_by_tenant, created_at')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error

  const now = Date.now()
  return (data || []).map((j) => {
    const isEmergency = j.priority === 'urgent' || j.priority === 'high'
    const slaDays = isEmergency ? REPAIR_SLA_DAYS.emergency : REPAIR_SLA_DAYS.standard
    const open = j.status !== 'complete'
    const reported = j.created_at ? new Date(j.created_at).getTime() : now
    const elapsedDays = Math.floor((now - reported) / 86400000)
    const deadline = reported + slaDays * 86400000
    const daysToDeadline = Math.ceil((deadline - now) / 86400000)
    return {
      ...j,
      sla_days: slaDays,
      severity: isEmergency ? 'emergency' : 'standard',
      open,
      elapsed_days: elapsedDays,
      deadline_iso: new Date(deadline).toISOString(),
      days_to_deadline: daysToDeadline,
      breached: open && now > deadline,
    }
  })
}

// AI-draft a notice/letter via the edge function. Returns { draft, disclaimer, ... }.
export async function draftRraNotice({ propertyId, noticeType, ground, facts, tenantName, propertyLabel }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${supabaseUrl}/functions/v1/rra-notice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      apikey: supabaseKey,
    },
    body: JSON.stringify({
      property_id: propertyId,
      notice_type: noticeType,
      ground,
      facts,
      tenant_name: tenantName,
      property_label: propertyLabel,
    }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'Could not draft notice')
  return out
}
