// Pure helpers behind the dashboard's headline signals: the portfolio
// health ring and the "In refurbishment" KPI. No React, no I/O.
//
// Both exist so the dashboard can't contradict itself. Before 2026-10 the
// health ring averaged per-property scores that only looked at dated
// compliance rows, so a portfolio with expired gas certificates and missing
// EICRs could read "95 · Good standing" right next to a red 0/6 Portfolio
// Compliance card. And "In refurbishment" counted only refurb_status, so a
// property marked Refurb (or with a live project on the Refurbs page) read 0.

import { propertyComplianceSummary } from './complianceStatus'

// Health bands, shared with HealthRing so label and colour can't drift from
// the caps applied below.
export const HEALTH_BANDS = { good: 80, attention: 60 }

export function healthBand(score) {
  if (score >= HEALTH_BANDS.good) return 'good'
  if (score >= HEALTH_BANDS.attention) return 'attention'
  return 'action'
}

// Per-property caps. A property with an expired legal certificate cannot
// score in the "attention" band or above; one with any other expired item,
// a legal item missing, or money owed cannot read as good standing.
export const CAP_EXPIRED_LEGAL = 55
export const CAP_EXPIRED = 70
export const CAP_MISSING_LEGAL = 70
export const CAP_ARREARS = 75

const isLegal = r => !!r.req && r.req.tier <= 2

// Legal (tier 1-2) gaps for one property from the compliance rollup.
export function legalComplianceGaps(summary) {
  const g = complianceGaps(summary)
  return { expired: g.expiredLegal, missing: g.missingLegal }
}

// Every gap the health score reacts to, on the Portfolio Compliance card's
// own definitions: `expired` is every expired row at any tier (the card's
// s.expired, which turns it red), `expiredLegal` the tier 1-2 share of it,
// and `missingLegal` the tier 1-2 rows with nothing on file (the card's
// "missing required").
export function complianceGaps(summary) {
  let expired = 0, expiredLegal = 0, missingLegal = 0
  for (const r of summary?.rows || []) {
    if (r.status.state === 'expired') {
      expired++
      if (isLegal(r)) expiredLegal++
    } else if (r.status.state === 'missing' && isLegal(r)) missingLegal++
  }
  return { expired, expiredLegal, expiredOther: expired - expiredLegal, missingLegal }
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Portfolio health from per-property base scores plus the same compliance
// rollup the Portfolio Compliance card uses.
//
//   properties  [{ property, baseScore, compliance }]
//               compliance = propertyComplianceSummary(...) (optional)
//
// Returns { score, band, reasons: [string], counts }.
export function portfolioHealth(properties) {
  const list = properties || []
  const counts = { expired: 0, expiredLegal: 0, expiredOther: 0, missingLegal: 0, inArrears: 0 }
  if (!list.length) return { score: 100, band: 'good', reasons: [], counts }
  let sum = 0, propsExpiredLegal = 0
  for (const { property, baseScore, compliance } of list) {
    let s = Number.isFinite(baseScore) ? baseScore : 100
    const g = complianceGaps(compliance)
    counts.expired += g.expired
    counts.expiredLegal += g.expiredLegal
    counts.expiredOther += g.expiredOther
    counts.missingLegal += g.missingLegal
    // Each gap still costs points within the cap, so ten missing items read
    // worse than one. Legal items cost more than the rest.
    s -= g.expiredLegal * 10 + g.expiredOther * 5 + g.missingLegal * 4
    if (g.expiredLegal > 0) { s = Math.min(s, CAP_EXPIRED_LEGAL); propsExpiredLegal++ }
    else if (g.expired > 0) s = Math.min(s, CAP_EXPIRED)
    else if (g.missingLegal > 0) s = Math.min(s, CAP_MISSING_LEGAL)
    if ((Number(property?.arrears) || 0) > 0) { s = Math.min(s, CAP_ARREARS); counts.inArrears++ }
    sum += Math.max(0, Math.min(100, s))
  }
  let score = Math.round(sum / list.length)
  // Portfolio-level label caps. Anything that turns the Portfolio Compliance
  // card red (an expired item at any tier, or a legal item missing), or
  // arrears, means the portfolio is not in good standing however healthy the
  // other properties are. A majority of properties with expired legal certs
  // means action is needed.
  if (counts.expired > 0 || counts.missingLegal > 0 || counts.inArrears > 0) score = Math.min(score, HEALTH_BANDS.good - 1)
  if (propsExpiredLegal * 2 >= list.length && propsExpiredLegal > 0) score = Math.min(score, HEALTH_BANDS.attention - 1)
  const reasons = []
  if (counts.expiredLegal) reasons.push(count(counts.expiredLegal, 'expired legal item', 'expired legal items'))
  if (counts.expiredOther) reasons.push(count(counts.expiredOther, 'other expired item', 'other expired items'))
  if (counts.missingLegal) reasons.push(count(counts.missingLegal, 'missing legal item', 'missing legal items'))
  if (counts.inArrears) reasons.push(count(counts.inArrears, 'property', 'properties') + ' in arrears')
  return { score, band: healthBand(score), reasons, counts }
}

const isTracked = p => !!p && p.status !== 'sold' && !p.archived_at

// Compliance rollup for every tracked property (sold / archived skipped), as
// a Map keyed by the property row. The dashboard computes this once per
// change of inputs (useComplianceSummaries) and shares it between the
// health ring and the Portfolio Compliance card, so both read one rollup.
export function complianceSummariesFor(props, companySettings, policies) {
  const out = new Map()
  for (const p of props || []) {
    if (!isTracked(p)) continue
    out.set(p, propertyComplianceSummary(p, companySettings?.[p.company_id] || {}, policies || []))
  }
  return out
}

// Convenience wrapper used by the dashboard: builds the per-property inputs
// from the same sources as the Portfolio Compliance card. Pass `summaries`
// (from complianceSummariesFor) to reuse a rollup already computed;
// otherwise it is computed here from settingsFor / policies.
export function portfolioHealthFor(props, { baseScoreFor, settingsFor, policies, summaries } = {}) {
  return portfolioHealth((props || []).map(p => ({
    property: p,
    baseScore: baseScoreFor ? baseScoreFor(p) : 100,
    compliance: !isTracked(p) ? null
      : summaries ? (summaries.get(p) || null)
      : propertyComplianceSummary(p, settingsFor ? settingsFor(p) : {}, policies || []),
  })))
}

// ── Refurbishment ─────────────────────────────────────────────────────────
const LIVE_STAGES = new Set(['in_progress', 'in-progress', 'snagging'])

const liveProjects = p => (p?.refurb_projects || []).filter(r => r && !r.deleted_at)
const projectStage = r => r.stage || r.status

// Is the property being refurbished right now? Any of: property status
// Refurb, the refurb_status mirror reading in-progress, or a live project
// in progress / snagging on the Refurbs page.
export function isInRefurb(p) {
  if (!p) return false
  if (p.status === 'refurb') return true
  if (p.refurb_status === 'in-progress' || p.refurb_status === 'in_progress') return true
  return liveProjects(p).some(r => LIVE_STAGES.has(projectStage(r)))
}

// Counts for the In Refurbishment KPI. `activeProjects` matches the Refurbs
// page's "active" definition (live and not complete, so planned and on-hold
// count too).
export function refurbSummary(props) {
  const list = props || []
  const inRefurb = list.filter(isInRefurb)
  const projects = list.flatMap(liveProjects)
  return {
    properties: inRefurb,
    count: inRefurb.length,
    activeProjects: projects.filter(r => projectStage(r) !== 'complete').length,
    planned: list.filter(p => !isInRefurb(p) && (p.refurb_status === 'planned' || liveProjects(p).some(r => projectStage(r) === 'planned'))).length,
    completed: list.filter(p => p.refurb_status === 'complete').length,
  }
}

// ── KPI grid layout ───────────────────────────────────────────────────────
// Balanced column count for `count` cards in a container `width` px wide.
// Fits as many MIN-wide columns as the width allows, then evens the rows
// out so 8 cards lay out 4 + 4 rather than 5 + 3 with a hole at the end.
export function balancedColumns(count, width, { min = 220, gap = 10, max = 5 } = {}) {
  if (count <= 0) return 1
  const fit = Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap))))
  const rows = Math.ceil(count / fit)
  return Math.max(1, Math.ceil(count / rows))
}
