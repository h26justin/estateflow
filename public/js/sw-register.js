// Service worker registration (external so the CSP needs no
// script-src 'unsafe-inline').
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // A worker script may not sit behind a redirect (apex -> www), so on the bare host this rejects; swallow it.
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
