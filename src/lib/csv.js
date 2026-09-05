// CSV export helpers shared by the pages that offer a download.
//
// csvSafe guards against formula injection: a cell beginning with = + - @ or
// a tab / CR executes as a formula when the file is opened in Excel or
// Sheets. Prefix a quote unless the value is a plain number, because negative
// amounts must stay numeric. (Same rule as ReportsPage, lifted out so every
// exporter shares it.)
export function csvSafe(v) {
  const s = String(v == null ? '' : v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) return "'" + s
  return s
}

// rows: array of arrays. Every cell is quoted, quotes doubled.
export function toCsv(rows) {
  return rows.map(r => r.map(v => `"${csvSafe(v).replace(/"/g, '""')}"`).join(',')).join('\n')
}

// Trigger a browser download of `rows` as `filename`. No-op outside a DOM.
export function downloadCsv(filename, rows) {
  if (typeof document === 'undefined') return
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
