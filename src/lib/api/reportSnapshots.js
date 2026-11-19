// Frozen month-end report snapshots (rent brief C7). The figures as issued,
// kept unchanged: report_snapshots allows insert and select only
// (supabase-migrations/2026-11-19_report_snapshots_extracted_fields.sql). A
// correction is a new row whose `supersedes` names the snapshot it restates,
// with a note saying why; there is deliberately no update or delete here.
import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'

const SNAPSHOT_COLS = 'id, company_id, agent_id, kind, as_of, period, formula_version, summary, lines, supersedes, note, created_by, created_at'
export const REPORT_SNAPSHOT_FIELDS = ['company_id', 'agent_id', 'kind', 'as_of', 'period', 'formula_version', 'summary', 'lines', 'supersedes', 'note']
const KINDS = ['agent_rent_report', 'month_end_rent', 'deals']

/**
 * Snapshots the user can see, newest first. Each filter is optional:
 * undefined leaves it out; companyId null means snapshots with no company.
 */
export async function fetchReportSnapshots({ kind, agentId, companyId } = {}) {
  return fetchAllPages(() => {
    let q = supabase.from('report_snapshots').select(SNAPSHOT_COLS)
    if (kind) q = q.eq('kind', kind)
    if (agentId) q = q.eq('agent_id', agentId)
    if (companyId === null) q = q.is('company_id', null)
    else if (companyId) q = q.eq('company_id', companyId)
    return q.order('created_at', { ascending: false }).order('id', { ascending: false })
  })
}

/**
 * Insert one snapshot. `created_by` is left to the database default
 * (auth.uid()), which is exactly what the insert policy checks
 * (created_by = auth.uid()), so it is never sent from here.
 */
export async function addReportSnapshot(fields = {}) {
  if (!KINDS.includes(fields.kind)) throw new Error('Unknown snapshot kind')
  if (!fields.as_of) throw new Error('A snapshot needs an as-of date')
  if (!fields.formula_version) throw new Error('A snapshot needs a formula version')
  if (!fields.summary || typeof fields.summary !== 'object') throw new Error('A snapshot needs a summary')
  if (fields.period != null && fields.period !== '' && !/^\d{4}-\d{2}$/.test(fields.period)) throw new Error('Period must be YYYY-MM')
  const row = {}
  for (const k of REPORT_SNAPSHOT_FIELDS) {
    if (!(k in fields)) continue
    let v = fields[k]
    if (typeof v === 'string') v = v.trim()
    row[k] = v === '' || v === undefined ? null : v
  }
  if (row.supersedes && !row.note) throw new Error('A restatement needs a note saying why')
  if (row.note && row.note.length > 1000) throw new Error('The note is too long (1,000 characters at most)')
  const { data, error } = await supabase.from('report_snapshots').insert(row).select(SNAPSHOT_COLS).single()
  if (error) throw error
  return data
}
