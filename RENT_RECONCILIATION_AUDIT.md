# Rent reconciliation audit — Phase 1 (Nov 2026)

Response to the "Master Audit & Implementation Specification, Phase 1 & 2"
brief (18 Nov 2026). Phase 1 is read-only: production was only queried
(SELECT), never written. Figures below were computed by running the
production rent engine (`src/lib/rentEngine.js`, `src/lib/agentReport.js`)
over a read-only snapshot of the live data taken 19 Nov 2026, as at
18 Nov 2026.

## 01. Executive diagnosis

| # | Finding | Type | Severity | Status |
|---|---|---|---|---|
| 1 | Tracker "outstanding" and the agent report "Owed" measure different things: scope (all managed properties vs one agent's), and in-window rent (tracker counts it, report does not). Neither figure is wrong; they were never labelled as different metrics. | Definition | High | Bridged below; report now states its basis |
| 2 | `missedOwed()` (report, weekly email) and `collectionStats().overdue` (tracker) disagreed per period: a period **overridden to Part paid** after its window closed was left out of the report; an **unverified net-of-fees shortfall** (Xero import) was put into it. Net effect: report understated by £552.50. | Logic defect | Medium | **Fixed**: one rule (`periodBreakdown` overdue bucket) |
| 3 | Free-text `properties.tenancy_end` ("Monthly Rolling", "2nd August 2025") rendered as "undefined undefined" in the PDF. | Rendering defect | Low | **Fixed** |
| 4 | About half the amount owed (£30,175 of £60,791) is on 21 let properties with **no tenancy record**: the engine assumes a tenancy from 1 Jan 2026 at the listed rent. This is the brief's "no assumptions" concern. | Data quality | High | Now shown as an estimate in the report; needs tenancy entry (Tiffany) |
| 5 | 93 months this year (£54,143 of rent due) are marked **paid with no amount**. The report counts them as collected; the tracker leaves them out of both sides of the rate. This is most of the gap between the two collection rates. | Data quality + definition | High | Now quantified in the report; backfill needed |
| 6 | Some properties carry overlapping rent periods (agent cycle 6th–5th next to calendar months, both charged). The duplicate detector only catches placeholders with no money on them. | Possible double charge | Medium | Open: needs review per property |

## 04. Reconciliation (as at 18 Nov 2026, live data 19 Nov)

The screenshot (£76,713, 84%) and the PDF (£60,239, 86%) were taken at
different moments; data has changed since (receipts posted). Re-run on one
snapshot, the engine reproduces the PDF exactly (£60,238.50 owed, 114 missed
months, 86.3%) and gives the tracker as £75,788.26 at 84.2%.

**Outstanding bridge**

| Step | £ |
|---|---|
| Tracker, current rent outstanding (all tracked properties, 2026) | 75,788.26 |
| less: properties not managed by Propertunity (other agent; outside the report) | −11,272.26 |
| = Tracker outstanding, report's 128 properties | 64,516.00 |
| less: rent still inside its payment window (tracker includes, report excludes) | −3,725.00 |
| = Tracker overdue, report's properties | 60,791.00 |
| less: rule mismatch (finding 2: +£850 Part-paid overrides, −£297.50 net-of-fees) | −552.50 |
| = Report "Owed" as issued | **60,238.50** |
| Residual unexplained | **0.00** |

After the fix, the report's Owed is £60,791.00 and equals tracker overdue for
the same properties.

**Collection % bridge.** Tracker 84.2% = £402,634 / £478,422. Report 86.3% =
£380,787 / £441,025. The two rates differ by:
- scope (as above);
- in-window rent (tracker counts it as due, report waits for the window to close);
- months paid with no amount (£54,143): the report counts them as collected,
  the tracker excludes them from both sides;
- unverified net-of-fees amounts (£5,364): the tracker excludes them, the report counts them.

A per-property bridge (CSV) was supplied alongside this audit, outside the repo
because it holds property-level detail.

## 05/10. Definitions in force, and open decisions

Current definitions (decided 2 Sep 2026, unchanged by this work):
- Go-live 1 Jan 2026; earlier months are legacy and never arrears.
- Payment window: 5 days after the due date, per tenancy if set.
- Paid with no amount: Green, "needs backfill", excluded from the tracker rate.
- Arrears = overdue current rent + unpaid historic opening balances.

**Decisions needed (Tiffany / Justin). No defaults have been chosen silently:**
1. Should the agent report keep counting paid-with-no-amount months as
   collected (the tracker does not)? Recommendation: match the tracker and show
   the excluded value.
2. Properties with no tenancy record: keep the go-live estimate (now labelled),
   or show "unable to calculate" until a tenancy is entered (the brief's preference)?
3. Allocation policy for new receipts: current rent first, then oldest arrears (brief C4)?
4. Overlapping agent-cycle and calendar-month periods (finding 6): review each
   case, or have the duplicate detector extend to periods that carry money?

## Already in place (retain, do not rebuild)

The brief's Phase 2 model mostly exists already:
- obligations (`rent_payments`) and receipts plus allocations (`rent_receipts`,
  `rent_allocations`), including reversals;
- non-chargeable / void intervals (`non_chargeable_periods`);
- visible, reasoned overrides (`rent_overrides`);
- traffic-light states computed from money (`rentEngine.js`);
- historic arrears kept per tenancy;
- statement import with review (`StatementImporter`, `StatementAuditPage`);
- "how calculated" explanations (`CalcExplain.jsx`).

Remaining gaps against the brief:
- frozen month-end report snapshots and restatements;
- versioned arrears notes, with a month-end review queue;
- the agent fee / commission contract per unit;
- aged arrears buckets (0–30 / 31–60 / 61–90 / 90+);
- property address aliases.

## Deployment note

The fixes change `src/lib` and regenerate the `agent-weekly-report` and
`weekly-summary` edge-function bundles. The web app deploys on merge. The two
edge functions need a separate, approved production deploy before the Monday
email reflects the fix.
