// Pure calculators: stamp duty, mortgage repayment, property health score
// and deal scoring (DSCR, stress test, cash-on-cash, LTV). No I/O.


// Stamp duty calculator (UK 2024 rates)
export function calcStampDuty(price, isAdditional = true, isFirstTimeBuyer = false) {
  // UK SDLT rates — updated April 2025 / October 2024
  // Standard bands from 1 April 2025 (temporary nil-rate threshold ended):
  //   £0–£125,000:        0%
  //   £125,001–£250,000:  2%
  //   £250,001–£925,000:  5%
  //   £925,001–£1.5m:    10%
  //   Over £1.5m:        12%
  // Additional property surcharge: 5% on full price (increased from 3%, 31 Oct 2024)
  // FTB relief from 1 April 2025:
  //   £0–£300,000:        0%
  //   £300,001–£500,000:  5% on the excess
  //   Over £500,000:      standard rates (no FTB relief)
  if (!price || price <= 0) return 0
  let duty = 0

  if (isFirstTimeBuyer && !isAdditional) {
    if (price <= 300000) return 0
    if (price <= 500000) {
      duty = (price - 300000) * 0.05
      return Math.round(duty)
    }
    // Over £500k — no FTB relief, fall through to standard rates
  }

  // Standard banded rates
  if (price > 125000) duty += (Math.min(price, 250000) - 125000) * 0.02
  if (price > 250000) duty += (Math.min(price, 925000) - 250000) * 0.05
  if (price > 925000) duty += (Math.min(price, 1500000) - 925000) * 0.10
  if (price > 1500000) duty += (price - 1500000) * 0.12

  // Additional property surcharge: 5% on full purchase price (from 31 Oct 2024)
  if (isAdditional) duty += price * 0.05

  return Math.round(duty)
}

// Mortgage repayment calculator
export function calcMonthlyRepayment(principal, ratePercent, termYears, interestOnly = false) {
  if (!principal || !ratePercent) return 0
  if (interestOnly) {
    // Interest only: (loan × rate) / 12
    return Math.round(principal * (ratePercent / 100) / 12)
  }
  // Repayment: standard amortisation formula
  if (!termYears) return 0
  const r = (ratePercent / 100) / 12
  const n = termYears * 12
  return Math.round(principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1))
}

// ── PROPERTY HEALTH SCORE ─────────────────────────────────────────────────────
export function calcPropertyHealthScore(property, compliance=[], tenancy=null, maintenance=[], rentPayments=[]) {
  // Returns 0-100 score with breakdown
  let score = 100
  const issues = []
  const today = new Date()

  // Compliance (max -40 points)
  const expiryFields = [
    { key:'gas_safety_expiry',    label:'Gas Safety', critical:true },
    { key:'eicr_expiry',          label:'EICR',        critical:true },
    { key:'epc_expiry',           label:'EPC',         critical:false },
    { key:'hmo_licence_expiry',   label:'HMO Licence', critical:true },
  ]
  compliance.forEach(c => {
    if (!c.expiry_date) return
    const exp = new Date(c.expiry_date)
    const daysLeft = (exp - today) / (1000*60*60*24)
    if (daysLeft < 0) { score -= 20; issues.push({ type:'error', text:`${c.title || c.item_type} expired` }) }
    else if (daysLeft < 30) { score -= 10; issues.push({ type:'warning', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
    else if (daysLeft < 90) { score -= 3; issues.push({ type:'info', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
  })

  // Rent arrears (max -25 points). 'missed' is the legacy value for
  // pre-2026-05-25 rows; we accept either until the DB is fully migrated.
  const overduePayments = rentPayments.filter(p => p.status === 'overdue' || p.status === 'missed')
  if (overduePayments.length > 0) {
    score -= Math.min(25, overduePayments.length * 10)
    issues.push({ type:'error', text:`${overduePayments.length} overdue rent payment${overduePayments.length>1?'s':''}` })
  }

  // Open maintenance (max -20 points)
  const openJobs = maintenance.filter(m => m.status !== 'complete')
  const urgentJobs = openJobs.filter(m => m.priority === 'urgent')
  if (urgentJobs.length) { score -= 15; issues.push({ type:'error', text:`${urgentJobs.length} urgent repair${urgentJobs.length>1?'s':''} open` }) }
  else if (openJobs.length) { score -= Math.min(10, openJobs.length * 3); issues.push({ type:'warning', text:`${openJobs.length} open repair job${openJobs.length>1?'s':''}` }) }

  // Tenancy (max -15 points)
  if (tenancy?.tenancy_end) {
    const end = new Date(tenancy.tenancy_end)
    const daysToEnd = (end - today) / (1000*60*60*24)
    if (daysToEnd < 0) { score -= 15; issues.push({ type:'error', text:'Tenancy has ended' }) }
    else if (daysToEnd < 30) { score -= 10; issues.push({ type:'warning', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
    else if (daysToEnd < 90) { score -= 5; issues.push({ type:'info', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
  }

  // Vacant property
  if (property.status === 'vacant') {
    score -= 5
    issues.push({ type:'info', text:'Property currently vacant' })
  }

  const clamped = Math.max(0, Math.min(100, score))
  const grade = clamped >= 90 ? 'A' : clamped >= 75 ? 'B' : clamped >= 60 ? 'C' : clamped >= 40 ? 'D' : 'F'
  const color = clamped >= 90 ? '#2ECC8A' : clamped >= 75 ? '#4B8FE0' : clamped >= 60 ? '#C8A84B' : clamped >= 40 ? '#E0943A' : '#E05555'
  return { score: clamped, grade, color, issues }
}

// ═════════════════════════════════════════════════════════════════════════════
// DEAL SCORING — DSCR, ROI, Stress Test, Overall Score (0-100)
// ═════════════════════════════════════════════════════════════════════════════

// Debt Service Coverage Ratio: annual rent / annual mortgage payment
// Lenders typically want 1.25+, stress-tested at 5.5%-6% interest rates
export function calcDSCR(annualRent, annualMortgagePayment) {
  if (!annualMortgagePayment || annualMortgagePayment <= 0) return null  // cash purchase
  return annualRent / annualMortgagePayment
}

// Stress test: DSCR at higher interest rates
export function calcStressTest(loanAmount, termYears, annualRent, currentRate) {
  // No loan = no stress test to do (cash purchase, or unanalysed deal).
  // Return null so callers can simply skip rendering — they all guard with
  // `stressData && stressData.map(...)`. (Previously this returned
  // `{ cash: true }` which is truthy but not an array, causing
  // `stressData.map is not a function` on brand-new empty deals.)
  if (!loanAmount || loanAmount <= 0) return null
  const rates = [currentRate, currentRate + 1, currentRate + 2, currentRate + 3]
  return rates.map(rate => {
    // Interest-only mortgage payment approximation (more conservative)
    const monthlyPayment = (loanAmount * (rate / 100)) / 12
    const annualPayment = monthlyPayment * 12
    const dscr = annualPayment > 0 ? annualRent / annualPayment : null
    return {
      rate,
      monthlyPayment,
      annualPayment,
      dscr,
      passes: dscr !== null && dscr >= 1.25,
    }
  })
}

// Cash-on-cash return: annual profit / cash invested
export function calcCashOnCash(annualProfit, totalCashInvested) {
  if (!totalCashInvested || totalCashInvested <= 0) return null
  return (annualProfit / totalCashInvested) * 100
}

// LTV (loan-to-value) percentage
export function calcLTV(loanAmount, propertyValue) {
  if (!propertyValue || propertyValue <= 0) return null
  return (loanAmount / propertyValue) * 100
}

// Overall deal score 0-100 — weighted across key metrics
export function calcDealScore(deal) {
  const purchasePrice = deal.purchase_price || 0
  if (purchasePrice <= 0) return { score: 0, breakdown: {}, rating: 'insufficient-data' }

  const grossRentPcm = deal.expected_rent || deal.rent_pcm || 0
  const annualRent = grossRentPcm * 12
  const grossYield = (annualRent / purchasePrice) * 100

  const isCash = deal.purchase_type === 'cash'
  const depositPercent = deal.deposit_percent || 25
  const loanAmount = isCash ? 0 : purchasePrice * (1 - depositPercent / 100)
  const mortgageRate = deal.mortgage_rate || 5
  const annualMortgage = isCash ? 0 : loanAmount * (mortgageRate / 100) // interest-only approx

  const operatingCosts = (deal.insurance || 0) + (deal.maintenance_budget || annualRent * 0.1) + (deal.management_fee_percent ? annualRent * (deal.management_fee_percent / 100) : 0)
  const annualProfit = annualRent - annualMortgage - operatingCosts

  const sd = deal.stamp_duty_override ?? 0
  const totalCost = purchasePrice + sd + (deal.legal_fees || 0) + (deal.survey_cost || 0) + (deal.refurb_cost || 0) + (deal.other_costs || 0)
  const cashIn = isCash ? totalCost : totalCost - loanAmount

  const dscr = calcDSCR(annualRent, annualMortgage)
  const cashOnCash = calcCashOnCash(annualProfit, cashIn)
  const ltv = isCash ? 0 : calcLTV(loanAmount, purchasePrice)

  // Stress test — does DSCR at +2% interest still pass?
  const stressRate = mortgageRate + 2
  const stressAnnualMortgage = isCash ? 0 : loanAmount * (stressRate / 100)
  const stressDscr = isCash ? null : annualRent / stressAnnualMortgage
  const stressPasses = isCash || (stressDscr !== null && stressDscr >= 1.25)

  // Scoring (0-100 weighted)
  let score = 0
  const breakdown = {}

  // Gross yield (25 points)
  const yieldPoints = grossYield >= 10 ? 25 : grossYield >= 8 ? 22 : grossYield >= 6 ? 17 : grossYield >= 5 ? 12 : grossYield >= 4 ? 7 : 2
  breakdown.yield = { value: grossYield.toFixed(2) + '%', points: yieldPoints, max: 25 }
  score += yieldPoints

  // DSCR (25 points) — only for mortgaged deals
  if (!isCash) {
    const dscrPoints = dscr >= 1.5 ? 25 : dscr >= 1.25 ? 20 : dscr >= 1.1 ? 12 : dscr >= 1.0 ? 5 : 0
    breakdown.dscr = { value: dscr?.toFixed(2), points: dscrPoints, max: 25 }
    score += dscrPoints
  } else {
    breakdown.dscr = { value: 'Cash (N/A)', points: 25, max: 25 }
    score += 25
  }

  // Stress test resilience (20 points)
  const stressPoints = stressPasses ? 20 : isCash ? 20 : stressDscr >= 1.0 ? 10 : 0
  breakdown.stress = { value: isCash ? 'Cash (resilient)' : `${stressDscr?.toFixed(2)} @ +2%`, points: stressPoints, max: 20 }
  score += stressPoints

  // Cash-on-cash return (15 points)
  const cocPoints = cashOnCash >= 15 ? 15 : cashOnCash >= 10 ? 12 : cashOnCash >= 7 ? 9 : cashOnCash >= 5 ? 6 : cashOnCash >= 3 ? 3 : 0
  breakdown.cash_on_cash = { value: (cashOnCash || 0).toFixed(1) + '%', points: cocPoints, max: 15 }
  score += cocPoints

  // LTV (15 points) — lower LTV is safer
  const ltvPoints = isCash ? 15 : ltv <= 60 ? 15 : ltv <= 70 ? 12 : ltv <= 75 ? 9 : ltv <= 80 ? 5 : 2
  breakdown.ltv = { value: isCash ? 'Cash (0%)' : ltv?.toFixed(0) + '%', points: ltvPoints, max: 15 }
  score += ltvPoints

  const rating = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'marginal' : 'poor'

  return {
    score: Math.round(score),
    rating,
    breakdown,
    metrics: {
      grossYield,
      dscr,
      stressDscr,
      stressPasses,
      cashOnCash,
      ltv,
      annualRent,
      annualMortgage,
      annualProfit,
      cashIn,
      loanAmount,
    },
  }
}
