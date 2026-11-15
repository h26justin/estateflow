import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { buildComplianceFromDoc, complianceReviewReason } from '../api/compliance'

// The shape extract-document stores in property_documents.extracted_fields:
// type-specific values under `fields`, the headline expiry as
// primary_expiry_date (DD/MM/YYYY), plus the staging decision when it did
// not write the compliance row itself.
const extracted = {
  document_type: 'gas_cert',
  confidence: 'medium',
  property_address_text: '1 High Street, Leeds',
  property_postcode: 'LS1 1AA',
  primary_expiry_date: '14/03/2027',
  human_summary: 'Landlord gas safety record for 1 High Street.',
  fields: {
    engineer_name: 'A Engineer',
    gas_safe_number: '123456',
    inspection_date: '15/03/2026',
    expiry_date: '14/03/2027',
    appliances: ['Boiler', 'Hob'],
    overall_pass: true,
  },
  matched_property_id: 'p1',
  match_confidence: 'high',
  compliance_needs_review: true,
  compliance_review_reason: 'extraction_confidence_medium',
}

describe('buildComplianceFromDoc — AI-extracted documents', () => {
  it('reads the nested dates and falls back to document_type when the category is not a certificate', () => {
    const c = buildComplianceFromDoc({ id: 'd1', category: 'other', extracted_fields: extracted })
    expect(c).toMatchObject({
      cert_type: 'gas_safety', cert_name: 'Gas Safety (CP12)',
      issue_date: '2026-03-15', expiry_date: '2027-03-14', document_id: 'd1',
    })
  })

  it('uses primary_expiry_date when fields has no expiry', () => {
    const f = { ...extracted, fields: { ...extracted.fields, expiry_date: null } }
    expect(buildComplianceFromDoc({ id: 'd1', category: 'gas', extracted_fields: f }).expiry_date).toBe('2027-03-14')
  })

  it('reads insurance cover dates from fields', () => {
    const f = { document_type: 'insurance', primary_expiry_date: null, fields: { insurer: 'X', cover_start: '01/06/2026', cover_end: '31/05/2027' } }
    expect(buildComplianceFromDoc({ id: 'd2', category: 'insurance', extracted_fields: f }))
      .toMatchObject({ cert_type: 'insurance', issue_date: '2026-06-01', expiry_date: '2027-05-31' })
  })

  it('still reads the legacy top-level shape', () => {
    const f = { expiry_date: '01/02/2030', inspection_date: '02/02/2025' }
    expect(buildComplianceFromDoc({ id: 'd3', category: 'eicr', extracted_fields: f }))
      .toMatchObject({ cert_type: 'eicr', issue_date: '2025-02-02', expiry_date: '2030-02-01' })
  })

  it('returns null for a non-certificate document', () => {
    const f = { document_type: 'receipt', primary_expiry_date: '01/01/2027', fields: {} }
    expect(buildComplianceFromDoc({ id: 'd4', category: 'other', extracted_fields: f })).toBeNull()
  })

  it('explains why the extraction staged it for review', () => {
    expect(complianceReviewReason({ extracted_fields: extracted })).toMatch(/high confidence/)
    expect(complianceReviewReason({ extracted_fields: { ...extracted, compliance_needs_review: false } })).toBeNull()
  })
})
