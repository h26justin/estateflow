import { describe, it, expect } from 'vitest'
import { fetchAllPages, PAGE_SIZE } from '../paginate'

// Minimal stand-in for a PostgREST builder: records the ranges asked for and
// serves slices of a fixed dataset, truncating to the page size exactly as the
// server does.
function fakeTable(total, { pageCap = PAGE_SIZE } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const ranges = []
  const build = () => ({
    range: async (from, to) => {
      ranges.push([from, to])
      const wanted = Math.min(to - from + 1, pageCap)
      return { data: rows.slice(from, from + wanted), error: null }
    },
  })
  return { build, ranges, rows }
}

describe('fetchAllPages', () => {
  it('returns everything when the data exceeds one page', () => {
    // The exact shape of the importer bug: 4,361 rows behind a 1,000 cap. A
    // single unpaged request would have surfaced 1,000 and looked successful.
    const { build } = fakeTable(4361)
    return fetchAllPages(build).then(rows => {
      expect(rows).toHaveLength(4361)
      expect(new Set(rows.map(r => r.id)).size).toBe(4361)
    })
  })

  it('does not stop early when the total is an exact multiple of the page size', async () => {
    // The off-by-one trap: after a full final page there is no way to know the
    // data ended, so an extra empty page must be requested.
    const { build, ranges } = fakeTable(2000)
    expect(await fetchAllPages(build)).toHaveLength(2000)
    expect(ranges).toHaveLength(3)
  })

  it('makes exactly one request when everything fits in the first page', async () => {
    const { build, ranges } = fakeTable(12)
    expect(await fetchAllPages(build)).toHaveLength(12)
    expect(ranges).toEqual([[0, 999]])
  })

  it('handles an empty table', async () => {
    const { build } = fakeTable(0)
    expect(await fetchAllPages(build)).toEqual([])
  })

  it('requests a fresh builder per page, never reusing one', async () => {
    // PostgREST builders are single-use; reusing one silently re-serves page 1.
    let built = 0
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
    const build = () => {
      built++
      return { range: async (f, t) => ({ data: rows.slice(f, t + 1), error: null }) }
    }
    expect(await fetchAllPages(build)).toHaveLength(2500)
    expect(built).toBe(3)
  })

  it('propagates an error instead of returning a partial result', async () => {
    let n = 0
    const build = () => ({
      range: async () => (++n === 2
        ? { data: null, error: { message: 'boom' } }
        : { data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null }),
    })
    await expect(fetchAllPages(build)).rejects.toThrow('boom')
  })

  it('refuses to loop forever if the builder ignores range()', async () => {
    // Without this guard a builder that always returns a full page would spin.
    const build = () => ({ range: async () => ({ data: Array.from({ length: 10 }, () => ({})), error: null }) })
    await expect(fetchAllPages(build, { pageSize: 10, maxPages: 5 })).rejects.toThrow(/exceeded 5 pages/)
  })
})
