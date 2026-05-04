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
  refurb:    'Refurb pending / in progress',
}

export const STATUS_GROUP_DESC = {
  pipeline:  'Estimated, not yet committed',
  committed: 'Purchase contractually committed — completion due',
  refurb:    'Purchased, refurb to fund',
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
  const group = STATUS_GROUP[deal?.status] ?? 'pipeline'
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
  const mortgageFee = price * (1 - num(deal.deposit_percent) / 100)
                    * (num(deal.mortgage_fee_percent) / 100)
  const totalAcq    = price + stamp + legal + survey + auction + broker + otherCosts
                    + (deal.purchase_type !== 'cash' ? mortgageFee : 0)

  // Headline: full deal cost regardless of financing
  const headline = totalAcq + refurb

  // True cash out of pocket — depends on financing
  const purchaseType = deal.purchase_type || 'mortgage'
  const depositPct   = num(deal.deposit_percent) || 25
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
    // Subtract the deposit-already-paid portion from cashOut
    const exchangeDeposit = purchaseType === 'cash' ? 0 : depositAmt
    cashOut = Math.max(0, cashOut - exchangeDeposit)
  }
  // For deals already completed, purchase is fully paid — only refurb remains
  if (group === 'refurb') {
    cashOut = refurb
  }

  return { headline, cashOut, group }
}

// ── Time bucketing ────────────────────────────────────────────────────────
// Bucket a deal into a time horizon based on its trigger date.
// Trigger date logic:
//   - For 'committed' deals: expected_completion_date
//   - For 'refurb' deals:    refurb_start_date or refurb_end_date
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
 * Given an array of deals, returns:
 *   {
 *     byGroup: { pipeline: { count, headline, cashOut }, committed: {...}, refurb: {...} },
 *     byBucket: { '0-30': { count, headline, cashOut }, ..., undated: {...} },
 *     totalHeadline, totalCashOut, totalCount
 *   }
 * Excludes deleted and 'dead' deals.
 */
export function aggregateDeals(deals) {
  const byGroup = {
    pipeline:  { count: 0, headline: 0, cashOut: 0, deals: [] },
    committed: { count: 0, headline: 0, cashOut: 0, deals: [] },
    refurb:    { count: 0, headline: 0, cashOut: 0, deals: [] },
  }
  const byBucket = {}
  for (const b of TIME_BUCKETS) byBucket[b] = { count: 0, headline: 0, cashOut: 0, deals: [] }

  let totalHeadline = 0, totalCashOut = 0, totalCount = 0

  for (const d of (deals || [])) {
    if (d.deleted_at) continue
    const cf = dealCashflow(d)
    if (!cf.group) continue
    const bucket = dealTimeBucket(d)

    byGroup[cf.group].count    += 1
    byGroup[cf.group].headline += cf.headline
    byGroup[cf.group].cashOut  += cf.cashOut
    byGroup[cf.group].deals.push(d)

    byBucket[bucket].count    += 1
    byBucket[bucket].headline += cf.headline
    byBucket[bucket].cashOut  += cf.cashOut
    byBucket[bucket].deals.push(d)

    totalHeadline += cf.headline
    totalCashOut  += cf.cashOut
    totalCount    += 1
  }

  return { byGroup, byBucket, totalHeadline, totalCashOut, totalCount }
}
