import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../complianceStatus', () => ({
  propertyComplianceSummary: vi.fn(() => ({ rows: [], total: 0, held: 0, expired: 0, expiring: 0, missing: 0, off: 0 })),
}))

import { propertyComplianceSummary } from '../complianceStatus'
import useComplianceSummaries from '../useComplianceSummaries'
import { portfolioHealthFor } from '../dashboardKpis'

beforeEach(() => propertyComplianceSummary.mockClear())

describe('useComplianceSummaries', () => {
  const props = [{ id: 'a', company_id: 'c', status: 'rented' }, { id: 'b', company_id: 'c', status: 'sold' }]
  const settings = { c: {} }
  const policies = []

  it('computes each tracked summary once and keeps it across re-renders', () => {
    const { result, rerender } = renderHook(({ p, s, pol }) => useComplianceSummaries(p, s, pol),
      { initialProps: { p: props, s: settings, pol: policies } })
    expect(propertyComplianceSummary).toHaveBeenCalledTimes(1) // sold skipped
    const first = result.current
    rerender({ p: props, s: settings, pol: policies })
    expect(result.current).toBe(first)
    expect(propertyComplianceSummary).toHaveBeenCalledTimes(1)

    // The health ring reuses it: no second rollup.
    portfolioHealthFor(props, { summaries: result.current })
    expect(propertyComplianceSummary).toHaveBeenCalledTimes(1)
  })

  it('recomputes when an input changes', () => {
    const { rerender } = renderHook(({ p, s, pol }) => useComplianceSummaries(p, s, pol),
      { initialProps: { p: props, s: settings, pol: policies } })
    rerender({ p: props, s: settings, pol: [{ id: 'pol1' }] })
    expect(propertyComplianceSummary).toHaveBeenCalledTimes(2)
  })
})
