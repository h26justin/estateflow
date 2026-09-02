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

describe('matchProperties — number agreement across different buildings', () => {
  // Found while mapping Vale's Xero tracking options onto the portfolio.
  // "10 Elms West" is a whole building (house number 10); "Esplanade West
  // Flat 10" is a flat in an unrelated building. They share the number 10 and
  // the word "west", which was enough to score 10 and clear the threshold, so
  // a building's rent would post onto that flat with no warning.
  const ELMS = { id: 'p-elms', name: 'Room 2A, 10 Elms West', address: '10 Elms West, Sunderland' }
  const ESP_10 = { id: 'p-esp10', name: 'Esplanade West Flat 10', address: '16 Esplanade, Sunderland' }

  it('does not match a building label onto a same-numbered flat elsewhere', () => {
    const r = match('10 Elms West', [ELMS, ESP_10])
    expect(r.propertyId).toBeNull()
  })

  it('still matches a flat label to its own building', () => {
    const r = match('16 Esplanade Flat 10', [ELMS, ESP_10])
    expect(r.propertyId).toBe('p-esp10')
  })

  it('still matches a room label to its own room', () => {
    const r = match('10 Elms West Room 2A', [ELMS, ESP_10])
    expect(r.propertyId).toBe('p-elms')
  })

  it('keeps matching a bare unit label that names no building', () => {
    // Nothing to contradict, so the number alone may still match and the user
    // confirms in the preview.
    const only = { id: 'p-only', name: 'Flat 3, Somewhere House', address: 'Somewhere House' }
    expect(match('Flat 3', [only]).propertyId).toBe('p-only')
  })
})

describe('matchProperties — town names are not evidence', () => {
  // Found while mapping Vale's Xero tracking options. "62c Sunderland Road"
  // (sold Sept 2025, no longer in the portfolio) scored 10 against
  // "15 Regal Road, Sunderland" purely for sharing "sunderland" and "road" —
  // enough to clear the threshold and post a sold property's rent elsewhere.
  // The filter needs at least 5 distinct buildings before it engages, so this
  // portfolio is realistic rather than minimal.
  const PORTFOLIO_20 = [
    { id: 'regal',    name: '15 Regal Road',       address: '15 Regal Road, Sunderland, SR4 6HP' },
    { id: 'rutland',  name: '103 Rutland Street',  address: '103 Rutland Street, Sunderland, SR4 6QG' },
    { id: 'garfield', name: '6 Garfield Street',   address: '6 Garfield Street, Sunderland, SR4 6NL' },
    { id: 'rosedale', name: '46 Rosedale Street',  address: '46 Rosedale Street, Sunderland, SR1 3RW' },
    { id: 'henley',   name: '35 Henley Road',      address: '35 Henley Road, Nookside, Sunderland, SR4 8AS' },
    { id: 'weldon',   name: '37 Weldon Avenue',    address: '37 Weldon Avenue, Sunderland, SR2 9QB' },
    { id: 'goschen',  name: '30 Goschen Street',   address: '30 Goschen Street, Blyth, NE24 1NJ' },
    { id: 'chester',  name: '12 Chester Grove',    address: '12 Chester Grove, Blyth, NE24 5SH' },
    // A block: the same building name across many units, which MUST stay
    // usable as an identifier even though it repeats.
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `esp${i + 1}`, name: `Esplanade West Flat ${i + 1}`,
      address: `Flat ${i + 1}, 16 Esplanade West, Sunderland, SR2 7BG`,
    })),
  ]

  it('does not match a sold property onto a same-town, same-street-type house', () => {
    expect(match('62c Sunderland Road', PORTFOLIO_20).propertyId).toBeNull()
  })

  it('keeps a block name working as an identifier across its own units', () => {
    // "esplanade" spans 11 properties but only one building, so it is still
    // evidence — counting properties rather than buildings broke this.
    expect(match('16 Esplanade Flat 7', PORTFOLIO_20).propertyId).toBe('esp7')
    expect(match('16 Esplanade Flat 11', PORTFOLIO_20).propertyId).toBe('esp11')
  })

  it('leaves a whole-building label unmatched rather than picking a unit', () => {
    expect(match('16 ESPLANADE', PORTFOLIO_20).propertyId).toBeNull()
  })

  it('still tolerates a street typo in a portfolio large enough to filter', () => {
    expect(match('Henly Road', PORTFOLIO_20).propertyId).toBe('henley')
  })

  it('does not engage the filter on a small portfolio', () => {
    // Two buildings: one occurrence is already 50%, so discarding it would
    // throw away real evidence.
    expect(match('35 Henley Road').propertyId).toBe('p-henley')
  })
})

describe('matchProperties — house-number letter suffixes', () => {
  const A = { id: 'p-47a', name: '47A Somerset Street', address: '47A Somerset Street, Sunderland' }
  const B = { id: 'p-47b', name: '47B Somerset Street', address: '47B Somerset Street, Sunderland' }
  const pick = label => matchProperties([line(label)], [A, B, WATTS_18], [])[0]
  it('treats "47 B" and "47B" as the same unit and does not confuse it with 47A', () => {
    expect(normaliseStatementName('47 B, Somerset Street')).toBe('47b somerset street')
    const r = pick('47 B, Somerset Street')
    expect(r.matched).toBe(true); expect(r.propertyId).toBe('p-47b')
    expect(pick('47 A, Somerset Street').propertyId).toBe('p-47a')
  })
  it('still matches plain numbers and flat forms', () => {
    expect(pick('47B Somerset Street').propertyId).toBe('p-47b')
    expect(matchProperties([line('Flat 18 Watts Moses House')], [A, B, WATTS_18], [])[0].propertyId).toBe('p-w18')
  })
})
