// Inbound statement email handler — Postmark webhook receiver.
//
// Postmark forwards every email sent to <token>@inbox.ownproperly.com
// to this endpoint as a JSON POST. We:
//   1. Extract the token from the TO address
//   2. Look up the company in `companies.statement_email_token`
//   3. Save each PDF attachment to property-documents storage
//   4. Create a property_documents row, marked category='statement'
//   5. Trigger AI extraction via the existing extract-document fn path
//      (inline here to avoid an extra round-trip), as a background task
//      (EdgeRuntime.waitUntil) — a failure marks the document 'failed'
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
import {
  callClaudeWithEscalation, checkAiRateLimit, recordAiUsage, nullable, obj, UNTRUSTED_CONTENT_NOTICE,
} from './anthropic.ts'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const POSTMARK_TOKEN        = Deno.env.get('POSTMARK_INBOUND_TOKEN') || ''
const INBOX_DOMAIN          = (Deno.env.get('INBOX_DOMAIN') || 'inbox.ownproperly.com').toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Abuse / cost bounds for an endpoint anyone who learns an inbox address can
// mail: at most MAX_ATTACHMENTS files per email, each at most
// MAX_ATTACHMENT_BYTES, and at most DAILY_EXTRACTIONS AI extractions per
// company owner per day (ai_usage).
const MAX_ATTACHMENTS      = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const DAILY_EXTRACTIONS    = { perDay: 100 }

// File types Claude reads: PDFs as document blocks; JPEG/PNG/WebP/GIF as image
// blocks. HEIC/HEIF are NOT accepted by the API (the whole request would
// fail), so they are no longer taken.
const ACCEPTED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}
const ACCEPTED_MIME = new Set(Object.values(ACCEPTED_TYPES))

// Resolve an attachment's type from its declared ContentType, falling back to
// the file extension (agents often send application/octet-stream). Returns
// null for anything Claude can't read.
function attachmentMime(att: any): string | null {
  const ct = String(att?.ContentType || '').split(';')[0].trim().toLowerCase()
  if (ACCEPTED_MIME.has(ct)) return ct
  const ext = String(att?.Name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  return ACCEPTED_TYPES[ext] || null
}

// Decoded size of a base64 payload, without decoding it.
function base64Bytes(b64: string): number {
  const clean = (b64 || '').replace(/\s+/g, '')
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(clean.length * 3 / 4) - pad)
}

// Mirrors public.company_is_live (2026-06-10_security_01_helpers.sql) for the
// service role: live while an active / trialing / past_due subscription
// exists, the company is free-tier, or its trial hasn't ended. Never run paid
// AI for a company that isn't live.
async function companyIsLive(companyId: string): Promise<boolean> {
  const { data: co } = await admin
    .from('companies')
    .select('is_free_tier, trial_ends_at')
    .eq('id', companyId)
    .maybeSingle()
  if (co?.is_free_tier === true) return true
  if (co?.trial_ends_at && new Date(co.trial_ends_at).getTime() > Date.now()) return true
  const { data: subs } = await admin
    .from('subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['active', 'trialing', 'past_due'])
    .limit(1)
  return (subs || []).length > 0
}

// Keep background work alive after the response is sent. On Supabase,
// EdgeRuntime.waitUntil holds the worker open until the promise settles.
function runInBackground(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p)
}

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

    // ── 3. Liveness gate — no paid extraction for a lapsed company ──
    if (!(await companyIsLive(company.id))) {
      console.log('Company is not live — dropping statement email:', company.id)
      return new Response(JSON.stringify({ ok: true, ignored: 'company_not_live' }))
    }

    // ── 4. Select attachments ──
    // PDFs and images (JPEG/PNG/WebP/GIF) — the UI (CompanyInboxPanel) tells
    // users we take "PDF and image attachments", and many agents send
    // scanned/photographed statements. Capped in count and size.
    const attachments = (payload.Attachments || []) as any[]
    const readable = attachments
      .map(a => ({ att: a, mime: attachmentMime(a) }))
      .filter(x => x.mime !== null) as { att: any; mime: string }[]
    const sized = readable.filter(x => base64Bytes(x.att.Content || '') <= MAX_ATTACHMENT_BYTES)
    const oversize = readable.length - sized.length
    const pdfs = sized.slice(0, MAX_ATTACHMENTS)
    const overCount = sized.length - pdfs.length
    if (oversize > 0 || overCount > 0) {
      console.log(`Skipped ${oversize} oversize and ${overCount} over-limit attachment(s) for company ${company.id}`)
    }
    if (pdfs.length === 0) {
      console.log('Email had no usable PDF/image attachments — ignoring')
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
    for (const { att, mime } of pdfs) {
      const safeName = (att.Name || 'statement.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      const path = `statements/${company.id}/${Date.now()}_${safeName}`

      // Postmark sends attachments base64-encoded inline
      const fileBytes = Uint8Array.from(atob(att.Content || ''), c => c.charCodeAt(0))
      const { error: upErr } = await admin.storage
        .from('property-documents')
        .upload(path, fileBytes, { contentType: mime, upsert: false })
      if (upErr) { console.error('upload failed', upErr); continue }

      const { data: doc, error: docErr } = await admin.from('property_documents').insert({
        property_id: firstProp.id,
        user_id: company.owner_id,
        name: att.Name || 'Rental statement',
        file_path: path,
        file_type: mime,
        file_size: att.ContentLength || fileBytes.length,
        category: 'statement',
        extraction_status: 'pending',
      }).select('id').single()
      if (docErr || !doc) { console.error('doc insert failed', docErr); continue }
      docIds.push(doc.id)

      // ── 5. Extract in the background so the user sees structured data
      // ready when they click the notification. Any failure marks the
      // document 'failed' (with the reason) instead of leaving it stuck in
      // 'processing'.
      const docId = doc.id as string
      runInBackground(
        extractDocumentInline(docId, path, mime, company.owner_id).catch(async (e) => {
          const msg = (e as Error)?.message || String(e)
          console.error('extract failed for', docId, msg)
          try {
            await admin.from('property_documents').update({
              extraction_status: 'failed',
              extraction_error: msg.slice(0, 500),
            }).eq('id', docId)
          } catch { /* best effort */ }
        }),
      )
    }

    // ── 6. Drop a notification for the company owner ──
    const fromName = payload.FromName || payload.From || 'an agent'
    const summary = pdfs.length === 1
      ? `${fromName} sent a rental statement`
      : `${fromName} sent ${pdfs.length} rental statement files`
    await admin.from('notifications').insert({
      user_id: company.owner_id,
      type: 'statement_received',
      title: `📨 New statement for ${company.name}`,
      body: `${summary}. Click to review and import.`,
      link: '#/import?docs=' + docIds.join(','),
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

// Structured-output schema for a rental statement.
const nS = nullable({ type: 'string' })
const nN = nullable({ type: 'number' })
const STATEMENT_SCHEMA = obj({
  agent_name: nS,
  statement_date: nS,
  period_start: nS,
  period_end: nS,
  currency: nullable({ type: 'string', enum: ['GBP', 'EUR', 'USD'] }),
  items: {
    type: 'array',
    items: obj({
      property_address: { type: 'string' },
      tenant_name: nS,
      type: { type: 'string', enum: ['rent', 'fee', 'maintenance', 'other'] },
      description: { type: 'string' },
      amount: { type: 'number' },
      date: nS,
    }),
  },
  totals: obj({ rent_income: nN, fees: nN, maintenance: nN, net_to_landlord: nN }),
})

const STATEMENT_PROMPT = `Extract ALL rental statement information from this document. Use null for missing fields. Use UK date format DD/MM/YYYY for dates. Amounts are positive for income, negative for fees/costs. If the document is not a rental statement, return an empty items list.

${UNTRUSTED_CONTENT_NOTICE} This file arrived by email from an outside sender.

Return a JSON object with this shape:
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

// Run extract-document's logic inline (no second HTTP round-trip).
// We can't easily call our own edge function from another edge function
// without an auth dance, so we copy the relevant bit here. Throws on any
// failure; the caller marks the document 'failed'.
async function extractDocumentInline(documentId: string, storagePath: string, mimeType: string, ownerId: string) {
  // Per-owner daily cap on statement extractions.
  const gate = await checkAiRateLimit(admin, ownerId, 'ingest-statement-email', DAILY_EXTRACTIONS)
  if (!gate.allowed) throw new Error(gate.message)

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

  const isImage = mimeType.startsWith('image/')
  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }

  // Standard tier; escalates ONLY when the answer fails to parse / match the
  // schema. A clean parse with zero line items is a valid answer (not a
  // statement, or an empty one) and is kept as-is — no second, pricier pass.
  const ai = await callClaudeWithEscalation<any>({
    tier: 'standard',
    content: [contentBlock, { type: 'text', text: STATEMENT_PROMPT }],
    maxTokens: 16000,
    schema: STATEMENT_SCHEMA,
    timeoutMs: 120_000,
  })
  await recordAiUsage(admin, gate.usageId, ai)

  await admin.from('property_documents').update({
    extraction_status: 'completed',
    extracted_fields: ai.data,
    extracted_at: new Date().toISOString(),
    extraction_error: null,
  }).eq('id', documentId)
}
