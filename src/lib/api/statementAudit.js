// Rental Statement Audit - data access.
//
// Standalone register for auditing managing-agent rental statements and
// reconciling them with the bank. Nothing here touches properties,
// tenancies, rent_payments, receipts or expenses; see the
// 2026-09-09_statement_audit migration and src/lib/statementAudit.js.

import { supabase } from '../supabase'
import { lineKey, looseKey, seriesKeyFor } from '../statementAudit'

const PAGE = 1000

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return user.id
}

// PostgREST caps a response at 1000 rows and says nothing about it. Every
// list here pages explicitly so a long run of statements never silently
// loses lines (the historic-data importer was bitten by exactly this).
async function fetchAll(buildQuery) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

// ── Series ──────────────────────────────────────────────────────────────────
export async function fetchAuditSeries() {
  return fetchAll(() => supabase.from('statement_audit_series').select('*').order('landlord_company'))
}

export async function upsertAuditSeries({ series_key, landlord_company, landlord_name = null, agent = null, start_number = 71 }) {
  const user_id = await currentUserId()
  const key = series_key || seriesKeyFor(landlord_company)
  const { data, error } = await supabase.from('statement_audit_series')
    .upsert({ user_id, series_key: key, landlord_company, landlord_name, agent, start_number, updated_at: new Date().toISOString() }, { onConflict: 'user_id,series_key' })
    .select().single()
  if (error) throw error
  return data
}

export async function updateAuditSeries(id, patch) {
  const { data, error } = await supabase.from('statement_audit_series')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ── Statements ──────────────────────────────────────────────────────────────
export async function fetchAuditStatements(seriesKey) {
  return fetchAll(() => supabase.from('statement_audit_statements')
    .select('id, user_id, series_key, statement_number, statement_date, agent, landlord_name, landlord_company, status, statement_checked, checked_by, checked_at, notes, correction_required, bank_payment_matched, bank_paid_date, bank_paid_amount, file_name, previous_balance, new_balance, payment_amount, stated_income_total, stated_expenditure_total, invoice_number, invoice_date, invoice_fees, import_errors, last_import_summary, imported_at, created_at, updated_at')
    .eq('series_key', seriesKey).order('statement_number'))
}

export async function fetchAuditStatement(id) {
  const { data, error } = await supabase.from('statement_audit_statements').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

// Lines for every statement in a series (totals and counts are computed
// client-side; a year of weekly statements is a few thousand rows at most).
export async function fetchAuditLinesForSeries(seriesKey) {
  const stmts = await fetchAll(() => supabase.from('statement_audit_statements').select('id').eq('series_key', seriesKey))
  const ids = stmts.map(s => s.id)
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    out.push(...await fetchAll(() => supabase.from('statement_audit_lines').select('*').in('statement_id', chunk).order('statement_number').order('line_no')))
  }
  return out
}

export async function fetchAuditLines(statementId) {
  return fetchAll(() => supabase.from('statement_audit_lines').select('*').eq('statement_id', statementId).order('line_no'))
}

export async function updateAuditStatement(id, patch) {
  const { data, error } = await supabase.from('statement_audit_statements')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Placeholder rows for every number in [start, max] that is not on the
// register, so a gap in the sequence is a visible "Not Uploaded" row rather
// than an absence nobody notices. Existing rows are left alone.
export async function ensureAuditPlaceholders(seriesKey, start, max, meta = {}) {
  const user_id = await currentUserId()
  const existing = await fetchAll(() => supabase.from('statement_audit_statements').select('statement_number').eq('series_key', seriesKey))
  const have = new Set(existing.map(r => r.statement_number))
  const rows = []
  for (let n = Number(start); n <= Number(max); n++) {
    if (!have.has(n)) rows.push({ user_id, series_key: seriesKey, statement_number: n, status: 'not_uploaded', agent: meta.agent || null, landlord_company: meta.landlord_company || null, landlord_name: meta.landlord_name || null })
  }
  if (!rows.length) return 0
  const { error } = await supabase.from('statement_audit_statements').upsert(rows, { onConflict: 'user_id,series_key,statement_number', ignoreDuplicates: true })
  if (error) throw error
  return rows.length
}

// Persist an import that the user has reviewed. `statement` carries the
// parsed header; `inserts` are new lines; `corrections` are
// { id, patch } pairs the user explicitly ticked; `confirmIds` are existing
// lines matched as previously imported. Nothing on the register is deleted.
export async function saveAuditImport({ seriesKey, statement, inserts, corrections = [], confirmIds = [], duplicates = [] }) {
  const user_id = await currentUserId()
  const now = new Date().toISOString()
  const header = {
    user_id, series_key: seriesKey, statement_number: statement.statement_number,
    statement_date: statement.statement_date, agent: statement.agent, landlord_name: statement.landlord_name,
    landlord_company: statement.landlord_company, file_name: statement.file_name, raw_text: statement.raw_text,
    previous_balance: statement.previous_balance, new_balance: statement.new_balance, payment_amount: statement.payment_amount,
    stated_income_total: statement.stated_income_total, stated_expenditure_total: statement.stated_expenditure_total,
    invoice_number: statement.invoice_number, invoice_date: statement.invoice_date, invoice_fees: statement.invoice_fees,
    import_errors: statement.import_errors || [], status: 'importing', imported_at: now, updated_at: now,
  }
  const { data: stmt, error: sErr } = await supabase.from('statement_audit_statements')
    .upsert(header, { onConflict: 'user_id,series_key,statement_number' }).select().single()
  if (sErr) throw sErr

  const results = { inserted: 0, corrected: 0, confirmed: 0, duplicates: 0, failed: [] }
  const rows = (inserts || []).map(l => toRow(l, stmt, user_id))
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const { error } = await supabase.from('statement_audit_lines').insert(chunk)
    if (error) {
      // Fall back to one at a time so a single bad row does not sink the rest.
      for (const r of chunk) {
        const { error: e1 } = await supabase.from('statement_audit_lines').insert(r)
        if (e1) results.failed.push({ line_no: r.line_no, property_address: r.property_address, tenant_name: r.tenant_name, amount: r.gross_rent || r.fee_amount || r.deduction_amount || r.credit_amount, reason: e1.message, raw_text: r.raw_text, description: r.description, section: r.section })
        else results.inserted++
      }
    } else results.inserted += chunk.length
  }
  for (const d of duplicates || []) {
    const r = toRow({ ...d, review_status: 'possible_duplicate' }, stmt, user_id)
    const { error } = await supabase.from('statement_audit_lines').insert(r)
    if (error) results.failed.push({ line_no: r.line_no, property_address: r.property_address, tenant_name: r.tenant_name, amount: r.gross_rent || r.fee_amount, reason: error.message, raw_text: r.raw_text, description: r.description, section: r.section })
    else results.duplicates++
  }
  for (const c of corrections) {
    const { error } = await supabase.from('statement_audit_lines').update({ ...c.patch, updated_at: now }).eq('id', c.id)
    if (error) results.failed.push({ line_no: c.line_no, property_address: c.property_address, reason: error.message })
    else results.corrected++
  }
  if (confirmIds.length) {
    const { error } = await supabase.from('statement_audit_lines').update({ review_status: 'previously_imported_checked', updated_at: now }).in('id', confirmIds)
    if (error) results.failed.push({ reason: `Could not mark ${confirmIds.length} lines as checked: ${error.message}` })
    else results.confirmed = confirmIds.length
  }
  if (results.failed.length) {
    const merged = [...(header.import_errors || []), ...results.failed.map(f => ({ ...f, reason: `Database refused the row: ${f.reason}` }))]
    await supabase.from('statement_audit_statements').update({ import_errors: merged }).eq('id', stmt.id)
    stmt.import_errors = merged
  }
  return { statement: stmt, results }
}

export async function finaliseAuditImport(statementId, { status, summary }) {
  return updateAuditStatement(statementId, { status, last_import_summary: summary })
}

// ── Lines ───────────────────────────────────────────────────────────────────
function toRow(l, stmt, user_id) {
  const row = {
    statement_id: stmt.id, user_id, statement_number: stmt.statement_number, statement_date: stmt.statement_date,
    line_no: l.line_no ?? 0, section: l.section || null, line_type: l.line_type,
    property_address: l.property_address || null, tenant_name: l.tenant_name || null,
    period_start: l.period_start || null, period_end: l.period_end || null,
    transaction_date: l.transaction_date || stmt.statement_date || null,
    description: l.description || null,
    gross_rent: num(l.gross_rent), fee_amount: num(l.fee_amount), vat_amount: num(l.vat_amount),
    deduction_amount: num(l.deduction_amount), credit_amount: num(l.credit_amount), net_amount: num(l.net_amount),
    fee_pct: l.fee_pct ?? null, fee_basis: l.fee_basis ?? null,
    review_status: l.review_status || 'imported', flags: l.flags || [], error_reason: l.error_reason || null,
    original_values: l.original_values || null, raw_text: l.raw_text || null,
  }
  row.line_key = lineKey(row)
  return row
}
const num = v => Math.round((Number(v) || 0) * 100) / 100

export async function insertAuditLine(statement, line) {
  const user_id = await currentUserId()
  const { data, error } = await supabase.from('statement_audit_lines').insert(toRow(line, statement, user_id)).select().single()
  if (error) throw error
  return data
}

// Edits keep the first-seen values in original_values so the register can
// always show what the statement said before a hand correction.
export async function updateAuditLine(existing, patch) {
  const snapshot = existing.original_values || Object.fromEntries(
    ['line_type', 'property_address', 'tenant_name', 'period_start', 'period_end', 'transaction_date', 'description', 'gross_rent', 'fee_amount', 'vat_amount', 'deduction_amount', 'credit_amount', 'net_amount', 'fee_pct', 'fee_basis']
      .map(k => [k, existing[k] ?? null]))
  const merged = { ...existing, ...patch }
  const next = { ...patch, original_values: snapshot, updated_at: new Date().toISOString() }
  next.line_key = lineKey(merged)
  const { data, error } = await supabase.from('statement_audit_lines').update(next).eq('id', existing.id).select().single()
  if (error) throw error
  return data
}

export async function deleteAuditLine(id) {
  const { error } = await supabase.from('statement_audit_lines').delete().eq('id', id)
  if (error) throw error
}

// Re-process one failed entry: the corrected line is inserted and the error
// removed from the statement's list, without re-uploading the statement.
export async function resolveAuditImportError(statement, errorIndex, line) {
  const inserted = await insertAuditLine(statement, line)
  const errors = [...(statement.import_errors || [])]
  errors.splice(errorIndex, 1)
  const stmt = await updateAuditStatement(statement.id, { import_errors: errors })
  return { line: inserted, statement: stmt }
}

export { looseKey as auditLooseKey }
