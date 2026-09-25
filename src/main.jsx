import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/AuthContext'
import { ThemeProvider } from './lib/ThemeContext'
import { ConfirmProvider } from './lib/ConfirmContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App'
import { installGlobalErrorReporting, CHUNK_RELOADING_KEY } from './lib/errorReporter'

// Uncaught errors and unhandled promise rejections outside React's render
// tree (event handlers, async api calls) never reach the ErrorBoundary.
installGlobalErrorReporting()
// A fresh boot means any chunk reload has completed; see errorReporter.js.
try { sessionStorage.removeItem(CHUNK_RELOADING_KEY) } catch { /* ignore */ }

// A deploy while someone has the app open leaves their shell pointing at
// hashed chunks that no longer exist; the next lazy route then fails with
// "Failed to fetch dynamically imported module" and, until 2026-09-07, the
// ErrorBoundary took over every route after that. Vite raises this event for
// exactly that failure; reload once to pick up the new shell. The session
// flag stops a genuine outage becoming a reload loop.
window.addEventListener('vite:preloadError', (e) => {
  const key = 'ef_chunk_reload'
  let last = 0
  try { last = Number(sessionStorage.getItem(key)) || 0 } catch { /* ignore */ }
  if (Date.now() - last < 30_000) return   // already tried in the last 30s; let the boundary show (and report) it
  try {
    sessionStorage.setItem(key, String(Date.now()))
    sessionStorage.setItem(CHUNK_RELOADING_KEY, '1')   // tells errorReporter this crash is handled
  } catch { /* ignore */ }
  e.preventDefault?.()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ThemeProvider>
    </ErrorBoundary>
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
)
