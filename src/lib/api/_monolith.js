import { supabase } from '../supabase'
import { extractStoragePaths, dealDocToPropertyCategory } from '../attachments'
import { collectClientFraudHeaders } from '../hmrcFraudHeaders'
import { RECEIVED_STATUSES, estimateMortgageInterest } from '../mtdItsa'
import { DEFAULT_COPY_OPTIONS, isCopyOptionActive, buildDealCopyFields, buildMilestoneCopies } from '../dealCopy'
import { validateUpload } from './documents'
import { ROLE_DEFAULTS, getEffectivePermissions } from './roles'

// ── USER PROFILE ──────────────────────────────────────────────────────────────
export async function fetchUserProfile(userId) {
  const { data } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single()
  return data || null
}

export async function upsertUserProfile(userId, email, updates) {
  const { data, error } = await supabase.from('user_profiles')
    .upsert({ ...updates, user_id: userId, email, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function updateUserEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail })
  if (error) throw error
}

export async function updateUserPassword(currentPassword, newPassword, email) {
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (signInErr) throw new Error('Current password is incorrect')
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function sendPasswordReset(email) {
  // redirectTo lands the recovery link on the app origin, where AuthContext's
  // PASSWORD_RECOVERY handler shows the set-new-password screen.
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  if (error) throw error
}

// ── BILLING ───────────────────────────────────────────────────────────────────
export async function fetchSubscriptions(companyIds) {
  if (!companyIds.length) return []
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .in('company_id', companyIds)
  if (error) throw error
  return data || []
}

export async function createCheckoutSession(companyId, action = 'checkout', tier = 'starter') {
  const { data: { session } } = await supabase.auth.getSession()
  // Send our window.origin so the edge function redirects back to the
  // SAME hostname the user is on (apex vs www). Browser session is
  // per-origin, so a cross-host redirect drops the user at the login
  // screen — that's the bug we just fixed.
  const returnOrigin = typeof window !== 'undefined' ? window.location.origin : null
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId, action, tier, return_origin: returnOrigin }),
  })
  const data = await res.json()
  if (!res.ok) {
    const e = new Error(data.error || 'Billing error')
    // Machine-readable error id (e.g. 'investor_unavailable') — lets the UI
    // branch on the failure kind without regex-matching the human message.
    e.code = data.code
    throw e
  }
  return data.url
}

export async function fetchAllCompaniesAdmin() {
  // Platform admin only — fetches all companies with owner emails + subs.
  // Two queries instead of embedded join — see fetchAdminAllCompanies for why.
  const [{ data: cos, error: ce }, { data: subs }] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('subscriptions').select('*'),
  ])
  if (ce) throw ce
  const subsByCo = {}
  for (const s of (subs || [])) (subsByCo[s.company_id] ||= []).push(s)
  return (cos || []).map(c => ({ ...c, subscriptions: subsByCo[c.id] || [] }))
}

export async function setCompanyFreeTier(companyId, isFreeTier, grantedBy) {
  const { error } = await supabase
    .from('companies')
    .update({
      is_free_tier: isFreeTier,
      free_tier_reason: isFreeTier ? 'Manually granted by admin' : null,
      free_tier_granted_by: isFreeTier ? grantedBy : null,
    })
    .eq('id', companyId)
  if (error) throw error
  // Update subscription status too
  await supabase
    .from('subscriptions')
    .update({ status: isFreeTier ? 'free_tier' : 'trialing' })
    .eq('company_id', companyId)
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
export async function markOnboardingComplete(userId, email) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function fetchOnboardingStatus(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .single()
    return data?.onboarding_completed === true
  } catch(e) { return false }
}

// ── ADMIN: CREATE COMPANY FOR A SPECIFIC USER ────────────────────────────────
export async function adminCreateCompanyForUser(userId, userEmail, name, abbr, color) {
  // Creates a new company owned by a target user (admin action)
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  const { data: co, error } = await supabase
    .from('companies')
    .insert({ name, abbr: (abbr || name.slice(0,3)).toUpperCase(), color: color || '#C8A84B', owner_id: userId })
    .select()
    .single()
  if (error) throw error
  return co
}

// ── ADMIN: MERGE TWO COMPANIES (move all properties from source to target, delete source) ──
export async function adminMergeCompanies(sourceCompanyId, targetCompanyId) {
  // Move all properties from source to target
  const { error: pErr } = await supabase
    .from('properties')
    .update({ company_id: targetCompanyId })
    .eq('company_id', sourceCompanyId)
  if (pErr) throw pErr

  // Move access rows
  const { data: existingTarget } = await supabase.from('user_company_access').select('user_id').eq('company_id', targetCompanyId)
  const existingIds = new Set((existingTarget || []).map(r => r.user_id))
  const { data: sourceAccess } = await supabase.from('user_company_access').select('*').eq('company_id', sourceCompanyId)
  if (sourceAccess) {
    for (const row of sourceAccess) {
      if (!existingIds.has(row.user_id)) {
        await supabase.from('user_company_access').insert({ user_id: row.user_id, company_id: targetCompanyId, email: row.email })
      }
    }
    await supabase.from('user_company_access').delete().eq('company_id', sourceCompanyId)
  }

  // Delete the source company
  const { error: dErr } = await supabase.from('companies').delete().eq('id', sourceCompanyId)
  if (dErr) throw dErr
  return { success: true }
}

// ── ADMIN: TRANSFER COMPANY OWNERSHIP TO ANOTHER USER ────────────────────────
export async function adminTransferCompany(companyId, newOwnerId, newOwnerEmail) {
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  // Step 1: Update the company's owner
  const { error } = await supabase
    .from('companies')
    .update({ owner_id: newOwnerId })
    .eq('id', companyId)
  if (error) throw error

  // Step 2: Make sure the new owner has an access row with is_admin=true
  // (Upsert — if they already had shared access it gets promoted to admin; if not it creates a fresh row)
  try {
    await supabase.from('user_company_access')
      .upsert({ user_id: newOwnerId, company_id: companyId, email: newOwnerEmail, is_admin: true },
              { onConflict: 'user_id,company_id' })
  } catch (e) { /* Non-fatal — ownership transfer already succeeded */ }

  return { success: true }
}

// ── ADMIN: FULL COMPANY LIST WITH SUBS ───────────────────────────────────────
// Fetches all companies + their subscription status as a flat list for the
// admin dashboard. Previously used a PostgREST embedded join (`subscriptions(...)`)
// but that occasionally returned an empty `subscriptions` array even when
// the row clearly exists in the DB — turned out to be PostgREST schema
// cache flakiness on this particular relationship. Switched to two
// independent queries + a client-side merge: bulletproof.
export async function fetchAdminAllCompanies() {
  const [{ data: cos, error: ce }, { data: subs }, { data: propCounts }] = await Promise.all([
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('company_id, status, property_count, current_period_end, stripe_subscription_id, tier'),
    supabase.from('properties').select('company_id'),
  ])
  if (ce) throw ce

  // Group subscriptions by company_id (most companies have at most 1; defensive in case of dupes)
  const subsByCo = {}
  for (const s of (subs || [])) {
    (subsByCo[s.company_id] ||= []).push(s)
  }

  // Count properties per company
  const countMap = {}
  for (const p of (propCounts || [])) {
    countMap[p.company_id] = (countMap[p.company_id] || 0) + 1
  }

  // Attach owner emails from user_profiles
  const ownerIds = [...new Set((cos || []).map(c => c.owner_id).filter(Boolean))]
  let profileMap = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', ownerIds)
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p.email })
  }

  return (cos || []).map(c => ({
    ...c,
    subscriptions: subsByCo[c.id] || [],
    owner_email: profileMap[c.owner_id] || null,
    real_property_count: countMap[c.id] || 0,
    paid_property_count: subsByCo[c.id]?.[0]?.property_count || 0,
  }))
}

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

// Stamp duty calculator (UK 2024 rates)
export function calcStampDuty(price, isAdditional = true, isFirstTimeBuyer = false) {
  // UK SDLT rates — updated April 2025 / October 2024
  // Standard bands from 1 April 2025 (temporary nil-rate threshold ended):
  //   £0–£125,000:        0%
  //   £125,001–£250,000:  2%
  //   £250,001–£925,000:  5%
  //   £925,001–£1.5m:    10%
  //   Over £1.5m:        12%
  // Additional property surcharge: 5% on full price (increased from 3%, 31 Oct 2024)
  // FTB relief from 1 April 2025:
  //   £0–£300,000:        0%
  //   £300,001–£500,000:  5% on the excess
  //   Over £500,000:      standard rates (no FTB relief)
  if (!price || price <= 0) return 0
  let duty = 0

  if (isFirstTimeBuyer && !isAdditional) {
    if (price <= 300000) return 0
    if (price <= 500000) {
      duty = (price - 300000) * 0.05
      return Math.round(duty)
    }
    // Over £500k — no FTB relief, fall through to standard rates
  }

  // Standard banded rates
  if (price > 125000) duty += (Math.min(price, 250000) - 125000) * 0.02
  if (price > 250000) duty += (Math.min(price, 925000) - 250000) * 0.05
  if (price > 925000) duty += (Math.min(price, 1500000) - 925000) * 0.10
  if (price > 1500000) duty += (price - 1500000) * 0.12

  // Additional property surcharge: 5% on full purchase price (from 31 Oct 2024)
  if (isAdditional) duty += price * 0.05

  return Math.round(duty)
}

// Mortgage repayment calculator
export function calcMonthlyRepayment(principal, ratePercent, termYears, interestOnly = false) {
  if (!principal || !ratePercent) return 0
  if (interestOnly) {
    // Interest only: (loan × rate) / 12
    return Math.round(principal * (ratePercent / 100) / 12)
  }
  // Repayment: standard amortisation formula
  if (!termYears) return 0
  const r = (ratePercent / 100) / 12
  const n = termYears * 12
  return Math.round(principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1))
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

// ── REPORTS DATA FETCHING ─────────────────────────────────────────────────────
export async function fetchAllComplianceItems(userId) {
  const { data, error } = await supabase.from('compliance_items')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('expiry_date')
  if (error) throw error
  return data || []
}

export async function fetchAllMaintenanceJobs(userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllTenancies(userId) {
  const { data, error } = await supabase.from('tenancy_details')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchAllRentPayments(userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllExpenses(userId) {
  const { data, error } = await supabase.from('property_expenses')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('date', { ascending: false })
  if (error) throw error
  return data || []
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

// ── DELETE USER (platform admin only, calls edge function) ────────────────────
export async function deleteUser(targetUserId) {
  const { data: { session } } = await supabase.auth.getSession()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(
    `${supabaseUrl}/functions/v1/delete-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ target_user_id: targetUserId }),
    }
  )
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── ADMIN SUITE ───────────────────────────────────────────────────────────────
export async function fetchAdminNotes(companyId) {
  const { data, error } = await supabase.from('admin_notes')
    .select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addAdminNote(adminId, companyId, note) {
  const { data, error } = await supabase.from('admin_notes')
    .insert({ admin_id: adminId, company_id: companyId, note }).select().single()
  if (error) throw error
  return data
}

export async function deleteAdminNote(id) {
  const { error } = await supabase.from('admin_notes').delete().eq('id', id)
  if (error) throw error
}

export async function setCompanyFlag(companyId, flagged) {
  const { error } = await supabase.from('companies').update({ flagged }).eq('id', companyId)
  if (error) throw error
}

// Fetch the statement-email inbox token for a company. Used by the
// CompanyInboxPanel to display the per-company forwarding address.
export async function fetchCompanyInboxToken(companyId) {
  const { data, error } = await supabase
    .from('companies').select('statement_email_token')
    .eq('id', companyId).single()
  if (error) throw error
  return data?.statement_email_token || null
}

// Rotate the token (in case the address leaks / spam starts coming in).
// Server-side RPC only: it owns the address format (<company-slug>-<key>)
// and the owner/admin permission check. Returns the new token.
export async function rotateCompanyInboxToken(companyId) {
  const { data, error } = await supabase.rpc('regenerate_statement_email_token', { p_company_id: companyId })
  if (error) throw error
  return data
}

export async function extendTrial(companyId, days) {
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + days)
  const { error } = await supabase.from('companies')
    .update({ trial_ends_at: newDate.toISOString() }).eq('id', companyId)
  if (error) throw error
  return newDate
}

// Force-end a trial right now. Sets companies.trial_ends_at = now() so
// the trial period is over, and flips any matching subscription row to
// 'past_due' so the BillingPage shows the "Add payment method" CTA
// the next time the customer signs in (existing logic at
// BillingPage.jsx:126 — past_due renders the upgrade prompt). After
// this, only payment via Stripe Checkout restores access.
//
// Returns true on success; throws on the company update so the admin
// UI can surface a clear error. The subscription update is best-effort
// (some companies don't have a subscription row yet — that's fine, the
// trial_ends_at change alone forces re-billing once they sign in).
export async function endTrialNow(companyId) {
  const now = new Date()
  const { error: coErr } = await supabase.from('companies')
    .update({ trial_ends_at: now.toISOString() }).eq('id', companyId)
  if (coErr) throw coErr
  // Mirror on subscriptions if a row exists — best-effort.
  try {
    await supabase.from('subscriptions')
      .update({ status: 'past_due', updated_at: now.toISOString() })
      .eq('company_id', companyId)
      .in('status', ['trialing', 'free_tier'])
  } catch (_) { /* swallow — companies update is the source of truth */ }
  return now
}

export async function fetchAnnouncements() {
  const { data } = await supabase.from('admin_announcements')
    .select('*').eq('is_active', true).order('created_at', { ascending: false })
  return data || []
}

export async function createAnnouncement(msg, type, linkText, linkUrl, adminId) {
  const { data, error } = await supabase.from('admin_announcements')
    .insert({ message: msg, type, link_text: linkText, link_url: linkUrl, created_by: adminId, is_active: true })
    .select().single()
  if (error) throw error
  return data
}

export async function deactivateAnnouncement(id) {
  const { error } = await supabase.from('admin_announcements').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
export async function logAction(userId, companyId, action, entityType, entityId, entityName, metadata = {}) {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId, company_id: companyId, action,
      entity_type: entityType, entity_id: entityId,
      entity_name: entityName, metadata,
    })
  } catch(e) {} // Never block the main action if logging fails
}

export async function fetchAuditLog(userId, companyId, limit = 100) {
  const q = supabase.from('audit_log').select('*')
  if (companyId) q.eq('company_id', companyId)
  else q.eq('user_id', userId)
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return data || []
}

// ── SOFT DELETE ───────────────────────────────────────────────────────────────
export async function softDeleteProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.deleted', 'property', propertyId, null)
}

export async function restoreProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.restored', 'property', propertyId, null)
}

export async function fetchDeletedProperties(userId) {
  const { data, error } = await supabase.from('properties')
    .select('*, company:companies(name,abbr,color)')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function restoreEntity(table, id) {
  const { error } = await supabase.from(table)
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', id)
  if (error) throw error
}

// Permanent hard delete (only for admins or from trash after 30 days).
// Files first, then the row — see STORAGE_PATH_SOURCES.
export async function hardDeleteEntity(table, id) {
  const paths = await collectStoragePaths(table, [id])
  if (paths.length) await removeStorageFiles(paths)
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

// ── COMPANY CASCADE SOFT-DELETE ──────────────────────────────────────────────
// When a company is soft-deleted, all its (currently-active) properties are
// soft-deleted with the same `deletion_batch_id`. On restore, we use that
// batch ID to re-link them. We deliberately do NOT touch properties that
// were already soft-deleted before the company delete — those keep their
// original deleted_at / deleted_by and won't auto-restore later.

/**
 * Returns a preview of what would be removed if a company were deleted.
 * Used to populate the confirmation modal. Read-only — no side effects.
 */
export async function getCompanyDeletionPreview(companyId) {
  // Active properties that would cascade-delete
  const { count: activeProps } = await supabase.from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('deleted_at', null)
  // Tenancies on those active properties
  const { data: propRows } = await supabase.from('properties')
    .select('id').eq('company_id', companyId).is('deleted_at', null)
  const propIds = (propRows || []).map(p => p.id)
  let tenancies = 0, documents = 0
  if (propIds.length > 0) {
    const { count: tCount } = await supabase.from('tenancy_details')
      .select('*', { count: 'exact', head: true })
      .in('property_id', propIds)
      .is('deleted_at', null)
    tenancies = tCount || 0
    const { count: dCount } = await supabase.from('property_documents')
      .select('*', { count: 'exact', head: true })
      .in('property_id', propIds)
      .is('deleted_at', null)
    documents = dCount || 0
  }
  // Direct company-level documents
  const { count: companyDocs } = await supabase.from('company_documents')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
  return {
    properties:       activeProps || 0,
    tenancies,
    documents,
    company_documents: companyDocs || 0,
  }
}

/**
 * Soft-delete a company and all its currently-active properties as one batch.
 * Sets deletion_batch_id on every affected row so restore can be exact.
 * Does NOT touch properties that were already soft-deleted independently.
 *
 * Note: tenancies, documents, etc. are NOT explicitly soft-deleted here. They
 * become invisible automatically because the property they belong to is gone
 * (queries that join on properties will filter them out, and the Trash page
 * will hide rows whose parent property is deleted).
 */
export async function softDeleteCompanyCascade(companyId, userId) {
  // Generate a fresh batch ID — a UUID via crypto.randomUUID (browser-safe)
  const batchId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = new Date().toISOString()

  // Step 1 — soft-delete the active properties for this company, tagged with batchId
  const { error: pErr } = await supabase.from('properties')
    .update({ deleted_at: now, deleted_by: userId, deletion_batch_id: batchId })
    .eq('company_id', companyId)
    .is('deleted_at', null)
  if (pErr) throw pErr

  // Step 2 — soft-delete the company with the same batchId
  const { error: cErr } = await supabase.from('companies')
    .update({ deleted_at: now, deleted_by: userId, deletion_batch_id: batchId })
    .eq('id', companyId)
  if (cErr) throw cErr

  // Audit log (best effort — don't fail the delete if this errors)
  try { await logAction(userId, companyId, 'company.deleted', 'company', companyId, null) } catch (e) {}
  return { batchId }
}

/**
 * Restore a soft-deleted company AND any properties that were cascade-deleted
 * with it (matching deletion_batch_id). Does NOT restore properties that were
 * deleted independently before the company delete.
 */
export async function restoreCompanyAndCascade(companyId, userId) {
  // Find the deletion_batch_id for the company
  const { data: co, error: cErr } = await supabase.from('companies')
    .select('deletion_batch_id')
    .eq('id', companyId).single()
  if (cErr) throw cErr
  const batchId = co?.deletion_batch_id

  // Restore the company itself
  const { error: rcErr } = await supabase.from('companies')
    .update({ deleted_at: null, deleted_by: null, deletion_batch_id: null })
    .eq('id', companyId)
  if (rcErr) throw rcErr

  // Restore properties that share this batch ID (i.e. cascade-deleted together)
  if (batchId) {
    const { error: rpErr } = await supabase.from('properties')
      .update({ deleted_at: null, deleted_by: null, deletion_batch_id: null })
      .eq('deletion_batch_id', batchId)
    if (rpErr) throw rpErr
  }

  try { await logAction(userId, companyId, 'company.restored', 'company', companyId, null) } catch (e) {}
}

// ── FETCH ALL DELETED ITEMS (for Trash page) ──────────────────────────────────
// ── AUTO-PURGE EXPIRED TRASH ─────────────────────────────────────────────────
// Hard-deletes any rows whose deleted_at is older than the retention window.
// Called lazily by fetchAllDeleted so the Trash page only ever shows
// recoverable items. Best-effort: errors on individual tables are swallowed
// so a failure on one table doesn't block the rest.
//
// Retention window is currently 30 days. Tables with cascade-aware deletes
// (companies, properties) are purged just like the others — when a company
// is hard-deleted via this purge, its still-soft-deleted properties also
// reach their 30 day mark in the same time frame, so they purge alongside.
const TRASH_RETENTION_DAYS = 30

// ── STORAGE CLEAN-UP ON PURGE ────────────────────────────────────────────────
// Postgres cascades the document ROWS away when a trashed entity is hard-
// deleted, but nothing removes the FILES from the private bucket, so every
// purge used to leave orphans behind (six were found in Sept 2026). For each
// purgeable table this says where its files are referenced. Paths are
// collected BEFORE the rows go: the storage read/delete permission for a
// colleague's upload comes from those very rows.
const STORAGE_PATH_SOURCES = {
  deals:              [{ table: 'deal_documents',       fk: 'deal_id',     col: 'file_path' }],
  properties:         [{ table: 'property_documents',   fk: 'property_id', col: 'file_path' },
                       { table: 'property_inspections', fk: 'property_id', col: 'photos' },
                       { table: 'maintenance_jobs',     fk: 'property_id', col: 'photos' }],
  companies:          [{ table: 'company_documents',    fk: 'company_id',  col: 'file_path' }],
  maintenance_jobs:   [{ table: 'maintenance_jobs',     fk: 'id',          col: 'photos' }],
  property_documents: [{ table: 'property_documents',   fk: 'id',          col: 'file_path' }],
}

export async function collectStoragePaths(table, ids) {
  const sources = STORAGE_PATH_SOURCES[table]
  if (!sources || !ids?.length) return []
  const paths = []
  for (const src of sources) {
    try {
      const { data, error } = await supabase.from(src.table).select(src.col).in(src.fk, ids)
      if (!error) paths.push(...extractStoragePaths(data, src.col))
    } catch (_) { /* best effort: a missing table must not block the purge */ }
  }
  return [...new Set(paths)]
}

// Best effort, in chunks of 100 (the Storage API's comfortable batch size).
// Objects the caller isn't allowed to delete are simply not returned by the
// API; they are counted as failed rather than thrown.
export async function removeStorageFiles(paths) {
  let removed = 0, failed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    try {
      const { data, error } = await supabase.storage.from('property-documents').remove(chunk)
      if (error) failed += chunk.length
      else { removed += (data || []).length; failed += chunk.length - (data || []).length }
    } catch (_) { failed += chunk.length }
  }
  return { removed, failed }
}

export async function purgeExpiredTrash(userId) {
  if (!userId) return { purged: 0, filesRemoved: 0 }
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const tables = [
    { table: 'properties',         scope: { col: 'user_id',  val: userId } },
    { table: 'companies',          scope: { col: 'owner_id', val: userId } },
    { table: 'tenancy_details',    scope: { col: 'user_id',  val: userId } },
    { table: 'compliance_items',   scope: { col: 'user_id',  val: userId } },
    { table: 'maintenance_jobs',   scope: { col: 'user_id',  val: userId } },
    { table: 'property_expenses',  scope: { col: 'user_id',  val: userId } },
    { table: 'deals',              scope: { col: 'user_id',  val: userId } },
    { table: 'property_documents', scope: { col: 'user_id',  val: userId } },
  ]
  let purged = 0, filesRemoved = 0
  for (const { table, scope } of tables) {
    try {
      // Find what is about to go, remove its files while the rows (and so
      // our storage permissions) still exist, then delete the rows. The
      // delete repeats the trash conditions so a row restored between the
      // two calls survives.
      const { data: rows, error: selErr } = await supabase.from(table)
        .select('id')
        .eq(scope.col, scope.val)
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
      if (selErr || !rows?.length) continue
      const ids = rows.map(r => r.id)
      const paths = await collectStoragePaths(table, ids)
      if (paths.length) filesRemoved += (await removeStorageFiles(paths)).removed
      const { error, count } = await supabase.from(table)
        .delete({ count: 'exact' })
        .in('id', ids)
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
      if (!error && count) purged += count
    } catch (e) { /* table-level error: continue with the others */ }
  }
  return { purged, filesRemoved, retentionDays: TRASH_RETENTION_DAYS }
}

export async function fetchAllDeleted(userId) {
  // Lazy auto-purge: removes expired trash before showing what remains.
  // We don't await this on a critical path because it's "best effort".
  // We DO await it here because we want the Trash page to reflect the
  // state immediately after purge — otherwise the user sees rows that
  // are about to vanish on the next reload.
  try { await purgeExpiredTrash(userId) } catch (e) {}

  // Query each table in parallel for deleted rows belonging to the user
  const safe = (p) => p.then(r => r.data || []).catch(() => [])

  const [props, companies, tenancies, compliance, maintenance, expenses, deals, documents] = await Promise.all([
    safe(supabase.from('properties').select('id, name, address, deleted_at, deleted_by, company_id, company:companies(name,abbr,color)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('companies').select('id, name, abbr, color, deleted_at, deleted_by').eq('owner_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('tenancy_details').select('id, tenant_name, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('compliance_items').select('id, cert_type, cert_name, expiry_date, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('maintenance_jobs').select('id, title, description, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_expenses').select('id, description, amount, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('deals').select('id, name, address, deleted_at, deleted_by, company_id, company:companies(name,abbr,color)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    safe(supabase.from('property_documents').select('id, name, file_path, file_url, category, property_id, deleted_at, deleted_by, property:properties(name)').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
  ])

  return {
    properties: props.map(r => ({ ...r, _type: 'properties', _label: 'Property', _name: r.name || r.address })),
    companies: companies.map(r => ({ ...r, _type: 'companies', _label: 'Company', _name: r.name })),
    tenancies: tenancies.map(r => ({ ...r, _type: 'tenancy_details', _label: 'Tenancy', _name: `${r.tenant_name || 'Tenant'} @ ${r.property?.name || '—'}` })),
    compliance: compliance.map(r => ({ ...r, _type: 'compliance_items', _label: 'Certificate', _name: `${r.cert_type || r.cert_name || 'Certificate'} @ ${r.property?.name || '—'}` })),
    maintenance: maintenance.map(r => ({ ...r, _type: 'maintenance_jobs', _label: 'Repair job', _name: `${r.title || r.description} @ ${r.property?.name || '—'}` })),
    expenses: expenses.map(r => ({ ...r, _type: 'property_expenses', _label: 'Expense', _name: `${r.description} (£${r.amount}) @ ${r.property?.name || '—'}` })),
    deals: deals.map(r => ({ ...r, _type: 'deals', _label: 'Deal', _name: r.name || r.address || 'Untitled deal' })),
    documents: documents.map(r => ({ ...r, _type: 'property_documents', _label: 'Document', _name: `${r.name} @ ${r.property?.name || '—'}` })),
  }
}

// Backup + GDPR export functions moved to ./backups.js.
// downloadFullBackup, fetchUserBackups, downloadBackupById,
// createManualBackup, deleteBackup, exportUserData are re-exported via
// src/lib/api/index.js so callers still use `import * as api from '../lib/api'`.

// ── REFERRALS ─────────────────────────────────────────────────────────────────
export async function fetchOrCreateReferralCode(userId, email) {
  const { data: existing } = await supabase.from('user_profiles')
    .select('referral_code').eq('user_id', userId).single()
  if (existing?.referral_code) return existing.referral_code
  const code = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'') + Math.random().toString(36).substring(2,6)
  await supabase.from('user_profiles').update({ referral_code: code }).eq('user_id', userId)
  return code
}

export async function fetchReferrals(userId) {
  const { data } = await supabase.from('referrals').select('*').eq('referrer_id', userId).order('created_at', { ascending: false })
  return data || []
}

// ── ONBOARDING EMAIL ──────────────────────────────────────────────────────────
// No-op stub. The /functions/v1/onboarding-email edge function was
// never deployed, so every call from App.jsx login → 404 + CORS spam
// in the logs (was firing on every page load). Kept the export so we
// don't have to rip the call site out; when we want real onboarding
// emails, build the edge function and replace this body.
export async function sendOnboardingEmail(_email, _name, _sequence) {
  return null
}

// ── PROPERTY HEALTH SCORE ─────────────────────────────────────────────────────
export function calcPropertyHealthScore(property, compliance=[], tenancy=null, maintenance=[], rentPayments=[]) {
  // Returns 0-100 score with breakdown
  let score = 100
  const issues = []
  const today = new Date()

  // Compliance (max -40 points)
  const expiryFields = [
    { key:'gas_safety_expiry',    label:'Gas Safety', critical:true },
    { key:'eicr_expiry',          label:'EICR',        critical:true },
    { key:'epc_expiry',           label:'EPC',         critical:false },
    { key:'hmo_licence_expiry',   label:'HMO Licence', critical:true },
  ]
  compliance.forEach(c => {
    if (!c.expiry_date) return
    const exp = new Date(c.expiry_date)
    const daysLeft = (exp - today) / (1000*60*60*24)
    if (daysLeft < 0) { score -= 20; issues.push({ type:'error', text:`${c.title || c.item_type} expired` }) }
    else if (daysLeft < 30) { score -= 10; issues.push({ type:'warning', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
    else if (daysLeft < 90) { score -= 3; issues.push({ type:'info', text:`${c.title || c.item_type} expires in ${Math.round(daysLeft)} days` }) }
  })

  // Rent arrears (max -25 points). 'missed' is the legacy value for
  // pre-2026-05-25 rows; we accept either until the DB is fully migrated.
  const overduePayments = rentPayments.filter(p => p.status === 'overdue' || p.status === 'missed')
  if (overduePayments.length > 0) {
    score -= Math.min(25, overduePayments.length * 10)
    issues.push({ type:'error', text:`${overduePayments.length} overdue rent payment${overduePayments.length>1?'s':''}` })
  }

  // Open maintenance (max -20 points)
  const openJobs = maintenance.filter(m => m.status !== 'complete')
  const urgentJobs = openJobs.filter(m => m.priority === 'urgent')
  if (urgentJobs.length) { score -= 15; issues.push({ type:'error', text:`${urgentJobs.length} urgent repair${urgentJobs.length>1?'s':''} open` }) }
  else if (openJobs.length) { score -= Math.min(10, openJobs.length * 3); issues.push({ type:'warning', text:`${openJobs.length} open repair job${openJobs.length>1?'s':''}` }) }

  // Tenancy (max -15 points)
  if (tenancy?.tenancy_end) {
    const end = new Date(tenancy.tenancy_end)
    const daysToEnd = (end - today) / (1000*60*60*24)
    if (daysToEnd < 0) { score -= 15; issues.push({ type:'error', text:'Tenancy has ended' }) }
    else if (daysToEnd < 30) { score -= 10; issues.push({ type:'warning', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
    else if (daysToEnd < 90) { score -= 5; issues.push({ type:'info', text:`Tenancy ends in ${Math.round(daysToEnd)} days` }) }
  }

  // Vacant property
  if (property.status === 'vacant') {
    score -= 5
    issues.push({ type:'info', text:'Property currently vacant' })
  }

  const clamped = Math.max(0, Math.min(100, score))
  const grade = clamped >= 90 ? 'A' : clamped >= 75 ? 'B' : clamped >= 60 ? 'C' : clamped >= 40 ? 'D' : 'F'
  const color = clamped >= 90 ? '#2ECC8A' : clamped >= 75 ? '#4B8FE0' : clamped >= 60 ? '#C8A84B' : clamped >= 40 ? '#E0943A' : '#E05555'
  return { score: clamped, grade, color, issues }
}

// ═════════════════════════════════════════════════════════════════════════════
// DEAL SCORING — DSCR, ROI, Stress Test, Overall Score (0-100)
// ═════════════════════════════════════════════════════════════════════════════

// Debt Service Coverage Ratio: annual rent / annual mortgage payment
// Lenders typically want 1.25+, stress-tested at 5.5%-6% interest rates
export function calcDSCR(annualRent, annualMortgagePayment) {
  if (!annualMortgagePayment || annualMortgagePayment <= 0) return null  // cash purchase
  return annualRent / annualMortgagePayment
}

// Stress test: DSCR at higher interest rates
export function calcStressTest(loanAmount, termYears, annualRent, currentRate) {
  // No loan = no stress test to do (cash purchase, or unanalysed deal).
  // Return null so callers can simply skip rendering — they all guard with
  // `stressData && stressData.map(...)`. (Previously this returned
  // `{ cash: true }` which is truthy but not an array, causing
  // `stressData.map is not a function` on brand-new empty deals.)
  if (!loanAmount || loanAmount <= 0) return null
  const rates = [currentRate, currentRate + 1, currentRate + 2, currentRate + 3]
  return rates.map(rate => {
    // Interest-only mortgage payment approximation (more conservative)
    const monthlyPayment = (loanAmount * (rate / 100)) / 12
    const annualPayment = monthlyPayment * 12
    const dscr = annualPayment > 0 ? annualRent / annualPayment : null
    return {
      rate,
      monthlyPayment,
      annualPayment,
      dscr,
      passes: dscr !== null && dscr >= 1.25,
    }
  })
}

// Cash-on-cash return: annual profit / cash invested
export function calcCashOnCash(annualProfit, totalCashInvested) {
  if (!totalCashInvested || totalCashInvested <= 0) return null
  return (annualProfit / totalCashInvested) * 100
}

// LTV (loan-to-value) percentage
export function calcLTV(loanAmount, propertyValue) {
  if (!propertyValue || propertyValue <= 0) return null
  return (loanAmount / propertyValue) * 100
}

// Overall deal score 0-100 — weighted across key metrics
export function calcDealScore(deal) {
  const purchasePrice = deal.purchase_price || 0
  if (purchasePrice <= 0) return { score: 0, breakdown: {}, rating: 'insufficient-data' }

  const grossRentPcm = deal.expected_rent || deal.rent_pcm || 0
  const annualRent = grossRentPcm * 12
  const grossYield = (annualRent / purchasePrice) * 100

  const isCash = deal.purchase_type === 'cash'
  const depositPercent = deal.deposit_percent || 25
  const loanAmount = isCash ? 0 : purchasePrice * (1 - depositPercent / 100)
  const mortgageRate = deal.mortgage_rate || 5
  const annualMortgage = isCash ? 0 : loanAmount * (mortgageRate / 100) // interest-only approx

  const operatingCosts = (deal.insurance || 0) + (deal.maintenance_budget || annualRent * 0.1) + (deal.management_fee_percent ? annualRent * (deal.management_fee_percent / 100) : 0)
  const annualProfit = annualRent - annualMortgage - operatingCosts

  const sd = deal.stamp_duty_override ?? 0
  const totalCost = purchasePrice + sd + (deal.legal_fees || 0) + (deal.survey_cost || 0) + (deal.refurb_cost || 0) + (deal.other_costs || 0)
  const cashIn = isCash ? totalCost : totalCost - loanAmount

  const dscr = calcDSCR(annualRent, annualMortgage)
  const cashOnCash = calcCashOnCash(annualProfit, cashIn)
  const ltv = isCash ? 0 : calcLTV(loanAmount, purchasePrice)

  // Stress test — does DSCR at +2% interest still pass?
  const stressRate = mortgageRate + 2
  const stressAnnualMortgage = isCash ? 0 : loanAmount * (stressRate / 100)
  const stressDscr = isCash ? null : annualRent / stressAnnualMortgage
  const stressPasses = isCash || (stressDscr !== null && stressDscr >= 1.25)

  // Scoring (0-100 weighted)
  let score = 0
  const breakdown = {}

  // Gross yield (25 points)
  const yieldPoints = grossYield >= 10 ? 25 : grossYield >= 8 ? 22 : grossYield >= 6 ? 17 : grossYield >= 5 ? 12 : grossYield >= 4 ? 7 : 2
  breakdown.yield = { value: grossYield.toFixed(2) + '%', points: yieldPoints, max: 25 }
  score += yieldPoints

  // DSCR (25 points) — only for mortgaged deals
  if (!isCash) {
    const dscrPoints = dscr >= 1.5 ? 25 : dscr >= 1.25 ? 20 : dscr >= 1.1 ? 12 : dscr >= 1.0 ? 5 : 0
    breakdown.dscr = { value: dscr?.toFixed(2), points: dscrPoints, max: 25 }
    score += dscrPoints
  } else {
    breakdown.dscr = { value: 'Cash (N/A)', points: 25, max: 25 }
    score += 25
  }

  // Stress test resilience (20 points)
  const stressPoints = stressPasses ? 20 : isCash ? 20 : stressDscr >= 1.0 ? 10 : 0
  breakdown.stress = { value: isCash ? 'Cash (resilient)' : `${stressDscr?.toFixed(2)} @ +2%`, points: stressPoints, max: 20 }
  score += stressPoints

  // Cash-on-cash return (15 points)
  const cocPoints = cashOnCash >= 15 ? 15 : cashOnCash >= 10 ? 12 : cashOnCash >= 7 ? 9 : cashOnCash >= 5 ? 6 : cashOnCash >= 3 ? 3 : 0
  breakdown.cash_on_cash = { value: (cashOnCash || 0).toFixed(1) + '%', points: cocPoints, max: 15 }
  score += cocPoints

  // LTV (15 points) — lower LTV is safer
  const ltvPoints = isCash ? 15 : ltv <= 60 ? 15 : ltv <= 70 ? 12 : ltv <= 75 ? 9 : ltv <= 80 ? 5 : 2
  breakdown.ltv = { value: isCash ? 'Cash (0%)' : ltv?.toFixed(0) + '%', points: ltvPoints, max: 15 }
  score += ltvPoints

  const rating = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'marginal' : 'poor'

  return {
    score: Math.round(score),
    rating,
    breakdown,
    metrics: {
      grossYield,
      dscr,
      stressDscr,
      stressPasses,
      cashOnCash,
      ltv,
      annualRent,
      annualMortgage,
      annualProfit,
      cashIn,
      loanAmount,
    },
  }
}

// ── FEATURE FLAGS ─────────────────────────────────────────────────────────────
export async function fetchFeatureFlags() {
  const { data, error } = await supabase.from('feature_flags').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function fetchFlagUserOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_users').select('*, user:user_id').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function fetchFlagCompanyOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_companies').select('*, company:companies(name,abbr,color)').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function createFeatureFlag({ key, name, description, enabled_globally }) {
  const { data, error } = await supabase.from('feature_flags').insert({ key, name, description, enabled_globally }).select().single()
  if (error) throw error
  return data
}

export async function updateFeatureFlag(key, updates) {
  const { error } = await supabase.from('feature_flags').update({ ...updates, updated_at: new Date().toISOString() }).eq('key', key)
  if (error) throw error
}

export async function deleteFeatureFlag(key) {
  const { error } = await supabase.from('feature_flags').delete().eq('key', key)
  if (error) throw error
}

export async function setFlagUserOverride(flagKey, userId, enabled) {
  const { error } = await supabase.from('feature_flag_users').upsert({ flag_key: flagKey, user_id: userId, enabled }, { onConflict: 'flag_key,user_id' })
  if (error) throw error
}

export async function removeFlagUserOverride(flagKey, userId) {
  const { error } = await supabase.from('feature_flag_users').delete().eq('flag_key', flagKey).eq('user_id', userId)
  if (error) throw error
}

export async function setFlagCompanyOverride(flagKey, companyId, enabled) {
  const { error } = await supabase.from('feature_flag_companies').upsert({ flag_key: flagKey, company_id: companyId, enabled }, { onConflict: 'flag_key,company_id' })
  if (error) throw error
}

export async function removeFlagCompanyOverride(flagKey, companyId) {
  const { error } = await supabase.from('feature_flag_companies').delete().eq('flag_key', flagKey).eq('company_id', companyId)
  if (error) throw error
}

// Check if a feature is enabled for current user (checks user override → company override → global)
export async function fetchMyActiveFlags() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return new Set()
    const [flagsRes, userOverridesRes, companyOverridesRes] = await Promise.all([
      supabase.from('feature_flags').select('key, enabled_globally'),
      supabase.from('feature_flag_users').select('flag_key, enabled').eq('user_id', u.id),
      supabase.from('feature_flag_companies').select('flag_key, enabled')
    ])
    const globalMap = {}
    ;(flagsRes.data || []).forEach(f => { globalMap[f.key] = f.enabled_globally })
    const userMap = {}
    ;(userOverridesRes.data || []).forEach(o => { userMap[o.flag_key] = o.enabled })
    const companyMap = {}
    ;(companyOverridesRes.data || []).forEach(o => {
      // If ANY of the user's companies has the flag ON, it's on
      if (o.enabled && companyMap[o.flag_key] !== true) companyMap[o.flag_key] = true
      else if (!o.enabled && companyMap[o.flag_key] === undefined) companyMap[o.flag_key] = false
    })
    const active = new Set()
    Object.keys(globalMap).forEach(k => {
      // Priority: user override → company override → global
      if (userMap[k] !== undefined) {
        if (userMap[k]) active.add(k)
      } else if (companyMap[k] !== undefined) {
        if (companyMap[k]) active.add(k)
      } else if (globalMap[k]) {
        active.add(k)
      }
    })
    return active
  } catch(e) {
    return new Set()
  }
}

// Bulk version: permissions for ALL my accessible companies
export async function fetchMyPermissionsMap(isDeveloper = false) {
  const map = {}
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return map
    if (isDeveloper) {
      const { data: cos } = await supabase.from('companies').select('id')
      ;(cos || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'developer' } })
      return map
    }
    const [ownedRes, accessRes] = await Promise.all([
      supabase.from('companies').select('id').eq('owner_id', user.id),
      supabase.from('user_company_access').select('company_id, role, is_admin, permissions').eq('user_id', user.id),
    ])
    ;(ownedRes.data || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'owner' } })
    ;(accessRes.data || []).forEach(a => {
      if (!map[a.company_id]) {
        map[a.company_id] = { ...getEffectivePermissions(a, false), _role: a.role || (a.is_admin ? 'admin' : 'editor') }
      }
    })
    return map
  } catch(e) {
    return map
  }
}

// ── DASHBOARD WIDGET + SECTION PREFS ─────────────────────────────────────────
// Stored per-user in user_profiles as JSONB arrays of { key, enabled }:
// dashboard_widgets (KPI cards) and dashboard_sections (page sections).
// Section order used to live only in localStorage, so it was lost on another
// device, browser, private window or storage clear.
export async function fetchWidgetPrefs() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return null
    const { data } = await supabase.from('user_profiles').select('dashboard_widgets').eq('user_id', u.id).single()
    return data?.dashboard_widgets || null
  } catch(e) { return null }
}

export async function fetchSectionPrefs() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return null
    const { data } = await supabase.from('user_profiles').select('dashboard_sections').eq('user_id', u.id).maybeSingle()
    return data?.dashboard_sections || null
  } catch(e) { return null }
}

// Upsert, not update: a user without a user_profiles row would otherwise
// "save" zero rows and report success.
async function saveDashboardPref(column, value) {
  const u = (await supabase.auth.getUser()).data.user
  if (!u) throw new Error('Not signed in')
  const { error } = await supabase.from('user_profiles')
    .upsert({ user_id: u.id, [column]: value }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function saveWidgetPrefs(widgets) {
  await saveDashboardPref('dashboard_widgets', widgets)
}

export async function saveSectionPrefs(sections) {
  await saveDashboardPref('dashboard_sections', sections)
}

// ── MTD ITSA (Making Tax Digital — Income Tax Self Assessment) ────────────────
// HMRC mandate hits 6 Apr 2026 for landlords > £50k income, 6 Apr 2027 > £30k.
// We provide per-user HMRC settings (NINO + business ID + OAuth tokens) and
// per-quarter submission rows with the aggregated income/expenses snapshot.

// Never select the HMRC token columns: anon/authenticated have no SELECT on
// them (2026-10-14_integration_token_column_grants.sql), so '*' would fail.
const MTD_SETTINGS_SAFE_COLS = 'user_id, nino, mtd_business_id, sandbox_mode, cash_basis, property_business_type, hmrc_token_expires_at, created_at, updated_at'

export async function fetchMtdSettings() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  // Explicit column list — never pull the OAuth tokens back to the client.
  // Token presence is exposed as the boolean `hmrc_oauth_connected` so the
  // UI can show whether the user has done the gov.uk handshake without
  // sending the actual token over the wire.
  const { data, error } = await supabase
    .from('mtd_settings')
    .select(MTD_SETTINGS_SAFE_COLS)
    .eq('user_id', uid).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    // Synthetic flag for UI gating — true if a non-expired access token exists.
    hmrc_access_token: !!(data.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function saveMtdSettings(patch) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  // Never let the client write OAuth tokens directly — those land via the
  // mtd-submit edge function during the HMRC OAuth callback.
  const safe = { ...patch }
  delete safe.hmrc_access_token
  delete safe.hmrc_refresh_token
  delete safe.encrypted_hmrc_access_token
  delete safe.encrypted_hmrc_refresh_token
  delete safe.hmrc_token_expires_at
  const { data, error } = await supabase
    .from('mtd_settings')
    .upsert({ user_id: uid, ...safe }, { onConflict: 'user_id' })
    .select(MTD_SETTINGS_SAFE_COLS).single()
  if (error) throw error
  return {
    ...data,
    // Same synthetic flag as fetchMtdSettings (the token itself is never read).
    hmrc_access_token: !!(data?.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function fetchMtdSubmissions(taxYear) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  let q = supabase.from('mtd_submissions').select('*').eq('user_id', uid)
  if (taxYear) q = q.eq('tax_year', taxYear)
  const { data, error } = await q.order('quarter_number', { ascending: true })
  if (error) throw error
  return data || []
}

export async function upsertMtdSubmission({ tax_year, quarter_number, period_from, period_to, deadline, summary_json, status = 'draft' }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('mtd_submissions')
    .upsert({
      user_id: uid, tax_year, quarter_number, period_from, period_to, deadline,
      summary_json, status,
    }, { onConflict: 'user_id,tax_year,quarter_number' })
    .select().single()
  if (error) throw error
  return data
}

// Aggregate the user's rent + expenses for a given period across ALL their
// personally held properties. Returns the raw rows so the caller can run
// buildQuarterlySummary from src/lib/mtdItsa.js client-side (keeps tax logic
// in one place).
export async function fetchMtdRawForPeriod({ periodFrom, periodTo, propertyIds = null }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')

  // Default: all user's non-deleted properties. Companies are also used as
  // plain portfolio groups (nearly every property has a company_id), so
  // company_id can't tell a limited-company holding from a personal one;
  // excluding company properties needs an explicit ownership flag first.
  // We also need mortgage_amount +
  // mortgage_rate so we can compute the period's mortgage interest accrual
  // (residential financial cost — gets 20% basic-rate relief under S24).
  let propIds = propertyIds
  let mortgageProps = []
  if (!propIds) {
    const { data: props, error: pe } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .eq('user_id', uid).is('deleted_at', null)
    if (pe) throw pe
    propIds = (props || []).map(p => p.id)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  } else {
    const { data: props } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .in('id', propIds).is('deleted_at', null)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  }
  if (propIds.length === 0) return { payments: [], expenses: [], mortgageInterest: 0 }

  // Legacy rows carry only year/month (period_start IS NULL) — a plain
  // gte/lte on period_start silently excludes them, understating MTD income.
  // Fetch NULL-period rows too, synthesise whole-month period dates from
  // year/month, then re-filter to the requested window client-side.
  const [paymentsRes, expensesRes] = await Promise.all([
    supabase.from('rent_payments').select('id, property_id, amount, period_start, period_end, status, year, month')
      .in('property_id', propIds)
      .in('status', RECEIVED_STATUSES)
      .or(`and(period_start.gte.${periodFrom},period_start.lte.${periodTo}),period_start.is.null`),
    supabase.from('property_expenses').select('id, property_id, amount, date, category, description')
      .in('property_id', propIds)
      .is('deleted_at', null)
      .gte('date', periodFrom).lte('date', periodTo),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (expensesRes.error) throw expensesRes.error

  const pad2 = (n) => String(n).padStart(2, '0')
  const payments = (paymentsRes.data || [])
    .map(p => {
      if (p.period_start || !p.year || !p.month) return p
      const lastDay = new Date(p.year, p.month, 0).getDate()
      return {
        ...p,
        period_start: `${p.year}-${pad2(p.month)}-01`,
        period_end: p.period_end || `${p.year}-${pad2(p.month)}-${pad2(lastDay)}`,
      }
    })
    .filter(p => p.period_start && p.period_start >= periodFrom && p.period_start <= periodTo)

  // Estimated mortgage interest accrued over the period =
  //   sum(balance × annual_rate) × (period_days / 365)
  // mortgage_rate is stored as DECIMAL (0.05 for 5%). Year-one approximation
  // (true interest declines as principal is paid down on repayment mortgages).
  // Properties with actual 'mortgage_interest' expenses recorded in the
  // period are left out of the estimate: the recorded figure is used instead.
  const expenses = expensesRes.data || []
  const mortgageInterest = estimateMortgageInterest({ mortgageProps, expenses, periodFrom, periodTo })

  return { payments, expenses, mortgageInterest }
}

// Start the HMRC gov.uk OAuth flow. Returns nothing — performs a
// full-page redirect to HMRC's authorize endpoint. After the user
// consents, HMRC redirects back to our hmrc-oauth-callback edge
// function which stores tokens + bounces user back here with
// ?hmrc_connected=1.
export async function startHmrcOAuth() {
  const { data, error } = await supabase.functions.invoke('hmrc-oauth-callback', {
    body: { action: 'start', return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('HMRC OAuth not configured — Justin needs to set HMRC_CLIENT_ID and add the redirect URI to the HMRC dev hub app.')
  window.location.href = data.authorize_url
}

// Clear the stored HMRC access + refresh tokens (next submission falls
// back to the local mock path). Keeps NINO / business ID / cash basis
// settings intact.
export async function disconnectHmrc() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase.from('mtd_settings').update({
    hmrc_access_token: null,
    hmrc_refresh_token: null,
    encrypted_hmrc_access_token: null,
    encrypted_hmrc_refresh_token: null,
    hmrc_token_expires_at: null,
  }).eq('user_id', uid)
  if (error) throw error
}

// Submit (or re-submit) a quarterly summary to HMRC via the mtd-submit
// edge function. In sandbox mode the edge function returns a mock
// reference; otherwise we collect Gov-Client-* fraud prevention headers
// (mandatory per HMRC's Fraud Prevention Spec — submissions without
// them are increasingly rejected in sandbox and always rejected in
// production) and pass them along so the edge function can forward
// them to HMRC.
export async function submitMtdQuarter(submissionId) {
  const fraudHeaders = await collectClientFraudHeaders()
  const { data, error } = await supabase.functions.invoke('mtd-submit', {
    body: { submission_id: submissionId, fraud_headers: fraudHeaders }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── XERO INTEGRATION ─────────────────────────────────────────────────────────
//
// Phase 2 (24 May 2026): multi-company. xero_connections is now keyed by
// (user_id, company_id) so a user with multiple OwnProperly companies can
// link a SEPARATE Xero org per company. Most helpers take companyId.

// Returns ALL of the user's Xero connections (one per company).
export async function fetchXeroConnections() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('xero_connections')
    .select('user_id, company_id, tenant_id, tenant_name, expires_at, scopes, last_sync_at, last_sync_status, last_sync_error, created_at')
    .eq('user_id', uid)
  if (error) throw error
  return data || []
}

// Start the Xero OAuth flow for a SPECIFIC company. The companyId is
// encoded in the state token so the callback knows which company to
// associate the new tokens with.
export async function startXeroOAuth(companyId) {
  if (!companyId) throw new Error('companyId required — Xero connections are per-company')
  const { data, error } = await supabase.functions.invoke('xero-oauth-callback', {
    body: { action: 'start', company_id: companyId, return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('Xero auth not configured — Justin needs to set XERO_CLIENT_ID')
  window.location.href = data.authorize_url
}

export async function disconnectXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase
    .from('xero_connections').delete()
    .eq('user_id', uid).eq('company_id', companyId)
  if (error) throw error
}

export async function runXeroSync(companyId, direction = 'to_xero') {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { direction, company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// What a push would post (counts, totals, bank, start date) without
// posting. The UI shows it in a confirm dialog before every manual push.
export async function previewXeroSync(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'preview', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Delete from Xero the transactions the latest push posted. dryRun only
// counts them.
export async function undoXeroPush(companyId, { dryRun = false } = {}) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'undo_push', company_id: companyId, dry_run: dryRun }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── Per-(user,company) Xero sync settings ──────────────────────────────

export async function fetchXeroSyncSettings(companyId) {
  if (!companyId) return null
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('xero_sync_settings').select('*')
    .eq('user_id', uid).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveXeroSyncSettings(companyId, patch) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const safe = { ...patch }
  // Server-managed fields the client shouldn't write
  delete safe.user_id; delete safe.company_id
  delete safe.created_at; delete safe.updated_at
  const { data, error } = await supabase
    .from('xero_sync_settings')
    .upsert({ user_id: uid, company_id: companyId, ...safe }, { onConflict: 'user_id,company_id' })
    .select().single()
  if (error) throw error
  return data
}

// Live-fetch the user's chart of accounts + bank accounts from Xero so
// the UI can render <select> dropdowns for the user to pick which
// account codes to use. Calls xero-sync with action='list_accounts'.
export async function fetchXeroAccounts(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'list_accounts', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.accounts || []
}

// Sync only specific properties (per-property "Sync just this one" button).
export async function runXeroSyncForProperties(companyId, propertyIds) {
  if (!companyId) throw new Error('companyId required')
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) throw new Error('propertyIds required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'both', company_id: companyId, property_ids: propertyIds }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Wipe the sync map for this (user, company). After this, the next
// normal sync re-pushes everything. Used by the "Re-sync everything"
// button after the user has cleared records on the Xero side.
export async function resyncAllXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'resync_all', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.cleared || 0
}
