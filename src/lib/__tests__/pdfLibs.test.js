import { describe, it, expect } from 'vitest'
import { loadJsPDF, loadPdfjs } from '../pdfLibs'

describe('pdfLibs (bundled, lazy jsPDF and pdf.js)', () => {
  it('loadJsPDF resolves the jsPDF constructor and it can build a document', async () => {
    const jsPDF = await loadJsPDF()
    expect(typeof jsPDF).toBe('function')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    doc.text('Hello', 10, 10)
    const out = doc.output()
    expect(out.startsWith('%PDF-')).toBe(true)
  })

  it('loadPdfjs resolves pdf.js with the worker pointed at a same-origin asset', async () => {
    const lib = await loadPdfjs()
    expect(typeof lib.getDocument).toBe('function')
    expect(lib.version).toMatch(/^5\.4\./)
    const src = lib.GlobalWorkerOptions.workerSrc
    expect(typeof src).toBe('string')
    expect(src).not.toMatch(/^https?:/)
    // Memoised: one load per session.
    expect(await loadPdfjs()).toBe(lib)
  })
})
