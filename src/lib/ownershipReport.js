// ── PROPERTY OWNERSHIP REGISTER ───────────────────────────────────────────
// Pure calculation module (no Supabase, no React) behind the "Property
// ownership" report: which company holds each property, who owns that
// company, and how much of it is ultimately the signed-in user's.
//
// A property with no company_id is not an error — a landlord can hold
// property in their own name. Those land in a "Personally held (no company)"
// bucket, the same label buildPortfolioPnl uses, and count as 100% theirs.
//
// Ownership is a point-in-time fact, so nothing here is period-filtered:
// the register is as it stands today. Sold and archived properties stay in
// the list (flagged) so it reconciles against an accountant's fixed-asset
// note rather than silently dropping disposals.

import { propValue } from './propertyValue'
import { isHoldingCompany, isCorporateShareholder, viewerEffectiveShares, companyEffectiveStakes } from './companyPnl'

// Same wording as the Full Portfolio P&L's personally-held bucket.
export const PERSONAL_BUCKET_NAME = 'Personally held (no company)'

// Natural comparator — "Flat 2" before "Flat 10".
const nat = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' })

// The cap table of one company, biggest stake first. A corporate row linked
// to another company in the account is named after that company (its own
// name column is free text and often stale).
function ownersOf(shareholders, companyId, nameById) {
  return shareholders
    .filter(s => s.company_id === companyId)
    .map(s => ({
      name: s.shareholder_company_id
        ? (nameById.get(s.shareholder_company_id) || s.name || 'Linked company')
        : (s.name || 'Unnamed shareholder'),
      pct: Number(s.percentage) || 0,
      corporate: isCorporateShareholder(s),
      companyId: s.shareholder_company_id || null,
    }))
    .sort((a, b) => b.pct - a.pct || nat(a.name, b.name))
}

/**
 * Build the ownership register.
 *
 * @param properties     properties rows (any company_id, including null)
 * @param companies      companies rows the caller can see
 * @param shareholders   company_shareholders rows across ALL companies
 * @param user           signed-in user, for the effective-share column
 * @param scopeCompanyId when the report is filtered to one company, its id.
 *                       The full companies + shareholders lists are still
 *                       needed to resolve names and look through holding
 *                       companies, so scoping is applied to the OUTPUT, not
 *                       to the inputs.
 *
 * Returns:
 *   groups          one per company holding at least one property, natural
 *                   by name, with the personally-held bucket last
 *   otherCompanies  companies holding no property — holding companies
 *                   (with what they hold) and empty operating companies
 *   totals          register-wide counts and value
 */
export function buildOwnershipRegister({ properties = [], companies = [], shareholders = [], user = null, scopeCompanyId = null } = {}) {
  const nameById = new Map(companies.map(c => [c.id, c.abbr || c.name]))
  const eff = viewerEffectiveShares({ shareholders, companies, user })

  const byCompany = new Map()
  const personal = []
  for (const p of properties) {
    // A company_id pointing at a company the caller can't see is treated
    // the same as none — the register must never silently drop a property.
    if (p.company_id && nameById.has(p.company_id)) {
      const arr = byCompany.get(p.company_id)
      if (arr) arr.push(p); else byCompany.set(p.company_id, [p])
    } else {
      personal.push(p)
    }
  }

  const decorate = p => ({
    p,
    value: propValue(p),
    sold: p.status === 'sold',
    archived: !!p.archived_at,
  })
  const sortProps = rows => [...rows].sort((a, b) => nat(a.p.name, b.p.name))

  const groups = [...companies]
    .filter(c => (byCompany.get(c.id) || []).length > 0)
    .sort((a, b) => nat(a.abbr || a.name, b.abbr || b.name))
    .map(c => {
      const rows = sortProps((byCompany.get(c.id) || []).map(decorate))
      return {
        id: c.id,
        name: c.name || 'Company',
        abbr: c.abbr || null,
        type: isHoldingCompany(c) ? 'holding' : 'operating',
        properties: rows,
        count: rows.length,
        value: rows.reduce((s, r) => s + r.value, 0),
        // null (not 0) when the user holds no traceable stake — the report
        // shows "—" rather than claiming a 0% shareholding.
        sharePct: eff.pct[c.id] ?? null,
        via: eff.via[c.id] || [],
        owners: ownersOf(shareholders, c.id, nameById),
        holds: [],
      }
    })

  if (personal.length) {
    const rows = sortProps(personal.map(decorate))
    groups.push({
      id: null,
      name: PERSONAL_BUCKET_NAME,
      abbr: null,
      type: 'personal',
      properties: rows,
      count: rows.length,
      value: rows.reduce((s, r) => s + r.value, 0),
      sharePct: 100,
      via: [],
      owners: [],
      holds: [],
    })
  }

  const otherCompanies = [...companies]
    .filter(c => (byCompany.get(c.id) || []).length === 0)
    .filter(c => !scopeCompanyId || c.id === scopeCompanyId)
    .sort((a, b) => nat(a.abbr || a.name, b.abbr || b.name))
    .map(c => {
      const holding = isHoldingCompany(c)
      // What a holding company holds: its effective stake in every other
      // company, so the chain reads "HoldCo → OpCo 60% → OpCo's properties".
      // No property count here — it would be wrong whenever the report is
      // scoped to a single company; each company's own count is one row up
      // in the summary table.
      const stakes = holding ? companyEffectiveStakes(shareholders, c.id) : {}
      const holds = Object.entries(stakes)
        .map(([companyId, pct]) => ({ id: companyId, name: nameById.get(companyId) || 'Company', pct }))
        .sort((a, b) => b.pct - a.pct || nat(a.name, b.name))
      return {
        id: c.id,
        name: c.name || 'Company',
        abbr: c.abbr || null,
        type: holding ? 'holding' : 'operating',
        properties: [],
        count: 0,
        value: 0,
        sharePct: eff.pct[c.id] ?? null,
        via: eff.via[c.id] || [],
        owners: ownersOf(shareholders, c.id, nameById),
        holds,
      }
    })

  const all = groups.flatMap(g => g.properties)
  return {
    groups,
    otherCompanies,
    totals: {
      properties: all.length,
      value: all.reduce((s, r) => s + r.value, 0),
      // Companies that actually hold title, excluding the personal bucket.
      companiesWithProperty: groups.filter(g => g.type !== 'personal').length,
      personallyHeld: personal.length,
      sold: all.filter(r => r.sold).length,
      archived: all.filter(r => r.archived).length,
    },
  }
}

// One-line description of who owns a company, for the summary table's
// "Owned by" column. Biggest stake first; more than two owners collapse
// to "+N more".
export function ownersLabel(group) {
  if (group.type === 'personal') return 'You, in your own name'
  if (!group.owners.length) return 'No shareholders recorded'
  const shown = group.owners.slice(0, 2).map(o => `${o.name} ${o.pct}%`)
  const rest = group.owners.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` +${rest} more` : '')
}
