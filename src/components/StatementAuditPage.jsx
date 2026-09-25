import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import { loadCdnScript } from '../lib/loadCdnScript'
import { linesFromTextItems, textFromPages } from '../lib/pdfText'
import {
  parseAuditStatement, balanceCheck, computeTotals, compareWithExisting, deriveStatus, missingNumbers,
  buildImportSummary, STATEMENT_STATUSES, STATUS_LABEL, LINE_TYPES, LINE_TYPE_LABEL, REVIEW_STATUSES, REVIEW_LABEL,
  NON_COUNTING_REVIEW, round2, lineAmountOf, feeCheck, applyFeeExpectations, describeFeeCheck,
} from '../lib/statementAudit'

// ── Rental Statement Audit ──────────────────────────────────────────────────
// A standalone register for auditing managing-agent rental statements and
// reconciling them with the bank account. It reads and writes only the
// statement_audit_* tables: nothing here looks at properties, tenancies,
// rent payments or expenses, and nothing here writes to them. The "Import
// Statement" workflow (which does post rent into the tracker) is separate.

const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(Number(n) || 0)
const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
const today = () => new Date().toISOString().slice(0, 10)
const DEFAULT_START = 71

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'
async function extractPdfText(file) {
  await loadCdnScript(`${PDFJS_CDN}/pdf.min.js`, 'pdfjsLib')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`
  let pdf
  try {
    pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise
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

const STATUS_COLOUR = (T) => ({
  not_uploaded: T.muted, uploaded_awaiting_import: T.blue, importing: T.blue, imported_awaiting_review: T.gold,
  previously_imported_checked: T.green, correction_required: T.amber, possible_duplicate: T.amber, import_error: T.red,
  discrepancy_found: T.red, ready_for_bank_check: T.blue, fully_reconciled: T.green,
})
const DECISION_LABEL = { new: 'New - will be imported', previously_imported_checked: 'Previously imported - checked and correct', correction_required: 'Correction required', possible_duplicate: 'Possible duplicate - manual review' }

const lineAmount = lineAmountOf
// Agreed fee terms seeded for a new landlord run, by agent. Editable on the
// page; used only to flag lines, never to change a figure.
const DEFAULT_FEE_TERMS = { PNE: { expected_fee_pct: 10, expected_fee_vat_pct: 20 }, RMS: { expected_fee_pct: 7, expected_fee_vat_pct: 20 } }
const FLAG_LABEL = {
  missing_property: 'no property shown', missing_tenant: 'no tenant shown', missing_period: 'no rental period', missing_fee_basis: 'fee basis not shown',
  unclassified: 'type needs review', review_description: 'wording needs review', part_period: 'part period',
  fee_does_not_match_percentage: 'fee is not the stated % of rent', amount_plus_vat_not_gross: 'amount + VAT is not the gross',
  fee_rate_differs: 'fee rate differs from agreement', vat_not_shown: 'VAT not itemised on statement', vat_not_itemised: 'VAT not itemised on statement',
  vat_derived_not_itemised: 'VAT split derived (not on this invoice)', added_manually: 'added by hand', reprocessed_from_error: 're-processed from an import error',
}

export default function StatementAuditPage({ user, showToast, onClose }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const colours = STATUS_COLOUR(T)
  const fileRef = useRef()

  const [series, setSeries] = useState([])
  const [seriesKey, setSeriesKey] = useState(null)
  const [statements, setStatements] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [upload, setUpload] = useState(null)       // { step, fileName, rawText, parsed, existing, existingLines, compare, check, apply:Set, summary }
  const [editLine, setEditLine] = useState(null)   // { id|null, draft, statementId }
  const [fixError, setFixError] = useState(null)   // { statementId, index, draft }
  const [showRaw, setShowRaw] = useState(false)
  const [filter, setFilter] = useState('all')

  const currentSeries = series.find(s => s.series_key === seriesKey) || null
  const startNumber = currentSeries?.start_number ?? DEFAULT_START

  const loadSeries = useCallback(async () => {
    const rows = await api.fetchAuditSeries()
    setSeries(rows)
    return rows
  }, [])
  const loadStatements = useCallback(async (key) => {
    if (!key) { setStatements([]); setLines([]); return }
    const [st, ln] = await Promise.all([api.fetchAuditStatements(key), api.fetchAuditLinesForSeries(key)])
    setStatements(st); setLines(ln)
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    loadSeries().then(rows => {
      if (!live) return
      const first = rows[0]?.series_key || null
      // With a series to show, the statements effect below owns the loading
      // flag, so the register never flashes empty between the two loads.
      if (first) setSeriesKey(k => k || first)
      else setLoading(false)
    }).catch(e => { console.error('StatementAudit:loadSeries', e); showToast?.(e.message || 'Could not load the audit register', 'error'); if (live) setLoading(false) })
    return () => { live = false }
  }, [loadSeries, showToast])

  useEffect(() => {
    let live = true
    if (!seriesKey) return
    setLoading(true)
    loadStatements(seriesKey).catch(e => { console.error('StatementAudit:loadStatements', e); showToast?.(e.message || 'Could not load statements', 'error') })
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [seriesKey, loadStatements, showToast])

  const refresh = useCallback(async () => { await loadSeries(); await loadStatements(seriesKey) }, [loadSeries, loadStatements, seriesKey])

  // ── Derived register data ────────────────────────────────────────────────
  const linesByStatement = useMemo(() => {
    const m = new Map()
    for (const l of lines) { if (!m.has(l.statement_id)) m.set(l.statement_id, []); m.get(l.statement_id).push(l) }
    return m
  }, [lines])
  const rows = useMemo(() => statements.map(s => {
    const ls = linesByStatement.get(s.id) || []
    const check = s.status === 'not_uploaded' ? null : balanceCheck(s, ls)
    return { s, ls, check, errors: Array.isArray(s.import_errors) ? s.import_errors : [] }
  }), [statements, linesByStatement])
  const missing = useMemo(() => {
    const uploaded = statements.filter(s => s.status !== 'not_uploaded').map(s => s.statement_number)
    const gaps = new Set(missingNumbers(uploaded, startNumber))
    for (const s of statements) if (s.status === 'not_uploaded' && s.statement_number >= startNumber) gaps.add(s.statement_number)
    return [...gaps].sort((a, b) => a - b)
  }, [statements, startNumber])
  const errorRows = rows.filter(r => r.errors.length || r.ls.some(l => l.review_status === 'import_error'))
  const selected = rows.find(r => r.s.id === selectedId) || null
  const filteredRows = rows.filter(r => filter === 'all' ? true : filter === 'attention'
    ? ['correction_required', 'possible_duplicate', 'import_error', 'discrepancy_found', 'not_uploaded'].includes(r.s.status)
    : r.s.status === filter)

  // ── Upload / parse / compare ─────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { showToast?.('Please choose a PDF statement', 'error'); return }
    setUpload({ step: 'parsing', fileName: file.name })
    try {
      const rawText = await extractPdfText(file)
      await previewText(rawText, file.name)
    } catch (e) {
      console.error('StatementAudit:handleFile', e)
      setUpload({ step: 'failed', fileName: file.name, problem: e?.message || 'Could not read the PDF' })
    }
  }

  // Shared by a fresh upload and "re-process from stored text".
  async function previewText(rawText, fileName, forcedNumber = null) {
    const parsed = parseAuditStatement(rawText)
    if (forcedNumber != null && parsed.statementNumber == null) parsed.statementNumber = forcedNumber
    if (!parsed.ok) { setUpload({ step: 'failed', fileName, rawText, parsed, problem: parsed.problem || 'Could not read this statement' }); return }
    let key = parsed.seriesKey
    let seriesRows = series
    if (!seriesRows.some(s => s.series_key === key)) {
      await api.upsertAuditSeries({ series_key: key, landlord_company: parsed.landlordCompany || parsed.landlordName || 'Unknown landlord', landlord_name: parsed.landlordName, agent: parsed.agent, start_number: DEFAULT_START, ...(DEFAULT_FEE_TERMS[parsed.agent] || {}) })
      seriesRows = await loadSeries()
    }
    const seriesRow = seriesRows.find(s => s.series_key === key) || null
    parsed.lines = applyFeeExpectations(parsed.lines, seriesRow)
    let stmts = statements, allLines = lines
    if (key !== seriesKey) {
      // Statement belongs to a different landlord run: load that register.
      ;[stmts, allLines] = await Promise.all([api.fetchAuditStatements(key), api.fetchAuditLinesForSeries(key)])
      setSeriesKey(key); setStatements(stmts); setLines(allLines)
    }
    // Rook Matthews Sayer prints no sequential number: suggest the next one
    // in the run and let the user confirm or change it before importing.
    if (parsed.statementNumber == null) {
      const nums = stmts.filter(s => s.status !== 'not_uploaded').map(s => s.statement_number)
      parsed.statementNumber = nums.length ? Math.max(...nums) + 1 : (seriesRow?.start_number ?? DEFAULT_START)
      parsed.numberAssigned = true
    }
    setUpload(compareForNumber({ step: 'preview', fileName, rawText, parsed, apply: new Set(), seriesKey: key }, stmts, allLines, parsed.statementNumber))
  }

  // Everything in the preview that depends on the statement number.
  function compareForNumber(u, stmts, allLines, number) {
    const parsed = { ...u.parsed, statementNumber: number }
    const existing = stmts.find(s => s.statement_number === number && s.status !== 'not_uploaded') || null
    const placeholder = stmts.find(s => s.statement_number === number) || null
    const existingLines = existing ? allLines.filter(l => l.statement_id === existing.id) : []
    const compare = compareWithExisting(parsed.lines, existingLines)
    const previewLines = compare.decisions.map(d => ({ ...d.parsed, review_status: d.decision === 'possible_duplicate' ? 'possible_duplicate' : 'imported' }))
    const check = balanceCheck({ previous_balance: parsed.previousBalance, carried_forward: parsed.carriedForward, new_balance: parsed.newBalance, payment_amount: parsed.paymentAmount, stated_income_total: parsed.statedIncomeTotal, stated_expenditure_total: parsed.statedExpenditureTotal, invoice_fees: parsed.invoiceFees, import_errors: parsed.errors }, previewLines)
    return { ...u, parsed, existing: existing || placeholder, existingLines, compare, check, apply: new Set() }
  }

  async function confirmImport() {
    const u = upload
    if (!u || u.step !== 'preview') return
    setUpload({ ...u, step: 'saving' })
    try {
      const { parsed, compare, check } = u
      const decisions = compare.decisions
      const inserts = decisions.filter(d => d.decision === 'new').map(d => d.parsed)
      const duplicates = decisions.filter(d => d.decision === 'possible_duplicate').map(d => ({ ...d.parsed, error_reason: d.note || 'Identical to a line already on the register' }))
      const confirmIds = decisions.filter(d => d.decision === 'previously_imported_checked' && d.existing?.id).map(d => d.existing.id)
      const corrections = []
      for (const [idx, d] of decisions.entries()) {
        if (d.decision !== 'correction_required' || !d.existing?.id) continue
        if (u.apply.has(idx)) {
          const p = d.parsed
          const snapshot = d.existing.original_values || Object.fromEntries(d.diff.map(x => [x.field, x.from]))
          corrections.push({ id: d.existing.id, line_no: p.line_no, property_address: p.property_address, patch: {
            line_type: p.line_type, property_address: p.property_address, tenant_name: p.tenant_name, period_start: p.period_start, period_end: p.period_end,
            description: p.description, gross_rent: p.gross_rent, fee_amount: p.fee_amount, vat_amount: p.vat_amount, deduction_amount: p.deduction_amount,
            credit_amount: p.credit_amount, net_amount: p.net_amount, fee_pct: p.fee_pct, fee_basis: p.fee_basis, line_key: p.line_key,
            review_status: 'imported', error_reason: null, original_values: snapshot, flags: p.flags,
          } })
        } else {
          corrections.push({ id: d.existing.id, line_no: d.existing.line_no, property_address: d.existing.property_address, patch: {
            review_status: 'correction_required',
            error_reason: 'Upload shows: ' + d.diff.map(x => `${x.field} ${x.from ?? '-'} -> ${x.to ?? '-'}`).join('; '),
          } })
        }
      }
      for (const m of compare.missingFromUpload) {
        corrections.push({ id: m.id, line_no: m.line_no, property_address: m.property_address, patch: { review_status: 'correction_required', error_reason: 'On the register but not on the uploaded statement' } })
      }
      const statement = {
        statement_number: parsed.statementNumber, statement_date: parsed.statementDate, agent: parsed.agent,
        landlord_name: parsed.landlordName, landlord_company: parsed.landlordCompany, file_name: u.fileName, raw_text: u.rawText,
        previous_balance: parsed.previousBalance, new_balance: parsed.newBalance, payment_amount: parsed.paymentAmount,
        carried_forward: parsed.carriedForward || 0, agent_reference: parsed.agentReference || null,
        statement_period_start: parsed.statementPeriodStart || null, statement_period_end: parsed.statementPeriodEnd || null,
        stated_income_total: parsed.statedIncomeTotal, stated_expenditure_total: parsed.statedExpenditureTotal,
        invoice_number: parsed.invoiceNumber, invoice_date: parsed.invoiceDate, invoice_fees: parsed.invoiceFees,
        import_errors: parsed.errors.map(e => ({ ...e, statement_number: parsed.statementNumber })),
      }
      const { statement: saved, results } = await api.saveAuditImport({ seriesKey: u.seriesKey, statement, inserts, corrections, confirmIds, duplicates })
      const applied = decisions.filter((d, i) => d.decision === 'correction_required' && u.apply.has(i)).length
      const pending = decisions.filter((d, i) => d.decision === 'correction_required' && !u.apply.has(i)).length
      const errorCount = (saved.import_errors || []).length
      let status = deriveStatus({
        errorCount, correctionCount: pending, duplicateCount: results.duplicates, newCount: results.inserted,
        previouslyCount: results.confirmed + applied, missingFromUpload: compare.missingFromUpload.length, balances: check.balances,
      })
      // A statement already signed off by hand stays signed off when a
      // re-upload merely confirms what is on the register.
      if (u.existing && ['ready_for_bank_check', 'fully_reconciled'].includes(u.existing.status) && status === 'previously_imported_checked') status = u.existing.status
      const summary = buildImportSummary({ parsed, decisions, applied: { inserted: results.inserted }, check, checked: !!u.existing?.statement_checked, status })
      summary.corrections_applied = applied
      summary.lines_missing_from_upload = compare.missingFromUpload.length
      summary.db_failures = results.failed.length
      await api.finaliseAuditImport(saved.id, { status, summary })
      const sRow = series.find(s => s.series_key === u.seriesKey)
      await api.ensureAuditPlaceholders(u.seriesKey, sRow?.start_number ?? DEFAULT_START, parsed.statementNumber, { agent: parsed.agent, landlord_company: parsed.landlordCompany, landlord_name: parsed.landlordName })
      await loadStatements(u.seriesKey)
      setSelectedId(saved.id)
      setUpload({ ...u, step: 'done', summary, results, status })
    } catch (e) {
      console.error('StatementAudit:confirmImport', e)
      showToast?.(e.message || 'Import failed', 'error')
      setUpload({ ...u, step: 'preview' })
    }
  }

  // Unreadable file: keep a record so the number is not silently skipped.
  async function recordFailedUpload(number) {
    const u = upload
    const n = parseInt(number, 10)
    if (!Number.isFinite(n)) { showToast?.('Enter the statement number printed on the document', 'error'); return }
    const key = seriesKey || series[0]?.series_key
    if (!key) { showToast?.('Import one readable statement first so the landlord run exists', 'error'); return }
    setBusy(true)
    try {
      const { statement } = await api.saveAuditImport({ seriesKey: key, statement: {
        statement_number: n, file_name: u.fileName, raw_text: u.rawText || null,
        import_errors: [{ statement_number: n, reason: u.problem || 'Could not read the statement', raw_text: (u.rawText || '').slice(0, 2000) }],
      }, inserts: [] })
      await api.finaliseAuditImport(statement.id, { status: 'import_error', summary: null })
      await api.ensureAuditPlaceholders(key, startNumber, n, {})
      await loadStatements(key)
      setSelectedId(statement.id); setUpload(null)
    } catch (e) { showToast?.(e.message, 'error') }
    setBusy(false)
  }

  // ── Register edits ───────────────────────────────────────────────────────
  async function patchStatement(s, patch) {
    try {
      const saved = await api.updateAuditStatement(s.id, patch)
      setStatements(prev => prev.map(x => x.id === saved.id ? saved : x))
    } catch (e) { showToast?.(e.message || 'Could not save', 'error') }
  }
  async function saveStart(value) {
    const n = parseInt(value, 10)
    if (!currentSeries || !Number.isFinite(n)) return
    try {
      await api.updateAuditSeries(currentSeries.id, { start_number: n })
      const max = Math.max(n, ...statements.map(s => s.statement_number))
      await api.ensureAuditPlaceholders(seriesKey, n, max, { agent: currentSeries.agent, landlord_company: currentSeries.landlord_company })
      await refresh()
    } catch (e) { showToast?.(e.message, 'error') }
  }

  async function saveSeriesTerms(patch) {
    if (!currentSeries) return
    try { await api.updateAuditSeries(currentSeries.id, patch); await loadSeries() }
    catch (e) { showToast?.(e.message, 'error') }
  }

  function startEditLine(statementId, line) {
    const draft = line ? { ...line } : { line_type: 'rent', section: 'income', property_address: '', tenant_name: '', period_start: '', period_end: '', description: '', gross_rent: 0, fee_amount: 0, vat_amount: 0, deduction_amount: 0, credit_amount: 0, fee_pct: '', fee_basis: '', review_status: 'imported', flags: [] }
    setEditLine({ id: line?.id || null, statementId, draft })
  }
  function finishDraft(d) {
    const n = v => round2(v)
    const out = { ...d, gross_rent: 0, fee_amount: 0, deduction_amount: 0, credit_amount: 0, vat_amount: n(d.vat_amount) }
    const amt = n(d._amount ?? lineAmount(d))
    if (['rent', 'arrears', 'other_income'].includes(d.line_type)) { out.gross_rent = amt; out.net_amount = amt; out.section = 'income' }
    else if (d.line_type === 'management_fee') { out.fee_amount = amt; out.net_amount = -(amt + out.vat_amount); out.section = 'expenditure' }
    else if (d.line_type === 'credit') { out.credit_amount = amt; out.net_amount = amt; out.section = 'expenditure' }
    else if (d.line_type === 'transfer') { out.net_amount = amt; out.vat_amount = 0; out.section = 'summary' }
    else { out.deduction_amount = amt; out.net_amount = -(amt + out.vat_amount); out.section = 'expenditure' }
    out.fee_pct = d.fee_pct === '' || d.fee_pct == null ? null : Number(d.fee_pct)
    out.fee_basis = d.fee_basis === '' || d.fee_basis == null ? null : Number(d.fee_basis)
    out.period_start = d.period_start || null; out.period_end = d.period_end || null
    delete out._amount
    return out
  }
  async function saveEditLine() {
    const { id, statementId, draft } = editLine
    const stmt = statements.find(s => s.id === statementId)
    setBusy(true)
    try {
      const values = finishDraft(draft)
      if (id) {
        const existing = lines.find(l => l.id === id)
        const patch = {}
        for (const k of ['line_type', 'section', 'property_address', 'tenant_name', 'period_start', 'period_end', 'transaction_date', 'description', 'gross_rent', 'fee_amount', 'vat_amount', 'deduction_amount', 'credit_amount', 'net_amount', 'fee_pct', 'fee_basis', 'review_status', 'error_reason']) {
          if (k in values && String(values[k] ?? '') !== String(existing[k] ?? '')) patch[k] = values[k]
        }
        if (Object.keys(patch).length) {
          const ok = await confirmDialog({ title: `Change line ${existing.line_no} on Statement ${existing.statement_number}?`, message: Object.entries(patch).map(([k, v]) => `${k}: ${existing[k] ?? '-'} -> ${v ?? '-'}`).join('\n'), confirmLabel: 'Save change' })
          if (!ok) { setBusy(false); return }
          const saved = await api.updateAuditLine(existing, patch)
          setLines(prev => prev.map(l => l.id === saved.id ? saved : l))
        }
      } else {
        const nextNo = Math.max(0, ...(linesByStatement.get(statementId) || []).map(l => l.line_no)) + 1
        const saved = await api.insertAuditLine(stmt, { ...values, line_no: nextNo, flags: ['added_manually'] })
        setLines(prev => [...prev, saved])
      }
      setEditLine(null)
    } catch (e) { showToast?.(e.message || 'Could not save the line', 'error') }
    setBusy(false)
  }
  async function setLineReview(line, review_status) {
    try {
      const saved = await api.updateAuditLine(line, { review_status, error_reason: review_status === 'imported' ? null : line.error_reason })
      setLines(prev => prev.map(l => l.id === saved.id ? saved : l))
    } catch (e) { showToast?.(e.message, 'error') }
  }
  async function removeLine(line) {
    const ok = await confirmDialog({ title: `Delete line ${line.line_no} from Statement ${line.statement_number}?`, message: `${LINE_TYPE_LABEL[line.line_type]} - ${line.property_address || 'no property'} - ${fmt(lineAmount(line))}. This removes the entry from the register permanently. Marking it "Excluded" keeps it visible but uncounted.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try { await api.deleteAuditLine(line.id); setLines(prev => prev.filter(l => l.id !== line.id)) }
    catch (e) { showToast?.(e.message, 'error') }
  }
  async function saveErrorFix() {
    const { statementId, index, draft } = fixError
    const stmt = statements.find(s => s.id === statementId)
    setBusy(true)
    try {
      const values = finishDraft(draft)
      const nextNo = Math.max(0, ...(linesByStatement.get(statementId) || []).map(l => l.line_no)) + 1
      const { line, statement } = await api.resolveAuditImportError(stmt, index, { ...values, line_no: draft.line_no || nextNo, flags: ['reprocessed_from_error'] })
      setLines(prev => [...prev, line]); setStatements(prev => prev.map(s => s.id === statement.id ? statement : s))
      setFixError(null)
    } catch (e) { showToast?.(e.message, 'error') }
    setBusy(false)
  }
  async function reprocessStored(s) {
    if (!s.raw_text) { showToast?.('No stored text for this statement; upload the PDF again', 'error'); return }
    setUpload({ step: 'parsing', fileName: s.file_name || `Statement ${s.statement_number}` })
    try { await previewText(s.raw_text, s.file_name || `Statement ${s.statement_number}`, s.statement_number) }
    catch (e) { setUpload({ step: 'failed', fileName: s.file_name, problem: e.message }) }
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  const label = (t) => <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{t}</div>
  const pill = (text, colour) => <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: colour, background: colour + '22', border: `1px solid ${colour}55`, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{text}</span>
  const yesNo = (value, onChange, disabled) => (
    <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {[true, false].map(v => (
        <button key={String(v)} type="button" disabled={disabled} onClick={() => onChange(v)}
          style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '3px 9px', border: 'none', cursor: disabled ? 'default' : 'pointer',
            background: value === v ? (v ? T.green : T.amber) : 'transparent', color: value === v ? '#0E141A' : T.muted }}>
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
  const th = (t, right) => <th style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: right ? 'right' : 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{t}</th>
  const td = (content, opts = {}) => <td style={{ fontFamily: opts.mono === false ? undefined : MONO, fontSize: 11, color: opts.color || T.text, textAlign: opts.right ? 'right' : 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}22`, whiteSpace: opts.wrap ? 'normal' : 'nowrap', maxWidth: opts.max || undefined, overflow: 'hidden', textOverflow: 'ellipsis' }} title={opts.title}>{content}</td>

  function totalsGrid(check) {
    const t = check.totals
    const items = [
      ['Gross rent received', t.gross_rent, T.green], ['Arrears payments', t.arrears, T.green], ['Other income', t.other_income, T.green],
      ['Management fees', t.management_fees, T.amber], ['VAT', t.vat, T.amber], ['Maintenance', t.maintenance, T.amber],
      ['Other deductions', t.other_deductions, T.amber], ['Credits / adjustments', t.credits, T.blue],
      ['Net amount due (expected)', check.expected, T.text], [t.transfer_count ? `Paid to landlord (${t.transfer_count} payment${t.transfer_count === 1 ? '' : 's'})` : 'Shown as transferred', check.stated, T.text],
    ]
    return (
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {items.map(([l, v, c]) => (
          <div key={l} style={{ background: T.bg, borderRadius: 8, padding: '8px 10px' }}>
            {label(l)}
            <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: c }}>{v == null ? '-' : fmt(v)}</div>
          </div>
        ))}
      </div>
    )
  }
  function balanceBlock(check) {
    const ok = check.balances
    return (
      <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: (ok ? T.green : T.red) + '14', border: `1px solid ${ok ? T.green : T.red}55` }}>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: ok ? T.green : T.red }}>
          {ok ? 'Statement balances: gross income minus fees and deductions equals the amount transferred.' : 'Discrepancy found: the statement does not balance.'}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 6, fontFamily: MONO, fontSize: 11, color: T.text }}>
          <span>Expected net: <b>{fmt(check.expected)}</b></span>
          <span>Stated on document: <b>{check.stated == null ? 'not found' : fmt(check.stated)}</b></span>
          <span>Difference: <b style={{ color: ok ? T.green : T.red }}>{check.difference == null ? '-' : fmt(check.difference)}</b></span>
        </div>
        {check.causes.length > 0 && (
          <ul style={{ margin: '8px 0 0 16px', padding: 0, fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.6 }}>
            {check.causes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
      </div>
    )
  }
  function lineTable(list, { decisions = null, editable = false } = {}) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {th('#')}{th('Type')}{th('Property (as shown)')}{th('Tenant')}{th('Period')}{th('Date')}
            {th('Gross rent', true)}{th('Fee', true)}{th('VAT', true)}{th('Deduction', true)}{th('Credit', true)}{th('Net', true)}
            {th(decisions ? 'Result' : 'Status')}{th('Flags')}{editable && th('')}
          </tr></thead>
          <tbody>
            {list.map((l, i) => {
              const d = decisions ? decisions[i] : null
              const rs = d ? d.decision : l.review_status
              const colour = rs === 'new' || rs === 'imported' ? T.green : rs === 'previously_imported_checked' ? T.blue : rs === 'excluded' ? T.muted : rs === 'import_error' ? T.red : T.amber
              const chk = l.fee_check || (l.line_type === 'management_fee' && !decisions ? feeCheck(l, currentSeries) : null)
              const flags = (l.flags || []).filter(f => f !== 'part_period' && f !== 'fee_rate_differs' && f !== 'vat_not_shown')
              if (chk && !chk.ok) flags.push(...chk.flags)
              const feeNote = chk ? describeFeeCheck(chk) : ''
              return (
                <tr key={l.id || i} style={{ opacity: NON_COUNTING_REVIEW.has(l.review_status) && !decisions ? 0.55 : 1 }}>
                  {td(l.line_no ?? i + 1, { color: T.muted })}
                  {td(LINE_TYPE_LABEL[l.line_type] || l.line_type, { color: ['rent', 'arrears', 'other_income'].includes(l.line_type) ? T.green : l.line_type === 'transfer' ? T.blue : T.amber })}
                  {td(l.property_address || <span style={{ color: T.red }}>missing</span>, { max: 260, title: l.property_address })}
                  {td(l.tenant_name || (['rent', 'arrears', 'other_income'].includes(l.line_type) ? <span style={{ color: T.amber }}>not shown</span> : '-'), { max: 220, title: l.tenant_name })}
                  {td(l.period_start ? `${fmtDate(l.period_start)} - ${fmtDate(l.period_end)}` : (l.line_type === 'rent' ? <span style={{ color: T.amber }}>missing</span> : '-'))}
                  {td(fmtDate(l.transaction_date || l.statement_date), { color: T.muted })}
                  {td(l.gross_rent ? fmt(l.gross_rent) : '', { right: true })}
                  {td(l.fee_amount ? fmt(l.fee_amount) + (l.fee_pct != null ? ` (${l.fee_pct}%)` : '') : '', { right: true })}
                  {td(l.vat_amount ? fmt(l.vat_amount) : '', { right: true })}
                  {td(l.deduction_amount ? fmt(l.deduction_amount) : '', { right: true })}
                  {td(l.credit_amount ? fmt(l.credit_amount) : '', { right: true })}
                  {td(l.line_type === 'transfer' ? <span style={{ color: T.blue }}>{fmt(l.net_amount)} paid</span> : fmt(l.net_amount), { right: true, color: l.net_amount < 0 ? T.amber : T.text })}
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${T.border}22` }}>
                    {pill(d ? DECISION_LABEL[rs] : (REVIEW_LABEL[rs] || rs), colour)}
                    {d?.note && <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, marginTop: 3 }}>{d.note}</div>}
                    {!d && l.error_reason && <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, marginTop: 3, maxWidth: 260, whiteSpace: 'normal' }}>{l.error_reason}</div>}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${T.border}22`, maxWidth: 220, whiteSpace: 'normal' }}>
                    {flags.length > 0 && <div style={{ fontFamily: MONO, fontSize: 10, color: T.amber }}>{[...new Set(flags)].map(f => FLAG_LABEL[f] || f.replace(/_/g, ' ')).join(', ')}</div>}
                    {feeNote && <div style={{ fontFamily: MONO, fontSize: 9, color: chk.ok ? T.green : T.amber, marginTop: 2 }}>{feeNote}</div>}
                  </td>
                  {editable && (
                    <td style={{ padding: '4px 6px', borderBottom: `1px solid ${T.border}22`, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => startEditLine(l.statement_id, l)}>Edit</button>
                      {l.review_status === 'possible_duplicate' && <>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', marginLeft: 4 }} onClick={() => setLineReview(l, 'imported')}>Keep &amp; count</button>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', marginLeft: 4 }} onClick={() => setLineReview(l, 'excluded')}>Exclude</button>
                      </>}
                      {l.review_status === 'correction_required' && <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', marginLeft: 4 }} onClick={() => setLineReview(l, 'imported')}>Mark correct</button>}
                      {l.review_status === 'excluded' && <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', marginLeft: 4 }} onClick={() => setLineReview(l, 'imported')}>Count again</button>}
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', marginLeft: 4, color: T.red }} onClick={() => removeLine(l)}>Delete</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
  function lineForm(draft, setDraft) {
    const isIncome = ['rent', 'arrears', 'other_income'].includes(draft.line_type)
    const amount = draft._amount ?? lineAmount(draft) ?? 0
    const inp = (k, type = 'text', extra = {}) => <input type={type} value={draft[k] ?? ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })} style={{ fontSize: 12, padding: '6px 8px' }} {...extra} />
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }} className="kpi-grid">
        <div><label>Type</label><select value={draft.line_type} onChange={e => setDraft({ ...draft, line_type: e.target.value })} style={{ fontSize: 12, padding: '6px 8px' }}>{LINE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div style={{ gridColumn: 'span 2' }}><label>Property (exactly as shown)</label>{inp('property_address')}</div>
        <div><label>Tenant</label>{inp('tenant_name')}</div>
        <div><label>Period start</label>{inp('period_start', 'date')}</div>
        <div><label>Period end</label>{inp('period_end', 'date')}</div>
        <div><label>{isIncome ? 'Gross amount received' : draft.line_type === 'management_fee' ? 'Fee (net of VAT)' : draft.line_type === 'credit' ? 'Credit amount' : draft.line_type === 'transfer' ? 'Amount paid to landlord' : 'Deduction (net of VAT)'}</label>
          <input type="number" step="0.01" value={amount} onChange={e => setDraft({ ...draft, _amount: e.target.value })} style={{ fontSize: 12, padding: '6px 8px' }} /></div>
        <div><label>VAT</label>{inp('vat_amount', 'number', { step: '0.01' })}</div>
        {draft.line_type === 'management_fee' && <><div><label>Fee %</label>{inp('fee_pct', 'number', { step: '0.01' })}</div><div><label>Of (rent basis)</label>{inp('fee_basis', 'number', { step: '0.01' })}</div></>}
        <div style={{ gridColumn: 'span 2' }}><label>Description</label>{inp('description')}</div>
        {draft.id && <div><label>Review status</label><select value={draft.review_status} onChange={e => setDraft({ ...draft, review_status: e.target.value })} style={{ fontSize: 12, padding: '6px 8px' }}>{REVIEW_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>}
      </div>
    )
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  const uploadOverlay = upload && (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: 30 }} onClick={e => { if (e.target === e.currentTarget && ['done', 'failed'].includes(upload.step)) setUpload(null) }}>
      <div className="modal card" role="dialog" aria-modal="true" style={{ maxWidth: 1180, width: '96%', maxHeight: '92vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
              {upload.step === 'parsing' && 'Reading the statement…'}
              {upload.step === 'preview' && `Review before import - Statement ${upload.parsed.statementNumber ?? '?'}`}
              {upload.step === 'saving' && 'Importing…'}
              {upload.step === 'done' && `Import summary - Statement ${upload.parsed.statementNumber}`}
              {upload.step === 'failed' && 'This statement could not be read'}
            </h2>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2 }}>{upload.fileName}</div>
          </div>
          {upload.step !== 'saving' && <button onClick={() => setUpload(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: T.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>}
        </div>

        {(upload.step === 'parsing' || upload.step === 'saving') && (
          <div style={{ textAlign: 'center', padding: 30, fontFamily: MONO, fontSize: 12, color: T.gold }}>{upload.step === 'parsing' ? 'Extracting text and reading every line…' : 'Writing lines to the register…'}</div>
        )}

        {upload.step === 'failed' && (
          <div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: T.red + '14', border: `1px solid ${T.red}55`, fontFamily: MONO, fontSize: 11, color: T.text }}>{upload.problem}</div>
            <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: T.muted }}>Record it anyway so the statement number is not skipped. It will sit on the register as an Import Error until the entries are added by hand or a readable PDF is uploaded.</div>
            <FailedUploadForm onSave={recordFailedUpload} busy={busy} T={T} />
          </div>
        )}

        {upload.step === 'preview' && (() => {
          const { parsed, compare, check, existing } = upload
          const dec = compare.decisions
          const count = k => dec.filter(d => d.decision === k).length
          return (
            <div>
              <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
                {[['Landlord', parsed.landlordCompany || parsed.landlordName || '-'], ['Statement date', fmtDate(parsed.statementDate) || 'not found'], ['Agent', (parsed.agent === 'RMS' ? 'Rook Matthews Sayer' : parsed.agent) || 'unknown'],
                  ['Transactions on statement', parsed.lines.length + parsed.errors.length], ['Agent invoice', parsed.invoiceNumber ? `${parsed.invoiceNumber} ${fmt(parsed.invoiceFees)}` : '-'],
                  ['On register already', existing && existing.status !== 'not_uploaded' ? `Yes - ${STATUS_LABEL[existing.status]}` : 'No']].map(([l, v]) => (
                  <div key={l} style={{ background: T.bg, borderRadius: 8, padding: '8px 10px' }}>{label(l)}<div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.text }}>{v}</div></div>
                ))}
              </div>
              {parsed.warnings.length > 0 && <div style={{ marginBottom: 10, fontFamily: MONO, fontSize: 10, color: T.amber }}>{parsed.warnings.join(' ')}</div>}
              {(parsed.numberAssigned || parsed.agent === 'RMS') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 12px', background: T.amber + '14', border: `1px solid ${T.amber}55`, borderRadius: 8 }}>
                  <label style={{ margin: 0 }}>Audit statement number</label>
                  <input type="number" value={parsed.statementNumber ?? ''} onChange={e => { const n = parseInt(e.target.value, 10); setUpload(compareForNumber(upload, statements, lines, Number.isFinite(n) ? n : null)) }} style={{ width: 90, fontSize: 12, padding: '5px 8px' }} />
                  <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
                    This agent prints no sequential number{parsed.agentReference ? ` (agent reference ${parsed.agentReference}` : ''}{parsed.statementPeriodStart ? `${parsed.agentReference ? ', ' : ' ('}period ${fmtDate(parsed.statementPeriodStart)} to ${fmtDate(parsed.statementPeriodEnd)}` : ''}{parsed.agentReference || parsed.statementPeriodStart ? ')' : ''}. The next number in this run is suggested; change it if the statement belongs elsewhere in the sequence.
                  </span>
                </div>
              )}
              {totalsGrid(check)}
              {balanceBlock(check)}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 8px' }}>
                {pill(`${count('new')} new`, T.green)}{pill(`${count('previously_imported_checked')} previously imported - checked and correct`, T.blue)}
                {pill(`${count('correction_required')} correction required`, T.amber)}{pill(`${count('possible_duplicate')} possible duplicate`, T.amber)}
                {pill(`${parsed.errors.length} import error${parsed.errors.length === 1 ? '' : 's'}`, parsed.errors.length ? T.red : T.muted)}
                {compare.missingFromUpload.length > 0 && pill(`${compare.missingFromUpload.length} on register but not on this upload`, T.amber)}
                {(() => { const n = parsed.lines.filter(l => l.flags?.includes('fee_rate_differs')).length; return n ? pill(`${n} fee line${n === 1 ? '' : 's'} differ from the agreed rate`, T.amber) : null })()}
                {(() => { const n = parsed.lines.filter(l => l.flags?.includes('vat_not_shown')).length; return n ? pill(`${n} fee line${n === 1 ? '' : 's'} with no VAT itemised`, T.muted) : null })()}
              </div>
              {lineTable(dec.map(d => d.parsed), { decisions: dec })}

              {count('correction_required') > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 6 }}>Corrections - original vs uploaded. Nothing changes unless you tick it.</div>
                  {dec.map((d, i) => d.decision === 'correction_required' && (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: T.bg, borderRadius: 8, marginBottom: 6 }}>
                      <input type="checkbox" style={{ width: 16, marginTop: 2 }} checked={upload.apply.has(i)} onChange={e => { const s = new Set(upload.apply); e.target.checked ? s.add(i) : s.delete(i); setUpload({ ...upload, apply: s }) }} />
                      <div style={{ fontFamily: MONO, fontSize: 10, color: T.text }}>
                        <div><b>Line {d.parsed.line_no}</b> {LINE_TYPE_LABEL[d.parsed.line_type]} - {d.parsed.property_address}</div>
                        {d.diff.map(x => <div key={x.field} style={{ color: T.muted }}>{x.field}: <span style={{ color: T.red }}>{String(x.from ?? '-')}</span> → <span style={{ color: T.green }}>{String(x.to ?? '-')}</span></div>)}
                        <div style={{ color: T.faint }}>Ticked: register line is updated (original values kept). Unticked: register line is flagged "Correction required" and left as it is.</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {compare.missingFromUpload.length > 0 && (
                <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 10, color: T.amber }}>
                  On the register for this statement but not on the uploaded document (will be flagged, not deleted): {compare.missingFromUpload.map(m => `line ${m.line_no} ${m.property_address || ''} ${fmt(lineAmount(m))}`).join('; ')}
                </div>
              )}
              {parsed.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: T.red, marginBottom: 6 }}>Import errors - these entries will be listed on the statement for correction; the rest of the statement still imports.</div>
                  {parsed.errors.map((e, i) => <div key={i} style={{ fontFamily: MONO, fontSize: 10, color: T.muted, padding: '4px 0' }}>Statement {parsed.statementNumber} · {e.property_address || 'no property'} · {e.tenant_name || 'no tenant'} · {e.amount == null ? 'no amount' : fmt(e.amount)} · {e.reason} · "{e.description}"</div>)}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => setShowRaw(v => !v)}>{showRaw ? 'Hide' : 'Show'} extracted text</button>
                <button className="btn btn-ghost" onClick={() => setUpload(null)}>Cancel</button>
                <button className="btn btn-gold" onClick={confirmImport} disabled={parsed.statementNumber == null}>
                  {existing && existing.status !== 'not_uploaded' ? 'Confirm - update register' : 'Confirm import'}
                </button>
              </div>
              {showRaw && <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', fontFamily: MONO, fontSize: 10, color: T.muted, background: T.bg, padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{upload.rawText}</pre>}
            </div>
          )
        })()}

        {upload.step === 'done' && (() => {
          const s = upload.summary
          const rowsOut = [
            ['Statement number', s.statement_number], ['Statement date', fmtDate(s.statement_date)], ['Statement total (payment shown)', fmt(s.statement_total)],
            ['Transactions shown on the statement', s.transactions_on_statement], ['Successfully imported', s.imported],
            ['Already imported and confirmed', s.previously_imported], ['Corrections applied', s.corrections_applied], ['Requiring correction', s.corrections - s.corrections_applied + (s.lines_missing_from_upload || 0)],
            ['Possible duplicates', s.possible_duplicates], ['Import errors', s.import_errors + (s.db_failures || 0)],
            ['Lines with missing information', s.missing_information],
            ['Fee lines differing from the agreed rate', s.fee_rate_differs ?? 0], ['Fee lines with no VAT itemised', s.vat_not_shown ?? 0],
            ['Statement balances', s.balances ? 'Yes' : `No - expected ${fmt(s.expected_net)}, stated ${s.stated_net == null ? '-' : fmt(s.stated_net)}, difference ${fmt(s.difference)}`],
            ['Manually checked by you', s.manually_checked ? 'Yes' : 'No - set "Statement checked?" to Yes once reviewed'],
            ['Ready to compare with the bank account', s.ready_for_bank ? 'Yes' : 'Not yet'],
            ['Status', STATUS_LABEL[upload.status]],
          ]
          return (
            <div>
              <div style={{ display: 'grid', gap: 6 }}>
                {rowsOut.map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 12px', background: T.bg, borderRadius: 8, fontFamily: MONO, fontSize: 11 }}><span style={{ color: T.muted }}>{l}</span><span style={{ color: T.text, fontWeight: 700, textAlign: 'right' }}>{String(v)}</span></div>)}
              </div>
              {upload.results?.failed?.length > 0 && <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 10, color: T.red }}>{upload.results.failed.length} row{upload.results.failed.length === 1 ? '' : 's'} were refused by the database and added to the Import Errors list.</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button className="btn btn-gold" onClick={() => setUpload(null)}>Open the statement</button>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )

  const editOverlay = editLine && (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setEditLine(null) }}>
      <div className="modal card" role="dialog" aria-modal="true" style={{ maxWidth: 820, width: '96%', padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 10 }}>{editLine.id ? `Edit line ${editLine.draft.line_no}` : 'Add a line the parser missed'}</h3>
        {editLine.draft.original_values && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 8 }}>Original values from the statement are kept: {Object.entries(editLine.draft.original_values).filter(([, v]) => v != null && v !== 0 && v !== '').map(([k, v]) => `${k} ${v}`).join(', ')}</div>}
        {lineForm(editLine.draft, d => setEditLine({ ...editLine, draft: d }))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setEditLine(null)}>Cancel</button>
          <button className="btn btn-gold" onClick={saveEditLine} disabled={busy}>{editLine.id ? 'Review & save' : 'Add line'}</button>
        </div>
      </div>
    </div>
  )

  const fixOverlay = fixError && (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setFixError(null) }}>
      <div className="modal card" role="dialog" aria-modal="true" style={{ maxWidth: 820, width: '96%', padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Correct and re-process this entry</h3>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 10, whiteSpace: 'pre-wrap' }}>Reason: {fixError.reason}{fixError.raw ? `\nText on statement: ${fixError.raw}` : ''}</div>
        {lineForm(fixError.draft, d => setFixError({ ...fixError, draft: d }))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setFixError(null)}>Cancel</button>
          <button className="btn btn-gold" onClick={saveErrorFix} disabled={busy}>Add to register &amp; clear error</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fade" style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Rental Statement Audit</h2>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 3, maxWidth: 720, lineHeight: 1.5 }}>
              A separate register for checking the agent's rental statements and matching them to the bank. It stores only what is printed on each statement and does not read or change any property, tenancy or rent record elsewhere in the app.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {series.length > 0 && (
              <select value={seriesKey || ''} onChange={e => { setSeriesKey(e.target.value); setSelectedId(null) }} style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}>
                {series.map(s => <option key={s.series_key} value={s.series_key}>{s.landlord_company}{s.agent ? ` (${s.agent})` : ''}</option>)}
              </select>
            )}
            {currentSeries && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>Audit starts at</span>
                <input type="number" defaultValue={startNumber} key={currentSeries.id + startNumber} onBlur={e => Number(e.target.value) !== startNumber && saveStart(e.target.value)} style={{ width: 70, fontSize: 12, padding: '5px 8px' }} />
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginLeft: 6 }} title="The fee rate agreed with the agent. Every fee line is checked against it; the statement figures are never changed.">Agreed fee</span>
                <input type="number" step="0.01" placeholder="%" defaultValue={currentSeries.expected_fee_pct ?? ''} key={'fp' + currentSeries.id + currentSeries.expected_fee_pct}
                  onBlur={e => String(e.target.value) !== String(currentSeries.expected_fee_pct ?? '') && saveSeriesTerms({ expected_fee_pct: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 62, fontSize: 12, padding: '5px 8px' }} />
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>% + VAT</span>
                <input type="number" step="1" defaultValue={currentSeries.expected_fee_vat_pct ?? 0} key={'fv' + currentSeries.id + currentSeries.expected_fee_vat_pct}
                  onBlur={e => Number(e.target.value) !== Number(currentSeries.expected_fee_vat_pct ?? 0) && saveSeriesTerms({ expected_fee_vat_pct: Number(e.target.value) || 0 })} style={{ width: 52, fontSize: 12, padding: '5px 8px' }} />
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>%</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleFile(f) }} />
            <button className="btn btn-gold" onClick={() => fileRef.current?.click()} disabled={!!upload && !['done', 'failed'].includes(upload.step)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="upload" size={14} /> Upload statement PDF</span>
            </button>
            {onClose && <button className="btn btn-ghost" onClick={onClose}>Close</button>}
          </div>
        </div>
      </div>

      {loading && <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: 20 }}>Loading the register…</div>}

      {!loading && series.length === 0 && (
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 6 }}>No statements on the register yet</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 14 }}>Upload Statement {DEFAULT_START} to begin. Each upload is reviewed line by line before anything is written.</div>
          <button className="btn btn-gold" onClick={() => fileRef.current?.click()}>Upload statement PDF</button>
        </div>
      )}

      {!loading && series.length > 0 && (
        <>
          {/* Missing statements + import errors */}
          <div style={{ display: 'grid', gridTemplateColumns: errorRows.length ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 14 }} className="detail-grid">
            <div className="card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Missing statements (from {startNumber})</div>
                {pill(missing.length ? `${missing.length} missing` : 'Sequence complete', missing.length ? T.red : T.green)}
              </div>
              {missing.length > 0 ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {missing.map(n => <button key={n} className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: T.red, borderColor: T.red + '77' }} onClick={() => { const s = statements.find(x => x.statement_number === n); if (s) setSelectedId(s.id) }}>Statement {n}</button>)}
                </div>
              ) : <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 8 }}>Every number from {startNumber} to {Math.max(startNumber, ...statements.map(s => s.statement_number))} is on the register. A missing number is never assumed to have had no activity.</div>}
            </div>
            {errorRows.length > 0 && (
              <div className="card" style={{ padding: '14px 18px' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Import errors</div>
                {errorRows.map(r => (
                  <div key={r.s.id} style={{ marginBottom: 6 }}>
                    {r.errors.map((e, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', background: T.bg, borderRadius: 6, marginBottom: 4, fontFamily: MONO, fontSize: 10, color: T.text }}>
                        <span style={{ color: T.red, fontWeight: 700 }}>Stmt {r.s.statement_number}</span>
                        <span style={{ flex: 1 }}>{e.property_address || 'no property'} · {e.tenant_name || 'no tenant'} · {e.amount == null ? 'no amount' : fmt(e.amount)} · <span style={{ color: T.muted }}>{e.reason}</span></span>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => setFixError({ statementId: r.s.id, index: i, reason: e.reason, raw: e.raw_text, draft: { line_type: e.section === 'expenditure' ? 'other_deduction' : 'rent', property_address: e.property_address || '', tenant_name: e.tenant_name || '', description: e.description || '', period_start: '', period_end: '', vat_amount: 0, _amount: e.amount ?? 0, fee_pct: '', fee_basis: '', line_no: e.line_no } })}>Fix &amp; re-process</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Register */}
          <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Statement register - {currentSeries?.landlord_company}</div>
              <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto', fontSize: 11, padding: '4px 8px' }}>
                <option value="all">All statements</option>
                <option value="attention">Needs attention</option>
                {STATEMENT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{th('No.')}{th('Date')}{th('Status')}{th('Lines', true)}{th('Transferred', true)}{th('Expected', true)}{th('Difference', true)}{th('Balances')}{th('Checked?')}{th('Checked by')}{th('Corr.')}{th('Bank')}{th('')}</tr></thead>
                <tbody>
                  {filteredRows.map(({ s, ls, check, errors }) => {
                    const isSel = s.id === selectedId
                    const counted = ls.filter(l => !NON_COUNTING_REVIEW.has(l.review_status)).length
                    return (
                      <tr key={s.id} style={{ background: isSel ? T.gold + '14' : 'transparent', cursor: 'pointer' }} onClick={() => setSelectedId(isSel ? null : s.id)}>
                        {td(<b>{s.statement_number}</b>)}
                        {td(fmtDate(s.statement_date) || '-', { color: T.muted })}
                        <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}22` }} onClick={e => e.stopPropagation()}>
                          <select value={s.status} onChange={e => patchStatement(s, { status: e.target.value })} style={{ width: 'auto', fontSize: 10, padding: '3px 6px', color: colours[s.status], fontWeight: 700, background: T.bg }}>
                            {STATEMENT_STATUSES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                        </td>
                        {td(s.status === 'not_uploaded' ? '-' : `${counted}${ls.length !== counted ? ` (+${ls.length - counted})` : ''}${errors.length ? ` · ${errors.length} err` : ''}`, { right: true, color: errors.length ? T.red : T.text })}
                        {td(s.payment_amount == null ? '-' : fmt(s.payment_amount), { right: true })}
                        {td(check ? fmt(check.expected) : '-', { right: true })}
                        {td(check && check.difference != null ? fmt(check.difference) : '-', { right: true, color: check && !check.balances ? T.red : T.green })}
                        {td(check ? pill(check.balances ? 'Yes' : 'No', check.balances ? T.green : T.red) : '')}
                        <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}22` }} onClick={e => e.stopPropagation()}>
                          {yesNo(!!s.statement_checked, v => patchStatement(s, { statement_checked: v, checked_by: v ? (s.checked_by || user?.email || '') : s.checked_by, checked_at: v ? (s.checked_at || today()) : s.checked_at }), s.status === 'not_uploaded')}
                        </td>
                        {td(s.checked_by ? `${s.checked_by}${s.checked_at ? ' · ' + fmtDate(s.checked_at) : ''}` : '', { color: T.muted, max: 200, title: s.checked_by })}
                        {td(s.correction_required ? pill('Yes', T.amber) : <span style={{ color: T.faint }}>No</span>)}
                        {td(s.bank_payment_matched ? pill('Yes', T.green) : <span style={{ color: T.faint }}>No</span>)}
                        {td(<span style={{ color: T.gold }}>{isSel ? 'Close' : 'Open'}</span>)}
                      </tr>
                    )
                  })}
                  {filteredRows.length === 0 && <tr><td colSpan={13} style={{ padding: 16, fontFamily: MONO, fontSize: 11, color: T.muted, textAlign: 'center' }}>Nothing matches this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail */}
          {selected && (() => {
            const { s, ls, check, errors } = selected
            const summary = s.last_import_summary
            return (
              <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Statement {s.statement_number} {s.statement_date ? `· ${fmtDate(s.statement_date)}` : ''} {pill(STATUS_LABEL[s.status], colours[s.status])}</h3>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 3 }}>
                      {s.landlord_company || currentSeries?.landlord_company}{s.landlord_name ? ` · ${s.landlord_name}` : ''}{s.agent ? ` · ${s.agent}` : ''}{s.file_name ? ` · ${s.file_name}` : ''}
                      {s.agent_reference ? ` · Agent ref ${s.agent_reference}` : ''}{s.statement_period_start ? ` · Period ${fmtDate(s.statement_period_start)} to ${fmtDate(s.statement_period_end)}` : ''}
                      {s.invoice_number && s.invoice_number !== s.agent_reference ? ` · Agent invoice ${s.invoice_number} ${fmtDate(s.invoice_date)} ${fmt(s.invoice_fees)}` : (s.invoice_fees != null ? ` · Fee invoice ${fmt(s.invoice_fees)}` : '')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {s.status !== 'not_uploaded' && <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => reprocessStored(s)}>Re-process from stored text</button>}
                    {s.status !== 'not_uploaded' && <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => startEditLine(s.id, null)}>Add a line</button>}
                    {s.status === 'not_uploaded' && <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()}>Upload this statement</button>}
                  </div>
                </div>

                {/* Review fields */}
                <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginTop: 14 }}>
                  <div><label>Status</label>
                    <select value={s.status} onChange={e => patchStatement(s, { status: e.target.value })} style={{ fontSize: 11, padding: '6px 8px', color: colours[s.status], fontWeight: 700 }}>
                      {STATEMENT_STATUSES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select></div>
                  <div><label>Statement checked?</label><div style={{ paddingTop: 4 }}>{yesNo(!!s.statement_checked, v => patchStatement(s, { statement_checked: v, checked_by: v ? (s.checked_by || user?.email || '') : s.checked_by, checked_at: v ? (s.checked_at || today()) : s.checked_at }))}</div></div>
                  <div><label>Checked by</label><input defaultValue={s.checked_by || ''} key={'cb' + s.id + s.checked_by} onBlur={e => e.target.value !== (s.checked_by || '') && patchStatement(s, { checked_by: e.target.value || null })} style={{ fontSize: 11, padding: '6px 8px' }} /></div>
                  <div><label>Date checked</label><input type="date" value={s.checked_at || ''} onChange={e => patchStatement(s, { checked_at: e.target.value || null })} style={{ fontSize: 11, padding: '6px 8px' }} /></div>
                  <div><label>Correction required?</label><div style={{ paddingTop: 4 }}>{yesNo(!!s.correction_required, v => patchStatement(s, { correction_required: v }))}</div></div>
                  <div><label>Bank payment matched?</label><div style={{ paddingTop: 4 }}>{yesNo(!!s.bank_payment_matched, v => patchStatement(s, { bank_payment_matched: v, ...(v && !s.bank_paid_date ? { bank_paid_date: today() } : {}), ...(v && s.bank_paid_amount == null ? { bank_paid_amount: s.payment_amount } : {}) }))}</div></div>
                  <div><label>Bank: date received</label><input type="date" value={s.bank_paid_date || ''} onChange={e => patchStatement(s, { bank_paid_date: e.target.value || null })} style={{ fontSize: 11, padding: '6px 8px' }} /></div>
                  <div><label>Bank: amount received</label><input type="number" step="0.01" defaultValue={s.bank_paid_amount ?? ''} key={'ba' + s.id + s.bank_paid_amount} onBlur={e => String(e.target.value) !== String(s.bank_paid_amount ?? '') && patchStatement(s, { bank_paid_amount: e.target.value === '' ? null : Number(e.target.value) })} style={{ fontSize: 11, padding: '6px 8px' }} /></div>
                  <div style={{ gridColumn: 'span 4' }}><label>Notes</label><textarea defaultValue={s.notes || ''} key={'n' + s.id} rows={2} onBlur={e => e.target.value !== (s.notes || '') && patchStatement(s, { notes: e.target.value || null })} style={{ fontSize: 11, padding: '6px 8px', resize: 'vertical' }} /></div>
                </div>
                {s.bank_paid_amount != null && s.payment_amount != null && Math.abs(round2(s.bank_paid_amount) - round2(s.payment_amount)) > 0.005 && (
                  <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10, color: T.red }}>Bank received {fmt(s.bank_paid_amount)} but the statement shows {fmt(s.payment_amount)} transferred (difference {fmt(round2(s.bank_paid_amount - s.payment_amount))}).</div>
                )}

                {s.status === 'not_uploaded' ? (
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: T.red + '14', border: `1px solid ${T.red}55`, fontFamily: MONO, fontSize: 11, color: T.text }}>
                    This statement number has not been uploaded. It is not assumed to have had no activity: obtain the statement from the agent and upload it, or record in the notes why it does not exist.
                  </div>
                ) : (
                  <>
                    <div style={{ marginTop: 16 }}>{totalsGrid(check)}{balanceBlock(check)}</div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: MONO, fontSize: 10, color: T.muted }}>
                      <span>Statement income total: <b style={{ color: T.text }}>{s.stated_income_total == null ? '-' : fmt(s.stated_income_total)}</b></span>
                      <span>Statement expenditure total: <b style={{ color: T.text }}>{s.stated_expenditure_total == null ? '-' : fmt(s.stated_expenditure_total)}</b></span>
                      <span>Previous balance: <b style={{ color: T.text }}>{fmt(s.previous_balance)}</b></span>
                      {Number(s.carried_forward) ? <span>Carried forward: <b style={{ color: T.text }}>{fmt(s.carried_forward)}</b></span> : null}
                      <span>New balance: <b style={{ color: T.text }}>{s.new_balance == null ? '-' : fmt(s.new_balance)}</b></span>
                      <span>Payment amount: <b style={{ color: T.text }}>{s.payment_amount == null ? '-' : fmt(s.payment_amount)}</b></span>
                    </div>

                    {errors.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: T.red, marginBottom: 6 }}>Import errors on this statement ({errors.length}) - the statement cannot be marked complete until these are resolved</div>
                        {errors.map((e, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', background: T.bg, borderRadius: 6, marginBottom: 4, fontFamily: MONO, fontSize: 10, color: T.text }}>
                            <span style={{ flex: 1 }}>{e.property_address || 'no property'} · {e.tenant_name || 'no tenant'} · {e.amount == null ? 'no amount' : fmt(e.amount)} · <span style={{ color: T.muted }}>{e.reason}</span>{e.description ? <span style={{ color: T.faint }}> · "{e.description}"</span> : ''}</span>
                            <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => setFixError({ statementId: s.id, index: i, reason: e.reason, raw: e.raw_text, draft: { line_type: e.section === 'expenditure' ? 'other_deduction' : 'rent', property_address: e.property_address || '', tenant_name: e.tenant_name || '', description: e.description || '', period_start: '', period_end: '', vat_amount: 0, _amount: e.amount ?? 0, fee_pct: '', fee_basis: '', line_no: e.line_no } })}>Fix &amp; re-process</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Transactions ({ls.length}) - every entry carries statement {s.statement_number}{s.statement_date ? ` dated ${fmtDate(s.statement_date)}` : ''}</div>
                      {ls.length ? lineTable(ls, { editable: true }) : <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>No lines recorded.</div>}
                    </div>

                    {summary && (
                      <details style={{ marginTop: 14 }}>
                        <summary style={{ fontFamily: MONO, fontSize: 10, color: T.muted, cursor: 'pointer' }}>Last import summary ({new Date(summary.at).toLocaleString('en-GB')})</summary>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }} className="kpi-grid">
                          {[['Transactions on statement', summary.transactions_on_statement], ['Imported', summary.imported], ['Previously imported', summary.previously_imported], ['Corrections', summary.corrections], ['Possible duplicates', summary.possible_duplicates], ['Import errors', summary.import_errors], ['Missing information', summary.missing_information], ['Balanced', summary.balances ? 'Yes' : 'No']].map(([l, v]) => (
                            <div key={l} style={{ background: T.bg, borderRadius: 6, padding: '6px 8px' }}>{label(l)}<div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.text }}>{String(v)}</div></div>
                          ))}
                        </div>
                      </details>
                    )}
                    {s.raw_text && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontFamily: MONO, fontSize: 10, color: T.muted, cursor: 'pointer' }}>Extracted statement text (kept for re-processing)</summary>
                        <pre style={{ marginTop: 6, maxHeight: 240, overflow: 'auto', fontFamily: MONO, fontSize: 10, color: T.muted, background: T.bg, padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{s.raw_text}</pre>
                      </details>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </>
      )}

      {uploadOverlay}
      {editOverlay}
      {fixOverlay}
    </div>
  )
}

function FailedUploadForm({ onSave, busy, T }) {
  const [n, setN] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
      <div style={{ width: 160 }}><label>Statement number</label><input type="number" value={n} onChange={e => setN(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} /></div>
      <button className="btn btn-gold" disabled={busy || !n} onClick={() => onSave(n)}>Record as Import Error</button>
      <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>or close and try another PDF</span>
    </div>
  )
}
