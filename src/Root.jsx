import { lazy, Suspense, startTransition, useRef, useState } from 'react'
import { useAuth } from './lib/AuthContext'
import { useTheme } from './lib/ThemeContext'
import { getSubdomain } from './lib/subdomain'
// Shared with App so its own <MarketingSite> doesn't suspend a second time.
import { MarketingSite } from './lib/lazyPages'

// The signed-in app (App.jsx and everything it imports) is several hundred
// KB. A logged-out visitor on the plain marketing homepage never needs it,
// so Root renders the marketing site on its own and only fetches App when
// the visitor asks for it (Sign in / Sign up / Privacy) or a session exists.
//
// Every other entry (a session, /privacy etc., any ?query such as an invite
// or tenant_invite, any #hash such as an auth redirect or deep link, a
// tenant-portal subdomain) goes straight to App, which keeps owning all of
// that logic exactly as before.
const loadApp = () => import('./App')
const App = lazy(loadApp)

export function isPlainMarketingVisit(loc = window.location, subdomain = getSubdomain()) {
  const hash = loc.hash || ''
  return loc.pathname === '/' && !loc.search && (hash === '' || hash === '#' || hash === '#/') && !subdomain
}

// supabase-js persists the session under sb-<ref>-auth-token. If one is
// stored (a returning signed-in user) or the URL is one App owns, start
// fetching App now, in parallel with the auth check, rather than after it.
function likelyNeedsApp() {
  if (!isPlainMarketingVisit()) return true
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true
    }
  } catch { /* storage blocked: wait for the auth check */ }
  return false
}
if (typeof window !== 'undefined' && likelyNeedsApp()) loadApp().catch(() => { /* surfaced on render */ })

function FullScreenSpinner() {
  const { T } = useTheme()
  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 32, height: 32, border: `3px solid ${T.border}`, borderTopColor: T.gold, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )
}

export default function Root() {
  const { session, loading } = useAuth()
  const [plainVisit] = useState(() => isPlainMarketingVisit())
  // Set once the visitor asks for something App owns; from then on App
  // stays mounted (it renders the marketing site itself after sign-out).
  const [appIntent, setAppIntent] = useState(null)
  const appMounted = useRef(false)
  // A transition keeps the marketing page on screen while App's chunk
  // downloads, instead of flashing the spinner fallback.
  const openApp = (intent) => startTransition(() => setAppIntent(intent))

  if (plainVisit && !appIntent && !session && !appMounted.current) {
    if (loading) return <FullScreenSpinner />
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <MarketingSite
          onSignIn={() => openApp({ loginMode: 'login' })}
          onSignUp={() => openApp({ loginMode: 'signup' })}
          onPrivacy={() => { window.history.pushState({}, '', '/privacy'); openApp({}) }}
        />
      </Suspense>
    )
  }
  appMounted.current = true
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <App initialLoginMode={appIntent?.loginMode || null} />
    </Suspense>
  )
}
