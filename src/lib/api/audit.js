// Audit log.
import { supabase } from '../supabase'

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

export async function fetchAuditLog(userId, companyId, limit = 100) {
  const q = supabase.from('audit_log').select('*')
  if (companyId) q.eq('company_id', companyId)
  else q.eq('user_id', userId)
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return data || []
}
