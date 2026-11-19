// ── GROUP PURCHASES ─────────────────────────────────────────────────────────
// One acquisition covering several units, e.g. 31–34 Lyndhurst Terrace bought
// as one lot and let as four flats (deals.parent_deal_id, migration
// 2026-11-19_deal_group_refurb_link.sql).
//
// Rules this file keeps:
//   - The PARENT carries the cash commitment: its cost lines and funding.
//   - A child (unit) is a deal whose parent_deal_id points at a deal that is
//     present in the same list, not deleted and not fallen through. Its own
//     cost lines are an allocation of the parent's cost: they are shown, but
//     never added again to cash need, funding gap, cashflow or export totals.
//   - If the parent is missing (deleted, filtered out, in another company,
//     not visible) or fallen through, the child stands alone and is counted,
//     with a data-quality note. Unknown is never silently dropped.
//   - A loop of links (A → B → A) is broken the same way: each deal in the
//     loop stands alone, so nothing is under-counted.
//
// Pure: no React, no DB.

const nameOf = d => d?.name || d?.address || 'Untitled deal'

const ORPHAN_TEXT = {
  missing: 'its group purchase parent is not in this list (deleted, filtered out or in another company), so it is counted on its own',
  dead: 'its group purchase parent has fallen through, so it is counted on its own',
  deleted: 'its group purchase parent is deleted, so it is counted on its own',
  self: 'it is marked as its own group parent, so it is counted on its own',
  cycle: 'its group purchase links form a loop, so it is counted on its own',
}

/**
 * Work out which deals in a list are units of a present parent.
 * Returns {
 *   parentOf:   Map(childId → parent deal)       counted on the parent
 *   childrenOf: Map(parentId → [child deals])    sorted by name
 *   orphans:    Map(childId → { reason, text })  parent_deal_id set but standalone
 *   isUnit(d), parentFor(d), unitsOf(d), orphanFor(d)
 * }
 */
export function resolveDealGroups(deals = []) {
  const list = (deals || []).filter(Boolean)
  const byId = new Map(list.map(d => [d.id, d]))
  const parentOf = new Map()
  const childrenOf = new Map()
  const orphans = new Map()

  const loops = d => {
    // Walk up from d's parent; a loop is any return to a deal already seen.
    const seen = new Set([d.id])
    let cur = byId.get(d.parent_deal_id)
    while (cur) {
      if (seen.has(cur.id)) return true
      seen.add(cur.id)
      cur = cur.parent_deal_id ? byId.get(cur.parent_deal_id) : null
    }
    return false
  }

  for (const d of list) {
    if (!d.parent_deal_id) continue
    const p = byId.get(d.parent_deal_id)
    let reason = null
    if (d.parent_deal_id === d.id) reason = 'self'
    else if (!p) reason = 'missing'
    else if (p.deleted_at) reason = 'deleted'
    else if (p.status === 'dead') reason = 'dead'
    else if (loops(d)) reason = 'cycle'
    if (reason) { orphans.set(d.id, { reason, text: ORPHAN_TEXT[reason] }); continue }
    parentOf.set(d.id, p)
    const arr = childrenOf.get(p.id) || []
    arr.push(d)
    childrenOf.set(p.id, arr)
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

  return {
    parentOf, childrenOf, orphans,
    isUnit: d => !!d && parentOf.has(d.id),
    parentFor: d => (d ? parentOf.get(d.id) || null : null),
    unitsOf: d => (d ? childrenOf.get(d.id) || [] : []),
    orphanFor: d => (d ? orphans.get(d.id) || null : null),
  }
}

/**
 * Put each unit straight after its parent, keeping everything else in the
 * order given. Units whose parent is not in `items` stay where they are.
 *   items   already sorted rows
 *   idOf    item → deal id
 *   parentIdOf item → parent deal id when the item is a counted unit, else null
 */
export function orderUnitsUnderParents(items = [], idOf = x => x.id, parentIdOf = x => x.parentId || null) {
  const ids = new Set(items.map(idOf))
  const units = new Map()
  const top = []
  for (const it of items) {
    const pid = parentIdOf(it)
    if (pid && ids.has(pid) && pid !== idOf(it)) {
      const arr = units.get(pid) || []
      arr.push(it)
      units.set(pid, arr)
    } else top.push(it)
  }
  const out = []
  const placed = new Set()
  const place = it => {
    const id = idOf(it)
    if (placed.has(id)) return
    placed.add(id)
    out.push(it)
    for (const u of units.get(id) || []) place(u)
  }
  top.forEach(place)
  // Anything left (only possible in a loop) keeps its place at the end.
  for (const it of items) if (!placed.has(idOf(it))) { placed.add(idOf(it)); out.push(it) }
  return out
}

/** Every deal below `deal` in the group tree (children, their children, …). */
export function descendantIds(deal, deals = []) {
  const out = new Set()
  if (!deal?.id) return out
  const byParent = new Map()
  for (const d of deals || []) {
    if (!d?.parent_deal_id) continue
    const arr = byParent.get(d.parent_deal_id) || []
    arr.push(d.id)
    byParent.set(d.parent_deal_id, arr)
  }
  const stack = [...(byParent.get(deal.id) || [])]
  while (stack.length) {
    const id = stack.pop()
    if (id === deal.id || out.has(id)) continue
    out.add(id)
    stack.push(...(byParent.get(id) || []))
  }
  return out
}

/**
 * Deals that may be chosen as the group parent of `deal`: same company, not
 * itself, none of its own units (or their units), not deleted or fallen
 * through, and not one whose own parent chain runs back through `deal`
 * (a two-step loop). Sorted by name.
 */
export function groupParentOptions(deal, deals = []) {
  if (!deal) return []
  const below = descendantIds(deal, deals)
  const byId = new Map((deals || []).filter(Boolean).map(d => [d.id, d]))
  const chainHits = cand => {
    const seen = new Set()
    let cur = cand
    while (cur && !seen.has(cur.id)) {
      if (cur.id === deal.id) return true
      seen.add(cur.id)
      cur = cur.parent_deal_id ? byId.get(cur.parent_deal_id) : null
    }
    return false
  }
  return (deals || [])
    .filter(d => d && d.id !== deal.id
      && (d.company_id || null) === (deal.company_id || null)
      && !d.deleted_at && d.status !== 'dead'
      && !below.has(d.id)
      && !chainHits(d))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}

/** True when setting `parentId` on `deal` would create a loop. */
export function wouldCreateLoop(deal, parentId, deals = []) {
  if (!deal || !parentId) return false
  if (parentId === deal.id) return true
  return descendantIds(deal, deals).has(parentId)
}

/**
 * Badge text for list and board cards: "Group · 4 units" on a parent,
 * "Unit of <parent>" on a counted child, null otherwise.
 */
export function groupBadge(deal, groups) {
  if (!deal || !groups) return null
  const units = groups.unitsOf(deal)
  if (units.length) return { kind: 'parent', label: `Group · ${units.length} unit${units.length === 1 ? '' : 's'}` }
  const p = groups.parentFor(deal)
  if (p) return { kind: 'unit', label: `Unit of ${nameOf(p)}`, parentId: p.id }
  return null
}

export const dealDisplayName = nameOf
