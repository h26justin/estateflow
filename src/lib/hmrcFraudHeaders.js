// HMRC Fraud Prevention Headers — client-side collector.
//
// HMRC requires every MTD submission to include a set of Gov-Client-*
// and Gov-Vendor-* headers describing the device, browser and network
// path the submission travelled through. They use these to detect
// fraud (e.g. credential-stuffing attacks, agent firms misrepresenting
// the originating taxpayer device).
//
// Spec: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
// Validator: Test Fraud Prevention Headers API
//
// Our connection method is WEB_APP_VIA_SERVER — the user uses our
// React app in their browser, which calls our Supabase edge function,
// which then forwards to HMRC. So we send BOTH the client headers
// (browser + device) AND the vendor headers (our server).
//
// Browser-only fields are collected here. Public IP + port come from the
// browser via an external echo service (api.ipify.org). The edge function
// fills in the server-side Gov-Vendor-* headers itself.
//
// Privacy notes: this collection is for HMRC compliance ONLY. Nothing
// in this file is stored or used for anything other than the headers
// we send to HMRC at submission time.

const DEVICE_ID_KEY = 'ownproperly_hmrc_device_id'
const PUBLIC_IP_CACHE_KEY = 'ownproperly_hmrc_public_ip'
const PUBLIC_IP_TTL_MS = 30 * 60 * 1000 // 30 min — well under PSD2/HMRC freshness window

// Persistent random UUID per browser. HMRC wants this stable so they can
// correlate submissions from the same device over time.
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    // Private browsing / storage blocked — return a session-only id so
    // we don't silently send blank. Will rotate per page load.
    return crypto.randomUUID()
  }
}

// Public IP echo — cached for 30 min to avoid hammering the lookup.
// If the call fails (offline, blocked), we send an empty string and
// HMRC marks the submission as "degraded" rather than rejecting.
async function getPublicIp() {
  try {
    const cached = JSON.parse(localStorage.getItem(PUBLIC_IP_CACHE_KEY) || 'null')
    if (cached && cached.ts && Date.now() - cached.ts < PUBLIC_IP_TTL_MS) {
      return { ip: cached.ip, ts: cached.ts }
    }
  } catch { /* ignore */ }
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
    const data = await res.json()
    const ip = data?.ip || ''
    const ts = Date.now()
    if (ip) {
      try { localStorage.setItem(PUBLIC_IP_CACHE_KEY, JSON.stringify({ ip, ts })) } catch {}
    }
    return { ip, ts }
  } catch {
    return { ip: '', ts: Date.now() }
  }
}

// Compose HMRC's RFC3339 timestamp format with milliseconds.
function rfc3339(ts) {
  return new Date(ts).toISOString()
}

// Convert browser navigator.timezoneOffset (in minutes, sign flipped)
// into HMRC's "UTC+HH:MM" / "UTC-HH:MM" format.
function getTimezoneHeader() {
  const offMin = -new Date().getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hh}:${mm}`
}

// Build the browser plugin string HMRC expects: pipe-separated, each
// plugin URL-encoded. Modern browsers expose very little so this is
// usually just "internal-pdf-viewer" or empty.
function getBrowserPlugins() {
  try {
    const plugins = []
    if (navigator.plugins) {
      for (let i = 0; i < navigator.plugins.length; i++) {
        const name = navigator.plugins[i]?.name
        if (name) plugins.push(encodeURIComponent(name))
      }
    }
    return plugins.join(',') || 'none'
  } catch {
    return 'none'
  }
}

// Screen dimensions in HMRC's required key=value format.
function getScreensHeader() {
  try {
    const w = window.screen?.width || 0
    const h = window.screen?.height || 0
    const sf = window.devicePixelRatio || 1
    const cd = window.screen?.colorDepth || 24
    return `width=${w}&height=${h}&scaling-factor=${sf}&colour-depth=${cd}`
  } catch {
    return 'width=0&height=0&scaling-factor=1&colour-depth=24'
  }
}

// Window inner dimensions.
function getWindowSizeHeader() {
  try {
    return `width=${window.innerWidth || 0}&height=${window.innerHeight || 0}`
  } catch {
    return 'width=0&height=0'
  }
}

// Do Not Track signal — true/false/unknown.
function getDoNotTrack() {
  try {
    const dnt = navigator.doNotTrack || window.doNotTrack
    if (dnt === '1' || dnt === 'yes') return 'true'
    if (dnt === '0' || dnt === 'no') return 'false'
    return 'false'
  } catch { return 'false' }
}

// Collect everything the browser knows about itself. Async because
// public IP requires a network round-trip.
//
// Returns an object suitable for shipping in a JSON body to the edge
// function — the edge function then converts each entry into a real
// Gov-Client-* HTTP header on its outbound HMRC request.
export async function collectClientFraudHeaders() {
  const deviceId = getDeviceId()
  const ipInfo = await getPublicIp()

  return {
    // Required for WEB_APP_VIA_SERVER connection method
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Device-ID': deviceId,
    'Gov-Client-User-IDs': `os=${encodeURIComponent(navigator.userAgent.split(' ').pop() || 'web')}`,
    'Gov-Client-Timezone': getTimezoneHeader(),
    'Gov-Client-Screens': getScreensHeader(),
    'Gov-Client-Window-Size': getWindowSizeHeader(),
    'Gov-Client-Browser-Plugins': getBrowserPlugins(),
    'Gov-Client-Browser-JS-User-Agent': navigator.userAgent || '',
    'Gov-Client-Browser-Do-Not-Track': getDoNotTrack(),
    'Gov-Client-Multi-Factor': '', // Supabase Auth doesn't expose MFA status; populate when we add it
    'Gov-Client-Public-IP': ipInfo.ip,
    'Gov-Client-Public-IP-Timestamp': rfc3339(ipInfo.ts),
    // Local LAN IPs are difficult to enumerate reliably from a browser
    // (WebRTC trick is privacy-invasive and increasingly blocked). HMRC
    // accepts empty values during sandbox; we ship blank and rely on the
    // edge function to flag this in the request body.
    'Gov-Client-Local-IPs': '',
    'Gov-Client-Local-IPs-Timestamp': rfc3339(Date.now()),
  }
}
