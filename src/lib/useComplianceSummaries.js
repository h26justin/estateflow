// useComplianceSummaries — the dashboard's per-property compliance rollup,
// computed once per change of its inputs rather than once per consumer per
// render. The health ring and the Portfolio Compliance KPI card both read
// this Map, so they always agree and the rollup (every requirement for every
// property) isn't repeated on unrelated re-renders.
import { useMemo } from 'react'
import { complianceSummariesFor } from './dashboardKpis'

export default function useComplianceSummaries(props, companySettings, policies) {
  return useMemo(
    () => complianceSummariesFor(props, companySettings, policies),
    [props, companySettings, policies],
  )
}
