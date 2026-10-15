// copyToClipboard(text) → Promise<boolean>
// Async Clipboard API first; if it is missing or refused (insecure context,
// permissions policy, older Safari), fall back to a hidden textarea +
// execCommand('copy'). Resolves false when neither works so the caller can
// tell the user how to copy by hand — never throws, never opens a prompt.
export async function copyToClipboard(text) {
  const value = String(text ?? '')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  ta.value = value
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  try {
    ta.select()
    return document.execCommand('copy') === true
  } catch {
    return false
  } finally {
    ta.remove()
  }
}
