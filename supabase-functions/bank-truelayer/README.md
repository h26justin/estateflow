# bank-truelayer edge function

Live OAuth-based bank-feed integration for OwnProperly via
[TrueLayer Data API](https://docs.truelayer.com/docs/data-api).

Migrated from GoCardless Bank Account Data in May 2026 after GoCardless
paused new signups. Schema (bank_connections / bank_accounts /
bank_transactions) is unchanged.

## What it does

Single function, four actions selected by request body `action`:

| Action              | Trigger                                                    | Effect                                                                            |
|---------------------|------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `list_institutions` | Modal mount                                                | No-op success (TrueLayer hosts its own picker). Returns 503 if creds missing.    |
| `start_connect`     | User clicks "Connect a bank"                               | Pre-creates a pending `bank_connections` row, returns the TrueLayer auth URL.    |
| `finalize`          | App.jsx, after redirect with `?code=&state=`               | Exchanges code for access + refresh tokens, fetches accounts, marks active.      |
| `sync`              | Manual "↻ Sync" button OR scheduled cron                   | Refreshes access token, pulls 90 days of transactions, auto-matches rent.       |

## Required env vars (set in Supabase Dashboard → Edge Functions → Secrets)

```
TRUELAYER_CLIENT_ID      = <from TrueLayer Console, e.g. ownproperly-8f4450>
TRUELAYER_CLIENT_SECRET  = <from TrueLayer Console, shown once on app creation>
TRUELAYER_ENV            = sandbox | live   (default: sandbox)
BANK_REDIRECT_BASE       = https://ownproperly.com/?bank_callback=1   (optional)
```

Until `TRUELAYER_CLIENT_ID` + `TRUELAYER_CLIENT_SECRET` are set, the
function returns HTTP 503 and the UI falls back to "register interest".

## Deployment

```
supabase functions deploy bank-truelayer
```

Secrets are managed in the Supabase Dashboard (no CLI step) — values are
read fresh on each cold start.

## TrueLayer Console checklist

1. https://console.truelayer.com/ → create app "OwnProperly"
2. Product: **Data API** (not Payments / Pay-by-Bank)
3. Redirect URIs (allow up to 15 min to propagate):
   - `https://ownproperly.com/?bank_callback=1`
   - `http://localhost:5173/?bank_callback=1` (dev only)
4. Stay in **Sandbox** for testing. Real banks via mock provider.
5. Copy Client ID + Client Secret, paste into Supabase Dashboard secrets.

## Going live

1. In TrueLayer Console, switch the toggle from Sandbox → Live.
2. TrueLayer will ask for business verification: company details, FCA
   reference (you don't need to be FCA-registered, but they need yours
   to confirm you're a B2C/B2B SaaS not directly handling consumer money),
   data processing agreement.
3. Once approved, regenerate client credentials in Live mode.
4. Update Supabase secrets: rotate `TRUELAYER_CLIENT_ID` +
   `TRUELAYER_CLIENT_SECRET`, set `TRUELAYER_ENV=live`.
5. No code changes needed — `IS_SANDBOX` resolves at every cold start.

## OAuth flow (for the curious)

1. UI calls `start_connect` → backend creates `bank_connections` row,
   builds the TrueLayer auth URL with `state=<connection_id>`.
2. Browser redirects to TrueLayer's hosted bank picker.
3. User picks bank, authenticates, consents to scopes
   (`info accounts balance transactions cards offline_access`).
4. TrueLayer redirects to `BANK_REDIRECT_BASE?code=…&state=…`.
5. App.jsx reads `state` + `code` from URL, calls `finalize`.
6. Backend exchanges the code for access + refresh tokens, stores them
   in `partner_data` (with `expires_at`), fetches accounts, marks the
   connection active.

## Token lifecycle

- Access tokens last ~1 hour (TrueLayer default).
- Refresh tokens last up to 90 days (PSD2 cap on consent).
- `sync` calls `ensureFreshToken()` which refreshes when there's <2 min
  left, persisting the new pair atomically.
- After 90 days the refresh token expires → sync marks the connection
  `expired` → UI prompts re-consent. (Future work: scheduled cron to
  email users 7 days before consent expires.)

## Auto-match heuristic

Identical to the original GoCardless build. Incoming GBP credits
attempt to link to an unpaid `rent_payment` when:

- amount within £5 (or 2% of expected rent, whichever is greater)
- `period_start` within ±10 days of bank `posted_at`
- counterparty/description contains the property address first line
  (small confidence boost)

Auto-matches only land at confidence ≥ 0.75. Anything below stays in
the inbox for manual review.

## Schema dependencies

- `bank_connections` (status: `pending → active → expired/revoked`)
- `bank_accounts` (linked to connection)
- `bank_transactions` (unique on `(account_id, provider_transaction_id)`)
- `rent_payments.status` flips to `paid` when a match lands

`partner_data jsonb` shape:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "2026-08-15T...",
  "scope": "info accounts balance transactions cards offline_access"
}
```

## Future work

- Schedule daily sync via pg_cron + pg_net → `bank-truelayer` action=sync
- Email 7 days before consent expires (90-day PSD2 cap)
- Per-account → per-property assignment so transactions narrow down
- Outgoing transaction matching (mortgage payments, contractor invoices)
- Handle multi-bank: a user with NatWest + Monzo today goes through two
  separate Connect flows. Could batch in one consent if TrueLayer adds
  multi-provider support.
