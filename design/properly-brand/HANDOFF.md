# Handoff: Properly — brand identity rollout (direction 3D)

## Overview
New logo identity for the property portfolio product currently branded **OwnProperly** (ownproperly.com).

Two decisions are bundled here:
1. **A new logo** — an endorsed lockup: navy rounded-square tile containing a single accent-blue "P", set beside an Archivo wordmark with a hairline rule and a monospace endorsement line.
2. **A naming shift (optional, needs sign-off)** — customer-facing name becomes **Properly**, with **ownproperly.com** carried as the endorsement line so the domain stays visible. If the client has NOT signed this off, implement the same lockup with the wordmark set as "OwnProperly" (see "If the name stays OwnProperly" below). Do not ship the name change without explicit confirmation.

Scope of implementation: replace the logo everywhere it appears — marketing site header/footer, app sidebar, favicon and app icons, transactional email headers, PDF/statement headers, social avatars, OG image.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended appearance, not production code to copy directly. The task is to **recreate them in the target codebase's existing environment** using its established patterns, component library and token system. Do not lift the inline styles verbatim; map the values below onto whatever the codebase already uses (Tailwind config, CSS custom properties, styled-components theme, etc.).

Both reference files use Google Fonts loaded via <link> and lay out the mark with plain divs — no SVG. **In production the logo should become a real SVG** (see "Assets" below); the HTML build is a spec, not the deliverable asset.

## Fidelity
**High-fidelity.** Colors, type, sizes, radii and spacing below are final and should be matched precisely. The surrounding page furniture in the reference files (guide cards, mock sidebar, mock statement) is scaffolding for presentation only — not designs to implement.

## The mark

### Construction — icon tile
- Shape: square, `border-radius` = **23% of tile size** (40px tile → 10px; 32 → 8; 16 → 4; 128 → 30).
- Fill: **Ink navy #14202A**.
- Glyph: capital **P**, Archivo **700**, `letter-spacing: -0.04em`, color **Signal blue oklch(0.72 0.12 250)**.
- Glyph size: **62.5% of tile height** (40px tile → 25px font; 32 → 20; 16 → 11; 128 → 80).
- Glyph is centred both axes, then nudged **+0.5px horizontally** — the P's stem makes it read left-heavy at true centre. At 16px this matters; above 64px it does not.
- The P is the ONLY element in the tile. No border on the default tile.

### Construction — wordmark
- "Properly", Archivo **600**, `letter-spacing: -0.03em`, color **#14202A**, `line-height: 1`.
- Wordmark cap height reads level with the tile: wordmark `font-size` **= tile height × 0.625**, same as the glyph (40px tile → 25px wordmark).

### Construction — endorsement stack
Vertical flex, `gap: 5px`, aligned to the wordmark's left edge:
1. Wordmark (above).
2. Hairline rule: `height: 1px`, background **#C3BDB2**, full width of the stack.
3. Endorsement line: "ownproperly.com", IBM Plex Mono **400**, `letter-spacing: 0.12em`, color **#7A8590**, `font-size` = **36% of the wordmark size** (25px wordmark → 9px). Never exceed 40%.

### Horizontal gap
Tile → text stack gap: **12px at a 40px tile** (= 30% of tile height). Scale proportionally.

## Lockups
Six approved lockups. Reference: `Properly Logo Usage Guide.dc.html`, section 01.

| Lockup | Composition | Use |
|---|---|---|
| **Primary horizontal** | Tile + wordmark + rule + endorsement, in a row | Default. Marketing header, footer, email header, decks |
| **Stacked** | Tile above a centred wordmark/rule/endorsement stack | Narrow or square spaces. Tile 46px, wordmark 23px, endorsement 8.5px |
| **Short lockup** | Tile + wordmark only, gap 11px at 34px tile, no rule/endorsement | In-app chrome, anything under 28px tall |
| **Reversed** | On #14202A. Tile becomes navy with a **1.25px oklch(0.72 0.12 250) border**; wordmark #FAF9F7; rule #47535F; endorsement #96A0AA | Dark surfaces only |
| **Mono** | Navy tile, **#FAF9F7** P (no blue), navy wordmark | Single-colour print, stamps, fax |
| **Descriptor swap** | Primary, but endorsement line reads "PROPERTY PORTFOLIOS, PROPERLY" — IBM Plex Mono 400, 8.5px, `letter-spacing: 0.14em`, `text-transform: uppercase` | First-contact contexts: paid ads, pitch decks, event stands |

In-app sidebar has its own reversed treatment: tile is **solid oklch(0.72 0.12 250)** with a **#14202A** P (inverted from the marketing tile), 26px tile, 19px wordmark, gap 9px, no endorsement line. Reference: guide section 06.

## Icon & favicon
Same construction at every size; radius and glyph scale per the 23% / 62.5% rules.

| Output | Size | Radius | Glyph |
|---|---|---|---|
| App icon / PWA | 512 | 118 | 320 |
| Apple touch icon | 180 | 41 | 112 |
| Standard | 64 | 15 | 40 |
| Standard | 32 | 8 | 20 |
| Favicon | 16 | 4 | 11 |
| Social avatar | any | **50% (circle)** | 62.5% |

- Ship favicon as SVG plus 32/16 PNG fallbacks and a 180 apple-touch-icon.
- **At 16px, verify the P renders legibly at 1× on Windows/Chrome.** If the counter fills in, thicken by increasing glyph size to 68% rather than switching weight.
- `theme-color` meta stays **#14202A** (already correct on the current site).
- OG image: navy #14202A ground, stacked lockup optically centred, safe margins ≥ 12% — 1200×630.

## Clearspace & minimum size
- **Clearspace on all four sides = the full height of the icon tile.** Nothing enters it — type, rules, imagery, buttons, container edges.
- **Minimum sizes:** 88px wide on screen; 24mm wide in print (both measured across the full primary lockup).
- Below minimum, degrade in this order: drop the endorsement line + rule → drop the wordmark → tile alone. The tile alone is the small-size mark.

## Design Tokens
```
--ink:      #14202A   /* tile fill, wordmark, dark surfaces. Matches current site theme-color */
--signal:   oklch(0.72 0.12 250)   /* the P, dark-surface accents */
--signal-deep: oklch(0.55 0.11 250) /* same hue, darker — for accent on light backgrounds if needed */
--paper:    #FAF9F7   /* light background, reversed wordmark */
--rule:     #C3BDB2   /* hairline in the endorsement stack ONLY */
--muted:    #7A8590   /* endorsement line on light */
--muted-dk: #96A0AA   /* endorsement line on navy */
```
Convert the two oklch values to the codebase's colour format at build time; keep the oklch as source of truth (they are the same hue, differing only in lightness).

Ratios (all derived from tile height H):
```
radius       = 0.23 × H
glyph size   = 0.625 × H
wordmark     = 0.625 × H
tile→text gap= 0.30 × H
stack gap    = 5px @ H=40  (0.125 × H)
endorsement  = 0.36 × wordmark size (hard max 0.40)
clearspace   = 1.0 × H on all sides
```

## Typography
- **Archivo** — weights 600 (wordmark) and 700 (tile glyph). Google Fonts. Self-host in production; subset to Latin.
- **IBM Plex Mono** — weight 400 (endorsement line, small labels). Google Fonts.
- If the codebase already ships a geometric grotesque at 600/700, Archivo may be substituted ONLY with sign-off — the wordmark's tight −0.03em tracking is doing real work and does not transfer to every face.

## Don't
Enforce in review; illustrated in guide section 05.
- Don't stretch, condense or otherwise scale non-uniformly.
- Don't recolour outside the palette (no red/amber tiles, no gradient fills).
- Don't reorder — the tile always leads (left in horizontal, top in stacked).
- Don't place on mid-tone colour or on photography. Navy, paper or white only.
- Don't set the endorsement line above 40% of the wordmark size.
- Don't add a border to the light-background tile, or a drop shadow to any part of the mark.

## Interactions & Behavior
The logo is not an interactive component beyond being a home link.
- Marketing header + app sidebar: wrap in a link to `/`. `aria-label="Properly — home"`.
- Hover: **no transform, no colour change on the mark**. If the codebase's header links have a hover treatment, exempt the logo.
- Focus-visible: 2px outline in `--signal`, 2px offset, following the codebase's existing focus convention.
- Provide the mark as a single inline SVG so it inherits crisp rendering; `role="img"` with a `<title>`.
- Reduced motion: nothing to disable.
- Responsive: primary lockup down to ~768px; **switch to short lockup below that**, not a scaled-down primary — the 9px endorsement line is unreadable on mobile.

## State Management
None. Static brand asset. The only conditional logic is surface-based lockup selection (light/dark/small), which should be a prop or variant on a single `<Logo>` component:
```
<Logo variant="primary" | "stacked" | "short" | "reversed" | "mono" | "descriptor" size={number} />
```
Build ONE component with variants rather than six files.

## If the name stays OwnProperly
Same construction, three changes:
- Wordmark reads "OwnProperly" — Archivo 600, tighten to `letter-spacing: -0.035em`, and reduce `font-size` to **0.55 × H** so the longer word still fits the app sidebar's 200px.
- Tile glyph becomes **"OP"** — Archivo 700, `letter-spacing: -0.06em`, font-size **0.45 × H**.
- Endorsement line is unnecessary (the name already contains the domain); drop the line and the rule. Use the descriptor variant for first-contact contexts.
Reference: `OwnProperly Logo Directions.dc.html`, option 1C / 2A.

## Assets
No binary assets exist yet — the mark is currently constructed from HTML divs and live Google Fonts.

**First implementation task: produce the master SVG.** Set the P in Archivo 700 at the ratios above, **convert type to outlines**, and verify the outlined path against the live-font render before committing. Then derive the PNG raster set (512/180/64/32/16), the circular avatar, and the OG image from that SVG. Everything else in this handoff describes geometry, not files.

Fonts: Archivo and IBM Plex Mono, both Google Fonts / OFL — self-host, subset Latin.

## Files
- `Properly Logo Usage Guide.dc.html` — **the specification.** Every lockup, icon size, clearspace diagram, palette, type spec, misuse case and in-place mockup. Build against this.
- `OwnProperly Logo Directions.dc.html` — exploration history: six initial directions (turn 1), ten refinements of the two shortlisted (turn 2), the Properly naming comparison (turn 3). Reference only; direction 3D was selected. Useful if a decision gets reopened.

Both open directly in a browser.

## Open questions for the client
1. Has the **Properly** name been signed off? Trademark and search are harder for a common adverb; the domain no longer matches the brand.
2. Does the rollout include transactional email, invoices and the app store listing, or web only?
3. Is Archivo acceptable as a new brand face, or must the mark work in a font the codebase already ships?
