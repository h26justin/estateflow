// Global toast emitter.
//
// App.jsx already owns the toast UI and a local showToast() helper. This file
// lets *any* component (even those that don't receive showToast as a prop)
// trigger one — useful for deep-tree components and replacing browser
// alert() calls without threading showToast through dozens of layers.
//
// Usage:
//   import { showAppToast } from '../lib/toast'
//   showAppToast('Saved')                 // info (default)
//   showAppToast('Could not save', 'error')
//
// In App.jsx, a single useEffect listens for 'ownproperly:toast' events and
// forwards them to the existing showToast.

export const TOAST_EVENT = 'ownproperly:toast'

export function showAppToast(message, kind = 'info') {
  if (typeof window === 'undefined' || !message) return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, kind } }))
}
