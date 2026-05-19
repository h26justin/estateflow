// Lightweight error logger.
//
// Use this inside `catch` blocks that would otherwise swallow real failures
// (API calls, auth, permission loading). Plain `catch(e) {}` is fine for
// localStorage, analytics, and other genuinely best-effort code where we
// don't care if it fails — but anything that touches Supabase, an edge
// function, or third-party fetch should at minimum log so the error
// surfaces in Vercel logs.
//
// Vite's esbuild config drops console.log/debug/info in prod builds but
// keeps console.error, so this stays useful in production.
//
// Usage:
//   try { await api.thing() } catch (e) { logError('loadDashboard:perms', e) }

export function logError(context, err) {
  if (typeof console === 'undefined') return
  const msg = err?.message || String(err || 'unknown')
  // Single-line, prefixed with [OwnProperly] for grep-ability in the logs.
  // Stack only when present, truncated to first few lines.
  const stack = err?.stack ? `\n${err.stack.split('\n').slice(0, 4).join('\n')}` : ''
  // eslint-disable-next-line no-console
  console.error(`[OwnProperly] ${context}: ${msg}${stack}`)
}
