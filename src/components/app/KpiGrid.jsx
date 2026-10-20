import { useEffect, useRef, useState } from 'react'
import { balancedColumns } from '../../lib/dashboardKpis'

// Dashboard KPI grid. Measures its own width (not the viewport — the left
// rail and padding vary) and picks a balanced column count. Columns are
// minmax(0, 1fr) so long labels or tables inside a card can never push the
// grid wider than the page; rows stretch so cards in a row share a height.
export function KpiGrid({ count, isMobile, children }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Before the first measure fall back to something sensible for the
  // device so there's no flash of a single wide column on desktop.
  const cols = width > 0 ? balancedColumns(count, width) : (isMobile ? 1 : Math.min(count, 4))
  return (
    <div ref={ref} style={{display:'grid',gridTemplateColumns:`repeat(${cols}, minmax(0, 1fr))`,gap:10,minWidth:0}}>
      {children}
    </div>
  )
}
