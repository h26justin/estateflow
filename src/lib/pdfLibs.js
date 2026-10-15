// jsPDF and pdf.js, bundled as exact-pinned npm dependencies and fetched on
// demand with dynamic import(), so each lands in its own lazy chunk and
// never in the entry bundle.
//
// Until 2026-10 both were injected as <script> tags from cdnjs without
// Subresource Integrity, so a compromised CDN response would have run with
// full access to a signed-in landlord's session. Serving them from our own
// origin removes that third party (and its CSP allowances) entirely.
//
// 2026-10: jsPDF 2.5.2 -> 4.x and pdf.js 3.11.174 -> 5.4.x to clear the
// production npm audit (dompurify via jsPDF; tar via pdf.js's old optional
// node-canvas). Output of every generator is pinned by
// __tests__/pdfOutput.test.js. pdf.js comes from its *legacy* build: the
// default build targets only the latest browsers, while the 5.4.x legacy
// build targets Chrome 110+ / Safari 16.4+, which covers Vite's default
// build target. pdf.js 6 raises that to Chrome 125+ / Safari 18+, so stay on 5.4.x
// until our browser floor moves.

export async function loadJsPDF() {
  const mod = await import('jspdf')
  return mod.jsPDF || mod.default?.jsPDF || mod.default
}

let pdfjsPromise = null

// Resolves to the pdf.js library object (what window.pdfjsLib used to be)
// with its worker pointed at our own hashed asset (an ES module worker, which
// CSP worker-src 'self' allows). Callers must keep passing
// isEvalSupported:false to getDocument (the CSP forbids eval).
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([mod, worker]) => {
      const lib = mod.GlobalWorkerOptions ? mod : mod.default
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })
    // Let a transient chunk-load failure be retried on the next attempt.
    pdfjsPromise.catch(() => { pdfjsPromise = null })
  }
  return pdfjsPromise
}
