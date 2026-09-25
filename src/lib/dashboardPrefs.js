// Dashboard widget preference resolution. Pure, shared by the KPI grid
// renderer and the Customize modal so both agree on where a widget the user
// has never seen should appear and whether it starts enabled.

// Merge a user's saved widget prefs with the current defaults.
//
//   saved         [{key, enabled}] in the user's order, or null/empty
//   defaultOrder  every known key in default order
//   defaultEnabled {key: bool}; a missing key counts as enabled
//
// Keys the user has saved keep their order and enabled flag. A key they have
// never saved is inserted where the default order puts it: straight after the
// nearest key that precedes it in the default order and is present in their
// layout (or at the front when none is). Previously new widgets were appended
// at the end, which is how a pair of rent cards meant to sit beside Monthly
// Rental Income ended up alone on a third row.
//
// `opts.before` pins an unsaved key directly in front of a named key when that
// key is in the user's layout, whatever else they have reordered: e.g.
// { rent_income: 'kpi_grid' } puts the Rental Income section immediately above
// the KPI cards even for a user whose alerts and inbox sit below the grid.
// Once the user saves a layout containing the key, their position wins.
export function resolveWidgetPrefs(saved, defaultOrder, defaultEnabled = {}, opts = {}) {
  const isOn = k => defaultEnabled[k] !== false
  if (!saved || saved.length === 0) return defaultOrder.map(k => ({ key: k, enabled: isOn(k) }))
  const out = saved.map(w => ({ key: w.key, enabled: !!w.enabled }))
  const have = new Set(out.map(w => w.key))
  const before = opts.before || {}
  defaultOrder.forEach((k, i) => {
    if (have.has(k)) return
    let at = 0
    const anchor = before[k] ? out.findIndex(w => w.key === before[k]) : -1
    if (anchor !== -1) at = anchor
    else {
      for (let j = i - 1; j >= 0; j--) {
        const idx = out.findIndex(w => w.key === defaultOrder[j])
        if (idx !== -1) { at = idx + 1; break }
      }
    }
    out.splice(at, 0, { key: k, enabled: isOn(k) })
    have.add(k)
  })
  return out
}
