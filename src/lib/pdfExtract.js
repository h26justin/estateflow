// Browser PDF -> text, shared by importers. pdf.js v3.11.174 from cdnjs
// (CSP allow-listed in vercel.json). Lines are rebuilt through the page
// viewport (lib/pdfText.js) so rotated pages and wrapped cells read correctly.
import { loadCdnScript } from './loadCdnScript'
import { linesFromTextItems, textFromPages } from './pdfText'

export const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'

export async function extractPdfTextFromFile(file) {
  await loadCdnScript(`${PDFJS_CDN}/pdf.min.js`, 'pdfjsLib')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`
  let pdf
  try {
    const data = await file.arrayBuffer()
    // isEvalSupported:false: the CSP does not allow eval.
    pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
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
