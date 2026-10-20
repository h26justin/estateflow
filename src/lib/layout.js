// Page width for the app shell (header + main).
//
// Data pages (dashboard, portfolio, rent tracker, reports...) use the extra
// room on wide monitors: tables stop clipping and more cards fit per row.
// Text-heavy pages stay at a readable measure — long form rows and paragraphs
// get hard to scan when stretched across a 2000px screen.
export const CONTENT_MAX_WIDE = 1760
export const CONTENT_MAX_READING = 1240

const READING_VIEWS = new Set(['settings', 'feedback', 'renters-rights', 'mtd'])

export function contentMaxWidth(view) {
  return READING_VIEWS.has(view) ? CONTENT_MAX_READING : CONTENT_MAX_WIDE
}
