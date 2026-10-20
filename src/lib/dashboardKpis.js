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
// score in the "attention" band or above; one with a legal item missing or
// money owed cannot read as good standing.
export const CAP_EXPIRED_LEGAL = 55
export const CAP_MISSING_LEGAL = 70
export const CAP_ARREARS = 75

// Legal (tier 1-2) gaps for one property from the compliance rollup.
export function legalComplianceGaps(summary) {
  let expired = 0, missing = 0
  for (const r of summary?.rows || []) {
    if (!r.req || r.req.tier > 2) continue
    if (r.status.state === 'expired') expired++
    else if (r.status.state === 'missing') missing++
  }
  return { expired, missing }
}

// Portfolio health from per-property base scores plus the same compliance
// rollup the Portfolio Compliance card uses.
//
//   properties  [{ property, baseScore, compliance }]
//               compliance = propertyComplianceSummary(...) (optional)
//
// Returns { score, band, reasons: [string], counts }.
export function portfolioHealth(properties) {
  const list = properties || []
  if (!list.length) return { score: 100, band: 'good', reasons: [], counts: { expiredLegal: 0, missingLegal: 0, inArrears: 0 } }
  let sum = 0, expiredLegal = 0, missingLegal = 0, inArrears = 0, propsExpired = 0
  for (const { property, baseScore, compliance } of list) {
    let s = Number.isFinite(baseScore) ? baseScore : 100
    const gaps = legalComplianceGaps(compliance)
    expiredLegal += gaps.expired
    missingLegal += gaps.missing
    // Each gap still costs points within the cap, so ten missing items read
    // worse than one.
    s -= gaps.expired * 10 + gaps.missing * 4
    if (gaps.expired > 0) { s = Math.min(s, CAP_EXPIRED_LEGAL); propsExpired++ }
    else if (gaps.missing > 0) s = Math.min(s, CAP_MISSING_LEGAL)
    if ((Number(property?.arrears) || 0) > 0) { s = Math.min(s, CAP_ARREARS); inArrears++ }
    sum += Math.max(0, Math.min(100, s))
  }
  let score = Math.round(sum / list.length)
  // Portfolio-level label caps: any expired legal certificate, or any legal
  // item missing, means the portfolio is not in good standing however
  // healthy the other properties are. A majority of properties with expired
  // legal certs means action is needed.
  if (expiredLegal > 0 || missingLegal > 0 || inArrears > 0) score = Math.min(score, HEALTH_BANDS.good - 1)
  if (propsExpired * 2 >= list.length && propsExpired > 0) score = Math.min(score, HEALTH_BANDS.attention - 1)
  const reasons = []
  if (expiredLegal) reasons.push(`${expiredLegal} expired legal ${expiredLegal === 1 ? 'item' : 'items'}`)
  if (missingLegal) reasons.push(`${missingLegal} missing legal ${missingLegal === 1 ? 'item' : 'items'}`)
  if (inArrears) reasons.push(`${inArrears} ${inArrears === 1 ? 'property' : 'properties'} in arrears`)
  return { score, band: healthBand(score), reasons, counts: { expiredLegal, missingLegal, inArrears } }
}

// Convenience wrapper used by the dashboard: builds the per-property inputs
// from the same sources as the Portfolio Compliance card.
export function portfolioHealthFor(props, { baseScoreFor, settingsFor, policies } = {}) {
  return portfolioHealth((props || []).map(p => {
    const tracked = p.status !== 'sold' && !p.archived_at
    return {
      property: p,
      baseScore: baseScoreFor ? baseScoreFor(p) : 100,
      compliance: tracked ? propertyComplianceSummary(p, settingsFor ? settingsFor(p) : {}, policies || []) : null,
    }
  }))
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
