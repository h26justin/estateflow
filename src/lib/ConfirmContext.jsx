import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Z, SANS, FS, R } from './styles'
import { useTheme } from './ThemeContext'
import { Button, Modal } from '../components/ui'

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
//   prompt        — if true, show a text input (window.prompt replacement).
//                   Resolves with the entered string on confirm, or null on
//                   cancel — instead of true/false.
//   defaultValue  — initial input value (prompt mode only)
//   placeholder   — input placeholder (prompt mode only)

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  // Imperative state — we resolve the active prompt's promise on user action
  const [state, setState] = useState(null)
    // null | { title, body, confirmLabel, cancelLabel, destructive, prompt,
    //          defaultValue, placeholder, resolve }

  const confirm = useCallback((opts = {}) => {
    return new Promise(resolve => {
      setState({
        title:        opts.title        || 'Are you sure?',
        body:         opts.body         || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        destructive:  !!opts.destructive,
        prompt:       !!opts.prompt,
        defaultValue: opts.defaultValue ?? '',
        placeholder:  opts.placeholder  || '',
        resolve,
      })
    })
  }, [])

  function handleConfirm(value) {
    if (!state) return
    state.resolve(state.prompt ? value : true)
    setState(null)
  }
  function handleCancel() {
    if (!state) return
    state.resolve(state.prompt ? null : false)
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
    return (opts = {}) => Promise.resolve(opts.prompt
      ? window.prompt(opts.title || 'Enter a value:', opts.defaultValue ?? '')
      : window.confirm(opts.title || 'Are you sure?'))
  }
  return fn
}

function ConfirmDialog({ state, onConfirm, onCancel }) {
  const { T } = useTheme()
  const [value, setValue] = useState(state.defaultValue)
  // Land on the safe choice: the prompt's input, otherwise Cancel.
  const cancelRef = useRef(null)
  return (
    <Modal onClose={onCancel} size="sm" zIndex={Z.confirm} title={state.title}
      initialFocusRef={state.prompt ? undefined : cancelRef}
      description={state.body ? <span style={{ whiteSpace: 'pre-line' }}>{state.body}</span> : undefined}
      bodyStyle={state.prompt ? undefined : { padding: 0 }}
      footer={<>
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
          {state.cancelLabel}
        </Button>
        <Button variant={state.destructive ? 'danger' : 'primary'} onClick={() => onConfirm(value)}>
          {state.confirmLabel}
        </Button>
      </>}>
      {state.prompt && (
        <input value={value} autoFocus placeholder={state.placeholder} aria-label={state.title}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value) }}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: SANS, fontSize: FS.base, padding: '10px 12px',
            borderRadius: R.sm, border: `1px solid ${T.border}`, background: T.bg, color: T.text }}/>
      )}
    </Modal>
  )
}
