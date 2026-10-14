// Deals: deals, milestones, contacts, documents, deal -> property
// attachment carry-over, milestone defaults and the address book.
import { supabase } from '../supabase'
import { dealDocToPropertyCategory } from '../attachments'
import { DEFAULT_COPY_OPTIONS, isCopyOptionActive, buildDealCopyFields, buildMilestoneCopies } from '../dealCopy'
import { logAction } from './audit'
import { validateUpload } from './documents'

// ── DEALS ─────────────────────────────────────────────────────────────────────
export const DEFAULT_MILESTONES_STANDARD = [
  { key:'offer_submitted',       label:'Offer submitted',                    stage:'offer',       sort:1,  required:true,  toggleable:false },
  { key:'offer_accepted',        label:'Offer accepted (verbal)',             stage:'offer',       sort:2,  required:false, toggleable:true  },
  { key:'memorandum_received',   label:'Memorandum of sale received',        stage:'offer',       sort:3,  required:false, toggleable:true  },
  { key:'solicitor_instructed',  label:'Solicitor instructed',               stage:'professionals',sort:4,  required:false, toggleable:true  },
  { key:'broker_instructed',     label:'Mortgage broker instructed',         stage:'professionals',sort:5,  required:false, toggleable:true  },
  { key:'mortgage_applied',      label:'Mortgage application submitted',     stage:'professionals',sort:6,  required:false, toggleable:true  },
  { key:'survey_instructed',     label:'Survey instructed',                  stage:'professionals',sort:7,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'legal',       sort:8,  required:false, toggleable:true  },
  { key:'contract_pack_received',label:'Contract pack received',             stage:'legal',       sort:9,  required:false, toggleable:true  },
  { key:'survey_completed',      label:'Survey completed',                   stage:'legal',       sort:10, required:false, toggleable:true  },
  { key:'searches_received',     label:'Searches received',                  stage:'legal',       sort:11, required:false, toggleable:true  },
  { key:'enquiries_raised',      label:'Enquiries raised by solicitor',      stage:'legal',       sort:12, required:false, toggleable:true  },
  { key:'enquiries_satisfied',   label:'Enquiries satisfied',                stage:'legal',       sort:13, required:false, toggleable:true  },
  { key:'mortgage_offer',        label:'Mortgage offer received',            stage:'legal',       sort:14, required:false, toggleable:true  },
  { key:'insurance_arranged',    label:'Buildings insurance arranged',       stage:'exchange',    sort:15, required:false, toggleable:true  },
  { key:'deposit_paid',          label:'Deposit paid to solicitor',          stage:'exchange',    sort:16, required:false, toggleable:true  },
  { key:'insurance_active',      label:'Insurance active from exchange ✦',   stage:'exchange',    sort:17, required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged',                stage:'exchange',    sort:18, required:true,  toggleable:false },
  { key:'completion_date_set',   label:'Completion date confirmed',          stage:'exchange',    sort:19, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:20, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:21, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:22, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:23, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:24, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_AUCTION = [
  { key:'legal_pack_reviewed',   label:'Legal pack reviewed',                stage:'pre_auction', sort:1,  required:false, toggleable:true  },
  { key:'survey_pre_auction',    label:'Survey completed pre-auction',       stage:'pre_auction', sort:2,  required:false, toggleable:true  },
  { key:'finance_approved',      label:'Finance approved in principle',      stage:'pre_auction', sort:3,  required:false, toggleable:true  },
  { key:'insurance_quoted',      label:'Insurance quote obtained',           stage:'pre_auction', sort:4,  required:false, toggleable:true  },
  { key:'lot_won',               label:'Lot won at auction',                 stage:'auction_day', sort:5,  required:true,  toggleable:false },
  { key:'deposit_paid_auction',  label:'10% deposit paid on the day',        stage:'auction_day', sort:6,  required:true,  toggleable:false },
  { key:'insurance_active',      label:'Insurance active from today ✦',      stage:'auction_day', sort:7,  required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged on the day',     stage:'auction_day', sort:8,  required:true,  toggleable:false },
  { key:'solicitor_instructed',  label:'Solicitor instructed immediately',   stage:'completion',  sort:9,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'completion',  sort:10, required:false, toggleable:true  },
  { key:'finance_arranged',      label:'Bridging/mortgage finance arranged', stage:'completion',  sort:11, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:12, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:13, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:14, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:15, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:16, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_BRRR = [
  { key:'refurb_complete',       label:'Refurbishment complete',             stage:'brrr',        sort:1,  required:false, toggleable:true  },
  { key:'refi_valuation',        label:'Refinance valuation instructed',     stage:'brrr',        sort:2,  required:false, toggleable:true  },
  { key:'refi_applied',          label:'New mortgage application submitted', stage:'brrr',        sort:3,  required:false, toggleable:true  },
  { key:'refi_offer',            label:'Refinance mortgage offer received',  stage:'brrr',        sort:4,  required:false, toggleable:true  },
  { key:'capital_released',      label:'Capital released from deal',         stage:'brrr',        sort:5,  required:false, toggleable:true  },
]

export async function fetchDeals(userId) {
  // We deliberately DO NOT filter by user_id here. RLS handles visibility:
  // a deal is visible if (a) you created it, or (b) you have access to its
  // company. So the simplest correct query is "select all" — Postgres will
  // return only the rows you're allowed to see.
  //
  // We DO filter out soft-deleted rows here. Those are accessed separately
  // via the Trash page (fetchAllDeleted), not the main deals list.
  //
  // The userId param is kept for backwards-compat with callers that still
  // pass it; we just ignore it for filtering. Pre-RLS this function was the
  // gatekeeper, but now trust lives in the database.
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createDeal(userId, fields = {}) {
  const { data, error } = await supabase.from('deals')
    .insert({ user_id: userId, ...fields }).select().single()
  if (error) throw error
  return data
}

export async function updateDeal(id, fields) {
  const { data, error } = await supabase.from('deals')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteDeal(id, userId) {
  // Soft-delete: marks the row as trashed rather than removing it. Goes to
  // Trash and auto-purges after 30 days (handled by purgeExpiredTrash).
  // userId is captured in deleted_by so Trash can show "deleted by [name]"
  // if we ever surface that, and so RLS could allow restore by the deleter.
  const { error } = await supabase.from('deals')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId || null,
    })
    .eq('id', id)
  if (error) throw error
  if (userId) {
    try { await logAction(userId, null, 'deal.deleted', 'deal', id, null) } catch(_) {}
  }
}

// Copy a deal, carrying over only the parts the user ticked in the Copy
// dialog (see src/lib/dealCopy.js for the groups). Identity, timestamps and
// trash markers are never copied, and the copy is owned by whoever clicked
// Copy — a collaborator duplicating a colleague's deal used to produce a copy
// still owned by the original creator.
//
// Child records are best-effort: a failure on one contact or one photo is
// collected as a warning rather than aborting a copy that already exists.
// Returns { deal, counts, warnings }.
export async function copyDeal(deal, userId, options = DEFAULT_COPY_OPTIONS) {
  const owner = userId || deal.user_id
  const row = buildDealCopyFields(deal, options, { userId: owner })
  const { data: copy, error } = await supabase.from('deals').insert(row).select().single()
  if (error) throw error

  const counts = { milestones: 0, contacts: 0, photos: 0, documents: 0 }
  const warnings = []

  // Tracker. Ticked: clone the original's own steps (progress optionally).
  // Unticked: a fresh tracker built from the user's master milestone defaults,
  // exactly as a brand-new deal gets.
  try {
    if (isCopyOptionActive(options, 'tracker')) {
      const source = await fetchDealMilestones(deal.id)
      const rows = buildMilestoneCopies(source, copy.id, options)
      if (rows.length) {
        const { error: mErr } = await supabase.from('deal_milestones').insert(rows)
        if (mErr) throw mErr
        counts.milestones = rows.filter(r => r.is_enabled).length
      } else {
        const cfg = await fetchMilestoneDefaults(owner)
        await initialiseMilestones(copy.id, copy.is_auction, copy.deal_type === 'brrr', cfg)
      }
    } else {
      const cfg = await fetchMilestoneDefaults(owner)
      await initialiseMilestones(copy.id, copy.is_auction, copy.deal_type === 'brrr', cfg)
    }
  } catch (e) {
    warnings.push(`Purchase tracker: ${e.message || 'could not be copied'}`)
  }

  if (isCopyOptionActive(options, 'contacts')) {
    try {
      const source = await fetchDealContacts(deal.id)
      const rows = source.map(({ id, deal_id, created_at, ...rest }) => ({ ...rest, deal_id: copy.id }))
      if (rows.length) {
        const { error: cErr } = await supabase.from('deal_contacts').insert(rows)
        if (cErr) throw cErr
        counts.contacts = rows.length
      }
    } catch (e) {
      warnings.push(`Contacts: ${e.message || 'could not be copied'}`)
    }
  }

  const wantPhotos = isCopyOptionActive(options, 'photos')
  const wantDocs = isCopyOptionActive(options, 'documents')
  if (wantPhotos || wantDocs) {
    try {
      const source = await fetchDealDocuments(deal.id)
      for (const doc of source) {
        const isPhoto = isDealPhoto(doc)
        if (isPhoto ? !wantPhotos : !wantDocs) continue
        if (!doc.file_path) continue
        try {
          // Server-side object copy — the file never round-trips through the
          // browser. The destination sits under the copier's own uid folder,
          // which is what the storage policy lets them write to.
          const rawExt = (doc.file_path.split('.').pop() || '').toLowerCase()
          const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
          const path = `${owner}/deals/${copy.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
          const { error: sErr } = await supabase.storage.from('property-documents').copy(doc.file_path, path)
          if (sErr) throw sErr
          const { error: dErr } = await supabase.from('deal_documents').insert({
            deal_id: copy.id, name: doc.name, file_path: path,
            size: doc.size, type: doc.type, user_id: owner,
            caption: doc.caption || null, uploaded_by: doc.uploaded_by || null,
          })
          if (dErr) {
            // Don't leave an orphan file behind if the row insert was refused.
            try { await supabase.storage.from('property-documents').remove([path]) } catch (_) {}
            throw dErr
          }
          if (isPhoto) counts.photos += 1; else counts.documents += 1
        } catch (e) {
          warnings.push(`${doc.name || 'File'}: ${e.message || 'could not be copied'}`)
        }
      }
    } catch (e) {
      warnings.push(`Files: ${e.message || 'could not be copied'}`)
    }
  }

  return { deal: copy, counts, warnings }
}

export async function fetchDealMilestones(dealId) {
  const { data, error } = await supabase.from('deal_milestones')
    .select('*').eq('deal_id', dealId).order('sort_order')
  if (error) throw error
  return data || []
}

export async function initialiseMilestones(dealId, isAuction, isBRRR, milestoneConfig = {}) {
  const base = isAuction ? DEFAULT_MILESTONES_AUCTION : DEFAULT_MILESTONES_STANDARD
  const milestones = isBRRR ? [...base, ...DEFAULT_MILESTONES_BRRR] : base
  const rows = milestones.map(m => ({
    deal_id: dealId, milestone_key: m.key, label: m.label,
    stage: m.stage, sort_order: m.sort, is_required: m.required,
    // Apply user's master settings — if key is false in config, disable it
    is_enabled: milestoneConfig[m.key] !== false,
    completed: false,
  }))
  const { error } = await supabase.from('deal_milestones').insert(rows)
  if (error) throw error
}

export async function updateMilestone(id, fields) {
  const { error } = await supabase.from('deal_milestones').update(fields).eq('id', id)
  if (error) throw error
}

export async function fetchDealContacts(dealId) {
  const { data, error } = await supabase.from('deal_contacts')
    .select('*').eq('deal_id', dealId).order('created_at')
  if (error) throw error
  return data || []
}

export async function upsertDealContact(dealId, contact) {
  if (contact.id) {
    const { data, error } = await supabase.from('deal_contacts').update(contact).eq('id', contact.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('deal_contacts').insert({ ...contact, deal_id: dealId }).select().single()
  if (error) throw error
  return data
}

export async function deleteDealContact(id) {
  const { error } = await supabase.from('deal_contacts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDealDocuments(dealId) {
  const { data, error } = await supabase.from('deal_documents')
    .select('*').eq('deal_id', dealId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// True for rows that should show in the photo gallery rather than the
// document list. Falls back to the extension for the odd browser that
// leaves file.type blank on HEIC / dropped files.
export function isDealPhoto(doc) {
  if ((doc?.type || '').toLowerCase().startsWith('image/')) return true
  const ext = ((doc?.name || doc?.file_path || '').split('.').pop() || '').toLowerCase()
  return ['jpg','jpeg','png','webp','heic','heif','gif'].includes(ext)
}

// Resolve the current user's display name once per upload batch so the
// gallery can say who added a photo. user_profiles is self-readable only,
// so this is denormalised onto the row at upload time.
async function currentUploaderName(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('full_name, first_name, last_name, email').eq('user_id', userId).maybeSingle()
    if (!data) return null
    return data.full_name
      || [data.first_name, data.last_name].filter(Boolean).join(' ')
      || data.email || null
  } catch(_) { return null }
}

export async function uploadDealDocument(dealId, file, userId, opts = {}) {
  validateUpload(file)
  const rawExt = (file.name.split('.').pop() || '').toLowerCase()
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
  // {user_id}/deals/{dealId}/{ts}_{n}.{ext} — see uploadDocument for layout
  // rationale. The random suffix keeps two files from the same multi-select
  // batch from colliding on Date.now().
  const path = `${userId}/deals/${dealId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents')
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (uploadErr) throw uploadErr
  const uploaded_by = opts.uploadedBy ?? await currentUploaderName(userId)
  // Private bucket — no public URL stored. View links generated on demand
  // via getDocumentSignedUrl() against file_path.
  const { data, error } = await supabase.from('deal_documents').insert({
    deal_id: dealId, name: file.name, file_path: path,
    size: file.size, type: file.type, user_id: userId,
    caption: opts.caption || null, uploaded_by,
  }).select().single()
  if (error) {
    // Don't leave an orphan file behind if the row insert was refused.
    try { await supabase.storage.from('property-documents').remove([path]) } catch(_) {}
    throw error
  }
  return data
}

// Upload several files (photos from a multi-select or drag-drop) in
// sequence. Resolves the uploader name once. Returns { done, failed } so the
// UI can report partial success instead of stopping at the first error.
export async function uploadDealDocuments(dealId, files, userId, onProgress) {
  const uploadedBy = await currentUploaderName(userId)
  const list = Array.from(files || [])
  const done = [], failed = []
  for (const file of list) {
    try { done.push(await uploadDealDocument(dealId, file, userId, { uploadedBy })) }
    catch (e) { failed.push({ name: file.name, error: e.message || 'Upload failed' }) }
    if (onProgress) { try { onProgress(done.length + failed.length, list.length) } catch(_) {} }
  }
  return { done, failed }
}

export async function updateDealDocument(id, fields) {
  const { data, error } = await supabase.from('deal_documents')
    .update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Per-deal photo / document counts for badges on the list and pipeline
// cards. One query, RLS-scoped; grouped client-side (PostgREST can't
// GROUP BY, and deal document volumes are small).
export async function fetchDealDocumentCounts() {
  const { data, error } = await supabase.from('deal_documents')
    .select('deal_id, type, name, file_path').order('created_at', { ascending: true })
  if (error) throw error
  // Oldest photo is the cover, so the thumbnail doesn't change every upload.
  const out = {}
  for (const row of data || []) {
    const c = out[row.deal_id] || (out[row.deal_id] = { photos: 0, documents: 0, cover: null })
    if (isDealPhoto(row)) { c.photos += 1; if (!c.cover) c.cover = row.file_path }
    else c.documents += 1
  }
  return out
}

export async function deleteDealDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('deal_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// ── DEAL → PROPERTY ATTACHMENT CARRY-OVER ────────────────────────────────────
// When a completed deal is converted into a property, its photos and
// documents come with it. Each file is COPIED to a new path under the
// converting user's folder rather than re-referenced, for two reasons:
//   1. the path-ownership trigger on property_documents only accepts paths in
//      the caller's own folder, and a deal file may have been uploaded by a
//      colleague;
//   2. the deal goes to Trash and its files are removed when it is purged, so
//      a shared path would break the property's copy 30 days later.
// Photos land in the 'photos' category (rendered as a gallery on the property
// Documents tab); documents are filed by a name heuristic, 'other' otherwise.
export async function carryDealAttachmentsToProperty(dealId, propertyId, userId) {
  const docs = await fetchDealDocuments(dealId)
  const result = { photos: 0, documents: 0, failed: [] }
  for (const d of docs) {
    if (!d.file_path) { result.failed.push({ name: d.name, error: 'No file stored' }); continue }
    const rawExt = (d.file_path.split('.').pop() || '').toLowerCase()
    const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
    const dest = `${userId}/properties/${propertyId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error: copyErr } = await supabase.storage.from('property-documents').copy(d.file_path, dest)
    if (copyErr) { result.failed.push({ name: d.name, error: copyErr.message || 'Copy failed' }); continue }
    const photo = isDealPhoto(d)
    const { error } = await supabase.from('property_documents').insert({
      property_id: propertyId, user_id: userId,
      name: d.caption || d.name, file_path: dest,
      file_type: d.type || null, file_size: d.size || null,
      category: photo ? 'photos' : dealDocToPropertyCategory(d),
    })
    if (error) {
      try { await supabase.storage.from('property-documents').remove([dest]) } catch (_) {}
      result.failed.push({ name: d.name, error: error.message })
      continue
    }
    if (photo) result.photos += 1
    else result.documents += 1
  }
  return result
}

// ── MASTER MILESTONE SETTINGS ─────────────────────────────────────────────────
export async function fetchMilestoneDefaults(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('milestone_config').eq('user_id', userId).single()
    return data?.milestone_config || {}
  } catch(e) { return {} }
}

export async function saveMilestoneDefaults(userId, email, config) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    milestone_config: config,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

// ── ADDRESS BOOK ──────────────────────────────────────────────────────────────
export async function fetchAddressBook(userId) {
  const { data, error } = await supabase.from('address_book')
    .select('*').eq('user_id', userId).order('name')
  if (error) throw error
  return data || []
}

export async function saveToAddressBook(userId, contact) {
  const { id, deal_id, created_at, ...fields } = contact
  const { data, error } = await supabase.from('address_book')
    .insert({ ...fields, user_id: userId, updated_at: new Date().toISOString() })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteAddressBookEntry(id) {
  const { error } = await supabase.from('address_book').delete().eq('id', id)
  if (error) throw error
}
