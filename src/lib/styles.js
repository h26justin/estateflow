// Shared style tokens.
//
// The app's "theme" object (`T`) handles colours via ThemeContext, but the
// non-colour parts of the visual language — typography, spacing, common
// component recipes — were duplicated as inline objects across hundreds of
// places. This file is the canonical source for those recipes.
//
// Usage:
//   import { MONO, monoLabel, card, inp } from '../lib/styles'
//   <div style={card(T)}>
//     <label style={monoLabel(T)}>Field name</label>
//     <input style={inp(T)} />
//   </div>
//
// Functions take the theme `T` (from useTheme) and return ready-to-spread
// style objects. Callers can spread their own overrides on top, e.g.
//   style={{ ...card(T), maxWidth: 480 }}

export const MONO = "'DM Mono',monospace"

// UI / heading / body / button face — OwnProperly redesign (design/redesign-2026).
// DM Mono stays reserved for money, dates, metrics and eyebrow labels.
export const SANS =
  "'Schibsted Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

// ── TYPOGRAPHY ────────────────────────────────────────────────────────────

// Small uppercase mono label. Used above inputs and on small captions.
export const monoLabel = (T) => ({
  fontFamily: MONO,
  fontSize: 10,
  color: T.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  display: 'block',
  marginBottom: 6,
})

// Mono body text in muted colour. Used for explanatory paragraphs.
export const monoMuted = (T) => ({
  fontFamily: MONO,
  fontSize: 12,
  color: T.muted,
  lineHeight: 1.6,
})

// Mono body text in primary colour.
export const monoText = (T) => ({
  fontFamily: MONO,
  fontSize: 12,
  color: T.text,
  lineHeight: 1.6,
})

// Faint mono — for tertiary annotations like "as of 2026-04-01".
export const monoFaint = (T) => ({
  fontFamily: MONO,
  fontSize: 11,
  color: T.faint,
})

// Section heading style. `h2` size by default.
export const heading = (T, level = 2) => {
  const sizes = { 1: 30, 2: 26, 3: 16 }
  return {
    fontFamily: SANS,
    fontSize: sizes[level] || sizes[2],
    fontWeight: 700,
    color: T.text,
    letterSpacing: '-0.02em',
    marginBottom: 4,
  }
}

// ── CONTAINERS ────────────────────────────────────────────────────────────

// Standard surface card. Border + background follow the theme.
export const card = (T) => ({
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: '20px 22px',
})

// Modal body inner surface (used inside the global .modal class).
export const modalInner = (T) => ({
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 18,
  padding: '24px 28px',
})

// Inset / well — sunken panel inside a card (e.g. preview rows).
export const well = (T) => ({
  background: T.bg,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '14px 16px',
})

// ── FORM FIELDS ───────────────────────────────────────────────────────────

// Text input / textarea / select. Spread on top: `style={{...inp(T), width: 200}}`.
export const inp = (T) => ({
  fontFamily: MONO,
  fontSize: 13,
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: 8,
  padding: '10px 14px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
})

// ── BUTTONS ───────────────────────────────────────────────────────────────
// Note: .btn / .btn-gold / .btn-ghost CSS classes already exist in App.jsx's
// global <style> tag. These factories are for cases where inline styling is
// needed (e.g. dynamic colours, or in components rendered before App mounts
// like the marketing site).

export const btnGold = (T) => ({
  background: T.gold,
  color: '#1A2530',
  fontFamily: MONO,
  fontSize: 13,
  fontWeight: 700,
  padding: '11px 22px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
})

export const btnGhost = (T) => ({
  background: 'transparent',
  color: T.muted,
  fontFamily: MONO,
  fontSize: 13,
  padding: '10px 22px',
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
})

export const btnDanger = (T) => ({
  background: T.red,
  color: 'white',
  fontFamily: MONO,
  fontSize: 13,
  fontWeight: 700,
  padding: '11px 22px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
})

// ── BADGES / PILLS ────────────────────────────────────────────────────────

// Soft-tinted pill, e.g. status indicators. Pass the accent colour.
export const pill = (accent) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  borderRadius: 20,
  background: accent + '22',
  border: `1px solid ${accent}44`,
  color: accent,
  fontSize: 11,
  fontFamily: MONO,
  fontWeight: 600,
})

// ── LAYOUT ────────────────────────────────────────────────────────────────

// Two-column grid used in property forms etc. Matches the .g2 CSS class.
export const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

// Mobile-breakpoint helper — call inside a media query in a <style> tag.
// Most styling is inline so media queries are awkward; prefer JS isMobile
// check from useWindowSize when responsive behaviour is needed.
export const MOBILE_BP = 768

// ── STATUS SYSTEM ─────────────────────────────────────────────────────────
// The redesign's semantic status palette (design/redesign-2026 handoff). Each
// status carries the spec's exact text colour AND a soft background tint, in
// both themes. ALWAYS pair the colour with a text label — never colour alone
// (colour-blind safety; it's in the brand rules). Light-mode text hues are
// darkened from the spec so they clear WCAG AA (>=4.5:1) ON THEIR OWN TINT —
// the spec values failed there (ok 3.07, warn 2.92, bad 4.12, void 4.09).
// Verified on each tint: ok #147A49→4.8:1, warn #8A5600→5.5:1, bad #A83328→5.7:1,
// info #2D6FA8→4.6:1 (already passed), void #5C6168→5.5:1. Dark pills all pass.
//
// Keys map to product meanings:
//   ok    = paid / valid / occupied / current
//   warn  = late / expiring / due soon
//   bad   = missed / expired / arrears / overdue
//   info  = refurb / in progress / informational
//   void  = void / not-applicable / inactive
export const STATUS = {
  light: {
    ok:   { text:'#147A49', bg:'#E8F4EC' },
    warn: { text:'#8A5600', bg:'#FBF1E2' },
    bad:  { text:'#A83328', bg:'#FAEAE8' },
    info: { text:'#2D6FA8', bg:'#E7F0F7' },
    void: { text:'#5C6168', bg:'#F1F0EC' },
  },
  dark: {
    ok:   { text:'#34C281', bg:'#15271F' },
    warn: { text:'#E2A24A', bg:'#2A2113' },
    bad:  { text:'#E06A5E', bg:'#2B1714' },
    info: { text:'#5B9BD8', bg:'#15212E' },
    void: { text:'#9AA0A6', bg:'#1B232B' },
  },
}

// Resolve a status palette for the current theme. `darkMode` from useTheme().
export const statusColors = (key, darkMode) =>
  (darkMode ? STATUS.dark : STATUS.light)[key] || (darkMode ? STATUS.dark : STATUS.light).void

// Ready-to-spread pill style for a status. e.g. style={statusPill('bad', darkMode)}
export const statusPill = (key, darkMode) => {
  const c = statusColors(key, darkMode)
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.text}33`,
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
}

// ── Z-INDEX LADDER ───────────────────────────────────────────────────────────
// The app had 21 distinct ad-hoc z-index values with no scale. New code takes
// its layer from here; existing values are being migrated opportunistically.
// Ladder (low → high):
//   header 100 · rail 120 · menuBackdrop 199 · menu/overlay 200 · drawer 300
//   popover 500 · adminOverlay 800 · banner 900 · toast 999 · topmost 2000
export const Z = {
  header: 100,
  rail: 120,
  menuBackdrop: 199,
  menu: 200,
  overlay: 200,   // matches the .overlay class in App.jsx's stylesheet
  drawer: 300,
  popover: 500,
  adminOverlay: 800,
  banner: 900,
  toast: 999,
  topmost: 2000,
}
