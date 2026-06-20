// Tenant-portal subdomain detection.
//
// Companies get a branded tenant portal at `<sub>.ownproperly.com`. The
// subdomain is the only signal a logged-out visitor carries about which
// company's branded login to show, so detection has to be conservative:
// a false positive would try to brand the marketing site for a company
// that doesn't exist.
//
// Returns the company subdomain (e.g. 'vale') or null when the host is the
// bare apex, a reserved host, a Vercel preview build, or localhost.

// Hosts that are ours but are NOT company subdomains. 'www'/apex serve the
// marketing site; the others are infra. Anything here resolves to null.
const RESERVED = new Set(['www', 'app', 'inbox', 'status', 'api', 'admin', 'staging'])

export function getSubdomain() {
  let host
  try { host = window.location.hostname } catch (e) { return null }
  if (!host) return null

  // Vercel preview/prod build domains (e.g. ownproperly-git-x.vercel.app)
  // are never tenant subdomains, so never attempt a branding lookup for them.
  if (host.endsWith('.vercel.app')) return null

  const parts = host.split('.')
  // Need at least sub.domain.tld. 'localhost' and bare 'ownproperly.com'
  // (2 parts) have no tenant subdomain.
  if (parts.length < 3) return null

  const sub = parts[0].toLowerCase()
  if (RESERVED.has(sub)) return null
  return sub
}
