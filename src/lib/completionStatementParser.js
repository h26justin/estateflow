// Assisted import for deal documents (Deals brief §9).
//
// Reads the text of a completion statement or an offer letter / brochure and
// suggests machine-readable figures, each with a citation: the page, the line
// it came from (the quote) and a confidence between 0 and 1. Nothing here
// writes anything; a person approves or rejects every suggestion in the deal's
// documents tab (components/DealDocumentExtract.jsx).
//
// Completion statements: purchase price, SDLT, legal fees and their VAT,
// searches, Land Registry and other disbursements, the total, monies on
// account and the BALANCE DUE. The figures are checked:
//     total - credits (on account, deposit paid) = balance due   (within £1)
// and a mismatch is flagged, never silently corrected.
//
// Offer letters and brochures: the agreed price and the asking (guide /
// advertised) price, kept apart. The advertised price is never treated as
// the agreed price: it has no cost category and cannot become a purchase
// price cost line.
//
// Pure: no React, no DB, no pdf.js. Input is either the text from
// lib/pdfExtract (pages separated by the PAGE BREAK marker) or an array of
// pages, each an array of lines. Page numbers are 1-based.

export const BALANCE_TOLERANCE = 1 // pounds
const QUOTE_MAX = 300
const PAGE_BREAK_RE = /\n*--- PAGE BREAK ---\n*/

// Fields that are check or reference figures, not costs. They are stored and
// reviewed like the others but never become a deal_cost_lines row.
// A mortgage advance is funding (deal_funding), not a cost, but it is a credit
// on the statement, so it counts towards the balance check.
export const CHECK_FIELDS = Object.freeze(['total', 'balance_due', 'asking_price', 'mortgage_advance'])
const CREDIT_FIELDS = new Set(['on_account', 'deposit_paid', 'mortgage_advance'])

export const FIELD_LABEL = Object.freeze({
  purchase_price: 'Purchase price',
  agreed_price:   'Agreed price',
  asking_price:   'Asking / advertised price',
  sdlt:           'Stamp Duty Land Tax',
  legal_fee:      'Legal fees',
  legal_vat:      'VAT on legal fees',
  searches:       'Searches',
  land_registry:  'Land Registry fee',
  disbursements:  'Disbursements',
  survey:         'Survey',
  broker:         'Broker fee',
  auction:        'Auction fees',
  indemnity:      'Indemnity policy',
  on_account:     'Monies on account',
  mortgage_advance: 'Mortgage advance (funding)',
  deposit_paid:   'Deposit paid',
  total:          'Total',
  balance_due:    'Balance due',
})

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Normalise the input to an array of pages, each an array of trimmed lines. */
export function toPages(input) {
  if (Array.isArray(input)) {
    return input.map(p => (Array.isArray(p) ? p : String(p ?? '').split('\n'))
      .map(l => String(l ?? '').replace(/\s+$/g, '')).filter(l => l.trim()))
  }
  return String(input ?? '').split(PAGE_BREAK_RE)
    .map(p => p.split('\n').map(l => l.replace(/\s+$/g, '')).filter(l => l.trim()))
}

/** True when the document has (almost) no text layer, e.g. a scan. */
export function hasTextLayer(input) {
  const chars = toPages(input).flat().join('').replace(/\s+/g, '').length
  return chars >= 20
}

// A money token: optional sign / brackets / £, thousands commas, optional
// pence. Percentages, dates and reference numbers are rejected below.
const MONEY_RE = /(\(?)(-?)\s?(£)?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(\)?)/g

/**
 * Money amounts on a line, left to right, as { value, index, end, strong }.
 * `strong` means the token looked like money (£, pence or thousands commas);
 * a bare integer is only accepted as the last token on the line.
 */
export function moneyTokens(line) {
  const s = String(line || '')
  const out = []
  MONEY_RE.lastIndex = 0
  let m
  while ((m = MONEY_RE.exec(s))) {
    const [raw, open, minus, pound, whole, pence, close] = m
    // The pattern may swallow one leading space; the token starts after it.
    const start = m.index + (raw.length - raw.trimStart().length)
    const end = m.index + raw.length
    const before = s[start - 1] || ''
    const after = s[end] || ''
    // Part of a word, a date, a reference or a percentage.
    if (/[A-Za-z0-9/.\-]/.test(before) && !pound) continue
    if (/[%/\d]/.test(after) || /^\s?%/.test(s.slice(end))) continue
    if (/^\s?(?:st|nd|rd|th)\b/i.test(s.slice(end))) continue
    const strong = !!(pound || pence || whole.includes(','))
    if (!strong) {
      // Bare integers: only the last thing on the line, unbracketed, and not
      // a scale / band / page number.
      if (open || close) continue
      if (s.slice(end).trim()) continue
      if (/(?:scale|band|page|p\.|no\.?|number|ref\.?|@)\s*$/i.test(s.slice(0, start))) continue
      if (/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i.test(s.slice(0, start))) continue
    }
    if (pence && pence.length !== 3) continue // "1.5" is not money
    const value = Number(whole.replace(/,/g, '') + (pence || ''))
    if (!Number.isFinite(value)) continue
    out.push({ value, index: start, end, strong, negative: !!(minus || (open && close)) })
  }
  return out
}

/** The line with its amounts removed: the label used for matching. */
function labelOf(line, tokens) {
  let s = String(line)
  for (let i = tokens.length - 1; i >= 0; i--) s = s.slice(0, tokens[i].index) + ' ' + s.slice(tokens[i].end)
  return s.replace(/[£:]/g, ' ').replace(/\s+/g, ' ').trim()
}

const quoteOf = line => String(line).replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX)
const round2 = n => Math.round(n * 100) / 100

/**
 * Whether the amount on a quoted line includes VAT, for the cost line's
 * vat_included flag: false for "plus VAT" / "ex VAT" / "net", true for
 * "inc VAT" and for the VAT itself, otherwise true (the column default).
 */
export function vatIncludedFor(field, quote) {
  const q = String(quote || '')
  if (field === 'legal_vat') return true
  if (/\b(?:plus|\+|ex(?:cl(?:uding|usive)?)?\.?|before|net\s+of)\s*VAT\b|\bnet\b/i.test(q)) return false
  return true
}

// ── Completion statements ────────────────────────────────────────────────────

// Order matters: the first rule whose label pattern matches wins.
const COMPLETION_RULES = [
  { field: 'balance_due', category: null, confidence: 0.95,
    re: /\bbalance\b.*\b(?:due|required|payable|needed|to complete|owing|from you)\b|\bamount\s+(?:required|needed|due|payable)\b.*\bcomplet|\brequired\s+(?:from\s+you\s+)?(?:to|for)\s+complet|\bbalance\s+(?:to\s+be\s+)?(?:paid|sent|transferred)\b/i },
  { field: 'mortgage_advance', category: null, confidence: 0.85,
    re: /\bmortgage\s+(?:advance|monies|money|funds|loan)\b|\badvance\s+from\b|\bloan\s+(?:advance|monies)\b|\bbridging\s+(?:loan|finance|advance)\b/i },
  { field: 'deposit_paid', category: 'deposit_paid', confidence: 0.85,
    re: /\bdeposit\b.*\b(?:paid|received|already|held)\b|\bless\b.*\bdeposit\b/i },
  { field: 'on_account', category: 'on_account', confidence: 0.9,
    re: /\bon\s+account\b|\bless\b.*\b(?:paid|received)\b|\b(?:monies|money|funds|sums?)\s+(?:already\s+)?(?:received|paid|held)\b/i },
  { field: 'total', category: null, confidence: 0.9,
    re: /^(?:grand\s+)?totals?\b(?!.*\b(?:paid|received|credits?|account|legal|fees?|VAT|search(?:es)?|disbursements?|duty|registry)\b)/i },
  { field: 'purchase_price', category: 'purchase_price', confidence: 0.95,
    re: /\bpurchase\s+(?:price|monies|money|consideration)\b|^consideration\b|^(?:agreed\s+)?price\b/i },
  { field: 'sdlt', category: 'sdlt', confidence: 0.95,
    re: /\bstamp\s+duty\b|\bSDLT\b|\bland\s+transaction\s+tax\b|\bLTT\b/i },
  { field: 'land_registry', category: 'land_registry', confidence: 0.9,
    re: /\bland\s+registry\b|\bHMLR\b|\bregistration\s+fee\b|\bAP1\b/i },
  { field: 'searches', category: 'searches', confidence: 0.85,
    re: /\bsearch(?:es)?\b/i },
  { field: 'indemnity', category: 'indemnity', confidence: 0.85, re: /\bindemnity\b/i },
  { field: 'survey', category: 'survey', confidence: 0.8, re: /\bsurvey(?:or)?\b|\bvaluation\s+fee\b/i },
  { field: 'broker', category: 'broker', confidence: 0.8, re: /\bbroker\b/i },
  { field: 'auction', category: 'auction', confidence: 0.8, re: /\bauction\b|\bbuyer'?s\s+premium\b/i },
  // A line that starts with VAT is the VAT; "Legal fees £850 + VAT £170"
  // starts with the fee and is split below.
  { field: 'legal_vat', category: 'legal_vat', confidence: 0.75,
    re: /^(?:add\s+|plus\s+)?VAT\b/i },
  { field: 'legal_fee', category: 'legal_fee', confidence: 0.9,
    re: /\b(?:legal|conveyancing|professional|our|solicitors?'?s?'?)\s+(?:fees?|costs?|charges?)\b|\bconveyancing\b|\blegal\s+work\b/i },
  { field: 'disbursements', category: 'disbursements', confidence: 0.75,
    re: /\bdisbursements?\b|\b(?:bank|telegraphic|electronic|CHAPS|TT)\s+(?:transfer\s+)?fee\b|\bID\s+(?:check|verification)\b|\bAML\b|\banti[-\s]money\b|\blawyer\s*checker\b|\bfile\s+(?:opening|closing)\b/i },
]

// Fields that can appear only once on a statement; a second, different
// amount lowers confidence and is kept as an alternative, never summed.
const SINGLE_FIELDS = new Set(['purchase_price', 'sdlt', 'total', 'balance_due', 'agreed_price', 'asking_price'])

function legalFeeSplit(line, tokens, page, label) {
  // "Legal fees £850.00 plus VAT £170.00 [£1,020.00]" -> fee and VAT.
  const vatAt = line.search(/\bVAT\b/i)
  if (vatAt < 0 || tokens.length < 2) return null
  const before = tokens.filter(t => t.index < vatAt)
  const after = tokens.filter(t => t.index > vatAt)
  if (!before.length || !after.length) return null
  const fee = before[before.length - 1]
  const vat = after[0]
  // A VAT rate written as an amount ("VAT 20.00 %") is caught by moneyTokens;
  // here, sanity-check VAT against 20% of the fee within 50p.
  const quote = quoteOf(line)
  const plausible = Math.abs(fee.value * 0.2 - vat.value) <= 0.5
  return [
    { field: 'legal_fee', category: 'legal_fee', value_number: round2(fee.value), page, quote, label,
      confidence: plausible ? 0.9 : 0.7 },
    { field: 'legal_vat', category: 'legal_vat', value_number: round2(vat.value), page, quote, label: 'VAT on ' + label,
      confidence: plausible ? 0.9 : 0.6 },
  ]
}

function matchRule(label, rules) {
  for (const r of rules) if (r.re.test(label)) return r
  return null
}

/**
 * Parse a UK completion statement.
 * Returns { suggestions, validation }. Each suggestion is
 * { field, category, value_number, page, quote, confidence, label }.
 */
export function parseCompletionStatement(input) {
  const pages = toPages(input)
  const suggestions = []
  const seenQuotes = new Set()

  pages.forEach((lines, pi) => {
    const page = pi + 1
    for (let li = 0; li < lines.length; li++) {
      let line = lines[li]
      let tokens = moneyTokens(line)
      let label = labelOf(line, tokens)
      // A label on its own line with the amount on the next ("Balance due" /
      // "£16,739.00"): join them.
      if (!tokens.length && label && li + 1 < lines.length) {
        const next = lines[li + 1]
        const nt = moneyTokens(next)
        if (nt.length && !labelOf(next, nt).replace(/[^A-Za-z]/g, '')) {
          line = `${line} ${next.trim()}`
          tokens = moneyTokens(line)
          label = labelOf(line, tokens)
          li++
        }
      }
      if (!tokens.length || !label) continue
      const rule = matchRule(label, COMPLETION_RULES)
      if (!rule) continue
      const quote = quoteOf(line)
      if (seenQuotes.has(`${page}|${quote}`)) continue
      seenQuotes.add(`${page}|${quote}`)

      if (rule.field === 'legal_fee') {
        const split = legalFeeSplit(line, tokens, page, label)
        if (split) { suggestions.push(...split); continue }
      }
      // Two-column statements put debits then credits; a total line with two
      // amounts carries the debit total first. Otherwise take the last amount
      // (the right-hand column).
      const tok = rule.field === 'total' && tokens.length >= 2 ? tokens[0] : tokens[tokens.length - 1]
      let confidence = rule.confidence
      if (!tok.strong) confidence -= 0.1
      if (tokens.length > 2 && rule.field !== 'total') confidence -= 0.1
      const s = {
        field: rule.field, category: rule.category, value_number: round2(Math.abs(tok.value)),
        page, quote, label, confidence: round2(Math.max(0.1, confidence)),
      }
      suggestions.push(s)
    }
  })

  return { suggestions: resolveSingles(suggestions), validation: validateCompletionFigures(suggestions) }
}

// Keep the first of each single-valued field. A later, different amount
// lowers the kept suggestion's confidence and is listed as an alternative.
function resolveSingles(list) {
  const firstIdx = {}
  const out = []
  for (const s of list) {
    if (!SINGLE_FIELDS.has(s.field)) { out.push(s); continue }
    if (firstIdx[s.field] == null) { firstIdx[s.field] = out.length; out.push({ ...s }); continue }
    const kept = out[firstIdx[s.field]]
    if (Math.abs(kept.value_number - s.value_number) > 0.005) {
      kept.confidence = round2(Math.max(0.1, kept.confidence - 0.25))
      kept.alternatives = [...(kept.alternatives || []), { value_number: s.value_number, page: s.page, quote: s.quote }]
    }
  }
  return out
}

const isNum = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v))

/**
 * Check total - credits = balance due within £1. Works on any list of
 * { field, value_number, status? } so the review panel can re-run it on
 * edited values; rejected rows are left out.
 *
 * Returns { status: 'ok' | 'mismatch' | 'incomplete', total, credits,
 *   balanceDue, expectedBalance, difference, itemsTotal, itemsDifference,
 *   message }.
 */
export function validateCompletionFigures(list, tolerance = BALANCE_TOLERANCE) {
  const rows = (list || []).filter(r => r && r.status !== 'rejected' && isNum(r.value_number))
  const first = f => { const r = rows.find(x => x.field === f); return r ? Number(r.value_number) : null }
  const sum = pred => round2(rows.filter(pred).reduce((a, r) => a + Number(r.value_number), 0))
  const total = first('total')
  const balanceDue = first('balance_due')
  const hasCredits = rows.some(r => CREDIT_FIELDS.has(r.field))
  const credits = sum(r => CREDIT_FIELDS.has(r.field))
  const itemRows = rows.filter(r => !CHECK_FIELDS.includes(r.field) && r.field !== 'agreed_price' && !CREDIT_FIELDS.has(r.field))
  const itemsTotal = itemRows.length ? sum(r => itemRows.includes(r)) : null
  const itemsDifference = itemsTotal != null && total != null ? round2(itemsTotal - total) : null

  const base = { total, credits: hasCredits ? credits : null, balanceDue, itemsTotal, itemsDifference }
  if (total == null || balanceDue == null) {
    const missing = [total == null && 'total', balanceDue == null && 'balance due'].filter(Boolean).join(' and ')
    return { ...base, status: 'incomplete', expectedBalance: null, difference: null,
      message: `Could not check the balance: no ${missing} found.` }
  }
  const expectedBalance = round2(total - credits)
  const difference = round2(balanceDue - expectedBalance)
  if (Math.abs(difference) <= tolerance) {
    return { ...base, status: 'ok', expectedBalance, difference,
      message: `Total ${gbp(total)} less credits ${gbp(credits)} = ${gbp(expectedBalance)}, which matches the balance due ${gbp(balanceDue)}.` }
  }
  return { ...base, status: 'mismatch', expectedBalance, difference,
    message: `Mismatch: total ${gbp(total)} less credits ${gbp(credits)} = ${gbp(expectedBalance)}, but the statement says the balance due is ${gbp(balanceDue)} (difference ${gbp(Math.abs(difference))}).` }
}

function gbp(n) {
  const v = Number(n) || 0
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}

// ── Offer letters and brochures ──────────────────────────────────────────────

const ASKING_RE = /\b(?:asking|guide|advertised|marketed|listing|listed|list)\s+price\b|\bguide\b|\boffers?\s+(?:in\s+excess\s+of|over|in\s+the\s+region\s+of|around)\b|\bO\.?I\.?E\.?O\.?\b|\bO\.?I\.?R\.?O\.?\b|\bO\.?N\.?O\.?\b|\bstarting\s+bid\b|\breserve\b|^price\b/i
const AGREED_RE = /\bagreed\b|\baccepted\b|\bsale\s+agreed\b|\b(?:our|your|an?)\s+offer\s+(?:of|at|for)\b|\boffer\s+(?:price|amount)\b|\bpurchase\s+price\b|\bwe\s+(?:are\s+pleased\s+to\s+)?(?:confirm|accept)\b/i

/**
 * Parse an offer letter, memorandum of sale or brochure. Returns
 * { suggestions, validation } where the suggestions are agreed_price
 * (category purchase_price) and asking_price (no category: reference only).
 */
export function parseOfferLetter(input) {
  const pages = toPages(input)
  const suggestions = []
  pages.forEach((lines, pi) => {
    const page = pi + 1
    for (const line of lines) {
      const tokens = moneyTokens(line).filter(t => t.strong && t.value >= 1000)
      if (!tokens.length) continue
      const quote = quoteOf(line)
      const agreedAt = line.search(AGREED_RE)
      const askingAt = line.search(ASKING_RE)
      if (agreedAt < 0 && askingAt < 0) continue
      // The amount after each keyword belongs to that keyword.
      const after = at => tokens.find(t => t.index > at) || null
      const push = (field, tok, confidence) => tok && suggestions.push({
        field, category: field === 'agreed_price' ? 'purchase_price' : null,
        value_number: round2(tok.value), page, quote, label: FIELD_LABEL[field], confidence,
      })
      if (agreedAt >= 0 && askingAt >= 0) {
        const a = after(agreedAt), b = after(askingAt)
        if (a && b && a !== b) { push('agreed_price', a, 0.8); push('asking_price', b, 0.8) }
        else push('asking_price', b || a, 0.6) // ambiguous: never call it agreed
        continue
      }
      if (agreedAt >= 0) {
        const explicit = /\bagreed\b|\baccepted\b/i.test(line)
        push('agreed_price', after(agreedAt) || tokens[tokens.length - 1], explicit ? 0.9 : 0.7)
      } else {
        push('asking_price', after(askingAt) || tokens[tokens.length - 1], 0.85)
      }
    }
  })
  const out = resolveSingles(suggestions)
  return { suggestions: out, validation: validateOfferFigures(out) }
}

/** Agreed versus asking. Never infers an agreed price from the asking one. */
export function validateOfferFigures(list) {
  const rows = (list || []).filter(r => r && r.status !== 'rejected' && isNum(r.value_number))
  const agreed = rows.find(r => r.field === 'agreed_price')
  const asking = rows.find(r => r.field === 'asking_price')
  const a = agreed ? Number(agreed.value_number) : null
  const k = asking ? Number(asking.value_number) : null
  if (a == null) {
    return { status: 'no_agreed', agreed: null, asking: k, difference: null,
      message: k != null
        ? `No agreed price found. The advertised price ${gbp(k)} is not the agreed price and is not used as one.`
        : 'No agreed or asking price found.' }
  }
  const difference = k != null ? round2(a - k) : null
  const msg = k == null ? `Agreed price ${gbp(a)}.`
    : difference === 0 ? `Agreed price ${gbp(a)}, the same as the asking price.`
    : `Agreed price ${gbp(a)}, ${gbp(Math.abs(difference))} ${difference < 0 ? 'below' : 'above'} the asking price ${gbp(k)}.`
  return { status: 'ok', agreed: a, asking: k, difference, message: msg }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** 'completion_statement' | 'offer' | 'unknown', from the wording. */
export function detectDealDocumentType(input) {
  const text = toPages(input).flat().join('\n')
  if (/completion\s+statement|statement\s+of\s+(?:account|completion)|\bbalance\s+(?:due|required)\b|required\s+to\s+complete/i.test(text)) return 'completion_statement'
  if (/\boffer\b|sale\s+agreed|memorandum\s+of\s+sale|asking\s+price|guide\s+price|\bO\.?I\.?E\.?O\b|offers\s+(?:over|in\s+excess)/i.test(text)) return 'offer'
  return 'unknown'
}

/**
 * Suggestions for any deal document. Returns { docType, hasText,
 * suggestions, validation }. A document with no text layer returns no
 * suggestions and hasText false: the figures must be entered by hand.
 */
export function extractDealDocumentFields(input) {
  if (!hasTextLayer(input)) return { docType: 'unknown', hasText: false, suggestions: [], validation: null }
  const docType = detectDealDocumentType(input)
  if (docType === 'offer') return { docType, hasText: true, ...parseOfferLetter(input) }
  const res = parseCompletionStatement(input)
  if (docType === 'completion_statement') return { docType, hasText: true, ...res }
  // Wording did not say which: take whichever reading finds more.
  const offer = parseOfferLetter(input)
  if (offer.suggestions.length > res.suggestions.length) return { docType: 'offer', hasText: true, ...offer }
  return { docType: res.suggestions.length ? 'completion_statement' : 'unknown', hasText: true, ...res }
}

/** Re-run the right validation on (edited) rows. */
export function validateFor(docType, rows) {
  if (rows.some(r => r.field === 'agreed_price' || r.field === 'asking_price')
    && !rows.some(r => r.field === 'total' || r.field === 'balance_due')) return validateOfferFigures(rows)
  return docType === 'offer' ? validateOfferFigures(rows) : validateCompletionFigures(rows)
}
