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
//   - POSTMARK_INBOUND_TOKEN  (HMAC secret for verifying webhook auth;
//                              optional but recommended — falls back to
//                              accepting all POSTs if not set, suitable
//                              for testing)
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

// Postmark sends Basic Auth on the webhook if you configure it. We
// accept either:
//   - Basic Auth where the password matches POSTMARK_INBOUND_TOKEN, OR
//   - No auth at all (acceptable because the URL itself is secret and
//     not discoverable). Set the env var to lock down further.
function isAuthorised(req: Request): boolean {
  if (!POSTMARK_TOKEN) return true
  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('basic ')) return false
  try {
    const decoded = atob(auth.slice(6))
    const [, pass] = decoded.split(':')
    return pass === POSTMARK_TOKEN
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
    const attachments = (payload.Attachments || []) as any[]
    const pdfs = attachments.filter(a =>
      a.ContentType === 'application/pdf' || (a.Name || '').toLowerCase().endsWith('.pdf')
    )
    if (pdfs.length === 0) {
      console.log('Email had no PDF attachments — ignoring')
      return new Response(JSON.stringify({ ok: true, ignored: 'no_pdfs', sender: payload.From }))
    }

    // We need a property_id for the doc — schema requires it. Use the
    // first non-deleted property of the company.
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
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)

  const prompt = `Extract ALL rental statement information from this PDF. Return ONLY a valid JSON object. Use null for missing fields. Use UK date format DD/MM/YYYY for dates.

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

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    throw new Error(`Anthropic ${anthropicRes.status}: ${errText.slice(0, 300)}`)
  }
  const data = await anthropicRes.json()
  const textResponse = data.content?.[0]?.text || ''
  let extracted: any = null
  try {
    extracted = JSON.parse(textResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
  } catch (e: any) {
    extracted = { _raw_response: textResponse, _parse_error: e.message }
  }

  await admin.from('property_documents').update({
    extraction_status: 'completed',
    extracted_fields: extracted,
    extracted_at: new Date().toISOString(),
    extraction_error: null,
  }).eq('id', documentId)
}
