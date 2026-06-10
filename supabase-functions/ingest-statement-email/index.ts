// Inbound statement email handler — Postmark webhook receiver.
//
// Postmark forwards every email sent to <token>@inbox.ownproperly.com
// to this endpoint as a JSON POST. We:
//   1. Extract the token from the TO address
//   2. Look up the company in `companies.statement_email_token`
//   3. Save each PDF attachment to property-documents storage
//   4. Create a property_documents row, marked category='statement'
//   5. Trigger AI extraction via the existing extract-document fn path
//      (inline here to avoid an extra round-trip)
//   6. Drop a bell notification: "📨 New statement received — review + import"
//
// We DON'T auto-write rent_payments. Statement parsing is fuzzy enough
// (different agents have different formats, addresses may not map
// cleanly, rounding etc) that the safe pattern is human-in-the-loop:
// extraction populates structured fields, user clicks the bell, the
// existing StatementImporter pre-fills with the extracted data, user
// confirms + saves. No accidental wrong-property posts.
//
// Postmark webhook docs: https://postmarkapp.com/developer/user-guide/inbound
//
// Required env vars (set in Supabase Dashboard → Edge Functions →
// Secrets):
//   - POSTMARK_INBOUND_TOKEN  (shared secret for verifying webhook auth.
//                              REQUIRED — the function rejects every POST
//                              with 401 until it is set. Configure the same
//                              value as the Basic-auth password on the
//                              Postmark inbound webhook URL.)
//
// IMPORTANT — verify_jwt MUST be false when deploying. Postmark won't
// send a JWT; the signature check below replaces that auth.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY     = Deno.env.get('ANTHROPIC_API_KEY')!
const POSTMARK_TOKEN        = Deno.env.get('POSTMARK_INBOUND_TOKEN') || ''
const INBOX_DOMAIN          = (Deno.env.get('INBOX_DOMAIN') || 'inbox.ownproperly.com').toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Postmark sends Basic Auth on the webhook when configured. The shared
// secret is mandatory — without it we fail CLOSED (401 on every POST)
// rather than trusting URL secrecy, which doesn't hold (the project ref
// ships in the SPA bundle).
if (!POSTMARK_TOKEN) {
  console.error('POSTMARK_INBOUND_TOKEN is not set — rejecting all inbound email until it is configured')
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function isAuthorised(req: Request): boolean {
  if (!POSTMARK_TOKEN) return false
  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('basic ')) return false
  try {
    const decoded = atob(auth.slice(6))
    const pass = decoded.slice(decoded.indexOf(':') + 1)
    return timingSafeEqual(pass, POSTMARK_TOKEN)
  } catch { return false }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }
  if (!isAuthorised(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 })
  }

  try {
    // ── 1. Find OUR address in the TO list and extract the token ──
    const toAddrs: string[] = (payload.ToFull || [])
      .map((t: any) => (t.Email || '').toLowerCase())
      .filter((e: string) => e.endsWith('@' + INBOX_DOMAIN))
    if (toAddrs.length === 0) {
      // Not addressed to us at all — silently 200 so Postmark doesn't retry
      console.log('Email had no TO matching our inbox domain')
      return new Response(JSON.stringify({ ok: true, ignored: 'no_match' }))
    }
    const token = toAddrs[0].split('@')[0]

    // ── 2. Look up the company ──
    const { data: company } = await admin
      .from('companies')
      .select('id, name, owner_id')
      .eq('statement_email_token', token)
      .is('deleted_at', null)
      .maybeSingle()
    if (!company) {
      console.log('Unknown token:', token)
      // Still 200 — don't bounce, just drop. Reduces inbox abuse surface.
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown_token' }))
    }

    // ── 3. Save attachments ──
    // Accept PDFs AND images — the UI (CompanyInboxPanel) tells users we take
    // "PDF and image attachments", and many agents send scanned/photographed
    // statements. Claude reads both (PDF as a document block, images as image
    // blocks — see extractDocumentInline).
    const attachments = (payload.Attachments || []) as any[]
    const pdfs = attachments.filter(a => {
      const ct = (a.ContentType || '').toLowerCase()
      const nm = (a.Name || '').toLowerCase()
      return ct === 'application/pdf'
        || ct.startsWith('image/')
        || /\.(pdf|jpe?g|png|webp|heic|heif|gif)$/.test(nm)
    })
    if (pdfs.length === 0) {
      console.log('Email had no PDF/image attachments — ignoring')
      return new Response(JSON.stringify({ ok: true, ignored: 'no_attachments', sender: payload.From }))
    }

    // We need a property_id for the doc — schema requires it. Use the first
    // non-deleted property of the company purely as a CONTAINER anchor: a
    // single statement often spans many properties, and the real per-line
    // property mapping happens later in the StatementImporter when the user
    // reviews the extracted items. So this anchor is not a claim about which
    // property the money belongs to.
    const { data: firstProp } = await admin
      .from('properties')
      .select('id')
      .eq('company_id', company.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (!firstProp) {
      console.log('Company has no properties to attach doc to:', company.name)
      return new Response(JSON.stringify({ ok: true, ignored: 'no_properties' }))
    }

    const docIds: string[] = []
    for (const att of pdfs) {
      const safeName = (att.Name || 'statement.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      const path = `statements/${company.id}/${Date.now()}_${safeName}`

      // Postmark sends attachments base64-encoded inline
      const fileBytes = Uint8Array.from(atob(att.Content || ''), c => c.charCodeAt(0))
      const { error: upErr } = await admin.storage
        .from('property-documents')
        .upload(path, fileBytes, { contentType: att.ContentType || 'application/pdf', upsert: false })
      if (upErr) { console.error('upload failed', upErr); continue }

      const { data: doc, error: docErr } = await admin.from('property_documents').insert({
        property_id: firstProp.id,
        user_id: company.owner_id,
        name: att.Name || 'Rental statement',
        file_path: path,
        file_type: att.ContentType || 'application/pdf',
        file_size: att.ContentLength || fileBytes.length,
        category: 'statement',
        extraction_status: 'pending',
      }).select('id').single()
      if (docErr || !doc) { console.error('doc insert failed', docErr); continue }
      docIds.push(doc.id)

      // ── 4. Fire extraction inline so the user sees structured data
      // ready when they click the notification.
      extractDocumentInline(doc.id, path, att.ContentType || 'application/pdf').catch(e =>
        console.error('extract failed for', doc.id, e)
      )
    }

    // ── 5. Drop a notification for the company owner ──
    const fromName = payload.FromName || payload.From || 'an agent'
    const summary = pdfs.length === 1
      ? `${fromName} sent a rental statement`
      : `${fromName} sent ${pdfs.length} rental statement files`
    await admin.from('notifications').insert({
      user_id: company.owner_id,
      type: 'statement_received',
      title: `📨 New statement for ${company.name}`,
      body: `${summary}. Click to review and import.`,
      link: '#/import-statement?docs=' + docIds.join(','),
      metadata: { company_id: company.id, document_ids: docIds, sender: payload.From },
    })

    return new Response(JSON.stringify({ ok: true, company: company.name, pdfs_received: pdfs.length, doc_ids: docIds }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('ingest-statement-email failed', e)
    // Return 200 with error in body — we don't want Postmark to retry
    // a request that hit a code bug; we want to fix the bug and resend
    // manually from the Postmark dashboard if needed.
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// Run extract-document's logic inline (no second HTTP round-trip).
// We can't easily call our own edge function from another edge function
// without an auth dance, so we copy the relevant bit here.
async function extractDocumentInline(documentId: string, storagePath: string, mimeType: string) {
  // Mark processing
  await admin.from('property_documents').update({ extraction_status: 'processing' }).eq('id', documentId)

  // Download file
  const { data: fileData, error: fileErr } = await admin.storage
    .from('property-documents').download(storagePath)
  if (fileErr || !fileData) throw new Error('Could not download file')

  const buf = await fileData.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // Chunked base64 to avoid a stack overflow on large multi-page statements
  // (apply() with a huge arg list blows the call stack).
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  const base64 = btoa(binary)

  const prompt = `Extract ALL rental statement information from this document. Return ONLY a valid JSON object. Use null for missing fields. Use UK date format DD/MM/YYYY for dates.

Return JSON matching this shape:
{
  "agent_name": "string|null",
  "statement_date": "DD/MM/YYYY|null",
  "period_start": "DD/MM/YYYY|null",
  "period_end": "DD/MM/YYYY|null",
  "currency": "GBP|EUR|USD|null",
  "items": [
    {
      "property_address": "string (as written on statement)",
      "tenant_name": "string|null",
      "type": "rent|fee|maintenance|other",
      "description": "string",
      "amount": "number (positive for income, negative for fees/costs)",
      "date": "DD/MM/YYYY|null"
    }
  ],
  "totals": {
    "rent_income": "number|null",
    "fees": "number|null",
    "maintenance": "number|null",
    "net_to_landlord": "number|null"
  }
}`

  // Sonnet 4.5 first pass, Opus 4.7 fallback if the first pass fails to parse
  // or returns no line items — mirrors the extract-document edge function so
  // statements get the same OCR quality as manually-uploaded docs. Images are
  // sent as image blocks; PDFs as document blocks.
  let extracted = await callStatementModel('claude-sonnet-4-5', base64, mimeType, prompt)
  if (extracted._parse_error || !Array.isArray(extracted.items) || extracted.items.length === 0) {
    try {
      const fallback = await callStatementModel('claude-opus-4-7', base64, mimeType, prompt)
      if (!fallback._parse_error) extracted = fallback
    } catch (e: any) {
      console.warn('Opus fallback failed for', documentId, e?.message)
    }
  }

  await admin.from('property_documents').update({
    extraction_status: 'completed',
    extracted_fields: extracted,
    extracted_at: new Date().toISOString(),
    extraction_error: null,
  }).eq('id', documentId)
}

// Call Claude for statement extraction. Returns parsed JSON, or a salvageable
// { _parse_error, _raw_response } envelope so the caller can decide to retry.
async function callStatementModel(model: string, base64: string, mimeType: string, prompt: string) {
  const isImage = (mimeType || '').toLowerCase().startsWith('image/')
  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: prompt }],
      }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${model} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const textResponse = data.content?.[0]?.text || ''
  try {
    return JSON.parse(textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
  } catch (e: any) {
    return { _raw_response: textResponse, _parse_error: e.message }
  }
}
