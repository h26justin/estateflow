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
  const sizes = { 1: 28, 2: 20, 3: 16 }
  return {
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
