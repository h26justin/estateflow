import { createContext, useContext, useState, useCallback } from 'react'
import { useTheme } from './ThemeContext'

// Promise-based themed confirmation dialog.
//
// Usage:
//   1. Wrap your app in <ConfirmProvider>...</ConfirmProvider>
//   2. In any component: const confirm = useConfirm()
//      then: if (await confirm({ ... })) { /* user confirmed */ }
//
// Options:
//   title         — short prompt (e.g. 'Delete property?')
//   body          — optional longer explanation
//   confirmLabel  — text on the confirm button (default 'Confirm')
//   cancelLabel   — text on the cancel button (default 'Cancel')
//   destructive   — if true, confirm button is red

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  // Imperative state — we resolve the active prompt's promise on user action
  const [state, setState] = useState(null)
    // null | { title, body, confirmLabel, cancelLabel, destructive, resolve }

  const confirm = useCallback((opts = {}) => {
    return new Promise(resolve => {
      setState({
        title:        opts.title        || 'Are you sure?',
        body:         opts.body         || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        destructive:  !!opts.destructive,
        resolve,
      })
    })
  }, [])

  function handleConfirm() {
    if (!state) return
    state.resolve(true)
    setState(null)
  }
  function handleCancel() {
    if (!state) return
    state.resolve(false)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmDialog state={state} onConfirm={handleConfirm} onCancel={handleCancel}/>}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const fn = useContext(ConfirmContext)
  if (!fn) {
    // Fallback if provider isn't mounted — should never happen, but degrades
    // gracefully to the native confirm dialog rather than crashing.
    // eslint-disable-next-line no-console
    console.warn('[ConfirmProvider] not mounted; falling back to window.confirm')
    return (opts = {}) => Promise.resolve(window.confirm(opts.title || 'Are you sure?'))
  }
  return fn
}

function ConfirmDialog({ state, onConfirm, onCancel }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div style={{ padding: '24px 28px 0' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: state.body ? 8 : 22, color: T.text }}>
            {state.title}
          </h2>
          {state.body && (
            <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 22, lineHeight: 1.5 }}>
              {state.body}
            </p>
          )}
        </div>
        <div style={{ padding: '0 28px 28px', display: 'flex', gap: 10 }}>
          <button onClick={onCancel}
            style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: '11px', borderRadius: 10, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
            {state.cancelLabel}
          </button>
          <button onClick={onConfirm} autoFocus
            style={{ flex: 1, fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '11px', borderRadius: 10, border: 'none',
              background: state.destructive ? T.red : T.gold,
              color: state.destructive ? 'white' : '#1A2530',
              cursor: 'pointer' }}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
