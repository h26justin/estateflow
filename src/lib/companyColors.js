// Company brand-colour presets (CompanyModal, Settings → Branding).
//
// A company colour is painted as text (company pills, the tenant-portal name,
// links), as a fill under white labels (portal buttons, the PDF report header
// band) and as an accent bar. The old palette (#C8A84B gold, #2ECC8A,
// #4B8FE0, #E0943A …) was tuned for the old dark theme and sat at 1.9–3.3:1
// on white, so most presets failed WCAG AA wherever they became text.
//
// These are the redesign hues (design/redesign-2026) darkened to clear
// 4.5:1 against both white and paper (#F4F3EF) — so they work as text on
// light surfaces and as a fill under white text. On dark surfaces (the
// portal header, dark mode) callers still route through lib/contrast's
// readableOr(), which swaps in a neutral where a colour can't reach 4.5:1.
// src/lib/__tests__/companyColors.test.js enforces the floor.
export const COMPANY_COLORS = [
  { name: 'Gold',   hex: '#8C6A1E' },
  { name: 'Blue',   hex: '#2D6FA8' },
  { name: 'Navy',   hex: '#2B4C7E' },
  { name: 'Teal',   hex: '#1E6F7C' },
  { name: 'Green',  hex: '#167A4C' },
  { name: 'Purple', hex: '#7B3FA0' },
  { name: 'Plum',   hex: '#9C3563' },
  { name: 'Red',    hex: '#B8392D' },
  { name: 'Rust',   hex: '#A2501A' },
  { name: 'Slate',  hex: '#56636E' },
]

// New companies start on the gold preset (the brand accent, AA-safe).
export const DEFAULT_COMPANY_COLOR = COMPANY_COLORS[0].hex

export function companyColorName(hex) {
  const h = String(hex || '').toLowerCase()
  return COMPANY_COLORS.find(c => c.hex.toLowerCase() === h)?.name || null
}
