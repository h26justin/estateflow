// All Deals filters, sort and saved views. Pure; the Deals page owns state
// and storage (user_profiles.deal_saved_views, one array per user).
//
// A view is { id, name, filters } where filters holds:
//   company   'all' | '' (unassigned) | company id
//   status    'all' | deal status key
//   attention 'all' | 'needs' (anything but on track) | attention key
//   owner     'all' | '' (no owner) | owner text (case-insensitive)
//   due       'all' | 'overdue' | 'week' (overdue or due in 7 days) | 'none'
//   sort      'default' | 'due' | 'price_desc' | 'updated'
import { ATTENTION_CFG } from './dealStages'

export const DEFAULT_FILTERS = Object.freeze({ company: 'all', status: 'all', attention: 'all', owner: 'all', due: 'all', sort: 'default' })
export const MAX_SAVED_VIEWS = 20
const MAX_NAME = 60

export const DUE_OPTIONS = Object.freeze([
  { key: 'all', label: 'Any due date' },
  { key: 'overdue', label: 'Action overdue' },
  { key: 'week', label: 'Due within 7 days' },
  { key: 'none', label: 'No due date' },
])
export const SORT_OPTIONS = Object.freeze([
  { key: 'default', label: 'Newest first' },
  { key: 'due', label: 'Action due date' },
  { key: 'price_desc', label: 'Purchase price, highest' },
  { key: 'updated', label: 'Recently updated' },
])

const addDaysIso = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const ownerKey = v => String(v || '').trim().toLowerCase()

/** Distinct action owners on these deals, for the owner filter (display case kept). */
export function ownerOptions(deals) {
  const seen = new Map()
  for (const d of deals || []) {
    const k = ownerKey(d.next_action_owner)
    if (k && !seen.has(k)) seen.set(k, String(d.next_action_owner).trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Does `deal` pass `filters`? `today` is ISO. */
export function matchesFilters(deal, filters = DEFAULT_FILTERS, today = new Date().toISOString().slice(0, 10)) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  if (f.company !== 'all' && (f.company === '' ? !!deal.company_id : deal.company_id !== f.company)) return false
  if (f.status !== 'all' && deal.status !== f.status) return false
  if (f.attention === 'needs') { if (!deal.attention_status || deal.attention_status === 'on_track') return false }
  else if (f.attention !== 'all' && deal.attention_status !== f.attention) return false
  if (f.owner !== 'all' && ownerKey(deal.next_action_owner) !== ownerKey(f.owner)) return false
  const due = deal.next_action_due ? String(deal.next_action_due).slice(0, 10) : null
  if (f.due === 'none' && due) return false
  if (f.due === 'overdue' && !(due && due < today)) return false
  if (f.due === 'week' && !(due && due <= addDaysIso(today, 7))) return false
  return true
}

/** A sorted copy. 'default' keeps the loaded order (newest first). */
export function sortDeals(deals, sort = 'default') {
  const list = [...(deals || [])]
  if (sort === 'due') return list.sort((a, b) => (a.next_action_due || '9999') < (b.next_action_due || '9999') ? -1 : (a.next_action_due || '9999') > (b.next_action_due || '9999') ? 1 : 0)
  if (sort === 'price_desc') return list.sort((a, b) => (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0))
  if (sort === 'updated') return list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return list
}

/** Keep only known keys and values, so a stored view can never inject anything odd. */
export function cleanFilters(raw) {
  const f = { ...DEFAULT_FILTERS }
  if (!raw || typeof raw !== 'object') return f
  const str = (v, max = 120) => typeof v === 'string' ? v.slice(0, max) : null
  if (str(raw.company) != null) f.company = str(raw.company)
  if (str(raw.status) != null) f.status = str(raw.status, 40)
  if (raw.attention === 'all' || raw.attention === 'needs' || ATTENTION_CFG[raw.attention]) f.attention = raw.attention
  if (str(raw.owner) != null) f.owner = str(raw.owner)
  if (DUE_OPTIONS.some(o => o.key === raw.due)) f.due = raw.due
  if (SORT_OPTIONS.some(o => o.key === raw.sort)) f.sort = raw.sort
  return f
}

/** Stored views, cleaned; anything malformed is dropped. */
export function cleanViews(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string' && v.name.trim())
    .slice(0, MAX_SAVED_VIEWS)
    .map(v => ({ id: v.id.slice(0, 40), name: v.name.trim().slice(0, MAX_NAME), filters: cleanFilters(v.filters) }))
}

/** Add (or replace, by name, case-insensitive) a view. Returns the new list. */
export function upsertView(views, name, filters, makeId = () => Math.random().toString(36).slice(2, 10)) {
  const n = String(name || '').trim().slice(0, MAX_NAME)
  if (!n) throw new Error('Give the view a name')
  const list = cleanViews(views)
  const i = list.findIndex(v => v.name.toLowerCase() === n.toLowerCase())
  const view = { id: i >= 0 ? list[i].id : makeId(), name: n, filters: cleanFilters(filters) }
  if (i >= 0) return list.map((v, j) => j === i ? view : v)
  if (list.length >= MAX_SAVED_VIEWS) throw new Error(`You can save up to ${MAX_SAVED_VIEWS} views; delete one first`)
  return [...list, view]
}

/** True when filters differ from the defaults (something is filtered or sorted). */
export const isFiltered = filters => Object.keys(DEFAULT_FILTERS).some(k => (filters?.[k] ?? DEFAULT_FILTERS[k]) !== DEFAULT_FILTERS[k])
