// Portfolio Autopilot — client API.
//
// Backed by the autopilot_actions table (RLS: select for company/property
// members; update+delete for owners/writers on live companies). Rows are
// written exclusively by the portfolio-autopilot cron via the service role;
// the client only lists, approves ("acts on") and dismisses them.

import { supabase } from '../supabase'

// List actions, optionally filtered by status and/or company. Defaults to
// open items across all of the caller's companies, highest severity first.
export async function listAutopilotActions({ status = 'open', companyId = null, limit = 200 } = {}) {
  let q = supabase
    .from('autopilot_actions')
    .select('id, company_id, user_id, property_id, kind, severity, title, draft_body, due_date, status, metadata, created_at, updated_at, property:properties(id, name, address)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (status) q = q.eq('status', status)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  // Severity ordering for the panel: high → medium → low.
  const rank = { high: 0, medium: 1, low: 2 }
  return (data || []).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3))
}

// Count of open actions — used for the dashboard widget badge.
export async function countOpenAutopilotActions(companyId = null) {
  let q = supabase
    .from('autopilot_actions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (companyId) q = q.eq('company_id', companyId)
  const { count, error } = await q
  if (error) throw error
  return count || 0
}

// Mark an action as acted-on (the landlord has approved/handled it). This is
// a status flip only — the actual send/booking happens outside Autopilot, by
// the human. Nothing is auto-executed.
export async function actOnAutopilotAction(id) {
  const { data, error } = await supabase
    .from('autopilot_actions')
    .update({ status: 'acted', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  // RLS silently filters rows the caller can't update (e.g. the company's
  // billing has lapsed) — a 0-row update must not read as success.
  if (!data?.length) throw new Error('Could not update this action — its company may be suspended.')
}

// Dismiss an action (not relevant / handled elsewhere). Soft status flip so
// the cron's partial-unique dedupe doesn't immediately resurface it as open.
export async function dismissAutopilotAction(id) {
  const { data, error } = await supabase
    .from('autopilot_actions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Could not dismiss this action — its company may be suspended.')
}
