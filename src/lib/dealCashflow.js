// ── DEAL CASHFLOW AGGREGATION ─────────────────────────────────────────────
// Pure functions for converting a deal's stored fields into cashflow numbers
// and grouping multiple deals into time buckets. No React, no DB — just maths
// so we can unit-test the logic separately if we ever want to.
//
// Two numbers per deal:
//
//   HEADLINE — what the deal "costs" on paper. The full purchase price plus
//              all acquisition costs plus refurb. Useful for "total deal
//              value" reports and what your accountant will recognise.
//
//   CASH OUT — what actually leaves your bank account. For a cash deal that's
//              the same as headline. For a mortgage deal, you only pay the
//              deposit + fees + refurb yourself — the lender funds the rest.
//              For a bridge deal it's even less; the bridge typically funds
//              both purchase and refurb so YOU only need the bridge fees +
//              any equity contribution.
//
// We aggregate across deals by status group (pipeline / committed / refurb)
// AND by time bucket (next 30 / 31-60 / 61-90 days / later / undated).
// Time bucketing uses expected_completion_date (or refurb_start_date when
// the deal is already completed) as the trigger date.
//
// PROPERTY CONTRIBUTIONS to the 'refurb' group:
// Once a deal converts to a property the deal record disappears, but the
// refurb still has to be paid for. Each property carries refurb_projects
// (see lib/refurbs.js): the group's headline is the AGREED price across a
// property's active projects and its cash out is REMAINING to pay (agreed
// minus payments). Completed projects and sold / deleted properties are
// excluded. The time bucket comes from the earliest target_end_date.
// Properties never appear in 'committed' or 'pipeline': once it is a
// property record the purchase has already happened.

import { propertyRefurbSummary } from './refurbs'

// ── Status grouping ──────────────────────────────────────────────────────
// We collapse the 6 deal statuses into 3 buckets that match real cashflow
// states. 'dead' is excluded from cashflow entirely.
export const STATUS_GROUP = {
  analysing:   'pipeline',
  offer_made:  'pipeline',
  under_offer: 'pipeline',
  exchanged:   'committed',  // 10% deposit paid, 90% due at completion
  completed:   'refurb',     // purchase done, refurb to come
  dead:        null,         // exclude
}

export const STATUS_GROUP_LABEL = {
  pipeline:  'Pipeline',
  committed: 'Committed (exchanged)',
  refurb:    'Refurbs to fund',
}

export const STATUS_GROUP_DESC = {
  pipeline:  'Estimated, not yet committed',
  committed: 'Purchase contractually committed — completion due',
  refurb:    'Agreed price less payments made, from Refurbs',
}

// ── Per-deal cashflow ────────────────────────────────────────────────────
/**
 * Returns { headline, cashOut, group } for a single deal.
 * - headline: full purchase + costs + refurb (regardless of financing)
 * - cashOut:  cash that leaves YOUR account (depends on purchase_type)
 * - group:    'pipeline' | 'committed' | 'refurb' | null (excluded)
 *
 * For the 'committed' group (exchanged but not completed), we model only the
 * REMAINING cash needed at completion: 90% of purchase + remaining fees.
 * For the 'refurb' group, we don't model purchase at all (already paid) —
 * just the refurb cost.
 */
export function dealCashflow(deal) {
  // Resolve the cashflow group from the deal status. We can't use `??` here:
  // STATUS_GROUP.dead is an explicit `null` (meaning "exclude"), which `??`
  // would treat as "no value" and fall back to 'pipeline' — wrongly counting
  // dead deals as live pipeline cash. Use `in` to distinguish "known status,
  // explicitly null" from "unknown status, default to pipeline".
  const status = deal?.status
  const group = status && status in STATUS_GROUP ? STATUS_GROUP[status] : 'pipeline'
  if (group == null) return { headline: 0, cashOut: 0, group: null }

  const num = (v) => Number(v) || 0
  const price       = num(deal.purchase_price)
  const refurb      = num(deal.refurb_cost)
  const stamp       = num(deal.stamp_duty_override) || num(deal.stamp_duty) || 0
  const legal       = num(deal.legal_fees)
  const survey      = num(deal.survey_cost)
  const auction     = num(deal.auction_fees)
  const broker      = num(deal.broker_fee)
  const otherCosts  = num(deal.other_costs)
  // Deposit defaults to 25% when not entered — the SAME default must feed the
  // mortgage-fee LTV, otherwise a blank deposit_percent computes the fee on
  // 100% of the purchase price instead of the 75% loan.
  const depositPct  = num(deal.deposit_percent) || 25
  const mortgageFee = price * (1 - depositPct / 100)
                    * (num(deal.mortgage_fee_percent) / 100)
  const totalAcq    = price + stamp + legal + survey + auction + broker + otherCosts
                    + (deal.purchase_type !== 'cash' ? mortgageFee : 0)

  // Headline: full deal cost regardless of financing
  const headline = totalAcq + refurb

  // True cash out of pocket — depends on financing
  const purchaseType = deal.purchase_type || 'mortgage'
  const depositAmt   = price * depositPct / 100

  let cashOut
  if (purchaseType === 'cash') {
    // No mortgage — pay full purchase + costs + refurb
    cashOut = headline
  } else if (purchaseType === 'bridge') {
    // Bridging finance typically funds purchase AND refurb; you pay
    // bridge fees + small equity. Approximation: deposit + costs + bridge
    // fee. We treat the mortgageFee field as the bridge fee here since
    // there's no separate bridge-fee field today.
    cashOut = depositAmt + (totalAcq - price) + 0 // refurb funded by bridge
  } else {
    // Mortgage: pay deposit + costs + refurb yourself; lender funds the rest
    cashOut = depositAmt + (totalAcq - price) + refurb
  }

  // For deals that have already exchanged, only the REMAINING cash matters
  // (deposit assumed already paid). We model 90% of purchase + remaining
  // costs as still-due. This is rough but matches typical UK exchange terms.
  if (group === 'committed') {
    // Subtract the deposit-already-paid portion from cashOut. Financed deals
    // pay their mortgage/bridge deposit at exchange; cash deals pay the
    // standard UK 10% exchange deposit (there's no separate field for it).
    const exchangeDeposit = purchaseType === 'cash' ? price * 0.10 : depositAmt
    cashOut = Math.max(0, cashOut - exchangeDeposit)
  }
  // For deals already completed, purchase is fully paid — only refurb remains
  if (group === 'refurb') {
    cashOut = refurb
  }

  return { headline, cashOut, group }
}

// ── Per-property refurb cashflow ─────────────────────────────────────────
/**
 * Refurb commitment for a single property, from its refurb_projects.
 *
 *   { unpaid, headline, source, trigger, count }
 *     source: 'projects'  — one or more active refurb projects
 *             'excluded'  — sold / deleted / nothing active
 *     unpaid:   remaining to pay across active projects (the cashflow number)
 *     headline: total agreed across active projects
 *     trigger:  earliest target_end_date (ISO date) for time bucketing, or null
 */
export function propertyRefurbCashflow(property) {
  const none = { unpaid: 0, headline: 0, source: 'excluded', trigger: null, count: 0 }
  if (!property || property.deleted_at) return none
  if (property.status === 'sold') return none
  const s = propertyRefurbSummary(property)
  if (s.count === 0) return none
  return { unpaid: s.unpaid, headline: s.headline, source: 'projects', trigger: s.trigger, count: s.count }
}


// ── Time bucketing ────────────────────────────────────────────────────────
// Bucket a deal into a time horizon based on its trigger date.
// Trigger date logic:
//   - For 'committed' deals: expected_completion_date
//   - For 'refurb' deals:    refurb_start_date or refurb_end_date
//   - For properties:        earliest active refurb project target_end_date
//   - For 'pipeline' deals:  no trigger (always 'undated' bucket)
//
// Buckets are inclusive: 0-30 days from today, 31-60, 61-90, 91+, or undated
// when no relevant date is set. Dates in the past go to the 'overdue' bucket.

export const TIME_BUCKETS = ['overdue', '0-30', '31-60', '61-90', '91+', 'undated']
export const TIME_BUCKET_LABEL = {
  overdue:  'Overdue',
  '0-30':   'Next 30 days',
  '31-60':  '31-60 days',
  '61-90':  '61-90 days',
  '91+':    'Later (90+ days)',
  undated:  'No date set',
}

export function dealTimeBucket(deal) {
  const group = STATUS_GROUP[deal?.status]
  if (!group || group === 'pipeline') return 'undated'

  const triggerStr = group === 'committed'
    ? deal.expected_completion_date
    : (deal.refurb_start_date || deal.refurb_end_date)
  if (!triggerStr) return 'undated'

  const trigger = new Date(triggerStr)
  if (isNaN(trigger.getTime())) return 'undated'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((trigger - today) / (1000 * 60 * 60 * 24))

  if (diffDays < 0)   return 'overdue'
  if (diffDays <= 30) return '0-30'
  if (diffDays <= 60) return '31-60'
  if (diffDays <= 90) return '61-90'
  return '91+'
}

// ── Aggregator ────────────────────────────────────────────────────────────
/**
 * Given arrays of deals and (optionally) properties, returns:
 *   {
 *     byGroup: { pipeline: {...}, committed: {...}, refurb: {...} },
 *     byBucket: { '0-30': {...}, ..., undated: {...} },
 *     totalHeadline, totalCashOut, totalCount, propertyRefurbCount,
 *     propertyRefurbUndated (properties whose active refurbs have no target
 *       finish date — surfaced in the UI as a hint).
 *   }
 *
 * Properties contribute to the 'refurb' group only (see propertyRefurbCashflow
 * for the rules). They never appear in 'pipeline' or 'committed' because the
 * schema has no signal for "purchase still pending" on a property record.
 *
 * Excludes deleted deals and 'dead'-status deals; sold/deleted properties.
 */
export function aggregateDeals(deals, properties = []) {
  const byGroup = {
    pipeline:  { count: 0, headline: 0, cashOut: 0, deals: [], properties: [] },
    committed: { count: 0, headline: 0, cashOut: 0, deals: [], properties: [] },
    refurb:    { count: 0, headline: 0, cashOut: 0, deals: [], properties: [] },
  }
  const byBucket = {}
  for (const b of TIME_BUCKETS) byBucket[b] = { count: 0, headline: 0, cashOut: 0, deals: [], properties: [] }

  let totalHeadline = 0, totalCashOut = 0, totalCount = 0

  // Pass 1: deals
  for (const d of (deals || [])) {
    if (d.deleted_at) continue
    const cf = dealCashflow(d)
    if (!cf.group) continue
    const bucket = dealTimeBucket(d)
    // Attach cashflow numbers to a copy of the deal so the UI can render
    // per-row breakdowns without recomputing. Same approach as properties
    // (we attach _refurbCashflow on properties below).
    const dWithCf = { ...d, _cashflow: cf }

    byGroup[cf.group].count    += 1
    byGroup[cf.group].headline += cf.headline
    byGroup[cf.group].cashOut  += cf.cashOut
    byGroup[cf.group].deals.push(dWithCf)

    byBucket[bucket].count    += 1
    byBucket[bucket].headline += cf.headline
    byBucket[bucket].cashOut  += cf.cashOut
    byBucket[bucket].deals.push(dWithCf)

    totalHeadline += cf.headline
    totalCashOut  += cf.cashOut
    totalCount    += 1
  }

  // Pass 2: properties — refurb group only
  let propertyRefurbCount = 0
  let propertyRefurbUndated = 0
  for (const p of (properties || [])) {
    const rcf = propertyRefurbCashflow(p)
    if (rcf.source === 'excluded') continue
    // A project with nothing left to pay still belongs to the group (it
    // shows as £0 remaining) but contributes nothing to the totals.
    propertyRefurbCount += 1

    // Time bucket from the earliest active project's target finish date.
    let bucket = 'undated'
    if (rcf.trigger) {
      const trigger = new Date(rcf.trigger + 'T00:00:00')
      if (!isNaN(trigger.getTime())) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const diff = Math.floor((trigger - today) / (1000 * 60 * 60 * 24))
        if (diff < 0)        bucket = 'overdue'
        else if (diff <= 30) bucket = '0-30'
        else if (diff <= 60) bucket = '31-60'
        else if (diff <= 90) bucket = '61-90'
        else                 bucket = '91+'
      }
    }
    if (bucket === 'undated') propertyRefurbUndated += 1

    byGroup.refurb.count    += 1
    byGroup.refurb.headline += rcf.headline
    byGroup.refurb.cashOut  += rcf.unpaid
    byGroup.refurb.properties.push({ ...p, _refurbCashflow: rcf })

    byBucket[bucket].count    += 1
    byBucket[bucket].headline += rcf.headline
    byBucket[bucket].cashOut  += rcf.unpaid
    byBucket[bucket].properties.push({ ...p, _refurbCashflow: rcf })

    totalHeadline += rcf.headline
    totalCashOut  += rcf.unpaid
    totalCount    += 1
  }

  return {
    byGroup, byBucket,
    totalHeadline, totalCashOut, totalCount,
    propertyRefurbCount, propertyRefurbUndated,
  }
}
