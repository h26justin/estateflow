// ── ATTACHMENT HELPERS (pure) ────────────────────────────────────────────────
// Small, DB-free helpers shared by the Trash purge and the deal → property
// carry-over. Kept out of the API layer so they can be unit-tested.

/**
 * Pull storage object paths out of rows from one of the tables that reference
 * files in the private property-documents bucket.
 *
 *   col = 'file_path' — one path per row (deal_documents, property_documents,
 *                       company_documents)
 *   col = 'photos'    — a JSONB array per row (property_inspections,
 *                       maintenance_jobs); items are { path, … } objects, or
 *                       bare path strings on the oldest rows.
 *
 * Blank / null paths and legacy public-URL-only entries (no path) are skipped:
 * there is nothing in the bucket to remove for them.
 */
export function extractStoragePaths(rows, col) {
  const out = []
  for (const row of rows || []) {
    const v = row?.[col]
    if (col === 'photos') {
      if (!Array.isArray(v)) continue
      for (const item of v) {
        const p = typeof item === 'string' ? item : item?.path
        if (typeof p === 'string' && p.trim()) out.push(p.trim())
      }
    } else if (typeof v === 'string' && v.trim()) {
      out.push(v.trim())
    }
  }
  return [...new Set(out)]
}

/**
 * Best-guess property document category for a deal document being carried
 * across on conversion, from its file name. Anything unrecognised lands in
 * 'other' (the property Documents tab's catch-all). Photos are handled by the
 * caller (they go to 'photos').
 */
export function dealDocToPropertyCategory(doc) {
  const n = String(doc?.caption || doc?.name || '').toLowerCase()
  if (/mortgage|lender|\bdip\b|decision in principle|offer letter/.test(n)) return 'mortgage'
  if (/\bepc\b|energy performance/.test(n)) return 'epc'
  if (/\beicr\b|electric/.test(n)) return 'eicr'
  if (/gas safety|\bgas\b|\bcp12\b/.test(n)) return 'gas'
  if (/insurance|policy schedule/.test(n)) return 'insurance'
  if (/inventory|schedule of condition/.test(n)) return 'inventory'
  if (/legal|contract|\btr1\b|title|lease|search|pack|solicitor|completion statement|exchange/.test(n)) return 'legal'
  if (/tenancy|\bast\b/.test(n)) return 'tenancy'
  return 'other'
}
