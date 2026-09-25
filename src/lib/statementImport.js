// Managing-agent statement import (PNE / RMS): statement -> review -> Rent
// Tracker. Pure functions, no React, no Supabase.
//
//   parseForImport(text)          read the statement with the stream parser
//                                 proven on 71 real statements (statementAudit)
//   reviewRows(parsed, ctx, ov)   one review row per statement line: company ->
//                                 property -> tenancy -> rent period -> amount,
//                                 with a status and the reasons for it
//   planImport(rows, ctx)         exactly what approving would write
//
// Rules from the "Properly - updates" brief (25 Sep 2026):
//   • never guess silently: anything uncertain is Needs Review and is left out
//     until a person confirms or corrects it
//   • the statement date is NEVER the rent month; the rent period printed on
//     the line is used, and a rent line without one needs a person
//   • several payments for one period (weekly, part, two housemates) land on
//     ONE rent period as several receipts; they never create extra months
//   • nothing already recorded is overwritten: a period marked paid by hand
//     keeps its figure, and approving adds receipts beside it
//   • the Rent Tracker stays the source of truth: approval writes receipts and
//     allocations against rent periods, which the rent engine and the
//     dashboard already read
import { parseAuditStatement, balanceCheck, normaliseLabel, round2 } from './statementAudit'
import { matchProperties } from './statementParser'
import { evaluatePeriod, monthBounds, daysBetween, isoToday } from './rentEngine'
import { sourceRef } from './csvImport'

export const REVIEW_STATUS = Object.freeze({
  READY: 'ready', MATCHED: 'matched', NEEDS_REVIEW: 'needs_review', UNMATCHED: 'unmatched', DUPLICATE: 'duplicate',
})
export const REVIEW_STATUS_LABEL = Object.freeze({
  ready: 'Ready to import', matched: 'Matched', needs_review: 'Needs review', unmatched: 'Unmatched', duplicate: 'Duplicate',
})
// What each statement line type becomes on approval.
export const LINE_KIND = Object.freeze({
  rent: 'rent', arrears: 'arrears', management_fee: 'fee', maintenance: 'deduction', other_deduction: 'deduction',
  credit: 'credit', other_income: 'other_income', transfer: 'transfer',
})

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ── Parse ───────────────────────────────────────────────────────────────────
export function parseForImport(text) {
  const p = parseAuditStatement(text)
  const header = {
    agent: p.agent || null,
    statementNumber: p.statementNumber ?? null,
    agentReference: p.agentReference || null,
    statementRef: p.statementNumber != null ? String(p.statementNumber) : (p.agentReference || null),
    statementDate: p.statementDate || null,
    periodStart: p.statementPeriodStart || null,
    periodEnd: p.statementPeriodEnd || null,
    landlordCompany: p.landlordCompany || p.landlordName || '',
    invoiceNumber: p.invoiceNumber || null,
    invoiceFees: p.invoiceFees ?? null,
    previousBalance: p.previousBalance ?? 0,
    newBalance: p.newBalance ?? null,
    paymentAmount: p.paymentAmount ?? null,
    statedIncomeTotal: p.statedIncomeTotal ?? null,
    statedExpenditureTotal: p.statedExpenditureTotal ?? null,
    carriedForward: p.carriedForward ?? 0,
  }
  const lines = (p.lines || []).filter(l => l.line_type !== 'transfer')
  const transfers = (p.lines || []).filter(l => l.line_type === 'transfer')
  const balance = p.ok ? balanceCheck({ ...header, previous_balance: header.previousBalance, carried_forward: header.carriedForward, payment_amount: header.paymentAmount, new_balance: header.newBalance, stated_income_total: header.statedIncomeTotal, stated_expenditure_total: header.statedExpenditureTotal, invoice_fees: header.invoiceFees }, p.lines) : null
  return { ok: !!p.ok && lines.length > 0, problem: p.problem || (p.ok && !lines.length ? 'No rent or fee lines were found on this statement.' : null), header, lines, transfers, balance, errors: p.errors || [], warnings: p.warnings || [] }
}

// Content fingerprint: the same PDF (or a re-download of it) gives the same
// value even when the file name differs.
export function statementFingerprint(parsed) {
  const h = parsed?.header || {}
  return sourceRef('stmtfp', [h.agent, h.statementRef, h.statementDate, ...(parsed?.lines || []).map(l => l.line_key)])
}

// ── Matching helpers ────────────────────────────────────────────────────────
export function matchCompany(name, companies) {
  const n = norm(String(name || '').replace(/\b(limited|ltd|llp|plc)\b/gi, ''))
  if (!n) return null
  let best = null, bestScore = 0
  for (const c of companies || []) {
    const cn = norm(String(c.name || '').replace(/\b(limited|ltd|llp|plc)\b/gi, ''))
    if (!cn) continue
    if (cn === n) return c
    const a = new Set(n.split(' ')), b = cn.split(' ')
    const shared = b.filter(w => a.has(w) && w.length > 2).length
    const score = shared / Math.max(b.length, a.size)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 0.6 ? best : null
}

function daysOverlap(aStart, aEnd, bStart, bEnd) {
  const s = aStart > bStart ? aStart : bStart
  const e = aEnd < bEnd ? aEnd : bEnd
  return s > e ? 0 : daysBetween(s, e)
}
const rowStart = r => r.period_start || monthBounds(r.year, r.month).start
const rowEnd = r => r.period_end || monthBounds(r.year, r.month).end

// The rent period (rent_payments row) a statement period belongs to: exact
// bounds, else the row sharing the most days. Never reshapes an existing row.
// Returns { row } or { create } for a period with no row yet.
export function targetPeriod(property, start, end) {
  if (!start || !end) return null
  const rows = (property?.rent_payments || []).filter(r => !r.deleted_at)
  const exact = rows.find(r => r.period_start === start && r.period_end === end)
  if (exact) return { row: exact, overlapDays: daysBetween(start, end), exact: true }
  let best = null, bestDays = 0
  for (const r of rows) {
    const d = daysOverlap(start, end, rowStart(r), rowEnd(r))
    if (d > bestDays || (d === bestDays && d > 0 && best && rowStart(r) < rowStart(best))) { best = r; bestDays = d }
  }
  if (best) return { row: best, overlapDays: bestDays, exact: false }
  // No row covers it: create one with the statement's own dates, labelled by
  // the month holding most of its days (29 Dec - 28 Jan is January's rent).
  const [sy, sm] = start.split('-').map(Number)
  const nextStart = sm === 12 ? `${sy + 1}-01-01` : `${sy}-${String(sm + 1).padStart(2, '0')}-01`
  const inFirst = daysOverlap(start, end, start, monthBounds(sy, sm).end)
  const inSecond = end >= nextStart ? daysOverlap(start, end, nextStart, end) : 0
  const [y, m] = inSecond > inFirst ? nextStart.split('-').map(Number) : [sy, sm]
  return { create: { period_start: start, period_end: end, year: y, month: m, month_label: `${MONTH_SHORT[m - 1]} ${y}` }, overlapDays: 0, exact: false }
}

export function periodLabel(t) {
  if (!t) return null
  const r = t.row || t.create
  if (!r) return null
  const lbl = r.month_label && /[A-Za-z]/.test(r.month_label) ? r.month_label : `${MONTH_SHORT[(r.month || 1) - 1]} ${r.year}`
  return t.create ? `${lbl} (new period)` : lbl
}

// Tenancy covering the period, checked against the tenant name.
export function matchTenancy(property, start, end, tenantName) {
  const list = (property?.tenancies || []).filter(t => t.tenancy_start && t.tenancy_start <= (end || start) && (!t.tenancy_end || t.tenancy_end >= (start || end)))
  if (!list.length) return { tenancy: null, note: (property?.tenancies || []).length ? 'No tenancy on record covers this period' : null }
  const tn = norm(tenantName)
  const scored = list.map(t => {
    const nn = norm(t.tenant_name)
    const words = tn ? tn.split(' ').filter(w => w.length > 1) : []
    const hits = words.filter(w => nn.includes(w)).length
    return { t, hits, words: words.length }
  }).sort((a, b) => b.hits - a.hits)
  const top = scored[0]
  if (list.length === 1) {
    const mismatch = tn && top.t.tenant_name && top.hits === 0
    return { tenancy: top.t, note: mismatch ? `Tenant on statement "${tenantName}" differs from the tenancy (${top.t.tenant_name})` : null, mismatch: !!mismatch }
  }
  if (top.hits > 0 && (scored[1]?.hits || 0) < top.hits) return { tenancy: top.t, note: null }
  return { tenancy: null, note: `${list.length} tenancies cover this period; choose the tenant`, ambiguous: true }
}

function currentRentReceived(property, rowId) {
  let s = 0, n = 0
  for (const r of property?.rent_receipts || []) for (const a of r.rent_allocations || []) {
    if (a.rent_payment_id === rowId && a.target === 'current_rent') { s += Number(a.amount) || 0; n++ }
  }
  return { received: round2(s), allocations: n }
}

// What the Rent Tracker already says about the target period.
export function periodPosition(property, row, today = isoToday()) {
  if (!row) return { expected: null, received: 0, legacyAmount: null, legacyManual: false, allocations: 0 }
  const ev = evaluatePeriod(row, {
    property, tenancies: property.tenancies || [], receipts: property.rent_receipts || [],
    nonChargeable: property.non_chargeable_periods || [], overrides: property.rent_overrides || [],
    today: rowEnd(row) > today ? rowEnd(row) : today,
  })
  const alloc = currentRentReceived(property, row.id)
  // A period marked paid/part-paid by hand with an amount and no receipts:
  // that money must be kept when receipts are added (the engine prefers
  // receipts once any exist).
  const legacyManual = !alloc.allocations && ['paid', 'partial', 'late'].includes(row.status) && Number(row.amount) > 0
  return {
    expected: ev.state === 'not_collectible' ? 0 : ev.expected,
    received: alloc.allocations ? alloc.received : (legacyManual ? round2(row.amount) : 0),
    legacyAmount: legacyManual ? round2(row.amount) : null,
    legacyManual,
    paidNoAmount: !alloc.allocations && row.status === 'paid' && !(Number(row.amount) > 0),
    allocations: alloc.allocations,
    state: ev.state,
  }
}

// Statement-line reference, stable across re-uploads of the same statement.
export function lineRef(header, line, propertyId, amount, occurrence) {
  return sourceRef('stmtline', [header.agent, header.statementRef || header.statementDate, LINE_KIND[line.line_type] || line.line_type, propertyId || normaliseLabel(line.property_address), norm(line.tenant_name), line.period_start, line.period_end, round2(amount).toFixed(2), occurrence])
}

function amountOf(line) {
  switch (line.line_type) {
    case 'rent': case 'arrears': case 'other_income': return round2(line.gross_rent)
    case 'management_fee': return round2((Number(line.fee_amount) || 0) + (Number(line.vat_amount) || 0))
    case 'credit': return round2(line.credit_amount)
    default: return round2((Number(line.deduction_amount) || 0) + (Number(line.vat_amount) || 0))
  }
}

// ── Review rows ─────────────────────────────────────────────────────────────
// ctx: { properties, companies, companyId?, aliases, today, knownRefs:Set, existingFees:[{property_id, amount, date, source_ref}] }
// overrides: { [line_no]: { propertyId, periodStart, periodEnd, amount, include, confirmed, tenancyId } }
export function reviewRows(parsed, ctx, overrides = {}) {
  const header = parsed?.header || {}
  const companies = ctx?.companies || []
  // A person can say which company the statement is for; otherwise it is
  // matched from the landlord name printed on it.
  const company = ctx?.companyId ? companies.find(c => c.id === ctx.companyId) || null : matchCompany(header.landlordCompany, companies)
  const allProps = (ctx?.properties || []).filter(p => p.status !== 'sold')
  const scoped = company ? allProps.filter(p => p.company_id === company.id) : allProps
  const matched = matchProperties((parsed?.lines || []).map(l => ({ propertyName: l.property_address, line_no: l.line_no })), scoped.length ? scoped : allProps, ctx?.aliases || [])
  const byId = new Map(allProps.map(p => [p.id, p]))
  const known = ctx?.knownRefs || new Set()
  const today = ctx?.today || isoToday()
  const seen = new Map()

  const rows = (parsed?.lines || []).map((line, i) => {
    const ov = overrides[line.line_no] || {}
    const kind = LINE_KIND[line.line_type] || 'other_income'
    const m = matched[i] || {}
    const propertyId = ov.propertyId !== undefined ? ov.propertyId : (m.propertyId || null)
    const property = propertyId ? byId.get(propertyId) : null
    const via = ov.propertyId !== undefined ? 'manual' : (m.matchedVia || null)
    const periodStart = ov.periodStart !== undefined ? ov.periodStart : line.period_start
    const periodEnd = ov.periodEnd !== undefined ? ov.periodEnd : line.period_end
    const amount = ov.amount !== undefined ? round2(ov.amount) : amountOf(line)
    const reasons = []
    let hard = null                     // unmatched / exact duplicate: a person cannot wave these through
    let soft = null                     // probable duplicate: a person may confirm it is new
    let review = false

    if (!propertyId) { hard = REVIEW_STATUS.UNMATCHED; reasons.push(line.property_address ? `No property matches "${line.property_address}"` : 'No property on this line') }
    else {
      if (via === 'score' && (m.matchScore || 0) < 8) { review = true; reasons.push(`Property matched on a partial name (score ${m.matchScore}); check it`) }
      if (company && property.company_id !== company.id) { review = true; reasons.push(`${property.name} belongs to another company, not ${company.name}`) }
    }

    // Tenancy + period (rent and arrears).
    let tenancy = null, target = null, position = null
    if (kind === 'rent' || kind === 'arrears') {
      const tm = property ? matchTenancy(property, periodStart, periodEnd, line.tenant_name) : { tenancy: null }
      tenancy = ov.tenancyId ? (property?.tenancies || []).find(t => t.id === ov.tenancyId) || null : tm.tenancy
      if (!ov.tenancyId && tm.note && (tm.mismatch || tm.ambiguous)) { review = true; reasons.push(tm.note) }
      else if (!ov.tenancyId && tm.note) reasons.push(tm.note)
    }
    if (kind === 'rent') {
      if (!periodStart || !periodEnd) { review = true; reasons.push('No rent period on the statement line: enter the dates the rent is for (the statement date is never used)') }
      else if (property) {
        target = targetPeriod(property, periodStart, periodEnd)
        position = periodPosition(property, target?.row, today)
        if (target?.row && !target.exact && target.overlapDays < daysBetween(periodStart, periodEnd) / 2) { review = true; reasons.push(`Statement period only partly overlaps ${periodLabel(target)}`) }
        if (position.legacyManual) {
          if (Math.abs(position.legacyAmount - amount) < 0.005) { soft = REVIEW_STATUS.DUPLICATE; reasons.push(`${periodLabel(target)} is already marked paid by hand for ${gbp(position.legacyAmount)}`) }
          else { review = true; reasons.push(`${periodLabel(target)} already has ${gbp(position.legacyAmount)} entered by hand; importing adds this receipt beside it`) }
        }
        if (position.expected != null && position.expected > 0 && position.received + amount > position.expected + 0.5) {
          review = true; reasons.push(`Would take ${periodLabel(target)} to ${gbp(position.received + amount)} against ${gbp(position.expected)} due`)
        }
        if (position.state === 'not_collectible') { review = true; reasons.push(`${periodLabel(target)} is a non-collectible period (vacant, refurb or on the market)`) }
      }
    }
    if (kind === 'arrears' && !tenancy) reasons.push('Recorded against historic arrears')
    if (kind === 'deduction') { review = true; reasons.push('Deducted by the agent: check it is not already recorded as a bill before recording it as an expense') }
    if (kind === 'credit') { review = true; reasons.push('Credit / refund on the statement: shown for the record; tick to add it to the property\'s expenses as a credit') }
    if (kind === 'other_income') { review = true; reasons.push('Income that is not a dated month\'s rent: check what it is for') }
    for (const f of line.flags || []) {
      if (f === 'fee_does_not_match_percentage') { review = true; reasons.push('Fee does not equal the stated percentage') }
      if (f === 'missing_tenant' && kind === 'rent') reasons.push('No tenant name on the line')
    }

    // Duplicate references (the same line imported before).
    const baseKey = [kind, propertyId, norm(line.tenant_name), periodStart, periodEnd, amount.toFixed(2)].join('|')
    const occ = (seen.get(baseKey) || 0) + 1; seen.set(baseKey, occ)
    const ref = lineRef(header, { ...line, period_start: periodStart, period_end: periodEnd }, propertyId, amount, occ)
    if (known.has(ref)) { hard = REVIEW_STATUS.DUPLICATE; reasons.unshift('Already imported from this statement') }
    if (kind === 'fee' && propertyId && !known.has(ref)) {
      const dup = (ctx?.existingFees || []).find(f => f.property_id === propertyId && Math.abs(Number(f.amount) - amount) < 0.005 && header.statementDate && f.date && Math.abs((new Date(f.date) - new Date(header.statementDate)) / 86400000) <= 45)
      if (dup) { soft = REVIEW_STATUS.DUPLICATE; reasons.push(`A ${gbp(amount)} agent fee is already recorded on ${dup.date}`) }
    }

    // A person's confirmation clears Needs Review and a probable duplicate,
    // never an unmatched line or a line already imported from this statement.
    let status = hard || (!ov.confirmed && soft) || (review && !ov.confirmed ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MATCHED)
    // Anything that would write to the Rent Tracker needs a property; rent
    // also needs a period.
    const blocked = !propertyId || (kind === 'rent' && (!periodStart || !periodEnd))
    const defaultInclude = !ov.confirmed ? !['credit', 'deduction', 'other_income'].includes(kind) : true
    const include = status === REVIEW_STATUS.MATCHED && !blocked && (ov.include !== undefined ? !!ov.include : defaultInclude)
    if (include) status = REVIEW_STATUS.READY

    return {
      lineNo: line.line_no, line, kind, propertyId, property, matchedVia: via, matchScore: m.matchScore ?? null,
      tenant: line.tenant_name || '', tenancy, periodStart, periodEnd, txDate: line.transaction_date || null,
      amount, fee: kind === 'fee' ? round2(line.fee_amount) : 0, vat: round2(line.vat_amount),
      deduction: kind === 'deduction' ? round2(line.deduction_amount) : 0,
      target, targetLabel: periodLabel(target), rentDue: position?.expected ?? null, alreadyReceived: position?.received ?? 0,
      legacyAmount: position?.legacyAmount ?? null, ref, status, reasons, include, blocked,
      confirmed: !!ov.confirmed,
    }
  })
  return { company, rows }
}

export function statusCounts(rows) {
  const c = { ready: 0, matched: 0, needs_review: 0, unmatched: 0, duplicate: 0 }
  for (const r of rows || []) c[r.status] = (c[r.status] || 0) + 1
  return c
}

const gbp = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Plan ────────────────────────────────────────────────────────────────────
// What approval writes, for included rows only:
//   receipts     one per rent / arrears line, allocated to the rent period
//                (current_rent) or to historic arrears
//   newPeriods   rent_payments rows to create when no period covers the line
//   periodUpdates status/amount per touched rent period after ALL its new
//                receipts (paid when fully covered, otherwise partial)
//   bridges      a receipt that preserves an amount entered by hand before
//                receipts are added beside it, so it is never lost
//   expenses     agent fees (fee + VAT as the cost), deductions and credits
export function planImport(rows, ctx = {}) {
  const header = ctx.header || {}
  const stmtName = `${header.agent || 'Agent'} statement ${header.statementRef || header.statementDate || ''}`.trim()
  const receiptDate = r => r.txDate || header.statementDate || r.periodEnd
  const plan = { receipts: [], newPeriods: [], periodUpdates: [], bridges: [], expenses: [] }
  const periodKey = (pid, t) => t.row ? `row:${t.row.id}` : `new:${pid}:${t.create.period_start}:${t.create.period_end}`
  const touched = new Map()

  for (const r of (rows || []).filter(x => x.include && !x.blocked)) {
    const base = { property_id: r.propertyId, company_id: r.property?.company_id || null, tenancy_id: r.tenancy?.id || null, source: 'statement', payer: 'tenant', source_ref: r.ref, reference: stmtName, notes: [r.tenant && `Tenant on statement: ${r.tenant}`, r.periodStart && `Statement period ${r.periodStart} to ${r.periodEnd}`].filter(Boolean).join('. ') || null }
    if (r.kind === 'rent') {
      const t = r.target
      const key = periodKey(r.propertyId, t)
      if (!touched.has(key)) {
        touched.set(key, { key, row: t.row || null, create: t.create ? { ...t.create, property_id: r.propertyId } : null, property: r.property, expected: r.rentDue, received: r.alreadyReceived, legacyAmount: r.legacyAmount })
        if (t.create) plan.newPeriods.push({ key, ...t.create, property_id: r.propertyId })
        if (r.legacyAmount) plan.bridges.push({ periodKey: key, rent_payment_id: t.row.id, receipt: { property_id: r.propertyId, company_id: base.company_id, tenancy_id: base.tenancy_id, received_date: t.row.period_end || rowEnd(t.row), amount: r.legacyAmount, source: 'manual', payer: 'tenant', notes: 'Amount entered by hand before this statement import, kept as its own receipt' } })
      }
      touched.get(key).received = round2(touched.get(key).received + r.amount)
      plan.receipts.push({ periodKey: key, receipt: { ...base, received_date: receiptDate(r), amount: r.amount }, allocation: { target: 'current_rent', amount: r.amount } })
    } else if (r.kind === 'arrears') {
      plan.receipts.push({ periodKey: null, receipt: { ...base, received_date: receiptDate(r), amount: r.amount }, allocation: { target: 'historic_arrears', amount: r.amount } })
    } else if (r.kind === 'fee' || r.kind === 'deduction' || r.kind === 'credit') {
      const l = r.line
      const what = r.kind === 'fee'
        ? `Management fee${l.fee_pct != null ? ` ${l.fee_pct}%` : ''}${l.fee_basis != null ? ` of ${gbp(l.fee_basis)}` : ''}${r.vat ? ` (fee ${gbp(r.fee)} + VAT ${gbp(r.vat)})` : ''}`
        : (l.description || (r.kind === 'credit' ? 'Credit from agent' : 'Agent deduction'))
      plan.expenses.push({
        property_id: r.propertyId, category: r.kind === 'fee' ? 'agent_fees' : r.kind === 'credit' ? 'other' : 'maintenance',
        description: `${what} - ${stmtName}`, amount: r.kind === 'credit' ? -Math.abs(r.amount) : r.amount,
        date: header.statementDate || r.txDate || r.periodEnd || isoToday(), source_ref: r.ref,
      })
    }
  }
  for (const t of touched.values()) {
    const expected = t.expected
    const total = round2(t.received)
    plan.periodUpdates.push({ periodKey: t.key, rent_payment_id: t.row?.id || null, amount: total,
      status: expected == null || expected <= 0 || total + 0.005 >= expected ? 'paid' : 'partial',
      previous: t.row ? { status: t.row.status, amount: t.row.amount ?? null, source_ref: t.row.source_ref ?? null, import_batch_id: t.row.import_batch_id ?? null } : null })
  }
  return plan
}

export function planSummary(plan) {
  const sum = xs => round2(xs.reduce((s, x) => s + (Number(x) || 0), 0))
  return {
    rentReceipts: plan.receipts.filter(r => r.allocation.target === 'current_rent').length,
    rentTotal: sum(plan.receipts.filter(r => r.allocation.target === 'current_rent').map(r => r.receipt.amount)),
    arrearsReceipts: plan.receipts.filter(r => r.allocation.target === 'historic_arrears').length,
    periods: plan.periodUpdates.length, newPeriods: plan.newPeriods.length, bridges: plan.bridges.length,
    fees: plan.expenses.filter(e => e.category === 'agent_fees').length,
    feeTotal: sum(plan.expenses.filter(e => e.category === 'agent_fees').map(e => e.amount)),
    otherExpenses: plan.expenses.filter(e => e.category !== 'agent_fees').length,
  }
}

// Audit copy of every line: what was read, what was suggested, what the
// person changed, and what was done.
export function auditLines(rows, overrides = {}) {
  return (rows || []).map(r => ({
    line_no: r.lineNo, line_type: r.line.line_type, property_on_statement: r.line.property_address, tenant_on_statement: r.line.tenant_name || null,
    period_on_statement: [r.line.period_start, r.line.period_end], amount_on_statement: amountOf(r.line), vat: r.vat,
    property_id: r.propertyId, matched_via: r.matchedVia, match_score: r.matchScore, tenancy_id: r.tenancy?.id || null,
    period_used: [r.periodStart, r.periodEnd], target_period: r.targetLabel, amount_used: r.amount,
    status: r.status, reasons: r.reasons, included: r.include, corrected: !!overrides[r.lineNo] && Object.keys(overrides[r.lineNo]).some(k => k !== 'include'),
    ref: r.ref,
  }))
}

// Older statement layouts the stream parser does not know: take the legacy
// parser's items (statementParser.parseStatement) into the same line shape,
// so they get the same review, matching and duplicate protection.
export function fromLegacyParse(res) {
  const p = res?.parsed
  if (!p || !(p.items || []).length) return null
  const toIso = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
  const lines = p.items.map((it, i) => {
    const [a, b] = String(it.period || '').split(/\s+to\s+/)
    const base = { line_no: i + 1, section: it.type === 'rent' ? 'income' : 'expenditure', property_address: it.propertyName || '', tenant_name: it.tenant || '',
      period_start: null, period_end: null, transaction_date: null, description: it.description || '', gross_rent: 0, fee_amount: 0, vat_amount: 0,
      deduction_amount: 0, credit_amount: 0, net_amount: 0, fee_pct: null, fee_basis: null, flags: [] }
    if (it.type === 'rent') {
      const ps = toIso(a), pe = toIso(b)
      return { ...base, line_type: 'rent', gross_rent: round2(it.amount), net_amount: round2(it.amount), period_start: pe ? ps : null, period_end: pe || null }
    }
    if (it.type === 'fee') {
      const pm = String(it.description || '').match(/([\d.]+)\s*%/)
      return { ...base, line_type: 'management_fee', fee_amount: round2(it.amount), fee_pct: pm ? parseFloat(pm[1]) : null, net_amount: -round2(it.amount) }
    }
    return { ...base, line_type: 'maintenance', deduction_amount: round2(it.amount), net_amount: -round2(it.amount) }
  })
  const date = toIso(p.date) || (/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : null)
  return {
    ok: true, problem: null, legacy: true, lines, transfers: [], balance: null, errors: [],
    warnings: ['Older statement layout: read with the previous parser, so fee VAT and balances are not itemised. Check the figures against the PDF.'],
    header: { agent: res.format || null, statementNumber: p.statementNo ?? null, agentReference: null, statementRef: p.statementNo ? String(p.statementNo) : null,
      statementDate: date, periodStart: null, periodEnd: null, landlordCompany: p.company || '', invoiceNumber: null, invoiceFees: null,
      previousBalance: 0, newBalance: null, paymentAmount: p.paymentAmount ?? null, statedIncomeTotal: null, statedExpenditureTotal: null, carriedForward: 0 },
  }
}
