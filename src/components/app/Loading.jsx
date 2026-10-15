import { useTheme } from '../../lib/ThemeContext'
import { Skeleton } from '../../lib/Skeleton'

export const Spinner = () => {
  const { T } = useTheme()
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}>
    <div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
  </div>
}

// Full-viewport spinner used by Suspense fallbacks while a lazy-loaded
// page chunk is downloaded. Takes T directly because <Suspense> renders
// the fallback before any nested theme hooks resolve.
export function PageLoadingSpinner({ T }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 32, height: 32, border: `3px solid ${T.border}`, borderTopColor: T.gold, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )
}

// Skeleton primitives live in lib/Skeleton.jsx (shared with page-level
// loading states across components).

// Dashboard loading state — greeting + health ring, 4 KPI tiles, two widget
// columns — mirrors the real layout so the page doesn't jump on load.
// Visually hidden but announced (the standard sr-only recipe).
export const SR_ONLY = { position:'absolute', width:1, height:1, padding:0, margin:-1, overflow:'hidden', clip:'rect(0,0,0,0)', whiteSpace:'nowrap', border:0 }

export function DashboardSkeleton() {
  const { T } = useTheme()
  const tile = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }
  return (
    <div aria-busy="true" aria-label="Loading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <Skeleton w="240px" h={30} style={{ marginBottom: 10 }} />
          <Skeleton w="320px" h={12} />
        </div>
        <Skeleton w={74} h={74} r="50%" />
      </div>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={tile}>
            <Skeleton w={34} h={34} r={9} style={{ marginBottom: 12 }} />
            <Skeleton w="60%" h={10} style={{ marginBottom: 10 }} />
            <Skeleton w="80%" h={20} />
          </div>
        ))}
      </div>
      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[0,1].map(col => (
          <div key={col} style={tile}>
            <Skeleton w="40%" h={12} style={{ marginBottom: 16 }} />
            {[0,1,2,3].map(r => (
              <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Skeleton w={32} h={32} r={8} />
                <div style={{ flex: 1 }}>
                  <Skeleton w="70%" h={11} style={{ marginBottom: 6 }} />
                  <Skeleton w="45%" h={9} />
                </div>
                <Skeleton w={54} h={12} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
