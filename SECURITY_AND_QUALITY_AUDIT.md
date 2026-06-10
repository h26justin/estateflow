# OwnProperly (EstateFlow) — Deep Site Audit

_Generated 2026-06-10. Method: 11 specialist auditors fanned out across auth, RLS, edge functions, payments, XSS/secrets, core features, integrations, UX, performance, live Supabase advisors, and prior-audit follow-up. Every medium-or-higher finding was re-checked by 1–2 adversarial skeptics that tried to refute it; only survivors are listed. A completeness critic then swept for gaps. 94 agents total._

## Scoreboard

- **Confirmed findings:** 57 — 5 critical, 15 high, 29 medium, 8 low
- **Gap findings (completeness critic):** 5 — 2 high, 2 medium, 1 low
- **Refuted by skeptics (not real):** 2
- **Build:** passes. **Tests:** 76/77 pass (1 stale test failing on `fmt(NaN)`).

## Overall risk assessment

The deep audit covered the landlord-facing surfaces thoroughly but under-covered the tenant-facing half of the product and the cron-to-edge-function trust chain. The single biggest miss is the tenant portal's data model: no migration ever grants tenants read access to their own property, so the portal is non-functional at the DB layer (independent of the JS rent-tracker bugs already filed), and the self-service tenant_profiles registration is unauthenticated against any invite — any signed-in user can claim to be a tenant of any property UUID. notify-landlord and the statement-email token are open spam/abuse vectors, and xero-cron-reconcile lets the service role impersonate any user on a single shared secret. Overall the product has multiple confirmed critical auth/billing holes already; these gap findings show the tenant side was built without an RLS access path at all, making it both broken and abusable. This is a product with real paying users that should not be treated as production-secure until the tenant access model and the cron trust chain are redesigned.

## Critical (5)

### [CRITICAL] Viewer can escalate to admin via user_company_access writes
**Where:** `supabase-migrations/row-level-security.sql:232`  ·  _dimension: auth-authz_

**Problem:** Live UCA write RLS = is_developer() OR has_company_access(company_id), true for ANY member incl viewer; collaborator can self-set is_admin/role=admin via anon key.

**Evidence:** pg_policies uca_insert/update/delete = (is_developer() OR has_company_access(company_id)).

**Fix:** Owner-only writes; block self-elevation; re-apply as migration.

### [CRITICAL] Owner can self-grant free tier/subscription (billing bypass)
**Where:** `supabase-migrations/row-level-security.sql:88`  ·  _dimension: auth-authz_

**Problem:** companies_update allows owner_id=auth.uid() no WITH CHECK; authenticated has column UPDATE on is_free_tier; owner sets is_free_tier=true and subscriptions status=active, bypassing Stripe.

**Evidence:** has_column_privilege(authenticated,companies,is_free_tier,UPDATE)=true; setCompanyFreeTier _monolith.js:1556.

**Fix:** Billing writes behind SECURITY DEFINER RPC; REVOKE column UPDATE.

### [CRITICAL] Storage policy injection fix (2026-05-31) NOT applied to live DB — cross-tenant document read is live
**Where:** `supabase-migrations/2026-05-31_storage_policy_injection_fix.sql:37`  ·  _dimension: rls-database_

**Problem:** OVERNIGHT_AUDIT.md finding #5 and the 2026-05-31 migration claim the property-documents storage injection vector is closed by a BEFORE INSERT/UPDATE trigger (enforce_document_path_ownership) plus a rewritten storage policy that anchors on path prefix / has_property_access. Verification against the live database (project hqrhqbkqxzllmzhcofrh) shows the migration was NEVER applied: the function public.enforce_document_path_ownership does not exist (SELECT proname ... returned empty), no trg_*_path_ownership triggers exist, and the live storage.objects policy 'Users access own files in property-documents' is still the OLD forgeable version whose USING clause grants read via `EXISTS (SELECT 1 FROM property_documents WHERE file_path = objects.name AND user_id = auth.uid())` with no path-prefix check and no has_property_access. Meanwhile the live property_documents_insert policy lets any user insert a row with their own user_id and an ARBITRARY file_path (it only checks property ownership, not the path). So an authenticated paying user can: INSERT INTO property_documents(property_id, user_id, file_path) VALUES (<own property>, auth.uid(), '<victim-uid>/properties/x/secret.pdf'), then request a signed URL / read that storage object — the EXISTS branch matches and hands over the victim's private document. The bucket is correctly private, but that alone does not stop this RLS-level confused-deputy read. This is an exploitable cross-tenant data breach of tenancy agreements, IDs, statements, etc.

**Evidence:** Live storage USING clause: "...((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1 FROM property_documents WHERE ((property_documents.file_path = objects.name) AND (property_documents.user_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM company_documents ...)) OR (EXISTS ( SELECT 1 FROM deal_documents ...))". Live `SELECT proname FROM pg_proc WHERE proname='enforce_document_path_ownership'` => [] (function absent). Live property_documents_insert with_check: "(is_developer() OR ((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM properties p WHERE ((p.id = property_documents.property_id) AND has_company_access(p.company_id))))))" — no constraint on file_path.

**Fix:** Apply supabase-migrations/2026-05-31_storage_policy_injection_fix.sql to production (it is idempotent). Verify afterward that public.enforce_document_path_ownership exists, that trg_property_documents_path_ownership / trg_company_documents_path_ownership / trg_deal_documents_path_ownership are attached, and that the storage USING EXISTS branches now use `(d.user_id = auth.uid() OR has_property_access(d.property_id))`. Run the forgery test in the migration's runbook (insert a row with another user's path prefix must RAISE check_violation).

### [CRITICAL] Owner can self-grant a paid subscription without paying (RLS UPDATE has no WITH CHECK)
**Where:** `supabase-migrations/2026-05-25_subscriptions_select_collaborators.sql:22`  ·  _dimension: payments-billing_

**Problem:** subscriptions is writable by authenticated on every column; RLS UPDATE only constrains owner_id, no WITH CHECK. An owner can UPDATE their sub row to status=active, tier=investor, current_period_end far ahead; the React gate then treats them as paying forever. Free product use and free Investor unlock, zero payment.

**Evidence:** Live sub_update qual owner_id equals auth.uid() OR is_platform_admin(), with_check null; authenticated UPDATE on tier,status,current_period_end. tierGating.js:34. create-checkout/index.ts:114-119 self-inserts trialing.

**Fix:** REVOKE INSERT, UPDATE ON public.subscriptions FROM authenticated, anon; else add WITH CHECK forbidding status/tier/stripe changes.

### [CRITICAL] Legacy storage policies give every authenticated user full read/upload/delete on the entire property-documents bucket
**Where:** `supabase-migrations/2026-05-31_storage_policy_injection_fix.sql:104`  ·  _dimension: prior-audit-followup_

**Problem:** Live pg_policy inspection of production (project hqrhqbkqxzllmzhcofrh) shows three permissive policies on storage.objects — 'Allow viewing r9vqgw_0' (SELECT), 'Allow uploads r9vqgw_0' (INSERT), 'Allow delete r9vqgw_0' (DELETE) — all scoped to role 'authenticated' with the sole condition bucket_id = 'property-documents'. Permissive RLS policies OR together, so these legacy dashboard-created policies completely override the carefully scoped 'Users access own files in property-documents' policy AND the bucket privatization (Phase 3). Any signed-in user — including a fresh free-trial signup — can download, overwrite-upload into, or delete ANY other customer's documents (bank statements, tenancy agreements, mortgage PDFs, compliance certificates) if they know or enumerate a path. This is cross-tenant data exposure plus data-loss capability on a published paid product, and it is strictly worse than what OVERNIGHT_AUDIT.md finding #5 recorded (that finding only covered the forged-row EXISTS injection). Notably, the repo's own fix migration only drops the 'Users access/manage own files...' policy names (lines 104-106) and never drops these three legacy policies, so even applying it as-written leaves the hole open.

**Evidence:** Live query: {"polname":"Allow viewing r9vqgw_0","polpermissive":true,"roles":["authenticated"],"using_expr":"(bucket_id = 'property-documents'::text)"} (plus identical 'Allow uploads' WITH CHECK and 'Allow delete' USING). The fix migration's drop list: DROP POLICY IF EXISTS "Users access own files in property-documents" ON storage.objects; DROP POLICY IF EXISTS "Users access own files in property-documents (strict)" ON storage.objects; DROP POLICY IF EXISTS "Users manage own files in property-documents" ON storage.objects; — no DROP for the three 'Allow … r9vqgw_0' policies.

**Fix:** Immediately DROP POLICY "Allow viewing r9vqgw_0", "Allow uploads r9vqgw_0", and "Allow delete r9vqgw_0" ON storage.objects in production (the scoped 'Users access own files in property-documents' policy already covers legitimate access). Add these DROPs to 2026-05-31_storage_policy_injection_fix.sql so the repo migration is self-sufficient. Then re-test: own-doc download, collaborator doc access, statement-inbox files, and a cross-user path fetch (must 403/404). Review storage access logs for evidence of past cross-tenant access.

## High (17)

### [HIGH] Role gating client-side only; DB lets any member read/write all
**Where:** `src/App.jsx:107`  ·  _dimension: auth-authz_

**Problem:** canDo/ROLE_DEFAULTS client-only; DB FOR ALL child policies role-blind (has_property_access), so viewer can write/delete and read financial+tenant PII via PostgREST.

**Evidence:** canDo App.jsx:107-114; properties_update row-level-security.sql:122-128 no role check; child FOR ALL 162-200.

**Fix:** Add has_property_permission; split FOR ALL into SELECT/write; gate writes.

### [HIGH] 2FA enrolled but never enforced (no AAL2)
**Where:** `src/components/TwoFactorPanel.jsx:8`  ·  _dimension: auth-authz_

**Problem:** TOTP enrolls but nothing requires AAL2 post-login and no RLS aal claim, so AAL1 password session stays usable; no protection vs stolen password.

**Evidence:** grep aal across src only enroll/verify; AuthContext.jsx:41-43 just stores session.

**Fix:** Force MFA challenge post-login when nextLevel=aal2; optionally require aal2 on sensitive RLS.

### [HIGH] OAuth callbacks trust an unsigned state parameter — no CSRF binding + open redirect (Xero & HMRC)
**Where:** `supabase-functions/xero-oauth-callback/index.ts:89`  ·  _dimension: edge-functions_

**Problem:** xero-oauth-callback and hmrc-oauth-callback derive the target user, company and post-OAuth redirect entirely from a base64 JSON state blob that is never HMAC-signed and never bound to the initiating session. The callback validates only that state.user_id exists, then writes freshly-exchanged tokens to whatever user_id/company_id state names and 302-redirects to whatever state.return_to says. Because state is forgeable, an attacker who completes their own provider consent (valid code) can replay the callback with a forged state naming a victim, overwriting the victim's xero_connections/mtd_settings row with the attacker's tokens/tenant so victim financial data syncs into the attacker's Xero org. state.return_to is also used unchecked as the 302 Location (open redirect). Code flags it: 'HMAC signing would be stronger — TODO when we ship live.'

**Evidence:** line 89-90: const state = decodeState(url.searchParams.get('state')||''); if (!state.user_id) return new Response('Invalid state',{status:400}). line 182-183: const returnTo = state.return_to||'/'; return new Response(null,{status:302,headers:{Location:returnTo}}). decodeState (line 76) is JSON.parse(atob(s)) with no signature check.

**Fix:** HMAC-sign state and verify before trusting any field; store a one-time nonce at 'start' that must match in the callback. Validate return_to against an allow-list of app origins like create-checkout does. Apply identically to hmrc-oauth-callback (lines 90-91, 188-192).

### [HIGH] compliance-reminders has no authentication and leaks user email addresses in its response
**Where:** `supabase-functions/compliance-reminders/index.ts:76`  ·  _dimension: edge-functions_

**Problem:** This cron function runs with the service-role key but performs NO auth check — no CRON_SECRET, no JWT — unlike sibling crons trial-emails (CRON_SECRET gate line 207-211) and create-user-backups (service-key/JWT gate line 119-141). If deployed with verify_jwt off (the norm for pg_cron net.http_post with no JWT), any anonymous caller can invoke it: it emails all eligible users, writes notifications and audit_log rows, and returns a JSON body enumerating the email address of every user with an expiring/overdue certificate — an unauthenticated PII disclosure plus email-send trigger, a regression vs the two crons that gate themselves.

**Evidence:** serve handler line 76-80 has no secret check before doing work. Response leaks emails at line 289: results.push({ user_id: userId, email: profile.email, items: userItems.length, status: 'sent' }) returned at line 295.

**Fix:** Add the CRON_SECRET gate used by trial-emails at the top of serve() (read x-cron-secret, compare to CRON_SECRET, 403 on mismatch, fail-safe when unset). Stop returning per-user emails. Do not rely on gateway verify_jwt config that is not version-controlled.

### [HIGH] Trial/suspension enforced only in React, not the DB - users keep full API data access
**Where:** `src/App.jsx:929`  ·  _dimension: payments-billing_

**Problem:** App.jsx filters suspended companies from React state (929-963); the gate is a React overlay (1322-1337). Data RLS only checks membership via has_company_access (row-level-security.sql:106-112; fn 49-66), never sub or trial_ends_at, so an expired owner or suspended collaborator keeps full read/write via REST. ba0ce43/39543a6 are UI deterrence only.

**Evidence:** App.jsx:938 true for active/trialing/past_due, filter 944/963 React-only; has_company_access 49-66 checks only ownership/user_company_access.

**Fix:** Add SECURITY DEFINER company_is_live(company_id) into properties+child policies, or move the gate server-side.

### [HIGH] Investor tier never charged server-side; plus checkout/webhook race and clock-based gate
**Where:** `supabase-functions/create-checkout/index.ts:125`  ·  _dimension: payments-billing_

**Problem:** create-checkout bills one hard-coded price; webhook never sets tier, so Investor is client-gated and self-grantable for the starter price or free. Also: no webhook idempotency/event table (confirmed none) so retried events reprocess and Meta CAPI Purchase re-fires (stripe-webhook 192-198); the gate compares trial_ends_at to client Date.now() (TrialExpiredGate.jsx:59-60, App.jsx:940), bypassable.

**Evidence:** create-checkout/index.ts:125 price STRIPE_PRICE_ID; grep tier: none; tierGating.js:30-36; stripe-webhook/index.ts:182-216 no event_id dedupe; DB has no stripe_event table.

**Fix:** Add per-tier price IDs and let the webhook own tier; add stripe_events(event_id PK); compute trial/live status server-side.

### [HIGH] MTD ITSA quarterly income excludes all legacy paid rent rows (89% of production data) — HMRC submission income understated
**Where:** `src/lib/api/_monolith.js:3392`  ·  _dimension: features-core_

**Problem:** fetchMtdRawForPeriod feeds buildQuarterlySummary (src/lib/mtdItsa.js:120) which is the figure shown in the MTD quarterly preview and submitted to HMRC. It filters rent_payments with .gte('period_start', periodFrom) — but rows where period_start IS NULL never match a >=/<= comparison in PostgREST/SQL. Verified against the live database (project hqrhqbkqxzllmzhcofrh): 1,288 of 1,449 status='paid' rows have NULL period_start (all rows created via the month-strip toggle, generated month rows, and pre-June-2026 data). Only the 161 rows created through the new Day Tracker popover or statement importer carry period dates. Result: a landlord's MTD quarterly income figure omits ~89% of their recorded rent — tax income understated to HMRC. buildQuarterlySummary has the same gap independently (mtdItsa.js:132 `if (!inRange(p?.period_start)) continue`). The going-forward writers (App.jsx handleUpdatePayment → updateRentSegment status-only update; generateFutureMonths in _monolith.js:961-968) still create/flip rows without period dates, so the gap grows.

**Evidence:** _monolith.js:3389-3393: supabase.from('rent_payments').select(...).eq('status','paid').gte('period_start', periodFrom).lte('period_start', periodTo) — and mtdItsa.js:131-133: `if (!inRange(p?.period_start)) continue`. Live DB probe: SELECT COUNT(*) FILTER (WHERE period_start IS NULL) ... WHERE status='paid' → {paid_no_period: 1288, paid_with_period: 161}.

**Fix:** Fall back to the row's year/month when period_start is NULL: either fetch with .or() covering both shapes and synthesise period_start = make_date(year, month, 1) client-side before passing to buildQuarterlySummary, or run a one-time backfill migration (UPDATE rent_payments SET period_start = make_date(year,month,1), period_end = (make_date(year,month,1) + interval '1 month - 1 day')::date WHERE period_start IS NULL) and make every writer (upsertRentPayment, generateFutureMonths, handleUpdatePayment) always stamp period dates.

### [HIGH] Reports page loads zero financial data: fetchAllRentPayments orders by non-existent payment_date column
**Where:** `src/lib/api/_monolith.js:2033`  ·  _dimension: features-core_

**Problem:** rent_payments has no payment_date column (verified via information_schema on the live DB — columns are id, property_id, user_id, month_label, year, month, status, amount, notes, created_at, period_start, period_end, xero_reconciled, xero_reconciled_at). PostgREST returns 42703 for an order on an unknown column, so fetchAllRentPayments throws. ReportsPage.loadAll (src/components/ReportsPage.jsx:110-124) wraps all five fetches in one Promise.all with an empty catch(e){}, so when this one rejects, compliance, maintenance, tenancies, rent AND expenses all stay empty arrays. Every financial report is then wrong: Annual P&L silently falls back to the rent_pcm×12 full-occupancy estimate (hasPaid=false path, line 448-452), Rent Collection Rate shows £0 collected / 0% rate (line 503-506), Expense Breakdown and Monthly Cash Flow show zero expenses. Two further layers are broken even after the order is fixed: ReportsPage.jsx:146 filters with inRange(r.payment_date||r.month, range) — r.month is an integer (1-12), so new Date(6) is Jan 1970 and every row is filtered out; and the cashflow report (line 526) checks r.payment_date first for the same non-existent field.

**Evidence:** _monolith.js:2030-2034: `supabase.from('rent_payments').select(...).eq('user_id', userId).order('payment_date', { ascending: false })` with `if (error) throw error`. ReportsPage.jsx:122: `} catch(e) {}`. ReportsPage.jsx:146: `inRange(r.payment_date||r.month, range)`. Live schema query confirms no payment_date column exists.

**Fix:** Order by period_start (nulls last) or created_at instead of payment_date; change ReportsPage filtering to derive a date from period_start with a year/month fallback (e.g. r.period_start || `${r.year}-${String(r.month).padStart(2,'0')}-01`); split the Promise.all so one failed fetch doesn't blank the whole Reports page, and surface load errors instead of catch(e){}.

### [HIGH] Tenant portal rent tracker completely non-functional: broken fetch, then a guaranteed TypeError and year-blind month matching behind it
**Where:** `src/components/TenantPortal.jsx:348`  ·  _dimension: features-core_

**Problem:** Three stacked bugs: (1) fetchTenantPaymentTracker (_monolith.js:2292-2298) orders by the non-existent payment_date column and discards the error (`const { data } = ...; return data || []`), so it always returns [] — tenants see 12 months of '?' unknown squares, 'Total paid £0' and 'Arrears: None' even when the landlord has marked months overdue. TenantHome's arrears banner (line 227) is likewise always £0, so tenants in arrears are never warned. (2) If the fetch is fixed, the month-matching code crashes: `(p.month||p.payment_date||'').substring(0,7)` calls .substring on p.month, which is an integer column (verified live schema) — Number.prototype has no substring, so the TenantRent render throws a TypeError for any tenant with payment rows. (3) Even rewritten, the match compares against 'YYYY-MM' while ignoring p.year, and the amount shown falls back to full rent_pcm for amount-less rows.

**Evidence:** TenantPortal.jsx:347-350: `const match = payments.find(p=>{ const pm = (p.month||p.payment_date||'').substring(0,7); return pm === monthStr })`; _monolith.js:2294-2297: `const { data } = await supabase.from('rent_payments').select('*')...order('payment_date', ...); return data || []`. Live schema: rent_payments.month is integer; payment_date does not exist.

**Fix:** Fix the fetch to order by period_start/created_at and propagate errors. Rewrite the month matcher to compare integers: payments.find(p => p.year === d.getFullYear() && p.month === d.getMonth()+1), preferring rows with status priority (overdue > paid) when a month has multiple segments, and sum segment amounts rather than taking the first match.

### [HIGH] Tenancy renewal alert is dead code and health-score/tenant-portal tenancy expiry never fire — wrong column names (tenancy_end_date / end_date vs actual tenancy_end)
**Where:** `src/components/tenancy/index.jsx:505`  ·  _dimension: features-core_

**Problem:** The live tenancy_details table has columns tenancy_start / tenancy_end (verified via information_schema; the main editor in FeatureComponents.jsx:215-217 reads/writes those correctly). But three consumers use invented names: (1) TenancyRenewalAlert checks `if (!tenancy?.tenancy_end_date) return null` — always true, so the renewal alert rendered on every property detail tab (App.jsx:3001) has never displayed for anyone; its handleRenew also writes { tenancy_end_date, rent_pcm } to tenancy_details — neither column exists, so even if reached it would 400. (2) calcPropertyHealthScore (_monolith.js:2735) checks tenancy?.tenancy_end_date, so the 'Tenancy has ended / ends in N days' health deductions can never trigger. (3) TenantPortal (lines 232, 277, 806) reads tenancy.end_date — always undefined, so tenants always see 'End date: Rolling' and the 'tenancy expires in N days' banner never shows. A landlord relying on these alerts will silently miss tenancy expirations.

**Evidence:** tenancy/index.jsx:505 `if (!tenancy?.tenancy_end_date) return null`; :520-523 `api.updateTenancyDetails(propertyId, { tenancy_end_date: form.new_end_date, ...(form.new_rent ? { rent_pcm: parseFloat(form.new_rent) } : {}) })`; _monolith.js:2735 `if (tenancy?.tenancy_end_date)`; TenantPortal.jsx:232 `tenancy?.end_date ? Math.ceil(...)`. Live schema: tenancy_details has tenancy_end (date), no tenancy_end_date / end_date / rent_pcm columns.

**Fix:** Standardise on the real column: replace tenancy_end_date and end_date reads with tenancy_end in TenancyRenewalAlert, calcPropertyHealthScore and TenantPortal; in handleRenew write { tenancy_end: form.new_end_date } to tenancy_details and persist the new rent to properties.rent_pcm (separate updateProperty call), not tenancy_details. Add a unit test pinning the field name.

### [HIGH] Plaid auto-match misattributes rent: no property/company scope, arbitrary row pick, overwrites recorded amount
**Where:** `supabase-functions/bank-plaid/index.ts:244`  ·  _dimension: features-integrations_

**Problem:** On sync, an incoming credit is matched to a rent_payment using only user_id + status + a ±£5 amount window + a 35-day period_start floor. There is no property_id/company_id scope, no .order(), and no .is('deleted_at', null) filter; the candidate is taken via .limit(1).maybeSingle() — i.e. an arbitrary row among all the user's unpaid payments. When a multi-property landlord has two tenancies at similar rent, the bank credit can be applied to the WRONG property. Worse, on match it overwrites rent_payments.amount with the bank figure and flips status to 'paid', so the contracted rent and the true arrears for that property are silently corrupted. (Note bank-truelayer's tryAutoMatch does filter deleted_at and scores by confidence; the Plaid path — which bank.js actually uses — does neither.)

**Evidence:** const { data: candidate } = await admin
  .from('rent_payments')
  .select('id, amount, property_id')
  .eq('user_id', caller.id)
  .in('status', ['void','overdue','partial'])
  .gte('period_start', new Date(Date.now() - 35*24*60*60*1000).toISOString().slice(0,10))
  .gte('amount', amount - 5)
  .lte('amount', amount + 5)
  .limit(1)
  .maybeSingle()
...
await admin.from('rent_payments').update({ status: 'paid', amount, notes: ... }).eq('id', candidate.id)

**Fix:** Scope candidates to the property/company that owns the matched bank account (join via bank_accounts → property mapping), add .is('deleted_at', null), add a deterministic .order() (e.g. by period_start then amount-distance), and do NOT overwrite rent_payments.amount when the bank figure differs from the recorded rent — record the received amount in a separate column (e.g. paid_amount) or only mark paid when the amounts match within tolerance. Require explicit confirmation for cross-property matches.

### [HIGH] Marketing site pricing claims contradict the real billing model (and contradict themselves on the same page)
**Where:** `src/components/MarketingSite.jsx:424`  ·  _dimension: ux-design_

**Problem:** The pricing page promises "No tiers, no feature gates, no per-user fees, no minimums" and "£2 a property gets you all six modules, AI tools... the lot" (lines 159, 171, 200, 423-424). The code says otherwise: src/lib/tierGating.js:21-27 defines two tiers (Starter £2, Investor £5 which gates AI Insights and Deals Pipeline), tierGating.js:46-55 enforces a £10/month minimum (calcMonthlyPrice FLOOR=10), and App.jsx:2126-2150 shows starter users an 'INVESTOR' upgrade wall on the dashboard for AI Portfolio Insights at "£5/property". Worse, the FAQ on the SAME marketing page (line 538) openly describes the Starter/Investor split — directly contradicting the "No tiers" headline above it — and claims "with no minimum" which contradicts the £10 floor. A landlord with 1-4 properties signs up expecting £2-8/mo and full AI access, then meets a £10 minimum and a feature paywall. This is the kind of mismatch that generates refund demands and ASA complaints for a paid product.

**Evidence:** MarketingSite.jsx:424 "No tiers, no feature gates, no per-user fees, no minimums." · MarketingSite.jsx:538 FAQ: "£2 per property per month on the Starter plan, with no minimum. The Investor plan is £5..." · tierGating.js:50-54: `const FLOOR = 10; const calc = (propertyCount || 0) * pricePerProp; return Math.max(FLOOR, calc)` · App.jsx:2147 upgrade wall copy: "Available on the £5/property Investor tier."

**Fix:** Pick one story and make every surface match it. Either (a) genuinely flatten to £2/property no-floor and delete the Investor gate, or (b) update the marketing hero, stats strip (line 171 "no tiers"), "Every feature, every plan" card (line 200) and pricing headline to disclose the two tiers and the £10 minimum, and add a 1-4 property example row ("1 property — £10/mo minimum") to the Example Costs table at line 460.

### [HIGH] "Upgrade to Investor" CTA is a dead end — the Investor tier cannot actually be purchased anywhere
**Where:** `src/App.jsx:2150`  ·  _dimension: ux-design_

**Problem:** The dashboard upgrade wall's "Upgrade to Investor →" button (App.jsx:2150-2161) routes to Settings → Billing. But BillingPage.jsx (the component rendered for that tab, FeatureComponents.jsx:914) contains no tier selector or upgrade control — its only actions are 'Add payment method' and 'Manage subscription' (BillingPage.jsx:145-160), and api.createCheckoutSession(companyId, action) takes no tier parameter (src/lib/api/_monolith.js:1522). The create-checkout edge function hardcodes a single price: supabase-functions/create-checkout/index.ts:125 `line_items: [{ price: STRIPE_PRICE_ID, quantity: Math.max(1, propertyCount) }]`. So the product advertises and upsells a £5 Investor tier that no user can buy through any flow — a paying customer who wants to give you more money hits a cul-de-sac, and the gated AI Insights feature is unreachable for everyone except free-tier/admin accounts.

**Evidence:** App.jsx:2160 `Upgrade to Investor →` button → setView('settings') + set-settings-tab 'billing'; BillingPage.jsx:146-159 renders only `'💳 Add payment method'` / `'Manage subscription'`; create-checkout/index.ts:125 `line_items: [{ price: STRIPE_PRICE_ID, quantity: Math.max(1, propertyCount) }]` — no tier anywhere in the request body (api/_monolith.js:1535 sends only company_id, action, return_origin).

**Fix:** Either build the upgrade path (Investor price ID in Stripe, tier param through createCheckoutSession and the edge function, a tier picker on BillingPage) or remove the Investor upsell wall from the dashboard until it exists. Shipping the upsell without the checkout is the worst of both worlds.

### [HIGH] Fabricated placeholder testimonials presented as real customer quotes on the live marketing site
**Where:** `src/components/MarketingSite.jsx:374`  ·  _dimension: ux-design_

**Problem:** The testimonials section displays three named quotes ("Sarah M.", "James K.", "Priya D." at lines 387/392/397) with the footer "Names changed at request of customers; portfolio sizes accurate" (line 414). The code comment at lines 374-376 admits these are invented: "Replace the placeholder names + roles with real customers when you have willing referees." Publishing invented endorsements with a footnote vouching for their accuracy is deceptive advertising — for a UK-targeted paid product this is a CAP Code / ASA exposure (fake testimonials are explicitly prohibited) and a serious trust liability if a customer or competitor notices.

**Evidence:** MarketingSite.jsx:374-376 comment: "Testimonials — three quotes with portfolio size. Replace the placeholder names + roles with real customers when you have willing referees." vs line 414 rendered copy: "Names changed at request of customers; portfolio sizes accurate."

**Fix:** Remove the testimonials section (or replace with genuinely obtained quotes with consent records) before the next deploy. At minimum delete the "portfolio sizes accurate" attestation line.

### [HIGH] 2026-05-31 storage-policy injection fix was committed to the repo but never applied to production — audit finding #5 still open live
**Where:** `supabase-migrations/2026-05-31_storage_policy_injection_fix.sql:37`  ·  _dimension: prior-audit-followup_

**Problem:** The migration that 'closes OVERNIGHT_AUDIT.md finding #5' exists in the repo (committed in 13e79ce, 2026-06-02) but was never run against production: (a) SELECT count(*) FROM pg_proc WHERE proname = 'enforce_document_path_ownership' returns 0; (b) no trg_*_path_ownership triggers exist; (c) the live 'Users access own files in property-documents' policy is still the OLD version containing the forgeable branches the audit described — EXISTS(... property_documents.file_path = objects.name AND user_id = auth.uid()) with no has_property_access/has_company_access checks and no inspections/companies legacy-path branches. So the confused-deputy attack (insert a property_documents row with your own user_id and a victim's file_path to gain read access to their file) remains exploitable in production. The code-side runbook steps DID deploy (uploadInspectionPhoto now writes `${userId}/inspections/...` at src/lib/api/_monolith.js:556, uploadCompanyDocument writes `{user_id}/company_documents/...` at line 1192), which means legacy-path inspection photo and company-doc reads currently only work because of the wide-open legacy policies from the critical finding above — once those are dropped, this migration MUST be applied in the same maintenance window or collaborator and legacy-path document access breaks.

**Evidence:** Live policy USING clause: "((bucket_id = 'property-documents') AND (auth.uid() IS NOT NULL) AND ((storage.foldername(name))[1] = auth.uid()::text OR EXISTS (SELECT 1 FROM property_documents WHERE file_path = objects.name AND user_id = auth.uid()) OR EXISTS (SELECT 1 FROM company_documents ...) OR EXISTS (SELECT 1 FROM deal_documents ...)))" — the pre-fix shape. Live function check: [{"fn":0}] for enforce_document_path_ownership. Migration header claims: "Storage policy injection fix (closes OVERNIGHT_AUDIT.md finding #5)".

**Fix:** Apply 2026-05-31_storage_policy_injection_fix.sql to production (after adding the three legacy-policy DROPs per the critical finding), then run its VERIFY runbook steps a-d, including the forged-row INSERT test which must raise 'file_path must live under your own user folder'. Institute a migration-application check (e.g. a supabase_migrations tracking table or CI step) so committed migrations cannot silently diverge from production again.

### [HIGH] Tenant portal cannot read any tenant data — no RLS path grants tenants access to their own property (portal is non-functional at the DB layer)
**Where:** `supabase-migrations/row-level-security.sql:142`  ·  _dimension: gap-critic_

**Problem:** The confirmed findings list only the tenant rent-tracker JS bugs (broken fetch, TypeError, year-blind matching). The deeper, more fundamental problem nobody reported: there is NO RLS policy anywhere that grants a tenant read access to their property data. has_property_access() resolves to has_company_access(), which only returns true for company owners and user_company_access rows — tenant_profiles is never consulted. Verified live: has_company_access and user_has_company_access (pg_proc) check only companies.owner_id and user_company_access; neither references tenant_profiles. Therefore fetchTenantProperty (src/lib/api/tenant_portal.js:36) joins properties->companies, both of which require company access, so a real tenant gets NULL property/company and TenantPortal.jsx:98 falls into the 'Not set up yet'/error branch. fetchTenantRentPayments, fetchTenantMaintenance, fetchTenantDocuments all filter rent_payments/maintenance_jobs/property_documents whose policies likewise require user_id=auth.uid() OR has_property_access — none of which a tenant satisfies. The entire tenant portal returns empty/errors for legitimate tenants regardless of the JS fixes.

**Evidence:** row-level-security.sql:142-149 `CREATE FUNCTION has_property_access(...) ... RETURN has_company_access(v_co_id)`; live has_company_access body: `IF EXISTS (SELECT 1 FROM companies WHERE id=p_company_id AND owner_id::text=v_uid) ... IF EXISTS (SELECT 1 FROM user_company_access WHERE company_id=p_company_id AND user_id::text=v_uid) ... RETURN false` (no tenant_profiles). companies SELECT policy (live): `is_developer() OR has_company_access(id)`. tenant_portal.js:36-49 fetchTenantProperty selects `property:properties(*, company:companies(*))`.

**Fix:** Add tenant-aware access: either extend has_property_access() to also return true when EXISTS(SELECT 1 FROM tenant_profiles WHERE user_id=auth.uid() AND property_id=p_property_id), or add explicit SELECT policies for tenants on properties/companies (contact fields only)/rent_payments/maintenance_jobs/property_documents(shared_with_tenant=true) scoped via tenant_profiles. Without this the portal feature is dead in production.

### [HIGH] Any authenticated user can self-register as a tenant of ANY property (tenant_profiles has no invite/token binding; RLS WITH CHECK is NULL)
**Where:** `src/lib/api/tenant_portal.js:28`  ·  _dimension: gap-critic_

**Problem:** registerTenantProfile upserts a tenant_profiles row using a property_id taken verbatim from the `?tenant_property=<uuid>` URL param (App.jsx:1001-1004). Nothing validates that an invite exists for this user/property — the 'invite' is just an unsigned property UUID in a shareable link. The live tenant_profiles policy `tenant_own` is FOR ALL USING ((user_id = auth.uid()) OR is_platform_admin()) with with_check = NULL; for an ALL policy a NULL WITH CHECK falls back to the USING clause, so the insert passes as long as user_id=self — the attacker-chosen property_id is never checked. Any signed-in user can therefore enumerate/guess property UUIDs and create tenant_profiles rows binding themselves to arbitrary properties. While the company-access RLS gaps (finding above) currently block most reads, this still lets an attacker (a) inject themselves into a landlord's tenant list, (b) insert tenant_messages and maintenance_jobs against that property (maintenance_jobs RLS only checks user_id=auth.uid()), and (c) drive the notify-landlord spam vector below. It is also a latent privilege-escalation: the moment tenant-aware RLS is added (which it must be, per the finding above), this becomes a full cross-tenant data breach unless the registration is fixed first.

**Evidence:** tenant_portal.js:28-34 `registerTenantProfile(userId, propertyId){ supabase.from('tenant_profiles').upsert({user_id:userId, property_id:propertyId}, {onConflict:'user_id,property_id'})...}`; App.jsx:1001 `const tenantPropertyId = urlParams.get('tenant_property')` then :1004 `await api.registerTenantProfile(user.id, tenantPropertyId)`; live policy tenant_own: qual `((user_id = auth.uid()) OR is_platform_admin())`, with_check `null`; inviteTenant only builds `${baseUrl}?tenant_property=${propertyId}` with no token (tenant_portal.js:18-26).

**Fix:** Bind tenant registration to a signed, single-use invite token stored server-side (e.g. an invitations row with property_id + expiry), validate it in an edge function or a SECURITY DEFINER RPC before inserting tenant_profiles, and set an explicit WITH CHECK on the tenant_profiles policy that requires a matching pending invite. Never derive tenancy from a raw property UUID in the URL.

## Medium (31)

### [MEDIUM] Password-reset flow broken (no PASSWORD_RECOVERY handler)
**Where:** `src/components/LoginPage.jsx:206`  ·  _dimension: auth-authz_

**Problem:** resetPasswordForEmail has no PASSWORD_RECOVERY handler/set-new-password screen, so reset never completes.

**Evidence:** LoginPage.jsx:206-211 success text only; no handler; updateUserPassword _monolith.js:1026 needs current pw.

**Fix:** Add PASSWORD_RECOVERY handler + set-new-password screen; set redirectTo.

### [MEDIUM] Admin gating inconsistent; delete-user edge fn absent from repo
**Where:** `src/components/AdminDashboard.jsx:3288`  ·  _dimension: auth-authz_

**Problem:** Renders on client isPlatformAdmin; admin write helpers are per-table-RLS only (owner allowed); deleteUser posts to a delete-user edge fn absent from repo.

**Evidence:** App.jsx:807-810; AdminDashboard.jsx:3288; deleteUser _monolith.js:2104; no delete-user in supabase-functions.

**Fix:** Treat isPlatformAdmin as cosmetic; admin mutations behind SECURITY DEFINER fns re-checking is_developer(); add delete-user source to repo.

### [MEDIUM] lead-capture IP rate-limit bypassable via spoofed X-Forwarded-For — email-bombing from the company domain
**Where:** `supabase-functions/lead-capture/index.ts:111`  ·  _dimension: edge-functions_

**Problem:** lead-capture is a public no-JWT endpoint whose only abuse control is a 10/hour limit keyed on the first token of X-Forwarded-For. A client can set its own X-Forwarded-For; the platform appends the real IP after it and .split(',')[0] takes the attacker-supplied leading value, so rotating a fake first IP per request defeats the limit. An attacker can then submit arbitrary victim emails and the function fires a confirmation email to each via Resend from justin@ownproperly.com — unauthenticated email-bombing that burns Resend fees and harms domain reputation. The honeypot does nothing against a targeted script.

**Evidence:** line 111: const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'; line 115-120 counts by that ip; line 150 sendConfirmation(email,source) POSTs to api.resend.com/emails with to:[to] (request-supplied).

**Fix:** Do not trust client-supplied X-Forwarded-For; use the platform connection IP. Add a server-side per-email send cap and global hourly cap. Require a CAPTCHA/Turnstile token or signed nonce before sending, and only email an address once per N days.

### [MEDIUM] Reflected XSS in OAuth callback error pages via unescaped state/error parameters
**Where:** `supabase-functions/hmrc-oauth-callback/index.ts:76`  ·  _dimension: edge-functions_

**Problem:** htmlPage interpolates attacker-controlled values into HTML without escaping. The error branch is reachable with no valid OAuth code and no authentication: GET ?error=...&state=<base64> renders htmlPage with returnTo from the unsigned state.return_to (line 91) into an <a href>, plus raw error/error_description into a span. A crafted return_to like "><script>...</script> yields reflected script execution. It runs on the *.supabase.co functions origin (not the app origin) so cannot read app localStorage, but is still unauthenticated reflected-XSS usable for phishing on a trusted domain. xero-oauth-callback has the same unescaped-returnTo-in-href pattern in its error responses (lines 148, 170).

**Evidence:** htmlPage line 76: <a class="btn" href="${returnTo}">; error branch line 97-102 embeds ${oauthError}${desc?' — '+desc:''} (line 99); returnTo is state.return_to (line 91). None HTML-escaped.

**Fix:** HTML-escape every interpolated value and validate/allow-list return_to before placing it in an href. HMAC-signing state removes the ability to control return_to.

### [MEDIUM] bank-truelayer stores bank OAuth access & refresh tokens in plaintext
**Where:** `supabase-functions/bank-truelayer/index.ts:233`  ·  _dimension: edge-functions_

**Problem:** Every other integration encrypts OAuth tokens at rest via encryption.ts (bank-plaid line 134, xero-oauth-callback line 140, hmrc-oauth-callback line 154, mtd-submit/xero-sync via resolveToken), nulling plaintext when a key is set. bank-truelayer never imports the helper and writes the TrueLayer access_token and refresh_token in clear text into bank_connections.partner_data, both on finalize and on every refresh. These tokens grant read access to the user's real bank-account transactions (PSD2 AIS). A DB dump or row-read leak exposes live bank credentials for TrueLayer users while Plaid users are protected — an inconsistent, avoidable defense-in-depth gap.

**Evidence:** finalize() line 233-238: const partnerData = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, ... } written into partner_data. ensureFreshToken() writes plaintext line 115-120. Imports (line 24-25) include only createClient; no encryption.ts exists in the bank-truelayer dir.

**Fix:** Mirror bank-plaid: import encryptToken/decryptToken, store ciphertext under access_token_enc/refresh_token_enc with plaintext nulled when OWNPROPERLY_TOKEN_KEY is set, decrypt on read. Add a migration to re-encrypt existing plaintext tokens.

### [MEDIUM] CSV formula injection
**Where:** `src/components/ReportsPage.jsx:366`  ·  _dimension: xss-injection-secrets_

**Problem:** Exporters dont neutralise leading = + - @ so cells execute in Excel.

**Evidence:** ReportsPage.jsx:366 and DashboardComponents.jsx:221.

**Fix:** Prefix a quote for formula-trigger cells.

### [MEDIUM] Property-detail Rent tab and Overview rent card count segments as months and multiply by full monthly rent — income overstated after the segments change
**Where:** `src/App.jsx:4008`  ·  _dimension: features-core_

**Problem:** Commit e1c14eb's protection ('stat counts collapse a month's segments to one dominant status, income sums actual paid amounts') was only applied to RentTrackerOverview.getStats (App.jsx:3678-3702). Two other money displays were not updated: (1) RentTab stats count raw rows — `paid = filtered.filter(p=>p.status==='paid').length` then `totalIncome = paid * (selected.rent_pcm||0)` — so a mid-month tenant changeover (out 12th £450 segment + in 18th £500 segment, rent £1,200pcm) displays 'Months Paid 2 … £2,400' instead of £950; partial-payment months (paid segment + overdue balance segment) count as both 1 paid and 1 missed month, and 'Months Missed' is also valued at missed×rent_pcm. (2) The Overview 'Rent at a glance' card (App.jsx:2859-2862) has the same per-segment counting, and its `collected` sum falls back to full rent_pcm for every amount-less paid segment. The same screen therefore disagrees with the Rent Tracker page for the same property and year.

**Evidence:** App.jsx:4003-4009: `const paid = filtered.filter(p=>p.status==='paid').length; ... const totalIncome = paid * (selected.rent_pcm||0)`; App.jsx:2859-2862: `const paid = ytd.filter(p => p.status === 'paid').length; ... const collected = ytd.filter(p => p.status === 'paid').reduce((s,p)=>s+(p.amount||(selected.rent_pcm||0)),0)`; contrast with the corrected getStats at App.jsx:3682-3700.

**Fix:** Extract getStats/monthDominantStatus into a shared helper (src/lib) and use it in RentTab and the Overview card: month counts via dominant status per (year,month) group, income via summed actual amounts with the rent_pcm fallback applied once per month, not per segment.

### [MEDIUM] Statement importer can overwrite the wrong rent segment in multi-segment months
**Where:** `src/components/StatementImporter.jsx:132`  ·  _dimension: features-core_

**Problem:** When importing a rent line, the importer looks up an existing row by (property, year, month) only, takes the first ordered by period_start nullsFirst, and stamps status='paid', the statement amount AND the statement's period dates onto that row. In a month that now holds several dated segments (the exact scenario the e1c14eb change enables — e.g. tenant 1's 1st–12th paid segment and tenant 2's 18th–30th overdue segment), the importer for tenant 2's payment updates tenant 1's row: its period dates are replaced by the statement period and its history destroyed, while tenant 2's segment stays overdue. The commit message claims 'the statement importer no longer assumes a single row per month', but it only avoided the .single() throw — it still updates an arbitrary first row. Repeat imports of different statements for the same month silently clobber each other.

**Evidence:** StatementImporter.jsx:132-142: `.select('id').eq('property_id', item.propertyId).eq('year', year).eq('month', month).order('period_start', { ascending: true, nullsFirst: true }).limit(1).maybeSingle()` followed by `update({ status:'paid', amount:item.editAmount, ...(periodStart && { period_start: periodStart }), ... }).eq('id', existing.id)`.

**Fix:** Match on overlapping period instead of month: select rows where period_start <= statement period_end AND period_end >= statement period_start (plus legacy NULL-period month rows); update only an overlapping row, otherwise insert a new segment. Never overwrite a row whose period doesn't intersect the statement's period.

### [MEDIUM] MTD quarterly deadlines hardcoded 2 days early (5th instead of HMRC's 7th)
**Where:** `src/lib/mtdItsa.js:47`  ·  _dimension: features-core_

**Problem:** quartersForTaxYear sets submission deadlines of 5 Aug / 5 Nov / 5 Feb / 5 May. HMRC's MTD ITSA quarterly update deadline is the 7th of the month following the quarter end (7 August, 7 November, 7 February, 7 May — aligned with the VAT 'one month and 7 days' convention). quarterStatusLabel (line 174-187) derives 'Due in Nd', 'Ready to file' and 'Overdue' badges from these dates, so the app tells landlords they are Overdue two days before they actually are, and the day-countdown is wrong throughout. In a tax product this erodes trust even though the error is in the conservative direction. The code comment ('1 month + 5 days after each quarter end') is also internally wrong — the dates as written are exactly 1 month after quarter end.

**Evidence:** mtdItsa.js:47-51: `{ quarter: 1, from: `${sy}-04-06`, to: `${sy}-07-05`, deadline: `${sy}-08-05` }, { quarter: 2, ... deadline: `${sy}-11-05` }, { quarter: 3, ... deadline: `${sy+1}-02-05` }, { quarter: 4, ... deadline: `${sy+1}-05-05` }`.

**Fix:** Change the four deadline strings to the 7th (`-08-07`, `-11-07`, `-02-07`, `-05-07`), fix the comment, and add a unit test for quartersForTaxYear — mtdItsa.js currently has zero test coverage (no mtdItsa.test.js in src/lib/__tests__) despite being HMRC-facing money math.

### [MEDIUM] Logging a maintenance job without dates sends empty strings to date columns — insert fails
**Where:** `src/components/maintenance/index.jsx:51`  ·  _dimension: features-core_

**Problem:** The blank form initialises date_raised:'' and date_resolved:'' (line 31), and handleSave passes the form through with only quoted_cost/actual_cost coerced: `const data = {...form, quoted_cost:parseFloat(form.quoted_cost)||null, actual_cost:parseFloat(form.actual_cost)||null}`. maintenance_jobs.date_raised and date_resolved are Postgres `date` columns (verified live schema). PostgREST rejects an empty string for a date column (22007 'invalid input syntax for type date: ""'), so '+ Log Job' with the date fields left blank — a completely normal flow when logging a quick repair — fails with a cryptic toast. Same applies to editing a job and clearing a date.

**Evidence:** maintenance/index.jsx:31: `const blank = {title:'',...,date_raised:'',date_resolved:'',notes:''}`; :51: `const data = {...form, quoted_cost:parseFloat(form.quoted_cost)||null, actual_cost:parseFloat(form.actual_cost)||null}` — date fields pass through as ''. Live schema: maintenance_jobs.date_raised, date_resolved are type date.

**Fix:** Null-coerce empty date strings before save: `date_raised: form.date_raised || null, date_resolved: form.date_resolved || null` (and consider a generic emptyStringsToNull helper for all forms writing date/numeric columns).

### [MEDIUM] Xero webhook never triggers a sync — advertised feature is a no-op
**Where:** `supabase-functions/xero-webhook/index.ts:85`  ·  _dimension: features-integrations_

**Problem:** IntegrationsPanel surfaces a webhook URL + per-connection signing key so users can wire Xero push notifications. But on a verified webhook the function only sets last_sync_error = null and inserts a log row. The header comment says it 'enqueue[s] a needs sync flag on the connection' so 'the next user-triggered sync (or cron) picks it up' — but no such flag column is written, and neither xero-sync nor xero-cron-reconcile reads any pending-sync flag. So enabling the webhook does nothing functional; changes in Xero are only ever pulled on a manual sync or the daily cron, exactly as without the webhook.

**Evidence:** // Mark this connection as "needs sync" so the next user sync (or cron)
// pulls the changes...
await admin.from('xero_connections').update({
  last_sync_error: null,  // clear any old error since something is happening
}).eq('user_id', matched.user_id).eq('company_id', matched.company_id)

**Fix:** Add a real pending_sync_at / needs_sync boolean on xero_connections, set it here, and have xero-cron-reconcile (and/or the next manual sync) honour it by running a pull. Otherwise remove the webhook UI so it isn't sold as working.

### [MEDIUM] OAuth state is unsigned and the nonce is never validated (CSRF / connection injection) — Xero and HMRC
**Where:** `supabase-functions/xero-oauth-callback/index.ts:76`  ·  _dimension: features-integrations_

**Problem:** Both callbacks decode state as plain base64 JSON and trust user_id (and company_id for Xero) straight from it. A nonce is generated in the 'start' step but never stored server-side or checked on callback, and there is no HMAC. This is a classic OAuth CSRF / login-CSRF: an attacker can craft a state blob, complete consent with their OWN Xero/HMRC account, and have the resulting tokens written against a chosen user_id/company_id row — forcing a victim to operate on the attacker's accounting org (so the victim's financial pushes land in the attacker's Xero), or attaching attacker credentials. The code comments explicitly defer this ('HMAC signing would be stronger — TODO when we ship live'), yet it is shipped to paying users.

**Evidence:** function decodeState(s: string): Record<string, any> {
  try { return JSON.parse(atob(s)) } catch { return {} }
}
// callback: if (!state.user_id) return ... ; upsert({ user_id: state.user_id, company_id: state.company_id, ... })
// nonce: crypto.randomUUID()  // generated, never verified

**Fix:** Sign state with an HMAC over {user_id, company_id, nonce, exp} using a server secret and verify it on callback, or persist the nonce server-side at 'start' and require a match. Also bind the callback to the authenticated session that initiated it where possible. Same fix in hmrc-oauth-callback (lines 65-67, 90, 105).

### [MEDIUM] GDPR export and stored backups silently omit ALL documents (queries a non-existent 'url' column)
**Where:** `src/lib/api/backups.js:136`  ·  _dimension: features-integrations_

**Problem:** Both the client GDPR/quick export and the server-side backup select id,name,created_at,url from property_documents. Per property-documents-ocr.sql the real columns are name, file_url, file_path — there is no 'url' column, so PostgREST returns an error for the whole select, which is swallowed by .catch(()=>[]). Result: every GDPR Subject Access Request export and every stored/cron backup contains an empty documents array. Users believe their document metadata is backed up / exported when it never is — a data-completeness and GDPR-accuracy problem.

**Evidence:** supabase.from('property_documents').select('id,name,created_at,url').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[])
... documents: documents.map(d=>({ id:d.id, name:d.name, created_at:d.created_at, url:d.url }))
// and create-user-backups/index.ts:29
admin.from('property_documents').select('id,name,created_at,url')...catch(() => [])
// schema: 'The existing DocumentsTab uses: name, file_url, file_path, file_type, file_size, category'

**Fix:** Change the select to id,name,file_url,file_path,created_at (the real columns) in both backups.js exportUserData and create-user-backups. Remove the broad .catch(()=>[]) so a future column rename surfaces instead of silently emptying the array.

### [MEDIUM] HMRC fraud-prevention headers incomplete/incorrect for WEB_APP_VIA_SERVER
**Where:** `src/lib/hmrcFraudHeaders.js:150`  ·  _dimension: features-integrations_

**Problem:** Two problems against the HMRC Fraud Prevention spec for the declared connection method (WEB_APP_VIA_SERVER). (1) Gov-Client-User-IDs is meant to carry an identifier for the user in our system (e.g. ownproperly=<userId>); instead it is populated with an OS string parsed from the userAgent, so it never conveys a user id. (2) Gov-Client-Multi-Factor and Gov-Client-Local-IPs are emitted empty, and mtd-submit drops every empty header before sending ('if (typeof v === 'string' && v.length > 0)'), so required headers are simply absent. Likewise Gov-Client-Public-IP is dropped entirely if the ipify lookup fails. HMRC scores/penalises missing or malformed headers and rejects submissions outright in production for missing required ones (INVALID_FRAUD_PREVENTION_HEADERS / MISSING_FRAUD_PREVENTION_HEADERS, which the code itself maps).

**Evidence:** 'Gov-Client-User-IDs': `os=${encodeURIComponent(navigator.userAgent.split(' ').pop() || 'web')}`,
'Gov-Client-Multi-Factor': '',
'Gov-Client-Local-IPs': '',
// mtd-submit drops empties:
for (const [k, v] of Object.entries({ ...fraud_headers, ...vendorHeaders })) {
  if (typeof v === 'string' && v.length > 0) allFraudHeaders[k] = v
}

**Fix:** Set Gov-Client-User-IDs to a real per-user id (e.g. `ownproperly=<auth user id>`). Validate against HMRC's Test Fraud Prevention Headers API before going live, and decide per-header whether an empty value should be sent or the submission blocked, rather than silently dropping required headers.

### [MEDIUM] Plaid cursor is persisted before transactions are processed — a crash loses transactions permanently
**Where:** `supabase-functions/bank-plaid/index.ts:215`  ·  _dimension: features-integrations_

**Problem:** The sync collects all new transactions via the /transactions/sync cursor loop, then writes the advanced next_cursor back to partner_data, and only afterwards iterates newTxns to upsert rows and run matching. If processing throws part-way (or the function times out), the cursor has already advanced, so Plaid will never return those transactions again on the next sync — they are silently lost. Because matching/upsert happens after the cursor commit, there is no recovery path.

**Evidence:** while (hasMore) { const result = await plaidPost('/transactions/sync', {...}); newTxns.push(...(result.added||[])); cursor = result.next_cursor; hasMore = result.has_more }
// Persist cursor for next sync
await admin.from('bank_connections').update({ partner_data: { ...pd, cursor, last_synced_at: ... } }).eq('id', c.id)
for (const tx of newTxns) { ... }  // processing happens AFTER cursor is saved

**Fix:** Persist the cursor only AFTER all transactions in the batch have been successfully upserted, or process and commit page-by-page so a mid-run failure leaves the cursor at the last fully-processed page.

### [MEDIUM] Xero push has no concurrency guard — double-run can duplicate BankTransactions in Xero
**Where:** `supabase-functions/xero-sync/index.ts:331`  ·  _dimension: features-integrations_

**Problem:** Idempotency relies on an in-memory syncedSet read once at the start, with the xero_sync_map row written only AFTER the Xero POST succeeds. There is no lock on the connection/log row. If two syncs run concurrently for the same (user,company) — e.g. a user double-clicks, or a manual sync overlaps the daily cron — both read the same syncedSet, both POST the same rent_payment/expense to Xero (POST /BankTransactions is not idempotent, no unique reference), and you get duplicate transactions in the customer's accounts. The token-refresh path has the same race: concurrent refreshes both call Xero with the same rotating refresh token, and the second fails ('No refresh token' on a later sync).

**Evidence:** const { data: synced } = await admin.from('xero_sync_map').select('entity_type, local_id')... 
const syncedSet = new Set((synced || []).map(s => `${s.entity_type}:${s.local_id}`))
// ... POST to Xero, THEN upsert xero_sync_map after success

**Fix:** Take an advisory lock or use a 'running' guard on xero_connections/xero_sync_log (refuse to start if a run is already in progress for that user+company), and/or send a stable idempotency Reference per local_id so a re-POST is deduplicated by Xero. Serialise token refresh likewise.

### [MEDIUM] Price shown on BillingPage may not match what Stripe charges (£10 floor and tier pricing exist only client-side)
**Where:** `src/components/BillingPage.jsx:96`  ·  _dimension: ux-design_

**Problem:** BillingPage displays `calcMonthlyPrice(propCount, tierKey)` — per-tier price with a £10/month floor (tierGating.js:50-54) and explicitly renders "£10 floor" (BillingPage.jsx:123). The checkout that actually creates the subscription charges `quantity = max(1, propertyCount)` of one flat STRIPE_PRICE_ID (create-checkout/index.ts:125) with no floor logic and no tier in code. Unless the £10 minimum and Investor pricing are encoded inside that single Stripe price object (nothing in the repo suggests they are), a 1-property customer is shown "£10/mo" but charged £2/mo — or vice versa if Stripe was configured differently later. Displayed money must be derived from the same source as charged money.

**Evidence:** BillingPage.jsx:96 `const monthly = calcMonthlyPrice(propCount, tierKey)` and :120 renders `{fmt(monthly)}/mo`, :123 `<span> · £10 floor</span>`; tierGating.js:51 `const FLOOR = 10`; create-checkout/index.ts:125 `line_items: [{ price: STRIPE_PRICE_ID, quantity: Math.max(1, propertyCount) }]` — no floor, no tier.

**Fix:** Verify the live Stripe price configuration against calcMonthlyPrice for 1, 4, 5 and 20 properties. Then make one side authoritative: either implement the floor/tier in the edge function (e.g. quantity = max(5, propertyCount) for a £2 unit price) or read the upcoming-invoice amount from Stripe and display that instead of a client-side calculation.

### [MEDIUM] If the initial data load fails, existing customers see the brand-new-account "Welcome to OwnProperly" zero-state instead of an error
**Where:** `src/App.jsx:1043`  ·  _dimension: ux-design_

**Problem:** App.jsx's main loadData catch block sets companies and properties to empty arrays and only logs to console — the comment even says "Show an error state" but no error UI was ever built. The dashboard then renders the first-run hero ("You're on a 14-day free trial. The fastest way to see what the app does is to add your first company...", App.jsx:2016-2027) because its condition is simply `activeProperties.length === 0 && companies.length === 0`. A paying landlord with 50 properties who hits a transient Supabase/network failure on login sees what looks like a wiped account, with no error message and no retry button — a support-ticket and churn generator. refreshData (App.jsx:1087) has the same silent `catch(e) {}`.

**Evidence:** App.jsx:1043-1048: `} catch(e) {\n  // Data load failed — DO NOT fall back to showing everything. Show an error state.\n  console.error('Data load failed:', e)\n  setCompanies([])\n  setProperties([])` — no state is set that any component renders as an error. App.jsx:2016: `{activeProperties.length === 0 && companies.length === 0 && (` → welcome hero.

**Fix:** Add a `loadError` state set in the catch; when set, render a dedicated error card ("We couldn't load your portfolio — Retry") instead of the welcome hero, and gate the zero-state hero on `!loadError`. Apply the same to refreshData (App.jsx:1087).

### [MEDIUM] Silent catch(e){} on fetches makes failures masquerade as empty data across Billing, Reports, Deals and property tabs
**Where:** `src/components/BillingPage.jsx:29`  ·  _dimension: ux-design_

**Problem:** A repeated pattern: initial fetch wrapped in `catch(e) {}` with no error state, so the failure path renders the empty/zero state. Worst instances: (1) BillingPage.jsx:29 — if fetchSubscriptions fails, line 93 falls back to `sub?.status || 'trialing'`, so an ACTIVE paying customer is shown a "Free Trial" badge and an "Add payment method" button on the billing page. (2) ReportsPage.jsx:122 — all five datasets silently empty, so every report renders "No data for this period" (line 322), telling an accountant-bound user their year has no income. (3) DealsPage.jsx:182 — failure shows the "No deals yet. Add your first deal" empty state (lines 388-393). (4) DealsPage.jsx:1509/1516/1523 — milestone checkbox clicks that fail do nothing at all, no toast, no revert cue. (5) FeatureComponents.jsx:67 (compliance tab), :178 (tenancy), :297 (expenses), :463 (profile); DashboardComponents.jsx:669 (contractors). InsurancePage.jsx:74-76 shows the correct pattern (toast on load failure) — the rest of the app doesn't follow it.

**Evidence:** BillingPage.jsx:29 `} catch(e) {}` + :93 `const status = co.is_free_tier ? 'free_tier' : (sub?.status || 'trialing')`; ReportsPage.jsx:122 `} catch(e) {}` + :322 `if (!rows.length) return <div ...>No data for this period</div>`; DealsPage.jsx:181-182 `setDeals(data) } catch(e) {}` + :391 `No deals yet. Add your first deal to analyse.`

**Fix:** Adopt the InsurancePage convention everywhere: `catch (e) { showToast(e.message || 'Failed to load', 'error') }` plus an error flag that distinguishes "empty" from "failed" so empty states never render on failure. Prioritise BillingPage (money) and ReportsPage (tax data).

### [MEDIUM] Stale "20 built-in reports" claim in four places after the catalogue was cut to 16
**Where:** `src/components/OnboardingTour.jsx:83`  ·  _dimension: ux-design_

**Problem:** ReportsPage.jsx:51 documents "Curated to 16 reports — May 2026" and REPORT_CATALOGUE contains exactly 16 entries, but the product still advertises 20: OnboardingTour.jsx:83-84 ("20 reports & analytics" / "20 built-in reports"), HelpCenter.jsx:521 ("over 20 built-in reports" — also lists reports that no longer exist, e.g. ROI tracker/portfolio valuation), MarketingSite.jsx:101 and :445 ("20 built-in reports"). New users counting reports against the tour/pricing checklist will find the product short of its own claims.

**Evidence:** ReportsPage.jsx:51 comment "Curated to 16 reports — May 2026. Removed 4 redundancies..." (REPORT_CATALOGUE has 16 `id:` entries); OnboardingTour.jsx:84 "The Reports section has 20 built-in reports"; MarketingSite.jsx:445 "'20 built-in reports with CSV export'".

**Fix:** Update all four strings to "16 reports" (or a future-proof "16+ reports"), and refresh the HelpCenter reports answer to list the surviving catalogue. Add the catalogue length dynamically where possible (ReportsPage already renders `{REPORT_CATALOGUE.length} reports available`).

### [MEDIUM] Shared modal fix (FocusTrap + role=dialog + Escape) was applied to 11 modals but skipped at least 7 other modal surfaces
**Where:** `src/components/BankConnectionsModal.jsx:140`  ·  _dimension: ux-design_

**Problem:** Since the previous audit, a shared FocusTrap (src/lib/FocusTrap.jsx — focus trap, Escape-to-close, focus restore) plus role="dialog"/aria-modal landed on the 8 modals in src/components/modals/ and on BulkAddPropertyModal, ReceiptScanModal, TenantReferenceModal. But these dialogs were missed and still have no focus trap, no Escape handling, and no dialog semantics: BankConnectionsModal.jsx:140, BankInboxModal.jsx:109, BuildingMortgageModal.jsx:168, NoticeGenerator.jsx:137/198/310 (the legal-notice generator — a long form), StatementImporter.jsx:199, RolePermissionsModal.jsx:77, MtdItsaPage.jsx:476 (HMRC quarter PreviewModal), InsurancePage.jsx:311 and :867. Keyboard users tab out of these dialogs into the obscured page and cannot dismiss with Escape — inconsistent behaviour between near-identical modals in the same product.

**Evidence:** grep: FocusTrap imported by 11 components; BankConnectionsModal.jsx:140 `<div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>` with no FocusTrap/role=dialog anywhere in the file (grep count 0); same pattern at MtdItsaPage.jsx:476 and NoticeGenerator.jsx:310.

**Fix:** Wrap the remaining 7+ overlay dialogs in the existing `<FocusTrap onEscape={onClose}>` and add `role="dialog" aria-modal="true" aria-labelledby` to their `.modal` roots — mechanical change, the utility already exists.

### [MEDIUM] Backdrop mis-click destroys unsaved form data in Insurance policy, Notice Generator and Building Mortgage forms
**Where:** `src/components/InsurancePage.jsx:867`  ·  _dimension: ux-design_

**Problem:** src/lib/modalUtils.js provides safeOverlayClose() precisely to confirm before discarding unsaved changes, and the 8 core modals use it. But three of the longest forms in the app close instantly on any backdrop click with no dirty check: the insurance policy editor (InsurancePage.jsx:867 `onClick={onClose}` — ~10 fields incl. premium, dates, multi-property assignment), the Section 21/8 NoticeGenerator (NoticeGenerator.jsx:310 — a legal form with a compliance checklist) and BuildingMortgageModal.jsx:168. One stray click outside the card and minutes of data entry vanish silently.

**Evidence:** InsurancePage.jsx:867 `<div className="overlay" onClick={onClose}>` (modal content stops propagation at :868); contrast modalUtils.js:20-26 safeOverlayClose: `if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return`.

**Fix:** Use `safeOverlayClose(isFormDirty(initial, form), onClose)` on these three overlays, as the property/company/payment modals already do.

### [MEDIUM] Boot path is a ~10-step sequential network waterfall, including 3 separate reads of the same user_profiles row
**Where:** `src/App.jsx:770`  ·  _dimension: performance_

**Problem:** After the initial Promise.all (companies/properties/access), loadData() awaits roughly ten more round trips strictly in series before setLoading(false): user_profiles is_developer (line 807), permissions/flags/widgets Promise.all (816), loadUserTheme (860, which itself does another user_profiles select for dark_mode in ThemeContext.jsx:47-52), a third user_profiles select for nav_items/yield_basis/account_type (863), fetchAnnouncements (871), fetchOnboardingStatus (875), fetchSubscriptions (922), checkIsTenant then fetchMyCompanies sequentially (1018-1019), then one fetchCompanySettings query per company (1034). At ~80-150ms per Supabase round trip this adds roughly 1-1.5s of spinner on every single login/boot for every paying user. The same user_profiles row is fetched three times in this sequence. Most of these steps have no data dependency on each other and could be one Promise.all; the three user_profiles selects could be one select of all five columns.

**Evidence:** App.jsx:807 `await supabase.from('user_profiles').select('is_developer, platform_admin')...single()`; App.jsx:860 `await loadUserTheme(user.id, user.email)` (ThemeContext.jsx:48 selects `dark_mode` from user_profiles); App.jsx:863 `const { data: prof } = await supabase.from('user_profiles').select('nav_items, yield_basis, account_type')...single()`; App.jsx:871 `const anns = await api.fetchAnnouncements()`; App.jsx:875 `const onboarded = await api.fetchOnboardingStatus(user.id)`; App.jsx:922 `initialSubs = await api.fetchSubscriptions(...)`; App.jsx:1018-1019 `const tenantProfiles = await api.checkIsTenant(user.id); const myCompanies = await api.fetchMyCompanies()...` — each awaited in sequence inside loadData().

**Fix:** Collapse the three user_profiles selects into one `select('is_developer, platform_admin, dark_mode, nav_items, yield_basis, account_type')`. Group the independent awaits (announcements, onboarding status, tenant check, subscriptions, theme) into one Promise.all fired alongside the permissions batch. Replace the per-company fetchCompanySettings loop with a single `.in('company_id', ids)` query. Target: 2-3 sequential round trips total before first paint.

### [MEDIUM] 832 KB (209 KB gzip) monolithic main chunk; unauthenticated marketing visitors download the whole app before the landing page renders
**Where:** `vite.config.js:43`  ·  _dimension: performance_

**Problem:** Code splitting exists (9 pages are React.lazy in src/App.jsx:13-21 — verified in build output) but everything else ships in one index chunk: vite build reports `dist/assets/index-*.js 832.41 kB | gzip: 209.14 kB`, tripping Vite's own >600 kB warning. That chunk includes the 4,358-line FeatureComponents.jsx (which statically imports the 794-line HelpCenter at FeatureComponents.jsx:4), the 4,091-line App.jsx, DashboardComponents (1,177 lines), StatementImporter (467 lines, App.jsx:22), NoticeGenerator (552 lines via components/tenancy/index.jsx:9), and all modals. Worst case is the logged-out path: App.jsx:1291-1298 renders MarketingSite via Suspense, so a first-time visitor must download and parse index (209 KB gz) + react-vendor (45 KB gz) + supabase-vendor (54 KB gz) before the request for MarketingSite-*.js (10 KB gz) even starts — a serial chunk waterfall of ~308 KB gzip JS to show a static landing page, directly hurting paid-acquisition conversion and LCP.

**Evidence:** Build output: `dist/assets/index-BnKPICbW.js 832.41 kB │ gzip: 209.14 kB` + `(!) Some chunks are larger than 600 kB after minification`. App.jsx:1291-1296: `if (!session) return (<><Suspense fallback={<PageLoadingSpinner T={T}/>}><MarketingSite .../></Suspense>` — MarketingSite is lazy but only reachable after the main chunk executes. vite.config.js:43-46 manualChunks only splits `react-vendor` and `supabase-vendor`.

**Fix:** 1) Lazy-load HelpCenter, NoticeGenerator, StatementImporter, BulkAddPropertyModal and the modal set (open-on-demand UI is the ideal lazy target). 2) For the logged-out path, consider serving the marketing page as static HTML (like /blog already is) or a tiny separate entry so visitors never pay for the app bundle. 3) Split FeatureComponents.jsx per tab so portfolio tabs load on demand.

### [MEDIUM] fetchProperties embeds every rent_payments/refurb row for every property on every boot and refresh — payload grows unbounded
**Where:** `src/lib/api/_monolith.js:33`  ·  _dimension: performance_

**Problem:** fetchProperties() selects `*` on properties plus `refurb_phases(*), refurb_costs(*), rent_payments(*)` embedded per row, with no column pruning, no date window, and no limit. ensureFutureRentMonths (_monolith.js:939-983) auto-inserts rows up to 6 months ahead for every property on every login, so rent_payments grows ~1 row/property/month forever (live DB already holds 3,923 rent_payments rows across 151 properties — ~26 nested rows per property today, doubling every ~2 years). This full payload is fetched on boot (App.jsx:777), again after ensureFutureRentMonths inserts (App.jsx:1026), and on every refreshData() (App.jsx:1066) — even when the user lands on the dashboard, which only needs current-year data. ReportsPage independently re-downloads the same data via fetchAllRentPayments (_monolith.js:2030-2036), which is also select('*') with a joined property+company per payment and no limit.

**Evidence:** _monolith.js:33-37: `.from('properties').select('*, company:companies(id,name,abbr,color), refurb_phases(*), refurb_costs(*), rent_payments(*), compliance_items(id,...)')` — no limit/window on the rent_payments embed. Live pg_stat_user_tables: rent_payments n_live_tup = 3923, properties = 151.

**Fix:** Select only the rent_payments columns the UI uses (id, year, month, status, amount, period_start, period_end, payment_date) and window the embed to e.g. the last 24 months via a filtered embed or a separate fetchRentPayments(year) call from the rent tracker. Keep older years behind an on-demand 'load year' fetch. Same column-pruning for fetchAllRentPayments in ReportsPage.

### [MEDIUM] 98 RLS policies re-evaluate auth functions per row (auth_rls_initplan, advisor WARN x98)
**Where:** `supabase-migrations/`  ·  _dimension: supabase-advisors-live_

**Problem:** Live performance advisor lint 'auth_rls_initplan' fires 98 times across essentially every tenant-facing table: properties (5 policies), deals (5), user_profiles (4), user_backups (4), tenant_references (4), property_notes (4), property_inspections (4), notifications (4), company_invites (4), company_documents (4), bank_transactions (4), bank_connections (4), bank_accounts (4), subscriptions (3), invitations (3), companies (3), audit_log (3), portfolio_insights (2), plus 1 each on 30 more tables including rent_payments, compliance_items, maintenance_jobs, mtd_submissions, xero_* and tenant_* tables. Calls like auth.uid() in these policies are re-evaluated for every row scanned instead of once per query, which produces suboptimal plans and linear slowdown on large tables — bank_transactions and rent_payments are exactly the tables that grow unbounded in a property-management app with bank feeds.

**Evidence:** Advisor (representative detail pattern): "Table `public.<table>` has a row level security policy that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale." Full count from live run: 98 lints, distribution as listed (e.g. 5 on public.properties, 5 on public.deals, 4 on public.bank_transactions).

**Fix:** Advisor remediation: wrap each auth function call in a scalar subquery — replace auth.uid() with (select auth.uid()) in every flagged policy so Postgres evaluates it once as an InitPlan (https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan). This is a mechanical rewrite; generate one migration that recreates all 98 flagged policies with the wrapped form, starting with the high-volume tables (bank_transactions, rent_payments, properties, deals).

### [MEDIUM] 64 duplicate permissive RLS policies on 15 tables (multiple_permissive_policies, advisor WARN x64)
**Where:** `supabase-migrations/`  ·  _dimension: supabase-advisors-live_

**Problem:** Live performance advisor lint 'multiple_permissive_policies' fires 64 times: user_backups (15 — worst offender), feature_flags (5), feature_flag_users (5), feature_flag_companies (5), tenancy_details (4), rent_payments (4), property_expenses (4), properties (4), maintenance_jobs (4), deals (4), compliance_items (4), company_settings (3), user_profiles (1), audit_log (1), admin_announcements (1). Every permissive policy for the same role+action must be executed for every relevant query, multiplying the per-row policy cost (and compounding the auth_rls_initplan issue above on the same tables). The feature_flags overlap appears to be fallout from the OVERNIGHT_AUDIT #25 fix layering a new policy on top of existing ones rather than replacing them.

**Evidence:** Advisor detail (representative): "Table `public.admin_announcements` has multiple permissive policies for role `authenticated` for action `SELECT`. Policies include `{announcements_read,announcements_write}`". Live run total: 64 lints; user_backups alone accounts for 15 (multiple roles x actions).

**Fix:** Advisor remediation: consolidate so each table has at most one permissive policy per role per action (https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies). Merge overlapping USING clauses with OR into a single policy, or split read/write policies by action (FOR SELECT vs FOR INSERT/UPDATE/DELETE) instead of FOR ALL policies that overlap action-specific ones. Start with user_backups (15 overlaps) and the feature_flag* trio.

### [MEDIUM] Fabricated placeholder testimonials are live on the public marketing site
**Where:** `src/components/MarketingSite.jsx:374`  ·  _dimension: prior-audit-followup_

**Problem:** LAUNCH_CHECKLIST.md item 21 ('Real testimonials — replace placeholders') is unchecked, and the live marketing page still renders three invented customer quotes attributed to fake people ('Sarah M., Landlord · 6 properties · West Yorkshire', 'James K.', 'Priya D.') under the heading 'What landlords say'. For a published UK product this is more than polish: fake consumer reviews are a banned practice under the Digital Markets, Competition and Consumers Act 2024 (in force April 2025), and the checklist plans paid Google/Meta ads pointing at this page, which adds ASA exposure. The code comment itself acknowledges they are placeholders.

**Evidence:** src/components/MarketingSite.jsx:374-377: "{/* Testimonials — three quotes with portfolio size. Replace the placeholder names + roles with real customers when you have willing referees. */}" followed by hard-coded quotes, e.g. { quote: "I used to spend Sunday mornings updating my spreadsheet...", name: "Sarah M.", role: "Landlord · 6 properties · West Yorkshire" }.

**Fix:** Remove or hide the testimonials section until real, consented customer quotes exist (the checklist's own plan — email top trial users — is fine). Do not enable paid ads while fabricated quotes are live.

### [MEDIUM] Launch-critical dashboard/account actions remain unverified: Supabase MFA toggle, live Stripe end-to-end test, status page
**Where:** `LAUNCH_CHECKLIST.md:60`  ·  _dimension: prior-audit-followup_

**Problem:** Three unchecked LAUNCH_CHECKLIST items materially affect paying users and cannot be verified from the repo: (1) Item 8 — Supabase Auth TOTP must be toggled on in the dashboard; the product ships a 2FA enrolment panel (src/components/TwoFactorPanel.jsx) in Settings, so if the toggle is off, users clicking 'Enable two-factor authentication' hit a runtime error in a security-critical flow. (2) Item 15 — live-mode Stripe end-to-end test (signup → trial → paid → cancel) has no recorded completion; the doc itself notes this 'catches webhook configuration issues that sandbox testing won't surface', and billing suspension logic (commits ba0ce43/587b1a8) now depends on webhook-maintained subscription status. (3) Item 13 — no uptime monitoring/status page, meaning outages on a paid product surface only via support email. These are owner-only actions; none show evidence of completion in the repo or docs (checklist last updated 2026-05-25, before the latest billing-gating changes).

**Evidence:** LAUNCH_CHECKLIST.md:60-64: "### 8. Enable Supabase Auth MFA ... Toggle TOTP on → Save ... (panel is already built)"; :102-106: "### 15. Live Stripe end-to-end test — Use a real credit card on production ... This catches webhook configuration issues that sandbox testing won't surface"; :91-96: "### 13. Status page". All sit in unchecked action sections with no completion marks.

**Fix:** Confirm and record completion of each: toggle TOTP in Supabase Auth and test the TwoFactorPanel enrolment flow on production; run the live Stripe signup→pay→cancel cycle and verify the new collaborator-suspension gating reacts correctly to the webhook-driven status changes; stand up BetterStack (or equivalent) monitors. Update LAUNCH_CHECKLIST.md with dates so the next audit can verify.

### [MEDIUM] notify-landlord lets any logged-in user push attacker-controlled notifications to any landlord's bell (no tenancy check, service-role insert)
**Where:** `supabase-functions/notify-landlord/index.ts:42`  ·  _dimension: gap-critic_

**Problem:** The function authenticates only that the caller is *some* valid user, then looks up the property owner and inserts a notification row for that owner using the service-role client (bypassing the notifications RLS that otherwise requires auth.uid()=user_id). The title/body are built from caller-supplied `title`/`message`. The code comment explicitly acknowledges it does not verify the caller is a registered tenant of the property ('the worst case is a logged-in user spamming notifications to a random landlord'). Combined with the self-registration gap, any user can enumerate property_ids and flood arbitrary landlords' notification feeds with arbitrary text (phishing links rendered as plain text, fake 'URGENT repair' alerts, etc.). It is an unauthenticated-in-practice write into another tenant's data via a privileged function.

**Evidence:** notify-landlord/index.ts:50-51 `const { data:{user} } = await userClient.auth.getUser(); if(!user) return json({error:'Unauthorised'},401)`; comment :44-45 'We don't lock down to "registered tenant of this property" because that's a lot of policy for low abuse risk'; :61 `const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)`; :93 `await admin.from('notifications').insert(notif)` with title from `${priorityTag}🔧 Repair reported: ${title}` (:79).

**Fix:** Before inserting, verify the caller has a tenant_profiles row for body.property_id (or company access). Add per-user rate limiting. Truncate/sanitise title; it already slices body but title is unbounded.

### [MEDIUM] xero-cron-reconcile + xero-sync allow service-role impersonation of ANY user via a single shared secret (x-cron-user-id trusted with no per-user binding)
**Where:** `supabase-functions/xero-sync/index.ts:182`  ·  _dimension: gap-critic_

**Problem:** xero-sync accepts an x-cron-secret header equal to CRON_SECRET plus an arbitrary x-cron-user-id header, and then sets `caller = { id: cronUserId }`, fully skipping JWT validation and operating as that user for the rest of the function (token reads/writes, Xero push/pull). The cronUserId is taken directly from the request header with no verification that it corresponds to a row the cron legitimately owns. CRON_SECRET is a single global value reused across xero-cron-reconcile, trial-emails, and (per docs) other crons, and is even templated into pg_cron SQL in the function headers. Anyone who learns CRON_SECRET (broad blast radius — it is the auth for several functions and embedded in DB cron definitions) can drive xero-sync as any user_id of their choosing, exfiltrating or corrupting that user's Xero-linked financial data. This is a design-level trust gap not covered by the OAuth-state / token-plaintext findings already filed.

**Evidence:** xero-sync/index.ts:182-186 `const cronSecret = req.headers.get('x-cron-secret')||''; const cronUserId = req.headers.get('x-cron-user-id')||''; if (CRON_SECRET && cronSecret===CRON_SECRET && cronUserId){ caller = { id: cronUserId } ...}`; xero-cron-reconcile/index.ts header comment 'skips its normal JWT validation and operates with the row's user_id' and sends `'x-cron-user-id': s.user_id` (loop over xero_cron_schedules).

**Fix:** Do not let an external header select the impersonated user. Have xero-cron-reconcile iterate server-side and call an internal path that derives user_id from the xero_cron_schedules row inside the same trusted boundary, or mint a short-lived signed JWT per user. Rotate CRON_SECRET and scope a distinct secret per function. At minimum, validate that cronUserId exists in xero_cron_schedules before trusting it.

## Low (9)

### [LOW] ingest-statement-email accepts all unauthenticated POSTs by default — document injection + AI cost abuse
**Where:** `supabase-functions/ingest-statement-email/index.ts:48`  ·  _dimension: edge-functions_

**Problem:** The Postmark inbound receiver runs with the service role and is deployed with verify_jwt off (line 29). Its only auth is an optional Basic-auth password compared to POSTMARK_INBOUND_TOKEN, and isAuthorised() returns true outright when that env var is unset (the default). If unset, anyone who learns the URL can POST crafted Postmark JSON. Each accepted request with a valid statement_email_token uploads attacker files to the property-documents bucket, inserts property_documents rows owned by the company owner, fires Anthropic Sonnet/Opus extraction (real cost), and injects an owner notification with an attacker-controlled sender name — unauthenticated cost-abuse and spoofing hinging on a secret being optional.

**Evidence:** line 48-49: function isAuthorised(req): boolean { if (!POSTMARK_TOKEN) return true; line 38: POSTMARK_TOKEN = Deno.env.get('POSTMARK_INBOUND_TOKEN')||''. Extraction fires line 162 extractDocumentInline(...) calling Claude line 250-253.

**Fix:** Make the inbound secret mandatory — return 401 when POSTMARK_INBOUND_TOKEN is unset. Prefer Postmark's webhook signature/HMAC over a shared password, compared in constant time. Add a per-company/day cap on processed attachments.

### [LOW] Unvalidated URLs into href and location
**Where:** `src/App.jsx:2000`  ·  _dimension: xss-injection-secrets_

**Problem:** link_url and notification link reach href and window.location.href with no scheme check; self-XSS via javascript URL.

**Evidence:** App.jsx:2000 and NotificationCentre.jsx:77.

**Fix:** Add isSafeUrl guard at the sinks.

### [LOW] CSP allows unsafe-inline and unsafe-eval
**Where:** `vercel.json:9`  ·  _dimension: xss-injection-secrets_

**Problem:** script-src unsafe-inline and unsafe-eval defeat CSP; pdf.js sets a workerSrc so eval not needed.

**Evidence:** vercel.json script-src.

**Fix:** Hash inline scripts and disable pdf.js eval.

### [LOW] TrueLayer stores bank OAuth access + refresh tokens in plaintext (no encryption path)
**Where:** `supabase-functions/bank-truelayer/index.ts:233`  ·  _dimension: features-integrations_

**Problem:** Xero, HMRC and Plaid all run tokens through encryptToken and null out the plaintext column when OWNPROPERLY_TOKEN_KEY is set. bank-truelayer does not import the encryption module at all: finalize() writes the raw access_token and refresh_token into bank_connections.partner_data, and ensureFreshToken/refreshToken read and re-persist them in cleartext. These are live UK Open Banking credentials (up to 90-day refresh tokens) sitting in the DB in plaintext, contradicting the at-rest-encryption effort the rest of the codebase implements.

**Evidence:** const partnerData = {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expires_at: ...,
  scope: tokens.scope,
}
await admin.from('bank_connections').update({ ... partner_data: partnerData ... })
// ensureFreshToken: if (pd.access_token && expiresAt - now > 120_000) return pd.access_token  (no decrypt)

**Fix:** Mirror the Plaid pattern: encrypt access_token/refresh_token via the shared encryption.ts (store under *_enc keys, leave plaintext null when key present) and decrypt in ensureFreshToken. Migrate existing plaintext partner_data on next refresh.

### [LOW] mtd-submit mis-files FHL and foreign property (wrong endpoint/payload combination)
**Where:** `supabase-functions/mtd-submit/index.ts:206`  ·  _dimension: features-integrations_

**Problem:** businessType is derived as 'foreign' for foreign-property and 'uk' for both uk-property and fhl-property, and the URL is built as /individuals/business/property/{businessType}/{nino}/{businessId}/period/{taxYear}. But the request body is ALWAYS the UK shape ({ ukProperty: { income, expenses } }). For a foreign-property business this posts a ukProperty payload to the foreign endpoint, which HMRC will reject; for an FHL business it collapses to the standard UK property endpoint, mis-filing FHL figures. Only plain UK-property landlords submit correctly.

**Evidence:** const businessType = settings.property_business_type === 'foreign-property' ? 'foreign'
                   : settings.property_business_type === 'fhl-property' ? 'uk' : 'uk'
const url = `${HMRC_BASE_URL}/individuals/business/property/${businessType}/.../period/${sub.tax_year}`
...
const payload = { fromDate, toDate, ukProperty: { income: {...}, expenses: summary.expenses || {} } }

**Fix:** Build the payload key to match the business type (ukProperty / ukFhlProperty / foreignFhlEea+foreignProperty) and use the correct HMRC endpoint path for each, per the Property Business API version you target. Until foreign/FHL paths are correct, block submission for those business types with a clear message rather than sending an invalid body.

### [LOW] Hashed immutable JS/CSS assets served with Cache-Control: max-age=0 — every revisit revalidates ~1.2 MB of bundles
**Where:** `vercel.json:3`  ·  _dimension: performance_

**Problem:** vercel.json sets security headers on `/(.*)` but no Cache-Control rule for /assets/. Verified live: `curl -sI https://ownproperly.com/assets/index-UMGlO33O.js` returns `cache-control: public, max-age=0, must-revalidate` on a content-hashed, immutable 836 KB file. Browsers must make a conditional request (304 round trip) for every chunk on every visit. The service worker's cache-first asset handler (public/sw.js:53-66) masks this for users where the SW is installed and controlling, but the first revisit before SW activation, private-browsing sessions, and any SW-unsupported context pay revalidation RTTs for index + react-vendor + supabase-vendor + the lazy page chunk on every navigation-triggered load.

**Evidence:** Live response for /assets/index-UMGlO33O.js: `cache-control: public, max-age=0, must-revalidate` / `content-length: 836224`. vercel.json headers block only contains security headers under `"source": "/(.*)"` — no Cache-Control entry anywhere in the file.

**Fix:** Add a vercel.json headers rule: `{ "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }`. Vite content-hashes all /assets filenames so this is safe; index.html itself keeps must-revalidate.

### [LOW] 13 SECURITY DEFINER functions callable by any signed-in user via PostgREST RPC (advisor WARN x13)
**Where:** `supabase-migrations/2026-05-24_security_advisor_hardening_v2.sql:54`  ·  _dimension: supabase-advisors-live_

**Problem:** Live security advisor lint 'authenticated_security_definer_function_executable' fires 13 times: company_has_billing_access, create_company_for_owner, find_companies_by_name_fuzzy, has_company_access, has_property_access, is_developer, is_platform_admin, list_auth_users, redeem_company_invite, user_has_company_access, user_is_admin, user_is_company_admin (and user_is_admin no-arg) are all executable by the `authenticated` role as SECURITY DEFINER via /rest/v1/rpc/<name>. The repo's 2026-05-24 hardening migrations deliberately revoked anon but re-granted authenticated, so this is partly intentional — however functions like list_auth_users (enumerates auth users, guarded only by an internal is_platform_admin() check) and the boolean access-probe helpers (has_company_access, has_property_access) let any signed-in user probe arbitrary UUIDs for existence/membership, an enumeration oracle in a multi-tenant SaaS.

**Evidence:** Advisor detail (one of 13): "Function `public.list_auth_users()` can be executed by the `authenticated` role as a `SECURITY DEFINER` function via `/rest/v1/rpc/list_auth_users`. Revoke `EXECUTE` or switch it to `SECURITY INVOKER` if that is not intentional." Repo migration 2026-05-24_security_advisor_hardening_v2.sql:54-55 shows the current grant: "REVOKE EXECUTE ON FUNCTION public.list_auth_users() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.list_auth_users() TO authenticated;"

**Fix:** Advisor remediation: Revoke EXECUTE, switch the function to SECURITY INVOKER, or move it out of the exposed API schema if signed-in users should not call it (https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Concretely: move RLS-helper predicates (has_company_access, has_property_access, user_is_admin, etc.) to a non-exposed schema (e.g. private) so RLS policies can still use them but they disappear from /rest/v1/rpc; revoke authenticated EXECUTE on list_auth_users and call it only from an edge function with the service role, keeping the is_platform_admin() check as defence in depth.

### [LOW] pg_net extension installed in public schema (advisor WARN)
**Where:** `supabase-migrations/2026-05-24_security_advisor_hardening.sql:31`  ·  _dimension: supabase-advisors-live_

**Problem:** Live security advisor lint 'extension_in_public': the pg_net extension lives in the public schema, which widens the attack surface (its functions are exposed in the default API schema and can collide with user objects). The repo explicitly deferred this in the 2026-05-24 hardening migration with the comment that moving it can break cron/webhook plumbing, so this is a known, accepted-risk item that the live advisor still flags.

**Evidence:** Advisor detail: "Extension `pg_net` is installed in the public schema. Move it to another schema." Repo acknowledgement at supabase-migrations/2026-05-24_security_advisor_hardening.sql:31-32: "pg_net in public schema — Supabase places it there by default and moving it can break cron/webhook plumbing. Leave alone."

**Fix:** Advisor remediation: move the extension to another schema (https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). Supabase now supports `ALTER EXTENSION pg_net SET SCHEMA extensions;` on recent versions — schedule it with a check of pg_cron jobs and any net.http_post callers immediately after, or document the acceptance formally so the advisor item stops being re-triaged.

### [LOW] Statement-email inbox token is only 64 bits, reusable, and has no sender allow-list or rate limit — predictable document/AI-cost injection per company
**Where:** `supabase-migrations/2026-05-24_company_statement_email_token.sql:18`  ·  _dimension: gap-critic_

**Problem:** Each company's inbound-email routing relies on a 16-hex-char (8-byte/64-bit) token embedded in a publicly-shared email address (<token>@inbox.ownproperly.com). The migration comment explicitly chooses no sender whitelist ('would be too much setup friction'). Anyone who learns or forwards that address (it travels through agents' mailboxes, auto-forward rules, mail logs) can post statements into that company indefinitely — there is no rotation, no per-sender binding, and ingest-statement-email (already flagged for accepting unauthenticated POSTs) will OCR every attachment, injecting documents and burning Claude tokens against the company. The 64-bit space is not brute-forceable over SMTP, but the real exposure is address leakage with no revocation path. This is the email-token attack surface the prompt flagged; the existing audit only covered the HTTP side of ingest-statement-email and the lead-capture rate limit, not this token's lifecycle.

**Evidence:** migration comment :8-11 'The token acts as a shared secret — anyone with the address can post to that company. We don't whitelist sender emails'; :22 `SET statement_email_token = encode(gen_random_bytes(8),'hex')` (8 bytes = 64 bits); no UPDATE/rotation endpoint exists in repo.

**Fix:** Increase entropy to >=128 bits, add a per-company sender allow-list (or DKIM/From verification), provide a rotate-token action in settings, and rate-limit ingestion per token. Treat ingested attachments as untrusted (already partly handled) and cap AI spend per company per day.

## Additional low-severity / polish (25)

- **redeem_company_invite missing pg_temp in search_path and no companies.deleted_at check** — `supabase-migrations/2026-04-26_company_invites.sql:162` (rls-database): Two small defence-in-depth gaps confirmed against the live DB. (1) Every other SECURITY DEFINER function has `search_path=public, pg_temp`, but redeem_company_invite is set to `search_path=public` only (pg_proc.proconfig = ['search_path=public']), omitting the pg_temp hardening the rest of the codebase standardised on. (2) The function looks up the invite and grants user_company_access without checking that the target company is not soft-deleted (companies.deleted_at IS NULL), so a user can be joined to a tombstoned company that is pending purge — OVERNIGHT_AUDIT.md finding #18, still unaddressed.
- **Audit trigger silently swallows all logging errors** — `supabase-migrations/audit-and-soft-delete.sql:208` (rls-database): audit_trigger_fn wraps the audit_log INSERT in EXCEPTION WHEN OTHERS THEN NULL. If audit_log ever becomes unwritable (constraint change, disk, RLS regression, type mismatch on entity_id cast), every INSERT/UPDATE/DELETE across the platform silently stops being logged with no signal anywhere. For a product that markets a tamper-evident audit trail and recoverable Trash, a silent failure of the audit subsystem is a compliance/forensics gap. OVERNIGHT_AUDIT.md finding #8; still present verbatim in the committed migration.
- **stripe-webhook lacks a timestamp tolerance (replay) and uses a non-constant-time signature compare** — `supabase-functions/stripe-webhook/index.ts:268` (edge-functions): verifyStripeSignature computes the HMAC correctly but never checks the t (timestamp) component against a freshness window, so a previously-valid signed payload stays acceptable indefinitely (replay). The compare expected !== signature is non-constant-time (timing side-channel; negligible over a network). Impact is bounded since handlers are largely idempotent status upserts, but the canonical Stripe verification includes the tolerance check this omits.
- **notify-landlord lets any authenticated user inject notifications to any property owner** — `supabase-functions/notify-landlord/index.ts:42` (edge-functions): The function authenticates that the caller is some logged-in user but deliberately does not verify the caller is a tenant of (or related to) the supplied property_id. Any authenticated account can POST an arbitrary property_id plus attacker-controlled title/message and the service role inserts a notification into the owner's notification centre. property_id is a UUID so targeting needs the UUID (bounds impact), but it permits notification-content spoofing against owners whose property IDs leak.
- **OAuth callback and mtd-submit error responses leak internal details** — `supabase-functions/xero-oauth-callback/index.ts:170` (edge-functions): Several functions return raw internal error detail to the caller. xero-oauth-callback renders the DB upsert error's message, code, details and hint into the HTML response (line 170) and returns the raw Xero token-exchange body (line 112). hmrc-oauth-callback reflects the raw HMRC token-exchange body (line 138). mtd-submit returns raw exception messages (line 275). These disclose schema/column names and provider internals. Low severity (no secrets echoed) but unnecessary disclosure on production endpoints.
- **admin_announcements has no RLS in migrations** — `src/lib/api/_monolith.js:2216` (xss-injection-secrets): Read by all users and written by createAnnouncement but no migration defines RLS; loose policy feeds the href in finding 1.
- **Inspection-photo signed URLs last one year** — `src/lib/api/_monolith.js:562` (xss-injection-secrets): One-year signed URLs are long-lived bearer tokens to home-interior photos unlike the rest of the app.
- **Day Tracker 'overdue' detection flags false positives for void/refurb months and new tenancies** — `src/components/DayTrackerPage.jsx:57` (features-core): isPropertyOverdue's fallback marks any rent-earning property overdue if any of the last 3 months lacks a row with status==='paid' for that exact (year, month). A rented property with a legitimate void month (tenant changeover), a refurb month, or one tenanted for under 3 months is permanently flagged ⚠ overdue in the 'Highlight overdue'/'Overdue only' views even when nothing is owed. Cross-month segments make it worse: a segment spanning 25 May→24 Jun carries month=5 (year/month derived from period_start in _monolith.js periodToMonthParts:439-443; 13 such rows exist in production), so a month fully covered by a paid segment that started in the prior month has no month-keyed 'paid' row and trips the check.
- **dealCashflow: mortgage fee computed on 100% LTV when deposit_percent is blank, and exchanged cash deals never deduct the exchange deposit** — `src/lib/dealCashflow.js:95` (features-core): Two bounded arithmetic inconsistencies: (1) depositAmt applies a 25% default when deposit_percent is unset (`num(deal.deposit_percent) || 25`, line 105) but the mortgageFee formula at line 95-96 uses the raw `num(deal.deposit_percent)` → 0, so the fee is computed on the full purchase price instead of the 75% loan — overstating the fee by a third for deals with a fee% but no deposit% entered. (2) For exchanged ('committed') cash purchases, exchangeDeposit is forced to 0 (line 128), so the full purchase price is shown as still-due at completion even though the comment's model ('deposit assumed already paid… 90% of purchase') implies the standard 10% exchange deposit has been paid. Tests in dealCashflow.test.js cover the happy paths but not either of these branches.
- **Stale failing unit test on the default branch: fmt(NaN) intentionally changed to '—' but test still expects '£0'** — `src/lib/__tests__/format.test.js:13` (features-core): npx vitest run currently fails (1 failed / 76 passed): format.test.js asserts fmt(NaN) === '£0' but src/lib/format.js was deliberately changed (commit 9c879be 'math safety') to render NaN as the '—' sentinel — the implementation's own docstring documents the new behaviour. A permanently red suite trains everyone to ignore test failures, defeating the safety net for exactly the kind of money-math regressions found elsewhere in this audit. Separately, the highest-risk money code now has zero coverage: mtdItsa.js (tax quarters, HMRC bucket mapping, income aggregation) and the App.jsx rent aggregation helpers (getStats, monthDominantStatus, RentDots collapsing) have no tests at all.
- **Destructive confirmations split between themed ConfirmContext and raw browser confirm()/prompt()/alert()** — `src/components/IntegrationsPanel.jsx:79` (ux-design): A themed promise-based ConfirmContext exists and is used in 7 components (InsurancePage, TrashPage, DealsPage, BackupsPage, LettingsPipeline, etc.), but 8+ surfaces still use the native browser dialogs, which ignore the app theme, can't be styled, and read like a crash on mobile: IntegrationsPanel.jsx:79 and :401 (Xero disconnect / wipe sync map — high-stakes actions), CompanyInboxPanel.jsx:49, InspectionsPanel.jsx:96, TenantReferenceModal.jsx:87, TwoFactorPanel.jsx:121, MtdItsaPage.jsx:416 (HMRC disconnect), AdminDashboard.jsx:972/974 (window.prompt for rename/extend-trial) and :1073, FeatureComponents.jsx:2438 (window.prompt clipboard fallback), plus alert() in ReportsPage.jsx:388 and :426 for PDF export failures.
- **Locale-less toLocaleString() bypasses the en-GB money formatter in PropertyMap, dashboard rent-roll KPI and reference modal** — `src/components/PropertyMap.jsx:503` (ux-design): src/lib/format.js is the documented single source of truth for money (Intl en-GB, NaN sentinel). Five callsites hand-roll `£${n.toLocaleString()}` with no locale argument, so the thousands/decimal separators follow the BROWSER locale: a user with a de-DE or fr-FR system locale sees "£2.500" / "£2 500" while every other figure on screen is "£2,500". Affected: PropertyMap.jsx:503, :566, :578; TenantReferenceModal.jsx:220; DashboardComponents.jsx:813 (the Monthly Rent Roll KPI on a company PDF-adjacent stat card). These also bypass fmt()'s NaN guard.
- **Fixed-width elements overflow small phone viewports — siblings of the d092081 popover bug** — `src/components/LoginPage.jsx:126` (ux-design): Two confirmed fixed-width elements exceed available width on 360-375px phones: (1) the login logo is hard-coded `width: 280` (LoginPage.jsx:126) inside a panel whose available inner width at 375px is ~263px (24px page padding ×2 + 32px panel padding ×2) — no max-width:100%, and LoginPage renders outside the app shell so App.jsx's `main img { max-width:100% }` mobile rule (App.jsx:634) does not apply; (2) the NotificationCentre dropdown is `width: 360` anchored `right: 0` to the bell (NotificationCentre.jsx:136-137), so on a 360px viewport its left edge lands at/past the screen edge and gets clipped by the global `overflow-x:hidden` (App.jsx:597), making the left side of notifications unreadable on small devices.
- **Mouse-only custom controls: onboarding colour swatches, billing free-tier toggle, tour step dots** — `src/components/OnboardingWizard.jsx:323` (ux-design): Three custom controls are plain divs with onClick — no keyboard access, no role, no accessible name, and selection state conveyed by colour/border only: the brand-colour swatch picker in the first-run wizard (OnboardingWizard.jsx:322-328 — a keyboard user cannot complete this step's colour choice), the admin free-tier toggle on BillingPage (BillingPage.jsx:192-195 — a billing-affecting switch), and the OnboardingTour step dots (OnboardingTour.jsx:221). These are new instances beyond the 25 already-catalogued accessibility findings; also note the global `:focus-visible` rule (previous audit #6) is still absent from the App.jsx stylesheet (lines 596-652) and the mobile drawer close ✕ still lacks an aria-label (App.jsx:1937-1938), even though other audit items (theme contrast, toast live-region, login labels) have since been fixed.
- **"Forgot password?" always reports success and gives no in-flight feedback** — `src/components/LoginPage.jsx:206` (ux-design): The forgot-password handler awaits supabase.auth.resetPasswordForEmail(email) but never inspects the result: on a rate-limit, invalid-email or network failure the user is still told "Password reset email sent — check your inbox." There is also no disabled/loading state, so double-clicks fire multiple requests. (Always-success wording is fine for anti-enumeration of unknown emails, but transport/rate-limit errors should not claim the email was sent.)
- **fetchAll* hot paths filter on user_id but rent_payments, maintenance_jobs, property_expenses and tenancy_details have no user_id index** — `src/lib/api/_monolith.js:2030` (performance): fetchAllRentPayments, fetchAllMaintenanceJobs, fetchAllExpenses, fetchAllTenancies (_monolith.js:2015-2044) and fetchAllComplianceItems all run `.eq('user_id', userId)` — fetchAllComplianceItems fires on every app boot (App.jsx:987) and the rest on every Reports page open. Live pg_indexes shows none of these tables has a user_id index: rent_payments has only pkey + (property_id, period_start) variants; maintenance_jobs only pkey + property_id partial; property_expenses only pkey + (property_id, date); tenancy_details only pkey + unique(property_id). Each query is a sequential scan today (cheap at 3,923 rows max) but degrades linearly as paying users accumulate data, and the RLS policies evaluate per-row on the same scans. refurb_phases/refurb_costs similarly have only their pkey, so the fetchProperties embed join has no FK index either.
- **Regression vs previous audit closeout: rent_payments no longer has the unique (property_id, year, month) index, so ensureFutureRentMonths can double-insert** — `supabase-migrations/2026-05-20_tighten_audit_features_indexes.sql:1` (performance): OVERNIGHT_AUDIT.md's closeout table states '#9-12 — Missing perf indexes | Added 6 partial indexes (rent_payments already had its unique index)'. The live database today has NO unique index on rent_payments(property_id, year, month) — only the pkey and two non-unique period indexes (presumably the unique index was dropped in the per-period rent rework, commit e1c14eb, where multiple segments per month became legal). The code no longer upserts with onConflict so nothing errors, but ensureFutureRentMonths (_monolith.js:939-983) dedupes only against the in-memory `prop.rent_payments` snapshot before inserting 'void' month rows. Two concurrent sessions/tabs booting at once (the user explicitly runs concurrent sessions) both compute the same missing months and both insert, producing duplicate void rows. monthDominantStatus tolerates duplicates visually, but the rows accumulate and inflate the already-unbounded fetchProperties payload.
- **uid() helper calls supabase.auth.getUser() — a network round trip to /auth/v1/user — on every write across 28 call sites** — `src/lib/api/_monolith.js:7` (performance): `const uid = async () => (await supabase.auth.getUser()).data.user.id` — supabase-js getUser() always makes an HTTP request to the auth server to revalidate the JWT, unlike getSession() which reads from local storage/memory. There are 28 `supabase.auth.getUser()` occurrences in _monolith.js (plus bank.js:138,163), so every create/update (createProperty, createExpense, upsertTenancyDetails, matchTransactionToRentPayment, etc.) pays an extra ~100ms auth round trip before the actual write starts. Bounded per action, but it slows every save in the app for no security benefit — RLS revalidates the JWT server-side anyway.
- **Whole app re-renders on every TOKEN_REFRESHED event (every tab refocus) because AuthContext publishes a new session object unconditionally** — `src/lib/AuthContext.jsx:42` (performance): onAuthStateChange calls setSession(s) for every event including TOKEN_REFRESHED, which Supabase fires on tab focus. Each event produces a new session object reference, so the context value changes and App.jsx (the sole useAuth consumer, at App.jsx:424, a 4,091-line component owning the entire tree) re-renders wholesale. The team already discovered the symptom — the loadData effect was deliberately keyed on user?.id with an explanatory comment at App.jsx:1054-1060 — but only the refetch was fixed, not the render. On a large portfolio (151 properties live) every tab refocus burns a full reconciliation of the dashboard tree, including unmemoized subtrees like RentTrackerOverview which recomputes flatMap/getStats over all rent_payments per render (App.jsx:3668, 3707).
- **Company settings loaded with one query per company instead of a single .in() query** — `src/App.jsx:1034` (performance): At the end of the already-serial boot waterfall, loadData fires `visibleCos.map(c => api.fetchCompanySettings(c.id))` — N parallel single-row queries (fetchCompanySettings, _monolith.js:750-754, is `.eq('company_id', companyId).single()`). For a user with 5-10 companies that is 5-10 simultaneous requests where one `.in('company_id', ids)` would do. Bounded impact (parallel, small N) but it is on the critical boot path and trivially collapsible.
- **RLS enabled but no policies on marketing_leads (advisor INFO)** — `supabase-migrations/` (supabase-advisors-live): Live security advisor lint 'rls_enabled_no_policy': public.marketing_leads has RLS enabled with zero policies. Effect is deny-all for anon/authenticated API roles (only service-role access works). If that is intentional (server-only table written by edge functions), it is safe but should be documented; if the app ever needs client reads it will silently return empty result sets rather than erroring.
- **RLS enabled but no policies on trial_email_log (advisor INFO)** — `supabase-migrations/` (supabase-advisors-live): Live security advisor lint 'rls_enabled_no_policy': public.trial_email_log has RLS enabled with zero policies, i.e. deny-all for client roles, service-role only. Same pattern as marketing_leads — safe if intentional for an edge-function-written log table, but undocumented.
- **55 foreign keys without covering indexes (advisor INFO x55)** — `supabase-migrations/` (supabase-advisors-live): Live performance advisor lint 'unindexed_foreign_keys' fires 55 times across the schema, including hot paths: bank_transactions.matched_rent_payment_id, rent_payments.user_id, rent_history.property_id/user_id, deals.company_id/user_id, properties.deleted_by, property_documents.property_id/user_id, tenancy_details.user_id, subscriptions.owner_id, companies.owner_id/user_id, plus deal_*, refurb_*, xero_*, legal_notices, deposit_protection, right_to_rent, referrals, invitations, contractors, tenant_messages, tenant_profiles, address_book, admin_notes, admin_announcements, marketing_leads, company_settings, compliance_items, lettings_progressions, maintenance_jobs, portfolio_insights, property_expenses, property_notes. Unindexed FKs slow joins and make parent-row deletes/updates do sequential scans on children. Note the OVERNIGHT_AUDIT closeout added 6 partial indexes (#9-12) but those targeted different columns; these 55 remain live.
- **29 indexes never used by the query planner (advisor INFO x29)** — `supabase-migrations/` (supabase-advisors-live): Live performance advisor lint 'unused_index' fires 29 times. Notably, several were added in the 2026-05-20 audit-closeout migrations and have never been used since: idx_compliance_items_property_active, idx_compliance_items_expiry_active, idx_maintenance_jobs_property_active, idx_prop_docs_deleted_at, idx_company_documents_deleted_at — suggesting the queries they were meant to serve either don't run with matching predicates or the planner prefers other paths. Others flagged: idx_prop_docs_ext_status, idx_compliance_document, idx_properties_archived, idx_companies_deletion_batch, idx_deals_completion, idx_insurance_policies_previous, tenant_references_* (2), bank_connections_user_idx, bank_accounts_* (2), bank_transactions_* (2), portfolio_insights_user_company_generated_idx, property_inspections_* (2), properties_mortgage_product_end_idx, subscriptions_tier_idx, mtd_submissions_deadline_idx, xero_sync_log_company_idx, trial_email_log_user_idx, marketing_leads_* (3). Each unused index adds write amplification on INSERT/UPDATE and storage cost for zero read benefit.
- **Auth server pinned to absolute 10-connection pool (advisor INFO)** — `supabase-migrations/` (supabase-advisors-live): Live performance advisor lint 'auth_db_connections_absolute': the project's GoTrue/Auth server is configured with an absolute maximum of 10 database connections. If the instance is ever upsized, Auth will not benefit and can become the bottleneck for sign-ins/token refreshes under load on this paying-customer app.

## Refuted findings (investigated, not real)

- **insurance_policy_properties RLS policy has no ownership check (effectively USING true)** (rls-database): The finding's central premise is wrong. The auditor assumed the policy's predicate `EXISTS (SELECT 1 FROM insurance_policies p WHERE p.id = insurance_policy_properties.policy_id)` is "true for essentially every row" because "insurance_policies rows exist for all tenants." But RLS subqueries are NOT exempt from RLS: the inner SELECT on `insurance_policies` runs under the caller's own RLS context, and `insurance_policies` has a correct tenant policy `(is_developer() OR user_id = auth.uid()::text OR has_company_access(company_id))`. So a foreign user's EXISTS subquery only matches policies THEY own/have-access-to. The predicate is effectively transitive ownership scoping, not `USING true`.

I verified this empirically against the live production DB (project hqrhqbkqxzllmzhcofrh). Both tables have RLS enabled (relrowsecurity=true). Confirmed the live policies match the finding's text. Then I impersonated a foreign authenticated user (SET LOCAL role authenticated + request.jwt.claims with a sub belonging to no tenant; the table has 129 links across policies owned by a single real user):
- SELECT: attacker saw 0 of 129 rows (claimed cross-tenant leak refuted).
- DELETE on a real victim policy_id (d8a06715-...): 0 rows deleted (claimed link-stripping refuted).
- INSERT linking the victim's policy_id to an attacker property: hard-failed with "ERROR: 42501: new row violates row-level security policy for table insurance_policy_properties" (claimed link-injection / record corruption refuted).
- Root-cause confirmation: as that foreign user, `SELECT count(*) FROM insurance_policies WHERE id='d8a06715-...'` returned 0 — the attacker cannot see the policy row, so EXISTS is false, blocking all three operations.

The policy is a defensible transitive-ownership anchor. The recommendation to inline `is_developer() OR p.user_id=auth.uid() OR has_company_access(p.company_id)` would be slightly more explicit/defense-in-depth (and would also guard the property side), but it is not required for correctness — the existing policy already enforces tenant isolation. One residual nuance worth noting: the property_id is not independently validated, so a user COULD link one of their own properties or an arbitrary property UUID to one of their OWN policies — but that is same-tenant self-service, not cross-tenant corruption, and has no security impact. The reported high-severity cross-tenant read/write vulnerability does not exist.
- **TrueLayer auto-match uses stale status 'late' instead of canonical 'overdue' — overdue rents never match** (features-integrations): The quoted code exists exactly as cited (bank-truelayer/index.ts:376 uses ['void','late','partial'] vs bank-plaid/index.ts:248 ['void','overdue','partial'], and 2026-05-25_rent_status_overdue_canonical.sql canonicalised unpaid on 'overdue'). However, the finding's load-bearing impact claim — "the function is still deployed and selectable, so any pilot account on it gets a silently broken matcher" — is false on both counts. (1) Live check via Supabase list_edge_functions on the production project (hqrhqbkqxzllmzhcofrh / Ownproperly.com) shows 21 deployed functions including bank-plaid; bank-truelayer is NOT deployed. (2) Nothing in the app can select it: src/lib/api/bank.js:22 hardcodes FUNCTION='bank-plaid' for every bank call; BankConnectionsModal references TrueLayer only in comments; App.jsx:1012 just strips the legacy ?bank_callback=1 param; no cron/webhook/migration invokes bank-truelayer. The file is explicitly kept as "deprecated reference" (src/lib/api/bank.js:5-6). So the stale 'late' filter sits in unreachable dead code — at most a low-severity cleanup (delete or fix the reference file), not a broken production matcher. Separately, a REAL live variant the finding missed: src/components/BankInboxModal.jsx:58 (used by App.jsx) filters manual-match candidates to 'void'/'late'/'partial', omitting 'overdue' — the bank-inbox manual match picker never offers overdue rents. That deserves its own finding against BankInboxModal.jsx rather than crediting this one.
