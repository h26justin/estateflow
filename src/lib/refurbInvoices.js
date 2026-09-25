// Refurb invoices: one contractor invoice (or credit note) allocated across
// one or many properties' refurb projects.
//
// Pure functions, no React, no Supabase. The rules Justin set on 25 Sep 2026:
//   • an invoice recognises and allocates a COST; it never counts as paid.
//     Only payment lines (refurb_lines kind 'payment', less 'credit') move
//     Paid, and they are logged separately against the invoice.
//   • Agreed and Paid on the Refurbs dashboard are unchanged by an invoice;
//     a separate Invoiced figure sits beside them. An allocation ticked as a
//     variation also writes an 'extra' line, which is what raises Agreed.
//   • the allocation must reconcile to the invoice total before it can be
//     saved (the database re-checks it in create_refurb_invoice).
//
// Money is handled in whole pence internally so splits always add up.

export const DOC_KINDS = Object.freeze([
  { v: 'invoice', l: 'Invoice' },
  { v: 'credit_note', l: 'Credit note / refund' },
])

// Approval is a manual workflow; payment status is derived from payments.
export const APPROVAL_STATUSES = Object.freeze([
  { v: 'received', l: 'Received' },
  { v: 'awaiting_approval', l: 'Awaiting approval' },
  { v: 'approved', l: 'Approved' },
])

export const INVOICE_STATUS_LABEL = Object.freeze({
  received: 'Received', awaiting_approval: 'Awaiting approval', approved: 'Approved',
  part_paid: 'Part paid', paid: 'Paid', credit: 'Credit / refunded',
})

const toP = n => Math.round((Number(n) || 0) * 100)
const fromP = p => p / 100
export const round2 = n => fromP(toP(n))

// The amount an invoice is allocated on: gross when VAT is a cost to the
// company (not VAT registered, e.g. ExH), net when VAT is reclaimable.
export function allocationBase(inv) {
  if (!inv) return 0
  if (inv.allocation_basis === 'net' && inv.net_amount != null && inv.net_amount !== '') return round2(inv.net_amount)
  return round2(inv.gross_amount)
}

// Equal split of `total` across n rows, exact to the penny: the odd pennies
// go to the first rows so the parts always add back to the total.
export function evenSplit(total, n) {
  if (!(n > 0)) return []
  const tp = toP(total)
  const base = Math.trunc(tp / n)
  let rem = tp - base * n
  const out = []
  for (let i = 0; i < n; i++) {
    let p = base
    if (rem > 0) { p++; rem-- } else if (rem < 0) { p--; rem++ }
    out.push(fromP(p))
  }
  return out
}

// Amounts from percentages. The last row absorbs rounding so the amounts
// add up to `total` whenever the percentages add up to 100.
export function percentSplit(total, pcts) {
  const tp = toP(total)
  const list = (pcts || []).map(x => Number(x) || 0)
  const sumPct = list.reduce((s, x) => s + x, 0)
  const out = list.map(p => Math.round(tp * p / 100))
  if (out.length && Math.abs(sumPct - 100) < 0.0001) {
    const diff = tp - out.reduce((s, x) => s + x, 0)
    out[out.length - 1] += diff
  }
  return out.map(fromP)
}

// Live reconciliation: INVOICE TOTAL / ALLOCATED / REMAINING.
export function reconcile(total, amounts) {
  const tp = toP(total)
  const ap = (amounts || []).reduce((s, a) => s + toP(a), 0)
  return { total: fromP(tp), allocated: fromP(ap), remaining: fromP(tp - ap), ok: tp > 0 && tp === ap }
}

// Every problem that must stop the save, in plain words. Empty = ready.
export function allocationProblems(inv, rows) {
  const out = []
  if (!String(inv?.supplier_name || '').trim()) out.push('Enter the supplier')
  if (!(Number(inv?.gross_amount) > 0)) out.push('Enter the invoice gross amount')
  const net = inv?.net_amount, vat = inv?.vat_amount
  if (net !== '' && net != null && vat !== '' && vat != null && Math.abs(toP(net) + toP(vat) - toP(inv.gross_amount)) > 1) {
    out.push('Net plus VAT does not equal the gross amount')
  }
  if (inv?.allocation_basis === 'net' && !(Number(net) > 0)) out.push('Enter the net amount to allocate on net')
  if (!rows?.length) out.push('Select at least one property')
  if ((rows || []).some(r => !r.project_id && !r.create_project)) out.push('Every property needs a refurb to allocate to')
  if ((rows || []).some(r => Number(r.amount) < 0)) out.push('Allocations cannot be negative')
  const rec = reconcile(allocationBase(inv), (rows || []).map(r => r.amount))
  if (!rec.ok) out.push(rec.remaining > 0 ? `£${rec.remaining.toFixed(2)} still to allocate` : `Over-allocated by £${(-rec.remaining).toFixed(2)}`)
  return out
}

// Normalised duplicate key: supplier + invoice number, case and spacing
// insensitive, punctuation in the number ignored ("INV-0022" = "inv 0022").
export const normSupplier = s => String(s || '').toLowerCase().replace(/\b(ltd|limited|llp|plc)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const normInvoiceNo = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function findDuplicate(inv, existing) {
  const s = normSupplier(inv?.supplier_name), n = normInvoiceNo(inv?.invoice_number)
  if (!s || !n) return null
  return (existing || []).find(e => !e.deleted_at && e.id !== inv?.id && normSupplier(e.supplier_name) === s && normInvoiceNo(e.invoice_number) === n) || null
}

// Money actually paid against an invoice: payment lines linked to it, less
// credit lines (refunds) linked to it. `lines` = every refurb_lines row.
export function paidAgainst(invoiceId, lines) {
  let p = 0
  for (const l of lines || []) {
    if (l.deleted_at || l.invoice_id !== invoiceId) continue
    if (l.kind === 'payment') p += toP(l.amount)
    else if (l.kind === 'credit') p -= toP(l.amount)
  }
  return fromP(p)
}

// Display status. Credit notes are "Credit / refunded"; otherwise money paid
// decides Part paid / Paid, and before any payment the approval step shows.
export function invoiceStatus(inv, lines) {
  if (!inv) return 'received'
  if (inv.doc_kind === 'credit_note') return 'credit'
  const paid = paidAgainst(inv.id, lines)
  const due = allocationBase(inv)
  if (paid > 0 && toP(paid) >= toP(due)) return 'paid'
  if (paid > 0) return 'part_paid'
  return inv.approval_status || 'received'
}

export function outstandingOn(inv, lines) {
  if (!inv || inv.doc_kind === 'credit_note') return 0
  return round2(Math.max(0, allocationBase(inv) - paidAgainst(inv.id, lines)))
}

// Split one payment across the invoice's allocations in proportion to what
// each was allocated, exact to the penny (largest remainder).
export function splitPayment(amount, allocations) {
  const rows = (allocations || []).filter(a => toP(a.amount) > 0)
  const total = rows.reduce((s, a) => s + toP(a.amount), 0)
  if (!rows.length || !total) return []
  const ap = toP(amount)
  const raw = rows.map(a => ap * toP(a.amount) / total)
  const out = raw.map(Math.floor)
  let rem = ap - out.reduce((s, x) => s + x, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k][1]]++
  return rows.map((a, i) => ({ project_id: a.project_id, property_id: a.property_id, allocation_id: a.id, amount: fromP(out[i]) }))
}

// Invoiced per project: allocations of live invoices, credit notes negative.
export function invoicedByProject(invoices) {
  const out = new Map()
  for (const inv of invoices || []) {
    if (inv.deleted_at) continue
    const sign = inv.doc_kind === 'credit_note' ? -1 : 1
    for (const a of inv.refurb_invoice_allocations || []) {
      out.set(a.project_id, round2((out.get(a.project_id) || 0) + sign * (Number(a.amount) || 0)))
    }
  }
  return out
}

// Invoices touching a project, newest first, with that project's share.
export function invoicesForProject(projectId, invoices) {
  return (invoices || [])
    .filter(inv => !inv.deleted_at && (inv.refurb_invoice_allocations || []).some(a => a.project_id === projectId))
    .map(inv => ({ invoice: inv, allocated: round2((inv.refurb_invoice_allocations || []).filter(a => a.project_id === projectId).reduce((s, a) => s + (Number(a.amount) || 0), 0)) }))
    .sort((a, b) => String(b.invoice.invoice_date || '').localeCompare(String(a.invoice.invoice_date || '')))
}

// The refurb an invoice line should land on for a property: its live,
// not-complete project (latest started), else its latest live project.
export function defaultProjectFor(property) {
  const live = (property?.refurb_projects || []).filter(p => !p.deleted_at)
  const open = live.filter(p => p.stage !== 'complete')
  const pick = list => [...list].sort((a, b) => String(b.start_date || b.created_at || '').localeCompare(String(a.start_date || a.created_at || '')))[0]
  return pick(open) || pick(live) || null
}

// ── Reading an invoice PDF's text ───────────────────────────────────────────
// Best effort on text PDFs (Xero, QuickBooks, Word exports). Nothing here is
// trusted: every field lands in an editable form for the user to confirm.
const MONEY = /£?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})/
const moneyAfter = (text, re, not = null) => {
  for (const line of text.split('\n')) {
    if (!re.test(line) || (not && not.test(line))) continue
    const all = [...line.matchAll(new RegExp(MONEY.source, 'g'))].map(m => Number(m[1].replace(/,/g, '')))
    if (all.length) return all[all.length - 1]
  }
  return null
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
export function parseDate(s) {
  if (!s) return null
  let m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = String(s).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return iso(y, Number(m[2]), Number(m[1])) }
  m = String(s).match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) return iso(Number(m[3]), mo, Number(m[1]))
  }
  return null
}
function iso(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const DATE_ANY = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/
function dateAfter(text, re) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    const after = lines[i].split(re).slice(1).join(' ')
    const m = after.match(DATE_ANY) || lines[i].match(DATE_ANY) || (lines[i + 1] || '').match(DATE_ANY)
    if (m) { const d = parseDate(m[1]); if (d) return d }
  }
  return null
}

export function extractInvoiceFields(text) {
  const t = String(text || '').replace(/\r/g, '')
  const out = { supplier_name: null, invoice_number: null, invoice_date: null, due_date: null, description: null, net_amount: null, vat_amount: null, gross_amount: null, doc_kind: 'invoice', company_hint: null }
  if (!t.trim()) return out
  if (/credit\s*note/i.test(t)) out.doc_kind = 'credit_note'
  const num = t.match(/(?:invoice|credit\s*note|inv)\s*(?:no\.?|number|#|num|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{1,24})/i)
    || t.match(/\b(INV[-/ ]?\d{2,}[A-Z0-9-]*)\b/i)
  if (num) out.invoice_number = num[1].trim()
  out.invoice_date = dateAfter(t, /(?:invoice|tax\s*point|issue)\s*date|date\s*of\s*issue|^\s*date\b/im)
  out.due_date = dateAfter(t, /(?:due\s*date|payment\s*due|due\s*by|pay\s*by)/i)
  out.gross_amount = moneyAfter(t, /(?:total\s*(?:gbp|due|amount|inc|payable)|amount\s*due|balance\s*due|invoice\s*total|grand\s*total|^\s*total\b)/im, /\bvat\b|sub\s*-?\s*total|\bnet\b|\bex(?:cl)?\b/i)
  out.vat_amount = moneyAfter(t, /(?:total\s*vat|vat\s*(?:@|at)?\s*\d{1,2}(?:\.\d+)?\s*%|\bvat\b(?!\s*(?:no|number|reg)))/i)
  out.net_amount = moneyAfter(t, /(?:sub\s*-?\s*total|net\s*(?:total|amount)?|total\s*(?:ex|excl|net))/i)
  if (out.gross_amount == null && out.net_amount != null) out.gross_amount = round2(out.net_amount + (out.vat_amount || 0))
  if (out.net_amount == null && out.gross_amount != null && out.vat_amount != null) out.net_amount = round2(out.gross_amount - out.vat_amount)
  if (out.vat_amount == null && out.gross_amount != null && out.net_amount != null) out.vat_amount = round2(out.gross_amount - out.net_amount)
  // Supplier: the first line that looks like a business name, before the
  // "Invoice" heading, skipping addresses and boilerplate.
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
  const skip = /^(tax\s*)?invoice\b|credit\s*note|^page\b|^date\b|^to\b|^bill\s*to|^invoice\s*to|^\d|@|www\.|tel|phone|vat\s*(reg|no)|company\s*(no|reg)/i
  const sup = lines.slice(0, 12).find(l => !skip.test(l) && /[A-Za-z]{3}/.test(l) && l.length <= 60)
  if (sup) out.supplier_name = sup.replace(/\s{2,}.*/, '')
  const billTo = t.match(/(?:invoice\s*to|bill\s*to|to)\s*:?\s*\n?\s*([^\n]{3,60})/i)
  if (billTo) out.company_hint = billTo[1].trim()
  const desc = t.match(/(?:description|details|works?)\s*:?\s*\n?\s*([^\n]{6,140})/i)
  if (desc) out.description = desc[1].replace(/\s{2,}\S+$/, '').trim()
  return out
}
