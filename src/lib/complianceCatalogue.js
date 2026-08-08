// ── COMPLIANCE REQUIREMENTS CATALOGUE — single source of truth ───────────────
// Every certificate / document a UK (England) landlord should hold, with the
// rules for when each one applies to a property. Consumed by:
//   - CompliancePage (portfolio overview cards + matrix)
//   - ComplianceTab   (per-property certificate list + add form)
//   - Settings → Compliance Tracking (per-company on/off toggles)
//   - complianceStatus.js (alias-aware status classification)
//
// cert_type history: different surfaces wrote different keys for the same
// certificate ('gas' vs 'gas_safety', 'alarm' vs 'smoke_alarm'). The `key`
// here is canonical for NEW writes; `aliases` lists every legacy key so
// existing rows still match. Never remove an alias — data written under it
// exists in production.
//
// Tiers:
//   1 — legal requirement for (almost) every English let
//   2 — legal requirement when applicable (HMO, licensing area, heating type)
//   3 — not statutory, but recommended / contractually required (lenders)
//
// applies(p): given a property row, is this requirement relevant?
//   Uses the applicability flag columns (has_gas_supply, heating_type,
//   licensing_scheme, is_hmo) added in 2026-08-08_compliance_flags.sql.
//   Flags default to "applies" when unset so nothing silently disappears.

const isLet = p => ['rented', 'notice_given', 'let_agreed'].includes(p?.status)
const isHmo = p => !!p?.is_hmo || ['mandatory_hmo', 'additional_hmo'].includes(p?.licensing_scheme)
const hasGas = p => p?.has_gas_supply !== false
const burnsFuel = p => hasGas(p) || ['oil', 'solid_fuel'].includes(p?.heating_type)

export const HEATING_TYPES = [
  ['', 'Not set'],
  ['gas', 'Gas'],
  ['electric', 'Electric only'],
  ['oil', 'Oil'],
  ['solid_fuel', 'Solid fuel'],
  ['heat_pump', 'Heat pump'],
  ['other', 'Other'],
]

export const LICENSING_SCHEMES = [
  ['', 'None'],
  ['selective', 'Selective licensing area'],
  ['mandatory_hmo', 'Mandatory HMO licence'],
  ['additional_hmo', 'Additional HMO licence'],
]

// group: 'certs' (safety certificates), 'licences', 'tenancy' (per-tenancy
// paperwork), 'insurance' (derived from insurance_policies, not
// compliance_items).
// cycleMonths: typical renewal cycle — used to (a) suggest expiry dates and
//   (b) derive a due date for check-date items (isCheck) that only record
//   an issue/last-checked date.
// expiryOptional: a row without any date still counts as "held" (tenancy
//   paperwork that doesn't expire).
export const COMPLIANCE_CATALOGUE = [
  // ── Tier 1 — legal for every let ──────────────────────────────────────────
  { key: 'gas_safety', aliases: ['gas', 'gas_cert'], label: 'Gas Safety (CP12)', short: 'Gas', icon: 'flame', tier: 1, group: 'certs', cycleMonths: 12,
    desc: 'Annual gas safety check by a Gas Safe registered engineer. Give the record to tenants within 28 days.',
    applies: hasGas, naReason: 'No gas supply' },
  { key: 'eicr', label: 'Electrical Safety (EICR)', short: 'EICR', icon: 'zap', tier: 1, group: 'certs', cycleMonths: 60,
    desc: 'Electrical Installation Condition Report at least every 5 years, by a qualified electrician.' },
  { key: 'epc', label: 'EPC (minimum rating E)', short: 'EPC', icon: 'leaf', tier: 1, group: 'certs', cycleMonths: 120,
    desc: 'Energy Performance Certificate, valid 10 years. Minimum rating E to let; the floor is due to rise to C.' },
  { key: 'smoke_alarm', aliases: ['alarm'], label: 'Smoke alarms', short: 'Smoke', icon: 'bell', tier: 1, group: 'certs', cycleMonths: 12, isCheck: true,
    desc: 'Working smoke alarm on every storey, evidenced as working at the start of each tenancy. Record the last check date.' },
  { key: 'co_alarm', label: 'Carbon monoxide alarms', short: 'CO', icon: 'alert-circle', tier: 1, group: 'certs', cycleMonths: 12, isCheck: true,
    desc: 'CO alarm in any room with a fixed combustion appliance (boiler, fire, stove — gas cookers excluded).',
    applies: burnsFuel, naReason: 'No combustion appliances' },
  // ── Tier 1 — per-tenancy paperwork ────────────────────────────────────────
  { key: 'tenancy_agreement', label: 'Tenancy agreement / written terms', short: 'Agreement', icon: 'file-text', tier: 1, group: 'tenancy', expiryOptional: true,
    desc: 'A written statement of terms is required for every tenancy under the Renters’ Rights Act.',
    applies: isLet, naReason: 'Not currently let' },
  { key: 'deposit_protection', label: 'Deposit protection + prescribed info', short: 'Deposit', icon: 'lock', tier: 1, group: 'tenancy', expiryOptional: true,
    desc: 'Scheme certificate and Prescribed Information served within 30 days of taking a deposit. Failure blocks possession and risks a 1–3× penalty.',
    applies: isLet, naReason: 'Not currently let' },
  { key: 'right_to_rent', label: 'Right to Rent checks', short: 'RtR', icon: 'id-card', tier: 1, group: 'tenancy', expiryOptional: true,
    desc: 'ID check records for every adult occupier, kept for the tenancy plus one year. Set an expiry for follow-up checks on time-limited status.',
    applies: isLet, naReason: 'Not currently let' },
  { key: 'rra_info_sheet', label: 'Renters’ Rights information sheet', short: 'RRA sheet', icon: 'scale', tier: 1, group: 'tenancy', expiryOptional: true,
    desc: 'Statutory information sheet served at the start of the tenancy (replaced the How to Rent guide, withdrawn June 2026).',
    applies: isLet, naReason: 'Not currently let' },
  // ── Tier 2 — legal when applicable ────────────────────────────────────────
  { key: 'hmo', aliases: ['hmo_licence'], label: 'HMO licence', short: 'HMO', icon: 'home', tier: 2, group: 'licences', cycleMonths: 60,
    desc: 'Mandatory or additional HMO licence from the local council, typically valid 5 years.',
    applies: isHmo, naReason: 'Not an HMO' },
  { key: 'selective_licence', label: 'Selective licence', short: 'Selective', icon: 'landmark', tier: 2, group: 'licences', cycleMonths: 60,
    desc: 'Council landlord licence required in designated selective-licensing areas, typically valid 5 years.',
    applies: p => p?.licensing_scheme === 'selective', naReason: 'Not in a selective-licensing area' },
  { key: 'fire', aliases: ['fire_risk_assessment'], label: 'Fire risk assessment', short: 'Fire', icon: 'alert-triangle', tier: 2, group: 'certs', cycleMonths: 12,
    desc: 'Fire risk assessment for HMOs and buildings with common parts, reviewed regularly.',
    applies: isHmo, naReason: 'Not an HMO' },
  { key: 'fire_alarm_service', label: 'Fire alarm service', short: 'Fire alarm', icon: 'bell', tier: 2, group: 'certs', cycleMonths: 6,
    desc: 'Six-monthly service of the fire detection system (BS 5839) — usually an HMO licence condition.',
    applies: isHmo, naReason: 'Not an HMO' },
  { key: 'emergency_lighting', label: 'Emergency lighting test', short: 'Em. lighting', icon: 'sun', tier: 2, group: 'certs', cycleMonths: 12,
    desc: 'Annual emergency-lighting certificate (BS 5266) where fitted — usually an HMO licence condition.',
    applies: isHmo, naReason: 'Not an HMO' },
  { key: 'legionella', label: 'Legionella risk assessment', short: 'Legionella', icon: 'clipboard-check', tier: 2, group: 'certs', cycleMonths: 24,
    desc: 'Landlords must assess legionella risk; a written record (reviewed every 2 years) is the expected evidence.' },
  // ── Tier 3 — recommended / contractual ────────────────────────────────────
  { key: 'insurance', label: 'Buildings insurance', short: 'Insurance', icon: 'shield-check', tier: 3, group: 'insurance', cycleMonths: 12,
    desc: 'Not statutory, but required by every mortgage lender and most leases. Status comes from the Insurance register.' },
  { key: 'pat', label: 'PAT testing', short: 'PAT', icon: 'plug', tier: 3, group: 'certs', cycleMonths: 12,
    desc: 'Portable appliance testing for landlord-supplied appliances. Often an HMO licence condition.' },
  { key: 'boiler_service', label: 'Boiler / heating service', short: 'Boiler', icon: 'wrench', tier: 3, group: 'certs', cycleMonths: 12,
    desc: 'Annual boiler or heating-system service — keeps warranties valid and evidences maintenance.',
    applies: burnsFuel, naReason: 'No boiler / combustion heating' },
  { key: 'chimney_sweep', label: 'Chimney sweep', short: 'Chimney', icon: 'flame', tier: 3, group: 'certs', cycleMonths: 12,
    desc: 'Annual sweep certificate for solid-fuel appliances.',
    applies: p => p?.heating_type === 'solid_fuel', naReason: 'No solid-fuel appliance' },
  { key: 'inventory', label: 'Inventory / check-in report', short: 'Inventory', icon: 'list', tier: 3, group: 'tenancy', expiryOptional: true,
    desc: 'Not statutory, but essential evidence for deposit deductions at the end of a tenancy.',
    applies: isLet, naReason: 'Not currently let' },
]

export const TIER_LABELS = {
  1: 'Legal requirement',
  2: 'Legal when applicable',
  3: 'Recommended',
}

// Fast lookups. ALIAS_TO_KEY maps every legacy cert_type onto its canonical
// catalogue key (identity for canonical keys themselves).
export const CATALOGUE_BY_KEY = Object.fromEntries(COMPLIANCE_CATALOGUE.map(r => [r.key, r]))
export const ALIAS_TO_KEY = (() => {
  const m = {}
  for (const r of COMPLIANCE_CATALOGUE) {
    m[r.key] = r.key
    for (const a of (r.aliases || [])) m[a] = r.key
  }
  return m
})()

// Canonicalise a raw cert_type (legacy alias or canonical) to a catalogue key.
// Unknown types come back unchanged so 'other'/free-text rows keep working.
export const canonicalCertType = t => ALIAS_TO_KEY[String(t || '').toLowerCase()] || t

// Does a compliance_items row belong to this requirement?
export const itemMatchesRequirement = (certType, req) =>
  canonicalCertType(certType) === req.key

// ── Per-company tracking toggles ─────────────────────────────────────────────
// Stored as company_settings.compliance_tracked JSONB: { [key]: boolean }.
// Everything defaults ON — applicability flags (not toggles) keep the noise
// down, and users switch off what they don't want to track.
export function trackedRequirements(companySettings) {
  const overrides = companySettings?.compliance_tracked || {}
  return COMPLIANCE_CATALOGUE.filter(r => overrides[r.key] !== false)
}

// Requirements that both are tracked for the company AND apply to the
// property. This is the list an overview card should render.
export function requirementsForProperty(property, companySettings) {
  return trackedRequirements(companySettings).filter(r => !r.applies || r.applies(property))
}

// ── Per-property opt-outs ────────────────────────────────────────────────────
// properties.compliance_optout jsonb {key: true} — the landlord has switched
// this requirement off for THIS property. Opted-out items render dimmed on
// the overview (not as missing) and don't count toward scores. Tier 1 legal
// requirements can't be opted out — applicability flags are the only way a
// legal item goes away.
export const canOptOut = (req) => req.tier >= 2
export const isOptedOut = (property, key) => (property?.compliance_optout || {})[key] === true

// ── EPC / MEES helpers ───────────────────────────────────────────────────────
// properties.epc_rating is the register-synced band (epc-sync edge function,
// 2026-08-08_epc_register_sync.sql). MEES: the proposed minimum for the PRS
// rises to band C by end of 2030 — the same target/deadline EpcPlanner and
// the epc-planner edge function use. Band colours mirror the certificate.
export const EPC_BAND_COLOR = {
  A: '#1a8a3c', B: '#3aa655', C: '#8dc63f',
  D: '#f0c419', E: '#f39c12', F: '#e8770c', G: '#d0021b',
}
export const MEES_TARGET_BAND = 'C'
export const MEES_DEADLINE_ISO = '2030-12-31'
// The CURRENT legal minimum to let (MEES, in force since April 2020): band E.
// F/G properties cannot legally be let today — that's a live breach, not a
// 2030 problem, so surfaces treat it as red rather than an amber countdown.
export const MEES_MIN_LEGAL_BAND = 'E'
// Normalised band letter for a property, or null when unknown/unsynced.
export function epcBand(property) {
  const r = String(property?.epc_rating || '').trim().toUpperCase()
  return EPC_BAND_COLOR[r] ? r : null
}
// Below the MEES target? (Letters compare alphabetically: D > C.)
export const epcNeedsUpgrade = (band) => !!band && band > MEES_TARGET_BAND
// Below the CURRENT legal floor (F or G)?
export const epcBelowLegalMinimum = (band) => !!band && band > MEES_MIN_LEGAL_BAND
// Is the property let (or as good as)? Exported for the MEES-breach and
// PRS-readiness checks, which only bite on let properties.
export const isLetProperty = isLet

// ── Renewal booking links ────────────────────────────────────────────────────
// Where to send the landlord to book each renewal — the same authoritative
// trade-body links the compliance-reminders emails use (keep the two in
// sync). Shown on expired / expiring / missing checklist rows.
export const RENEWAL_BOOKING = {
  gas_safety:         { label: 'Find a Gas Safe engineer',    url: 'https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/' },
  eicr:               { label: 'Find an NICEIC electrician',  url: 'https://www.niceic.com/find-a-contractor' },
  epc:                { label: 'Find an EPC assessor',        url: 'https://www.gov.uk/get-new-energy-certificate' },
  smoke_alarm:        { label: 'Find an electrician',         url: 'https://www.niceic.com/find-a-contractor' },
  co_alarm:           { label: 'Find an electrician',         url: 'https://www.niceic.com/find-a-contractor' },
  legionella:         { label: 'Find a legionella assessor',  url: 'https://www.legionellacontrol.org.uk/' },
  hmo:                { label: 'Apply on your council site',  url: 'https://www.gov.uk/house-in-multiple-occupation-licence' },
  selective_licence:  { label: 'Find your council',           url: 'https://www.gov.uk/find-local-council' },
  fire:               { label: 'Find a fire risk assessor',   url: 'https://www.ifsm.org.uk/' },
  fire_alarm_service: { label: 'Find a fire alarm engineer',  url: 'https://www.niceic.com/find-a-contractor' },
  emergency_lighting: { label: 'Find an electrician',         url: 'https://www.niceic.com/find-a-contractor' },
  pat:                { label: 'Find a PAT tester',           url: 'https://search.napit.org.uk/' },
  boiler_service:     { label: 'Find a Gas Safe engineer',    url: 'https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/' },
  chimney_sweep:      { label: 'Find a chimney sweep',        url: 'https://www.findachimneysweep.co.uk/' },
  insurance:          { label: 'Compare landlord insurance',  url: 'https://www.simplybusiness.co.uk/landlord-insurance/' },
}

// Document category (DocumentsTab's DOC_CATEGORIES) a certificate upload
// should be filed under, per catalogue key. Anything unlisted → 'other'.
export const DOC_CATEGORY_FOR_CERT = {
  gas_safety: 'gas', eicr: 'eicr', epc: 'epc', insurance: 'insurance',
  inventory: 'inventory',
  tenancy_agreement: 'tenancy', deposit_protection: 'tenancy',
  right_to_rent: 'tenancy', rra_info_sheet: 'tenancy',
}

// The per-tenancy paperwork set — used by the staleness check ("this row
// pre-dates the current tenancy") in the UI and the autopilot detector.
export const TENANCY_PAPERWORK_KEYS = ['tenancy_agreement', 'deposit_protection', 'right_to_rent', 'rra_info_sheet', 'inventory']
