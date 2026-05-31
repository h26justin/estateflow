# ingest-statement-email edge function

Receives inbound emails from **Postmark** when an agent (or anyone)
sends a rental statement PDF to `<token>@inbox.ownproperly.com`.
Looks up the company by the token, saves the PDF to Storage, fires
Claude extraction in the background, and drops a bell notification
for the company owner to review and import.

## Architecture

```
Letting agent  →  abc123…@inbox.ownproperly.com
                            │
                       MX record
                            ▼
                  Postmark inbound parser
                            │
                  Webhook (Basic Auth)
                            ▼
   https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/ingest-statement-email
                            │
                            ▼
   1. parse TO → token
   2. lookup companies.statement_email_token
   3. save PDF to storage
   4. insert property_documents row (category='statement')
   5. inline-call Claude with rental_statement schema
   6. insert notification ("📨 New statement for X")
                            │
                            ▼
   User clicks bell → StatementImporter pre-fills → user confirms → done
```

## We do NOT auto-write rent_payments

Statement formats vary wildly between letting agents (PNE, RMS,
generic), addresses on the statement may not match our DB addresses
exactly, and getting the wrong property posted with the wrong amount
is much worse than asking the user to confirm. The flow is **human in
the loop**: AI extracts structured data → user reviews + saves.

## Required env vars (Supabase Dashboard → Edge Functions → Secrets)

| Secret | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | ✓ (auto) | Set automatically by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ (auto) | Set automatically |
| `ANTHROPIC_API_KEY` | ✓ | Same key extract-document uses |
| `POSTMARK_INBOUND_TOKEN` | recommended | Webhook Basic Auth password. Optional but locks down the endpoint |
| `INBOX_DOMAIN` | default `inbox.ownproperly.com` | Override if hosting elsewhere |

## One-time setup (Justin to do)

### 1. Postmark account

1. Sign up at <https://postmarkapp.com> ($15/mo for inbound; free trial fine for testing)
2. Create a Server. Enable the **Inbound** stream
3. In the Inbound settings:
   - **Webhook URL**: `https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/ingest-statement-email`
   - **HTTP Basic Auth**: set username `postmark` (any value), password = a long random string. Save this string as the `POSTMARK_INBOUND_TOKEN` Supabase secret
4. Note the **Inbound email domain** Postmark gives you (looks like `abc123.inbound.postmarkapp.com`). This is what your MX record points at — see step 2

### 2. Vercel DNS

In your `ownproperly.com` DNS settings (Vercel → Project → Domains):

| Type | Name | Value | Priority |
|---|---|---|---|
| **MX** | `inbox` | `<your postmark inbound host>` (e.g. `abc123.inbound.postmarkapp.com`) | 10 |

DNS takes 5-60 min to propagate. You can test with `dig MX inbox.ownproperly.com` from the terminal.

### 3. Set Supabase secret

Supabase Dashboard → Edge Functions → Secrets → Add:
```
POSTMARK_INBOUND_TOKEN = <the long random string from step 1.3>
```

### 4. Smoke test

1. Open OwnProperly → Settings → 📨 Statement Inbox → copy any company's address
2. Email a PNE/RMS statement PDF to that address
3. Within ~30 seconds:
   - The bell should show "📨 New statement for [Company]"
   - Property documents tab on the first unit should show the file with extraction status `completed`
4. Click the notification → opens StatementImporter pre-filled with extracted rows

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Email bounces from sender | MX not propagated yet | Wait, or check with `dig` |
| Postmark dashboard shows 401 | `POSTMARK_INBOUND_TOKEN` mismatch | Re-check the secret matches Postmark's Basic Auth |
| Email sent but no notification | Token not in DB | User regenerated the token after sharing the old address. Show them Settings → Inbox |
| Notification fires but bell shows empty body | Claude extraction failed | Check edge-function logs; the body field is set from the extraction result |

## Token rotation

If an address leaks (spam comes in, agent shares with the wrong party):

1. Settings → Statement Inbox → click **↻ Rotate** on that company
2. Old address dies immediately
3. New address shown — share with the agent

Server-side, this is just an `UPDATE companies SET statement_email_token = <new>` — handled by `api.rotateCompanyInboxToken`.

## Cost estimate

At Postmark's $15/mo for 10k inbound emails:

- 1 statement / company / month × 100 companies = 100/month → well within trial
- 10 statements / month × 1000 companies = 10,000/month → fills the $15 tier
- More than that, jump to next Postmark tier ($30/mo for 50k)

Cheaper than building your own MX server or running an SES forwarder.

## When to revisit

- If statement volume exceeds 50k/mo, evaluate **Cloudflare Email Workers** (free but no attachments in payload — would need an extra fetch)
- Extraction runs `claude-sonnet-4-5` first and auto-falls back to `claude-opus-4-7` when the first pass fails to parse or returns zero line items (see `extractDocumentInline` / `callStatementModel`). No manual model swap needed.
- See `SETUP_RUNBOOK.md` for the DNS + Postmark + Supabase go-live wiring.
