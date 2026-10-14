// pressable(fn, extra) — make a clickable non-button element keyboard and
// screen-reader operable without restyling it as a <button>.
//
//   <div {...pressable(() => openDetail(p))} style={…}>…</div>
//
// Spreads onClick plus role="button", tabIndex=0 and an onKeyDown that runs
// the same handler on Enter / Space (Space's page scroll is suppressed).
// Keys pressed inside a nested control (an input or button within a
// clickable card) are ignored, so typing a space in a child input doesn't
// also activate the card.
//
// `extra` overrides or adds attributes, e.g. a different role and its state:
//   pressable(toggle, { role: 'switch', 'aria-checked': on })
//   pressable(fn, { 'aria-expanded': isOpen })
// Pass role: null to keep the element's native role (table rows).

export function pressable(fn, extra = {}) {
  if (!fn) return {}
  const { role = 'button', ...rest } = extra
  return {
    ...(role ? { role } : null),
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fn(e)
      }
    },
    ...rest,
  }
}
