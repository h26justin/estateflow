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

import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function FocusTrap({ children, onEscape, initialFocusRef }) {
  const containerRef = useRef(null)
  const previousActiveRef = useRef(null)

  useEffect(() => {
    previousActiveRef.current = document.activeElement
    const container = containerRef.current
    if (!container) return

    // Move focus inside on next tick so any conditional children mount first
    const t = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const first = container.querySelector(FOCUSABLE)
      if (first) first.focus()
      else container.focus() // fall back to the container itself
    }, 0)

    function handleKeyDown(e) {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation()
        onEscape()
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
    <div ref={containerRef} tabIndex={-1} style={{ outline: 'none', width: '100%', display: 'flex', justifyContent: 'center' }}>
      {children}
    </div>
  )
}
