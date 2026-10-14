// jsPDF and pdf.js, bundled as exact-pinned npm dependencies and fetched on
// demand with dynamic import(), so each lands in its own lazy chunk and
// never in the entry bundle.
//
// Until 2026-10 both were injected as <script> tags from cdnjs without
// Subresource Integrity, so a compromised CDN response would have run with
// full access to a signed-in landlord's session. Serving them from our own
// origin removes that third party (and its CSP allowances) entirely. The
// versions match the CDN builds previously used (jsPDF 2.5.x, pdf.js
// 3.11.174), so output is unchanged.

export async function loadJsPDF() {
  const mod = await import('jspdf')
  return mod.jsPDF || mod.default?.jsPDF || mod.default
}

let pdfjsPromise = null

// Resolves to the pdf.js library object (what window.pdfjsLib used to be)
// with its worker pointed at our own hashed asset. Callers must keep
// passing isEvalSupported:false to getDocument (the CSP forbids eval).
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.js?url'),
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
