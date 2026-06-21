// Hairline SVG icon set — OwnProperly redesign (design/redesign-2026).
//
// Replaces all emoji across nav, alerts, report categories, etc. with a single
// consistent stroked family (stroke ~1.7, round caps/joins, 24-unit viewBox).
//
// Usage:
//   import { Icon } from '../lib/icons'
//   <Icon name="shield-check" size={20} />
//   <Icon name="bell" size={18} color={T.muted} />
//
// `color` defaults to currentColor, so an icon inherits the text colour of its
// container — set colour via the parent or the `color` prop. Add new glyphs to
// PATHS only; keep them stroke-based (no fills) so they stay hairline.

// Each entry is the inner markup of a 0 0 24 24 SVG (paths/circles/lines).
const PATHS = {
  // ── Navigation ──────────────────────────────────────────────────────────
  'home': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  'building': '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-3h4v3"/>',
  'receipt': '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6"/>',
  'shield-check': '<path d="M12 3 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  'trending-up': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  'file-text': '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.8 7.8 0 0 0 0-2l1.6-1.3-1.5-2.6-2 .6a7.6 7.6 0 0 0-1.7-1l-.3-2h-3l-.3 2a7.6 7.6 0 0 0-1.7 1l-2-.6L4.5 7.7 6.1 9a7.8 7.8 0 0 0 0 2l-1.6 1.3 1.5 2.6 2-.6a7.6 7.6 0 0 0 1.7 1l.3 2h3l.3-2a7.6 7.6 0 0 0 1.7-1l2 .6 1.5-2.6z"/>',
  'grid': '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  'more': '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  'users': '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17.5 14.3A5.5 5.5 0 0 1 20.5 19"/>',
  'wrench': '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.3-.6-.6-2.3z"/>',

  // ── UI / actions ────────────────────────────────────────────────────────
  'bell': '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5 6.5 6.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  'moon': '<path d="M20 13.5A8 8 0 1 1 10.5 4 6.2 6.2 0 0 0 20 13.5z"/>',
  'check': '<path d="M4 12.5 9 17.5 20 6.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  'x': '<path d="M6 6l12 12M18 6 6 18"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'chevron-down': '<path d="M6 9.5 12 15.5 18 9.5"/>',
  'chevron-right': '<path d="M9.5 6 15.5 12 9.5 18"/>',
  'chevron-left': '<path d="M14.5 6 8.5 12 14.5 18"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  'alert-triangle': '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.5 5.3A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8"/><path d="M6.3 6.4A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 3.5-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  'search': '<circle cx="11" cy="11" r="7"/><path d="M20 20 16 16"/>',
  'log-out': '<path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14"/><path d="M17 8l4 4-4 4"/><path d="M21 12H9"/>',
  'calendar': '<rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  'pound': '<path d="M16 6.5A3.5 3.5 0 0 0 9 7v4H7m0 0h7m-7 0v3.5A2.5 2.5 0 0 1 5.5 17H17"/>',
  'pie-chart': '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3v9"/>',
  'landmark': '<path d="M12 3 3 8h18z"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7"/><path d="M3 21h18"/>',
  'wallet': '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 9h18"/><circle cx="17" cy="13.5" r="1.2"/>',
  'percent': '<path d="M5 19 19 5"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  'hammer': '<path d="M14 6l4 4M16 8l-9 9-3-3 9-9"/><path d="M12.5 3.5 18 9l3-3-5.5-5.5z"/>',
  'map': '<path d="M9 4 3 6.5v13.5L9 17.5 15 20 21 17.5V4L15 6.5 9 4z"/><path d="M9 4v13.5M15 6.5V20"/>',
  'folder': '<path d="M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  'inbox': '<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 14h4l1.5 3h6l1.5-3h4"/>',
  'sparkle': '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  'robot': '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="3" r="1"/>',
  'scale': '<path d="M12 3v18M7 21h10"/><path d="M12 5 5 7l-2.5 6a3 3 0 0 0 5 0L5 7M12 5l7 2-2.5 6a3 3 0 0 0 5 0L19 7"/>',
  'target': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>',
  'flame': '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3 0 1.5 1 2 1.5 2 0-3 2.5-5 2.5-8z"/>',
  'zap': '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  'leaf': '<path d="M20 4S8 3 5 11a6 6 0 0 0 8 8c8-3 7-15 7-15z"/><path d="M9 15c2-3 5-5 9-7"/>',
  'plug': '<path d="M9 3v5M15 3v5"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
  'clipboard-check': '<rect x="5" y="5" width="14" height="16" rx="1.5"/><path d="M9 5V3.5h6V5"/><path d="M9 13l2 2 4-4"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>',
  'phone': '<path d="M6 3h3l1.5 5-2 1.5a13 13 0 0 0 6 6l1.5-2 5 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  'message': '<path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/>',
  'upload': '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  'download': '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  'star': '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9z"/>',
  'trash': '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  'lock': '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  'id-card': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0M14 9.5h4M14 13h4"/>',
  'calculator': '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h4"/>',
  'megaphone': '<path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1z"/><path d="M18 8a4 4 0 0 1 0 8"/>',
  'key': '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M15 19l2-2"/>',
  'refresh': '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4"/>',
  'bell-off': '<path d="M18 9a6 6 0 0 0-9-5.2M6 9c0 5-2 6-2 6h11M4 4l16 16"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  'send': '<path d="M21 3 10.5 13.5M21 3l-7 18-4-7.5L2.5 10z"/>',
  'pin': '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  'flag': '<path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/>',
  'list': '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  'grid-2': '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
}

export function Icon({ name, size = 20, stroke = 1.7, color = 'currentColor', style, title, ...rest }) {
  const inner = PATHS[name]
  if (!inner) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ display: 'block', flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + inner }}
      {...rest}
    />
  )
}

export const ICON_NAMES = Object.keys(PATHS)
