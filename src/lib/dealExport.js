// ── DEAL EXPORTS ─────────────────────────────────────────────────────────────
// One export model for the Deals downloads (Deals brief §10): a deal, a
// company or All Deals, as PDF (lib/dealExportPdf), a deals CSV and a cost
// lines CSV. Every figure comes from lib/dealFinance, the same service the
// Costs & funding tab and the company funding dashboard use, so an export
// never disagrees with the screen.
//
// Rules this file keeps:
//   - Company totals are companyFunding()'s results, unchanged. All Deals
//     totals add those per-company results (cash is counted once per company,
//     so the gap is summed per company, never cash pooled across companies).
//   - Fallen-through, deleted and completed deals are listed when the filters
//     include them, but never counted in funding totals (isLiveDeal).
//   - Deals with no company are kept, in their own "Unassigned" group.
//   - Contacts are never included: deal rows are built from a whitelist, and
//     cost-line / funding notes (free text that can hold a name or a phone
//     number) are left out.
//
// Pure: no React, no DB, no DOM.

import {
  refurbPosition, dealCashNeed, companyFunding, isLiveDeal,
  latestCashPosition, dealDueDate, costCategoryGroup,
  COST_CATEGORY_LABEL, COST_STATE_LABEL, FUNDING_SOURCE_LABEL, FUNDING_STATE_LABEL,
  dateGB,
} from './dealFinance'
import { computeDealMetrics } from './dealMetrics'
import { DEAL_STATUS_LABEL, ATTENTION_CFG, isPostCompletion } from './dealStages'

// ── helpers ─────────────────────────────────────────────────────────────────
const pence = v => Math.round((Number(v) || 0) * 100)
const sumMoney = values => values.reduce((s, v) => s + pence(v), 0) / 100

const BASIS_LABEL = { lines: 'Itemised cost lines', estimate: 'Estimate from deal fields' }
const REFURB_BASIS_LABEL = { lines: 'Itemised cost lines', estimate: 'Estimate from deal refurb cost', none: 'Not entered' }
const GROUP_LABEL = { completion: 'Completion', credit: 'Credit (deducted)', refurb: 'Refurb (separate)', other: 'Not counted' }

/** Normalise asOf (Date, ISO string or nothing) to { iso, date, label }. */
export function normaliseAsOf(asOf) {
  const d = asOf instanceof Date ? asOf : asOf ? new Date(asOf) : new Date()
  const valid = !Number.isNaN(d.getTime())
  const when = valid ? d : new Date()
  // A bare ISO date (2026-11-19) means that day; anything else is a moment.
  const dateOnly = typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
  const date = dateOnly ? asOf : localISODate(when)
  const label = dateOnly ? dateGB(asOf)
    : when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  return { iso: dateOnly ? asOf : when.toISOString(), date, label }
}

// Calendar date in London, so a late-evening export is not dated tomorrow (UTC).
function localISODate(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = t => parts.find(p => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Describe the filters in words.
 * filters: { companyId: 'all' | '' (unassigned) | id, status: 'all' | key, search: string, scope: 'all'|'company'|'deal' }
 */
export function describeFilters(filters = {}, companies = []) {
  const f = filters || {}
  const labels = []
  const companyId = f.companyId == null ? 'all' : f.companyId
  if (companyId === 'all') labels.push('Company: All companies')
  else if (companyId === '') labels.push('Company: Unassigned')
  else labels.push(`Company: ${(companies || []).find(c => c.id === companyId)?.name || 'Unknown company'}`)
  const status = f.status || 'all'
  labels.push(`Stage: ${status === 'all' ? 'All stages' : (DEAL_STATUS_LABEL[status] || status)}`)
  if (f.search && String(f.search).trim()) labels.push(`Search: "${String(f.search).trim()}"`)
  if (f.dealId) labels.push('Single deal')
  return labels
}

function excludedReason(d) {
  if (d.deleted_at) return 'Deleted'
  if (d.status === 'dead') return 'Fallen through'
  if (isPostCompletion(d.status)) return 'Completed'
  return null
}

// Cost lines and funding rows, whitelisted. Notes are left out on purpose.
function safeLine(l) {
  return {
    id: l.id || null,
    category: l.category || null,
    categoryLabel: COST_CATEGORY_LABEL[l.category] || l.category || '',
    group: costCategoryGroup(l.category),
    label: l.label || '',
    amount: l.amount == null || l.amount === '' ? null : Number(l.amount),
    state: l.state || null,
    stateLabel: COST_STATE_LABEL[l.state] || l.state || '',
    dueDate: l.due_date || null,
    vatIncluded: l.vat_included == null ? null : !!l.vat_included,
    source: l.source || '',
  }
}
function safeFunding(f) {
  return {
    id: f.id || null,
    source: f.source || null,
    sourceLabel: FUNDING_SOURCE_LABEL[f.source] || f.source || '',
    label: f.label || '',
    amount: f.amount == null || f.amount === '' ? null : Number(f.amount),
    state: f.state || null,
    stateLabel: FUNDING_STATE_LABEL[f.state] || f.state || '',
    expectedDate: f.expected_date || null,
    deducted: f.source !== 'company_cash' && (f.state === 'confirmed' || f.state === 'received'),
  }
}

/**
 * One deal's export row. Built only from the fields listed here; the deal
 * record itself is never copied in, so contact and solicitor fields cannot
 * leak through.
 */
export function buildDealRow(deal = {}, { lines = [], funding = [], companyName = 'Unassigned' } = {}) {
  const cn = dealCashNeed(deal, lines, funding)
  const p = cn.position
  const r = refurbPosition(deal, lines)
  const m = computeDealMetrics(deal)
  const excluded = excludedReason(deal)
  const due = dealDueDate(deal)
  const missing = [...p.missing]
  if (!due) missing.push('No expected or target completion date')
  if (r.amount == null && !excluded) missing.push(...r.missing)
  if (p.basis === 'estimate' && p.total != null) missing.push('Figures are an estimate until the completion statement is entered')
  const estimateComponents = p.basis === 'estimate' ? p.components.filter(c => !c.credit) : []
  return {
    id: deal.id || null,
    name: deal.name || deal.address || 'Untitled deal',
    address: deal.address && deal.address !== deal.name ? deal.address : '',
    companyId: deal.company_id || null,
    company: companyName,
    status: deal.status || null,
    stage: DEAL_STATUS_LABEL[deal.status] || deal.status || '',
    attention: ATTENTION_CFG[deal.attention_status]?.label || '',
    nextAction: (deal.next_action || '').trim(),
    nextActionOwner: (deal.next_action_owner || '').trim(),
    nextActionDue: deal.next_action_due || null,
    price: m.price > 0 ? m.price : null,
    completionTotal: p.total,
    credits: p.credits,
    balanceDue: p.balanceDue,
    basis: p.basis,
    basisLabel: BASIS_LABEL[p.basis] || p.basis,
    state: p.state,
    stateLabel: COST_STATE_LABEL[p.state] || p.state || '',
    financingConfirmed: cn.financingConfirmed,
    financingExpected: cn.financingExpected,
    cashNeed: cn.need,
    refurbForecast: r.amount,
    refurbBasis: r.basis,
    refurbBasisLabel: REFURB_BASIS_LABEL[r.basis] || r.basis,
    expectedCompletion: due,
    countsInFunding: isLiveDeal(deal),
    excludedReason: excluded,
    groupPurchase: !!deal.parent_deal_id,
    missing,
    components: p.components.map(c => ({ key: c.key, label: c.label, amount: c.amount, state: c.state, credit: !!c.credit })),
    estimateComponents: estimateComponents.map(c => ({ key: c.key, label: c.label, amount: c.amount })),
    refurbEstimate: r.basis === 'estimate' ? r.amount : null,
    lines: (lines || []).map(safeLine),
    funding: (funding || []).map(safeFunding),
  }
}

const byDueThenName = (a, b) => {
  const da = a.expectedCompletion || '9999', db = b.expectedCompletion || '9999'
  return da < db ? -1 : da > db ? 1 : String(a.name).localeCompare(String(b.name))
}

function groupTotals(rows, funding, cash) {
  const live = rows.filter(r => r.countsInFunding)
  const known = live.filter(r => r.balanceDue != null)
  return {
    deals: rows.length,
    liveDeals: live.length,
    excludedDeals: rows.length - live.length,
    price: sumMoney(live.filter(r => r.price != null).map(r => r.price)),
    balanceDue: sumMoney(known.map(r => r.balanceDue)),
    financingConfirmed: sumMoney(live.map(r => r.financingConfirmed)),
    financingExpected: sumMoney(live.map(r => r.financingExpected)),
    // From companyFunding, unchanged.
    cashNeed: funding.needInWindow,
    unknownCount: funding.unknownCount,
    estimateCount: funding.estimateCount,
    refurbForecast: funding.refurbForecast,
    cash: cash ? cash.amount : null,
    cashAsOf: cash ? cash.asOf : null,
    fundingGap: funding.fundingGap,
    combinedGap: funding.combinedGap,
  }
}

const METHODOLOGY = [
  'Every figure in this export comes from the same calculation the app uses on the Costs & funding tab and the company funding cards. Nothing is re-keyed.',
  'Completion total: the itemised completion costs (purchase price, stamp duty, legal fee and VAT, disbursements, Land Registry, searches, survey, broker, auction fees, indemnity and other purchase costs) added together. Where no completion statement has been entered, it is estimated from the deal\'s own fields (price, stamp duty, legal fees, survey, broker, auction and other costs) and marked as an estimate.',
  'Credits: money already paid on account or as a deposit. Balance due at completion = completion total - credits.',
  'Cash needed from the company = the larger of £0 and (balance due - confirmed or received financing). Company cash is not financing. Expected financing is listed but not deducted until it is confirmed.',
  'Cash available: the latest cash position recorded for each company, counted once per company and never per deal. If none is recorded it is taken as £0.',
  'Funding gap = the larger of £0 and (cash needed across the company\'s live deals - cash available). For All Deals the gap is the sum of each company\'s gap, because one company\'s cash cannot fund another company\'s purchase.',
  'Refurb forecast is shown separately from completion: refurb and contingency lines, or the deal\'s refurb cost as an estimate. "With refurb" adds it to the cash need before deducting cash.',
  'Live deals only count towards funding: fallen-through, deleted and completed deals are listed when the filters include them but are not added to any total.',
  'A total is only as firm as its weakest line: if any line is an estimate, the total is shown as an estimate.',
  'Unknown is not zero: a deal with no price and no completion statement has an unknown cash need. It is counted as unknown and left out of the sums rather than shown as £0.',
  'Weekly schedule: deals are grouped by the Monday of the week of their expected (or else target) completion date. Deals with no date are listed as Unscheduled.',
  'Amounts are added in pence to avoid rounding drift. Contacts, solicitor details and free-text notes are not included in this export.',
]

/**
 * Build the export model.
 * @param {object}   o
 * @param {object[]} o.deals          the deals to export (already filtered)
 * @param {object[]} o.companies      company rows ({ id, name, abbr, color })
 * @param {object}   o.linesByDeal    { [dealId]: cost lines }
 * @param {object}   o.fundingByDeal  { [dealId]: funding rows }
 * @param {object}   o.cashByCompany  { [companyId]: latest cash row, or the history array }
 * @param {Date|string} [o.asOf]      defaults to now
 * @param {object}   [o.filters]      { companyId, status, search, to }
 */
export function buildDealExportModel({ deals = [], companies = [], linesByDeal = {}, fundingByDeal = {}, cashByCompany = {}, asOf, filters = {} } = {}) {
  const when = normaliseAsOf(asOf)
  const companyList = companies || []
  const known = new Set(companyList.map(c => c.id))
  const lines = linesByDeal || {}, fundingMap = fundingByDeal || {}
  const windowTo = filters?.to || null

  function buildGroup(company, gDeals, cashRow) {
    const rows = gDeals.map(d => buildDealRow(d, { lines: lines[d.id] || [], funding: fundingMap[d.id] || [], companyName: company.name }))
      .sort(byDueThenName)
    const funding = companyFunding({ deals: gDeals, linesByDeal: lines, fundingByDeal: fundingMap, cashPosition: cashRow, from: when.date, to: windowTo })
    return { company, deals: rows, totals: groupTotals(rows, funding, funding.cash), funding }
  }
  const cashFor = id => {
    const v = (cashByCompany || {})[id]
    return Array.isArray(v) ? latestCashPosition(v) : (v || null)
  }

  const groups = []
  for (const c of companyList) {
    const gDeals = (deals || []).filter(d => d.company_id === c.id)
    if (!gDeals.length) continue
    groups.push(buildGroup({ id: c.id, name: c.name || 'Company', abbr: c.abbr || null, color: c.color || null }, gDeals, cashFor(c.id)))
  }
  const orphans = (deals || []).filter(d => !d.company_id || !known.has(d.company_id))
  const unassigned = orphans.length ? buildGroup({ id: null, name: 'Unassigned', abbr: 'Unassigned', color: null, unassigned: true }, orphans, null) : null

  const all = unassigned ? [...groups, unassigned] : groups
  const t = all.map(g => g.totals)
  const totals = {
    deals: t.reduce((s, x) => s + x.deals, 0),
    liveDeals: t.reduce((s, x) => s + x.liveDeals, 0),
    excludedDeals: t.reduce((s, x) => s + x.excludedDeals, 0),
    price: sumMoney(t.map(x => x.price)),
    balanceDue: sumMoney(t.map(x => x.balanceDue)),
    financingConfirmed: sumMoney(t.map(x => x.financingConfirmed)),
    financingExpected: sumMoney(t.map(x => x.financingExpected)),
    cashNeed: sumMoney(t.map(x => x.cashNeed)),
    unknownCount: t.reduce((s, x) => s + x.unknownCount, 0),
    estimateCount: t.reduce((s, x) => s + x.estimateCount, 0),
    refurbForecast: sumMoney(t.map(x => x.refurbForecast)),
    cash: sumMoney(t.map(x => x.cash || 0)),
    fundingGap: sumMoney(t.map(x => x.fundingGap)),
    combinedGap: sumMoney(t.map(x => x.combinedGap)),
  }

  // Data quality: what a reader should know before relying on the numbers.
  const dataQuality = []
  for (const g of all) {
    if (!g.company.unassigned && !g.funding.cash && g.totals.liveDeals) dataQuality.push(`${g.company.name}: no cash position recorded, so cash available is taken as £0.`)
    for (const r of g.deals) {
      if (r.countsInFunding && r.missing.length) dataQuality.push(`${r.name} (${g.company.name}): ${r.missing.join('; ')}.`)
      if (r.groupPurchase) dataQuality.push(`${r.name} (${g.company.name}): part of a group purchase. Check its costs are not also entered on the parent deal.`)
    }
  }
  if (unassigned) {
    const strays = orphans.filter(d => d.company_id && !known.has(d.company_id)).length
    dataQuality.push(`${unassigned.deals.length} deal${unassigned.deals.length === 1 ? ' has' : 's have'} no company${strays ? ` (${strays} linked to a company you cannot see)` : ''}; ${unassigned.deals.length === 1 ? 'it is' : 'they are'} shown under Unassigned with no cash available.`)
  }
  if (totals.excludedDeals) dataQuality.push(`${totals.excludedDeals} deal${totals.excludedDeals === 1 ? ' is' : 's are'} fallen through, deleted or completed: listed for reference, not counted in funding totals.`)
  if (!dataQuality.length) dataQuality.push('No gaps found: every live deal has a price or completion statement, a completion date and a refurb forecast.')

  const filterLabels = describeFilters(filters, companyList)
  return {
    asOf: when.iso,
    asOfDate: when.date,
    asOfLabel: when.label,
    filters: { ...(filters || {}), labels: filterLabels, text: filterLabels.join(' · ') },
    companies: groups,
    unassigned,
    totals,
    methodology: [...METHODOLOGY],
    dataQuality,
  }
}

/** Every group in the model, Unassigned last. */
export const modelGroups = model => model.unassigned ? [...model.companies, model.unassigned] : [...model.companies]

// ── CSV ─────────────────────────────────────────────────────────────────────
// csv.js has no comment-row convention (every row is data, every cell quoted),
// so the as-of date goes in the filename and in an as_of column instead.
const money = v => (v == null || !Number.isFinite(Number(v)) ? '' : (Math.round(Number(v) * 100) / 100).toFixed(2))
const yesNo = v => (v == null ? '' : v ? 'yes' : 'no')

export const DEALS_CSV_HEADERS = [
  'as_of', 'filters', 'company', 'deal', 'address', 'stage', 'attention', 'next_action', 'next_action_owner', 'next_action_due',
  'purchase_price_gbp', 'completion_total_gbp', 'credits_gbp', 'balance_due_gbp', 'basis', 'state',
  'financing_confirmed_gbp', 'financing_expected_gbp', 'cash_need_gbp', 'refurb_forecast_gbp', 'refurb_basis',
  'expected_completion', 'counts_in_funding', 'excluded_reason', 'missing_data',
]

/** One row per deal, header first. GBP as plain numbers, ISO dates. */
export function dealsToCsv(model) {
  const out = [DEALS_CSV_HEADERS]
  for (const g of modelGroups(model)) {
    for (const r of g.deals) {
      out.push([
        model.asOf, model.filters.text, g.company.name, r.name, r.address, r.stage, r.attention, r.nextAction, r.nextActionOwner, r.nextActionDue || '',
        money(r.price), money(r.completionTotal), money(r.credits), money(r.balanceDue), r.basisLabel, r.stateLabel,
        money(r.financingConfirmed), money(r.financingExpected), money(r.cashNeed), money(r.refurbForecast), r.refurbBasisLabel,
        r.expectedCompletion || '', yesNo(r.countsInFunding), r.excludedReason || '', r.missing.join('; '),
      ])
    }
  }
  return out
}

export const COST_LINES_CSV_HEADERS = [
  'as_of', 'company', 'deal', 'record_type', 'category', 'counts_towards', 'label', 'amount_gbp', 'state',
  'due_date', 'vat_included', 'source', 'deducted_from_cash_need', 'deal_counts_in_funding',
]

/**
 * Every itemised cost line and funding row, with deal and company, so each
 * total can be rebuilt. A deal with no completion statement gets its
 * estimate components (from the deal's own fields) as rows instead, marked
 * as such, because those are what its total is made of.
 */
export function costLinesToCsv(model) {
  const out = [COST_LINES_CSV_HEADERS]
  for (const g of modelGroups(model)) {
    for (const r of g.deals) {
      const base = [model.asOf, g.company.name, r.name]
      const live = yesNo(r.countsInFunding)
      for (const l of r.lines) {
        out.push([...base, 'Cost line', l.categoryLabel, GROUP_LABEL[l.group] || l.group, l.label, money(l.amount), l.stateLabel,
          l.dueDate || '', yesNo(l.vatIncluded), l.source, '', live])
      }
      for (const c of r.estimateComponents) {
        out.push([...base, 'Estimate from deal fields', c.label, GROUP_LABEL.completion, '', money(c.amount), COST_STATE_LABEL.estimate,
          '', '', 'Deal analysis', '', live])
      }
      if (r.refurbEstimate != null) {
        out.push([...base, 'Estimate from deal fields', 'Refurb cost', GROUP_LABEL.refurb, '', money(r.refurbEstimate), COST_STATE_LABEL.estimate,
          '', '', 'Deal analysis', '', live])
      }
      for (const f of r.funding) {
        out.push([...base, 'Funding', f.sourceLabel, 'Financing', f.label, money(f.amount), f.stateLabel,
          f.expectedDate || '', '', '', yesNo(f.deducted), live])
      }
    }
  }
  return out
}

/** File name for an export: deals-<scope>-<as-of date>.<ext>. */
export function exportFileName(model, kind, ext) {
  const scope = model.filters?.dealId ? (modelGroups(model)[0]?.deals[0]?.name || 'deal')
    : model.filters?.companyId == null || model.filters.companyId === 'all' ? 'all-deals'
      : model.filters.companyId === '' ? 'unassigned'
        : (model.companies[0]?.company.name || 'company')
  const slug = String(scope).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'deals'
  const status = model.filters?.status && model.filters.status !== 'all' ? `-${model.filters.status}` : ''
  return `${kind}-${slug}${status}-${model.asOfDate}.${ext}`
}
