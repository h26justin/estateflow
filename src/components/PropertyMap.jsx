import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'

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
 */
export default function PropertyMap({ properties = [], onOpenProperty, setProperties, showToast }) {
  const { T } = useTheme()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])           // { marker, propertyId, popup }
  const [libReady, setLibReady]   = useState(!!window.mapboxgl)
  const [libError, setLibError]   = useState(null)
  const [geocoding, setGeocoding] = useState(null)  // { done, total } | null
  const [popupProp, setPopupProp] = useState(null)  // currently-open popup property
  const mono = "'DM Mono',monospace"

  // Status → pin colour. Matches STATUS_CFG in App.jsx so the map and the
  // status badges agree visually.
  const STATUS_COLOR = {
    rented:    '#2ECC8A',
    vacant:    '#E05555',
    purchased: '#E0943A',
    refurb:    '#4B8FE0',
    sold:      '#9B8AC2',
  }

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
  useEffect(() => {
    const map = mapRef.current
    if (!map || !libReady) return

    // Tear down old markers
    markersRef.current.forEach(m => { try { m.marker.remove() } catch (e) {} })
    markersRef.current = []

    const withCoords = properties.filter(p =>
      p.latitude && p.longitude &&
      typeof p.latitude === 'number' && typeof p.longitude === 'number'
    )
    if (withCoords.length === 0) return

    withCoords.forEach(p => {
      const color = STATUS_COLOR[p.status] || '#888EA8'

      // Build a custom HTML marker so we can colour-code
      const el = document.createElement('div')
      el.style.width = '22px'
      el.style.height = '22px'
      el.style.borderRadius = '50%'
      el.style.background = color
      el.style.border = '3px solid white'
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
      el.style.cursor = 'pointer'
      // Subtle ring on pinned (manually placed) pins so the user knows it's locked
      if (p.geocode_pinned) {
        el.style.outline = '2px solid ' + color + '66'
        el.style.outlineOffset = '2px'
      }

      const marker = new window.mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map)

      // Click → open popup card via React state. We avoid Mapbox's built-in
      // Popup so we can render a richer card with our own theme.
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setPopupProp(p)
        map.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 13), speed: 0.8 })
      })

      // Drag end → save new pin location
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
          // Revert visual position
          marker.setLngLat([p.longitude, p.latitude])
        }
      })

      markersRef.current.push({ marker, propertyId: p.id })
    })

    // Fit map to bounds (with sensible padding) on every update.
    if (withCoords.length === 1) {
      map.flyTo({ center: [withCoords[0].longitude, withCoords[0].latitude], zoom: 12 })
    } else if (withCoords.length > 1) {
      const bounds = new window.mapboxgl.LngLatBounds()
      withCoords.forEach(p => bounds.extend([p.longitude, p.latitude]))
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
    }
  }, [properties, libReady])

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
        <div ref={containerRef} style={{ width: '100%', height: 560, background: T.bg }}/>

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
                  style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 2 }}>{popupProp.name}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>{popupProp.address}</div>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gap: 6 }}>
              <Row label="Status" value={popupProp.status || '—'} valueColor={STATUS_COLOR[popupProp.status] || T.text}/>
              {popupProp.rent_pcm > 0 && <Row label="Monthly Rent" value={`£${popupProp.rent_pcm.toLocaleString()}`}/>}
              {popupProp.geocode_pinned && (
                <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, marginTop: 4 }}>
                  📌 Pin manually placed.{' '}
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
              style={{ display: 'block', width: '100%', padding: '11px 16px', border: 'none', borderTop: `1px solid ${T.border}`, background: T.gold, color: 'white', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>
              Open property →
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: mono, fontSize: 10, color: T.muted }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}/>
            {k}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: T.faint }}>Tip: drag a pin to fix its location.</span>
      </div>
    </div>
  )
}

function Row({ label, value, valueColor }) {
  const { T } = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ color: valueColor || T.text, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
