import { describe, it, expect } from 'vitest'
import { extractStoragePaths, dealDocToPropertyCategory } from '../attachments'

describe('extractStoragePaths', () => {
  it('reads one path per row for file_path tables and skips blanks', () => {
    const rows = [
      { file_path: 'u1/deals/d1/a.pdf' },
      { file_path: '' },
      { file_path: null },
      { file_path: '  u1/deals/d1/b.png  ' },
      { url: 'https://legacy.example/public.png' }, // legacy public-URL-only row
    ]
    expect(extractStoragePaths(rows, 'file_path')).toEqual(['u1/deals/d1/a.pdf', 'u1/deals/d1/b.png'])
  })

  it('flattens JSONB photo arrays, accepting objects and bare strings', () => {
    const rows = [
      { photos: [{ path: 'u1/inspections/p1/1.jpg', url: 'x' }, { url: 'legacy-only' }, 'u1/inspections/p1/2.jpg'] },
      { photos: null },
      { photos: 'not-an-array' },
      { photos: [] },
    ]
    expect(extractStoragePaths(rows, 'photos')).toEqual(['u1/inspections/p1/1.jpg', 'u1/inspections/p1/2.jpg'])
  })

  it('de-duplicates and tolerates empty input', () => {
    expect(extractStoragePaths([{ file_path: 'a' }, { file_path: 'a' }], 'file_path')).toEqual(['a'])
    expect(extractStoragePaths(null, 'file_path')).toEqual([])
    expect(extractStoragePaths(undefined, 'photos')).toEqual([])
  })
})

describe('dealDocToPropertyCategory', () => {
  it('maps common deal paperwork onto property document categories', () => {
    expect(dealDocToPropertyCategory({ name: 'Mortgage offer - Barclays.pdf' })).toBe('mortgage')
    expect(dealDocToPropertyCategory({ name: 'Decision in principle.pdf' })).toBe('mortgage')
    expect(dealDocToPropertyCategory({ name: 'EPC certificate.pdf' })).toBe('epc')
    expect(dealDocToPropertyCategory({ name: 'EICR 2026.pdf' })).toBe('eicr')
    expect(dealDocToPropertyCategory({ name: 'Gas safety record.pdf' })).toBe('gas')
    expect(dealDocToPropertyCategory({ name: 'Buildings insurance schedule.pdf' })).toBe('insurance')
    expect(dealDocToPropertyCategory({ name: 'Legal pack.pdf' })).toBe('legal')
    expect(dealDocToPropertyCategory({ name: 'TR1 signed.pdf' })).toBe('legal')
    expect(dealDocToPropertyCategory({ name: 'Completion statement.pdf' })).toBe('legal')
    expect(dealDocToPropertyCategory({ name: 'AST draft.docx' })).toBe('tenancy')
  })

  it('prefers the caption over the file name and falls back to other', () => {
    expect(dealDocToPropertyCategory({ name: 'scan001.pdf', caption: 'Mortgage offer' })).toBe('mortgage')
    expect(dealDocToPropertyCategory({ name: 'Survey report.pdf' })).toBe('other')
    expect(dealDocToPropertyCategory({})).toBe('other')
    expect(dealDocToPropertyCategory(null)).toBe('other')
  })
})
