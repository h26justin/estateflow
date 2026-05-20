// Lazy-load a script tag from a CDN, idempotent and de-duplicating.
//
// Why a helper: the StatementImporter and three jspdf call sites all had
// the same fragile pattern — `script.onerror = reject` rejects with a
// bare DOM Event that has no `.message`, so any failure renders as
// "Error: undefined" in toasts. We centralise that here.
//
// Failures we now surface clearly:
//   - CSP blocks the host (was the May 2026 regression that broke PDF
//     import + jsPDF export — `cdnjs.cloudflare.com` wasn't on the
//     script-src allow-list).
//   - Browser is offline.
//   - The CDN returned 404 or other HTTP error.
//   - The script loaded but didn't expose the expected global (e.g.
//     `window.pdfjsLib` or `window.jspdf`).

const inflight = new Map() // url → Promise<void>

/**
 * Load a script from `url` once. If it's already on the page or in flight,
 * return the same promise. Resolves when `globalKey` (if given) is present
 * on `window`. Rejects with a useful Error message on any failure.
 *
 *   await loadCdnScript('https://…/pdf.min.js', 'pdfjsLib')
 *
 * @param {string} url - Absolute https URL of the script.
 * @param {string} [globalKey] - Property on window to assert after load.
 * @returns {Promise<void>}
 */
export function loadCdnScript(url, globalKey) {
  if (globalKey && typeof window !== 'undefined' && window[globalKey]) {
    return Promise.resolve()
  }
  if (inflight.has(url)) return inflight.get(url)

  const p = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('loadCdnScript only works in a browser'))
      return
    }
    // Re-use a previously injected tag (e.g. via SSR) if present.
    let script = document.querySelector(`script[src="${url}"]`)
    const fresh = !script
    if (!script) {
      script = document.createElement('script')
      script.src = url
      script.crossOrigin = 'anonymous'
      script.async = true
    }
    const onload = () => {
      if (globalKey && !window[globalKey]) {
        reject(new Error(
          `Script from ${url} loaded but window.${globalKey} is missing — ` +
          `try a hard refresh, or check ad-blockers / extensions.`
        ))
        return
      }
      resolve()
    }
    const onerror = () => reject(new Error(
      `Could not load ${url}. Likely causes: offline, ad-blocker, or the ` +
      `host is missing from Content-Security-Policy. Check the network tab.`
    ))
    if (fresh) {
      script.addEventListener('load', onload, { once: true })
      script.addEventListener('error', onerror, { once: true })
      document.head.appendChild(script)
    } else {
      // Already in the DOM. Either it's already executed (check global) or
      // it's still loading (attach listeners).
      if (globalKey && window[globalKey]) { resolve(); return }
      script.addEventListener('load', onload, { once: true })
      script.addEventListener('error', onerror, { once: true })
    }
  })
  inflight.set(url, p)
  // Allow retries after a permanent failure (otherwise a transient CDN
  // hiccup would poison the cache for the rest of the session).
  p.catch(() => inflight.delete(url))
  return p
}
