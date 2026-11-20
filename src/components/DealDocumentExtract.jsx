// Assisted import review panel (Deals brief §9).
//
// Opened from "Extract figures" on a PDF in a deal's documents tab. The
// document's text is read in the browser (lib/pdfExtract), parsed into
// suggestions (lib/completionStatementParser) and stored as pending rows in
// extracted_fields, so they survive a reload. The page text sits beside the
// suggestions with each one's quoted line highlighted.
//
// A person decides every suggestion:
//   - Approve writes a source-linked deal_cost_lines row (source
//     "<document> p.<page>", notes = the quote) and marks the suggestion
//     approved with applied_to = that line's id. Check figures (total,
//     balance due, mortgage advance, asking price) write nothing else.
//   - If the category already has a cost line, the person chooses to replace
//     it or add alongside it. Nothing is overwritten without that choice.
//   - Reject marks the suggestion rejected and changes nothing else.
//
// A scan (no text layer) can be read on request with "Read the scan": the
// extract-document edge function transcribes it and the same parser runs on
// that text. Figures read from a scan are capped at medium confidence, carry
// a warning, and are approved one at a time (no "Approve all valid").
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Modal, Button } from './ui'
import { useTheme } from '../lib/ThemeContext'
import { MONO, SANS, FS } from '../lib/styles'
import * as api from '../lib/api'
import { extractPdfPagesFromFile } from '../lib/pdfExtract'
import { extractDealDocumentFields, validateFor, vatIncludedFor } from '../lib/completionStatementParser'
import { COST_CATEGORIES, COST_CATEGORY_LABEL, COST_STATE_LABEL } from '../lib/dealFinance'
import {
  CHECK_FIGURE, REVIEW_STATES, DEFAULT_STATE, categoryForField, isCheckField, fieldLabel, parseAmount,
  costLineFromSuggestion, conflictingLines, newSuggestionsOnly, bulkApprovable,
} from '../lib/dealDocExtract'

const gbp = n => n == null ? '–' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Scan-read figures are never shown as high confidence.
const OCR_MAX_CONFIDENCE = 0.6
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

export function isExtractableDoc(doc) {
  const ext = ((doc?.name || doc?.file_path || '').split('.').pop() || '').toLowerCase()
  return (doc?.type || '').toLowerCase() === 'application/pdf' || ext === 'pdf'
}

// Read the stored PDF and return its text, one array of lines per page.
async function loadPages(doc) {
  const url = await api.getDocumentSignedUrl(doc.file_path)
  if (!url) throw new Error('Could not open the document')
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not download the document')
  return extractPdfPagesFromFile(await res.blob())
}

function ConfidenceBadge({ value, T }) {
  if (value == null) return null
  const v = Number(value)
  const [label, color] = v >= 0.85 ? ['High', T.green] : v >= 0.6 ? ['Medium', T.amber] : ['Low', T.red]
  return (
    <span title={`Confidence ${Math.round(v * 100)}%`}
      style={{fontFamily:MONO, fontSize:FS.xs, color, border:`1px solid ${color}`, borderRadius:999, padding:'1px 7px', whiteSpace:'nowrap'}}>
      {label} {Math.round(v * 100)}%
    </span>
  )
}

export default function DealDocumentExtract({ dealId, doc, onClose, showToast = () => {}, onApplied }) {
  const { T } = useTheme()
  const [phase, setPhase] = useState('loading')   // loading | ready | error
  const [error, setError] = useState(null)
  const [pages, setPages] = useState(null)        // [[line]] or null
  const [textError, setTextError] = useState(null)
  const [docType, setDocType] = useState(null)
  const [rows, setRows] = useState([])            // extracted_fields rows for this document
  const [edits, setEdits] = useState({})          // id -> { value, category, state }
  const [costLines, setCostLines] = useState([])
  const [busy, setBusy] = useState(null)          // row id | 'bulk' | 'extract'
  const [conflict, setConflict] = useState(null)  // { row, lines }
  const [active, setActive] = useState(null)      // row id highlighted in the page text
  const [pageNo, setPageNo] = useState(1)
  const [ocr, setOcr] = useState(false)           // page text came from reading a scan

  const hasText = !!pages && pages.some(p => p.length)

  // Parse the page text and store what is new as pending suggestions.
  const extract = useCallback(async (pgs, existing, { fromScan = false } = {}) => {
    const out = extractDealDocumentFields(pgs)
    setDocType(out.docType)
    if (!out.hasText) return existing
    const fresh = newSuggestionsOnly(existing, out.suggestions)
    if (!fresh.length) return existing
    const inserted = await api.addExtractedFields(fresh.map(s => ({
      deal_id: dealId, document_id: doc.id, field: s.field, value_number: s.value_number,
      page: s.page, quote: s.quote,
      confidence: fromScan && s.confidence != null ? Math.min(s.confidence, OCR_MAX_CONFIDENCE) : s.confidence,
    })))
    return [...existing, ...inserted]
  }, [dealId, doc.id])

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [existing, lines] = await Promise.all([
          api.fetchExtractedFields(dealId, { documentId: doc.id }),
          api.fetchDealCostLines(dealId),
        ])
        if (!live) return
        setCostLines(lines)
        let pgs = null
        try { pgs = await loadPages(doc) } catch (e) { if (live) setTextError(e.message || 'Could not read the document') }
        if (!live) return
        setPages(pgs)
        // Stored suggestions are shown as they are; a first visit extracts.
        const all = existing.length || !pgs ? existing : await extract(pgs, existing)
        if (!live) return
        if (pgs && existing.length) setDocType(extractDealDocumentFields(pgs).docType)
        setRows(all)
        setPhase('ready')
      } catch (e) {
        if (!live) return
        setError(e.message || 'Could not load suggestions')
        setPhase('error')
      }
    })()
    return () => { live = false }
  }, [dealId, doc, extract])

  // Read a scan with the edge function, then parse it like any text PDF.
  async function readScan() {
    setBusy('ocr')
    try {
      const pgs = await api.transcribeDealDocument(doc.id)
      if (!pgs.some(p => p.length)) throw new Error('No text could be read from this scan')
      setPages(pgs); setOcr(true); setTextError(null); setPageNo(1)
      const before = rows.length
      const all = await extract(pgs, rows, { fromScan: true })
      setRows(all)
      showToast(all.length > before ? `Scan read: ${all.length - before} suggestion${all.length - before === 1 ? '' : 's'} to check` : 'Scan read: no new figures found')
    } catch (e) { showToast(e.message || 'Could not read the scan', 'error') }
    setBusy(null)
  }

  async function extractAgain() {
    if (!pages) return
    setBusy('extract')
    try {
      const before = rows.length
      const all = await extract(pages, rows, { fromScan: ocr })
      setRows(all)
      showToast(all.length > before ? `${all.length - before} new suggestion${all.length - before === 1 ? '' : 's'}` : 'No new figures found')
    } catch (e) { showToast(e.message || 'Could not extract', 'error') }
    setBusy(null)
  }

  const editOf = r => {
    const e = edits[r.id] || {}
    return {
      value: e.value !== undefined ? e.value : (r.value_number ?? ''),
      category: e.category !== undefined ? e.category : (categoryForField(r.field) || ''),
      state: e.state || DEFAULT_STATE,
    }
  }
  const setEdit = (id, patch) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  // Validation on the values as edited; rejected rows are left out.
  const validation = useMemo(() => {
    const live = rows.map(r => ({ field: r.field, status: r.status, value_number: r.status === 'pending' ? parseAmount(editOf(r).value) : r.value_number }))
    return live.length ? validateFor(docType || 'completion_statement', live) : null
  }, [rows, edits, docType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Write the cost line (or nothing, for a check figure), then mark the
  // suggestion approved. If the review is refused, undo the cost line write.
  async function applyOne(row, { mode = null, replaceId = null } = {}) {
    const e = editOf(row)
    const amount = parseAmount(e.value)
    if (amount == null) throw new Error('Enter an amount of £0 or more')
    const category = e.category || null
    if (!category) {
      if (!isCheckField(row.field)) throw new Error('Choose a category')
      return api.reviewExtractedField(row.id, { status: 'approved', applied_to: CHECK_FIGURE, value_number: amount })
    }
    const existing = conflictingLines(costLines, category)
    if (existing.length && !mode) return { conflict: existing }
    const line = costLineFromSuggestion(row, {
      docName: doc.name, category, amount, state: e.state, vatIncluded: vatIncludedFor(row.field, row.quote),
    })
    const previous = mode === 'replace' ? existing.find(l => l.id === replaceId) : null
    if (mode === 'replace' && !previous) throw new Error('That cost line is no longer there')
    const saved = await api.upsertDealCostLine(dealId, previous ? { ...line, id: previous.id } : line)
    let reviewed
    try {
      reviewed = await api.reviewExtractedField(row.id, { status: 'approved', applied_to: saved.id, value_number: amount })
    } catch (err) {
      try {
        if (previous) await api.upsertDealCostLine(dealId, previous)
        else await api.deleteDealCostLine(saved.id)
      } catch (_) { /* surfaced below */ }
      throw err
    }
    setCostLines(prev => previous ? prev.map(l => l.id === saved.id ? saved : l) : [...prev, saved])
    return reviewed
  }

  async function approve(row, opts) {
    setBusy(row.id)
    try {
      const res = await applyOne(row, opts)
      if (res?.conflict) { setConflict({ row, lines: res.conflict }); setBusy(null); return }
      setRows(prev => prev.map(r => r.id === row.id ? res : r))
      setConflict(null)
      showToast(res.applied_to === CHECK_FIGURE ? `${fieldLabel(row.field)} confirmed` : `${fieldLabel(row.field)} added to costs`)
      onApplied?.()
    } catch (e) { showToast(e.message || 'Could not approve', 'error') }
    setBusy(null)
  }

  async function reject(row) {
    setBusy(row.id)
    try {
      const res = await api.reviewExtractedField(row.id, { status: 'rejected' })
      setRows(prev => prev.map(r => r.id === row.id ? res : r))
      if (conflict?.row.id === row.id) setConflict(null)
    } catch (e) { showToast(e.message || 'Could not reject', 'error') }
    setBusy(null)
  }

  const bulk = useMemo(() => ocr ? { take: [], skipped: rows.filter(r => r.status === 'pending') }
    : bulkApprovable(rows, Object.fromEntries(rows.map(r => [r.id, editOf(r)])), costLines),
    [rows, edits, costLines, ocr]) // eslint-disable-line react-hooks/exhaustive-deps
  const mismatch = validation?.status === 'mismatch'

  async function approveAllValid() {
    setBusy('bulk')
    let done = 0
    const failed = []
    for (const row of bulk.take) {
      try {
        const res = await applyOne(row, { mode: 'add' })
        setRows(prev => prev.map(r => r.id === row.id ? res : r))
        done++
      } catch (e) { failed.push(`${fieldLabel(row.field)}: ${e.message}`) }
    }
    const left = bulk.skipped.length
    showToast(`Approved ${done}${left ? `; ${left} left for you to review` : ''}${failed.length ? `; failed: ${failed.join('; ')}` : ''}`, failed.length ? 'error' : undefined)
    if (done) onApplied?.()
    setBusy(null)
  }

  function focusRow(r) {
    setActive(r.id)
    if (r.page) setPageNo(r.page)
  }

  const activeQuote = norm(rows.find(r => r.id === active)?.quote)
  const pageLines = (pages && pages[pageNo - 1]) || []
  const pending = rows.filter(r => r.status === 'pending')
  const valColor = !validation ? T.muted : validation.status === 'ok' ? T.green : validation.status === 'mismatch' ? T.red : T.amber
  const inputStyle = { fontFamily:MONO, fontSize:FS.sm, background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:'4px 6px', minWidth:0 }

  return (
    <Modal onClose={onClose} size="xl" title="Extract figures" description={doc.name}
      footer={<>
        {hasText && <Button variant="secondary" size="sm" loading={busy === 'extract'} disabled={!!busy} onClick={extractAgain}>Extract again</Button>}
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button variant="primary" size="sm" disabled={!!busy || !bulk.take.length || mismatch} loading={busy === 'bulk'}
          title={ocr ? 'Figures read from a scan are approved one at a time' : mismatch ? 'The figures do not balance: review each one' : undefined} onClick={approveAllValid}>
          Approve all valid{bulk.take.length ? ` (${bulk.take.length})` : ''}
        </Button>
      </>}>
      {phase === 'loading' && <div style={{fontFamily:SANS, fontSize:FS.base, color:T.muted, padding:20}}>Reading the document…</div>}
      {phase === 'error' && <div role="alert" style={{fontFamily:SANS, fontSize:FS.base, color:T.red, padding:20}}>{error}</div>}
      {phase === 'ready' && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:16, alignItems:'start'}}>
          {/* Document text, with the selected suggestion's line highlighted. */}
          <section aria-label="Document text" style={{background:T.bg, border:`1px solid ${T.border}`, borderRadius:10, padding:12, minWidth:0}}>
            {pages && pages.length > 1 && (
              <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
                {pages.map((_, i) => (
                  <Button key={i} size="sm" variant={pageNo === i + 1 ? 'primary' : 'secondary'} onClick={() => setPageNo(i + 1)}>p.{i + 1}</Button>
                ))}
              </div>
            )}
            {!hasText ? (
              <div role="status" style={{fontFamily:SANS, fontSize:FS.base, color:T.text, lineHeight:1.6}}>
                <strong>No text found in this PDF.</strong>
                <div style={{color:T.muted, fontSize:FS.sm}}>
                  {textError || 'This looks like a scan with no text layer.'} Read the scan with AI to get suggestions you check one by one, or add the figures on the deal's Costs &amp; funding tab.
                </div>
                <div style={{marginTop:10}}>
                  <Button size="sm" variant="primary" loading={busy === 'ocr'} disabled={!!busy} onClick={readScan}>Read the scan</Button>
                </div>
              </div>
            ) : (
              <div style={{fontFamily:MONO, fontSize:FS.xs, color:T.text, maxHeight:'60vh', overflow:'auto', whiteSpace:'pre-wrap'}}>
                {pageLines.map((l, i) => {
                  const hit = activeQuote && norm(l).length > 2 && activeQuote.includes(norm(l))
                  return <div key={i} data-highlight={hit ? 'true' : undefined}
                    style={{background: hit ? T.gold + '33' : 'transparent', borderRadius:4, padding:'1px 4px'}}>{l}</div>
                })}
              </div>
            )}
          </section>

          {/* Suggestions */}
          <section aria-label="Suggestions" style={{minWidth:0}}>
            {ocr && (
              <div role="note" style={{border:`1px solid ${T.amber}`, color:T.amber, background:T.amber + '14', borderRadius:10, padding:'8px 12px', fontFamily:SANS, fontSize:FS.sm, marginBottom:12}}>
                Text read from a scan by AI. Check every figure against the original document before approving.
              </div>
            )}
            {validation && (
              <div role="status" style={{border:`1px solid ${valColor}`, color:valColor, borderRadius:10, padding:'8px 12px', fontFamily:SANS, fontSize:FS.sm, marginBottom:12}}>
                {validation.message}
                {validation.itemsDifference != null && Math.abs(validation.itemsDifference) > 1 && (
                  <div style={{color:T.muted}}>The line items found add up to {gbp(validation.itemsTotal)}; some lines may be missing or repeated.</div>
                )}
              </div>
            )}
            {!rows.length && hasText && (
              <div style={{fontFamily:SANS, fontSize:FS.sm, color:T.muted}}>No figures recognised in this document. Enter them on the Costs &amp; funding tab.</div>
            )}
            <div style={{display:'grid', gap:8}}>
              {rows.map(r => {
                const e = editOf(r)
                const check = isCheckField(r.field)
                const decided = r.status !== 'pending'
                return (
                  <div key={r.id} data-testid={`suggestion-${r.field}`} onClick={() => focusRow(r)}
                    style={{border:`1px solid ${active === r.id ? T.gold : T.border}`, borderRadius:10, padding:'10px 12px', background:T.card, opacity: r.status === 'rejected' ? 0.6 : 1}}>
                    <div style={{display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                      <strong style={{fontFamily:SANS, fontSize:FS.base, color:T.text}}>{fieldLabel(r.field)}</strong>
                      <span style={{display:'flex', gap:6, alignItems:'center'}}>
                        <ConfidenceBadge value={r.confidence} T={T}/>
                        {decided && <span style={{fontFamily:MONO, fontSize:FS.xs, color: r.status === 'approved' ? T.green : T.muted}}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span>}
                      </span>
                    </div>
                    <div style={{fontFamily:MONO, fontSize:FS.xs, color:T.muted, margin:'4px 0'}}>
                      {r.page ? `p.${r.page} · ` : ''}“{r.quote || ''}”
                    </div>
                    {decided ? (
                      <div style={{fontFamily:MONO, fontSize:FS.sm, color:T.text}}>{gbp(r.value_number)}{r.applied_to === CHECK_FIGURE ? ' · check figure' : ''}</div>
                    ) : (
                      <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}} onClick={ev => ev.stopPropagation()}>
                        <input aria-label={`${fieldLabel(r.field)} amount`} inputMode="decimal" value={e.value}
                          onChange={ev => setEdit(r.id, { value: ev.target.value })} style={{...inputStyle, width:110}}/>
                        {check ? (
                          <span style={{fontFamily:SANS, fontSize:FS.xs, color:T.muted}}>
                            {r.field === 'asking_price' ? 'Reference only: never the agreed price' : 'Check figure: not a cost line'}
                          </span>
                        ) : (<>
                          <select aria-label={`${fieldLabel(r.field)} category`} value={e.category}
                            onChange={ev => setEdit(r.id, { category: ev.target.value })} style={inputStyle}>
                            <option value="">Choose…</option>
                            {COST_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                          <select aria-label={`${fieldLabel(r.field)} state`} value={e.state}
                            onChange={ev => setEdit(r.id, { state: ev.target.value })} style={inputStyle}>
                            {REVIEW_STATES.map(s => <option key={s} value={s}>{COST_STATE_LABEL[s]}</option>)}
                          </select>
                        </>)}
                        <span style={{flex:1}}/>
                        <Button size="sm" variant="primary" disabled={!!busy} loading={busy === r.id} onClick={() => approve(r)}>Approve</Button>
                        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => reject(r)}>Reject</Button>
                      </div>
                    )}
                    {conflict?.row.id === r.id && (
                      <div role="alertdialog" aria-label="Cost line already exists" onClick={ev => ev.stopPropagation()}
                        style={{marginTop:8, border:`1px solid ${T.amber}`, borderRadius:8, padding:'8px 10px', fontFamily:SANS, fontSize:FS.sm, color:T.text}}>
                        <div style={{marginBottom:6}}>This deal already has a {COST_CATEGORY_LABEL[e.category] || 'cost'} line. Replace it, or add this one alongside?</div>
                        {conflict.lines.map(l => (
                          <div key={l.id} style={{display:'flex', gap:8, alignItems:'center', marginBottom:4, flexWrap:'wrap'}}>
                            <span style={{fontFamily:MONO, fontSize:FS.xs, color:T.muted}}>
                              {gbp(l.amount)} · {COST_STATE_LABEL[l.state] || l.state}{l.source ? ` · ${l.source}` : ''}
                            </span>
                            <Button size="sm" variant="secondary" destructive disabled={!!busy}
                              onClick={() => approve(r, { mode: 'replace', replaceId: l.id })}>Replace {gbp(l.amount)}</Button>
                          </div>
                        ))}
                        <div style={{display:'flex', gap:6, marginTop:4}}>
                          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => approve(r, { mode: 'add' })}>Add alongside</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {pending.length > 0 && bulk.skipped.length > 0 && (
              <div style={{fontFamily:SANS, fontSize:FS.xs, color:T.muted, marginTop:8}}>
                “Approve all valid” leaves {bulk.skipped.length} for you to review: low confidence, no amount, or a category that already has a cost line.
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
