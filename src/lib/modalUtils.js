// Small utility for modal close-on-outside-click behaviour.
// Protects against accidental data loss: if the form has unsaved changes,
// the user is asked to confirm before the modal closes.
//
// Usage in a modal:
//   <div className="overlay" onClick={safeOverlayClose(isDirty, onClose)}>
//
// Where:
//   isDirty: boolean — true if user has made unsaved changes
//   onClose: () => void — function to actually close the modal
//
// Behaviour:
//   - Click on modal contents (anything inside): does nothing (event bubbles
//     up to overlay but target !== currentTarget so we ignore it)
//   - Click directly on the overlay backdrop:
//     - If form is clean: close immediately
//     - If form is dirty: show confirm; close only on OK
//   - Pressing Escape: handled by parent if needed (we don't intercept)
export function safeOverlayClose(isDirty, onClose) {
  return (e) => {
    if (e.target !== e.currentTarget) return
    if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return
    onClose()
  }
}

// Helper: shallow-compare two objects to determine if a form has been edited.
// Coerces null/undefined/'' to '' before comparing so empty-equivalent values
// don't trigger a false-positive dirty signal.
//
// Usage:
//   const isDirty = isFormDirty(initialFormSnapshot, currentForm)
export function isFormDirty(initial, current) {
  if (!initial || !current) return false
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)])
  for (const k of keys) {
    const a = initial[k] == null ? '' : initial[k]
    const b = current[k] == null ? '' : current[k]
    // Use loose comparison so '5' and 5 compare equal — typical form-input
    // round-tripping where numeric fields become strings.
    if (String(a) !== String(b)) return true
  }
  return false
}
