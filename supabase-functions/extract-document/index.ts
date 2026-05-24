// Extracts structured fields from an uploaded document using Anthropic's Claude API.
// Input: { document_id: string }
// Reads the document from Storage, sends to Claude with a type-specific prompt,
// stores the structured JSON back in property_documents.extracted_fields.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Prompt templates for different doc types
function buildPrompt(docType: string): string {
  const base = 'Extract ALL factual information from this document. Return ONLY a valid JSON object, no explanation. Use null for missing fields. Use UK date format DD/MM/YYYY for dates.'
  const schemas: Record<string, string> = {
    tenancy_agreement: `{
      "landlord_name": "string|null",
      "tenant_names": ["string"],
      "property_address": "string|null",
      "tenancy_start_date": "DD/MM/YYYY|null",
      "tenancy_end_date": "DD/MM/YYYY|null",
      "rent_monthly": "number (GBP, no currency symbol)|null",
      "rent_frequency": "monthly|weekly|annual|null",
      "deposit_amount": "number|null",
      "deposit_scheme": "string|null",
      "break_clause": "string|null",
      "notice_period_days": "number|null"
    }`,
    gas_cert: `{
      "engineer_name": "string|null",
      "gas_safe_number": "string|null",
      "property_address": "string|null",
      "inspection_date": "DD/MM/YYYY|null",
      "expiry_date": "DD/MM/YYYY|null",
      "appliances": ["string"],
      "overall_pass": "boolean|null"
    }`,
    eicr: `{
      "contractor_name": "string|null",
      "niceic_number": "string|null",
      "property_address": "string|null",
      "inspection_date": "DD/MM/YYYY|null",
      "expiry_date": "DD/MM/YYYY|null",
      "overall_result": "satisfactory|unsatisfactory|null",
      "c1_count": "number|null",
      "c2_count": "number|null",
      "fi_count": "number|null"
    }`,
    epc: `{
      "property_address": "string|null",
      "rating": "A|B|C|D|E|F|G|null",
      "score": "number|null",
      "valid_from": "DD/MM/YYYY|null",
      "expiry_date": "DD/MM/YYYY|null",
      "certificate_number": "string|null"
    }`,
    insurance: `{
      "insurer": "string|null",
      "policy_number": "string|null",
      "property_address": "string|null",
      "cover_start": "DD/MM/YYYY|null",
      "cover_end": "DD/MM/YYYY|null",
      "annual_premium": "number|null",
      "building_sum_insured": "number|null",
      "contents_sum_insured": "number|null"
    }`,
    receipt: `{
      "merchant_name": "string|null",
      "amount": "number (the TOTAL of the receipt, GBP, no currency symbol)|null",
      "date": "DD/MM/YYYY|null",
      "category": "string (e.g. maintenance, utilities, professional, agent_fees, cleaning, garden, compliance, other)|null",
      "description": "string (short — what was purchased)|null",
      "vat_amount": "number|null",
      "payment_method": "card|cash|bank_transfer|null"
    }`,
    mortgage_offer: `{
      "lender": "string|null",
      "borrower_names": ["string"],
      "property_address": "string|null",
      "loan_amount": "number|null",
      "interest_rate_percent": "number|null",
      "term_years": "number|null",
      "product_end_date": "DD/MM/YYYY|null",
      "product_type": "fixed|variable|tracker|null",
      "repayment_type": "repayment|interest_only|mixed|bridging|null",
      "monthly_repayment": "number|null",
      "arrangement_fees": "number|null",
      "drawdown_date": "DD/MM/YYYY|null",
      "is_facility_agreement": "boolean (true if this looks like a multi-property/portfolio loan facility, not a single residential mortgage)|null"
    }`,
  }
  // The DocumentsTab UI uses short category codes ('gas', 'eicr', 'epc',
  // 'tenancy', 'insurance', 'mortgage'). Map them to the schema keys here so
  // either the short code or the explicit key works.
  const aliases: Record<string, string> = {
    gas: 'gas_cert',
    tenancy: 'tenancy_agreement',
    mortgage: 'mortgage_offer',
  }
  const key = aliases[docType] || docType
  const schema = schemas[key] || `{
    "document_type": "string",
    "key_dates": [{ "label": "string", "date": "DD/MM/YYYY" }],
    "key_amounts": [{ "label": "string", "amount": "number" }],
    "parties": ["string"],
    "property_address": "string|null",
    "summary": "string (max 2 sentences)"
  }`
  return base + '\n\nReturn JSON matching this shape:\n' + schema
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authenticate caller. Reject anonymous / service-role calls — extraction is
  // always user-initiated, and access must be tied to the calling user's
  // ownership of the document.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization header')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid or expired session')

  try {
    const { document_id } = await req.json()
    if (!document_id) throw new Error('document_id required')

    // Fetch the document row.
    // Schema uses file_path / category / file_type (not storage_path / doc_type / mime_type).
    const { data: doc, error: docErr } = await admin
      .from('property_documents')
      .select('id, file_path, category, file_type, user_id')
      .eq('id', document_id)
      .single()

    if (docErr || !doc) throw new Error('Document not found')

    // Ownership check — only the document's owner (or a platform admin)
    // may trigger extraction. Without this anyone with a valid JWT can
    // read any document's extracted fields by guessing the UUID.
    if (doc.user_id !== caller.id) {
      const { data: prof } = await admin
        .from('user_profiles')
        .select('is_developer, platform_admin')
        .eq('user_id', caller.id)
        .single()
      const isPlatformAdmin = prof?.is_developer === true || prof?.platform_admin === true
      if (!isPlatformAdmin) return jsonError(403, 'Forbidden')
    }

    // Mark as processing
    await admin.from('property_documents').update({ extraction_status: 'processing' }).eq('id', document_id)

    // Download file from Storage (uses service role — bypasses RLS, works
    // whether bucket is public or private).
    const { data: fileData, error: fileErr } = await admin.storage
      .from('property-documents')
      .download(doc.file_path)

    if (fileErr || !fileData) throw new Error('Could not download file: ' + (fileErr?.message || 'unknown'))

    // Convert to base64
    const buf = await fileData.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    const prompt = buildPrompt(doc.category || 'other')
    const mimeType = doc.file_type || 'application/pdf'
    const contentType = mimeType.startsWith('image/') ? 'image' : 'document'

    // Call Anthropic
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Haiku 4.5 is fast, cheap, and plenty accurate for structured field
        // extraction from PDFs/images. Switched from sonnet-4-5 (~5x cost
        // for similar accuracy on this task). If extraction quality drops on
        // hand-scanned documents, fall back to claude-opus-4-7.
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            contentType === 'image'
              ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
              : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error('Anthropic API error (' + anthropicRes.status + '): ' + errText.slice(0, 300))
    }

    const anthropicData = await anthropicRes.json()
    const textResponse = anthropicData.content?.[0]?.text || ''

    // Parse JSON out of the response
    let extracted: any = null
    try {
      // Strip markdown code fences if present
      const clean = textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      extracted = JSON.parse(clean)
    } catch (parseErr) {
      // Fall back: store as raw text
      extracted = { _raw_response: textResponse, _parse_error: (parseErr as Error).message }
    }

    // Save back to the document row
    await admin
      .from('property_documents')
      .update({
        extraction_status: 'completed',
        extracted_fields: extracted,
        extracted_at: new Date().toISOString(),
        extraction_error: null,
      })
      .eq('id', document_id)

    return new Response(JSON.stringify({ success: true, extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const errMsg = (e as Error).message
    // Try to mark failed if we have a document_id
    try {
      const { document_id } = await req.clone().json().catch(() => ({}))
      if (document_id) {
        await admin.from('property_documents').update({
          extraction_status: 'failed',
          extraction_error: errMsg.slice(0, 500),
        }).eq('id', document_id)
      }
    } catch {}

    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
