// __BUILD_ID__ is replaced at build time by the sw-version Vite plugin in
// vite.config.js. Each deploy gets a unique value so the previous deploy's
// cache becomes stale on activation. In dev this literal is harmless — the
// SW just uses 'dev' as the cache name.
const BUILD_ID = '__BUILD_ID__' === '__' + 'BUILD_ID__' ? 'dev' : '__BUILD_ID__'
const CACHE = `ownproperly-${BUILD_ID}`
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  // Drop every cache that isn't ours. This is what makes the per-build
  // cache name actually matter — old shells get wiped on first SW activation
  // after a deploy.
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  // Never cache API calls — Supabase responses are per-user/dynamic and
  // Mapbox tiles have their own caching.
  if (url.hostname.endsWith('supabase.co')) return
  if (url.hostname.endsWith('mapbox.com')) return

  // HTML / navigation requests: network-first. Users always get the latest
  // shell (which points at the latest hashed asset URLs). Falls back to
  // cache only when offline — better than a blank page.
  const isHTML = e.request.mode === 'navigate' ||
                 (e.request.headers.get('accept') || '').includes('text/html')
  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {})
          return res
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    )
    return
  }

  // Hashed assets, images, fonts: cache-first, then network. Hashed
  // filenames are immutable, so this is safe and very fast on repeat visits.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {})
        }
        return res
      }).catch(() => cached)
    })
  )
})
