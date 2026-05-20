# Overnight Audit Report

Generated overnight via parallel agents. Each section is a focused audit
done by a dedicated agent. Findings are graded:

- 🔴 Critical — needs fixing
- 🟡 Medium — defense-in-depth or polish
- 🟢 Minor — future hardening / nice-to-have

> ## ✅ Closeout status (updated 2026-05-20)
>
> All **DB schema audit findings except storage** have been verified against
> the live database and either applied or confirmed already-fixed:
>
> | Finding | Status |
> |---|---|
> | #1 — 20 tables without RLS | False alarm in 18/20 cases. property_notes was the only real gap → fixed. rent_increases doesn't exist. |
> | #2 — audit_log INSERT forgery | ✅ Fixed (dropped loose policy) |
> | #3 — Hard-delete bypassing soft-delete | ✅ Fixed in 4 real cases; 5 were false alarms |
> | #4 — Missing `deleted_at IS NULL` filters | ✅ Fixed for the 4 soft-delete-aware fetchers |
> | #5 — Storage policy injection on property-documents | ⚠️ DEFERRED — tightly coupled to tenant maintenance flow |
> | #7 — SECURITY DEFINER missing `search_path` | ✅ Fixed (13 functions; verified 15/15 now configured) |
> | #9-12 — Missing perf indexes | ✅ Added 6 partial indexes (rent_payments already had its unique index) |
> | #25 — feature_flags world-readable | ✅ Restricted to authenticated |
> | Owner-email PII leak from fuzzy search | ✅ Fixed (return signature changed + UI removed) |
>
> See `git log` for the actual SQL migrations applied
> (`2026-05-20_*.sql` files in `supabase-migrations/`).
>
> What's still open:
> - 🟡 Storage policy fix (#5/#26) — needs careful work, see file 2026-05-20 / Task #26
> - All 25 accessibility findings — next session candidate
> - Performance + Dead-code audits still need re-running with tighter prompts

## Status of each audit

| Audit | Status | Findings |
|---|---|---|
| Accessibility | ✅ Complete | 25 |
| **Database schema + RLS** | ✅ Complete | **28 (several CRITICAL)** |
| Security (deep) | ⚠️ Partial | ~1 — agent timed out, partial finding below |
| Performance | ⚠️ Partial | agent timed out before producing report |
| Dead code + tech debt | ⚠️ Partial | agent timed out before producing report |

---

# Database schema + RLS audit

**Run against:** all 17 `.sql` migrations in `supabase-migrations/` and the application's data layer in `src/lib/api.js` (3,596 LOC, 41 tables referenced).

## 🔴 Critical

### 1. **20 application tables have NO RLS enabled in migrations**

Referenced in `src/lib/api.js` but never `ENABLE ROW LEVEL SECURITY`'d in any migration file:

```
address_book          admin_announcements   admin_notes
company_documents     deal_contacts         deal_documents
deal_milestones       insurance_policies    insurance_policy_properties
invitations           lettings_progressions property_notes
referrals             refurb_costs          refurb_phases
rent_history          rent_increases        subscriptions
tenant_messages       tenant_profiles
```

**Impact:** Without RLS, any authenticated user can read/write all rows in these tables across all companies (PostgREST exposes them via the `authenticated` role). Several carry sensitive data — `insurance_policies`, `deal_documents`, `tenant_messages`, `subscriptions`.

**Suggested migration per table** (parameterise the scope column):

```sql
ALTER TABLE property_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "property_notes_all" ON property_notes FOR ALL
  USING (is_developer() OR user_id = auth.uid() OR has_property_access(property_id))
  WITH CHECK (is_developer() OR user_id = auth.uid() OR has_property_access(property_id));
```

This is the single highest-value remediation in the entire audit.

### 2. **`audit_log` insert policy allows forgery via `user_id IS NULL`**

`audit-and-soft-delete.sql:94-96`:
```sql
CREATE POLICY "Users can insert own audit entries" ON audit_log
FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
```

Any authenticated user can insert audit entries with `user_id=NULL` claiming any company. Fix:
```sql
DROP POLICY "Users can insert own audit entries" ON audit_log;
CREATE POLICY "Users can insert own audit entries" ON audit_log
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND (company_id IS NULL OR has_company_access(company_id))
);
```

### 3. **Hard-delete on tables that should soft-delete**

`src/lib/api.js` hard-deletes from soft-delete-aware tables, silently bypassing the documented 30-day Trash policy:

- `deleteCompliance` — `compliance_items` has `deleted_at`
- `deleteMaintenance` — `maintenance_jobs` has `deleted_at`
- `deleteExpense` — `property_expenses` has `deleted_at`
- `deleteLegalNotice`, `deleteDepositProtection`, `deleteRightToRent`
- `deleteAddressBookEntry`, `deleteAdminNote`
- `deleteCompanyDocument` — hard delete + storage removal

`purgeExpiredTrash` expects these to live soft-deleted for 30 days, but the app never sets `deleted_at`. **Silent data loss on a feature users have been told is recoverable.** Switch each to `softDeleteEntity('table', id, userId)`.

### 4. **No `deleted_at IS NULL` filter in many list fetchers**

Once #3 is fixed, deleted rows will resurface in list views. Add `.is('deleted_at', null)` to:
- `fetchCompliance`, `fetchAllCompliance`
- `fetchMaintenance`, `fetchExpenses`
- `fetchCompanyDocuments`
- `fetchDepositProtection`, `fetchRightToRent`, `fetchLegalNotices`, `fetchNotices`

**Better:** enforce in RLS via the SELECT policy so defence is at the database layer:
```sql
CREATE POLICY "compliance_items_select" ON compliance_items FOR SELECT
  USING ((is_developer() OR user_id = auth.uid() OR has_property_access(property_id))
         AND deleted_at IS NULL);
```

### 5. **Storage policy injection vector on `property-documents` bucket**

The legacy fallback in the bucket's USING clause checks if a user owns ANY row in `property_documents`/`company_documents`/`deal_documents` with a matching `file_path`. A malicious user can insert a `property_documents` row with `user_id = auth.uid()` and `file_path = "victim-uid/.../private.pdf"` to gain read access to someone else's file.

**Fix:** Tighten policy to require the storage path's first segment match `auth.uid()`. Also run a one-time cleanup migration to move any files whose path doesn't start with the user-id folder.

## 🟡 Medium

### 6. Storage migration leaves legacy logo files unmigrated
`2026-04-26_storage_privatization_phase1.sql:108-113` — existing public logo URLs stop working after Phase 3 with no automated migration. Users must manually re-upload.

### 7. SECURITY DEFINER functions miss `SET search_path`
`is_developer()`, `has_company_access()`, `has_property_access()`, `list_auth_users()`, `audit_trigger_fn()`, `purge_soft_deleted_older_than_30_days()`, `prune_old_backups()` — all should have:
```sql
ALTER FUNCTION is_developer() SET search_path = public, pg_temp;
```
Supabase advisors will flag this.

### 8. Audit trigger swallows ALL errors silently
`audit-and-soft-delete.sql:208-211`: `EXCEPTION WHEN OTHERS THEN NULL`. If audit_log becomes unwritable, every change is silently un-logged. Use `RAISE WARNING` so it surfaces in `postgres.logs`.

### 9-12. Missing indexes (perf)
- `properties(company_id)` — high-traffic join, unindexed
- `properties(user_id)` and `properties(sort_order)` — `purgeExpiredTrash` filters, dashboard loads
- `rent_payments(property_id, year, month)` — there's an `upsert(..., { onConflict })` that REQUIRES this unique index; **may fail at runtime if it doesn't exist**
- `compliance_items(property_id)` — unindexed

### 14. Unverified FK cascade behaviour on `properties.company_id`
Migration doesn't define the FK behaviour. If `ON DELETE CASCADE` is set, `purgeExpiredTrash` could wipe properties unexpectedly. Verify via `\d properties` and standardise to `NO ACTION`/`RESTRICT`.

### 15. `bank_accounts.company_id ON DELETE SET NULL` may orphan transactions
When a company is hard-deleted via `purgeExpiredTrash`, bank connections lose their company link; matched transactions lose context. Consider blocking purge while matches exist.

### 18. `redeem_company_invite` doesn't check `companies.deleted_at`
A user can redeem an invite for a soft-deleted company → joined to a tombstoned org. Add `AND EXISTS (SELECT 1 FROM companies WHERE id = v_invite.company_id AND deleted_at IS NULL)` to the function.

### 20. Financial columns lack defaults / CHECK constraints
`properties.arrears`, `purchase_price`, `rent_pcm`, `sale_price` likely nullable. `arrears + 1` yields NULL if so. Defensive:
```sql
ALTER TABLE properties ALTER COLUMN arrears SET DEFAULT 0;
UPDATE properties SET arrears = 0 WHERE arrears IS NULL;
ALTER TABLE properties ALTER COLUMN arrears SET NOT NULL;
ALTER TABLE properties ADD CONSTRAINT properties_arrears_nonneg CHECK (arrears >= 0);
```

### 22. `purgeExpiredTrash` may silently fail
Hard-deletes `properties` etc. via `purge_old_*` functions. If child tables (`compliance_items`, `rent_payments`, `property_documents`) have FKs `ON DELETE NO ACTION` (default), the delete fails and the row stays "deleted" forever. Either purge children first or set `ON DELETE CASCADE` on child tables referencing `properties`.

### 25. `feature_flags` table is world-readable
```sql
CREATE POLICY "ff_read" ON feature_flags FOR SELECT USING (true);
```
Anonymous users can list every flag including unreleased ones (`tenant_portal_v2` etc) — leaks product roadmap. Restrict to authenticated.

## Prioritised remediation order

1. **Finding #1** — enable RLS on the 20 unlocked tables. Highest impact, simplest migration.
2. **Findings #3 + #4** — fix hard-deletes that bypass Trash; add `deleted_at IS NULL` filters.
3. **Finding #5** — close the storage-policy injection vector.
4. **Finding #2** — tighten `audit_log` insert policy.
5. **Finding #7** — add `SET search_path` to all SECURITY DEFINER functions.
6. **Findings #9–12, #22** — performance + cascade safety.

---

# Security audit (partial)

Agent timed out before producing a full report. Key item that did come through:

### `find_companies_by_name_fuzzy` RPC exposes owner email PII

The RPC in `2026-04-26_company_invites.sql:237-274` returns `id, name, owner_email` and is granted to `authenticated`. **Any signed-in user can fish for owner emails by guessing company names.** PII leak.

**Fix:** Remove `owner_email` from the return shape, or only return it when the caller already has access to the company. The fuzzy match is used in the onboarding "did you mean to join an existing company?" prompt — for that UX, surfacing the company name alone plus a generic "ask the owner for an invite" message is sufficient.

---

# Accessibility audit (complete — 25 findings)

## 🔴 Critical

1. **Modals lack `role="dialog"` / `aria-modal`** — all 8 modals in `src/components/modals/` plus NoticeGenerator, TenantReferenceModal, BulkAddPropertyModal. Screen readers announce nothing on open.

2. **No Escape-to-close on any modal** in `/components/modals/`. `safeOverlayClose` only handles overlay click. Keyboard users get trapped.

3. **Focus never returned to trigger element when modals close** — lands at `<body>` after close. Includes NotificationCentre bell and App.jsx's New / More menus.

4. **No focus trap inside modals** — Tab escapes into the page underneath. CommandPalette already blocks Tab; every other dialog should follow.

5. **Labels not programmatically associated with inputs** — ~50+ `<label>Name</label><input/>` siblings without `htmlFor`/`id`. PropertyModal (12 instances), CompanyModal, AccessModal, DeleteCompanyModal, DeleteConfirmModal, SellPropertyModal, NoticeGenerator, TenantReferenceModal, LoginPage.

6. **No global `:focus-visible` indicator on buttons/links** — `src/App.jsx:513-569`. Inputs get a border-color change; buttons and links have nothing.

7. **Color contrast: `T.faint` and `T.muted` fail WCAG AA in dark mode** — `src/lib/ThemeContext.jsx:4-14`.
   - DARK muted `#6B7191` on `#0B0D14` ≈ 4.0:1 (fails 4.5:1 AA)
   - DARK faint `#3A3F58` on `#0B0D14` ≈ 1.7:1 (fails badly)
   - LIGHT faint `#B0ADAB` on `#F4F3EF` ≈ 2.1:1 (fails)
   - Suggested: dark muted → `#8E94B5` (5.3:1), faint → `#6D7396` (4.0:1, large text only).

8. **Disabled buttons rely on color alone** for state — `NoticeGenerator.jsx:284,420`, `DeleteCompanyModal.jsx:100-105`. `background: T.border` + `color: T.muted` ~2:1.

## 🟡 Medium

9. NotificationCentre bell missing `aria-expanded` / `aria-haspopup`.
10. Notification rows are non-keyboard-accessible click targets — `<div onClick>` with no role/tabIndex.
11. CommandPalette swallows screen-reader announcements on result change — no `role="listbox"`/`role="option"`/`aria-activedescendant`.
12. "+ New" menu missing menu semantics — `App.jsx:1484-1519`. The "⋯ More" menu was fixed earlier; mirror that pattern.
13. Mobile drawer close-X has no accessible name — `App.jsx:1587-1588`.
14. NoticeGenerator checklist Yes/N/A pair is not a proper radiogroup.
15. S8 grounds checklist needs `role="group" aria-labelledby`.
16. NotificationCentre panel doesn't focus when opened.
17. CustomizeDashModal close-X has no accessible name.
18. Drag-and-drop reordering has no keyboard equivalent announced.
19. Tenant reference Delete uses `window.confirm` — inconsistent with `ConfirmContext`.

## 🟢 Minor

20. Verify toast root has `role="status" aria-live="polite"` — `src/lib/toast.js`.
21. Icon emojis decorative but sometimes not marked `aria-hidden`.
22. `<kbd>` shortcuts in CommandPalette footer — glyph-only, no SR-friendly text.
23. SkipLink visual style is inline-event-driven instead of `:focus`.
24. Mobile drawer doesn't trap focus or restore it.
25. Section/widget reset buttons reuse `↻` glyph without `aria-hidden` wrapper.

## Suggested implementation order

The agent grouped findings by shared cause — the bulk can be fixed by adding three shared utilities:

1. **Shared `<Modal>` component** with `role="dialog"`, focus save/restore, focus trap, Esc handler. Kills #1–#4 across 11 files in one pass.
2. **`<Field>` helper** that auto-pairs `label htmlFor` / `input id` — kills #5.
3. **`:focus-visible` rule + ThemeContext contrast bump** — kills #6, #7.

---

# Performance + Dead Code

Both agents timed out before producing a full report (the prompts were too open-ended; they fell into deep file reading). Re-run them in a fresh session with tighter, file-specific prompts.

---

# What I committed overnight (Task #10 — api.js split)

Made progress on the deferred api.js split. Extracted 5 self-contained domains out of the monolith into their own files:

- `src/lib/api/notifications.js`
- `src/lib/api/insights.js`
- `src/lib/api/references.js`
- `src/lib/api/bank.js`
- `src/lib/api/insurance.js`

`src/lib/api/index.js` re-exports all of them, so `import * as api from './lib/api'` keeps working unchanged at every callsite.

Original `src/lib/api.js` is now `src/lib/api/_monolith.js` and holds the un-extracted remainder (~3,200 lines, down from 3,400). The natural next domains to extract are tenant_portal, deals, reports, address book — all reasonably self-contained.

77 tests still pass. Build clean.
