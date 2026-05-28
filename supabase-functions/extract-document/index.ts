// Document extractor — Claude-powered, single-pass, auto-detecting.
//
// Input: { document_id: string, doc_type_hint?: string }
//
// Flow:
//   1. Download document from Storage.
//   2. Call Claude Sonnet 4.5 with a universal prompt that returns:
//        - document_type (auto-detected)
//        - document_type_confidence (high/medium/low)
//        - fields (the type-specific structured data)
//        - property_address_text + postcode (for matching)
//        - primary_expiry_date (for compliance auto-create)
//        - human_summary
//   3. If any required field for the detected type is null OR confidence
//      is 'low', retry with Claude Opus 4.7 (better OCR on hand-scans).
//   4. Fuzzy-match the extracted address against the user's properties
//      (postcode first, then street-name substring). Attach matched_
//      property_id + match_confidence.
//   5. If doc is a compliance certificate AND we matched a property AND
//      we have an expiry date, upsert a compliance_items row so the
//      property's Compliance tab + reminder cron pick it up automatically.
//   6. If the user uploaded with category='other' but Claude detected
//      a specific type with high confidence, update the document's
//      category so future filters/searches behave correctly.
//
// User input `doc_type_hint` is treated as a hint only — Claude can
// override if confidence is high, which catches the common case of the
// user dropping a Gas Safety cert into "Other" by accident.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Models we use. Sonnet is the right cost/accuracy balance for first pass;
// Opus only when confidence drops. Keep these as constants so they're easy
// to swap when a new model lands.
const MODEL_PRIMARY  = 'claude-sonnet-4-5'
const MODEL_FALLBACK = 'claude-opus-4-7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Universal prompt ──────────────────────────────────────────────────
// Returns BOTH the detected document type AND the type-specific fields
// in a single Claude call. The `fields` shape varies by type but Claude
// is good at returning the right schema once primed with the catalogue
// of valid types below.

const UNIVERSAL_PROMPT = `You are extracting structured data from a UK landlord document.

STEP 1: Identify the document type. It will be ONE of:
  - gas_cert        (Gas Safety Record / CP12)
  - eicr            (Electrical Installation Condition Report)
  - epc             (Energy Performance Certificate)
  - insurance       (landlord insurance policy schedule)
  - tenancy_agreement (Assured Shorthold Tenancy or similar)
  - receipt         (purchase / expense receipt or invoice)
  - mortgage_offer  (BTL mortgage offer or facility agreement)
  - other           (anything else — bank statement, letter, ID, photo, etc.)

STEP 2: For the detected type, extract the structured fields per the schemas below.

STEP 3: Always also extract:
  - property_address_text (the full property address as printed, if present)
  - property_postcode (UK postcode in standard form e.g. "SE1 7TP", if present)
  - primary_expiry_date (the most relevant expiry / renewal date for this doc — null if N/A)
  - human_summary (one short sentence describing the document)
  - confidence ("high", "medium", or "low" — how sure you are about the document_type)

Return ONLY a single JSON object with this top-level shape:

{
  "document_type": "<one of the types above>",
  "confidence": "high|medium|low",
  "property_address_text": "string|null",
  "property_postcode": "string|null",
  "primary_expiry_date": "DD/MM/YYYY|null",
  "human_summary": "string",
  "fields": { ...the type-specific schema... }
}

TYPE-SPECIFIC FIELD SCHEMAS for the "fields" object:

gas_cert: {
  "engineer_name": "string|null",
  "gas_safe_number": "string|null",
  "inspection_date": "DD/MM/YYYY|null",
  "expiry_date": "DD/MM/YYYY|null",
  "appliances": ["string"],
  "overall_pass": "boolean|null"
}

eicr: {
  "contractor_name": "string|null",
  "niceic_number": "string|null",
  "inspection_date": "DD/MM/YYYY|null",
  "expiry_date": "DD/MM/YYYY|null",
  "overall_result": "satisfactory|unsatisfactory|null",
  "c1_count": "number|null",
  "c2_count": "number|null",
  "fi_count": "number|null"
}

epc: {
  "rating": "A|B|C|D|E|F|G|null",
  "score": "number|null",
  "valid_from": "DD/MM/YYYY|null",
  "expiry_date": "DD/MM/YYYY|null",
  "certificate_number": "string|null"
}

insurance: {
  "insurer": "string|null",
  "policy_number": "string|null",
  "cover_start": "DD/MM/YYYY|null",
  "cover_end": "DD/MM/YYYY|null",
  "annual_premium": "number|null",
  "building_sum_insured": "number|null",
  "contents_sum_insured": "number|null"
}

tenancy_agreement: {
  "landlord_name": "string|null",
  "tenant_names": ["string"],
  "tenancy_start_date": "DD/MM/YYYY|null",
  "tenancy_end_date": "DD/MM/YYYY|null",
  "rent_monthly": "number (GBP, no currency symbol)|null",
  "rent_frequency": "monthly|weekly|annual|null",
  "deposit_amount": "number|null",
  "deposit_scheme": "string|null",
  "break_clause": "string|null",
  "notice_period_days": "number|null"
}

receipt: {
  "merchant_name": "string|null",
  "amount": "number (TOTAL of the receipt, GBP, no currency symbol)|null",
  "date": "DD/MM/YYYY|null",
  "category": "string (e.g. maintenance, utilities, professional, agent_fees, cleaning, garden, compliance, other)|null",
  "description": "string (short — what was purchased)|null",
  "vat_amount": "number|null",
  "payment_method": "card|cash|bank_transfer|null"
}

mortgage_offer: {
  "lender": "string|null",
  "borrower_names": ["string"],
  "loan_amount": "number|null",
  "interest_rate_percent": "number|null",
  "term_years": "number|null",
  "product_end_date": "DD/MM/YYYY|null",
  "product_type": "fixed|variable|tracker|null",
  "repayment_type": "repayment|interest_only|mixed|bridging|null",
  "monthly_repayment": "number|null",
  "arrangement_fees": "number|null",
  "drawdown_date": "DD/MM/YYYY|null",
  "is_facility_agreement": "boolean|null"
}

other: {
  "key_dates": [{ "label": "string", "date": "DD/MM/YYYY" }],
  "key_amounts": [{ "label": "string", "amount": "number" }],
  "parties": ["string"]
}

Use null (not "null") for any missing fields. Use UK date format DD/MM/YYYY.
Return ONLY the JSON object — no markdown fences, no explanation.`

// Which fields are required to consider an extraction "complete" for each
// type. Used to decide whether to fall back to Opus on a poor first pass.
const REQUIRED_FIELDS: Record<string, string[]> = {
  gas_cert: ['engineer_name', 'expiry_date'],
  eicr: ['contractor_name', 'expiry_date'],
  epc: ['rating', 'expiry_date'],
  insurance: ['insurer', 'cover_end'],
  tenancy_agreement: ['rent_monthly'],
  receipt: ['amount', 'date'],
  mortgage_offer: ['lender', 'loan_amount'],
  other: [],
}

// Which types create a compliance_items row when auto-linked. Maps the
// detected document_type → the compliance.cert_type value used elsewhere
// in the codebase (Property → Compliance tab + compliance-reminders cron).
const COMPLIANCE_TYPE_MAP: Record<string, string> = {
  gas_cert: 'gas_safety',
  eicr: 'eicr',
  epc: 'epc',
  insurance: 'insurance',
}

// Normalise a string for fuzzy matching — strip non-alphanumerics, lowercase.
function normalise(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

// Pull UK postcodes out of free text. Captures both standard ('SE1 7TP') and
// no-space ('SE17TP') forms.
function extractPostcodes(text: string): string[] {
  if (!text) return []
  const re = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].replace(/\s+/g, '').toUpperCase())
  }
  return out
}

// Match the extracted address against the user's properties.
// Strategy:
//   1. Postcode match → highest confidence (UK postcodes are usually unique
//      to a building, sometimes a small block).
//   2. Fall back to street-name + number substring match.
//   3. Return null if nothing matches at all.
function matchPropertyAddress(
  extractedAddress: string | null,
  extractedPostcode: string | null,
  properties: { id: string; name: string; address: string }[],
): { property_id: string; match_confidence: 'high' | 'medium' | 'low' } | null {
  if (!properties || properties.length === 0) return null

  // 1. Postcode match
  if (extractedPostcode) {
    const target = extractedPostcode.replace(/\s+/g, '').toUpperCase()
    const matches = properties.filter(p => {
      const postcodes = extractPostcodes(p.address || '')
      return postcodes.includes(target)
    })
    if (matches.length === 1) return { property_id: matches[0].id, match_confidence: 'high' }
    // Multiple matches by postcode (block of flats with shared postcode) —
    // fall through to address-substring disambiguation below.
    if (matches.length > 1 && extractedAddress) {
      const targetN = normalise(extractedAddress)
      // Pick the property whose address shares the most word tokens with the
      // extracted address (Flat 1 etc.).
      const scored = matches.map(p => {
        const pn = normalise(p.address || '')
        const pname = normalise(p.name || '')
        // Count overlapping word tokens (length >= 3 to skip short words).
        const targetTokens = new Set(targetN.split(' ').filter(t => t.length >= 3))
        const score = (pn + ' ' + pname).split(' ').filter(t => targetTokens.has(t)).length
        return { p, score }
      }).sort((a, b) => b.score - a.score)
      if (scored[0].score > scored[1]?.score) {
        return { property_id: scored[0].p.id, match_confidence: 'medium' }
      }
    }
  }

  // 2. Street-substring fall-back. Look for properties whose address shares
  // multi-word substrings with the extracted address.
  if (extractedAddress) {
    const targetN = normalise(extractedAddress)
    const targetTokens = targetN.split(' ').filter(t => t.length >= 3)
    if (targetTokens.length === 0) return null

    const scored = properties.map(p => {
      const pn = normalise(p.address || '') + ' ' + normalise(p.name || '')
      const tokens = pn.split(' ').filter(t => t.length >= 3)
      let score = 0
      for (const t of targetTokens) if (tokens.includes(t)) score++
      return { p, score }
    }).sort((a, b) => b.score - a.score)

    // Need at least 2 overlapping tokens to consider it a match, and the
    // top score must clearly beat the second-best (1+ ahead).
    if (scored[0].score >= 2 && scored[0].score > (scored[1]?.score || 0)) {
      return { property_id: scored[0].p.id, match_confidence: 'low' }
    }
  }

  return null
}

// Reformat DD/MM/YYYY → YYYY-MM-DD for Postgres date columns.
function ukDateToIso(d: string | null | undefined): string | null {
  if (!d || typeof d !== 'string') return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Call Claude. Returns the parsed JSON object (or throws).
async function callClaude(model: string, base64: string, mimeType: string): Promise<any> {
  const contentType = mimeType.startsWith('image/') ? 'image' : 'document'
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: [
          contentType === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
            : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: UNIVERSAL_PROMPT },
        ],
      }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${model} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const textResponse: string = data.content?.[0]?.text || ''
  const clean = textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch (e) {
    // If JSON parse fails, return a salvageable error envelope instead of
    // throwing — the caller can decide whether to retry or give up.
    return { _parse_error: (e as Error).message, _raw_response: textResponse }
  }
}

// Decide whether the first-pass extraction is good enough or we should
// retry with Opus. Returns true if any required field for the detected
// type is null/missing OR confidence is 'low'.
function needsFallback(extracted: any): boolean {
  if (!extracted || extracted._parse_error) return true
  if (extracted.confidence === 'low') return true
  const type = extracted.document_type
  const requiredKeys = REQUIRED_FIELDS[type] || []
  const fields = extracted.fields || {}
  for (const k of requiredKeys) {
    const v = fields[k]
    if (v === null || v === undefined || v === '') return true
  }
  return false
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authenticate caller. Extraction must be tied to the calling user's
  // ownership of the document.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  let documentId: string | null = null

  try {
    const reqBody = await req.json()
    documentId = reqBody.document_id
    if (!documentId) throw new Error('document_id required')

    // Fetch the document row.
    const { data: doc, error: docErr } = await admin
      .from('property_documents')
      .select('id, file_path, category, file_type, user_id, property_id')
      .eq('id', documentId)
      .single()
    if (docErr || !doc) throw new Error('Document not found')

    // Ownership check — only the document's owner (or a platform admin)
    // may trigger extraction.
    if (doc.user_id !== caller.id) {
      const { data: prof } = await admin
        .from('user_profiles')
        .select('is_developer, platform_admin')
        .eq('user_id', caller.id)
        .single()
      const isPlatformAdmin = prof?.is_developer === true || prof?.platform_admin === true
      if (!isPlatformAdmin) return jsonError(403, 'Forbidden')
    }

    await admin.from('property_documents')
      .update({ extraction_status: 'processing' })
      .eq('id', documentId)

    // Download file from Storage.
    const { data: fileData, error: fileErr } = await admin.storage
      .from('property-documents')
      .download(doc.file_path)
    if (fileErr || !fileData) throw new Error('Could not download file: ' + (fileErr?.message || 'unknown'))

    // Convert to base64 in 32KB chunks to avoid stack overflow on large PDFs.
    const buf = await fileData.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.byteLength; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
    }
    const base64 = btoa(binary)
    const mimeType = doc.file_type || 'application/pdf'

    // PASS 1: Sonnet 4.5 — fast, accurate.
    let extracted = await callClaude(MODEL_PRIMARY, base64, mimeType)
    let modelUsed = MODEL_PRIMARY
    let fellBack = false

    // PASS 2 (conditional): Opus 4.7 if required fields missing or low confidence.
    if (needsFallback(extracted)) {
      try {
        const opusResult = await callClaude(MODEL_FALLBACK, base64, mimeType)
        // Prefer Opus result unless it's worse (parse error).
        if (!opusResult._parse_error) {
          extracted = opusResult
          modelUsed = MODEL_FALLBACK
          fellBack = true
        }
      } catch (e) {
        // Opus failed too — keep the Sonnet result, just log it.
        console.warn('[extract-document] Opus fallback failed:', (e as Error).message)
      }
    }

    // ── Property auto-matching ────────────────────────────────────
    // Pull the user's properties (not deleted) so we can match the
    // extracted address against them. Constrain to a sensible cap so
    // a user with 500 properties doesn't trip a timeout.
    const { data: properties } = await admin
      .from('properties')
      .select('id, name, address')
      .eq('user_id', doc.user_id)
      .is('deleted_at', null)
      .limit(500)

    const matchResult = matchPropertyAddress(
      extracted?.property_address_text || null,
      extracted?.property_postcode || null,
      properties || [],
    )

    // Attach the match into the extracted blob so the UI can show it.
    if (matchResult) {
      extracted.matched_property_id = matchResult.property_id
      extracted.match_confidence = matchResult.match_confidence
    }

    // ── Auto-link to property if doc has no property_id yet ──────────
    // If the document was uploaded WITHOUT a property association (e.g.
    // bulk-uploaded inbox, statement importer) and we found a high-confidence
    // match, attach the property_id so it filters into the right view.
    let docUpdates: Record<string, any> = {
      extraction_status: 'completed',
      extracted_fields: extracted,
      extracted_at: new Date().toISOString(),
      extraction_error: null,
    }
    if (!doc.property_id && matchResult && matchResult.match_confidence === 'high') {
      docUpdates.property_id = matchResult.property_id
    }

    // ── Auto-update category if it was 'other' but we detected something specific ──
    const detectedType = extracted?.document_type
    if ((!doc.category || doc.category === 'other') && detectedType && detectedType !== 'other' && extracted.confidence === 'high') {
      // Map back to the short codes the UI uses
      const reverseAlias: Record<string, string> = {
        gas_cert: 'gas',
        tenancy_agreement: 'tenancy',
        mortgage_offer: 'mortgage',
      }
      docUpdates.category = reverseAlias[detectedType] || detectedType
    }

    await admin.from('property_documents').update(docUpdates).eq('id', documentId)

    // ── Auto-create compliance_items row for compliance certs ─────────
    // When the doc is a compliance certificate (gas/eicr/epc/insurance),
    // we matched it to a property, and Claude extracted an expiry date —
    // create or update the compliance_items row so the Compliance tab
    // and the reminder cron pick it up automatically.
    let complianceRowId: string | null = null
    const finalPropertyId = docUpdates.property_id || doc.property_id || matchResult?.property_id
    if (finalPropertyId && detectedType && COMPLIANCE_TYPE_MAP[detectedType]) {
      const certType = COMPLIANCE_TYPE_MAP[detectedType]
      const expiryDate = ukDateToIso(extracted?.primary_expiry_date || extracted?.fields?.expiry_date || extracted?.fields?.cover_end)
      const issuer = extracted?.fields?.engineer_name
        || extracted?.fields?.contractor_name
        || extracted?.fields?.insurer
        || null

      if (expiryDate) {
        // Upsert on (property_id, cert_type). If a row already exists with
        // a LATER expiry date, don't override — the user might be uploading
        // an older version of the same cert.
        const { data: existing } = await admin
          .from('compliance_items')
          .select('id, expiry_date')
          .eq('property_id', finalPropertyId)
          .eq('cert_type', certType)
          .is('deleted_at', null)
          .maybeSingle()

        if (existing) {
          if (!existing.expiry_date || new Date(existing.expiry_date) <= new Date(expiryDate)) {
            await admin.from('compliance_items')
              .update({
                expiry_date: expiryDate,
                issuer: issuer || undefined,
                document_id: documentId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id)
            complianceRowId = existing.id
          }
        } else {
          const { data: inserted } = await admin.from('compliance_items')
            .insert({
              property_id: finalPropertyId,
              cert_type: certType,
              expiry_date: expiryDate,
              issuer,
              document_id: documentId,
              user_id: caller.id,
            })
            .select('id').single()
          complianceRowId = inserted?.id || null
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      extracted,
      model_used: modelUsed,
      fell_back_to_opus: fellBack,
      matched_property_id: matchResult?.property_id || null,
      match_confidence: matchResult?.match_confidence || null,
      compliance_row_id: complianceRowId,
      auto_linked_property: !!docUpdates.property_id && !doc.property_id,
      auto_recategorised: docUpdates.category !== undefined && docUpdates.category !== doc.category,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const errMsg = (e as Error).message
    if (documentId) {
      try {
        await admin.from('property_documents').update({
          extraction_status: 'failed',
          extraction_error: errMsg.slice(0, 500),
        }).eq('id', documentId)
      } catch {}
    }
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
