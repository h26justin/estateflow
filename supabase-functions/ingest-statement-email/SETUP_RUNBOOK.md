# Statement-email forwarding — go-live runbook

Lets a landlord (or their letting agent) forward a rental-statement email to a
per-company address like `a1b2c3d4e5f6a7b8@inbox.ownproperly.com`. The app saves
the attachment, runs AI extraction, and drops a bell notification linking to the
StatementImporter pre-filled with the extracted rows.

**All the code is built and deployed-ready.** This runbook is the infrastructure
wiring — DNS + Postmark + Supabase — that only an account holder can do.
Project ref: **`hqrhqbkqxzllmzhcofrh`**. Inbox domain: **`inbox.ownproperly.com`**.

---

## 1. DNS — point the inbox subdomain at Postmark
At your DNS provider (Vercel DNS), for `inbox.ownproperly.com`:

| Type | Host | Value | Priority |
|---|---|---|---|
| MX | `inbox` | `inbound.postmarkapp.com` | 10 |

Postmark also gives you DKIM (TXT) and a Return-Path (CNAME) when you add the
domain in step 2 — add those too so replies/bounces and signing work.

> Don't point the apex `ownproperly.com` MX at Postmark — only the `inbox`
> subdomain, so your normal `hello@ownproperly.com` mail is untouched.

## 2. Postmark — inbound stream + webhook
1. Postmark → your server → **Inbound** stream.
2. Set the **Inbound Domain** to `inbox.ownproperly.com` (Postmark verifies the MX).
3. Set the **Inbound Webhook URL** to the deployed edge function:
   ```
   https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/ingest-statement-email
   ```
4. (Recommended) Turn on **Basic Auth** for the webhook and set a password.
   You'll reuse this exact value as `POSTMARK_INBOUND_TOKEN` in step 4. If you
   skip this, the function accepts any POST (the secret then is just the
   unguessable inbox address itself — acceptable, but Basic Auth is better).
5. Leave "Include raw email content" off — the function only needs the parsed
   JSON (`ToFull`, `Attachments[].Content` base64, `From`, `FromName`).

## 3. Deploy the edge function with JWT verification OFF
Postmark won't send a Supabase JWT, so the function must not require one
(its own auth check in step 4 replaces it):
```bash
supabase functions deploy ingest-statement-email \
  --project-ref hqrhqbkqxzllmzhcofrh \
  --no-verify-jwt
```
Confirm in Dashboard → Edge Functions → ingest-statement-email that
**Verify JWT = false**.

## 4. Secrets (Dashboard → Edge Functions → Secrets)
| Secret | Needed? | Notes |
|---|---|---|
| `POSTMARK_INBOUND_TOKEN` | recommended | Must equal the Basic-Auth password from step 2.4. Omit only if you skipped Basic Auth. |
| `ANTHROPIC_API_KEY` | **required** | Same key the other AI functions use. Powers Sonnet 4.5 + Opus 4.7 extraction. |
| `SUPABASE_URL` | auto | Usually injected by the platform. |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** | Lets the function write storage + rows past RLS. |
| `INBOX_DOMAIN` | optional | Defaults to `inbox.ownproperly.com`. Only set to override. |

## 5. End-to-end test
1. In the app: Settings → the **📨 Statement inbox** panel → Copy a company's address.
2. Email a real rental-statement **PDF** to it from any mailbox.
3. Within ~30s expect a bell notification: "📨 New statement for <Company>".
4. Click it → StatementImporter opens pre-filled with the extracted rows → review → import.
5. Repeat with a **photo/JPG** of a statement to confirm image attachments work
   (this was just fixed — see below).
6. Negative test: email to a made-up token → silently dropped (function returns
   200 `ignored: unknown_token`, by design, so Postmark doesn't retry/bounce).

---

## What was just fixed in the code (2026-05-31)
The feature was built earlier; this session corrected three issues in
`index.ts` so it matches what the UI promises and the rest of the app does:

1. **Images now accepted.** The UI said "PDF and image attachments" but the
   function filtered to PDFs only. It now accepts `application/pdf` and any
   `image/*` (pdf/jpg/jpeg/png/webp/heic/heif/gif), sending images as image
   blocks and PDFs as document blocks to Claude.
2. **Extraction upgraded** from `claude-haiku-4-5` (single pass) to
   **`claude-sonnet-4-5` primary + `claude-opus-4-7` fallback** — the same
   quality ladder as the main `extract-document` function. Falls back to Opus
   when the first pass fails to parse or returns zero line items. Base64 is now
   chunked so large multi-page statements don't overflow the stack.
3. **Property anchor clarified.** A statement often spans many properties; the
   doc is anchored to the company's first property purely as a container, and
   the real per-line property mapping happens in the StatementImporter when the
   user reviews. Documented so it isn't mistaken for a money-allocation claim.

## Rollback
Re-deploy the previous function version from the Supabase Dashboard (Edge
Functions → ingest-statement-email → version history), or remove the Postmark
inbound webhook URL to stop delivery. DNS MX can stay; with no webhook the mail
is simply parsed-and-dropped by Postmark.
