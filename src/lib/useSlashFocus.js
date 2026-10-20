// useSlashFocus — "/" anywhere focuses a search field.
//
// The one shared handler for the "/" shortcut (PropertySearchBar in the
// header, the Portfolio page search). Two copies used to drift: the page one
// didn't check for open dialogs, so "/" yanked focus out of an open modal.
//
// Ignored when:
//   - a modifier is held (Cmd/Ctrl/Alt + "/" are browser / OS shortcuts)
//   - the user is typing in an input, textarea, select or contenteditable
//   - any modal dialog is on screen
//
//   useSlashFocus(inputRef, enabled, { select: true })
import { useEffect, useRef } from 'react'

const OPEN_DIALOG = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'

export function isTypingTarget(t) {
  if (!t) return false
  if (t.isContentEditable) return true
  const tag = (t.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

export function shouldSlashFocus(e) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return false
  if (e.defaultPrevented) return false
  if (isTypingTarget(e.target)) return false
  if (typeof document !== 'undefined' && document.querySelector(OPEN_DIALOG)) return false
  return true
}

export default function useSlashFocus(ref, enabled = true, { select = false } = {}) {
  // Latest option without re-binding the listener.
  const selectRef = useRef(select)
  useEffect(() => { selectRef.current = select }, [select])

  useEffect(() => {
    if (!enabled) return
    function onKey(e) {
      if (!shouldSlashFocus(e)) return
      const el = ref.current
      if (!el) return
      e.preventDefault()
      el.focus()
      if (selectRef.current) el.select?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, ref])
}
