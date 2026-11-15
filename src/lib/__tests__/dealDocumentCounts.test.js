import { describe, it, expect, vi } from 'vitest'

// deal_documents mock that honours .range() like PostgREST with a 1,000-row cap.
const ROWS = []
const ranges = []
function chain() {
  const q = {}
  let from = 0, to = 999
  for (const m of ['select', 'order', 'eq', 'is']) q[m] = vi.fn(() => q)
  q.range = vi.fn((a, b) => { from = a; to = b; ranges.push([a, b]); return q })
  q.then = (res, rej) => Promise.resolve({ data: ROWS.slice(from, Math.min(to, from + 999) + 1), error: null }).then(res, rej)
  return q
}

vi.mock('../supabase', () => ({ supabase: { from: vi.fn(() => chain()) } }))

import { fetchDealDocumentCounts } from '../api/deals'

describe('fetchDealDocumentCounts', () => {
  it('counts rows past the 1,000-row cap (newest deals keep their badges)', async () => {
    for (let i = 0; i < 1_200; i++) ROWS.push({ deal_id: 'old', type: 'application/pdf', name: `d${i}.pdf`, file_path: `p/${i}.pdf` })
    ROWS.push({ deal_id: 'new', type: 'image/jpeg', name: 'front.jpg', file_path: 'p/front.jpg' })
    const out = await fetchDealDocumentCounts()
    expect(out.old.documents).toBe(1_200)
    expect(out.new).toEqual({ photos: 1, documents: 0, cover: 'p/front.jpg' })
    expect(ranges.length).toBeGreaterThan(1)
  })
})
