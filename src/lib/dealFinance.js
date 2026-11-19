// ── DEAL FINANCE ─────────────────────────────────────────────────────────────
// Cash each completion needs, by when, and the funding gap per company
// (Deals brief §6; money rules in the header of
// supabase-migrations/2026-11-19_deal_costs_funding_cash.sql).
//
//   balance due     = completion costs − credits (on account, deposit paid)
//   deal cash need  = balance due − confirmed financing (not company cash)
//   funding gap     = max(0, cash need in the window − company cash)
//
// Rules this file keeps:
//   - Itemised deal_cost_lines win. Without them the flat deal fields are an
//     estimate (computeDealMetrics), labelled as such.
//   - Unknown is not zero: a deal with no price and no lines has a balance
//     due of null and a reason, never £0.
//   - Every amount carries a state; a total is only as firm as its weakest
//     line, so an estimate is never shown as confirmed.
//   - Expected financing is listed, never deducted.
//   - Company cash is counted once per company (latest position), not per deal.
//   - Refurb is forecast separately from completion.
//
// Pure: no React, no DB. Amounts are summed in pence to avoid float drift.

import { computeDealMetrics, num } from './dealMetrics'
import { isPostCompletion } from './dealStages'

export const COST_CATEGORIES = Object.freeze([
  { key: 'purchase_price', label: 'Purchase price',          group: 'completion' },
  { key: 'sdlt',           label: 'Stamp duty (SDLT)',       group: 'completion' },
  { key: 'legal_fee',      label: 'Legal fee',               group: 'completion' },
  { key: 'legal_vat',      label: 'VAT on legal fee',        group: 'completion' },
  { key: 'disbursements',  label: 'Disbursements',           group: 'completion' },
  { key: 'land_registry',  label: 'Land Registry fee',       group: 'completion' },
  { key: 'searches',       label: 'Searches',                group: 'completion' },
  { key: 'survey',         label: 'Survey',                  group: 'completion' },
  { key: 'broker',         label: 'Broker fee',              group: 'completion' },
  { key: 'auction',        label: 'Auction fees',            group: 'completion' },
  { key: 'indemnity',      label: 'Indemnity policy',        group: 'completion' },
  { key: 'other_purchase', label: 'Other purchase cost',     group: 'completion' },
  { key: 'on_account',     label: 'Paid on account',         group: 'credit' },
  { key: 'deposit_paid',   label: 'Deposit already paid',    group: 'credit' },
  { key: 'refurb',         label: 'Refurbishment',           group: 'refurb' },
  { key: 'contingency',    label: 'Refurb contingency',      group: 'refurb' },
  { key: 'other',          label: 'Other (not completion)',  group: 'other' },
])
export const COST_CATEGORY_LABEL = Object.freeze(Object.fromEntries(COST_CATEGORIES.map(c => [c.key, c.label])))
const CATEGORY_GROUP = Object.fromEntries(COST_CATEGORIES.map(c => [c.key, c.group]))
export const costCategoryGroup = key => CATEGORY_GROUP[key] || 'other'

export const COST_STATES = Object.freeze([
  { key: 'estimate',  label: 'Estimate' },
  { key: 'quoted',    label: 'Quoted' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'paid',      label: 'Paid' },
  { key: 'actual',    label: 'Actual' },
])
export const COST_STATE_LABEL = Object.freeze(Object.fromEntries(COST_STATES.map(s => [s.key, s.label])))
const STATE_RANK = { estimate: 0, quoted: 1, confirmed: 2, paid: 3, actual: 3 }

export const FUNDING_SOURCES = Object.freeze([
  { key: 'mortgage',     label: 'Mortgage' },
  { key: 'bridge',       label: 'Bridging loan' },
  { key: 'loan',         label: 'Loan' },
  { key: 'investor',     label: 'Investor' },
  { key: 'company_cash', label: 'Company cash' },
  { key: 'other',        label: 'Other' },
])
export const FUNDING_SOURCE_LABEL = Object.freeze(Object.fromEntries(FUNDING_SOURCES.map(s => [s.key, s.label])))
export const FUNDING_STATES = Object.freeze([
  { key: 'expected',  label: 'Expected' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'received',  label: 'Received' },
])
export const FUNDING_STATE_LABEL = Object.freeze(Object.fromEntries(FUNDING_STATES.map(s => [s.key, s.label])))

// ── helpers ─────────────────────────────────────────────────────────────────
const pence = v => Math.round(num(v) * 100)
const fromPence = p => p / 100
function sum(values) { return fromPence(values.reduce((s, v) => s + pence(v), 0)) }

/** £1,234 or £1,234.56: whole pounds without pence, otherwise 2dp. en-GB. */
export function gbp(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const whole = Math.abs(v * 100 - Math.round(v) * 100) < 0.5
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(v)
}

/** 18 Nov 2026 from an ISO date, en-GB, without timezone drift. */
export function dateGB(iso) {
  if (!iso) return '—'
  const t = parseISODate(iso)
  if (t == null) return '—'
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}
const toISO = t => new Date(t).toISOString().slice(0, 10)
const DAY = 86400000

/** ISO date of the Monday starting the week that contains `iso`. */
export function weekStart(iso) {
  const t = parseISODate(iso)
  if (t == null) return null
  const dow = new Date(t).getUTCDay() // 0 Sun … 6 Sat
  return toISO(t - ((dow + 6) % 7) * DAY)
}
export const addDays = (iso, n) => { const t = parseISODate(iso); return t == null ? null : toISO(t + n * DAY) }

/** Weakest state among the lines (estimate < quoted < confirmed < paid/actual). */
export function weakestState(lines) {
  let best = null
  for (const l of lines || []) {
    const s = STATE_RANK[l.state] == null ? 'estimate' : l.state
    if (best == null || STATE_RANK[s] < STATE_RANK[best]) best = s
  }
  return best
}

function componentsByCategory(lines) {
  const map = new Map()
  for (const l of lines) {
    const c = map.get(l.category) || { key: l.category, label: COST_CATEGORY_LABEL[l.category] || l.category, lines: [] }
    c.lines.push(l)
    map.set(l.category, c)
  }
  return [...map.values()].map(c => ({
    key: c.key, label: c.label, amount: sum(c.lines.map(l => l.amount)),
    state: weakestState(c.lines), count: c.lines.length,
  }))
}

// ── completion ──────────────────────────────────────────────────────────────
/**
 * Balance due at completion for one deal.
 * Returns { total, credits, balanceDue, basis: 'lines'|'estimate', state,
 *           components:[{key,label,amount,state,count,credit?}], missing:[...] }
 */
export function completionPosition(deal = {}, lines = []) {
  const all = Array.isArray(lines) ? lines : []
  const completionLines = all.filter(l => costCategoryGroup(l.category) === 'completion')
  const creditLines = all.filter(l => costCategoryGroup(l.category) === 'credit')
  const credits = sum(creditLines.map(l => l.amount))
  const creditComponents = componentsByCategory(creditLines).map(c => ({ ...c, credit: true }))

  if (completionLines.length) {
    const total = sum(completionLines.map(l => l.amount))
    return {
      total, credits, balanceDue: fromPence(pence(total) - pence(credits)),
      basis: 'lines',
      state: weakestState([...completionLines, ...creditLines]),
      components: [...componentsByCategory(completionLines), ...creditComponents],
      missing: [],
    }
  }

  // No completion statement: estimate from the deal's flat fields. Refurb,
  // the mortgage arrangement fee and the deposit split are left out: this is
  // what has to reach the solicitor, not the whole deal cost.
  const missing = ['No completion statement entered']
  const m = computeDealMetrics(deal)
  if (!(m.price > 0)) {
    missing.push('Purchase price not entered')
    return { total: null, credits, balanceDue: null, basis: 'estimate', state: 'estimate', components: creditComponents, missing }
  }
  const parts = [
    ['purchase_price', 'Purchase price', m.price],
    ['sdlt', 'Stamp duty (SDLT)', m.sd],
    ['legal_fee', 'Legal fees', num(deal.legal_fees)],
    ['survey', 'Survey', num(deal.survey_cost)],
    ['broker', 'Broker fee', num(deal.broker_fee)],
    ['auction', 'Auction fees', num(deal.auction_fees)],
    ['other_purchase', 'Other costs', num(deal.other_costs)],
  ]
  if (!(num(deal.legal_fees) > 0)) missing.push('Legal fees not entered')
  const components = parts.filter(([key, , v]) => v > 0 || key === 'purchase_price' || key === 'sdlt')
    .map(([key, label, amount]) => ({ key, label, amount: sum([amount]), state: 'estimate', count: 0 }))
  const total = sum(components.map(c => c.amount))
  return {
    total, credits, balanceDue: fromPence(pence(total) - pence(credits)),
    basis: 'estimate', state: 'estimate',
    components: [...components, ...creditComponents],
    missing,
  }
}

/**
 * Refurb forecast, kept apart from completion: refurb + contingency lines,
 * else the deal's refurb_cost as an estimate. amount is null when neither
 * is entered.
 */
export function refurbPosition(deal = {}, lines = []) {
  const refurbLines = (lines || []).filter(l => costCategoryGroup(l.category) === 'refurb')
  if (refurbLines.length) {
    return {
      amount: sum(refurbLines.map(l => l.amount)), basis: 'lines',
      state: weakestState(refurbLines), components: componentsByCategory(refurbLines), missing: [],
    }
  }
  const flat = num(deal.refurb_cost)
  if (flat > 0) {
    return {
      amount: sum([flat]), basis: 'estimate', state: 'estimate',
      components: [{ key: 'refurb', label: 'Refurb cost (deal estimate)', amount: sum([flat]), state: 'estimate', count: 0 }],
      missing: [],
    }
  }
  return { amount: null, basis: 'none', state: null, components: [], missing: ['No refurb forecast entered'] }
}

/** Expected or target completion date, else null (Unscheduled). */
export const dealDueDate = deal => deal?.expected_completion_date || deal?.target_completion_date || null

/**
 * Cash the company must find for this completion.
 * need = max(0, balance due − confirmed/received financing other than
 * company cash). Expected financing is reported, not deducted.
 */
export function dealCashNeed(deal = {}, lines = [], funding = []) {
  const position = completionPosition(deal, lines)
  const external = (funding || []).filter(f => f.source !== 'company_cash')
  const confirmedRows = external.filter(f => f.state === 'confirmed' || f.state === 'received')
  const expectedRows = external.filter(f => f.state === 'expected')
  const financingConfirmed = sum(confirmedRows.map(f => f.amount))
  const financingExpected = sum(expectedRows.map(f => f.amount))
  const need = position.balanceDue == null ? null
    : Math.max(0, fromPence(pence(position.balanceDue) - pence(financingConfirmed)))
  return { need, financingConfirmed, financingExpected, dueDate: dealDueDate(deal), position }
}

/** Plain-English lines for one deal's "How calculated?" explainer. */
export function explainDeal(deal = {}, lines = [], funding = []) {
  const cn = dealCashNeed(deal, lines, funding)
  const p = cn.position
  const r = refurbPosition(deal, lines)
  const out = []
  if (p.basis === 'lines') {
    const comp = p.components.filter(c => !c.credit)
    out.push(`Completion total = ${comp.map(c => `${c.label} ${gbp(c.amount)}`).join(' + ')} = ${gbp(p.total)}`)
  } else if (p.total != null) {
    const comp = p.components.filter(c => !c.credit)
    out.push(`Estimated completion total (no completion statement) = ${comp.map(c => `${c.label} ${gbp(c.amount)}`).join(' + ')} = ${gbp(p.total)}`)
  } else {
    out.push('Completion total is unknown: no completion statement and no purchase price.')
  }
  const credit = p.components.filter(c => c.credit)
  out.push(credit.length
    ? `Credits = ${credit.map(c => `${c.label} ${gbp(c.amount)}`).join(' + ')} = ${gbp(p.credits)}`
    : 'Credits = £0 (nothing paid on account or as deposit recorded)')
  out.push(p.balanceDue == null
    ? 'Balance due = unknown'
    : `Balance due = ${gbp(p.total)} − ${gbp(p.credits)} = ${gbp(p.balanceDue)} (${COST_STATE_LABEL[p.state] || p.state}${p.basis === 'estimate' ? ', estimate from deal fields' : ''})`)
  out.push(cn.need == null
    ? 'Cash needed from the company = unknown until a price or completion statement is entered'
    : `Cash needed from the company = max(0, ${gbp(p.balanceDue)} − confirmed financing ${gbp(cn.financingConfirmed)}) = ${gbp(cn.need)}`)
  if (cn.financingExpected > 0) out.push(`Expected financing of ${gbp(cn.financingExpected)} is not deducted until it is confirmed.`)
  out.push(cn.dueDate ? `Due: ${dateGB(cn.dueDate)}` : 'Due: unscheduled (no expected or target completion date)')
  out.push(r.amount == null ? 'Refurb forecast: not entered' : `Refurb forecast (separate from completion) = ${gbp(r.amount)}${r.basis === 'estimate' ? ' (estimate from deal refurb cost)' : ''}`)
  return out
}

// ── company ─────────────────────────────────────────────────────────────────
/** Counts towards company funding: not fallen through, not deleted, not yet completed. */
export const isLiveDeal = d => !!d && d.status !== 'dead' && !d.deleted_at && !isPostCompletion(d.status)

/** Latest cash position from a list of rows (by as_of, then created_at). */
export function latestCashPosition(rows = []) {
  let best = null
  for (const r of rows || []) {
    if (!best) { best = r; continue }
    const a = String(r.as_of || ''), b = String(best.as_of || '')
    if (a > b || (a === b && String(r.created_at || '') > String(best.created_at || ''))) best = r
  }
  return best
}

/**
 * Funding picture for one company.
 *   deals         deals of this company (any status; filtered to live here)
 *   linesByDeal   { [dealId]: cost lines }
 *   fundingByDeal { [dealId]: funding rows }
 *   cashPosition  latest company_cash_positions row, or null
 *   from          ISO date: today; earlier due dates are flagged overdue
 *   to            ISO date: window end (inclusive). Null: every live deal,
 *                 unscheduled included.
 */
export function companyFunding({ deals = [], linesByDeal = {}, fundingByDeal = {}, cashPosition = null, from = null, to = null } = {}) {
  const live = (deals || []).filter(isLiveDeal)
  const rows = live.map(d => {
    const lines = linesByDeal[d.id] || []
    const cn = dealCashNeed(d, lines, fundingByDeal[d.id] || [])
    const r = refurbPosition(d, lines)
    const week = cn.dueDate ? weekStart(cn.dueDate) : null
    const inWindow = to ? (cn.dueDate != null && cn.dueDate <= to) : true
    return {
      dealId: d.id, name: d.name || d.address || 'Untitled deal', status: d.status,
      dueDate: cn.dueDate, week, inWindow,
      overdue: !!(from && cn.dueDate && cn.dueDate < from),
      need: cn.need, balanceDue: cn.position.balanceDue, total: cn.position.total, credits: cn.position.credits,
      basis: cn.position.basis, state: cn.position.state, missing: cn.position.missing,
      financingConfirmed: cn.financingConfirmed, financingExpected: cn.financingExpected,
      refurb: r.amount, refurbBasis: r.basis,
    }
  }).sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : String(a.name).localeCompare(String(b.name)))

  // Weekly schedule (Monday start) and Unscheduled.
  const weekMap = new Map()
  const unscheduled = { deals: [], need: 0, unknownCount: 0 }
  for (const r of rows) {
    if (!r.week) {
      unscheduled.deals.push(r.dealId)
      if (r.need == null) unscheduled.unknownCount += 1
      else unscheduled.need = sum([unscheduled.need, r.need])
      continue
    }
    const w = weekMap.get(r.week) || { week: r.week, weekEnd: addDays(r.week, 6), deals: [], need: 0, unknownCount: 0, overdue: false, inWindow: false }
    w.deals.push(r.dealId)
    if (r.need == null) w.unknownCount += 1
    else w.need = sum([w.need, r.need])
    if (r.overdue) w.overdue = true
    if (r.inWindow) w.inWindow = true
    weekMap.set(r.week, w)
  }
  const cashKnown = !!cashPosition && cashPosition.amount != null && cashPosition.amount !== ''
  const cash = cashKnown ? sum([cashPosition.amount]) : 0
  let running = 0
  const weeks = [...weekMap.values()].sort((a, b) => a.week < b.week ? -1 : 1).map(w => {
    running = sum([running, w.need])
    return { ...w, cumulative: running, shortfall: Math.max(0, fromPence(pence(running) - pence(cash))) }
  })

  const windowRows = rows.filter(r => r.inWindow)
  const needRows = windowRows.filter(r => r.need != null)
  const unknownRows = windowRows.filter(r => r.need == null)
  const needInWindow = sum(needRows.map(r => r.need))
  const refurbRows = rows.filter(r => r.refurb != null)
  const refurbForecast = sum(refurbRows.map(r => r.refurb))
  const financingExpected = sum(windowRows.map(r => r.financingExpected))
  const fundingGap = Math.max(0, fromPence(pence(needInWindow) - pence(cash)))
  const combinedGap = Math.max(0, fromPence(pence(needInWindow) + pence(refurbForecast) - pence(cash)))
  const estimateCount = needRows.filter(r => r.basis === 'estimate').length

  // Plain English, numbers substituted, so every headline can be checked.
  const windowText = to ? `due on or before ${dateGB(to)}` : 'across all live deals'
  const explain = []
  explain.push(`Live deals: ${rows.length} (fallen through, deleted and completed deals are left out).`)
  explain.push(`Each deal's cash need = balance due at completion − confirmed financing (company cash is not financing).`)
  explain.push(needRows.length
    ? `Cash needed ${windowText} = ${needRows.map(r => gbp(r.need)).join(' + ')} = ${gbp(needInWindow)}`
    : `Cash needed ${windowText} = £0 (no deals with figures in this window)`)
  if (unknownRows.length) explain.push(`${unknownRows.length} deal${unknownRows.length === 1 ? ' has' : 's have'} no price or completion statement, so ${unknownRows.length === 1 ? 'its' : 'their'} need is unknown and not included.`)
  if (estimateCount) explain.push(`${estimateCount} of these ${estimateCount === 1 ? 'is an estimate' : 'are estimates'} from deal fields (no completion statement entered).`)
  if (to && unscheduled.deals.length) explain.push(`Unscheduled (no completion date, not in this window): ${unscheduled.deals.length} deal${unscheduled.deals.length === 1 ? '' : 's'}, ${gbp(unscheduled.need)}.`)
  explain.push(cashKnown
    ? `Cash available = latest position ${gbp(cash)} as of ${dateGB(cashPosition.as_of)}, counted once for the company.`
    : 'Cash available = not entered, so taken as £0.')
  explain.push(`Funding gap = max(0, ${gbp(needInWindow)} − ${gbp(cash)}) = ${gbp(fundingGap)}`)
  explain.push(refurbRows.length
    ? `Refurb forecast (separate) = ${refurbRows.map(r => gbp(r.refurb)).join(' + ')} = ${gbp(refurbForecast)}`
    : 'Refurb forecast (separate) = none entered')
  if (refurbForecast > 0) explain.push(`Combined including refurb = max(0, ${gbp(needInWindow)} + ${gbp(refurbForecast)} − ${gbp(cash)}) = ${gbp(combinedGap)}`)
  if (financingExpected > 0) explain.push(`Expected financing of ${gbp(financingExpected)} is not deducted until confirmed.`)

  return {
    rows, weeks, unscheduled,
    activeDeals: rows.length,
    needInWindow, unknownCount: unknownRows.length, estimateCount,
    refurbForecast, financingExpected,
    cash: cashKnown ? { amount: cash, asOf: cashPosition.as_of || null, note: cashPosition.note || null } : null,
    fundingGap, combinedGap,
    explain,
  }
}
