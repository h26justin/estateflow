// Suggested split of a rent receipt across what the tenant owes.
//
// Decision 3, 19 Nov 2026 (Justin, on Tiffany's rent brief C4): with no
// stronger instruction (a payer's reference, a payment plan, a legal
// direction), money goes to
//   1. the rent period current on the date received,
//   2. then the oldest overdue periods,
//   3. then the historic opening-arrears balance,
// and anything left is held for review (never applied to a future month on a
// guess). This is only a suggestion: the person recording the receipt sees
// it, can change every line, and saves it themselves.
//
// Periods whose shortfall is unverified (paid with no amount, net-of-fees,
// pending review) are skipped: what they owe is not established.
//
// Pure: no React, no DB.

import { evaluateProperty, arrearsSummary, STATE } from './rentEngine'

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const OWING = [STATE.DUE, STATE.PART_PAID, STATE.MISSED]

function owes(e) {
  if (!OWING.includes(e.state) || e.needsBackfill || e.superseded) return 0
  return round2(Math.max(0, (Number(e.outstanding) || 0) - (Number(e.needsInfo) || 0)))
}

/**
 * @param {object} property  fetchProperties shape
 * @param {number} amount    money received
 * @param {string} received  ISO date received
 * @returns {{ allocations: {target, rent_payment_id, amount, why}[], remainder: number }}
 */
export function suggestAllocation(property, amount, received) {
  let left = round2(amount)
  const allocations = []
  if (!(left > 0) || !property) return { allocations, remainder: Math.max(0, left) }
  const evals = evaluateProperty(property, { today: received })
  const take = (e, why) => {
    const n = Math.min(left, owes(e))
    if (n > 0.005) { allocations.push({ target: 'current_rent', rent_payment_id: e.id, amount: round2(n), why }); left = round2(left - n) }
  }
  // 1. The period current on the date received (latest-starting if several).
  const current = evals
    .filter(e => e.periodStart <= received && e.periodEnd >= received && owes(e) > 0)
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0]
  if (current) take(current, 'Current rent')
  // 2. Oldest overdue periods first.
  const older = evals
    .filter(e => e !== current && e.periodEnd < received && owes(e) > 0)
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))
  for (const e of older) { if (left <= 0.005) break; take(e, 'Oldest arrears first') }
  // 3. Historic opening balance.
  const historic = arrearsSummary(property).balance || 0
  if (left > 0.005 && historic > 0.005) {
    const n = Math.min(left, historic)
    allocations.push({ target: 'historic_arrears', rent_payment_id: '', amount: round2(n), why: 'Historic arrears' })
    left = round2(left - n)
  }
  return { allocations, remainder: round2(Math.max(0, left)) }
}
