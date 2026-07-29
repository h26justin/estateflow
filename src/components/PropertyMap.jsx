import { useState, useEffect, useRef } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { fmt } from '../lib/format'
import { FLAT_PREFIX_RE, groupKeyForAddress } from '../lib/addressUtils'

/**
 * PropertyMap — a Mapbox-powered map of all visible properties.
 *
 * Lazy-loads the Mapbox GL JS library + CSS from CDN on first render.
 * Pins are coloured by status using the existing palette.
 * Pins cluster automatically when zoomed out.
 * Click a pin → popover with property summary + "Open property" button.
 * Drag a pin → save manual location (sets geocode_pinned=true on the row).
 *
 * Props:
 *   properties      — array of property rows (already filtered by parent)
 *   onOpenProperty  — (propertyId) => void; called when user taps "Open"
 *   setProperties   — React setter so we can update rows after geocoding/pinning
 *   showToast       — toast helper from App.jsx
 *   compact         — when true, renders a smaller dashboard-friendly variant
 *   onViewFullMap   — optional callback: when present and compact=true, shows a "View full map" link
 */
export default function PropertyMap({ properties = [], onOpenProperty, setProperties, showToast, compact = false, onViewFullMap }) {
  const { T } = useTheme()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])           // { marker, propertyId, popup }
  const [libReady, setLibReady]   = useState(!!window.mapboxgl)
  const [libError, setLibError]   = useState(null)
  const [geocoding, setGeocoding] = useState(null)  // { done, total } | null
  const [popupProp, setPopupProp]   = useState(null)  // single-property popup
  const [popupGroup, setPopupGroup] = useState(null)  // cluster popup: { key, properties, lat, lng }
  const [searchQ, setSearchQ]       = useState('')    // map-only search filter (live)
  const [heatmapMode, setHeatmapMode] = useState(false)
  const [heatmapMetric, setHeatmapMetric] = useState('rent')  // 'rent' | 'yield' | 'arrears'
  const heatmapSourceId = 'ownproperly-heat-source'
  const heatmapLayerId  = 'ownproperly-heat-layer'
  const mono = MONO

  // Status → pin colour. Matches STATUS_CFG in App.jsx so the map and the
  // status badges agree visually.
  const STATUS_COLOR = {
    rented:         '#2ECC8A',
    short_term_let: '#9B6FDE',  // purple — matches the STL booking colour
    notice_given:   '#F0B850',  // amber — still rented but vacancy looming
    let_agreed:   '#C8A84B',  // gold — contracts being signed
    vacant:       '#E05555',
    purchased:    '#E0943A',
    refurb:       '#4B8FE0',
    sold:         '#9B8AC2',
  }

  // Note: FLAT_PREFIX_RE and groupKeyForAddress are imported from
  // ../lib/addressUtils so this clustering logic stays in sync with the
  // list-sort logic in App.jsx.

  // ─── Library bootstrap ──────────────────────────────────────────────────
  // Load Mapbox GL JS + CSS from CDN once. We don't want a build-time dep
  // (matches the jsPDF lazy-load pattern in the rest of the app).
  useEffect(() => {
    if (window.mapboxgl) { setLibReady(true); return }
    const token = api.getMapboxToken()
    if (!token) { setLibError('Map provider token is not configured.'); return }

    let cancelled = false
    const cssId = 'mapboxgl-css'
    const jsId  = 'mapboxgl-js'

    if (!document.getElementById(cssId)) {
      const link = document.createElement('link')
      link.id = cssId
      link.rel = 'stylesheet'
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css'
      document.head.appendChild(link)
    }
    if (!document.getElementById(jsId)) {
      const script = document.createElement('script')
      script.id = jsId
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js'
      script.async = true
      script.onload = () => { if (!cancelled) setLibReady(true) }
      script.onerror = () => { if (!cancelled) setLibError('Could not load map library.') }
      document.head.appendChild(script)
    } else {
      // Script tag exists but window.mapboxgl might still be loading
      const interval = setInterval(() => {
        if (window.mapboxgl) { setLibReady(true); clearInterval(interval) }
      }, 100)
      setTimeout(() => clearInterval(interval), 5000)
    }
    return () => { cancelled = true }
  }, [])

  // ─── Lazy geocoding fallback ────────────────────────────────────────────
  // If any visible property has no coordinates yet, geocode in background.
  // Updates `properties` via setProperties as each finishes so pins appear progressively.
  useEffect(() => {
    if (!libReady) return
    const missing = properties.filter(p => p.address && p.geocode_status !== 'ok' && p.geocode_status !== 'failed' && !p.archived_at)
    if (missing.length === 0) return

    let cancelled = false
    setGeocoding({ done: 0, total: missing.length })
    api.geocodeMissingProperties(missing, (done, total) => {
      if (!cancelled) setGeocoding({ done, total })
    }).then(async () => {
      if (cancelled) return
      // Refresh properties from the parent's source-of-truth pattern by
      // mutating each row optimistically. We'd need to re-fetch to get the
      // canonical state, so we just trigger a parent refresh via setProperties.
      try {
        const refreshed = await api.fetchProperties()
        if (!cancelled && setProperties) setProperties(refreshed)
      } catch (e) { /* noop */ }
      setGeocoding(null)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libReady])

  // ─── Map initialisation ────────────────────────────────────────────────
  useEffect(() => {
    if (!libReady || !containerRef.current || mapRef.current) return
    const token = api.getMapboxToken()
    if (!token) return
    window.mapboxgl.accessToken = token

    // Default centre: UK centroid. Will fitBounds to actual pins below.
    const map = new window.mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-2.5, 54.0],
      zoom: 5,
      attributionControl: true,
    })
    map.addControl(new window.mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map

    return () => {
      try { map.remove() } catch (e) {}
      mapRef.current = null
      markersRef.current = []
    }
  }, [libReady])

  // ─── Pin rendering ──────────────────────────────────────────────────────
  // Re-renders pins whenever the property list changes.
  // Skipped entirely when heatmapMode is on (the map shows the heatmap layer instead).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !libReady) return

    // Tear down old markers
    markersRef.current.forEach(m => { try { m.marker.remove() } catch (e) {} })
    markersRef.current = []

    if (heatmapMode) return  // heatmap layer renders separately

    // Apply on-map search filter (case-insensitive, matches name or address).
    // This is in ADDITION to the parent-level filters already applied to `properties`.
    const q = searchQ.trim().toLowerCase()
    const withCoords = properties.filter(p => {
      if (!(p.latitude && p.longitude)) return false
      if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q)
    })
    if (withCoords.length === 0) return

    // ── Group properties by building key ──────────────────────────────────
    // Properties with the same address-derived key share a single marker.
    // Properties without a derivable key (e.g. address blank) get their own
    // singleton group keyed by id so they still render.
    const groups = new Map()
    withCoords.forEach(p => {
      const key = groupKeyForAddress(p.address) || ('singleton:' + p.id)
      if (!groups.has(key)) groups.set(key, { key, properties: [], lat: 0, lng: 0 })
      groups.get(key).properties.push(p)
    })
    // Compute group centroid (mean lat/lng) — handles tiny geocoding jitter
    // between flats that ought to be at the same building.
    groups.forEach(g => {
      g.lat = g.properties.reduce((s, p) => s + p.latitude,  0) / g.properties.length
      g.lng = g.properties.reduce((s, p) => s + p.longitude, 0) / g.properties.length
    })

    groups.forEach(group => {
      const isCluster = group.properties.length > 1
      const el = document.createElement('div')

      if (isCluster) {
        // Cluster pin — circle showing count, slight stripe of constituent
        // status colours so a glance still tells you the rough composition.
        const count = group.properties.length
        // Pick the dominant status colour (or gold if mixed)
        const statusCounts = {}
        group.properties.forEach(p => {
          statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
        })
        const [topStatus] = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0] || ['rented']
        const dominantColor = STATUS_COLOR[topStatus] || '#888EA8'
        const isMixed = Object.keys(statusCounts).length > 1

        el.style.minWidth = '32px'
        el.style.height = '32px'
        el.style.padding = '0 6px'
        el.style.borderRadius = '999px'
        el.style.background = isMixed ? '#C8A84B' : dominantColor
        el.style.border = '3px solid white'
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)'
        el.style.cursor = 'pointer'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.color = 'white'
        el.style.fontFamily = "'DM Mono', monospace"
        el.style.fontSize = '12px'
        el.style.fontWeight = '700'
        el.textContent = String(count)

        const marker = new window.mapboxgl.Marker({ element: el })
          .setLngLat([group.lng, group.lat])
          .addTo(map)

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setPopupProp(null)
          setPopupGroup(group)
          map.flyTo({ center: [group.lng, group.lat], zoom: Math.max(map.getZoom(), 15), speed: 0.8 })
        })

        markersRef.current.push({ marker, groupKey: group.key })
      } else {
        // Single-property pin (existing behaviour)
        const p = group.properties[0]
        const color = STATUS_COLOR[p.status] || '#888EA8'

        el.style.width = '22px'
        el.style.height = '22px'
        el.style.borderRadius = '50%'
        el.style.background = color
        el.style.border = '3px solid white'
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
        el.style.cursor = 'pointer'
        if (p.geocode_pinned) {
          el.style.outline = '2px solid ' + color + '66'
          el.style.outlineOffset = '2px'
        }

        const marker = new window.mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([p.longitude, p.latitude])
          .addTo(map)

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setPopupGroup(null)
          setPopupProp(p)
          map.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 13), speed: 0.8 })
        })

        marker.on('dragend', async () => {
          const lngLat = marker.getLngLat()
          try {
            const updated = await api.setPropertyPin(p.id, lngLat.lat, lngLat.lng)
            if (setProperties) {
              setProperties(prev => prev.map(x => x.id === p.id ? { ...x, ...updated } : x))
            }
            if (showToast) showToast('Pin location saved')
          } catch (err) {
            if (showToast) showToast('Could not save pin: ' + err.message, 'error')
            marker.setLngLat([p.longitude, p.latitude])
          }
        })

        markersRef.current.push({ marker, propertyId: p.id })
      }
    })

    // Fit map to bounds (with sensible padding) on every update.
    if (withCoords.length === 1) {
      map.flyTo({ center: [withCoords[0].longitude, withCoords[0].latitude], zoom: 12 })
    } else if (withCoords.length > 1) {
      const bounds = new window.mapboxgl.LngLatBounds()
      withCoords.forEach(p => bounds.extend([p.longitude, p.latitude]))
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
    }
  }, [properties, libReady, searchQ, heatmapMode])

  // ─── Heatmap layer ──────────────────────────────────────────────────────
  // When heatmapMode is on, build a GeoJSON FeatureCollection from properties
  // and add it as a Mapbox heatmap source/layer. The `weight` property feeds
  // the heatmap intensity at each point — higher weight = warmer area.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !libReady) return

    // Helper: get weight for a property based on selected metric.
    // Normalised against the max within the visible set so the heat-map
    // contrast adapts to the portfolio's range, not absolute values.
    function rawWeight(p) {
      switch (heatmapMetric) {
        case 'rent':    return p.rent_pcm || 0
        case 'arrears': return p.arrears  || 0
        case 'yield': {
          if (!p.purchase_price || !p.rent_pcm) return 0
          return ((p.rent_pcm * 12) / p.purchase_price) * 100
        }
        default: return 0
      }
    }

    function clearLayer() {
      try {
        if (map.getLayer(heatmapLayerId)) map.removeLayer(heatmapLayerId)
        if (map.getSource(heatmapSourceId)) map.removeSource(heatmapSourceId)
      } catch (e) {}
    }

    if (!heatmapMode) { clearLayer(); return }

    function applyLayer() {
      // Build features. Use the same search filter as the pin path for consistency.
      const q = searchQ.trim().toLowerCase()
      const candidates = properties.filter(p =>
        p.latitude && p.longitude &&
        typeof p.latitude === 'number' && typeof p.longitude === 'number' &&
        (!q || (p.name||'').toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q))
      )
      if (candidates.length === 0) { clearLayer(); return }

      // Find the max raw weight so we can normalise to [0, 1] for Mapbox.
      // Skip zero/negative values when finding max so a portfolio with one
      // property at rent=£1000 doesn't become a single hot dot — the heatmap
      // should still scale meaningfully.
      const maxRaw = Math.max(1, ...candidates.map(rawWeight))
      const features = candidates.map(p => ({
        type: 'Feature',
        properties: {
          weight: Math.max(0, rawWeight(p)) / maxRaw,
        },
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
      }))
      const data = { type: 'FeatureCollection', features }

      // Update existing source or create
      const existing = map.getSource(heatmapSourceId)
      if (existing) {
        existing.setData(data)
      } else {
        map.addSource(heatmapSourceId, { type: 'geojson', data })
      }

      if (!map.getLayer(heatmapLayerId)) {
        map.addLayer({
          id: heatmapLayerId,
          type: 'heatmap',
          source: heatmapSourceId,
          paint: {
            // Weight per-point — drives intensity contributions
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
            // Overall intensity ramps with zoom — without this the heatmap
            // would look identical at every zoom level
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 16, 3],
            // Color ramp — cold (blue/transparent) to hot (red)
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,   'rgba(33,102,172,0)',
              0.2, 'rgba(103,169,207,0.5)',
              0.4, 'rgba(209,229,240,0.7)',
              0.6, 'rgba(253,219,199,0.8)',
              0.8, 'rgba(239,138,98,0.9)',
              1,   'rgba(178,24,43,1)',
            ],
            // Radius grows with zoom so heat blobs stay legible
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 16, 40],
            // Slightly fade out at very high zooms (where individual points should dominate)
            'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 0.6],
          },
        })
      }

      // Fit bounds for the heatmap as well
      if (candidates.length > 1) {
        const bounds = new window.mapboxgl.LngLatBounds()
        candidates.forEach(p => bounds.extend([p.longitude, p.latitude]))
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
      }
    }

    // Mapbox styles can be loaded asynchronously — guard against adding
    // a source before the style is ready. Use a cancellation flag so a
    // rapid toggle doesn't leave a dangling styledata listener that would
    // re-add the layer after we've turned heatmap mode off.
    let cancelled = false
    function safeApply() { if (!cancelled) applyLayer() }
    if (map.isStyleLoaded()) applyLayer()
    else map.once('styledata', safeApply)

    // Cleanup: cancel any pending styledata callback. We do NOT clear the
    // layer here on every re-run — that would cause flicker on data changes
    // while heatmap is on. Layer removal happens via the early-return at the
    // top of the effect when heatmapMode flips to false, or when the
    // component unmounts (the whole map goes with it).
    return () => { cancelled = true }
  }, [properties, libReady, searchQ, heatmapMode, heatmapMetric])

  // ─── Render ─────────────────────────────────────────────────────────────
  if (libError) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 32, textAlign: 'center' }}>
        <div style={{ fontFamily: mono, fontSize: 13, color: T.text, marginBottom: 8 }}>Map unavailable</div>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{libError}</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 14, lineHeight: 1.5 }}>
          Make sure VITE_MAPBOX_TOKEN is set in your Vercel project settings, then redeploy.
        </div>
      </div>
    )
  }

  const withCoords = properties.filter(p => p.latitude && p.longitude).length
  const total      = properties.filter(p => p.address && !p.archived_at).length
  const pending    = total - withCoords

  return (
    <div style={{ position: 'relative' }}>
      {/* Compact header — only renders on the dashboard variant */}
      {compact && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Property Map</h2>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>{withCoords} of {total} located</div>
          </div>
          {onViewFullMap && (
            <button onClick={onViewFullMap}
              style={{ background: 'none', border: 'none', padding: 0, fontFamily: mono, fontSize: 11, color: T.gold, cursor: 'pointer', textDecoration: 'underline' }}>
              View full map →
            </button>
          )}
        </div>
      )}
      {/* Status strip */}
      {(geocoding || pending > 0) && (
        <div style={{ marginBottom: 10, fontFamily: mono, fontSize: 11, color: T.muted }}>
          {geocoding
            ? `Locating ${geocoding.done}/${geocoding.total} addresses…`
            : pending > 0 ? `${pending} ${pending === 1 ? 'property hasn\'t' : "properties haven't"} been located yet.` : ''}
        </div>
      )}

      {/* Map container */}
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${T.border}` }}>
        <div ref={containerRef} style={{ width: '100%', height: compact ? 380 : 560, background: T.bg }}/>

        {/* Search input — top-left of map, hidden when a popup is open */}
        {libReady && !popupProp && !popupGroup && (
          <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 9, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', padding: '4px 8px', gap: 6, minWidth: 220 }}>
            <span style={{ fontSize: 12, color: T.muted, lineHeight: 1 }}>🔍</span>
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name or address…"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: T.text, fontFamily: mono, fontSize: 12, padding: '6px 0', minWidth: 0 }}/>
            {searchQ && (
              <button onClick={() => setSearchQ('')}
                aria-label="Clear search"
                aria-label="Close" style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '8px' , margin: '-8px -4px'}}>×</button>
            )}
          </div>
        )}

        {/* Loading overlay until lib + first pins are ready */}
        {!libReady && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, fontFamily: mono, fontSize: 11, color: T.muted }}>
            Loading map…
          </div>
        )}

        {/* Empty state when there are zero geocodable properties */}
        {libReady && withCoords === 0 && pending === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, fontFamily: mono, color: T.muted, pointerEvents: 'none' }}>
            <div style={{ fontSize: 28 }}>🗺</div>
            <div style={{ fontSize: 12 }}>No properties to display.</div>
            <div style={{ fontSize: 10, color: T.faint }}>Add a property with an address and it will appear here.</div>
          </div>
        )}

        {/* Property popup card */}
        {popupProp && (
          <div style={{ position: 'absolute', top: 16, left: 16, width: 280, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 10 }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {popupProp.company?.abbr || ''}
                </div>
                <button onClick={() => setPopupProp(null)} aria-label="Close"
                  aria-label="Close" style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 16, padding: '6px 8px', margin: '-6px -8px' }}>×</button>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 2 }}>{popupProp.name}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>{popupProp.address}</div>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gap: 6 }}>
              <Row label="Status" value={popupProp.status || '—'} valueColor={STATUS_COLOR[popupProp.status] || T.text}/>
              {popupProp.rent_pcm > 0 && <Row label="Monthly Rent" value={fmt(popupProp.rent_pcm)}/>}
              {popupProp.geocode_pinned && (
                <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, marginTop: 4 }}>
                  Pin manually placed.{' '}
                  <button onClick={async () => {
                    try {
                      const updated = await api.resetPropertyPin(popupProp.id, popupProp.address)
                      if (updated && setProperties) {
                        setProperties(prev => prev.map(x => x.id === popupProp.id ? { ...x, ...updated } : x))
                      }
                      setPopupProp(null)
                      if (showToast) showToast('Pin reset to auto-located position')
                    } catch (e) {
                      if (showToast) showToast('Could not reset pin', 'error')
                    }
                  }} style={{ background: 'none', border: 'none', padding: 0, color: T.gold, fontFamily: mono, fontSize: 9, cursor: 'pointer', textDecoration: 'underline' }}>
                    Reset to auto
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => onOpenProperty && onOpenProperty(popupProp.id)}
              style={{ display: 'block', width: '100%', padding: '11px 16px', border: 'none', borderTop: `1px solid ${T.border}`, background: T.gold, color: '#1C2830', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>
              Open property →
            </button>
          </div>
        )}

        {/* Cluster popup — shown when user clicks a multi-property pin */}
        {popupGroup && (() => {
          // Sort properties naturally (so Flat 1, Flat 2, Flat 10 sort numerically not alphabetically)
          const sorted = [...popupGroup.properties].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
          )
          // Headline: building name = first sorted property's address minus the flat prefix
          const sample = sorted[0]
          const buildingLabel = (sample.address || '').replace(FLAT_PREFIX_RE, '').split(',').slice(0, 2).join(',').trim()
          // Status counts for the summary chip row
          const statusCounts = {}
          sorted.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1 })
          // Total monthly rent across the building
          const totalRent = sorted.reduce((s, p) => s + (p.rent_pcm || 0), 0)
          return (
            <div style={{ position: 'absolute', top: 16, left: 16, width: 320, maxHeight: 'calc(100% - 32px)', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Building · {sorted.length} {sorted.length === 1 ? 'property' : 'properties'}
                  </div>
                  <button onClick={() => setPopupGroup(null)} aria-label="Close"
                    aria-label="Close" style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 16, padding: '6px 8px', margin: '-6px -8px' }}>×</button>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 2 }}>{buildingLabel}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {Object.entries(statusCounts).map(([s, c]) => (
                    <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: (STATUS_COLOR[s] || '#888EA8') + '22', color: STATUS_COLOR[s] || '#888EA8', fontFamily: mono, fontSize: 10, fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[s] || '#888EA8' }}/>
                      {c} {s}
                    </span>
                  ))}
                </div>
                {totalRent > 0 && (
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 8 }}>
                    Total rent: <span style={{ color: T.text, fontWeight: 600 }}>{fmt(totalRent)}/mo</span>
                  </div>
                )}
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                {sorted.map(p => (
                  <button key={p.id} onClick={() => onOpenProperty && onOpenProperty(p.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', border: 'none', borderBottom: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[p.status] || '#888EA8', flexShrink: 0 }}/>
                    <span style={{ flex: 1, fontFamily: mono, fontSize: 12, color: T.text }}>{p.name}</span>
                    {p.rent_pcm > 0 && <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{fmt(p.rent_pcm)}</span>}
                    <span style={{ fontFamily: mono, fontSize: 14, color: T.faint, marginLeft: 4 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      {/* View-mode toggle: Pins | Heatmap. Hidden in compact (dashboard) mode where space is tight. */}
      {!compact && (
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>View:</span>
        <button onClick={() => setHeatmapMode(false)}
          style={{ fontFamily: mono, fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${!heatmapMode ? T.gold : T.border}`,
            background: !heatmapMode ? T.gold + '22' : 'transparent',
            color: !heatmapMode ? T.gold : T.muted }}>Pins</button>
        <button onClick={() => setHeatmapMode(true)}
          style={{ fontFamily: mono, fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${heatmapMode ? T.gold : T.border}`,
            background: heatmapMode ? T.gold + '22' : 'transparent',
            color: heatmapMode ? T.gold : T.muted }}>Heatmap</button>
        {heatmapMode && (
          <>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginLeft: 8 }}>by</span>
            {[
              { v: 'rent',    l: 'Rent £' },
              { v: 'yield',   l: 'Yield %' },
              { v: 'arrears', l: 'Arrears £' },
            ].map(({ v, l }) => (
              <button key={v} onClick={() => setHeatmapMetric(v)}
                style={{ fontFamily: mono, fontSize: 10, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  border: `1px solid ${heatmapMetric === v ? T.text : T.border}`,
                  background: heatmapMetric === v ? T.text + '11' : 'transparent',
                  color: heatmapMetric === v ? T.text : T.muted }}>{l}</button>
            ))}
          </>
        )}
      </div>
      )}

      {/* Legend — only shown in pin mode (heatmap has its own colour ramp) */}
      {!heatmapMode && !compact && (
        <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: mono, fontSize: 10, color: T.muted }}>
          {Object.entries(STATUS_COLOR).map(([k, c]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}/>
              {k}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: T.faint }}>Click a number to see all flats. Drag a single pin to fix its location.</span>
        </div>
      )}
      {heatmapMode && !compact && (
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', fontFamily: mono, fontSize: 10, color: T.muted }}>
          <span>Cold</span>
          <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(to right, rgba(33,102,172,0.3), rgba(103,169,207,0.7), rgba(253,219,199,0.9), rgba(239,138,98,1), rgba(178,24,43,1))' }}/>
          <span>Hot</span>
          <span style={{ marginLeft: 8, color: T.faint }}>
            {heatmapMetric === 'rent' && 'Higher rent = warmer'}
            {heatmapMetric === 'yield' && 'Higher yield = warmer'}
            {heatmapMetric === 'arrears' && 'More arrears = warmer'}
          </span>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, valueColor }) {
  const { T } = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ color: valueColor || T.text, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
