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

  // Build a normalized "building key" from an address. Strips flat-number
  // prefixes and optional postcode suffix, then takes the first comma-chunk
  // (typically the building name) plus the second-to-last chunk (typically
  // the town). This puts "Flat 1, Watts Moses House, Sunderland" and
  // "Flat 2, Watts Moses House, High Street East, Sunderland, SR1 2BX" into
  // the same group.
  //
  // Recognised prefix forms:
  //   "Flat 1, " / "Flat 1B, " / "Apt 12, " / "Apartment 4, " / "Unit 3, "
  //   "Room 5, " / "Suite 12, "
  //   "Ground Floor Flat, " / "First Floor Flat, " / etc. (named-floor)
  //   "Ground Floor, " / "First Floor, " (unit-implied)
  //   "Basement Flat, " / "Garden Flat, " / "Penthouse, "
  const FLAT_PREFIX_RE = /^\s*(?:(?:flat|apt|apartment|unit|room|suite)\s+\w+|(?:ground|first|second|third|fourth|fifth|top|basement|garden|lower|upper)(?:\s+floor)?(?:\s+flat)?|penthouse)\s*,\s*/i
  function groupKeyForAddress(address) {
    if (!address) return null
    let s = String(address).trim()
    s = s.replace(FLAT_PREFIX_RE, '')
    const parts = s.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length === 0) return null
    // Building/street is the first chunk; town is the second-to-last (skipping postcode if present)
    // UK postcode pattern in the last chunk
    const ukPostcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i
    let town = parts[parts.length - 1]
    if (ukPostcode.test(town) && parts.length > 1) town = parts[parts.length - 2]
    const building = parts[0]
    const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return norm(building) + '|' + norm(town)
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
                    style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
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
                    Total rent: <span style={{ color: T.text, fontWeight: 600 }}>£{totalRent.toLocaleString()}/mo</span>
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
                    {p.rent_pcm > 0 && <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>£{p.rent_pcm.toLocaleString()}</span>}
                    <span style={{ fontFamily: mono, fontSize: 14, color: T.faint, marginLeft: 4 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: mono, fontSize: 10, color: T.muted }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}/>
            {k}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: T.faint }}>Click a number to see all flats. Drag a single pin to fix its location.</span>
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
