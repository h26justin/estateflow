import { describe, it, expect } from 'vitest'
import {
  categoryForField, parseAmount, sourceFor, costLineFromSuggestion, conflictingLines,
  newSuggestionsOnly, bulkApprovable, CHECK_FIGURE,
} from '../dealDocExtract'

describe('dealDocExtract', () => {
  it('maps fields to cost categories; check figures and the asking price to none', () => {
    expect(categoryForField('sdlt')).toBe('sdlt')
    expect(categoryForField('agreed_price')).toBe('purchase_price')
    expect(categoryForField('asking_price')).toBeNull()
    expect(categoryForField('balance_due')).toBeNull()
    expect(categoryForField('total')).toBeNull()
    expect(categoryForField('mortgage_advance')).toBeNull()
    expect(categoryForField('nonsense')).toBeNull()
    expect(CHECK_FIGURE).toBe('check_figure')
  })

  it('parses edited amounts', () => {
    expect(parseAmount('£1,020.50')).toBe(1020.5)
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })

  it('builds a source-linked cost line', () => {
    const line = costLineFromSuggestion({ field: 'sdlt', page: 2, quote: 'Stamp Duty Land Tax £2,500.00' },
      { docName: 'Completion statement.pdf', category: 'sdlt', amount: 2500 })
    expect(line).toEqual({
      category: 'sdlt', label: 'Stamp Duty Land Tax', amount: 2500, state: 'quoted', vat_included: true,
      source: 'Completion statement.pdf p.2', notes: 'Stamp Duty Land Tax £2,500.00',
    })
    // Paid / actual never come from a reading.
    expect(costLineFromSuggestion({ field: 'sdlt' }, { docName: 'x', category: 'sdlt', amount: 1, state: 'paid' }).state).toBe('quoted')
    expect(sourceFor('a'.repeat(400), 12)).toHaveLength(300)
    expect(sourceFor('a'.repeat(400), 12).endsWith(' p.12')).toBe(true)
  })

  it('finds conflicting cost lines by category', () => {
    const lines = [{ id: 1, category: 'sdlt' }, { id: 2, category: 'legal_fee' }]
    expect(conflictingLines(lines, 'sdlt')).toEqual([{ id: 1, category: 'sdlt' }])
    expect(conflictingLines(lines, null)).toEqual([])
  })

  it('never duplicates a stored suggestion, whatever its status', () => {
    const existing = [{ field: 'total', value_number: '17039.00', page: 2, quote: 'Total £17,039.00', status: 'rejected' }]
    const out = newSuggestionsOnly(existing, [
      { field: 'total', value_number: 17039, page: 2, quote: 'Total £17,039.00' },
      { field: 'balance_due', value_number: 16739, page: 2, quote: 'Balance due £16,739.00' },
    ])
    expect(out.map(s => s.field)).toEqual(['balance_due'])
  })

  it('bulk approval skips conflicts, low confidence and missing amounts', () => {
    const rows = [
      { id: 'a', field: 'sdlt', value_number: 0, confidence: 0.95, status: 'pending' },
      { id: 'b', field: 'legal_fee', value_number: 850, confidence: 0.9, status: 'pending' },
      { id: 'c', field: 'searches', value_number: 228, confidence: 0.4, status: 'pending' },
      { id: 'd', field: 'total', value_number: 100, confidence: 0.9, status: 'pending' },
      { id: 'e', field: 'land_registry', value_number: 90, confidence: 0.9, status: 'approved' },
      { id: 'f', field: 'survey', value_number: null, confidence: 0.9, status: 'pending' },
    ]
    const { take, skipped } = bulkApprovable(rows, {}, [{ category: 'legal_fee' }])
    expect(take.map(r => r.id)).toEqual(['a', 'd'])
    expect(skipped.map(s => [s.row.id, s.reason])).toEqual([
      ['b', 'a cost line of this category already exists'], ['c', 'low confidence'], ['f', 'no amount'],
    ])
  })

  it('bulk approval uses the edited value and category', () => {
    const rows = [{ id: 'a', field: 'searches', value_number: null, confidence: 0.9, status: 'pending' }]
    expect(bulkApprovable(rows, { a: { value: '120', category: 'disbursements' } }, []).take).toHaveLength(1)
    expect(bulkApprovable(rows, { a: { value: '120', category: '' } }, []).skipped[0].reason).toBe('no category')
  })
})
