import { describe, it, expect } from 'vitest'
import { matchProperties, normaliseStatementName } from '../statementParser'

// The real-world case this hardening came from: Vale's "35 Henley Road" was
// duplicated as "Henly Road", and an imported statement landed the rent on the
// wrong record. After the merge only the correct record exists, so the matcher
// has to cope with the agent's spelling on its own.
const HENLEY = { id: 'p-henley', name: '35 Henley Road', address: '35 Henley Road, Nookside, Sunderland, SR4 8AS' }
const WATTS_18 = { id: 'p-w18', name: 'Flat 18, Watts Moses House', address: 'Watts Moses House, Sunderland' }
const WATTS_1B = { id: 'p-w1b', name: 'Flat 1B, Watts Moses House', address: 'Watts Moses House, Sunderland' }
const PORTFOLIO = [HENLEY, WATTS_18, WATTS_1B]

const line = propertyName => ({ propertyName, type: 'rent', editAmount: 635 })
const match = (label, props = PORTFOLIO, aliases) =>
  matchProperties([line(label)], props, aliases)[0]

describe('normaliseStatementName', () => {
  it('folds case, punctuation and whitespace', () => {
    expect(normaliseStatementName('  35 Henley  Road, ')).toBe('35 henley road')
  })

  it('folds safe street-type abbreviations so Rd and Road agree', () => {
    expect(normaliseStatementName('35 Henley Rd')).toBe(normaliseStatementName('35 Henley Road'))
  })

  it('leaves ambiguous abbreviations alone', () => {
    // "St" is Saint here, not Street — folding it would rewrite the building.
    expect(normaliseStatementName('St Georges House')).toBe('st georges house')
  })

  it('is safe on empty input', () => {
    expect(normaliseStatementName(null)).toBe('')
    expect(normaliseStatementName('')).toBe('')
  })
})

describe('matchProperties — exact name', () => {
  it('matches a label identical to the property name', () => {
    const r = match('35 Henley Road')
    expect(r.propertyId).toBe('p-henley')
    expect(r.matchedVia).toBe('alias')
  })

  it('matches through an abbreviation difference', () => {
    expect(match('35 Henley Rd').propertyId).toBe('p-henley')
  })

  it('will not resolve a name shared by two properties', () => {
    const dupes = [
      { id: 'a', name: 'The Cottage', address: 'St Georges House' },
      { id: 'b', name: 'The Cottage', address: 'Park Place East' },
    ]
    // Ambiguous — must fall through to scoring rather than silently pick one.
    expect(match('The Cottage', dupes).matchedVia).not.toBe('alias')
  })
})

describe('matchProperties — typo tolerance', () => {
  it('matches a hand-keyed misspelling of the street', () => {
    const r = match('Henly Road')
    expect(r.propertyId).toBe('p-henley')
    expect(r.matched).toBe(true)
  })

  it('still matches when the misspelling carries the house number', () => {
    expect(match('35 Henly Road').propertyId).toBe('p-henley')
  })

  it('does not confuse two units in the same building', () => {
    expect(match('Flat 18, Watts Moses House').propertyId).toBe('p-w18')
    expect(match('Flat 1B, Watts Moses House').propertyId).toBe('p-w1b')
  })

  it('leaves a genuinely unknown property unmatched', () => {
    const r = match('Flat 4, Some Other Building')
    expect(r.matched).toBe(false)
    expect(r.propertyId).toBe(null)
  })
})

describe('matchProperties — learned aliases', () => {
  it('resolves a label that scoring alone would miss', () => {
    const odd = [{ id: 'p-x', name: 'Turnberry Cottage', address: '1 Turnberry Way' }]
    expect(match('TBC1', odd).matched).toBe(false)
    const r = match('TBC1', odd, [{ property_id: 'p-x', alias: 'TBC1' }])
    expect(r.propertyId).toBe('p-x')
    expect(r.matchedVia).toBe('alias')
    expect(r.matchScore).toBe(100)
  })

  it('normalises the stored alias, so punctuation and case do not matter', () => {
    const r = match('35 henley  rd.', PORTFOLIO, [{ property_id: 'p-w18', alias: '35 Henley Rd' }])
    // The alias wins over the implicit name match for the same normalised key.
    expect(r.propertyId).toBe('p-w18')
  })

  it('ignores an alias pointing at a property that no longer exists', () => {
    // Aliases outlive deleted duplicates; a dangling one must not blank the match.
    const r = match('Henly Road', PORTFOLIO, [{ property_id: 'p-deleted-dup', alias: 'Henly Road' }])
    expect(r.propertyId).toBe('p-henley')
  })

  it('accepts a pre-normalised alias_norm from the database', () => {
    const r = match('Henly Road', PORTFOLIO, [{ property_id: 'p-w18', alias_norm: 'henly road' }])
    expect(r.propertyId).toBe('p-w18')
  })

  it('is a no-op when no aliases are passed at all', () => {
    expect(matchProperties([line('35 Henley Road')], PORTFOLIO)[0].propertyId).toBe('p-henley')
  })

  it('leaves items with no property label untouched', () => {
    const r = matchProperties([{ type: 'fee', editAmount: 10 }], PORTFOLIO)[0]
    expect(r.propertyId).toBeUndefined()
  })
})
