// Historic rent + expense CSV import — parsing, validation and dedupe planning.
//
// Backfilling years of data is the one place where a silent duplicate costs
// real money. rent_payments carried no uniqueness guarantee for most of its
// life, and three ExH flats are over-stated by roughly £4,000 today purely
// from repeat clicks in the day tracker. So this module never writes: it turns
// a file into an explicit PLAN — create / update / skip / error, per row — that
// the user approves before anything touches the database.
//
// Two deliberate positions:
//
//   1. A row that says "paid" with no amount is an ERROR, not a warning. That
//      exact shape is why Vale's 2025 P&L reports £0 against 117 paid months:
//      the reports use actual amounts as soon as any paid row exists, so a
//      paid row with a NULL amount silently removes income. See the `hasPaid`
//      branch in companyPnl.js and ReportsPage.jsx.
//
//   2. Rent is recorded GROSS with fees as separate expenses. Agent statements
//      show rent less commission less costs then a net payover, and importing
//      the payover as rent understates income while hiding the fee. Xero keeps
//      these on separate accounts for the same reason.

import { matchProperties, normaliseStatementName } from './statementParser'

// Mirrors the rent_payments status CHECK constraint. Anything else is rejected
// at parse time rather than failing per-row against the database.
export const RENT_STATUSES = ['paid', 'overdue', 'late', 'partial', 'void', 'refurb', 'pending']

// Mirrors the category list in the expense editor (FeatureComponents.jsx).
export const EXPENSE_CATEGORIES = [
  'insurance', 'agent_fees', 'repairs', 'ground_rent', 'service_charge',
  'utilities', 'mortgage', 'legal', 'accountancy', 'other',
]

// ── CSV PARSING ─────────────────────────────────────────────────────────────
// RFC4180: quoted fields may contain commas, newlines and doubled quotes. Hand
// rolled rather than pulled in as a dependency — the grammar is small and the
// CSP already blocks the CDN route the PDF importer has to use.
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '')  // strip BOM
  const rows = []
  let row = [], field = '', inQuotes = false, i = 0

  while (i < src.length) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  // Trailing field/row when the file does not end in a newline.
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  // Drop wholly blank lines — trailing newlines and spacer rows are common in
  // hand-edited exports and are not data.
  const clean = rows.filter(r => r.some(v => String(v).trim() !== ''))
  if (!clean.length) return { headers: [], rows: [] }

  const headers = clean[0].map(h => String(h).trim())
  return {
    headers,
    rows: clean.slice(1).map((cells, idx) => {
      const obj = { __line: idx + 2 }  // 1-based, +1 for the header row
      headers.forEach((h, ci) => { obj[h] = (cells[ci] ?? '').trim() })
      return obj
    }),
  }
}

// ── COLUMN DETECTION ────────────────────────────────────────────────────────
// Accept the many reasonable spellings a landlord or an accountant's export
// will produce, so the common case needs no manual mapping.
const COLUMN_ALIASES = {
  property:     ['property', 'property name', 'address', 'unit', 'flat', 'tracking', 'tracking category', 'properties', 'name'],
  period_start: ['period start', 'period_start', 'start', 'start date', 'from', 'date from'],
  period_end:   ['period end', 'period_end', 'end', 'end date', 'to', 'date to'],
  month:        ['month', 'period', 'rent month', 'month label'],
  amount:       ['amount', 'rent', 'value', 'gross', 'gross rent', 'total', 'debit', 'net'],
  status:       ['status', 'state', 'paid'],
  date:         ['date', 'transaction date', 'expense date', 'invoice date'],
  category:     ['category', 'type', 'account', 'account name', 'expense type'],
  description:  ['description', 'details', 'narration', 'reference', 'memo', 'notes'],
  notes:        ['notes', 'note', 'comment', 'comments'],
  source_ref:   ['source_ref', 'source ref', 'line id', 'lineitem id', 'journal id', 'id', 'xero id'],
}

const canonHeader = h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// headers → { canonicalField: actualHeader }. First match wins, and a header is
// only ever claimed by one field so 'notes' cannot steal 'description'.
export function detectColumns(headers) {
  const map = {}
  const taken = new Set()
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const h of headers) {
      if (taken.has(h)) continue
      if (aliases.includes(canonHeader(h))) { map[field] = h; taken.add(h); break }
    }
  }
  return map
}

// ── VALUE COERCION ──────────────────────────────────────────────────────────

// UK-first date handling. Bare YYYY-MM-DD passes through; DD/MM/YYYY is read as
// day-first (never month-first — an accountant's UK export is unambiguous about
// this and guessing the other way silently shifts a year of data).
export function parseDate(v) {
  const s = String(v || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return isoDate(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return isoDate(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/)
  if (m) return isoDate(2000 + +m[3], +m[2], +m[1])
  return null
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// "2025-01", "Jan 2025", "January 2025", "01/2025" → { year, month }.
export function parseMonth(v) {
  const s = String(v || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return validMonth(+m[1], +m[2])
  m = s.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return validMonth(+m[2], +m[1])
  m = s.match(/^([a-z]{3,})\s+(\d{4})$/i)
  if (m) {
    const mi = MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) return validMonth(+m[2], mi + 1)
  }
  return null
}

function validMonth(year, month) {
  if (!(year >= 1900 && year <= 2200) || !(month >= 1 && month <= 12)) return null
  return { year, month }
}

function isoDate(y, m, d) {
  if (!validMonth(y, m)) return null
  const last = new Date(y, m, 0).getDate()
  if (!(d >= 1 && d <= last)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Whole-month bounds, matching monthPeriodBounds in the api layer.
export function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0')
  const last = new Date(year, month, 0).getDate()
  return { period_start: `${year}-${mm}-01`, period_end: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

// Money. Tolerates £ and thousands separators, and accounting negatives in
// parentheses — Xero writes commission as "(65.00)". Returns null when the
// cell is not a number at all, which the caller reports as an error rather
// than quietly treating as zero.
export function parseAmount(v) {
  let s = String(v ?? '').trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[£$€\s,]/g, '')
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  if (!/^\d*\.?\d+$/.test(s)) return null
  const n = Math.round(parseFloat(s) * 100) / 100
  return neg ? -n : n
}

// Free-text status → a value the CHECK constraint accepts.
export function parseStatus(v) {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return null
  if (RENT_STATUSES.includes(s)) return s
  if (['yes', 'y', 'true', '1', 'received', 'collected'].includes(s)) return 'paid'
  if (['no', 'n', 'false', '0', 'unpaid', 'arrears', 'missed'].includes(s)) return 'overdue'
  if (['empty', 'vacant', 'void period'].includes(s)) return 'void'
  return null
}

// Category, accepting the display labels as well as the stored keys, plus the
// wordings that actually turn up ("management fee", "commission").
export function parseCategory(v) {
  const s = canonHeader(v)
  if (!s) return null
  const direct = s.replace(/ /g, '_')
  if (EXPENSE_CATEGORIES.includes(direct)) return direct
  if (/(agent|management|letting|commission)/.test(s)) return 'agent_fees'
  if (/(repair|maintenance|works)/.test(s)) return 'repairs'
  if (/insur/.test(s)) return 'insurance'
  if (/ground\s*rent/.test(s)) return 'ground_rent'
  if (/service\s*charge/.test(s)) return 'service_charge'
  if (/(utility|utilities|gas|electric|water|energy)/.test(s)) return 'utilities'
  if (/(mortgage|interest)/.test(s)) return 'mortgage'
  if (/(legal|solicitor|convey)/.test(s)) return 'legal'
  if (/(account|bookkeep|audit)/.test(s)) return 'accountancy'
  return null
}

// ── SOURCE REF ──────────────────────────────────────────────────────────────
// A stable id for a source row, so re-importing the same file is rejected by
// the unique index rather than silently duplicating. Not security-sensitive —
// FNV-1a is plenty and needs no dependency.
export function sourceRef(prefix, parts) {
  const s = parts.map(p => String(p ?? '')).join('')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Length is folded in too: FNV over short strings is fine but the extra
  // discriminator costs nothing and makes collisions vanishingly unlikely.
  return `${prefix}:${h.toString(16).padStart(8, '0')}${s.length.toString(36)}`
}

// ── PLANNING ────────────────────────────────────────────────────────────────
// Turn parsed rows into an explicit, reviewable plan. Nothing here writes.
//
// Every row lands on exactly one action:
//   create — no matching row exists
//   update — a row already covers this exact period and differs
//   skip   — a row already covers this exact period and is identical
//   error  — cannot be imported safely; blocks the commit
//
// The dedupe key for rent is (property, period_start, period_end), matching the
// unique index. A month may legitimately hold SEVERAL segments (changeover,
// part payment) so the month is deliberately not the key; two rows claiming the
// identical date range, however, are always a duplicate.

const money = n => Math.round((Number(n) || 0) * 100) / 100

// Resolve the period for one rent row from whichever columns the file carries.
function resolvePeriod(row, cols) {
  if (cols.period_start) {
    const ps = parseDate(row[cols.period_start])
    if (ps) {
      // A start with no end means a single day, not an open-ended period.
      const pe = cols.period_end ? parseDate(row[cols.period_end]) : null
      return { period_start: ps, period_end: pe || ps, from: 'dates' }
    }
  }
  if (cols.month) {
    const m = parseMonth(row[cols.month])
    if (m) return { ...monthBounds(m.year, m.month), from: 'month' }
  }
  return null
}

export function buildRentPlan({ rows, columns, properties, aliases = [], existing = [] }) {
  const cols = columns
  const byId = new Map((properties || []).map(p => [p.id, p]))

  // Resolve every label in one pass so the scorer sees the whole file.
  const labels = rows.map(r => ({ propertyName: cols.property ? row_(r, cols.property) : '' }))
  const matched = matchProperties(labels, properties || [], aliases)

  // Existing rows, keyed the same way the unique index is.
  const existingByKey = new Map()
  for (const e of existing) {
    if (!e.period_start) continue
    existingByKey.set(`${e.property_id}|${e.period_start}|${e.period_end}`, e)
  }
  const existingRefs = new Set(existing.map(e => e.source_ref).filter(Boolean))

  const seenInFile = new Map()
  const plan = rows.map((row, i) => {
    const errors = [], warnings = []
    const label = cols.property ? row_(row, cols.property) : ''
    const m = matched[i] || {}
    const propertyId = m.propertyId || null

    if (!cols.property) errors.push('No property column found in the file')
    else if (!label) errors.push('Property is blank')
    else if (!propertyId) errors.push(`No property matches "${label}" — pick one, or correct the name`)

    const period = resolvePeriod(row, cols)
    if (!period) {
      errors.push(cols.period_start || cols.month
        ? 'Could not read the period (expected YYYY-MM-DD, DD/MM/YYYY, or a month like 2025-01)'
        : 'No period column found (need period start/end, or month)')
    } else if (period.period_end < period.period_start) {
      errors.push(`Period ends (${period.period_end}) before it starts (${period.period_start})`)
    }

    const rawAmount = cols.amount ? row_(row, cols.amount) : ''
    let amount = parseAmount(rawAmount)
    if (rawAmount && amount === null) errors.push(`"${rawAmount}" is not an amount`)

    let status = cols.status ? parseStatus(row_(row, cols.status)) : null
    if (cols.status && row_(row, cols.status) && !status) {
      errors.push(`"${row_(row, cols.status)}" is not a status (use one of: ${RENT_STATUSES.join(', ')})`)
    }
    // No status column at all: an amount present means it was collected. This
    // is the overwhelmingly common shape of a historic rent export.
    if (!status) status = amount != null && amount !== 0 ? 'paid' : 'void'

    // THE important rule. A paid row with no amount is what left Vale
    // reporting £0 across 117 paid months, because the reports switch to
    // actual amounts the moment any paid row exists.
    if (status === 'paid' && (amount === null || amount === 0)) {
      errors.push('Marked paid but no amount — this is what makes reports show £0. Give an amount, or set the status to void.')
    }
    if (amount != null && amount < 0) {
      errors.push('Negative rent. Record a refund or fee as an expense, not as negative rent.')
    }
    if (period && amount != null && amount > 0) {
      const days = (new Date(period.period_end) - new Date(period.period_start)) / 86400000 + 1
      if (days > 45) warnings.push(`Period covers ${Math.round(days)} days — check this is one payment, not a whole year on one line`)
    }

    const ref = cols.source_ref && row_(row, cols.source_ref)
      ? `csv:${row_(row, cols.source_ref)}`
      : sourceRef('rent', [propertyId, period?.period_start, period?.period_end, amount, status])

    let action = 'create', existingId = null, before = null
    if (!errors.length) {
      const key = `${propertyId}|${period.period_start}|${period.period_end}`
      if (seenInFile.has(key)) {
        errors.push(`Duplicate of line ${seenInFile.get(key)} in this same file (same property and period)`)
      } else {
        seenInFile.set(key, row.__line)
        if (existingRefs.has(ref)) {
          action = 'skip'
          warnings.push('Already imported previously (same source reference)')
        } else {
          const hit = existingByKey.get(key)
          if (hit) {
            existingId = hit.id
            before = { status: hit.status, amount: hit.amount == null ? null : money(hit.amount) }
            const same = before.status === status && before.amount === (amount == null ? null : money(amount))
            action = same ? 'skip' : 'update'
          }
        }
      }
    }
    if (errors.length) action = 'error'

    return {
      line: row.__line, label,
      propertyId, propertyName: byId.get(propertyId)?.name || null,
      matchedVia: m.matchedVia || null, matchScore: m.matchScore ?? null,
      period_start: period?.period_start || null,
      period_end: period?.period_end || null,
      amount, status,
      notes: cols.notes ? row_(row, cols.notes) : '',
      sourceRef: ref,
      action, existingId, before,
      errors, warnings,
    }
  })

  return { plan, summary: summarise(plan) }
}

export function buildExpensePlan({ rows, columns, properties, aliases = [], existing = [] }) {
  const cols = columns
  const byId = new Map((properties || []).map(p => [p.id, p]))
  const labels = rows.map(r => ({ propertyName: cols.property ? row_(r, cols.property) : '' }))
  const matched = matchProperties(labels, properties || [], aliases)

  const existingRefs = new Set(existing.map(e => e.source_ref).filter(Boolean))
  // Same property, day, category and amount but no source ref: could be a
  // genuine second identical cost, so this warns rather than blocks.
  const existingNatural = new Set(
    existing.filter(e => !e.source_ref)
      .map(e => `${e.property_id}|${e.date}|${e.category}|${money(e.amount)}`)
  )

  const seenInFile = new Map()
  const plan = rows.map((row, i) => {
    const errors = [], warnings = []
    const label = cols.property ? row_(row, cols.property) : ''
    const m = matched[i] || {}
    const propertyId = m.propertyId || null

    if (!cols.property) errors.push('No property column found in the file')
    else if (!label) errors.push('Property is blank')
    else if (!propertyId) errors.push(`No property matches "${label}" — pick one, or correct the name`)

    const date = cols.date ? parseDate(row_(row, cols.date)) : null
    if (!date) {
      errors.push(cols.date
        ? `Could not read the date "${row_(row, cols.date)}" (expected YYYY-MM-DD or DD/MM/YYYY)`
        : 'No date column found')
    }

    const rawAmount = cols.amount ? row_(row, cols.amount) : ''
    let amount = parseAmount(rawAmount)
    if (amount === null) errors.push(rawAmount ? `"${rawAmount}" is not an amount` : 'Amount is blank')
    // Xero writes commission as a bracketed negative against the fee account.
    // The sign convention there is presentational; an expense is stored as a
    // positive cost, so fold it and note that we did.
    if (amount != null && amount < 0) {
      warnings.push(`Amount was negative (${rawAmount}) — recorded as a positive cost of ${Math.abs(amount)}`)
      amount = Math.abs(amount)
    }
    if (amount === 0) warnings.push('Zero amount')

    let category = cols.category ? parseCategory(row_(row, cols.category)) : null
    if (cols.category && row_(row, cols.category) && !category) {
      warnings.push(`Category "${row_(row, cols.category)}" not recognised — filed as Other`)
    }
    if (!category) category = 'other'

    const description = (cols.description ? row_(row, cols.description) : '')
      || (cols.notes ? row_(row, cols.notes) : '')
      || 'Imported expense'

    const ref = cols.source_ref && row_(row, cols.source_ref)
      ? `csv:${row_(row, cols.source_ref)}`
      : sourceRef('exp', [propertyId, date, category, amount, description])

    let action = 'create'
    if (!errors.length) {
      if (seenInFile.has(ref)) {
        errors.push(`Identical to line ${seenInFile.get(ref)} in this same file`)
      } else {
        seenInFile.set(ref, row.__line)
        if (existingRefs.has(ref)) {
          action = 'skip'
          warnings.push('Already imported previously (same source reference)')
        } else if (existingNatural.has(`${propertyId}|${date}|${category}|${money(amount)}`)) {
          warnings.push('An expense with the same property, date, category and amount already exists — check this is not a duplicate')
        }
      }
    }
    if (errors.length) action = 'error'

    return {
      line: row.__line, label,
      propertyId, propertyName: byId.get(propertyId)?.name || null,
      matchedVia: m.matchedVia || null, matchScore: m.matchScore ?? null,
      date, amount, category, description,
      notes: cols.notes ? row_(row, cols.notes) : '',
      sourceRef: ref,
      action, existingId: null, before: null,
      errors, warnings,
    }
  })

  return { plan, summary: summarise(plan) }
}

// Reading a cell by header name, tolerating a header that repeats.
function row_(row, header) {
  return String(row[header] ?? '').trim()
}

// Exported so the review UI can recompute totals after the user excludes rows.
export function summarise(plan) {
  const s = { total: plan.length, create: 0, update: 0, skip: 0, error: 0, warnings: 0, amount: 0 }
  for (const r of plan) {
    s[r.action]++
    if (r.warnings.length) s.warnings++
    if ((r.action === 'create' || r.action === 'update') && r.amount) s.amount = money(s.amount + r.amount)
  }
  return s
}

// The user reassigning a property is the signal our match was wrong. Same
// contract as the statement importer: only labels the user corrected by hand
// are worth learning, and only when they do not already normalise to the
// chosen property's own name.
export function aliasesToLearn(plan, properties) {
  const byId = new Map((properties || []).map(p => [p.id, p]))
  const out = [], seen = new Set()
  for (const r of plan) {
    if (r.matchedVia !== 'manual' || !r.propertyId || !r.label) continue
    const norm = normaliseStatementName(r.label)
    if (!norm || seen.has(norm)) continue
    if (norm === normaliseStatementName(byId.get(r.propertyId)?.name)) continue
    seen.add(norm)
    out.push({ propertyId: r.propertyId, alias: r.label, aliasNorm: norm })
  }
  return out
}
