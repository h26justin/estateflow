// ── REPORT PDF KIT ──────────────────────────────────────────────────────────
// One look for every Properly PDF (Reports, the Year-End Tax Pack, loan
// statements): white paper so it prints cleanly, a letterhead with the
// company's logo at its true proportions, KPI tiles, and tables that sit in a
// single bordered block with a repeating header row and the totals inside.
//
// Drawing is pure jsPDF so it can be exercised outside the browser; only
// loadPdfImage() needs the DOM (it decodes any image type through a canvas).

export const PALETTE = {
  paper:  [255, 255, 255],
  tile:   [247, 246, 242],   // KPI tile / note fill
  head:   [244, 242, 236],   // table header fill
  border: [226, 223, 214],
  rule:   [236, 233, 225],   // row dividers
  ink:    [28, 40, 48],
  slate:  [44, 56, 66],
  muted:  [92, 102, 112],
  faint:  [120, 125, 130],
  gold:   [184, 144, 47],
  green:  [31, 140, 90],
  red:    [184, 57, 45],
  amber:  [150, 95, 5],
}

const PT = 0.3528 // mm per point

export const hexToRgb = h => (h || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)?.slice(1).map(x => parseInt(x, 16))
export const mix = (c, w, t) => c.map((v, i) => Math.round(v * t + w[i] * (1 - t)))

// Helvetica only carries Latin-1 glyphs; anything else prints as garbage.
export const clean = s => String(s ?? '')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[•·]/g, '-').replace(/→/g, '->')
  .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/ {2,}/g, ' ').trim()

const longDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Fetch an image of any type (PNG, JPG, SVG, WebP) and re-encode it as a PNG
 * no larger than maxPx on its long side, returning its natural proportions
 * so it can be drawn without stretching. null when it cannot be loaded.
 */
export async function loadPdfImage(url, maxPx = 900) {
  if (!url) return null
  let objectUrl
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    objectUrl = URL.createObjectURL(await r.blob())
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = objectUrl })
    const nw = img.naturalWidth || img.width || 1, nh = img.naturalHeight || img.height || 1
    const s = Math.min(1, maxPx / Math.max(nw, nh))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(nw * s)); cv.height = Math.max(1, Math.round(nh * s))
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
    return { data: cv.toDataURL('image/png'), w: cv.width, h: cv.height }
  } catch (_) {
    return null
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

// Scale (w, h) to fit inside (maxW, maxH) keeping the aspect ratio.
export function fitBox(w, h, maxW, maxH) {
  const s = Math.min(maxW / (w || 1), maxH / (h || 1))
  return { w: (w || 1) * s, h: (h || 1) * s }
}

// Right-align a column when most of its filled cells read as numbers / money.
export function isNumericColumn(cells) {
  const vals = cells.map(c => String(c ?? '').trim()).filter(v => v && v !== '-' && v !== '—')
  if (!vals.length) return false
  const num = vals.filter(v => /^[-−+(]?\s?[£$€]?\s?-?[\d,.]+%?\)?(\s?(pcm|pa|x|yrs?|months?|days?))?$/i.test(v)).length
  return num / vals.length >= 0.6
}

/**
 * Create a page-flowing PDF writer.
 * @param {object} doc      a jsPDF document (unit mm)
 * @param {object} opts
 * @param {number[]} [opts.accent]   brand colour as [r,g,b]
 * @param {object}   [opts.logo]     { data, w, h } from loadPdfImage
 * @param {object}   [opts.mark]     the Properly icon, same shape
 * @param {string}   [opts.footerLabel] centred footer text (company - report)
 */
export function createPdfWriter(doc, { accent, logo = null, mark = null, footerLabel = '' } = {}) {
  const P = PALETTE
  const A = accent || P.gold
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 14
  const CW = W - M * 2
  const BOTTOM = H - 20
  const skipFooter = new Set()
  let y = M

  const font = (size, style = 'normal', color = P.ink) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }
  const text = (s, x, yy, opts) => doc.text(typeof s === 'string' ? clean(s) : s, x, yy, opts)
  const wrap = (s, w) => doc.splitTextToSize(clean(s), Math.max(w, 4))
  const paper = () => { doc.setFillColor(...P.paper); doc.rect(0, 0, W, H, 'F') }
  const newPage = () => { doc.addPage(); paper(); y = M; return y }
  const ensure = h => { if (y + h > BOTTOM) newPage() }
  const drawImage = (img, x, yy, w, h) => { try { doc.addImage(img.data, 'PNG', x, yy, w, h, undefined, 'FAST') } catch (_) { /* unreadable image */ } }

  // Filled rectangle with only its top (or bottom) corners rounded.
  function halfRounded(x, yy, w, h, r, edge) {
    doc.roundedRect(x, yy, w, h, r, r, 'F')
    if (edge === 'top') doc.rect(x, yy + h - r, w, r, 'F')
    else doc.rect(x, yy, w, r, 'F')
  }

  // ── Letterhead ────────────────────────────────────────────────────────────
  // title: company (or lender) name; subtitle: report name; meta: lines on the
  // right (period, generated date).
  function letterhead({ title, subtitle, meta = [] }) {
    doc.setFillColor(...A); doc.rect(0, 0, W, 2.5, 'F')
    const top = 11
    let tx = M
    let logoH = 0
    const img = logo || mark
    if (img) {
      const box = logo ? fitBox(img.w, img.h, 34, 22) : fitBox(img.w, img.h, 12, 12)
      drawImage(img, M, top, box.w, box.h)
      tx = M + box.w + 6
      logoH = box.h
    }
    const metaW = 58
    const titleW = W - M - metaW - tx
    font(17, 'bold'); const tl = wrap(title || 'Portfolio report', titleW).slice(0, 2)
    font(10.5, 'normal', P.muted); const sl = subtitle ? wrap(subtitle, titleW).slice(0, 2) : []
    const textH = tl.length * 6.6 + sl.length * 4.6
    // Vertically centre the text block on the logo when the logo is taller.
    let ty = top + Math.max(0, (logoH - textH) / 2) + 5.6
    font(17, 'bold'); tl.forEach(l => { text(l, tx, ty); ty += 6.6 })
    ty -= 1
    font(10.5, 'normal', P.muted); sl.forEach(l => { text(l, tx, ty + 0.6); ty += 4.6 })
    font(8, 'normal', P.faint)
    meta.filter(Boolean).forEach((m, i) => text(m, W - M, top + 4.2 + i * 4.4, { align: 'right' }))
    y = Math.max(top + logoH, ty - 2, top + meta.length * 4.4) + 5
    doc.setDrawColor(...P.border); doc.setLineWidth(0.25); doc.line(M, y, W - M, y)
    doc.setFillColor(...A); doc.rect(M, y - 0.5, 28, 1, 'F')
    y += 7
    return y
  }

  // Smaller band for a report inside a multi-report document.
  function sectionBand(title, subtitle) {
    ensure(24)
    font(14, 'bold'); text(title, M, y + 5)
    if (subtitle) { font(8.5, 'normal', P.muted); text(subtitle, M, y + 10.5) }
    y += subtitle ? 14 : 9
    doc.setDrawColor(...P.border); doc.setLineWidth(0.25); doc.line(M, y, W - M, y)
    doc.setFillColor(...A); doc.rect(M, y - 0.5, 28, 1, 'F')
    y += 7
  }

  function heading(s) {
    ensure(26)
    font(10.5, 'bold'); text(s, M, y + 4)
    doc.setFillColor(...A); doc.rect(M, y + 6.2, 18, 0.8, 'F')
    y += 11
  }

  function note(s) {
    if (!s) return
    font(7.8, 'normal', P.slate)
    const lines = wrap(s, CW - 12)
    const h = lines.length * 3.5 + 5.5
    ensure(h + 4)
    doc.setFillColor(...P.tile); doc.roundedRect(M, y, CW, h, 1.8, 1.8, 'F')
    doc.setFillColor(...A); doc.rect(M, y + 1.8, 1, h - 3.6, 'F')
    lines.forEach((l, i) => text(l, M + 5.5, y + 4.6 + i * 3.5))
    y += h + 6
  }

  // items: [label, value] or { label, value, sub, color }
  function kpis(items) {
    const list = (items || []).map(k => Array.isArray(k) ? { label: k[0], value: k[1] } : k).filter(Boolean)
    if (!list.length) return
    const perRow = Math.min(list.length, 4), gap = 4
    for (let i = 0; i < list.length; i += perRow) {
      const row = list.slice(i, i + perRow)
      const kw = (CW - (perRow - 1) * gap) / perRow
      const hasSub = row.some(k => k.sub)
      font(14, 'bold')
      const valueLines = row.map(k => wrap(k.value == null || k.value === '' ? '-' : String(k.value), kw - 9).slice(0, 2))
      const extra = Math.max(...valueLines.map(v => v.length)) > 1 ? 5.4 : 0
      const kh = 17.5 + extra + (hasSub ? 4 : 0)
      ensure(kh + gap)
      row.forEach((k, j) => {
        const x = M + j * (kw + gap)
        doc.setFillColor(...P.tile); doc.roundedRect(x, y, kw, kh, 1.8, 1.8, 'F')
        doc.setFillColor(...(k.color || A)); doc.rect(x + 4.5, y + 3.6, 7, 0.8, 'F')
        font(6.4, 'bold', P.muted); text(wrap(String(k.label).toUpperCase(), kw - 9)[0], x + 4.5, y + 8.4)
        const neg = /^[-−(]/.test(String(k.value ?? ''))
        font(14, 'bold', k.color || (neg ? P.red : P.ink))
        valueLines[j].forEach((l, li) => text(l, x + 4.5, y + 14.6 + li * 5.4))
        if (k.sub) { font(6.8, 'normal', P.faint); text(wrap(k.sub, kw - 9)[0], x + 4.5, y + kh - 3.2) }
      })
      y += kh + gap
    }
    y += 3
  }

  // Intent colour for plain string cells (non-first columns).
  function intent(val) {
    if (/^[-−(]\s?[£$€\d]/.test(val) || /EXPIRED|Overdue|overdue|Missing|Arrears/.test(val)) return P.red
    if (val === 'Valid' || val === 'Yes' || val === 'Rented' || val === 'All clear' || val === 'Paid' || val === 'Let') return P.green
    if (/Expiring|Due soon/.test(val)) return P.amber
    return P.slate
  }

  /**
   * A table in one bordered block. Header row repeats after a page break.
   * @param {object} t
   * @param {Array<string|{label,w,align}>} t.headers  w = fraction of width
   * @param {Array<Array|{cells,colors,bold}>} t.rows  a cell may be [main, sub]
   * @param {Array} [t.totals]
   * @param {boolean} [t.headless]  no header row (label / value lists)
   */
  function table({ headers, rows, totals, headless = false }) {
    const cols = headers.map(h => typeof h === 'object' ? { ...h } : { label: h })
    const norm = (rows || []).map(r => Array.isArray(r) ? { cells: r } : r)
    const n = cols.length
    const padX = 3, padY = 2.3, fs = n > 7 ? 7.6 : 8.4, lh = fs * PT * 1.22, capH = fs * PT * 0.74
    const cellMain = c => Array.isArray(c) ? c[0] : c

    // Alignment: first column left, others by content.
    cols.forEach((c, i) => {
      if (!c.align) c.align = i === 0 ? 'left' : (isNumericColumn(norm.map(r => cellMain(r.cells[i]))) ? 'right' : 'left')
    })
    // Widths: explicit fractions win; otherwise size to content, first column capped.
    if (cols.every(c => c.w)) cols.forEach(c => { c.mm = c.w * CW })
    else {
      const nat = cols.map((c, i) => {
        font(6.6, 'bold'); let m = doc.getTextWidth(clean(c.label).toUpperCase())
        font(fs, i === 0 ? 'bold' : 'normal')
        norm.slice(0, 200).forEach(r => { m = Math.max(m, doc.getTextWidth(clean(cellMain(r.cells[i])))) })
        ;(totals || []).length && (font(fs, 'bold'), m = Math.max(m, doc.getTextWidth(clean(totals[i] ?? ''))))
        return m + padX * 2
      })
      const cap = i => i === 0 ? CW * (n <= 2 ? 0.66 : 0.42) : CW * 0.3
      const min = i => i === 0 ? 30 : 16
      let w = nat.map((v, i) => Math.min(Math.max(v, min(i)), cap(i)))
      const sum = w.reduce((a, b) => a + b, 0)
      if (sum < CW) { const extra = CW - sum; w[0] += n <= 2 ? extra : extra * 0.5; if (n > 2) { const each = extra * 0.5 / (n - 1); w = w.map((v, i) => i ? v + each : v) } }
      else w = w.map(v => v * CW / sum)
      cols.forEach((c, i) => { c.mm = w[i] })
    }
    const xs = []; cols.reduce((x, c) => (xs.push(x), x + c.mm), M)
    const tx = (i, align) => align === 'right' ? xs[i] + cols[i].mm - padX : xs[i] + padX
    const opt = i => cols[i].align === 'right' ? { align: 'right' } : undefined

    let blockTop = y
    const closeBlock = () => { doc.setDrawColor(...P.border); doc.setLineWidth(0.3); doc.roundedRect(M, blockTop, CW, y - blockTop, 1.8, 1.8, 'S') }
    const headRow = () => {
      blockTop = y
      if (headless) { y += 0.4; return }
      font(6.6, 'bold', P.muted)
      const hl = cols.map((c, i) => wrap(String(c.label).toUpperCase(), cols[i].mm - padX * 2).slice(0, 2))
      const hh = 5 + Math.max(...hl.map(l => l.length)) * 2.9
      blockTop = y
      doc.setFillColor(...P.head); halfRounded(M, y, CW, hh, 1.8, 'top')
      hl.forEach((ls, i) => ls.forEach((l, li) => text(l, tx(i, cols[i].align), y + 4.6 + li * 2.9, opt(i))))
      y += hh
    }
    const measure = r => {
      const lines = r.cells.map((c, i) => {
        const [main, sub] = Array.isArray(c) ? c : [c]
        font(fs, i === 0 || r.bold?.[i] ? 'bold' : 'normal')
        const ml = wrap(String(main ?? ''), cols[i].mm - padX * 2).slice(0, 3)
        return { ml, sub: sub ? wrap(String(sub), cols[i].mm - padX * 2)[0] : null }
      })
      const rows = Math.max(1, ...lines.map(l => l.ml.length + (l.sub ? 0.85 : 0)))
      return { lines, h: padY * 2 + capH + (rows - 1) * lh }
    }

    ensure(24)
    headRow()
    norm.forEach((r, ri) => {
      const m = measure(r)
      if (y + m.h > BOTTOM) { closeBlock(); newPage(); headRow() }
      if (ri > 0) { doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.line(M, y, W - M, y) }
      m.lines.forEach((l, i) => {
        const main = String(cellMain(r.cells[i]) ?? '')
        const color = r.colors?.[i] || (i === 0 ? P.ink : intent(main))
        font(fs, i === 0 || r.bold?.[i] ? 'bold' : 'normal', color)
        l.ml.forEach((s, li) => text(s, tx(i, cols[i].align), y + padY + capH + li * lh, opt(i)))
        if (l.sub) { font(fs - 1.4, 'normal', P.muted); text(l.sub, tx(i, cols[i].align), y + padY + capH + l.ml.length * lh * 0.92, opt(i)) }
      })
      y += m.h
    })
    if (!norm.length) {
      font(8.4, 'italic', P.faint); text('Nothing to show for this period.', M + padX, y + padY + capH); y += padY * 2 + capH
    }
    if (totals && totals.some(t => t)) {
      const th = padY * 2 + capH + 1
      if (y + th > BOTTOM) { closeBlock(); newPage(); headRow() }
      doc.setFillColor(...mix(A, P.paper, 0.1)); halfRounded(M, y, CW, th, 1.8, 'bottom')
      doc.setFillColor(...A); doc.rect(M, y, CW, 0.6, 'F')
      font(fs, 'bold')
      totals.forEach((v, i) => { if (v) text(String(v), tx(i, cols[i].align), y + padY + capH + 0.8, opt(i)) })
      y += th
    }
    closeBlock()
    y += 7
  }

  // Label / value pairs in one bordered block.
  function details(pairs) {
    const shown = (pairs || []).filter(p => p && p[1] != null && p[1] !== '')
    if (!shown.length) return
    table({ headless: true, headers: [{ label: '', w: 0.4 }, { label: '', w: 0.6, align: 'right' }], rows: shown.map(([k, v]) => ({ cells: [k, v], colors: [P.muted, P.ink], bold: [false, true] })) })
  }

  function footer(pageNo, pages) {
    const fy = H - 12
    doc.setDrawColor(...P.border); doc.setLineWidth(0.25); doc.line(M, fy - 3, W - M, fy - 3)
    let lx = M
    if (mark) { drawImage(mark, M, fy - 1.2, 4.2, 4.2); lx += 6 }
    font(7, 'bold', P.slate); text('Properly', lx, fy + 1.9)
    const pw = doc.getTextWidth('Properly ')
    font(7, 'normal', P.faint); text('ownproperly.com', lx + pw, fy + 1.9)
    if (footerLabel) { font(7, 'normal', P.faint); text(doc.splitTextToSize(clean(footerLabel), CW * 0.5)[0], W / 2, fy + 1.9, { align: 'center' }) }
    font(7, 'normal', P.muted); text(`Page ${pageNo} of ${pages}`, W - M, fy + 1.9, { align: 'right' })
  }

  // Draw footers on every page (except any marked with skipFooterOn).
  function finish() {
    const pages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= pages; p++) { if (skipFooter.has(p)) continue; doc.setPage(p); footer(p, pages) }
    return pages
  }

  paper()
  return {
    doc, W, H, M, CW, BOTTOM, accent: A,
    get y() { return y }, set y(v) { y = v },
    font, text, wrap, newPage, ensure, drawImage,
    letterhead, sectionBand, heading, note, kpis, table, details, finish,
    skipFooterOn: p => skipFooter.add(p),
    currentPage: () => doc.getCurrentPageInfo().pageNumber,
    generatedOn: () => longDate(new Date()),
  }
}
