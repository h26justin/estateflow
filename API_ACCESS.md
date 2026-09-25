# OwnProperly read-only API access

Personal-token API for external clients — built so a Claude session (or any
tool the account owner trusts) can reference live portfolio data without a
browser login. **Read-only by design**: every data route is GET, backed by
fixed column whitelists, and scoped to exactly the data the token's owner can
see in the app (own properties + companies they own or have shared access to).

## Getting a token

In the app: **Settings → Security → API Access → Create token.** The plaintext
(`opat_…`, 69 chars) is shown once — only its SHA-256 hash is stored. Revoke
any time from the same panel; revocation is immediate.

## Calling the API

Base URL:

```
https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/api-access
```

Every request:

```
Authorization: Bearer opat_<your token>
```

No `apikey` header needed (the function is deployed with JWT verification off
and does its own auth — invalid/revoked/expired tokens get `401`).

Example:

```bash
curl -s -H "Authorization: Bearer $OPAT" \
  "https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/api-access/summary"
```

## Routes

All routes return JSON. List routes return `{ data: [...], limit, offset }`
and accept `?limit=` (default 200, max 1000) and `?offset=`.

| Route | Extra query params | Returns |
|---|---|---|
| `GET /me` | — | user id, name, email, accessible company ids |
| `GET /summary` | — | portfolio headline numbers (counts, value, rent, arrears, debt, compliance expiring ≤60d, open maintenance) |
| `GET /companies` | — | companies you own or have access to |
| `GET /properties` | `company_id`, `status` | properties (money, mortgage, tenancy headline, EPC, HMO fields) |
| `GET /tenancies` | `property_id` | tenancy details (deposit, dates, break clause — tenant contact details deliberately omitted) |
| `GET /rent-payments` | `property_id`, `from`, `to` (on `period_start`) | rent payment records |
| `GET /expenses` | `property_id`, `from`, `to` (on `date`) | property expenses |
| `GET /compliance` | `property_id` | compliance certificates + expiry dates |
| `GET /maintenance` | `property_id`, `status` | maintenance jobs |

Soft-deleted records are always excluded. Dates are `YYYY-MM-DD`.

## Token management routes (app session, not opat tokens)

Used by the Settings panel — require a signed-in Supabase user JWT:

- `POST /tokens` `{ name?, expires_in_days? }` → mints a token (plaintext
  returned once), max 10 active per user, max 365-day expiry.
- `GET /tokens` → metadata list (never plaintext).
- `DELETE /tokens/:id` → revoke.

## Implementation notes

- Edge function: `supabase-functions/api-access/index.ts` — **deploy with
  `--no-verify-jwt`** (opat tokens aren't gateway JWTs; auth is enforced
  in-function and fails closed).
- Schema: `supabase-migrations/2026-09-01_api_access_tokens.sql`
  (`api_access_tokens`, RLS'd; no client insert/update policies).
- Settings UI: `src/components/ApiAccessPanel.jsx`, client helper
  `src/lib/api/apiAccess.js`.
- Excluded on purpose: documents/files, bank transactions, tenant contact
  details, anything cross-tenant, and every secret-bearing column
  (e.g. `companies.statement_email_token`). Widen deliberately, not by default.
