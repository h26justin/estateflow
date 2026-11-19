// Versioned arrears notes (rent brief C6). A note is never edited in place:
// every change inserts a new row whose `supersedes` names the version it
// replaces, so the history behind an explanation is never lost. The table
// allows insert and select only (supabase-migrations/2026-11-19_arrears_notes.sql);
// there is deliberately no update or delete here.
import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'

const ID_CHUNK = 100   // keeps .in() lists well under URL length limits
const NOTE_COLS = 'id, property_id, tenancy_id, period, reason, response, payment_plan, next_action, follow_up_date, owner, status, supersedes, author, created_at'
export const ARREARS_NOTE_FIELDS = ['property_id', 'tenancy_id', 'period', 'reason', 'response', 'payment_plan', 'next_action', 'follow_up_date', 'owner', 'status', 'supersedes']

// Every note version for these properties, newest first.
export async function fetchArrearsNotes(propertyIds) {
  const ids = [...new Set((propertyIds || []).filter(Boolean))]
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK)
    out.push(...await fetchAllPages(() => supabase.from('arrears_notes').select(NOTE_COLS)
      .in('property_id', part).order('created_at', { ascending: false }).order('id', { ascending: false })))
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

// Insert one note version. `author` is left to the database default
// (auth.uid()), which the insert policy checks.
export async function addArrearsNote(fields) {
  if (!fields?.property_id) throw new Error('A note needs a property')
  const row = {}
  for (const k of ARREARS_NOTE_FIELDS) {
    if (!(k in fields)) continue
    let v = fields[k]
    if (typeof v === 'string') v = v.trim()
    row[k] = v === '' || v === undefined ? null : v
  }
  if (!row.status) delete row.status   // column default: 'open'
  const { data, error } = await supabase.from('arrears_notes').insert(row).select(NOTE_COLS).single()
  if (error) throw error
  return data
}
