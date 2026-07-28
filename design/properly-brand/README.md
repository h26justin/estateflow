# Properly brand assets (direction 3D)

Spec: `HANDOFF.md` (the designer handoff, copied verbatim). Generator:
`generate.js` — outlines Archivo 600/700 + IBM Plex Mono 400 to SVG paths
(no webfont dependency in any shipped asset) and derives the full set:

- `public/logo.svg` — primary endorsed lockup (light surfaces)
- `public/wordmark-dark.svg` — reversed lockup (navy surfaces)
- `public/brand/lockup-short.svg` — tile + wordmark, in-app chrome (light)
- `public/brand/app-sidebar.svg` — app chrome treatment (dark): signal tile, paper wordmark
- `public/brand/lockup-mono.svg` — single-colour print
- `public/stacked-{light,dark}.svg`, `public/monogram-*.svg`
- `public/favicon.svg|ico`, `favicon-16/32/48.png`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `public/og-image.png` (1200×630),
  `public/brand/avatar-512.png` (social), `public/brand/email-lockup.png` (3×, for HTML email)

To regenerate: `npm i opentype.js sharp png-to-ico culori` in a scratch dir
with this script plus the Archivo/IBM Plex Mono TTFs (Google Fonts, OFL),
then copy `out/` into `public/` per the list above. The oklch signal blue
resolves to #67AAED (deep variant #3A75AF) — computed via culori.

The React entry point is `src/components/Logo.jsx` (variants; `ChromeLogo`
picks sidebar/short by theme). Legal entity name stays "OwnProperly Ltd"
in Privacy/Terms/Security pages deliberately.
