// "Remember this device for 30 days" — client-side helpers.
//
// The actual trust decision is made SERVER-SIDE (the is_device_trusted RPC
// validates a SHA-256 hash against an unexpired row). This module only holds
// the raw token the server handed us and derives a friendly device label for
// the Settings list. A tampered/forged value here is harmless: the server
// rejects anything whose hash it doesn't recognise, so the worst a bad value
// does is force a normal TOTP challenge.
//
// Stored shape: { token: <hex string>, id: <uuid> }. We keep `id` so the
// Settings list can mark which row is "this device".

export const TRUSTED_DEVICE_KEY = 'ef_trusted_device'

export function getStoredDevice() {
  try {
    const raw = localStorage.getItem(TRUSTED_DEVICE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.token === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function setStoredDevice(device) {
  try { localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify(device)) } catch { /* private mode / quota — non-fatal */ }
}

export function clearStoredDevice() {
  try { localStorage.removeItem(TRUSTED_DEVICE_KEY) } catch { /* non-fatal */ }
}

// Best-effort "Chrome on macOS"-style label from the user-agent, shown in the
// Settings trusted-device list so a user can recognise (and revoke) a device.
// Order matters: Edge/Opera UAs also contain "Chrome", and Chrome's UA also
// contains "Safari", so the more specific tokens are tested first.
export function deviceLabel(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '') {
  let os = 'Unknown OS'
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'Browser'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua)) browser = 'Safari'

  return `${browser} on ${os}`
}
