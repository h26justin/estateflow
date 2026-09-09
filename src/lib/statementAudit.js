// Rental Statement Audit - pure logic (no React, no Supabase).
//
// This module backs the standalone rental-statement / bank reconciliation
// audit. It is deliberately NOT connected to the property, tenancy or rent
// records elsewhere in the app: every figure comes from the agent's statement
// exactly as printed, property addresses are kept verbatim, and nothing here
// matches a line to a property record. The existing StatementImporter (which
// does write to the rent tracker) is untouched and unrelated.
//
// Responsibilities:
//   parseAuditStatement(text)      PNE-style statement text -> header, lines, totals
//   computeTotals(lines)           the nine statement totals + expected net
//   balanceCheck(stmt, lines)      does gross income - deductions = payment?
//   compareWithExisting(new, old)  previously imported / correction / duplicate
//   deriveStatus(...)              statement status after an import
//   missingNumbers(numbers, start) gaps in the statement sequence
//
// The parser works on the reading-order text produced by src/lib/pdfText.js.
// That text wraps cells unpredictably (tenant names continue on the line
// after the amounts, a rent period can be split around the amounts, the
// "Management / Commission x% / of £y" cell can span three lines), so entries
// are assembled as a stream rather than matched line by line: an entry opens
// at a recognised description, collects its three-amount cell, and keeps
// absorbing continuation lines until the next property label, entry start or
// section total. Amounts are pulled out first, so the order in which the
// words arrive does not matter.

export const STATEMENT_STATUSES = [
  { key: 'not_uploaded',            label: 'Not Uploaded' },
  { key: 'uploaded_awaiting_import',label: 'Uploaded - Awaiting Import' },
  { key: 'importing',               label: 'Importing' },
  { key: 'imported_awaiting_review',label: 'Imported - Awaiting Review' },
  { key: 'previously_imported_checked', label: 'Previously Imported - Checked and Correct' },
  { key: 'correction_required',     label: 'Correction Required' },
  { key: 'possible_duplicate',      label: 'Possible Duplicate' },
  { key: 'import_error',            label: 'Import Error' },
  { key: 'discrepancy_found',       label: 'Discrepancy Found' },
  { key: 'ready_for_bank_check',    label: 'Ready for Bank Check' },
  { key: 'fully_reconciled',        label: 'Fully Reconciled' },
]
export const STATUS_LABEL = Object.fromEntries(STATEMENT_STATUSES.map(s => [s.key, s.label]))

export const LINE_TYPES = [
  { key: 'rent',            label: 'Rent received',        section: 'income' },
  { key: 'arrears',         label: 'Arrears payment',      section: 'income' },
  { key: 'other_income',    label: 'Other income',         section: 'income' },
  { key: 'management_fee',  label: 'Management fee',       section: 'expenditure' },
  { key: 'maintenance',     label: 'Maintenance',          section: 'expenditure' },
  { key: 'other_deduction', label: 'Other deduction',      section: 'expenditure' },
  { key: 'credit',          label: 'Credit / adjustment',  section: 'expenditure' },
]
export const LINE_TYPE_LABEL = Object.fromEntries(LINE_TYPES.map(t => [t.key, t.label]))

export const REVIEW_STATUSES = [
  { key: 'imported',                    label: 'Imported' },
  { key: 'previously_imported_checked', label: 'Previously imported - checked and correct' },
  { key: 'correction_required',         label: 'Correction required' },
  { key: 'possible_duplicate',          label: 'Possible duplicate - manual review' },
  { key: 'import_error',                label: 'Import error' },
  { key: 'excluded',                    label: 'Excluded (not counted)' },
]
export const REVIEW_LABEL = Object.fromEntries(REVIEW_STATUSES.map(s => [s.key, s.label]))

// Lines in these states do not count towards statement totals.
export const NON_COUNTING_REVIEW = new Set(['possible_duplicate', 'import_error', 'excluded'])

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const money = s => { const n = parseFloat(String(s || '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? round2(n) : 0 }

const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 }

// "5th January 2026" or "05/01/2026" -> "2026-01-05"; null when unreadable.
export function toIsoDate(str) {
  if (!str) return null
  const s = String(str).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/)
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[0]
  return null
}

export function normaliseLabel(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(\d+) ([a-f])\b/g, '$1$2').trim()
}
export function seriesKeyFor(company) {
  return normaliseLabel(company).replace(/\b(limited|ltd|llp|plc)\b/g, '').trim().replace(/\s+/g, '-') || 'unknown'
}

// ── Line classification helpers ─────────────────────────────────────────────
// The three right-hand columns (Amount, VAT, Gross) are always the LAST three
// money values on a line - a fee line also carries "of £780.00" before them.
const TRIPLE = /£\s?(-?[\d,]+\.\d{2})\s+£\s?(-?[\d,]+\.\d{2})\s+£\s?(-?[\d,]+\.\d{2})\s*$/
const DATE = /\d{2}\/\d{2}\/\d{4}/
const ENTRY_START = /^(Rent\b|Brought\s+Forward|Management\b|Commission\s+[\d.]+%|Letting\s+Fee|Tenancy|Renewal|Deposit|Arrears|Repair|Maintenance|Invoice|Inv\b|Refund|Credit|Adjustment|Cleaning|Gas\b|Electric|Plumb|Boiler|Lock|Key\b|EPC|EICR|Inventory|Check[- ]?(in|out)|Admin|Referenc|Contractor|Handyman|Garden|Paint|Decorat|Carpet|Roof|Window|Door|Fire|Smoke|Legionella|Insurance|Council|Utility|Water|Court|Legal|Late\s+Payment)/i
const PROPERTY_HINT = /^(Flat|Room|Unit|Apartment|Apt|The|Ground|First|Second|Top|Basement|Lower|Upper|Rear|Front|Garage|Land)\b/i
const ROAD = /\b(Avenue|Street|Road|Place|Close|Drive|Way|Court|Gardens|Crescent|Lane|Terrace|Square|Grove|Mews|Walk|Hill|Rise|Park|Row|View|Heights|Vale|House|Villas|Green|Quay|Wharf|Parade|Boulevard|Briardene|Esplanade|West|East|North|South)\b/i
const MAINTENANCE_WORDS = /repair|maint|plumb|electric|gas\b|boiler|clean|lock|key\b|carpet|paint|decorat|roof|window|door|garden|handyman|contractor|inv\b|invoice|leak|drain|heating|smoke|alarm|epc|eicr|legionella|inventory|check[- ]?(in|out)|call[- ]?out|labour|materials/i
const CREDIT_WORDS = /credit|refund|adjust|reimburse|rebate|correction|reversal/i

function isBareTotal(line) {
  return TRIPLE.test(line) && !/[A-Za-z]/.test(line.replace(/£/g, ''))
}
function looksLikeProperty(line) {
  if (!line || line.includes('£') || DATE.test(line)) return false
  if (ENTRY_START.test(line)) return false
  if (/^(Income|Expenditure|Summary|Statement|Balance|New Balance|PAYMENT|Our Invoice|Date|Total|Gross|Amount|VAT)\b/i.test(line)) return false
  if (line.length < 3 || line.length > 110) return false
  if (PROPERTY_HINT.test(line)) return true
  if (/^\d+\s*[A-Za-z]?\s*,/.test(line)) return true             // "29, Briardene" / "4A, 10, Elms West"
  if (/^\d+\s*[A-Za-z]?\s+[A-Z]/.test(line)) return true          // "7 Watts Moses House" / "47 B, Somerset"
  if (ROAD.test(line) && /^[A-Z0-9]/.test(line) && !/^(Mr|Mrs|Ms|Miss|Dr)\b/.test(line)) return true
  return false
}

// ── Parser ──────────────────────────────────────────────────────────────────
export function parseAuditStatement(rawText) {
  const text = String(rawText || '')
  const lines = text.split('\n').map(l => l.replace(/\s+$/, '').trim())
    .filter(l => l && !/^-{2,}\s*PAGE BREAK\s*-{2,}$/i.test(l))
  const out = {
    ok: false, agent: null, landlordName: '', landlordCompany: '', seriesKey: 'unknown',
    statementNumber: null, statementDate: null, statementDateText: '',
    lines: [], errors: [], warnings: [],
    statedIncomeTotal: null, statedExpenditureTotal: null,
    previousBalance: 0, newBalance: null, paymentAmount: null,
    invoiceNumber: null, invoiceDate: null, invoiceFees: null,
    rawLineCount: lines.length, problem: null,
  }
  if (text.replace(/\s+/g, '').length < 40) {
    out.problem = 'The PDF has no readable text. It looks like a scanned image; ask the agent for the original PDF.'
    return out
  }

  // Header (everything before the first section heading).
  let incomeIdx = lines.findIndex(l => /^Income(\s+Amount)?(\s+VAT)?(\s+Gross)?$/i.test(l))
  const summaryIdx = lines.findIndex(l => /^Summary$/i.test(l))
  const headerEnd = incomeIdx >= 0 ? incomeIdx : (summaryIdx >= 0 ? summaryIdx : Math.min(lines.length, 8))
  for (let i = 0; i < headerEnd; i++) {
    const l = lines[i]
    const sm = l.match(/Statement\s*No\s*[:.]?\s*(\d+)/i)
    if (sm) out.statementNumber = parseInt(sm[1], 10)
    const dm = l.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)\s+(\d{4})/)
    if (dm && !out.statementDate && MONTHS[dm[2].toLowerCase()]) { out.statementDateText = dm[0]; out.statementDate = toIsoDate(dm[0]) }
    if (!out.landlordCompany && /(Limited|Ltd|LLP|Plc|Property Group)\b/i.test(l) && !/Statement\s*No/i.test(l)) {
      out.landlordCompany = l.replace(/\s{2,}.*$/, '').replace(/\s+\d{1,2}(st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}.*$/, '').trim()
    }
  }
  if (lines[0] && !/(Limited|Ltd|Statement)/i.test(lines[0])) out.landlordName = lines[0].replace(/\s{2,}.*$/, '').trim()
  // A statement number can also sit inside the section body when the layout wraps.
  if (out.statementNumber == null) {
    const any = text.match(/Statement\s*No\s*[:.]?\s*(\d+)/i)
    if (any) out.statementNumber = parseInt(any[1], 10)
  }
  out.agent = /Propertunity|PNE|Gardner Industrial|Beckenham|Statement No/i.test(text) ? 'PNE' : (/Rook Matthews|STATEMENT\/INVOICE/i.test(text) ? 'RMS' : null)
  out.seriesKey = seriesKeyFor(out.landlordCompany || out.landlordName)

  // Sections. The 2026 template always prints "Expenditure  Amount  VAT  Gross";
  // if it ever disappears, the first commission line starts the section.
  let expIdx = lines.findIndex((l, i) => i > incomeIdx && /^Expenditure(\s+Amount)?(\s+VAT)?(\s+Gross)?$/i.test(l))
  if (incomeIdx < 0) incomeIdx = lines.findIndex(l => /^Rent\b/i.test(l)) - 1
  if (expIdx < 0) expIdx = lines.findIndex((l, i) => i > incomeIdx && /^Management\s+Commission/i.test(l))
  const end = summaryIdx >= 0 ? summaryIdx : lines.length

  const entries = []      // { section, property, parts:[], amounts:null, startLine }
  let current = null
  let property = ''
  let lastWasProperty = false
  let seq = 0

  const close = () => { if (current) { entries.push(current); current = null } }
  const open = (section, line, idx) => {
    close()
    current = { section, property, parts: [], amounts: null, startLine: idx, seq: ++seq }
    absorb(line)
  }
  const absorb = (line) => {
    const m = line.match(TRIPLE)
    if (m) {
      if (current.amounts) {
        // A second amount cell inside one entry means a new, unlabelled entry.
        const sec = current.section; const idx = current.startLine
        close(); current = { section: sec, property, parts: [], amounts: null, startLine: idx, seq: ++seq }
      }
      current.amounts = [money(m[1]), money(m[2]), money(m[3])]
      const rest = line.replace(TRIPLE, ' ').replace(/\s+/g, ' ').trim()
      if (rest) current.parts.push(rest)
    } else {
      current.parts.push(line)
    }
  }

  const walk = (from, to, section) => {
    for (let i = from; i < to; i++) {
      const line = lines[i]
      if (/^(Income|Expenditure)(\s+Amount)?(\s+VAT)?(\s+Gross)?$/i.test(line)) continue
      if (isBareTotal(line)) {
        // A bare amount cell belongs to the open entry when that entry has no
        // amounts yet (the description wrapped above it). Otherwise it is the
        // section total.
        if (current && !current.amounts) { absorb(line); lastWasProperty = false; continue }
        close()
        const m = line.match(TRIPLE)
        if (section === 'income') out.statedIncomeTotal = money(m[3])
        else out.statedExpenditureTotal = money(m[3])
        lastWasProperty = false
        continue
      }
      // "Management" / "Commission 12.00%  £60.00 ..." / "of £500.00": the
      // second and third lines continue the first, they do not start entries.
      if (current && /^Commission\s+[\d.]+\s*%/i.test(line) && /Management$/i.test(current.parts.join(' '))) { absorb(line); lastWasProperty = false; continue }
      if (current && /^of\s+£/i.test(line)) { absorb(line); lastWasProperty = false; continue }
      // The word "Management" can share a baseline with the property label
      // above its wrapped commission line ("13, Lumley Street  Management").
      const pm = line.match(/^(.*\S)\s{2,}Management$/i)
      if (pm && looksLikeProperty(pm[1])) { close(); property = pm[1].trim(); open(section, 'Management', i); lastWasProperty = false; continue }
      if (ENTRY_START.test(line)) { open(section, line, i); lastWasProperty = false; continue }
      if (current) {
        const hasTriple = TRIPLE.test(line)
        if (hasTriple) { absorb(line); lastWasProperty = false; continue }
        if (looksLikeProperty(line) && (current.amounts || current.parts.join(' ').match(DATE))) {
          // Next property label: the open entry is complete (or will be
          // reported as an error if it never received an amount).
          close(); property = line; lastWasProperty = true; continue
        }
        absorb(line); lastWasProperty = false; continue
      }
      // Nothing open.
      if (looksLikeProperty(line)) { property = line; lastWasProperty = true; continue }
      if (TRIPLE.test(line)) { open(section, line, i); lastWasProperty = false; continue }
      if (lastWasProperty && section === 'income') {
        // Two-line property label ("The Lounge, Watts Moses House," / "High Street East").
        property = `${property} ${line}`.replace(/\s+/g, ' ').trim(); continue
      }
      // Unknown description (typical of a maintenance charge) - open an
      // unlabelled entry and let the classifier decide.
      open(section, line, i); lastWasProperty = false
    }
    close()
  }
  if (incomeIdx >= 0) walk(incomeIdx + 1, expIdx >= 0 ? expIdx : end, 'income')
  if (expIdx >= 0) walk(expIdx, end, 'expenditure')

  // Summary block.
  for (let i = summaryIdx >= 0 ? summaryIdx : 0; i < lines.length; i++) {
    const l = lines[i]
    let m = l.match(/Balance from previous statement\s+(-?£?\s?-?[\d,]+\.\d{2})/i); if (m) out.previousBalance = money(m[1])
    m = l.match(/New Balance\s+(-?£?\s?-?[\d,]+\.\d{2})/i); if (m) out.newBalance = money(m[1])
    m = l.match(/PAYMENT AMOUNT\s+(-?£?\s?-?[\d,]+\.\d{2})/i); if (m) out.paymentAmount = money(m[1])
    m = l.match(/^(\d{2}\/\d{2}\/\d{4})\s+(INV\S*)\s+£?\s?([\d,]+\.\d{2})/i)
    if (m) { out.invoiceDate = toIsoDate(m[1]); out.invoiceNumber = m[2]; out.invoiceFees = money(m[3]) }
  }
  if (out.paymentAmount == null && summaryIdx < 0) {
    const m = text.match(/PAYMENT AMOUNT\s+£?\s?(-?[\d,]+\.\d{2})/i); if (m) out.paymentAmount = money(m[1])
  }

  // Classify entries into audit lines.
  let lineNo = 0
  for (const e of entries) {
    lineNo++
    const desc = e.parts.join(' ').replace(/\s+/g, ' ').replace(/\s+-\s*$/, '').trim()
    const base = {
      line_no: lineNo, section: e.section, property_address: e.property || '', tenant_name: '',
      period_start: null, period_end: null, transaction_date: out.statementDate,
      description: desc, gross_rent: 0, fee_amount: 0, vat_amount: 0, deduction_amount: 0, credit_amount: 0, net_amount: 0,
      fee_pct: null, fee_basis: null, flags: [], raw_text: e.parts.join('\n'),
    }
    if (!e.amounts) {
      out.errors.push({ line_no: lineNo, section: e.section, property_address: e.property || '', tenant_name: '',
        description: desc, amount: null, reason: 'No amount cell found for this entry', raw_text: base.raw_text })
      continue
    }
    const [net, vat, gross] = e.amounts
    if (!e.property) base.flags.push('missing_property')
    let type = null
    let m
    if ((m = desc.match(/^Rent for the month\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})\s*(?:-\s*(.*))?$/i))) {
      type = 'rent'; base.period_start = toIsoDate(m[1]); base.period_end = toIsoDate(m[2]); base.tenant_name = (m[3] || '').trim()
    } else if (e.section === 'income' && /\bArrears\b/i.test(desc)) {
      // "Rent Arrears Room 41 - Tenant", "Arrears From 39 Watts Moses - Tenant",
      // "Brought Forward Arrears - Tenant": money collected against a past
      // debt, kept apart from the month's rent.
      type = 'arrears'
      const segs = desc.split(/\s+-\s+/)
      if (segs.length > 1) { base.tenant_name = segs.pop().trim(); base.description = segs.join(' - ').trim() }
    } else if ((m = desc.match(/^Rent\s+(\d{2}\/\d{2}\/\d{4})\s*(?:-|to)\s*(\d{2}\/\d{2}\/\d{4})\s*(?:-\s*(.*))?$/i))) {
      type = 'rent'; base.period_start = toIsoDate(m[1]); base.period_end = toIsoDate(m[2]); base.tenant_name = (m[3] || '').trim()
      base.flags.push('part_period')
    } else if (/^Rent\b/i.test(desc) && e.section === 'income') {
      // Rent-related but not a dated month ("Rent Was More Than previous
      // Agent Advised - Tenant"): counted as other income and flagged so it
      // is looked at rather than silently treated as the month's rent.
      type = 'other_income'
      const segs = desc.split(/\s+-\s+/); if (segs.length > 1) { base.tenant_name = segs.pop().trim(); base.description = segs.join(' - ').trim() }
      base.flags.push('review_description')
    } else if ((m = desc.match(/^Management\s+Commission\s+([\d.]+)\s*%(?:\s*of\s*£?\s?([\d,]+\.?\d*))?/i))) {
      type = 'management_fee'; base.fee_pct = parseFloat(m[1]); base.fee_basis = m[2] ? money(m[2]) : null
      if (base.fee_basis == null) base.flags.push('missing_fee_basis')
    } else if (/^(Management|Letting|Tenancy|Renewal|Admin|Referenc)/i.test(desc) && /fee|commission|charge/i.test(desc)) {
      type = 'management_fee'
      const pm = desc.match(/([\d.]+)\s*%/); if (pm) base.fee_pct = parseFloat(pm[1])
    } else if (e.section === 'income') {
      type = gross < 0 ? 'credit' : 'other_income'; base.flags.push('unclassified')
      const segs = desc.split(/\s+-\s+/); if (segs.length > 1) { base.tenant_name = segs.pop().trim(); base.description = segs.join(' - ').trim() }
    } else if (gross < 0 || CREDIT_WORDS.test(desc)) {
      type = 'credit'
    } else if (MAINTENANCE_WORDS.test(desc)) {
      type = 'maintenance'
    } else {
      type = 'other_deduction'; base.flags.push('unclassified')
    }
    if (e.section === 'expenditure' && (type === 'rent' || type === 'arrears' || type === 'other_income')) type = 'other_deduction'
    base.line_type = type
    base.vat_amount = vat
    if (type === 'rent' || type === 'arrears' || type === 'other_income') {
      base.gross_rent = gross; base.net_amount = gross
      if (!base.tenant_name) base.flags.push('missing_tenant')
      if (type === 'rent' && !base.period_start) base.flags.push('missing_period')
    } else if (type === 'management_fee') {
      base.fee_amount = net; base.net_amount = -gross
      if (base.fee_pct != null && base.fee_basis != null && Math.abs(round2(base.fee_basis * base.fee_pct / 100) - net) > 0.011) base.flags.push('fee_does_not_match_percentage')
    } else if (type === 'credit') {
      base.credit_amount = Math.abs(gross); base.net_amount = Math.abs(gross)
    } else {
      base.deduction_amount = net; base.net_amount = -gross
    }
    if (Math.abs(round2(net + vat) - gross) > 0.011) base.flags.push('amount_plus_vat_not_gross')
    base.line_key = lineKey(base)
    base.loose_key = looseKey(base)
    out.lines.push(base)
  }

  if (!out.lines.length && !out.errors.length) {
    out.problem = 'Recognised the statement header but found no income or expenditure entries. The layout may have changed; the extracted text has been kept for review.'
  } else {
    out.ok = true
  }
  if (out.statementNumber == null) out.warnings.push('No statement number found in the header.')
  if (!out.statementDate) out.warnings.push('No statement date found in the header.')
  if (out.paymentAmount == null) out.warnings.push('No PAYMENT AMOUNT found in the summary.')
  return out
}

// Exact identity of a line for duplicate detection. Same type, property,
// period, tenant and gross amount on the same statement means the same entry.
export function lineKey(l) {
  const amt = l.line_type === 'management_fee' ? round2(l.fee_amount) : (l.line_type === 'credit' ? round2(l.credit_amount) : (l.gross_rent ? round2(l.gross_rent) : round2(l.deduction_amount)))
  return [l.line_type, normaliseLabel(l.property_address), l.period_start || '', l.period_end || '', amt.toFixed(2), normaliseLabel(l.tenant_name), l.line_type === 'management_fee' ? (l.fee_basis ?? '') : '', normaliseLabel(l.line_type === 'rent' ? '' : l.description)].join('|')
}
// Looser identity: the same slot on the statement even if the amount or
// tenant spelling changed - used to offer a correction instead of a new row.
export function looseKey(l) {
  if (l.line_type === 'management_fee') return ['fee', normaliseLabel(l.property_address), l.fee_pct ?? '', l.fee_basis ?? ''].join('|')
  if (l.line_type === 'rent') return ['rent', normaliseLabel(l.property_address), l.period_start || '', l.period_end || ''].join('|')
  return [l.line_type, normaliseLabel(l.property_address), normaliseLabel(l.description)].join('|')
}

// ── Totals & balance check ──────────────────────────────────────────────────
export function computeTotals(lines) {
  const t = { gross_rent: 0, arrears: 0, other_income: 0, management_fees: 0, vat: 0, maintenance: 0, other_deductions: 0, credits: 0, counted: 0, excluded: 0 }
  for (const l of lines || []) {
    if (NON_COUNTING_REVIEW.has(l.review_status)) { t.excluded++; continue }
    t.counted++
    const n = k => Number(l[k]) || 0
    switch (l.line_type) {
      case 'rent': t.gross_rent += n('gross_rent'); break
      case 'arrears': t.arrears += n('gross_rent'); break
      case 'other_income': t.other_income += n('gross_rent'); break
      case 'management_fee': t.management_fees += n('fee_amount'); break
      case 'maintenance': t.maintenance += n('deduction_amount'); break
      case 'other_deduction': t.other_deductions += n('deduction_amount'); break
      case 'credit': t.credits += n('credit_amount'); break
      default: break
    }
    t.vat += n('vat_amount')
  }
  for (const k of Object.keys(t)) if (k !== 'counted' && k !== 'excluded') t[k] = round2(t[k])
  t.total_income = round2(t.gross_rent + t.arrears + t.other_income)
  t.total_deductions = round2(t.management_fees + t.maintenance + t.other_deductions + t.vat)
  return t
}

// Gross income (rent + arrears + other) minus every fee, VAT and deduction,
// plus credits and any balance carried from the previous statement, should
// equal the payment the agent says it transferred.
export function balanceCheck(stmt, lines) {
  const t = computeTotals(lines)
  const prev = Number(stmt?.previous_balance ?? stmt?.previousBalance) || 0
  const expected = round2(t.total_income - t.total_deductions + t.credits + prev)
  const stated = stmt?.payment_amount ?? stmt?.paymentAmount ?? stmt?.new_balance ?? stmt?.newBalance
  const statedNum = stated == null ? null : round2(stated)
  const difference = statedNum == null ? null : round2(expected - statedNum)
  const causes = []
  const sIn = stmt?.stated_income_total ?? stmt?.statedIncomeTotal
  const sOut = stmt?.stated_expenditure_total ?? stmt?.statedExpenditureTotal
  if (sIn != null && Math.abs(round2(sIn) - t.total_income) > 0.005) causes.push(`Income section: imported lines total £${t.total_income.toFixed(2)} but the statement's income total is £${round2(sIn).toFixed(2)} (difference £${round2(t.total_income - sIn).toFixed(2)}).`)
  if (sOut != null && Math.abs(round2(sOut) - t.total_deductions) > 0.005) causes.push(`Expenditure section: imported lines total £${t.total_deductions.toFixed(2)} but the statement's expenditure total is £${round2(sOut).toFixed(2)} (difference £${round2(t.total_deductions - sOut).toFixed(2)}).`)
  const nb = stmt?.new_balance ?? stmt?.newBalance
  if (statedNum != null && nb != null && Math.abs(round2(nb) - statedNum) > 0.005) causes.push(`Summary: New Balance £${round2(nb).toFixed(2)} differs from PAYMENT AMOUNT £${statedNum.toFixed(2)}; the agent may have held part of the balance back.`)
  if (prev) causes.push(`Summary: £${prev.toFixed(2)} carried from the previous statement is included in the expected figure.`)
  if (difference != null && Math.abs(difference) > 0.005) {
    const target = Math.abs(difference)
    const culprit = (lines || []).find(l => !NON_COUNTING_REVIEW.has(l.review_status) && [l.gross_rent, l.fee_amount, l.deduction_amount, l.credit_amount, l.vat_amount].some(v => Math.abs(round2(v) - target) < 0.005))
    if (culprit) causes.push(`Line ${culprit.line_no ?? '?'} (${culprit.property_address || 'no property'}, ${LINE_TYPE_LABEL[culprit.line_type] || culprit.line_type}) is worth exactly £${target.toFixed(2)}, the size of the difference.`)
    const dup = (lines || []).filter(l => l.review_status === 'possible_duplicate')
    if (dup.length) causes.push(`${dup.length} possible duplicate line${dup.length === 1 ? '' : 's'} excluded from the total pending review.`)
    const errs = Number(stmt?.error_count) || (Array.isArray(stmt?.import_errors) ? stmt.import_errors.length : 0)
    if (errs) causes.push(`${errs} entr${errs === 1 ? 'y' : 'ies'} could not be imported and ${errs === 1 ? 'is' : 'are'} missing from the total.`)
    if (!causes.length) causes.push('Every section total agrees with its lines, so the difference sits in the summary block (previous balance, New Balance or PAYMENT AMOUNT).')
  }
  const invoiceFees = stmt?.invoice_fees ?? stmt?.invoiceFees
  if (invoiceFees != null && Math.abs(round2(invoiceFees) - round2(t.management_fees + t.vat)) > 0.005 && sOut != null && Math.abs(round2(sOut) - round2(invoiceFees)) > 0.005) {
    causes.push(`The agent's invoice (£${round2(invoiceFees).toFixed(2)}) does not equal the fees plus VAT on the statement (£${round2(t.management_fees + t.vat).toFixed(2)}).`)
  }
  return { totals: t, expected, stated: statedNum, difference, balances: difference != null && Math.abs(difference) < 0.005, causes }
}

// ── Comparison with what is already on the register ────────────────────────
// Each parsed line gets a decision:
//   new                          nothing on the register matches
//   previously_imported_checked  identical line already recorded
//   correction_required          same slot, different figures (diff listed)
//   possible_duplicate           identical to a line already matched by another
//                                parsed line, or to another parsed line
// Existing lines not seen on this upload are returned in `missingFromUpload`.
export function compareWithExisting(parsedLines, existingLines) {
  const existing = (existingLines || []).map(l => ({ ...l, _key: l.line_key || lineKey(l), _loose: looseKey(l), _used: false }))
  const seenParsed = new Map()
  const decisions = (parsedLines || []).map(p => {
    const key = p.line_key || lineKey(p)
    const loose = p.loose_key || looseKey(p)
    const d = { parsed: p, key, decision: 'new', existing: null, diff: [] }
    if (seenParsed.has(key)) { d.decision = 'possible_duplicate'; d.note = `Identical to line ${seenParsed.get(key)} on this upload`; return d }
    seenParsed.set(key, p.line_no)
    const exact = existing.find(e => !e._used && e._key === key)
    if (exact) { exact._used = true; d.decision = 'previously_imported_checked'; d.existing = exact; return d }
    const usedExact = existing.find(e => e._used && e._key === key)
    if (usedExact) { d.decision = 'possible_duplicate'; d.existing = usedExact; d.note = 'An identical line is already on the register and already matched'; return d }
    const near = existing.find(e => !e._used && e._loose === loose)
    if (near) {
      near._used = true; d.decision = 'correction_required'; d.existing = near
      for (const f of ['property_address', 'tenant_name', 'period_start', 'period_end', 'gross_rent', 'fee_amount', 'vat_amount', 'deduction_amount', 'credit_amount', 'fee_pct', 'fee_basis', 'description', 'line_type']) {
        const a = near[f] ?? null, b = p[f] ?? null
        const same = (typeof a === 'number' || typeof b === 'number') ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005 : String(a ?? '') === String(b ?? '')
        if (!same) d.diff.push({ field: f, from: a, to: b })
      }
      if (!d.diff.length) d.decision = 'previously_imported_checked'
    }
    return d
  })
  return { decisions, missingFromUpload: existing.filter(e => !e._used) }
}

// Statement status after an import, from what happened to its lines.
export function deriveStatus({ errorCount = 0, correctionCount = 0, duplicateCount = 0, newCount = 0, previouslyCount = 0, missingFromUpload = 0, balances = true }) {
  if (errorCount > 0) return 'import_error'
  if (correctionCount > 0 || missingFromUpload > 0) return 'correction_required'
  if (duplicateCount > 0) return 'possible_duplicate'
  if (!balances) return 'discrepancy_found'
  if (newCount === 0 && previouslyCount > 0) return 'previously_imported_checked'
  return 'imported_awaiting_review'
}

// Gaps in a statement sequence from `start` up to the highest number seen.
export function missingNumbers(numbers, start) {
  const have = new Set((numbers || []).map(Number).filter(Number.isFinite))
  const max = have.size ? Math.max(...have) : null
  const from = Number.isFinite(Number(start)) ? Number(start) : (have.size ? Math.min(...have) : null)
  if (max == null || from == null) return []
  const out = []
  for (let n = from; n <= max; n++) if (!have.has(n)) out.push(n)
  return out
}

// One-line summary used by the review screen and stored on the statement.
export function buildImportSummary({ parsed, decisions, applied, check, checked, status }) {
  const count = k => decisions.filter(d => d.decision === k).length
  return {
    statement_number: parsed.statementNumber,
    statement_date: parsed.statementDate,
    statement_total: parsed.paymentAmount,
    transactions_on_statement: parsed.lines.length + parsed.errors.length,
    imported: applied?.inserted ?? count('new'),
    previously_imported: count('previously_imported_checked'),
    corrections: count('correction_required'),
    possible_duplicates: count('possible_duplicate'),
    import_errors: parsed.errors.length,
    missing_information: parsed.lines.filter(l => l.flags?.some(f => /^missing_/.test(f))).length,
    balances: !!check?.balances,
    expected_net: check?.expected ?? null,
    stated_net: check?.stated ?? null,
    difference: check?.difference ?? null,
    manually_checked: !!checked,
    ready_for_bank: status === 'ready_for_bank_check' || status === 'fully_reconciled',
    status,
    at: new Date().toISOString(),
  }
}
