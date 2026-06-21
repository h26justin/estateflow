# OwnProperly — Brand assets

Logo files in every requested format, in both **light** (dark ink on paper) and **dark** (paper on slate) styles.

## Folders
- `svg/` lives at the root here as the scalable masters (`*.svg`)
- `png/` — transparent-friendly raster, ~800–840px wide (wordmark) / 360px (monogram)
- `jpeg/` — flattened raster (same sizes), for places that reject PNG
- `pdf/` — single-page vector-wrapped raster, for print/email/letterheads
- `favicon/` — `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon-180.png`, `icon-512.png`

## Variants
| File stem | Use |
|---|---|
| `ownproperly-wordmark-{light,dark}` | Primary horizontal logo |
| `ownproperly-stacked-{light,dark}` | Stacked logo + tagline (footers, invoices) |
| `ownproperly-monogram-{light,dark}` | App icon / square avatar ("P.") |
| `favicon.svg` + `favicon/*` | Browser tab + home-screen icons |

## Colours
- Ink `#1C2830` · Paper `#F4F3EF` · Slate `#14202A`
- Gold (light) `#B8902F` · Gold (dark) `#CBA64E`

## Fonts
- Wordmark: **Schibsted Grotesk** — "Own" 500 / "Properly" 700, gold full-stop
- Tagline / numerals: **DM Mono** 500

> SVGs reference the Google webfont via `@import` so they render correctly in browsers. **For print/Illustrator, outline the text** (Type → Create Outlines) to make them fully self-contained. The PNG/JPEG/PDF files are already rasterised with the correct font.
