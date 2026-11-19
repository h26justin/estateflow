# Deals transformation — Phase 0 impact map (Nov 2026)

Response to the "Properly Deals Transformation Brief" (18 Nov 2026). This
records what exists, what was shipped, and what needs schema changes. Schema
changes are production migrations on `hqrhqbkqxzllmzhcofrh` and wait for
approval.

## What exists (retain)

| Brief item | Today | Where |
|---|---|---|
| Lifecycle stages Analysing → Completed, "Fallen through" | Yes; keys stable | `src/lib/dealStages.js` |
| Conveyancing checklist | 8 optional legal steps (`deals.legal_step`) | `dealStages.js` |
| Milestones with dates | `deal_milestones` (completed, completed_date, notes) | `DealsPage.jsx` |
| Unassigned company bucket | Chip filter on `company_id IS NULL` | `DealsPage.jsx` |
| Next action | Single text field `deals.next_action` | `DealsPage.jsx` |
| Cashflow by status group and 30/60/90-day buckets | Yes, drill-down rows | `src/lib/dealCashflow.js` |
| One calculation service for all screens | `computeDealMetrics()` | `src/lib/dealMetrics.js` |
| SDLT calculator with manual override | Yes (rates are hard-coded, not effective-dated) | `src/lib/api/calculators.js` |
| Deal PDF pack | Yes | `src/lib/dealPdf.js` |
| Documents per deal | `deal_documents` | — |
| Refurb projects linked to properties | `refurb_projects`, Refurbs page | `RefurbsPage.jsx` |

## Shipped in this change (code only, no schema)

- **Not assessed instead of misleading figures.** Without a purchase price or
  rent, the following now read "Not assessed" with the reason, everywhere:
  - yields, profit, cash-on-cash, ROCE and payback;
  - the deal score (no "0% / loss / Poor");
  - every screen: list card, editor, compare view, pipeline card and deal PDF.

  Brief §6 and acceptance test 7.

## Needs schema (proposed migrations, all additive and reversible)

1. **`deal_stage_events`**: an immutable log of each stage change (who, when,
   old, new, comment).
2. **`deals.attention_status`**: On track / Awaiting response / Blocked / At risk /
   Overdue / On hold, kept separate from the stage. Plus `next_action_owner` and
   `next_action_due`.
3. **Post-completion stages**: `refurbishment`, `ready_to_let` and `let` added to
   the stage list (new keys only; existing keys unchanged).
4. **`deal_cost_lines`**: itemised costs, each with a category, an
   estimated / quoted / confirmed / paid / actual state, VAT, due date and
   source. Deals keep their flat fields as the fallback for existing records.
5. **`deals.parent_deal_id`**: group purchases (e.g. one transaction for four
   units). The parent carries the cash commitment once.
6. **`company_funding_entries`**: a company-level ledger of available cash and
   reservations by date, so funding gaps never double-count the same cash.
7. **`deals.refurb_project_id`**: links a deal to its refurb project, never
   creating a duplicate.
8. **`extracted_fields`**: an approval queue for document extraction (value,
   page, quoted text, confidence, approver).

## Build order after approval

1. Migrations 1 to 3, the progress tracker and the attention chips.
2. Company dashboard cards with drill-down.
3. Cost lines, the funding ledger and company cash requirement:
   - balance due = statement total − on account;
   - funding gap = due outflows − eligible cash − confirmed funding.
4. Exports: property, company and all-deals in PDF, XLSX, CSV and JSON, from
   one calculation snapshot.
5. Assisted extraction, with human approval for every field.

## Open decisions

- Should SDLT rates be effective-dated (the brief) or remain a single maintained
  table with a manual override?
- Who may approve extracted values and change the company a deal belongs to
  (role matrix)?
- Should exports include contacts and solicitor details by default (the brief
  says no)?
- XLSX output needs a library. SheetJS is the usual choice; it adds about 400 KB,
  lazy-loaded.
