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

// ── SCALES ────────────────────────────────────────────────────────────────
// Canonical type / radius / spacing scales. Mirrored as CSS custom properties
// (--fs-*, --r-*, --sp-*) in src/styles/app.css; a test keeps them in sync.
//
// Type scale (px). NOTHING BELOW 11px: FS.xs is the floor for any text,
// including eyebrow labels and table captions. Older code still has 8–10px
// sizes; migrate them up to FS.xs when touched.
export const FS = { xs: 11, sm: 12, base: 13, md: 15, lg: 18, xl: 24, xxl: 30 }

// Corner radius (px). `pill` for fully rounded chips.
export const R = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 }

// Spacing, 4-pt scale (px): SP[1] = 4, SP[2] = 8 … SP[12] = 48.
export const SP = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 }

// Theme colours as CSS variable references. Unlike `T.*` these do not change
// identity when the theme flips, so a style object built with them can be
// hoisted out of render. Keys match the `T` palette in ThemeContext.
export const CV = {
  bg: 'var(--bg)', surface: 'var(--surface)', card: 'var(--card)', border: 'var(--border)',
  text: 'var(--text)', muted: 'var(--muted)', faint: 'var(--faint)',
  gold: 'var(--gold)', goldText: 'var(--gold-text)', onGold: 'var(--on-gold)',
  green: 'var(--green)', red: 'var(--red)', blue: 'var(--blue)', amber: 'var(--amber)', purple: 'var(--purple)',
}

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
  fontSize: FS.sm,
  color: T.muted,
  lineHeight: 1.6,
})

// Mono body text in primary colour.
export const monoText = (T) => ({
  fontFamily: MONO,
  fontSize: FS.sm,
  color: T.text,
  lineHeight: 1.6,
})

// Faint mono — for tertiary annotations like "as of 2026-04-01".
export const monoFaint = (T) => ({
  fontFamily: MONO,
  fontSize: FS.xs,
  color: T.faint,
})

// Section heading style. `h2` size by default.
export const heading = (T, level = 2) => {
  const sizes = { 1: FS.xxl, 2: 26, 3: 16 }
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
  fontSize: FS.base,
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: R.md,
  padding: '10px 14px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
})

// ── BUTTONS ───────────────────────────────────────────────────────────────
// Note: .btn / .btn-gold / .btn-ghost CSS classes live in src/styles/app.css,
// and new code should prefer <Button> from src/components/ui. These
// factories are for cases where inline styling is
// needed (e.g. dynamic colours, or in components rendered before App mounts
// like the marketing site).

export const btnGold = (T) => ({
  background: T.gold,
  color: '#1A2530',
  fontFamily: MONO,
  fontSize: FS.base,
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
  fontSize: FS.base,
  padding: '10px 22px',
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
})

export const btnDanger = (T) => ({
  background: T.red,
  color: 'white',
  fontFamily: MONO,
  fontSize: FS.base,
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
  fontSize: FS.xs,
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
    borderRadius: R.pill,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.text}33`,
    fontFamily: MONO,
    fontSize: FS.xs,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
}

// ── Z-INDEX LADDER ───────────────────────────────────────────────────────────
// The app had 21 distinct ad-hoc z-index values with no scale. New code takes
// its layer from here; existing values are being migrated opportunistically.
// Ladder (low → high):
//   header 100 · rail 120 · menuBackdrop 199 · menu/overlay 200 · drawer 300
//   popover 500 · adminOverlay 800 · banner 900 · confirm 950 · toast 999 · topmost 2000
export const Z = {
  header: 100,
  rail: 120,
  menuBackdrop: 199,
  menu: 200,
  overlay: 200,   // matches the .overlay class in src/styles/app.css
  drawer: 300,
  popover: 500,
  adminOverlay: 800,
  banner: 900,
  // The app-wide confirm dialog (ConfirmContext) is raised from inside every
  // other layer, including the Platform Admin overlay (300) and its own modals
  // (600-800), so it must clear all of them. Toasts still show above it.
  confirm: 950,
  toast: 999,
  topmost: 2000,
}
