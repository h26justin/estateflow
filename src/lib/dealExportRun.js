// Runs a Deals export from the UI: loads cost lines, funding and company cash
// once for the deals being exported, builds the model (lib/dealExport) and
// downloads it. CSVs go through lib/csv's downloadCsv; the PDF module is
// imported on demand so it and jsPDF stay out of the Deals page chunk.

import * as api from './api'
import { downloadCsv } from './csv'
import { buildDealExportModel, dealsToCsv, costLinesToCsv, exportFileName } from './dealExport'

export const EXPORT_KINDS = Object.freeze({ pdf: 'pdf', csv: 'csv', lines: 'lines' })

/** Fetch what the model needs for these deals. Cash is the history; the model takes the latest. */
export async function loadDealExportInputs(deals = []) {
  const ids = [...new Set((deals || []).map(d => d.id).filter(Boolean))]
  const companyIds = [...new Set((deals || []).map(d => d.company_id).filter(Boolean))]
  const [linesByDeal, fundingByDeal, cashRows] = await Promise.all([
    ids.length ? api.fetchCostLinesForDeals(ids) : {},
    ids.length ? api.fetchFundingForDeals(ids) : {},
    companyIds.length ? api.fetchCompanyCashPositions(companyIds) : [],
  ])
  const cashByCompany = {}
  for (const r of cashRows || []) (cashByCompany[r.company_id] || (cashByCompany[r.company_id] = [])).push(r)
  return { linesByDeal, fundingByDeal, cashByCompany }
}

/**
 * @param {'pdf'|'csv'|'lines'} kind
 * @param {object} o  { deals, companies, filters, title, inputs? }
 *   inputs: { linesByDeal, fundingByDeal, cashByCompany } already loaded.
 * Returns { kind, deals, pages? }.
 */
export async function runDealExport(kind, { deals = [], companies = [], filters = {}, title, inputs } = {}) {
  const data = inputs || await loadDealExportInputs(deals)
  const model = buildDealExportModel({ deals, companies, ...data, asOf: new Date(), filters })
  if (kind === EXPORT_KINDS.pdf) {
    const { exportDealsPdf } = await import('./dealExportPdf')
    const res = await exportDealsPdf(model, { title })
    return { kind, deals: model.totals.deals, pages: res.pages }
  }
  if (kind === EXPORT_KINDS.lines) {
    downloadCsv(exportFileName(model, 'deal-cost-lines', 'csv'), costLinesToCsv(model))
  } else {
    downloadCsv(exportFileName(model, 'deals', 'csv'), dealsToCsv(model))
  }
  return { kind, deals: model.totals.deals }
}
