// Browser PDF -> text, shared by importers. pdf.js 5.4 (legacy build), bundled and
// lazy-loaded via lib/pdfLibs (no CDN). Lines are rebuilt through the page
// viewport (lib/pdfText.js) so rotated pages and wrapped cells read correctly.
import { loadPdfjs } from './pdfLibs'
import { linesFromTextItems, textFromPages } from './pdfText'

export async function extractPdfTextFromFile(file) {
  const pdfjsLib = await loadPdfjs()
  let pdf
  try {
    const data = await file.arrayBuffer()
    // isEvalSupported:false: the CSP does not allow eval.
    pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  } catch (e) {
    throw new Error(e?.message || 'The file does not appear to be a valid PDF')
  }
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    pages.push(linesFromTextItems(content.items, viewport.transform))
  }
  return textFromPages(pages)
}
