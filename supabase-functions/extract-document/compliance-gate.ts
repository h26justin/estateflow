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
