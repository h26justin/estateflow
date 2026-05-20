// Entry point for the API surface.
//
// Historically this was a single 3,370-line `src/lib/api.js`. We're
// progressively splitting it by domain (properties, companies, rent,
// compliance, etc) — each domain file is a small module that re-exports
// its named functions from here, so callers keep importing the same way:
//
//   import * as api from './lib/api'
//   await api.fetchProperties()
//
// While the split is in progress, `./_monolith` holds the not-yet-extracted
// remainder. Anything still in there should be moved gradually as we touch
// the surrounding code; nothing forces a big-bang migration.
//
// See top of _monolith.js for the section index that informed the split.

export * from './_monolith'

// Extracted domains. Order doesn't matter — each file's exports are
// independently named.
export * from './notifications'
export * from './insights'
export * from './references'
export * from './bank'
export * from './insurance'
export * from './tenant_portal'
export * from './backups'
