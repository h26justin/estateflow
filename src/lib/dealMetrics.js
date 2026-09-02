// ── DEAL METRICS ─────────────────────────────────────────────────────────────
// One place that turns a deal row (or the in-progress edit form) into the
// numbers the Deals page shows: acquisition cost, cash in, monthly profit,
// yields, returns, BRRR figures.
//
// Before this existed the same maths lived in four places (deal list card,
// compare modal, pipeline card, and the deal editor) and had drifted: the
// list ignored interest-only mortgages and the arrangement fee, the compare
// modal dropped auction/broker fees and HMO per-room rents, the pipeline
// card had its own yield formula. The same deal showed different monthly
// profit depending on which screen you were on. The editor was the most
// complete, so this is its logic verbatim; everything else now calls it.
//
// Pure: no React, no DB. Fields may arrive as strings (form inputs) or
// numbers (DB rows); `num` normalises. Missing/blank numeric fields count
// as 0 except where the editor applies a default (mortgage term 25 years,
// interest-only mortgage type, agent fee ex-VAT).

import { calcStampDuty, calcMonthlyRepayment } from './api'

export const NIGHTS_PER_MONTH = 30.4

export function num(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Gross monthly rent by deal type (BTL / BRRR / flip use monthly_rent). */
export function grossMonthlyRent(d) {
  if (d.deal_type === 'hmo') {
    const rents = Array.isArray(d.hmo_room_rents) ? d.hmo_room_rents : []
    if (d.hmo_rent_mode === 'individual' && rents.length > 0) {
      return rents.reduce((s, r) => s + num(r), 0)
    }
    return num(d.hmo_rooms) * num(d.hmo_rent_per_room)
  }
  if (d.deal_type === 'sa') {
    return num(d.sa_nightly_rate) * (num(d.sa_occupancy_percent) / 100) * NIGHTS_PER_MONTH
  }
  return num(d.monthly_rent)
}

/** Stamp duty: the user's override if set, otherwise the SDLT calculator. */
export function stampDuty(d) {
  if (d.stamp_duty_override != null && d.stamp_duty_override !== '') return num(d.stamp_duty_override)
  return calcStampDuty(num(d.purchase_price), d.is_additional_property, d.is_first_time_buyer)
}

export function computeDealMetrics(d = {}) {
  const price = num(d.purchase_price)
  const isCash = d.purchase_type === 'cash'
  const sd = stampDuty(d)

  const loanAmount = isCash ? 0 : price * (1 - num(d.deposit_percent) / 100)
  const deposit = price - loanAmount
  const mortgageFee = isCash ? 0 : loanAmount * (num(d.mortgage_fee_percent) / 100)
  const otherAcquisition = num(d.legal_fees) + num(d.survey_cost) + num(d.auction_fees)
    + num(d.broker_fee) + num(d.refurb_cost) + num(d.other_costs)
  const totalAcquisition = price + sd + otherAcquisition + mortgageFee
  const cashIn = Math.max(0, totalAcquisition - loanAmount)

  const isInterestOnly = (d.mortgage_type || 'interest_only') === 'interest_only'
  const mortgageTerm = num(d.mortgage_term) || 25
  const monthlyRepayment = isCash ? 0
    : calcMonthlyRepayment(loanAmount, num(d.mortgage_rate), mortgageTerm, isInterestOnly)

  const gross = grossMonthlyRent(d)
  const effectiveRent = gross * (1 - num(d.void_percent) / 100)
  const agentFeeVat = d.agent_fee_vat || 'ex_vat'
  const agentFeeMultiplier = agentFeeVat === 'ex_vat' ? 1.2 : 1.0
  const agentFee = effectiveRent * num(d.agent_fee_percent) / 100 * agentFeeMultiplier
  const maintenanceFee = effectiveRent * num(d.maintenance_percent) / 100
  const hmoExtras = d.deal_type === 'hmo'
    ? num(d.hmo_utilities_monthly) + num(d.hmo_council_tax_monthly) + num(d.hmo_licence_annual) / 12
    : 0
  const totalMonthlyCosts = monthlyRepayment + agentFee + maintenanceFee
    + num(d.insurance_monthly) + num(d.service_charge_monthly) + num(d.ground_rent_monthly) + hmoExtras

  const monthlyProfit = effectiveRent - totalMonthlyCosts
  const annualProfit = monthlyProfit * 12
  const grossYield = price > 0 ? (gross * 12 / price) * 100 : 0
  const netYield = price > 0 ? (annualProfit / price) * 100 : 0
  const cashOnCash = cashIn > 0 ? (annualProfit / cashIn) * 100 : 0
  const roce = totalAcquisition > 0 ? (annualProfit / totalAcquisition) * 100 : 0
  const payback = annualProfit > 0 ? cashIn / annualProfit : 0

  // BRRR refinance
  const brrrNewLoan = num(d.brrr_end_value) * num(d.brrr_refinance_ltv) / 100
  const brrrNewRepayment = calcMonthlyRepayment(brrrNewLoan, num(d.brrr_new_rate), num(d.brrr_new_term) || 25, isInterestOnly)
  const brrrCapitalReleased = brrrNewLoan - loanAmount
  const brrrMoneyLeft = cashIn - brrrCapitalReleased
  const brrrCashOnCash = brrrMoneyLeft > 0 ? (annualProfit / brrrMoneyLeft) * 100 : 0

  return {
    price, isCash, sd, loanAmount, deposit, mortgageFee, otherAcquisition, totalAcquisition, cashIn,
    isInterestOnly, mortgageTerm, monthlyRepayment,
    grossMonthlyRent: gross, effectiveRent, agentFeeVat, agentFeeMultiplier, agentFee, maintenanceFee,
    hmoExtras, totalMonthlyCosts, monthlyProfit, annualProfit,
    grossYield, netYield, cashOnCash, roce, payback,
    brrrNewLoan, brrrNewRepayment, brrrCapitalReleased, brrrMoneyLeft, brrrCashOnCash,
  }
}
