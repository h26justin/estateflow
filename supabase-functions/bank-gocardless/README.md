# bank-gocardless edge function

Live OAuth-based bank-feed integration for OwnProperly via
[GoCardless Bank Account Data](https://bankaccountdata.gocardless.com/).

## What it does

Single function, four actions selected by request body `action`:

| Action              | Trigger                                                    | Effect                                                                                  |
|---------------------|------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `list_institutions` | Bank Connections modal mount                               | Returns ~30 UK banks for the picker                                                     |
| `start_connect`     | User picks a bank                                          | Creates a requisition at GoCardless, inserts a `pending` `bank_connections` row, returns `auth_url` |
| `finalize`          | App.jsx, after bank redirects to `/?bank_callback=1&ref=…` | Fetches `bank_accounts`, marks connection `active`                                      |
| `sync`              | Manual "↻ Sync" button OR scheduled cron                   | Pulls 90 days of transactions per account, attempts auto-match against `rent_payments`  |

## Required env vars (set via `supabase secrets set …`)

```
GOCARDLESS_BAD_SECRET_ID   = <from GoCardless dashboard>
GOCARDLESS_BAD_SECRET_KEY  = <from GoCardless dashboard>
BANK_REDIRECT_BASE         = https://ownproperly.com/?bank_callback=1
```

Until the first two are set, the function returns HTTP 503 with
`{ error: "Bank feeds not yet enabled — partner credentials pending" }`.
The UI catches this and falls back to the "register interest" form.

## Deployment

```
supabase functions deploy bank-gocardless
supabase secrets set GOCARDLESS_BAD_SECRET_ID=<id> GOCARDLESS_BAD_SECRET_KEY=<key>
```

## GoCardless onboarding checklist

1. Sign up at https://bankaccountdata.gocardless.com/signup (free tier
   covers ~200 connections/month — enough for MVP).
2. Create an "App" — gives you a Secret ID + Secret Key pair.
3. Add the redirect URL to the app: `https://ownproperly.com/?bank_callback=1`
4. Set the secrets (above) and redeploy the function.
5. Smoke-test: open the Bank Connections modal — banks should now
   appear in the picker instead of the interest form.

## Auto-match heuristic

Sync action attempts to auto-link incoming GBP credits to unpaid
`rent_payments` rows. Criteria, in order:

- amount within £5 (or 2% of expected rent, whichever is greater)
- `period_start` (if known) within ±10 days of the bank `posted_at`
- counterparty/description containing the property address first line
  (bumps confidence)

Auto-matches only happen at confidence ≥ 0.75. Anything below stays in
the inbox for manual review.

## Schema dependencies

- `bank_connections` (status flow: `pending → active → expired`)
- `bank_accounts` (linked to connection)
- `bank_transactions` (unique on `(account_id, provider_transaction_id)`)
- `rent_payments.status` is flipped to `paid` when a match lands

All four tables have full per-user RLS — the edge function uses the
service role for writes but mirrors RLS by always filtering on the
authenticated user's `auth.uid()`.

## Future work (post-MVP)

- Schedule daily sync via pg_cron + pg_net → `bank-gocardless` action=sync
- Re-consent flow when status goes to `expired` (PSD2 90-day cap)
- Per-account → per-property assignment so transactions narrow down
- Outgoing transaction matching (mortgage payments, contractor invoices)
