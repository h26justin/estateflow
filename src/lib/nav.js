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
  { key: 'rent',           label: 'Rent Tracker',   icon: 'pound',        short: 'Rent',      required: false, group: 'Money',       mobileRank: 1 },
  // Short-term-let booking income (Hostaway / Lodgify), kept out of the
  // residential collection rate. Added 2026-09: users whose stored nav_items
  // predate it must switch it on in Settings -> Navigation (the seed default
  // includes it for new accounts). mobileRank 8 so it never displaces an
  // existing bottom-bar slot.
  { key: 'stl',            label: 'Short-Term Let Income', icon: 'bed',   short: 'STL',       required: false, group: 'Money',       mobileRank: 8 },
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

// The one default list, used both as the runtime pref fallback and as the
// seed when the first toggle is saved. Flag-gated items are excluded — the
// flag itself governs their visibility.
export const DEFAULT_NAV_KEYS = ALL_NAV.filter(n => !n.flag).map(n => n.key)

// Everything a user may switch on/off in Settings → Navigation.
export const NAV_TOGGLE_OPTIONS = ALL_NAV.filter(n => !n.required && !n.flag)

// Settings sub-tabs, grouped as SettingsPage renders them. The base
// (unconditional) set lives here so the command palette can offer
// "Settings → Billing" etc.; SettingsPage appends its conditional tabs
// (AI Bookkeeping, Developer) locally.
export const SETTINGS_TABS = {
  account: [
    { key: 'account',       label: 'Profile' },
    { key: 'security',      label: 'Security & Data' },
    { key: 'backups',       label: 'Backups' },
    { key: 'billing',       label: 'Billing' },
    { key: 'navbar',        label: 'Navigation' },
    { key: 'trash',         label: 'Trash' },
    { key: 'referral',      label: 'Refer a Friend' },
    { key: 'help',          label: 'Help & Guides' },
  ],
  portfolio: [
    { key: 'branding',      label: 'Branding & Logos' },
    { key: 'tenant',        label: 'Tenant Portal' },
    { key: 'features',      label: 'Features' },
    { key: 'compliance',    label: 'Compliance Tracking' },
    { key: 'inbox',         label: 'Statement Inbox' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'milestones',    label: 'Deal Milestones' },
    { key: 'integrations',  label: 'Integrations' },
  ],
  preferences: [
    { key: 'display',       label: 'Display' },
    { key: 'reporting',     label: 'Reporting' },
    { key: 'team',          label: 'Team & Access' },
  ],
}

// Labels for views that have no nav entry (or whose entry may be hidden by
// prefs/flags) so headers and document.title never fall back to "Dashboard"
// while a different page is on screen.
export const VIEW_LABELS = {
  ...Object.fromEntries(ALL_NAV.map(n => [n.key, n.label])),
  daytracker: 'Day Tracker',
  feedback: 'Feedback',
  detail: 'Property',
  'import': 'Import Statement',
  'import-data': 'Import Historic Data',
  'bulk-add': 'Add Block of Flats',
}
