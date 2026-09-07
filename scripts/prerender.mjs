// Post-build prerender. Runs after `vite build` (see package.json) and
// rewrites dist/index.html with the marketing site rendered into #root, plus
// dist/{privacy,terms,security}/index.html with their own title, description
// and canonical. Until 2026-09 every one of those URLs served an empty shell
// with the homepage's meta, and any unknown URL a 200, so search engines saw
// six copies of one page and no content on any of them.
//
// The SPA still mounts on load (createRoot replaces the static markup), and
// on /privacy etc. App.jsx renders the same component, so the swap is
// seamless for people and the content is real for crawlers.
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// Modules under src/ read import.meta.env at import time. The prerender never
// talks to Supabase, but the client module must construct, so give it
// placeholders when the build environment (CI) has none. Nothing from these
// values reaches the HTML.
process.env.VITE_SUPABASE_URL ||= 'https://prerender.invalid'
process.env.VITE_SUPABASE_ANON_KEY ||= 'prerender-placeholder'

const dist = path.resolve('dist')
const shellPath = path.join(dist, 'index.html')
if (!fs.existsSync(shellPath)) { console.error('[prerender] dist/index.html missing; run vite build first'); process.exit(1) }

const META = {
  privacy:  { title: 'Privacy Policy — Properly', description: 'How Properly (OwnProperly Ltd) collects, uses and protects personal data for landlords and their tenants.', path: '/privacy' },
  terms:    { title: 'Terms of Service — Properly', description: 'The terms on which OwnProperly Ltd provides the Properly property management service.', path: '/terms' },
  security: { title: 'Security — Properly', description: 'How Properly protects landlord and tenant data: encryption, row-level security, backups, access control and incident handling.', path: '/security' },
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { renderPage } = await vite.ssrLoadModule('/src/prerender/entry.jsx')
  const shell = fs.readFileSync(shellPath, 'utf8')
  const ROOT = '<div id="root"></div>'
  if (!shell.includes(ROOT)) throw new Error('index.html has no empty #root to fill')
  const inject = (body) => shell.replace(ROOT, `<div id="root">${body}</div>`)
  const withMeta = (html, m) => html
    .replace(/<title>[^<]*<\/title>/, `<title>${m.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${m.description}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1https://www.ownproperly.com${m.path}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1https://www.ownproperly.com${m.path}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${m.title}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${m.title}$2`)
    // The homepage's SoftwareApplication schema does not describe a legal page.
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')

  const home = renderPage('home')
  fs.writeFileSync(shellPath, inject(home))
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(home)?.[1]?.replace(/<[^>]+>/g, '').trim()
  console.log(`[prerender] index.html: ${Math.round(home.length / 1024)} KB of markup, h1 "${h1 || '(none)'}"`)

  for (const name of Object.keys(META)) {
    const dir = path.join(dist, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), withMeta(inject(renderPage(name)), META[name]))
    console.log(`[prerender] ${name}/index.html written`)
  }
} finally {
  await vite.close()
}
