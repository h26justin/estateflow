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
export function resolveWidgetPrefs(saved, defaultOrder, defaultEnabled = {}) {
  const isOn = k => defaultEnabled[k] !== false
  if (!saved || saved.length === 0) return defaultOrder.map(k => ({ key: k, enabled: isOn(k) }))
  const out = saved.map(w => ({ key: w.key, enabled: !!w.enabled }))
  const have = new Set(out.map(w => w.key))
  defaultOrder.forEach((k, i) => {
    if (have.has(k)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex(w => w.key === defaultOrder[j])
      if (idx !== -1) { at = idx + 1; break }
    }
    out.splice(at, 0, { key: k, enabled: isOn(k) })
    have.add(k)
  })
  return out
}
