// Assisted import: the rules between a reviewed suggestion (extracted_fields)
// and the source-linked value it writes (a deal_cost_lines row). Pure, so the
// review panel (components/DealDocumentExtract.jsx) stays thin and testable.
//
//   - Approving a cost figure writes a cost line with source
//     "<document name> p.<page>" and the quoted line as its notes.
//   - Check figures (total, balance due, mortgage advance) and the asking
//     price are never written as cost lines: approving them records only
//     that a person agreed with the reading.
//   - A suggestion whose category already has a cost line is a conflict: the
//     person chooses to replace that line or add alongside it. Bulk approval
//     never resolves a conflict for them.
import { CHECK_FIELDS, FIELD_LABEL } from './completionStatementParser'
import { COST_CATEGORIES, COST_CATEGORY_LABEL } from './dealFinance'

export const CHECK_FIGURE = 'check_figure'
// Bulk approval only takes suggestions at least this sure.
export const BULK_MIN_CONFIDENCE = 0.6
// States offered when approving. Paid / actual are set on the Costs tab by a
// person, never from a document reading.
export const REVIEW_STATES = Object.freeze(['estimate', 'quoted', 'confirmed'])
export const DEFAULT_STATE = 'quoted'

const VALID_CATEGORIES = new Set(COST_CATEGORIES.map(c => c.key))

/** The cost category a stored field maps to, or null for a check figure. */
export function categoryForField(field) {
  if (CHECK_FIELDS.includes(field)) return null
  if (field === 'agreed_price') return 'purchase_price'
  return VALID_CATEGORIES.has(field) ? field : null
}

export const isCheckField = field => CHECK_FIELDS.includes(field)
export const fieldLabel = field => FIELD_LABEL[field] || COST_CATEGORY_LABEL[field] || field

/** Parse an edited amount: a finite, non-negative number or null. */
export function parseAmount(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/[£,\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** "<document name> p.<page>", within the 300-character column. */
export function sourceFor(docName, page) {
  const p = page ? ` p.${page}` : ''
  const name = String(docName || 'Document').slice(0, 300 - p.length)
  return name + p
}

/** The cost line an approval writes. */
export function costLineFromSuggestion(row, { docName, category, amount, state = DEFAULT_STATE, vatIncluded = true }) {
  return {
    category,
    label: fieldLabel(row.field).slice(0, 200),
    amount,
    state: REVIEW_STATES.includes(state) ? state : DEFAULT_STATE,
    vat_included: !!vatIncluded,
    source: sourceFor(docName, row.page),
    notes: row.quote ? String(row.quote).slice(0, 1000) : null,
  }
}

/** Existing cost lines an approval into `category` would sit beside. */
export function conflictingLines(costLines, category) {
  if (!category) return []
  return (costLines || []).filter(l => l.category === category)
}

/**
 * Suggestions not already stored for this document (any status): the same
 * field, amount, page and quote. Re-running extraction never duplicates a
 * pending row or brings back a rejected one.
 */
export function newSuggestionsOnly(existing, suggestions) {
  const key = r => [r.field, Number(r.value_number ?? NaN).toFixed(2), r.page ?? '', String(r.quote || '').trim()].join('|')
  const seen = new Set((existing || []).map(key))
  return (suggestions || []).filter(s => !seen.has(key(s)))
}

/**
 * Which pending rows "Approve all valid" may take, given each row's current
 * edit ({ value, category }). A row is valid with a readable amount, enough
 * confidence and, for a cost figure, a category with no existing cost line.
 * Returns { take: [rows], skipped: [{ row, reason }] }.
 */
export function bulkApprovable(rows, edits, costLines) {
  const take = [], skipped = []
  const used = new Set((costLines || []).map(l => l.category))
  for (const r of rows || []) {
    if (r.status !== 'pending') continue
    const e = edits?.[r.id] || {}
    const amount = parseAmount(e.value ?? r.value_number)
    const category = e.category !== undefined ? (e.category || null) : categoryForField(r.field)
    if (amount == null) { skipped.push({ row: r, reason: 'no amount' }); continue }
    if (r.confidence != null && Number(r.confidence) < BULK_MIN_CONFIDENCE) { skipped.push({ row: r, reason: 'low confidence' }); continue }
    if (!category && !isCheckField(r.field)) { skipped.push({ row: r, reason: 'no category' }); continue }
    if (category && used.has(category)) { skipped.push({ row: r, reason: 'a cost line of this category already exists' }); continue }
    take.push(r)
  }
  return { take, skipped }
}
