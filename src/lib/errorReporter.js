// Client error telemetry.
//
// Until 2026-09-07 a crash in the app was visible only to the user who hit
// it: the ErrorBoundary showed a fallback and reported nowhere. This module
// posts one row per crash to public.client_errors (RLS: insert own, read
// developers only); the nightly audit summarises the last 24 hours.
//
// Deliberately small and defensive: it must never throw, never loop (an error
// inside the reporter is swallowed), never flood (same message within a
// minute is dropped, and a session sends at most MAX_PER_SESSION rows), and
// it sends nothing when there is no signed-in user, because the table only
// accepts rows about the caller.
import { supabase } from './supabase'

const MAX_PER_SESSION = 12
const DEDUPE_MS = 60_000
let sent = 0
const recent = new Map()   // message -> last sent ms

// A deploy while the app is open makes the next lazy route fail with a
// stale-chunk error. main.jsx reloads once on vite:preloadError and sets
// this sessionStorage flag just before it does; the flag is cleared again on
// boot. While it is set, the crash is being handled and is not reported.
// The second failure (reload already tried, so a genuine outage) has no flag
// and is reported.
export const CHUNK_RELOADING_KEY = 'ef_chunk_reloading'
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i

function chunkReloadInFlight() {
  try { return sessionStorage.getItem(CHUNK_RELOADING_KEY) === '1' } catch { return false }
}

function buildId() {
  try {
    const m = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src')?.match(/index-([A-Za-z0-9_-]+)\.js/)
    return m ? m[1] : null
  } catch { return null }
}

export function reportClientError({ message, stack, kind = 'error', component = null }) {
  try {
    const msg = String(message || 'Unknown error').slice(0, 2000)
    // Browser-extension and cross-origin noise adds nothing actionable.
    if (/ResizeObserver loop|Script error\.?$|chrome-extension:\/\//.test(msg)) return
    if (CHUNK_ERROR.test(msg) && chunkReloadInFlight()) return
    const now = Date.now()
    if (sent >= MAX_PER_SESSION) return
    const last = recent.get(msg)
    if (last && now - last < DEDUPE_MS) return
    recent.set(msg, now)
    sent++
    const row = {
      kind, message: msg,
      stack: stack ? String(stack).slice(0, 8000) : null,
      page: (typeof location !== 'undefined' ? location.hash || location.pathname : '').slice(0, 300),
      component: component ? String(component).slice(0, 200) : null,
      user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 400),
      build_id: buildId(),
    }
    // Fire and forget. A user with no session hits the RLS wall and we do not
    // care; the insert failing must never surface.
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session?.user) return
      return supabase.from('client_errors').insert({ ...row, user_id: data.session.user.id })
    }).catch(() => {})
  } catch { /* never let the reporter itself fail */ }
}

// Wire the two global hooks once. Safe to call more than once.
let installed = false
export function installGlobalErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', e => {
    reportClientError({ message: e?.message || String(e?.error || 'Error'), stack: e?.error?.stack, kind: 'error' })
  })
  window.addEventListener('unhandledrejection', e => {
    const r = e?.reason
    reportClientError({ message: r?.message || String(r || 'Unhandled rejection'), stack: r?.stack, kind: 'unhandledrejection' })
  })
}
