// Shared address-parsing utilities for grouping properties by building.
// Used by:
//   - PropertyMap (to cluster pins at the same address)
//   - List sort (to keep flats from same building together)
//
// The aim is for "Flat 1, St Georges House" and "Flat 10, St Georges House"
// and "The Cottage, St Georges House" to all share the same group key.

// Recognised flat-prefix forms — extend this regex when new patterns appear:
//   Numbered: Flat 1, Flat 1B, Apt 12, Apartment 4, Unit 3, Room 5, Suite 12
//   Floor:    Ground Floor Flat, First Floor Flat, Top Floor, etc.
//   Named:    Penthouse, Basement Flat, Garden Flat
//   Secondary unit: The Cottage, The Annexe, The Coach House, The Mews
export const FLAT_PREFIX_RE = /^\s*(?:(?:flat|apt|apartment|unit|room|suite)\s+\w+|(?:ground|first|second|third|fourth|fifth|top|basement|garden|lower|upper)(?:\s+floor)?(?:\s+flat)?|penthouse|the\s+(?:cottage|annexe|annex|coach\s+house|mews|stables|barn|lodge|loft|studio))\s*,\s*/i

// UK postcode regex (greedy, case-insensitive)
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i

/**
 * Build a normalized "building key" from an address string. Properties whose
 * addresses produce the same key are at the same building. Returns null if
 * the address can't be parsed.
 *
 * Strategy:
 *   1. Strip any leading flat-prefix ("Flat 1, " "The Cottage, " etc.)
 *   2. Take the FIRST comma-chunk (= building name or street number+name)
 *   3. Take the SECOND-TO-LAST comma-chunk (= town, skipping postcode if present)
 *   4. Normalize both to lowercase alphanumeric and join.
 *
 * Examples:
 *   "Flat 1, St Georges House, Park Road, Sunderland, SR2 7BJ"
 *   "Flat 10, St Georges House, Park Road, Sunderland, SR2 7BJ"
 *   "The Cottage, St Georges House, Park Road, Sunderland, SR2 7BJ"
 *   → all return "stgeorgeshouse|sunderland"
 */
export function groupKeyForAddress(address) {
  if (!address) return null
  let s = String(address).trim().replace(FLAT_PREFIX_RE, '')
  const parts = s.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  let town = parts[parts.length - 1]
  if (UK_POSTCODE_RE.test(town) && parts.length > 1) town = parts[parts.length - 2]
  const building = parts[0]
  const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm(building) + '|' + norm(town)
}

/**
 * Extract the building "tail" from a property name. If the property is
 * named "Room 1, Watts Moses House" or "Flat 3, Piers View, Park Road",
 * the tail is everything after the FIRST comma — i.e. the part that all
 * units in the same building share.
 *
 * Returns null when the name has no comma (i.e. it's a standalone
 * property, not a flat/room within a larger building).
 *
 * Used by the Rent Tracker to cluster rooms/flats under a building
 * heading. Cheaper and more permissive than groupKeyForAddress because
 * many users only fill in the property name, not the full address.
 *
 * Examples:
 *   "Room 1, Watts Moses House"          → "Watts Moses House"
 *   "Room 43, Watts Moses House"         → "Watts Moses House"
 *   "Flat 3, Piers View, Park Road"      → "Piers View, Park Road"
 *   "13 Lumley Street"                   → null  (no comma)
 *   ""                                   → null
 */
export function buildingTailFromName(name) {
  if (!name) return null
  const i = String(name).indexOf(',')
  if (i < 0) return null
  return name.slice(i + 1).trim() || null
}

/**
 * Extract a sortable "secondary key" within a building. Used to order
 * flats/rooms 1, 2, 3, ..., 10, 11 within their building cluster.
 *
 * Returns a string suitable for natural-sort comparison. Falls back to the
 * full name if no flat number can be parsed.
 *
 * Examples:
 *   "Flat 1, St Georges House"   → "flat 1"
 *   "Flat 10, St Georges House"  → "flat 10"
 *   "The Cottage, St Georges House" → "the cottage"
 *   "Room 5, Piers View"         → "room 5"
 */
export function flatKeyWithinBuilding(name) {
  if (!name) return ''
  // Take everything up to (but not including) the first comma
  const head = String(name).split(',')[0].trim().toLowerCase()
  return head
}
