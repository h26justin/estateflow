import { lazy, Suspense } from 'react'

// Lazy page components shared by Root and App. One React.lazy object per
// page means once either has loaded it, the other renders it without
// suspending (and without a second spinner).
export const MarketingSite = lazy(() => import('../components/MarketingSite'))

// Code-split a component that is not needed for first paint (a modal, a
// detail-page panel) without touching its call sites: the returned
// component carries its own <Suspense>, so it can be dropped in wherever
// the static import was used, including outside any existing boundary.
// `pick` selects a named export.
export function lazyPanel(loader, { pick = 'default', fallback = null } = {}) {
  const Lazy = lazy(() => loader().then(m => ({ default: m[pick] })))
  function LazyPanel(props) {
    return <Suspense fallback={fallback}><Lazy {...props} /></Suspense>
  }
  return LazyPanel
}
