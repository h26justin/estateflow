// ── DEAL ↔ REFURB PROJECT LINK ──────────────────────────────────────────────
// A completed deal can be linked to its Refurbs project
// (deals.refurb_project_id, migration 2026-11-19_deal_group_refurb_link.sql)
// so the deal shows the project's budget and payments instead of its own
// estimate, and the app never creates a second project for the same works.
//
// A refurb project always belongs to a property (refurb_projects.property_id
// is NOT NULL). Deals have no property column, so before "Convert to
// property" a deal can only link to, or create, a project on a property that
// already exists (e.g. a unit of a building already in the portfolio).
// Matching is by company and by address / name.
//
// Pure: no React, no DB.

import { projectsFromProperties, isLiveProject } from './refurbs'
import { costCategoryGroup } from './dealFinance'
import { num } from './dealMetrics'

/** Lower-case letters and digits only, single spaces: "31-34 Lyndhurst Tce." → "31 34 lyndhurst tce". */
export function normaliseText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const sameText = (a, b) => { const x = normaliseText(a), y = normaliseText(b); return !!x && x === y }

// One address "contains" the other: "Flat 2, 31 Lyndhurst Terrace, Leeds"
// matches the building "31 Lyndhurst Terrace". Needs a few words, so a bare
// house number or town never matches on its own.
function addressOverlap(a, b) {
  const x = normaliseText(a), y = normaliseText(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.split(' ').length >= 3 && long.includes(short)
}

const propertyCompany = p => p?.company_id || null
const projectCompany = rp => rp?.company_id || rp?.property?.company_id || null

/** Properties that look like this deal's: same address (or name), not deleted or sold. Best match first. */
export function matchingProperties(deal = {}, properties = []) {
  const live = (properties || []).filter(p => p && !p.deleted_at && p.status !== 'sold')
  const score = p => {
    let s = 0
    if (sameText(p.address, deal.address) || sameText(p.name, deal.address)) s += 4
    else if (addressOverlap(p.address, deal.address) || addressOverlap(p.name, deal.address)) s += 2
    if (sameText(p.name, deal.name) || sameText(p.address, deal.name)) s += 3
    if (s && deal.company_id && propertyCompany(p) === deal.company_id) s += 1
    return s
  }
  return live.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.p)
}

/** Properties a new project could go on: the deal's company (or all when unassigned), matches first. */
export function propertiesForRefurb(deal = {}, properties = []) {
  const live = (properties || []).filter(p => p && !p.deleted_at && p.status !== 'sold')
  const pool = deal.company_id ? live.filter(p => propertyCompany(p) === deal.company_id) : live
  const matches = matchingProperties(deal, pool)
  const ids = new Set(matches.map(p => p.id))
  const rest = pool.filter(p => !ids.has(p.id)).sort((a, b) => String(a.name || a.address || '').localeCompare(String(b.name || b.address || '')))
  return [...matches, ...rest]
}

/**
 * Projects the deal could link to: live projects of the deal's company, or
 * on a property matching the deal's address. Each comes with `property`
 * attached and `linkedDeals` (other deals already linked to it).
 */
export function refurbProjectCandidates(deal = {}, properties = [], deals = []) {
  const projects = projectsFromProperties(properties).filter(p => !p.archived_at)
  const matchIds = new Set(matchingProperties(deal, properties).map(p => p.id))
  const linkedBy = new Map()
  for (const d of deals || []) {
    if (!d?.refurb_project_id || d.id === deal.id || d.deleted_at) continue
    const arr = linkedBy.get(d.refurb_project_id) || []
    arr.push(d)
    linkedBy.set(d.refurb_project_id, arr)
  }
  return projects
    .filter(rp => matchIds.has(rp.property_id) || rp.deal_id === deal.id
      || (deal.company_id ? projectCompany(rp) === deal.company_id : true))
    .map(rp => ({ ...rp, linkedDeals: linkedBy.get(rp.id) || [], matchesDeal: matchIds.has(rp.property_id) || rp.deal_id === deal.id }))
    .sort((a, b) => (b.matchesDeal - a.matchesDeal) || String(a.title || '').localeCompare(String(b.title || '')))
}

/** Find a project by id among the properties' embedded projects (live only). */
export function findRefurbProject(id, properties = [], extra = []) {
  if (!id) return null
  const all = [...projectsFromProperties(properties), ...(extra || [])]
  return all.find(p => p.id === id && isLiveProject(p)) || null
}

/**
 * An existing project that is (or may be) the same works as the one about to
 * be created: one already pointing at this deal, one on the chosen property,
 * or one titled like the deal's name or address. Null when none.
 * Returns { project, reason }.
 */
export function findDuplicateRefurbProject(deal = {}, properties = [], propertyId = null, extra = []) {
  const projects = [...projectsFromProperties(properties), ...(extra || []).filter(isLiveProject)]
  const byDeal = projects.find(p => p.deal_id && p.deal_id === deal.id)
  if (byDeal) return { project: byDeal, reason: 'It was already created from this deal.' }
  const onProperty = propertyId ? projects.find(p => p.property_id === propertyId && p.stage !== 'complete' && !p.archived_at) : null
  if (onProperty) return { project: onProperty, reason: 'That property already has a refurb project that is not complete.' }
  const byName = projects.find(p => {
    if (sameText(p.title, deal.name) || sameText(p.title, deal.address)) return true
    const prop = p.property
    return !!prop && p.stage !== 'complete' && (sameText(prop.address, deal.address) || sameText(prop.name, deal.name))
  })
  if (byName) return { project: byName, reason: 'A project with the same name or address already exists.' }
  return null
}

/** Budget for a new project: refurb + contingency cost lines when entered, else the deal's refurb cost. */
export function dealRefurbBudget(deal = {}, lines = []) {
  const refurbLines = (lines || []).filter(l => costCategoryGroup(l.category) === 'refurb')
  if (refurbLines.length) return { amount: Math.round(refurbLines.reduce((s, l) => s + num(l.amount) * 100, 0)) / 100, source: 'refurb cost lines' }
  const flat = num(deal.refurb_cost)
  return { amount: flat > 0 ? flat : 0, source: flat > 0 ? 'deal refurb cost' : null }
}

/** Insert fields for createRefurbProject, from the deal. */
export function refurbProjectFieldsFromDeal(deal = {}, property, lines = []) {
  const budget = dealRefurbBudget(deal, lines)
  const name = (deal.name || deal.address || 'Refurbishment').trim()
  const address = (deal.address || '').trim()
  return {
    property_id: property.id,
    company_id: property.company_id || deal.company_id || null,
    title: name,
    stage: 'planned',
    agreed_price: budget.amount,
    start_date: deal.refurb_start_date || null,
    target_end_date: deal.refurb_end_date || null,
    original_end_date: deal.refurb_end_date || null,
    deal_id: deal.id || null,
    expected_value_after: num(deal.brrr_end_value) || null,
    expected_rent_after: num(deal.monthly_rent) || null,
    funding: deal.purchase_type === 'bridge' ? 'bridge' : deal.purchase_type === 'cash' ? 'cash' : 'mortgage',
    notes: `Created from the deal "${name}"${address && address !== name ? ` (${address})` : ''}.`,
  }
}
