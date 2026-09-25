// Rebuild reading-order lines from pdf.js text items.
//
// Why this exists: the importer used to group glyph runs by their raw
// transform[5] (PDF user-space y). That breaks on rotated pages (an RMS
// statement is a landscape page with /Rotate 90, so "y" is really "x" and the
// text came out scrambled) and it split cells whose text wraps onto a second
// baseline. Here every item is first mapped through the page viewport, which
// applies rotation, then grouped by device-space baseline and sorted by x.
//
// Pure: no pdf.js import, so it is unit-testable and reusable in Node.

// Multiply a pdf.js 2D transform [a,b,c,d,e,f] by a point.
function applyTransform(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

// Device-space position and size of one text item.
export function devicePosition(item, viewportTransform) {
  const t = item.transform || [1, 0, 0, 1, 0, 0]
  const p = applyTransform(viewportTransform, t[4], t[5])
  // Glyph height in device space: length of the transformed (0, fontSize) vector.
  const fontSize = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10
  const up = applyTransform(viewportTransform, t[4], t[5] + fontSize)
  const height = Math.hypot(up.x - p.x, up.y - p.y) || fontSize
  // Width along the reading direction.
  const right = applyTransform(viewportTransform, t[4] + (item.width || 0), t[5])
  const width = Math.hypot(right.x - p.x, right.y - p.y)
  return { x: p.x, y: p.y, height, width }
}

// Group items into lines. `viewportTransform` comes from
// page.getViewport({ scale: 1 }).transform and already includes /Rotate.
// Returns an array of strings in reading order (top to bottom, left to right).
export function linesFromTextItems(items, viewportTransform = [1, 0, 0, -1, 0, 0]) {
  const placed = []
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string') continue
    if (!it.str.trim() && !it.hasEOL) continue
    const pos = devicePosition(it, viewportTransform)
    placed.push({ str: it.str, ...pos })
  }
  if (!placed.length) return []
  // Sort by baseline (device y grows downwards), then x.
  placed.sort((a, b) => (a.y - b.y) || (a.x - b.x))

  const lines = []
  let cur = null
  for (const it of placed) {
    // Same line when the baselines are within half a glyph height.
    const tol = Math.max(2, Math.min(it.height, cur?.height || it.height) * 0.5)
    if (cur && Math.abs(it.y - cur.y) <= tol) {
      cur.items.push(it)
    } else {
      cur = { y: it.y, height: it.height, items: [it] }
      lines.push(cur)
    }
  }
  return lines.map(l => {
    l.items.sort((a, b) => a.x - b.x)
    let out = ''
    let lastEnd = null
    let charW = null
    for (const it of l.items) {
      const s = it.str
      if (lastEnd != null) {
        const gap = it.x - lastEnd
        // A gap wider than a third of a character means a word boundary; a
        // very wide gap is a column boundary and gets two spaces so parsers
        // can tell cells apart.
        const w = charW || Math.max(3, it.height * 0.5)
        if (gap > w * 3) out += '  '
        else if (gap > w * 0.3 || (!out.endsWith(' ') && !s.startsWith(' ') && gap > 0.5)) out += ' '
      }
      out += s
      lastEnd = it.x + it.width
      if (s.trim().length && it.width) charW = it.width / s.length
    }
    return out.replace(/\s+$/g, '').replace(/[ \t]{3,}/g, '  ')
  }).filter(l => l.trim().length)
}

// Full-document text: lines joined with newlines, pages separated by a marker
// the parsers ignore.
export function textFromPages(pages) {
  return pages.map(lines => lines.join('\n')).join('\n\n--- PAGE BREAK ---\n\n')
}
