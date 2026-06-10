# Deployment Runbook — 2026-06-10 audit remediation

Everything in this branch is **repo-only**: nothing has been applied to the production
database, no edge functions deployed, no Vercel deploy. This runbook is the ordered
checklist for shipping it. The critical security holes (cross-tenant document access,
billing self-grant, privilege escalation) are **live in production until steps 2–3 run**.

Production Supabase project: `hqrhqbkqxzllmzhcofrh` ("Ownproperly.com").

---

## 0. Before the window

- [ ] Review the new migrations in `supabase-migrations/2026-06-10_*.sql` (they are
      idempotent and carry verification queries + rollback notes in comments).
- [ ] Take a database backup / PITR restore point.
- [ ] Create the **Investor price** in Stripe (live mode) and note its price ID.
- [ ] Generate secrets:
      `openssl rand -hex 32` → `STATE_SIGNING_SECRET`
      `openssl rand -hex 32` → `CRON_SECRET` (if not already set)
      Postmark inbound webhook Basic-auth password → `POSTMARK_INBOUND_TOKEN`

## 1. Set edge-function secrets (Supabase → Edge Functions → Secrets)

| Secret | Required by | Notes |
|---|---|---|
| `STRIPE_PRICE_ID_INVESTOR` | create-checkout | Investor tier price. Until set, the upgrade button shows "not configured" and checkout 400s cleanly. |
| `STATE_SIGNING_SECRET` | xero/hmrc OAuth callbacks | Optional (falls back to SHA-256 of service-role key) but recommended. Rotating it invalidates in-flight OAuth handshakes only. |
| `CRON_SECRET` | compliance-reminders (now **fails closed** with 403 if unset), trial-emails, xero crons | Same value across crons. |
| `POSTMARK_INBOUND_TOKEN` | ingest-statement-email (now **fails closed** with 401 if unset) | Must match the Basic-auth password configured on the Postmark inbound webhook. |
| `OWNPROPERLY_TOKEN_KEY` | bank-truelayer (now encrypts tokens) | Already exists for plaid/xero/hmrc — no change, just confirm it is set. |

## 2. Apply migrations (SQL editor or CLI), in **filename order**

Plain lexical order is correct and matters:

1. `2026-06-10_edge_support.sql` — oauth_nonces table, xero sync-lock/pending-sync columns. **Must precede edge-function deploys.**
2. `2026-06-10_perf_indexes.sql`
3. `2026-06-10_perf_rls_consolidate.sql`
4. `2026-06-10_perf_rls_initplan.sql`
5. `2026-06-10_security_01_helpers.sql` — `has_property_permission`, `company_is_live` (past_due counts as live grace)
6. `2026-06-10_security_02_storage_consolidated.sql` — **the big one**: drops the three legacy `r9vqgw_0` bucket-wide policies AND applies the path-ownership trigger + scoped policy. Run its commented VERIFY queries afterwards, including the forged-row INSERT test (must raise).
7. `2026-06-10_security_03_uca_privilege_escalation.sql`
8. `2026-06-10_security_04_billing_self_grant.sql`
9. `2026-06-10_security_05_role_and_liveness_policies.sql`
10. `2026-06-10_security_06_functions_and_misc.sql`
11. `2026-06-10_security_07_stripe_events.sql`
12. `2026-06-10_security_08_rent_payments_period_backfill.sql` — backfills the NULL `period_start` rows (fixes MTD income understatement for existing data) + stamping trigger
13. `2026-06-10_security_09_statement_email_token.sql`
14. `2026-06-10_tenant_portal_access.sql` — must run **after** 01 (uses its helpers); lexical order satisfies this

⚠️ `supabase-migrations/2026-05-31_storage_policy_injection_fix.sql` is superseded by
`security_02` — do not apply it separately.

## 3. Deploy ALL changed edge functions

All 17 were modified (plus one new):
`bank-plaid, bank-truelayer, compliance-reminders, create-checkout, create-user-backups,
hmrc-oauth-callback, ingest-statement-email, lead-capture, mtd-submit, notify-landlord,
stripe-webhook, xero-cron-reconcile, xero-oauth-callback, xero-sync, xero-webhook` and **new: `delete-user`**.

Deploy after step 2 (the OAuth start step needs `oauth_nonces`; the webhook tolerates a
missing `stripe_events` table but you've already created it).

## 4. Update the pg_cron job for compliance-reminders

The job defined per `supabase-migrations/compliance-reminders.sql` must now send header
`x-cron-secret: <CRON_SECRET>` — it currently sends only an Authorization bearer.
Edit the `net.http_post` headers in the cron definition. Until then the function 403s
(safe direction: reminders pause rather than leak).

## 5. Deploy the frontend (Vercel)

Push/merge → Vercel deploy. Notes:
- `vercel.json` now serves hashed `/assets/*` immutable and tightens CSP
  (`unsafe-eval` → `wasm-unsafe-eval`; **Plausible was being silently blocked by the old
  CSP — expect an analytics jump**).
- Deploy the frontend **after** the migrations: the tenant-portal RPCs and invite flow
  404 against the old database.
- Old bundle + new DB is safe; new bundle + old DB is not.

## 6. Manual dashboard actions (from LAUNCH_CHECKLIST + advisors)

- [ ] Supabase → Authentication → confirm **TOTP/MFA enabled** (app now enforces AAL2 challenge post-login for enrolled users).
- [ ] Supabase → Authentication → Advanced → switch `GOTRUE_DB_MAX_POOL_SIZE` from absolute 10 to percentage-based (advisor INFO).
- [ ] Stripe live-mode end-to-end test: trial signup → checkout (Starter) → upgrade (Investor) → cancel → suspension behaviour.
- [ ] Set up a status page (checklist item 23) — still outstanding.
- [ ] **Review storage access logs** for evidence of past cross-tenant access via the legacy policies (the hole existed in production; this is an exposure-assessment task, possibly an ICO-notification decision if abuse is found).

## 7. Post-deploy verification

- [ ] Run Supabase security + performance advisors again (expect the 98 initplan / 64 duplicate-policy warnings to largely clear; `deals` family may need a follow-up pass — see notes in `2026-06-10_perf_rls_initplan.sql`).
- [ ] Storage forgery test from `security_02` comments (cross-user path INSERT must fail).
- [ ] As a **viewer** collaborator: confirm writes are rejected at the API (RLS), not just hidden in UI.
- [ ] As an expired-trial owner: confirm REST writes are rejected, reads still work, billing page reachable.
- [ ] MTD quarterly preview for a real landlord: income figure should now include legacy rent rows (it was omitting ~89%).
- [ ] Reports page: P&L / rent collection now load real data.
- [ ] Tenant portal: generate an invite link (Tenancy tab), redeem it with a second account, confirm rent tracker + arrears render; confirm an old `?tenant_property=` link is refused.
- [ ] OAuth: connect Xero and HMRC end-to-end (state is now signed; a tampered `state` must be rejected).
- [ ] Password reset end-to-end (new set-new-password screen).
- [ ] Stripe webhook: replay an event from the Stripe dashboard — must be deduped via `stripe_events`.

## Known accepted residuals (documented, not fixed)

- Per-column financial/PII **read** gating for viewer collaborators stays client-side (DB now blocks viewer *writes*; full column-level read enforcement needs a view-based redesign).
- The `permissions` JSONB per-key overrides remain client-enforced; the DB enforces the coarse role floor.
- `rent_payments` unique `(property_id, year, month)` index is permanently gone — live data has legitimate duplicate-month segment rows. `ensureFutureRentMonths` should get a server-side idempotency guard as a follow-up.
- RLS-helper SECURITY DEFINER functions stay in the `public` schema (relocating them means rewriting every policy; advisor WARN accepted).
- `index.html` retains `'unsafe-inline'` for scripts (inline consent/SW bootstrap + static marketing pages; hashing would break un-hashed inline scripts).
- Landlord-side UI for sharing documents with tenants (`shared_with_tenant` flag) exists in the API but has no UI control yet — tenant Documents tab will be empty until that's added.
- bank-plaid per-row upsert errors are logged but don't fail the sync; near-miss amounts now create notifications instead of mutating rent rows.
