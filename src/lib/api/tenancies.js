// Tenancies, non-chargeable periods, rent receipts and allocations.
// Stage 2 of the Rent Tracker rebuild. All tables are additive; see
// supabase-migrations/2026-09-02_rent_tracker_tenancies_receipts.sql.
import { supabase } from '../supabase'
import { tenancyDraftFromProperty, propertyNeedsTenancy } from '../tenancyUtils'

async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id
}

const TENANCY_COLS = '*'
const RECEIPT_COLS = 'id, property_id, tenancy_id, company_id, received_date, amount, kind, reverses_receipt_id, payer, source, source_ref, import_batch_id, reference, notes, review_status, review_reason, created_at, created_by, rent_allocations(id, receipt_id, rent_payment_id, tenancy_id, target, amount, notes)'

// ── Tenancies ───────────────────────────────────────────────────────────────
export async function fetchTenancies(propertyId) {
  const { data, error } = await supabase.from('tenancies').select(TENANCY_COLS)
    .eq('property_id', propertyId).order('tenancy_start', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchTenanciesForCompany(companyId) {
  const { data, error } = await supabase.from('tenancies').select(TENANCY_COLS)
    .eq('company_id', companyId).order('tenancy_start', { ascending: false })
  if (error) throw error
  return data || []
}

const TENANCY_FIELDS = [
  'property_id','company_id','tenant_name','tenant_ref','tenancy_start','tenancy_end','notice_received_date',
  'expected_move_out','rent_amount','rent_frequency','rent_due_day','rent_due_anchor','payment_window_days','status',
  'payment_source','benefit_type','benefit_contribution','tenant_contribution','benefit_frequency',
  'benefit_next_payment_date','benefit_paid_to','benefit_reference','opening_arrears','opening_arrears_date','notes',
  'needs_confirmation','confirmed_at','confirmed_by',
]
function cleanTenancy(t) {
  const out = {}
  for (const k of TENANCY_FIELDS) {
    if (!(k in t)) continue
    let v = t[k]
    if (v === '') v = null
    if (['rent_amount','benefit_contribution','tenant_contribution','opening_arrears'].includes(k) && v != null) v = Number(v)
    if (['rent_due_day','payment_window_days'].includes(k) && v != null) v = Number(v)
    out[k] = v
  }
  if (out.opening_arrears == null) out.opening_arrears = 0
  return out
}

export async function createTenancy(t) {
  const { data, error } = await supabase.from('tenancies')
    .insert({ ...cleanTenancy(t), user_id: await uid() }).select(TENANCY_COLS).single()
  if (error) throw friendly(error)
  return data
}

export async function updateTenancy(id, fields) {
  const { data, error } = await supabase.from('tenancies')
    .update({ ...cleanTenancy(fields), updated_by: await uid() }).eq('id', id).select(TENANCY_COLS).single()
  if (error) throw friendly(error)
  return data
}

export async function confirmTenancy(id) {
  const me = await uid()
  const { data, error } = await supabase.from('tenancies')
    .update({ needs_confirmation: false, confirmed_at: new Date().toISOString(), confirmed_by: me, updated_by: me })
    .eq('id', id).select(TENANCY_COLS).single()
  if (error) throw error
  return data
}

export async function deleteTenancy(id) {
  const { error } = await supabase.from('tenancies').delete().eq('id', id)
  if (error) throw error
}

// Seed a DRAFT tenancy for every rented / notice-given / let-agreed property
// in a company that has none yet. Drafts carry needs_confirmation = true and
// a note explaining every assumption; nothing is authoritative until a human
// confirms it. Returns { created, skipped, failed }.
export async function seedTenanciesFromProperties(companyId, properties, opts = {}) {
  const candidates = (properties || []).filter(p => p.company_id === companyId && !p.deleted_at && propertyNeedsTenancy(p.status))
  const ids = candidates.map(p => p.id)
  if (!ids.length) return { created: 0, skipped: 0, failed: [] }
  const { data: existing, error } = await supabase.from('tenancies').select('property_id').in('property_id', ids)
  if (error) throw error
  const have = new Set((existing || []).map(r => r.property_id))
  const me = await uid()
  let created = 0, skipped = 0
  const failed = []
  for (const p of candidates) {
    if (have.has(p.id)) { skipped++; continue }
    const draft = tenancyDraftFromProperty(p, opts)
    const { error: e } = await supabase.from('tenancies').insert({ ...cleanTenancy(draft), user_id: me })
    if (e) failed.push({ property: p.name || p.address, message: friendly(e).message })
    else created++
  }
  return { created, skipped, failed }
}

// ── Non-chargeable periods ─────────────────────────────────────────────────
export async function fetchNonChargeablePeriods(propertyId) {
  const { data, error } = await supabase.from('non_chargeable_periods').select('*')
    .eq('property_id', propertyId).order('start_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function createNonChargeablePeriod(row) {
  const payload = { ...row, user_id: await uid() }
  if (payload.end_date === '') payload.end_date = null
  const { data, error } = await supabase.from('non_chargeable_periods').insert(payload).select('*').single()
  if (error) throw error
  return data
}
export async function updateNonChargeablePeriod(id, fields) {
  const payload = { ...fields }
  if (payload.end_date === '') payload.end_date = null
  const { data, error } = await supabase.from('non_chargeable_periods').update(payload).eq('id', id).select('*').single()
  if (error) throw error
  return data
}
export async function deleteNonChargeablePeriod(id) {
  const { error } = await supabase.from('non_chargeable_periods').delete().eq('id', id)
  if (error) throw error
}

// ── Receipts + allocations ─────────────────────────────────────────────────
export async function fetchReceipts(propertyId) {
  const { data, error } = await supabase.from('rent_receipts').select(RECEIPT_COLS)
    .eq('property_id', propertyId).order('received_date', { ascending: false })
  if (error) throw error
  return data || []
}

// Create a receipt with its allocations in one call. Allocations must sum to
// the receipt amount unless `allowUnallocated` is set, in which case the
// remainder is recorded as an explicit 'unallocated' allocation flagged for
// review — never silently guessed.
export async function createReceipt(receipt, allocations = [], { allowUnallocated = false } = {}) {
  const me = await uid()
  const amount = Number(receipt.amount)
  if (!amount) throw new Error('Enter the amount received')
  const allocs = (allocations || []).filter(a => Number(a.amount)).map(a => ({
    rent_payment_id: a.rent_payment_id || null, tenancy_id: a.tenancy_id || receipt.tenancy_id || null,
    target: a.target || 'current_rent', amount: Number(a.amount), notes: a.notes || null,
  }))
  const allocated = allocs.reduce((s, a) => s + a.amount, 0)
  const remainder = Math.round((amount - allocated) * 100) / 100
  let review_status = receipt.review_status || 'ok'
  let review_reason = receipt.review_reason || null
  if (Math.abs(remainder) >= 0.005) {
    if (!allowUnallocated) throw new Error(`Allocations total £${allocated.toFixed(2)} but the receipt is £${amount.toFixed(2)}`)
    allocs.push({ rent_payment_id: null, tenancy_id: receipt.tenancy_id || null, target: 'unallocated', amount: remainder, notes: null })
    review_status = 'needs_review'
    review_reason = review_reason || `£${remainder.toFixed(2)} not yet allocated`
  }
  const { data: r, error } = await supabase.from('rent_receipts').insert({
    property_id: receipt.property_id, tenancy_id: receipt.tenancy_id || null, company_id: receipt.company_id || null,
    user_id: me, received_date: receipt.received_date, amount,
    kind: receipt.kind || 'receipt', reverses_receipt_id: receipt.reverses_receipt_id || null,
    payer: receipt.payer || 'tenant', source: receipt.source || 'manual',
    source_ref: receipt.source_ref || null, import_batch_id: receipt.import_batch_id || null,
    reference: receipt.reference || null, notes: receipt.notes || null,
    review_status, review_reason,
  }).select('*').single()
  if (error) throw friendly(error)
  if (allocs.length) {
    const { error: aErr } = await supabase.from('rent_allocations').insert(allocs.map(a => ({ ...a, receipt_id: r.id })))
    if (aErr) {
      // Do not leave a receipt with no allocations behind.
      await supabase.from('rent_receipts').delete().eq('id', r.id)
      throw aErr
    }
  }
  const { data: full } = await supabase.from('rent_receipts').select(RECEIPT_COLS).eq('id', r.id).single()
  return full || r
}

// Reverse a receipt (bounce / refund) by recording a negative receipt that
// mirrors its allocations. The original stays, so the audit trail is intact.
export async function reverseReceipt(original, { kind = 'bounce', received_date, notes } = {}) {
  const allocs = (original.rent_allocations || []).map(a => ({
    rent_payment_id: a.rent_payment_id, tenancy_id: a.tenancy_id, target: a.target, amount: -Number(a.amount),
  }))
  return createReceipt({
    property_id: original.property_id, tenancy_id: original.tenancy_id, company_id: original.company_id,
    received_date: received_date || new Date().toISOString().slice(0, 10),
    amount: -Number(original.amount), kind, reverses_receipt_id: original.id,
    payer: original.payer, source: 'manual', notes: notes || `Reverses receipt of ${original.received_date}`,
  }, allocs)
}

export async function updateReceipt(id, fields) {
  const allowed = ['received_date','payer','reference','notes','review_status','review_reason','tenancy_id']
  const payload = { updated_by: await uid() }
  for (const k of allowed) if (k in fields) payload[k] = fields[k] === '' ? null : fields[k]
  const { data, error } = await supabase.from('rent_receipts').update(payload).eq('id', id).select(RECEIPT_COLS).single()
  if (error) throw error
  return data
}

// Replace a receipt's allocations wholesale (used by the review queue).
export async function reallocateReceipt(receipt, allocations) {
  const amount = Number(receipt.amount)
  const allocs = (allocations || []).filter(a => Number(a.amount)).map(a => ({
    receipt_id: receipt.id, rent_payment_id: a.rent_payment_id || null, tenancy_id: a.tenancy_id || receipt.tenancy_id || null,
    target: a.target || 'current_rent', amount: Number(a.amount), notes: a.notes || null,
  }))
  const allocated = allocs.reduce((s, a) => s + a.amount, 0)
  if (Math.abs(amount - allocated) >= 0.005) throw new Error(`Allocations total £${allocated.toFixed(2)} but the receipt is £${amount.toFixed(2)}`)
  const { error: dErr } = await supabase.from('rent_allocations').delete().eq('receipt_id', receipt.id)
  if (dErr) throw dErr
  const { error: iErr } = await supabase.from('rent_allocations').insert(allocs)
  if (iErr) throw iErr
  const { data, error } = await supabase.from('rent_receipts')
    .update({ review_status: 'ok', review_reason: null, updated_by: await uid() }).eq('id', receipt.id).select(RECEIPT_COLS).single()
  if (error) throw error
  return data
}

export async function deleteReceipt(id) {
  const { error } = await supabase.from('rent_receipts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchReviewQueue(companyId) {
  let q = supabase.from('rent_receipts').select(RECEIPT_COLS + ', property:properties(id,name,address,company_id)')
    .eq('review_status', 'needs_review').order('received_date', { ascending: false })
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

function friendly(error) {
  if (error?.code === '23P01' || /tenancies_no_overlap/.test(error?.message || '')) {
    return new Error('Another tenancy already covers some of those dates for this property. End it first, or adjust the dates.')
  }
  if (error?.code === '23505' && /source_ref/.test(error?.message || '')) {
    return new Error('This receipt has already been recorded (same source reference).')
  }
  return error instanceof Error ? error : new Error(error?.message || 'Request failed')
}
