import { useEffect, useRef } from 'react'

// Put the user back where they were once a search or filter is cleared.
//
// A long list (the Rent Tracker across four companies, the Portfolio) is
// narrowed by a search; the page becomes short and the browser clamps the
// scroll position to the top. Clearing the search brings the whole list back
// but the position is gone, so every lookup ends with a scroll back down to
// the company that was being worked through (Tiffany, 15 Sept 2026).
//
// `narrowing` is true while any search or filter is in force. The hook keeps
// the last scroll position seen while NOT narrowing, remembers it the moment
// narrowing begins, and restores it two frames after narrowing ends so the
// full list has painted first. Company selection, expanded sections and the
// year are component state and survive on their own; this covers the one
// thing the browser throws away.
export function useScrollRestoreOnClear(narrowing) {
  const lastY = useRef(0)
  const saved = useRef(null)
  const wasNarrowing = useRef(narrowing)

  // Track the position only while the full list is showing.
  useEffect(() => {
    if (narrowing) return
    const onScroll = () => { lastY.current = window.scrollY || 0 }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [narrowing])

  useEffect(() => {
    if (narrowing && !wasNarrowing.current) saved.current = lastY.current
    if (!narrowing && wasNarrowing.current && saved.current != null) {
      const y = saved.current
      saved.current = null
      wasNarrowing.current = narrowing
      const outer = requestAnimationFrame(() => {
        requestAnimationFrame(() => { try { window.scrollTo({ top: y }) } catch { window.scrollTo(0, y) } })
      })
      return () => cancelAnimationFrame(outer)
    }
    wasNarrowing.current = narrowing
  }, [narrowing])
}
