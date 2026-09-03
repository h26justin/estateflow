// ── PROPERTY SEARCH ───────────────────────────────────────────────────────
// Pure matching logic for the Portfolio and Rent Tracker search bars.
//
// A query is split into whitespace-separated tokens; every token must appear
// somewhere in the property's search text (case-insensitive, partial words
// allowed). So "flat 1 watts" finds "Flat 1, Watts Moses House" and also
// "Flat 10, Watts Moses House" (partial), while "flat 1 park" finds the
// Flat 1s at Park Place West / East instead.
//
// Search text is built from what authorised members can already see on the
// property list: name, address, building / unit (derived from the name and
// address the same way the app clusters buildings), company name + abbr,
// and tenant names (properties.tenant_name, plus tenancy_details.tenant_names
// if the caller has that joined in). No phone numbers or email addresses
// are ever added here — keep it that way.

import { buildingTailFromName, flatKeyWithinBuilding, groupKeyForAddress } from './addressUtils'

/**
 * Normalise a raw query string into lowercase tokens. Returns [] for an
 * empty / whitespace-only / non-string query, which callers treat as
 * "no search active".
 */
export function normaliseQuery(q) {
  if (q == null) return []
  return String(q)
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
}

/** Flatten a value that may be a string, array of strings, or a row / array
 *  of rows carrying the named field. Used for the tenancy_details join,
 *  whose shape depends on whether the caller selected it as a single object
 *  or an array. */
function collectField(value, field) {
  if (value == null) return []
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(v => collectField(v, field))
  if (typeof value === 'object') return collectField(value[field], field)
  return []
}

/**
 * The bits of a property a search result needs to disambiguate itself from
 * a same-named unit elsewhere ("Flat 1" exists in several buildings across
 * several companies). Used by the UI when a query is active and by tests.
 */
export function propertySearchMeta(p) {
  const name = p?.name || ''
  const tail = buildingTailFromName(name)
  return {
    id: p?.id ?? null,
    name,
    unit: tail ? flatKeyWithinBuilding(name) : '',
    building: tail || '',
    address: p?.address || '',
    companyId: p?.company_id ?? p?.company?.id ?? null,
    companyName: p?.company?.name || '',
    companyAbbr: p?.company?.abbr || '',
    companyColor: p?.company?.color || null,
  }
}

/**
 * Build the lowercase haystack a query is matched against. Fields are joined
 * with " | " so a token can't accidentally span two fields.
 */
export function propertySearchText(p) {
  if (!p) return ''
  const name = p.name || ''
  const parts = [
    name,
    p.address || '',
    buildingTailFromName(name) || '',
    // Address-derived building key ("wattsmoseshouse|sunderland") lets a
    // run-together query like "wattsmoses" still hit.
    groupKeyForAddress(p.address) || '',
    p.company?.name || '',
    p.company?.abbr || '',
    p.tenant_name || '',
    ...collectField(p.tenancy_details, 'tenant_names'),
    ...collectField(p.tenancies, 'tenant_name'),
    ...collectField(p.tenancies, 'tenant_ref'),
    // Tenant reference / ID, if any such field is present on the row. There
    // is no such column today; this is a forward hook for later stages.
    p.tenant_reference || p.tenant_ref || p.tenant_id || '',
    ...collectField(p.tenancy_details, 'tenant_reference'),
  ]
  return parts
    .map(x => String(x ?? '').trim())
    .filter(Boolean)
    .join(' | ')
    .toLowerCase()
}

/**
 * Does this property match the query? Every token must be found somewhere
 * in the property's search text. An empty query matches everything.
 */
export function matchesQuery(p, q) {
  const tokens = Array.isArray(q) ? q : normaliseQuery(q)
  if (tokens.length === 0) return true
  const hay = propertySearchText(p)
  if (!hay) return false
  return tokens.every(t => hay.includes(t))
}

/**
 * Filter a list of properties by a query, preserving input order. An empty
 * query returns a shallow copy of the input so callers can rely on getting
 * an array back regardless.
 */
export function searchProperties(properties, q) {
  const list = Array.isArray(properties) ? properties : []
  const tokens = normaliseQuery(q)
  if (tokens.length === 0) return [...list]
  return list.filter(p => matchesQuery(p, tokens))
}

/**
 * Rank matching properties for a type-ahead dropdown. Same matching rules as
 * matchesQuery (every token must appear somewhere), but the survivors are
 * ordered so the thing the user most likely meant is first:
 *
 *   1. the name starts with the query           ("13 lum" → 13 Lumley Street)
 *   2. a word inside the name starts with it    ("lumley" → 13 Lumley Street)
 *   3. the address starts with the query
 *   4. a word inside the address starts with it
 *   5. matched somewhere else (tenant, company, building key)
 *
 * Ties break on natural name order so "Flat 2" precedes "Flat 10". Pass a
 * limit to cap the list (the dropdown only shows a handful).
 */
export function rankProperties(properties, q, limit = 8) {
  const list = Array.isArray(properties) ? properties : []
  const tokens = normaliseQuery(q)
  if (tokens.length === 0) return []
  // The whole query as typed, for the "starts with" tests — a multi-word
  // query like "13 lumley" should still count as a prefix of the name.
  const phrase = tokens.join(' ')
  const rank = p => {
    const name = String(p?.name || '').toLowerCase()
    const addr = String(p?.address || '').toLowerCase()
    if (name.startsWith(phrase)) return 0
    if (name.split(/[\s,]+/).some(w => w.startsWith(phrase))) return 1
    if (addr.startsWith(phrase)) return 2
    if (addr.split(/[\s,]+/).some(w => w.startsWith(phrase))) return 3
    return 4
  }
  const natSort = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
  const scored = list
    .filter(p => matchesQuery(p, tokens))
    .map(p => ({ p, r: rank(p) }))
    .sort((a, b) => (a.r - b.r) || natSort(a.p?.name || a.p?.address, b.p?.name || b.p?.address))
    .map(x => x.p)
  return limit > 0 ? scored.slice(0, limit) : scored
}
