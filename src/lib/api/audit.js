// Audit log.
import { supabase } from '../supabase'
import { fetchAccessibleCompanyIds } from './access'

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
export async function logAction(userId, companyId, action, entityType, entityId, entityName, metadata = {}) {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId, company_id: companyId, action,
      entity_type: entityType, entity_id: entityId,
      entity_name: entityName, metadata,
    })
  } catch(e) {} // Never block the main action if logging fails
}

// With no company selected: your own actions PLUS every action in the
// companies you own or administer (it used to show only your own actions,
// so an owner never saw what their team did). Throws on error.
export async function fetchAuditLog(userId, companyId, limit = 100) {
  let q = supabase.from('audit_log').select('*')
  if (companyId) q = q.eq('company_id', companyId)
  else {
    const adminIds = await fetchAccessibleCompanyIds(userId, { adminOnly: true })
    q = adminIds.length
      ? q.or(`user_id.eq.${userId},company_id.in.(${adminIds.join(',')})`)
      : q.eq('user_id', userId)
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}
