import { useCallback, useEffect, useRef } from 'react'

// Stale-response guard for components that load data on mount / on a prop
// change and also re-run the same loader from handlers (after a save, an
// upload, ...).
//
//   const beginLoad = useLoadGuard()
//   async function loadDocs() {
//     const isCurrent = beginLoad()
//     setLoading(true)
//     const rows = await api.fetchDocs(propertyId)
//     if (!isCurrent()) return          // superseded, or unmounted
//     setDocs(rows); setLoading(false)
//   }
//
// Each beginLoad() call supersedes every earlier one, so when propertyId
// changes A -> B and A's response lands after B's, A's result is dropped
// instead of overwriting B's. Unmounting invalidates everything in flight.
// The loader keeps its existing shape and call sites, which is the point:
// the guard bolts onto code that already works without restructuring it.
export function useLoadGuard() {
  const seqRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; seqRef.current += 1 }
  }, [])
  return useCallback(() => {
    const seq = ++seqRef.current
    return () => mountedRef.current && seqRef.current === seq
  }, [])
}
