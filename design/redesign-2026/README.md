# Handoff: OwnProperly redesign

## Overview
A full visual redesign of **OwnProperly** — UK landlord property-portfolio software (rent, compliance, tax, tenants, deals). This package contains the new brand, the redesigned core screens, pre-launch states, mobile layouts, the branded PDF report, and a complete page-by-page rollout audit.

The product name stays **OwnProperly**; the brand voice leans on the word "Properly".

## About the design files
The files in this bundle are **design references created in HTML** (a lightweight component format — each `*.dc.html` opens directly in a browser; `support.js` is its tiny runtime). They are prototypes showing intended look and behaviour — **not production code to copy verbatim**.

The task is to **recreate these designs in the existing OwnProperly codebase** (Vite + React, see the live app) using its established patterns, component structure and state. Lift the exact tokens, typography, copy and layout documented below; re-implement the markup in React. Do **not** ship the `.dc.html` files or `support.js`.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, copy and interactions. Recreate pixel-faithfully using the codebase's existing component library. Hex values, fonts and measurements below are authoritative.

---

## Design tokens

### Colour — light (default)
| Token | Hex | Use |
|---|---|---|
| paper | `#F4F3EF` | app background |
| surface | `#FFFFFF` | cards, panels, rail |
| card | `#FAF9F6` | inset tiles, table header, active nav |
| border | `#E4E1D9` | all hairlines / dividers |
| ink | `#1C2830` | primary text, primary buttons |
| muted | `#5C6670` | secondary text |
| faint | `#8A8E92` | tertiary text, mono labels |
| gold | `#B8902F` | accent, primary CTA, active year |

### Colour — dark
| Token | Hex |
|---|---|
| base | `#0E141A` |
| surface | `#151D25` |
| card | `#1B242D` |
| border | `#28333D` |
| text | `#E8E5DD` |
| muted | `#9AA6B0` |
| faint | `#6E7681` |
| gold | `#CBA64E` |

### Status (always pair colour WITH a text label — never colour alone)
| Status | Light text | Light bg | Dark text |
|---|---|---|---|
| Paid / valid / occupied | `#1F9D63` | `#E8F4EC` | `#34C281` |
| Late / expiring | `#C77E1E` | `#FBF1E2` | `#E2A24A` |
| Missed / expired / arrears | `#C5483B` | `#FAEAE8` | `#E06A5E` |
| Refurb / info | `#2D6FA8` | `#E7F0F7` | `#5B9BD8` |
| Void / N-A | `#9AA0A6` | `#F1F0EC` | `#3A444C` |

### Radius · spacing · elevation
- Radius: `8` (chips/inputs), `10–12` (buttons/tiles), `14–16` (cards), `18` (hero cards), `999px` (pills).
- Spacing: 4-pt scale — `4 · 8 · 12 · 16 · 24 · 32 · 48`.
- Shadow sm: `0 1px 2px rgba(28,40,48,.06)` · md: `0 10px 30px rgba(28,40,48,.10)` (dark: black at .3 / .4).

---

## Typography
- **Schibsted Grotesk** (Google) — UI, headings, body, buttons, table content. Weights 400/500/600/700/800.
- **DM Mono** (Google) — all money, dates, metrics and eyebrow labels (uppercase, letter-spacing ~0.1–0.12em). Weight 400/500.
- Scale: Display 46/700 (-0.03em) · H1 30/700 · H2 26/700 · body 16/400 (line 1.6) · mono label 10–11px uppercase.
- Numbers are **always** DM Mono for tabular alignment.

## Logo & brand voice
- Wordmark: `Own` (weight 500) + `Properly` (weight 700) + a **gold full-stop**. Letter-spacing -0.03em.
- App icon / favicon: the **"P."** monogram (Schibsted 700) — paper on slate `#14202A`, gold dot.
- Logo tagline: **"Property portfolio software"** (DM Mono caps).
- Hero strapline: **"Own your rental portfolio properly."** (gold on the final word).
- Voice: plain, confident, British. Money/dates exact. No hype, no emoji in product UI. Never "EstateFlow".
- All logo files (SVG/PNG/JPEG/PDF + favicon set, light & dark) are in `brand-assets/` with their own README.

---

## App shell (every authenticated screen)
- **Left rail**, 212px, `surface` bg, right border. Collapses to a **68px icon rail** (toggle at the foot); labels fade via opacity, icons remain. Below ~720px it becomes a **bottom tab bar** (4 items: Home / Portfolio / Rent / More) — see `OwnProperly Mobile.dc.html`.
- Rail items: 20px hairline SVG icon + 14px label, 10–11px padding, radius 10; active item = `card` bg + weight 700 + `ink` text.
- Brand block at top: 32px "P." tile + wordmark.
- **Top bar**, 62px: left = breadcrumb (DM Mono, e.g. `Portfolio / Rent`); right = optional bell, light/dark toggle pill, 32px gold avatar.
- Icons: a single **hairline SVG set** (stroke 1.6–1.8, round caps) replaces ALL emoji. Nav, alerts, report categories, etc.

## Screens (see matching `.dc.html` for exact markup)
1. **Dashboard** — greeting + 84/100 health ring; "Action required" row (3 alert cards, coloured left border + icon); 4 KPI tiles (Portfolio value, Rent roll, Collection rate, Net yield); two-column Rent-this-month list + Compliance RAG (Expired/Expiring/Valid counts + cert list).
2. **Portfolio** — responsive card grid (`minmax(300px,1fr)`); each card: gradient header w/ status pill + property initial, name, company, Rent / Yield / compliance dot. Click → **Property detail**: gradient hero, status chips, tab strip (Overview/Rent/Compliance/Tenancy/Documents/Expenses), 4 key-fact tiles, tenancy card + compliance list.
3. **Rent tracker** — per-company sections; each property row = name + status chip, a **12-column month grid**, and received/collected totals. **Month cell** = the key readability fix: 3-letter month name + filled status colour (paid green, late amber, missed red, refurb blue); current month = gold outline; future = hatched dashed. Summary tiles + single-line legend on top. (`Left Nav` variant shows the collapsible rail.)
4. **Compliance** — 3 RAG summary tiles; "Needs attention" list (renew buttons); **certificate matrix**: rows = properties, columns = Gas/EICR/EPC/HMO/Legionella/PAT, each cell a status pill with time-to-expiry.
5. **Deals** — 6-stage pipeline board (Sourcing → Completion) with deal cards; below, a calculator result panel (4 metric tiles, acquisition breakdown, Section 24 tax impact).
6. **Reports** — 16-report catalogue grouped by 5 categories (Tax/Performance/Finance/Compliance/Maintenance) with category-coloured icon cards + filter pills; click → report view (Annual P&L: 4 KPI tiles, net-profit-by-property bars, per-property table with totals + Section 24 note).
7. **Settings** — sub-nav column + panels; Company branding (logo upload, name, report-accent swatches), default reporting period (tax/calendar), alert toggles.
8. **Login** — split: slate brand panel (wordmark, strapline, 3 ticks) + paper form (email, password, primary sign-in, Google, trial link).
9. **Tenant portal** — per-company **branded** (accent pulled from company settings); branded header + tabs, next-payment card, repair/message quick actions, recent payments, documents. Footer "Powered by OwnProperly · {company}.ownproperly.com".
10. **Marketing landing** — sticky nav, centered hero + product-shot mock, trust strip, 3×2 feature grid, 2-tier pricing (Landlord £2 / Investor £5, popular), slate CTA, footer.
11. **PDF report** — A4; company-accent header band with logo + report title + period; KPI strip; per-property P&L table + totals; amber Section 24 note; footer with "Generated by OwnProperly" + company reg + page. This is the visual spec for the existing jsPDF export — match it (logo + company accent colour from settings).

## Interactions & behaviour
- Light/dark toggle flips a `data-theme` attribute on the root; all colours are CSS vars — implement as a theme context (the app already has one).
- Rail collapse: width 212↔68px, **do not CSS-transition `width`/`flex-basis`** (caused a stuck-transition bug); animate opacity of labels only, or snap.
- Catalogue→detail (Reports, Portfolio) and detail→back are simple view-state swaps.
- Rent month grid and compliance matrix on mobile: vertical property cards with a **horizontally-scrollable** month/cert strip.

## States (`OwnProperly States.dc.html`)
- **Empty**: centered icon tile + title + body + primary CTA (Portfolio "Add your first property", Rent "No rent to track yet", Compliance "Nothing to track yet").
- **Loading**: shimmer skeletons (`linear-gradient` sweep, 1.3s) for dashboard tiles/rows and rent table rows.
- **Error**: full "Couldn't load your data" + Retry (partial-failure aware); inline amber "Bank sync paused / Reconnect" banner; 404 card.

## Assets
- `brand-assets/` — every logo format (SVG/PNG/JPEG/PDF + favicon sizes), light & dark, with its own README. Wire `favicon/` into `index.html` / `manifest.json`.
- Icons are inline hairline SVGs (defined in each mock's logic). No icon-font or emoji.
- Property photos: the app's own uploads; mocks use gradient placeholders.

## Files in this bundle
All `*.dc.html` are the design references (open in a browser; `support.js` is their runtime):
`OwnProperly Brand System` · `Dashboard` · `Portfolio` · `Rent Tracker` (+ `Left Nav`) · `Compliance` · `Deals` · `Reports` · `Settings` · `Login` · `Tenant Portal` · `Marketing` · `PDF Report` · `States` · `Mobile` · `Redesign Audit` (the full ~70-surface rollout checklist with status per page).

Start with **Brand System** + **Redesign Audit**, then implement screen by screen.
