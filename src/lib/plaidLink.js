// Plaid Link.js loader + open helper.
//
// Plaid's hosted UI is a JavaScript widget loaded from their CDN. We
// load it lazily — only when the user actually opens the Bank
// Connections modal — so it doesn't bloat the initial bundle.
//
// Usage:
//   import { openPlaidLink } from '../lib/plaidLink'
//   openPlaidLink({
//     linkToken,
//     onSuccess: ({ publicToken, metadata }) => { ... },
//     onExit:    ({ err, metadata }) => { ... },
//   })

const SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
let scriptPromise = null

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in browser'))
  if (window.Plaid) return Promise.resolve(window.Plaid)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => {
      if (window.Plaid) resolve(window.Plaid)
      else reject(new Error('Plaid Link.js loaded but window.Plaid missing'))
    }
    s.onerror = () => reject(new Error('Failed to load Plaid Link.js'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export async function openPlaidLink({ linkToken, onSuccess, onExit }) {
  if (!linkToken) throw new Error('linkToken required')
  const Plaid = await loadScript()
  const handler = Plaid.create({
    token: linkToken,
    onSuccess: (publicToken, metadata) => {
      try { onSuccess?.({ publicToken, metadata }) } finally { try { handler.destroy() } catch {} }
    },
    onExit: (err, metadata) => {
      try { onExit?.({ err, metadata }) } finally { try { handler.destroy() } catch {} }
    },
  })
  handler.open()
  return handler
}
