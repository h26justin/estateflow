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

// Stored per user (2026-11): one global key meant a second 2FA user signing
// in on the same browser cleared the first user's remembered device. The
// legacy global key is migrated to the first user who reads it; if it was
// another user's token, the server check fails and it is cleared as before.
export const TRUSTED_DEVICE_KEY = 'ef_trusted_device'
export const trustedDeviceKey = (userId) => (userId ? `${TRUSTED_DEVICE_KEY}:${userId}` : TRUSTED_DEVICE_KEY)

// AuthContext records the signed-in user here, so callers that don't know the
// user id (Settings → Two-factor) still read and clear the right entry.
let currentUserId = null
export function setTrustedDeviceUser(userId) { currentUserId = userId || null }

function parse(raw) {
  if (!raw) return null
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed.token === 'string' ? parsed : null
}

export function getStoredDevice(userId = currentUserId) {
  try {
    const own = parse(localStorage.getItem(trustedDeviceKey(userId)))
    if (own || !userId) return own
    // One-time migration of the pre-per-user global key.
    const legacy = parse(localStorage.getItem(TRUSTED_DEVICE_KEY))
    if (legacy) {
      localStorage.setItem(trustedDeviceKey(userId), JSON.stringify(legacy))
      localStorage.removeItem(TRUSTED_DEVICE_KEY)
    }
    return legacy
  } catch {
    return null
  }
}

export function setStoredDevice(device, userId = currentUserId) {
  try { localStorage.setItem(trustedDeviceKey(userId), JSON.stringify(device)) } catch { /* private mode / quota — non-fatal */ }
}

export function clearStoredDevice(userId = currentUserId) {
  try { localStorage.removeItem(trustedDeviceKey(userId)) } catch { /* non-fatal */ }
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
