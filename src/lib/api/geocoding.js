// Geocoding & map: Mapbox forward geocoding and property pins.
import { supabase } from '../supabase'

// ── GEOCODING & MAP ──────────────────────────────────────────────────────────

/**
 * Returns the public Mapbox token configured at build time.
 * If the token is missing, the geocode/map features will silently no-op
 * with a clear console warning rather than crash the app.
 */
export function getMapboxToken() {
  const token = import.meta.env?.VITE_MAPBOX_TOKEN
  if (!token) {
    console.warn('[OwnProperly] VITE_MAPBOX_TOKEN is not set. Map and geocoding features will not work.')
    return null
  }
  return token
}

/**
 * Geocode an address using the Mapbox Geocoding API (forward geocoding).
 * UK-biased (`country=gb`) for better hit rate on UK addresses.
 *
 * Returns { latitude, longitude, place_name } on success, null on failure.
 * Does NOT write to the database — caller is responsible for persistence.
 */
export async function geocodeAddress(address) {
  const token = getMapboxToken()
  if (!token || !address) return null
  const q = encodeURIComponent(address.trim())
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?country=gb&limit=1&access_token=${token}`
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const data = await r.json()
    const feature = data?.features?.[0]
    if (!feature?.center || feature.center.length !== 2) return null
    const [longitude, latitude] = feature.center
    return { latitude, longitude, place_name: feature.place_name || null }
  } catch (e) {
    console.warn('[OwnProperly] Geocoding failed:', e?.message)
    return null
  }
}

/**
 * Geocode a property's address and persist the result to the property row.
 * Skips properties that have been manually pinned (geocode_pinned=true).
 * Returns the updated property row on success, null on failure.
 *
 * Does NOT throw on geocoding failure — failure marks the row with status='failed'
 * so the UI can surface a "couldn't find this address" message without crashing.
 */
export async function geocodeProperty(propertyId, address) {
  if (!address) return null
  const result = await geocodeAddress(address)
  if (!result) {
    // Mark as failed so we don't keep retrying every page load
    await supabase.from('properties').update({
      geocode_status: 'failed',
      geocoded_at: new Date().toISOString(),
    }).eq('id', propertyId).is('geocode_pinned', false)
    return null
  }
  const { data, error } = await supabase.from('properties').update({
    latitude: result.latitude,
    longitude: result.longitude,
    geocoded_at: new Date().toISOString(),
    geocode_status: 'ok',
  }).eq('id', propertyId).is('geocode_pinned', false)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) {
    // If the .is(geocode_pinned, false) filter excluded the row (because it
    // was already pinned by the user), `single()` returns an error. That's
    // not a real failure — return null silently.
    return null
  }
  return data
}

/**
 * For the Map view: geocode any properties that don't have coordinates yet.
 * Runs in parallel with a small concurrency limit so we don't hammer the API.
 * Returns the count of newly-geocoded properties.
 */
export async function geocodeMissingProperties(properties, onProgress = null) {
  const candidates = (properties || []).filter(p =>
    p.address &&
    p.geocode_status !== 'ok' &&
    p.geocode_status !== 'failed' && // already-failed addresses don't auto-retry
    !p.archived_at
  )
  if (candidates.length === 0) return 0
  let done = 0
  // Limit concurrency to 3 — Mapbox free tier is 600 req/min, so this is fine.
  const concurrency = 3
  const queue = [...candidates]
  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift()
      if (!p) break
      await geocodeProperty(p.id, p.address)
      done++
      if (onProgress) onProgress(done, candidates.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return done
}

/**
 * Save a manually-placed pin location.
 * Sets geocode_pinned=true so subsequent automatic geocoding will not overwrite.
 */
export async function setPropertyPin(id, latitude, longitude) {
  const { data, error } = await supabase.from('properties').update({
    latitude,
    longitude,
    geocode_pinned: true,
    geocoded_at: new Date().toISOString(),
    geocode_status: 'ok',
  }).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}

/**
 * Reset a manually-placed pin back to "auto-geocoded" mode and re-geocode.
 * Useful when a user wants to undo their drag.
 */
export async function resetPropertyPin(id, address) {
  // First clear the pinned flag
  await supabase.from('properties').update({
    geocode_pinned: false,
    geocode_status: null,  // force re-geocode
  }).eq('id', id)
  // Then re-geocode
  return await geocodeProperty(id, address)
}
