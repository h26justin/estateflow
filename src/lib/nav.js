// ── NAVIGATION REGISTRY — single source of truth ────────────────────────────
// Previously App.jsx (runtime rail), FeatureComponents.jsx (Settings toggle
// list + seed default) and the mobile bottom bar each carried their own copy
// of the nav model, and they disagreed: the Settings list had no Insurance
// row and its seed default swapped `insurance` for `mtd`, so toggling any
// item could silently strip Insurance from a user's nav with no way to
// re-enable it. Everything now derives from ALL_NAV.
//
// Fields:
//   key       — view key (also the URL hash segment)
//   label     — rail / drawer label
//   icon      — name in lib/icons.jsx ICON_NAMES
//   short     — mobile bottom-bar label
//   required  — always visible, not toggleable
//   flag      — feature flag that must be active for the item to appear
//   group     — rail section header (rendered when the group changes)
//   mobileRank— priority for the 3 middle bottom-bar slots (lower = first)

// Note: Companies and Contractors are deliberately NOT top-level entries —
// they used to exist BOTH here and as Portfolio sub-tabs (two different
// Companies screens, only one with a URL). They now live solely as Portfolio
// sub-tabs; legacy '#/companies' / '#/contractors' hashes are mapped across
// in App.jsx's parseHash.
export const ALL_NAV = [
  { key: 'dashboard',      label: 'Dashboard',      icon: 'home',         short: 'Home',      required: true,  group: 'Overview',    mobileRank: 0 },
  { key: 'properties',     label: 'Portfolio',      icon: 'building',     short: 'Portfolio', required: true,  group: 'Portfolio',   mobileRank: 0 },
  // Refurbs (2026-09): every refurbishment across every company in one
  // place, agreed price versus payments. Sits under Portfolio on Justin's
  // ruling. Listed in AUTO_ENABLE_NAV_KEYS below so accounts whose stored
  // nav_items predate it get it switched on once. mobileRank 9 so it never
  // displaces an existing bottom-bar slot.
  { key: 'refurbs',        label: 'Refurbs',        icon: 'hammer',       short: 'Refurbs',   required: false, group: 'Portfolio',   mobileRank: 9 },
  { key: 'rent',           label: 'Rent Tracker',   icon: 'pound',        short: 'Rent',      required: false, group: 'Money',       mobileRank: 1 },
  // Short-term-let booking income (Hostaway / Lodgify), kept out of the
  // residential collection rate. Added 2026-09: users whose stored nav_items
  // predate it must switch it on in Settings -> Navigation (the seed default
  // includes it for new accounts). mobileRank 8 so it never displaces an
  // existing bottom-bar slot.
  { key: 'stl',            label: 'Short-Term Let Income', icon: 'bed',   short: 'STL',       required: false, group: 'Money',       mobileRank: 8 },
  // External Loans (2026-09): money lent into a company from outside the
  // mortgage book, with the monthly schedule and a tick per payment. In
  // AUTO_ENABLE_NAV_KEYS so existing accounts get it once. mobileRank 10 so
  // it never displaces an existing bottom-bar slot.
  { key: 'loans',          label: 'External Loans', icon: 'wallet',       short: 'Loans',     required: false, group: 'Money',       mobileRank: 10 },
  { key: 'reports',        label: 'Reports',        icon: 'pie-chart',    short: 'Reports',   required: false, group: 'Money',       mobileRank: 3 },
  { key: 'mtd',            label: 'MTD Tax',        icon: 'landmark',     short: 'MTD',       required: false, group: 'Money',       mobileRank: 4 },
  // 'compliance' replaced the old top-level 'insurance' entry (2026-08) —
  // insurance is now a sub-view of Compliance. Stored user nav prefs may
  // still carry 'insurance'; App.jsx maps it to 'compliance' on load, and
  // parseHash maps the legacy '#/insurance' route.
  { key: 'compliance',     label: 'Compliance',     icon: 'shield-check', short: 'Comply',    required: false, group: 'Compliance',  mobileRank: 5 },
  { key: 'deals',          label: 'Deals',          icon: 'target',       short: 'Deals',     required: false, group: 'Growth & AI', mobileRank: 2 },
  { key: 'autopilot',      label: 'Autopilot',      icon: 'robot',        short: 'Autopilot', required: false, group: 'Growth & AI', mobileRank: 6, flag: 'portfolio_autopilot' },
  { key: 'renters-rights', label: 'Renters Rights', icon: 'scale',        short: 'RRA',       required: false, group: 'Growth & AI', mobileRank: 7, flag: 'renters_rights' },
  { key: 'settings',       label: 'Settings',       icon: 'settings',     short: 'Settings',  required: true,  group: 'System',      mobileRank: 0 },
]

// Items added after launch that existing accounts should see without having
// to find the toggle. On load, App.jsx adds any of these that a stored list
// lacks, and records a `seen:<key>` marker in the same list so it happens
// once: if the user later switches the item off, the marker keeps it off.
// Markers are inert everywhere else (nothing renders a key that is not in
// ALL_NAV). Remove a key from here once every account has the marker.
// 'stl' added 2026-09-15: Short-Term Let Income was left off this list, so
// accounts that saved their navigation before it existed saw the link during
// load (the default list has it) and lost it once their stored prefs arrived.
export const AUTO_ENABLE_NAV_KEYS = ['refurbs', 'stl', 'loans']
export const navSeenMarker = key => `seen:${key}`

// The one default list, used both as the runtime pref fallback and as the
// seed when the first toggle is saved. Flag-gated items are excluded — the
// flag itself governs their visibility.
export const DEFAULT_NAV_KEYS = ALL_NAV.filter(n => !n.flag).map(n => n.key)

// Everything a user may switch on/off in Settings → Navigation.
export const NAV_TOGGLE_OPTIONS = ALL_NAV.filter(n => !n.required && !n.flag)

// ── SETTINGS INFORMATION ARCHITECTURE ──────────────────────────────────────
// Settings used to be 19 flat sub-tabs in 3 groups (+2 conditional). They are
// now five pages, each a stack of sections with an in-page jump list. Every
// old tab key survives as a SECTION key, so existing deep links
// (#/settings/billing, '#/settings/backups' in notifications, the command
// palette, the drawer's Help/Trash shortcuts) still land on the right panel:
// resolveSettingsKey() maps the key to its page and the page scrolls to it.
//
// Section order here must match the JSX order in SettingsPage (sections are
// rendered in place, so the jump list follows the page).
//   companyScoped — section content follows the page-level company filter
//   conditional   — appended by SettingsPage only when its gate passes
export const SETTINGS_PAGES = [
  { key: 'account', label: 'Account', desc: 'Your profile, sign-in security and personal preferences.', sections: [
    { key: 'account',       label: 'Profile' },
    { key: 'security',      label: 'Security & Data' },
    { key: 'display',       label: 'Display' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'navbar',        label: 'Navigation' },
  ] },
  { key: 'companies', label: 'Companies & team', desc: 'What each company uses, how it looks to tenants, and who can access it.', sections: [
    { key: 'features',      label: 'Features',          companyScoped: true },
    { key: 'branding',      label: 'Branding & Logos',  companyScoped: true },
    { key: 'tenant',        label: 'Tenant Portal',     companyScoped: true },
    { key: 'team',          label: 'Team & Access' },
  ] },
  { key: 'portfolio', label: 'Portfolio', desc: 'Defaults for compliance, deals and reporting.', sections: [
    { key: 'compliance',    label: 'Compliance Tracking' },
    { key: 'milestones',    label: 'Deal Milestones' },
    { key: 'reporting',     label: 'Reporting',         companyScoped: true },
  ] },
  { key: 'integrations', label: 'Integrations & data', desc: 'Connected services, statement inbox, backups and deleted items.', sections: [
    { key: 'integrations',  label: 'Integrations',      companyScoped: true },
    { key: 'bookkeeping',   label: 'AI Bookkeeping',    companyScoped: true, conditional: true },
    { key: 'inbox',         label: 'Statement Inbox',   companyScoped: true },
    { key: 'backups',       label: 'Backups' },
    { key: 'trash',         label: 'Trash' },
    { key: 'admin',         label: 'Developer',         conditional: true },
  ] },
  { key: 'billing', label: 'Billing & help', desc: 'Your plan, referrals and help guides.', sections: [
    { key: 'billing',       label: 'Billing',           companyScoped: true },
    { key: 'referral',      label: 'Refer a Friend' },
    { key: 'help',          label: 'Help & Guides' },
  ] },
]

export const DEFAULT_SETTINGS_PAGE = 'account'

// Map any settings key — a page key, a section key (every pre-2026-10 tab
// key is one) or junk — to { page, section }. `section` is null when the
// key names a page, or when it names a section that is hidden for this user
// (`hidden` = set of conditional section keys not currently shown); the page
// then opens at the top instead of an empty jump target.
export function resolveSettingsKey(key, hidden = new Set()) {
  if (key) {
    for (const page of SETTINGS_PAGES) {
      const sec = page.sections.find(s => s.key === key)
      if (sec) return { page: page.key, section: hidden.has(key) ? null : key }
    }
    if (SETTINGS_PAGES.some(p => p.key === key)) return { page: key, section: null }
  }
  return { page: DEFAULT_SETTINGS_PAGE, section: null }
}

// Read the settings key out of a location hash ('#/settings/<key>').
export function settingsKeyFromHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
  return parts[0] === 'settings' && parts[1] ? parts[1] : null
}

// Back-compat shape for the command palette ("Settings → Billing" etc.):
// unconditional sections grouped by page.
export const SETTINGS_TABS = Object.fromEntries(
  SETTINGS_PAGES.map(p => [p.key, p.sections.filter(s => !s.conditional).map(({ key, label }) => ({ key, label }))])
)

// Labels for views that have no nav entry (or whose entry may be hidden by
// prefs/flags) so headers and document.title never fall back to "Dashboard"
// while a different page is on screen.
export const VIEW_LABELS = {
  ...Object.fromEntries(ALL_NAV.map(n => [n.key, n.label])),
  daytracker: 'Day Tracker',
  feedback: 'Feedback',
  detail: 'Property',
  'import': 'Import Statement',
  'statement-audit': 'Rental Statement Audit',
  'import-data': 'Import Historic Data',
  'bulk-add': 'Add Block of Flats',
}
