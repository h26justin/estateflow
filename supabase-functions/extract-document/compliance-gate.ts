// Decides whether extract-document may write a compliance_items row on its
// own, or must leave it for the landlord to confirm.
//
// A compliance row drives reminders and the property's compliance status, so
// a wrong one is worse than none. Auto-write only when the extracted address
// matched exactly one property with HIGH confidence (unique postcode match)
// and that property agrees with where the document was filed (or the
// document was filed nowhere). Everything else — medium / low / no match, or
// a high match that contradicts the document's own property — is staged:
// nothing is written, and the Documents tab's "+ Add to Compliance" prompt
// (FeatureComponents.jsx → buildComplianceFromDoc) lets the landlord confirm.

export type MatchConfidence = 'high' | 'medium' | 'low'

export interface ComplianceDecision {
  /** Property to write the compliance row against, or null = don't write. */
  propertyId: string | null
  /** True when a row would have been created but needs the user to confirm. */
  needsReview: boolean
  reason: string | null
}

export function decideComplianceTarget(
  docPropertyId: string | null | undefined,
  match: { property_id: string; match_confidence: MatchConfidence } | null,
): ComplianceDecision {
  if (!match) return { propertyId: null, needsReview: true, reason: 'no_property_match' }
  if (match.match_confidence !== 'high') {
    return { propertyId: null, needsReview: true, reason: `match_confidence_${match.match_confidence}` }
  }
  if (docPropertyId && docPropertyId !== match.property_id) {
    return { propertyId: null, needsReview: true, reason: 'match_conflicts_with_document_property' }
  }
  return { propertyId: match.property_id, needsReview: false, reason: null }
}

// Reformat DD/MM/YYYY → YYYY-MM-DD for Postgres date columns. Null unless
// it is a real calendar date (31/02 and 00/13 are rejected).
export function ukDateToIso(d: string | null | undefined): string | null {
  if (!d || typeof d !== 'string') return null
  const m = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(year, month - 1, day))
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Longest issue → expiry span accepted for an automatic write, in months:
// the statutory / standard cycle plus a small tolerance (a gas check done
// up to two months early may keep the old anniversary).
export const MAX_CYCLE_MONTHS: Record<string, number> = {
  gas_safety: 14,  // 12-month cycle
  eicr: 61,        // at most 5 years
  epc: 121,        // valid 10 years
  insurance: 13,   // annual policy
}

function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`
}

// Null when the issue → expiry span is plausible for this certificate type,
// else a review reason.
export function cycleProblem(certType: string, issue: string | null, expiry: string): string | null {
  const max = MAX_CYCLE_MONTHS[certType]
  if (!max) return 'no_statutory_cycle'
  if (!issue) return 'issue_date_missing'
  if (expiry <= issue) return 'expiry_not_after_issue'
  if (expiry > addMonthsIso(issue, max)) return 'expiry_beyond_statutory_cycle'
  return null
}
