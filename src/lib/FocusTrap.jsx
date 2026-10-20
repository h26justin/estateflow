// FocusTrap — drop-in wrapper for modals/dialogs.
//
// Why: keyboard users (including most screen-reader users) need focus to
// stay inside an open modal. Without a trap, Tab walks them out into the
// page underneath, where the modal's backdrop visually covers the elements
// they're tabbing through. Escape also needs to dismiss.
//
// What it does:
//   1. On mount, moves focus to the first focusable element inside
//      (or to a passed `initialFocusRef` if provided), then remembers
//      whatever was focused before so we can restore it on close.
//   2. Intercepts Tab / Shift+Tab and cycles within the trap.
//   3. Listens for Escape and calls `onEscape` (typically the modal's
//      close handler).
//   4. On unmount, restores focus to whatever was focused before.
//
// Usage:
//   <FocusTrap onEscape={onClose}>
//     <div role="dialog" aria-modal="true" aria-labelledby="my-title">
//       <h2 id="my-title">…</h2>
//       …
//     </div>
//   </FocusTrap>
//
// We deliberately do NOT add the role/aria-* attributes ourselves — those
// belong on the modal's own root so each caller picks an appropriate
// labelling strategy.

import { createContext, useContext, useEffect, useRef, useState } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Open traps in registration order. Only the top one handles Tab / Escape,
// so a confirm opened over a modal doesn't also close the modal beneath it.
//
// Registration order alone is not stacking order: React runs a child's
// effects before its parent's, so when an outer and a nested trap mount in
// the same commit the outer registers last. Each trap therefore records its
// parent trap (through context, so it holds across portals too), and a trap
// that is an ancestor of another open trap is beneath it. The top is the
// most recently registered trap with no open descendant.
const openTraps = []
const ParentTrap = createContext(null)

function topTrap() {
  const covered = new Set()
  for (const t of openTraps) for (let p = t.parent; p; p = p.parent) covered.add(p)
  for (let i = openTraps.length - 1; i >= 0; i--) {
    if (!covered.has(openTraps[i])) return openTraps[i]
  }
  return null
}

export default function FocusTrap({ children, onEscape, initialFocusRef, style, ...rest }) {
  const containerRef = useRef(null)
  const parent = useContext(ParentTrap)
  // Stable identity for this trap; children read it as their parent.
  const [token] = useState(() => ({ parent }))
  const previousActiveRef = useRef(null)
  // Latest onEscape without re-running the mount effect (which would steal
  // focus back to the first field on every parent render).
  const onEscapeRef = useRef(onEscape)
  useEffect(() => { onEscapeRef.current = onEscape }, [onEscape])

  useEffect(() => {
    previousActiveRef.current = document.activeElement
    const container = containerRef.current
    if (!container) return
    openTraps.push(token)

    // Move focus inside on next tick so any conditional children mount first
    const t = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      // Respect an autoFocus that already landed inside (e.g. a prompt input).
      const active = document.activeElement
      if (active && active !== container && container.contains(active)) return
      const first = container.querySelector(FOCUSABLE)
      if (first) first.focus()
      else container.focus() // fall back to the container itself
    }, 0)

    function handleKeyDown(e) {
      if (topTrap() !== token) return
      if (e.key === 'Escape') {
        if (!onEscapeRef.current || e.defaultPrevented) return
        e.stopPropagation()
        onEscapeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = container.querySelectorAll(FOCUSABLE)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last  = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', handleKeyDown)
      const i = openTraps.indexOf(token)
      if (i !== -1) openTraps.splice(i, 1)
      // Restore focus to wherever the user came from. Wrap in try because
      // some elements (e.g. an element that was removed while the modal
      // was open) can't be re-focused.
      try { previousActiveRef.current?.focus?.() } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // width:100% + flex-center: this wrapper sits between the flex `.overlay`
    // and the `.modal` (width:100%; max-width:…). Left unstyled it becomes a
    // shrink-to-fit flex item, so `.modal`'s width:100% resolved against
    // content instead of the overlay — short-content modals rendered
    // narrower than their intended size.
    <div ref={containerRef} tabIndex={-1} style={{ outline: 'none', width: '100%', display: 'flex', justifyContent: 'center', ...style }} {...rest}>
      <ParentTrap.Provider value={token}>{children}</ParentTrap.Provider>
    </div>
  )
}
