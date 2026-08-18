// Historic rent + expense import — reading the context a plan is built
// against, committing an approved plan, and reversing one afterwards.
//
// The planning itself is pure and lives in src/lib/csvImport.js. This module is
// the only part that writes, and it writes nothing that isn't in a plan the
// user has already seen row by row.
//
// Reversibility is the point of import_batches: a backfill touches years of
// financial history at once, and "undo that load" has to be a single action
// rather than an archaeology exercise. Every row we create is stamped with its
// batch id; reverting deletes exactly the rows this batch created and restores
// the previous values of the rows it updated.

import { supabase } from '../supabase'
import { fetchAllPages } from '../paginate'

const CHUNK = 100

async function currentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return user
}

// Everything already stored for the given properties, in the shape the plan
// builders expect. Fetched once up front so planning is a pure function of
// (file, portfolio, existing) and can be re-run locally as the user edits
// property assignments without re-querying.
//
// MUST be complete. A partial result here does not fail loudly — it makes rows
// whose existing record was not fetched look new, so they plan as 'create'
// instead of 'update'. The unique index then rejects them at commit time and
// they are reported as duplicate-skips, leaving those months with their
// original (often blank) amount. The first version of this had no pagination,
// so PostgREST capped it at its 1000-row default: a portfolio with 4,361 rent
// rows planned 322 updates as creates and would have silently half-imported.
export async function fetchImportContext(propertyIds) {
  const ids = (propertyIds || []).filter(Boolean)
  if (!ids.length) return { payments: [], expenses: [] }

  // Ordered by id so paging is stable: without an ORDER BY, Postgres may return
  // rows in a different order per page and a row could be seen twice or missed.
  const [payments, expenses] = await Promise.all([
    fetchAllPages(() => supabase.from('rent_payments')
      .select('id, property_id, period_start, period_end, status, amount, source_ref')
      .in('property_id', ids)
      .order('id', { ascending: true })),
    fetchAllPages(() => supabase.from('property_expenses')
      .select('id, property_id, date, category, amount, source_ref')
      .in('property_id', ids)
      .is('deleted_at', null)
      .order('id', { ascending: true })),
  ])
  return { payments, expenses }
}

// ── COMMIT ──────────────────────────────────────────────────────────────────
// Commits the create/update rows of an approved plan. Rows marked skip or error
// are ignored here — the UI has already shown why.
//
// A batch row is written FIRST so that if anything fails midway the rows that
// did land are still attributable and reversible. The alternative (stamp at the
// end) leaves orphans on partial failure, which is the worse outcome.
export async function commitImport({ kind, source = 'csv', filename, plan, companyId, notes }) {
  const user = await currentUser()
  const creates = plan.filter(r => r.action === 'create')
  const updates = plan.filter(r => r.action === 'update')
  if (!creates.length && !updates.length) {
    return { batchId: null, created: 0, updated: 0, failed: [], skipped: plan.filter(r => r.action === 'skip').length }
  }

  const { data: batch, error: batchErr } = await supabase.from('import_batches').insert({
    user_id: user.id,
    company_id: companyId || null,
    kind,
    source,
    filename: filename || null,
    notes: notes || null,
  }).select().single()
  if (batchErr) throw batchErr

  const failed = []
  let created = 0, updated = 0

  // ── Updates first, capturing the previous value so a revert can restore it.
  // Done one at a time: there are typically few of them, and a failed update
  // must not take its neighbours down.
  const undo = []
  for (const r of updates) {
    try {
      if (kind === 'rent') {
        const { data: prev, error: readErr } = await supabase.from('rent_payments')
          .select('id, status, amount, source_ref, import_batch_id')
          .eq('id', r.existingId).single()
        if (readErr) throw readErr
        undo.push({ table: 'rent_payments', id: prev.id, status: prev.status, amount: prev.amount, source_ref: prev.source_ref, import_batch_id: prev.import_batch_id })
        const { error } = await supabase.from('rent_payments').update({
          status: r.status,
          amount: r.amount,
          source_ref: r.sourceRef,
          import_batch_id: batch.id,
          ...(r.notes ? { notes: r.notes } : {}),
        }).eq('id', r.existingId)
        if (error) throw error
      } else {
        const { data: prev, error: readErr } = await supabase.from('property_expenses')
          .select('id, amount, category, description, source_ref, import_batch_id')
          .eq('id', r.existingId).single()
        if (readErr) throw readErr
        undo.push({ table: 'property_expenses', id: prev.id, amount: prev.amount, category: prev.category, description: prev.description, source_ref: prev.source_ref, import_batch_id: prev.import_batch_id })
        const { error } = await supabase.from('property_expenses').update({
          amount: r.amount, category: r.category, description: r.description,
          source_ref: r.sourceRef, import_batch_id: batch.id,
        }).eq('id', r.existingId)
        if (error) throw error
      }
      updated++
    } catch (e) {
      failed.push({ line: r.line, label: r.label, message: e.message })
    }
  }

  // ── Creates, chunked. On a chunk failure we retry its rows individually so
  // one bad row costs one row, not ninety-nine good ones. A unique-violation
  // (23505) means the guard caught a duplicate the plan didn't know about —
  // report it as skipped rather than failed, since the data is already there.
  const rows = creates.map(r => kind === 'rent' ? {
    property_id: r.propertyId, user_id: user.id,
    year: +r.period_start.slice(0, 4), month: +r.period_start.slice(5, 7),
    month_label: monthLabel(r.period_start),
    status: r.status, amount: r.amount,
    period_start: r.period_start, period_end: r.period_end,
    notes: r.notes || null,
    source_ref: r.sourceRef, import_batch_id: batch.id,
  } : {
    property_id: r.propertyId, user_id: user.id,
    category: r.category, description: r.description,
    amount: r.amount, date: r.date,
    notes: r.notes || null,
    source_ref: r.sourceRef, import_batch_id: batch.id,
  })
  const table = kind === 'rent' ? 'rent_payments' : 'property_expenses'

  let duplicateSkips = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).insert(chunk)
    if (!error) { created += chunk.length; continue }
    for (let j = 0; j < chunk.length; j++) {
      const { error: rowErr } = await supabase.from(table).insert(chunk[j])
      if (!rowErr) { created++; continue }
      const src = creates[i + j]
      if (rowErr.code === '23505') duplicateSkips++
      else failed.push({ line: src.line, label: src.label, message: rowErr.message })
    }
  }

  const skipped = plan.filter(r => r.action === 'skip').length + duplicateSkips
  await supabase.from('import_batches').update({
    rows_created: created, rows_updated: updated, rows_skipped: skipped,
    meta: { undo, failed_count: failed.length },
  }).eq('id', batch.id)

  return { batchId: batch.id, created, updated, skipped, failed }
}

// ── HISTORY + REVERT ────────────────────────────────────────────────────────

export async function fetchImportBatches(companyId) {
  let q = supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(50)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Undo a batch: delete the rows it created, restore the rows it changed.
//
// Deliberately NOT a cascade. import_batch_id is ON DELETE SET NULL precisely
// so that removing a batch record can never take financial rows with it as a
// side effect — reversal has to be this explicit, checked path.
export async function revertImportBatch(batchId) {
  const user = await currentUser()
  const { data: batch, error } = await supabase.from('import_batches')
    .select('*').eq('id', batchId).single()
  if (error) throw error
  if (batch.reverted_at) throw new Error('This import has already been reverted')

  // Restore updated rows to their captured previous values before deleting the
  // created ones: if the restore fails we have changed nothing irreversibly.
  const undo = Array.isArray(batch.meta?.undo) ? batch.meta.undo : []
  const problems = []
  for (const u of undo) {
    const { table, id, ...fields } = u
    const { error: e } = await supabase.from(table).update(fields).eq('id', id)
    if (e) problems.push(`restore ${table} ${id}: ${e.message}`)
  }
  if (problems.length) {
    throw new Error(`Could not restore previous values, nothing deleted: ${problems.join('; ')}`)
  }

  // Rows this batch CREATED still carry its id; the ones it updated no longer
  // do, because the restore above put their original import_batch_id back.
  const [rent, exp] = await Promise.all([
    supabase.from('rent_payments').delete().eq('import_batch_id', batchId).select('id'),
    supabase.from('property_expenses').delete().eq('import_batch_id', batchId).select('id'),
  ])
  if (rent.error) throw rent.error
  if (exp.error) throw exp.error

  await supabase.from('import_batches').update({
    reverted_at: new Date().toISOString(), reverted_by: user.id,
  }).eq('id', batchId)

  return {
    rentDeleted: (rent.data || []).length,
    expensesDeleted: (exp.data || []).length,
    restored: undo.length,
  }
}

function monthLabel(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7)
  return new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
