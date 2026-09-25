// Statement import writes (PNE / RMS -> Rent Tracker).
//
// The review and the plan are pure (lib/statementImport.js). This module
// only reads the context the review needs and carries out an approved plan:
//   import batch -> new rent periods -> receipts + allocations -> period
//   status/amount -> agent fees and deductions -> audit record
// Every row written carries the batch id, so Data import -> History ->
// Revert undoes the whole statement. Nothing is ever deleted or reshaped
// here; an existing period only has its status/amount moved on, and its
// previous values are captured for the revert.
//
// Export names must stay unique across src/lib/api (index.js uses export *).
import { supabase } from '../supabase'
import { createReceipt } from './tenancies'
import { validateUpload } from './_monolith'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const chunk = (xs, n = 150) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

// What is already recorded for these properties: every statement source_ref
// on receipts and expenses (exact duplicates) and agent fees near the
// statement date (fees imported before references existed).
export async function fetchStatementImportContext(propertyIds, statementDate) {
  const ids = [...new Set((propertyIds || []).filter(Boolean))]
  const knownRefs = new Set()
  const existingFees = []
  if (!ids.length) return { knownRefs, existingFees }
  const from = statementDate ? new Date(new Date(statementDate).getTime() - 60 * 86400000).toISOString().slice(0, 10) : null
  const to = statementDate ? new Date(new Date(statementDate).getTime() + 60 * 86400000).toISOString().slice(0, 10) : null
  for (const part of chunk(ids)) {
    const [rec, exp, rows] = await Promise.all([
      supabase.from('rent_receipts').select('source_ref').in('property_id', part).not('source_ref', 'is', null).limit(5000),
      (() => {
        let q = supabase.from('property_expenses').select('property_id, amount, date, source_ref, category').in('property_id', part).is('deleted_at', null)
        if (from) q = q.gte('date', from).lte('date', to)
        return q.limit(5000)
      })(),
      // The previous importer stamped its reference on the rent period too.
      supabase.from('rent_payments').select('source_ref').in('property_id', part).not('source_ref', 'is', null).limit(5000),
    ])
    if (rec.error) throw rec.error
    if (exp.error) throw exp.error
    if (rows.error) throw rows.error
    for (const r of rec.data || []) knownRefs.add(r.source_ref)
    for (const r of rows.data || []) knownRefs.add(r.source_ref)
    for (const e of exp.data || []) {
      if (e.source_ref) knownRefs.add(e.source_ref)
      if (e.category === 'agent_fees') existingFees.push(e)
    }
  }
  return { knownRefs, existingFees }
}

// Earlier imports of the same statement: same agent + number / reference,
// or the same content fingerprint.
export async function findPreviousStatementImports({ agent, statementRef, fingerprint }) {
  const hits = []
  if (fingerprint) {
    const { data, error } = await supabase.from('statement_imports').select('id, created_at, statement_ref, statement_date, agent, filename, import_batch_id, summary').eq('fingerprint', fingerprint).limit(5)
    if (error && !/statement_imports|schema cache|does not exist/i.test(error.message)) throw error
    hits.push(...(data || []))
  }
  if (agent && statementRef) {
    const { data, error } = await supabase.from('statement_imports').select('id, created_at, statement_ref, statement_date, agent, filename, import_batch_id, summary').eq('agent', agent).eq('statement_ref', String(statementRef)).limit(5)
    if (error && !/statement_imports|schema cache|does not exist/i.test(error.message)) throw error
    for (const d of data || []) if (!hits.some(h => h.id === d.id)) hits.push(d)
  }
  // Imports made by the previous importer have no statement_imports row but
  // label their receipts "<agent> statement <ref>" (" (payment n of m)" on
  // split lines).
  if (agent && statementRef) {
    const label = `${agent} statement ${statementRef}`
    const { data } = await supabase.from('rent_receipts').select('created_at, import_batch_id, reference')
      .or(`reference.eq."${label}",reference.like."${label} (%"`).order('created_at').limit(1)
    for (const d of data || []) if (!hits.some(h => h.import_batch_id && h.import_batch_id === d.import_batch_id)) {
      hits.push({ id: `legacy:${d.import_batch_id || d.created_at}`, created_at: d.created_at, statement_ref: String(statementRef), agent, filename: null, import_batch_id: d.import_batch_id, legacy: true })
    }
  }
  if (!hits.length) return []
  const { data: batches } = await supabase.from('import_batches').select('id, reverted_at').in('id', hits.map(h => h.import_batch_id).filter(Boolean))
  const reverted = new Set((batches || []).filter(b => b.reverted_at).map(b => b.id))
  return hits.filter(h => !reverted.has(h.import_batch_id))
}

export async function uploadStatementPdf(companyId, file) {
  validateUpload(file)
  const userId = await uid()
  const safe = String(file.name || 'statement.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `companies/${userId}/statements/${companyId}/${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, { contentType: file.type || 'application/pdf' })
  if (upErr) throw upErr
  const { data, error } = await supabase.from('company_documents').insert({
    company_id: companyId, user_id: userId, name: file.name, file_path: path,
    size: file.size, type: file.type || 'application/pdf', category: 'statement',
  }).select().single()
  if (error) throw error
  return data
}

export async function fetchStatementImports(limit = 50) {
  const { data, error } = await supabase.from('statement_imports')
    .select('id, created_at, agent, statement_ref, statement_date, filename, company_id, import_batch_id, company_document_id, property_document_id, summary, user_id')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// Carry out an approved plan. Returns counts and any per-line problems; one
// failing line never stops the others, and the batch still reverts cleanly.
export async function commitStatementImport({ plan, header, companyId, filename, fingerprint, balance, auditLines, companyDocumentId = null, propertyDocumentId = null }) {
  const me = await uid()
  const res = { receipts: 0, bridges: 0, periodsCreated: 0, periodsUpdated: 0, expenses: 0, skipped: 0, errors: [], batchId: null, importId: null }
  const stmtName = `${header.agent || 'Agent'} statement ${header.statementRef || header.statementDate || ''}`.trim()

  const { data: batch, error: bErr } = await supabase.from('import_batches').insert({
    user_id: me, company_id: companyId || null, kind: 'mixed', source: 'statement', filename: filename || null,
    notes: `${stmtName}. Receipts, new rent periods, period status and fees all revert with this batch.`,
  }).select().single()
  if (bErr) throw bErr
  res.batchId = batch.id
  const undo = []

  // 1. New rent periods (only where no period covered the statement dates).
  const idFor = new Map()
  for (const p of plan.newPeriods) {
    const { data, error } = await supabase.from('rent_payments').insert({
      property_id: p.property_id, user_id: me, year: p.year, month: p.month, month_label: p.month_label,
      period_start: p.period_start, period_end: p.period_end, status: 'void', amount: null, import_batch_id: batch.id,
    }).select('id').single()
    if (error) {
      // Another row with these exact bounds appeared meanwhile: use it.
      if (error.code === '23505') {
        const { data: ex } = await supabase.from('rent_payments').select('id').eq('property_id', p.property_id).eq('period_start', p.period_start).eq('period_end', p.period_end).maybeSingle()
        if (ex) { idFor.set(p.key, ex.id); continue }
      }
      res.errors.push(`Could not create the rent period ${p.period_start} to ${p.period_end}: ${error.message}`)
      continue
    }
    idFor.set(p.key, data.id); res.periodsCreated++
  }
  for (const u of plan.periodUpdates) if (u.rent_payment_id) idFor.set(u.periodKey, u.rent_payment_id)

  // 2. Keep hand-entered amounts as their own receipt before adding more.
  for (const b of plan.bridges) {
    try {
      await createReceipt({ ...b.receipt, import_batch_id: batch.id, reference: `Kept from manual entry (${stmtName})` }, [{ target: 'current_rent', rent_payment_id: b.rent_payment_id, amount: b.receipt.amount }])
      res.bridges++
    } catch (e) { res.errors.push(`Could not keep the hand-entered amount on a period: ${e.message}`) }
  }

  // 3. Receipts + allocations.
  const failedKeys = new Set()
  for (const r of plan.receipts) {
    const rowId = r.periodKey ? idFor.get(r.periodKey) : null
    if (r.periodKey && !rowId) { res.errors.push(`${r.receipt.notes || 'Rent line'}: no rent period to allocate to`); failedKeys.add(r.periodKey); continue }
    try {
      await createReceipt({ ...r.receipt, import_batch_id: batch.id }, [{ ...r.allocation, rent_payment_id: rowId || null, tenancy_id: r.receipt.tenancy_id || null }])
      res.receipts++
    } catch (e) {
      if (/already been recorded|duplicate key|uq_rent_receipts_source_ref/i.test(e.message || '')) { res.skipped++; continue }
      res.errors.push(`Receipt of £${Number(r.receipt.amount).toFixed(2)}: ${e.message}`)
      if (r.periodKey) failedKeys.add(r.periodKey)
    }
  }

  // 4. Period status/amount, from what actually landed.
  for (const u of plan.periodUpdates) {
    const id = idFor.get(u.periodKey)
    if (!id) continue
    const { data: allocs, error: aErr } = await supabase.from('rent_allocations').select('amount').eq('rent_payment_id', id).eq('target', 'current_rent')
    if (aErr) { res.errors.push(`Could not read receipts for a period: ${aErr.message}`); continue }
    const total = Math.round((allocs || []).reduce((s, a) => s + Number(a.amount), 0) * 100) / 100
    const status = failedKeys.has(u.periodKey) && total <= 0 ? null : (u.status === 'paid' && total + 0.005 < u.amount ? 'partial' : u.status)
    if (!status) continue
    if (u.previous) undo.push({ table: 'rent_payments', id, status: u.previous.status, amount: u.previous.amount, source_ref: u.previous.source_ref, import_batch_id: u.previous.import_batch_id })
    const { error } = await supabase.from('rent_payments').update({ status, amount: total, import_batch_id: batch.id }).eq('id', id)
    if (error) res.errors.push(`Could not update a rent period: ${error.message}`)
    else if (u.previous) res.periodsUpdated++
  }

  // 5. Fees, deductions, credits.
  for (const e of plan.expenses) {
    const { error } = await supabase.from('property_expenses').insert({ ...e, user_id: me, import_batch_id: batch.id })
    if (error) {
      if (error.code === '23505') { res.skipped++; continue }
      res.errors.push(`${e.description}: ${error.message}`)
      continue
    }
    res.expenses++
  }

  await supabase.from('import_batches').update({
    rows_created: res.receipts + res.periodsCreated + res.expenses, rows_updated: res.periodsUpdated, rows_skipped: res.skipped,
    meta: { undo, failed_count: res.errors.length, statement: stmtName },
  }).eq('id', batch.id)

  // 6. Audit record (best effort: the money is already recorded).
  const { data: rec, error: iErr } = await supabase.from('statement_imports').insert({
    import_batch_id: batch.id, user_id: me, company_id: companyId || null, agent: header.agent || null,
    statement_ref: header.statementRef ? String(header.statementRef) : null, statement_date: header.statementDate || null,
    period_start: header.periodStart || null, period_end: header.periodEnd || null, landlord_on_statement: header.landlordCompany || null,
    fingerprint: fingerprint || null, filename: filename || null, company_document_id: companyDocumentId, property_document_id: propertyDocumentId,
    header, balance: balance || null, lines: auditLines || [], summary: { ...res, errors: res.errors.slice(0, 50) },
  }).select('id').single()
  if (iErr) res.errors.push(`The import is saved but its audit record could not be written: ${iErr.message}`)
  else res.importId = rec.id
  return res
}
