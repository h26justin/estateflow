// Shimmer skeleton primitives (redesign Loading state). The `.skeleton`
// shimmer class lives in App.jsx's global stylesheet, so these work anywhere
// inside the app shell. Prefer a skeleton that mirrors the real layout over
// a spinner or a bare "Loading…" — the page shouldn't jump when data lands.
import { useTheme } from './ThemeContext'

export const Skeleton = ({ w = '100%', h = 14, r = 8, style }) =>
  <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />

// Table-shaped placeholder: a header bar + N rows.
export function SkeletonRows({ rows = 6, height = 40 }) {
  const { T } = useTheme()
  return (
    <div aria-busy="true" aria-label="Loading" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
        <Skeleton w="40%" h={12} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '0 16px', height, borderBottom: i < rows - 1 ? `1px solid ${T.border}` : 'none' }}>
          <Skeleton w="30%" h={12} />
          <Skeleton w="15%" h={12} />
          <Skeleton w="15%" h={12} />
          <Skeleton w="10%" h={12} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

// KPI-strip placeholder: N stat tiles.
export function SkeletonTiles({ count = 4 }) {
  const { T } = useTheme()
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }}>
          <Skeleton w={34} h={34} r={9} style={{ marginBottom: 12 }} />
          <Skeleton w="60%" h={10} style={{ marginBottom: 10 }} />
          <Skeleton w="80%" h={20} />
        </div>
      ))}
    </div>
  )
}

// Simple stacked-card list placeholder.
export function SkeletonList({ count = 4, height = 72 }) {
  const { T } = useTheme()
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '16px 18px', height }}>
          <Skeleton w="35%" h={13} style={{ marginBottom: 10 }} />
          <Skeleton w="60%" h={10} />
        </div>
      ))}
    </div>
  )
}
