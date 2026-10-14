// Entry point for the API surface.
//
// Historically this was a single 3,370-line `src/lib/api.js` (later
// `./_monolith.js`). It is now split by domain (properties, companies, rent,
// compliance, etc) — each domain file is a small module whose named
// functions are re-exported from here, so callers keep importing the same way:
//
//   import * as api from './lib/api'
//   await api.fetchProperties()
//
// Code that only needs one domain can import that module directly
// (e.g. `./lib/api/epc`). Private helpers shared between domain modules live
// in `./_shared`, which is deliberately NOT re-exported here.

// Domains split out of the former _monolith.js.
export * from './companies'
export * from './properties'
export * from './geocoding'
export * from './rent'
export * from './inspections'
export * from './access'
export * from './roles'
export * from './companySettings'
export * from './compliance'
export * from './tenantRecords'
export * from './maintenance'
export * from './expenses'
export * from './account'
export * from './documents'
export * from './invitations'
export * from './billing'
export * from './admin'
export * from './deals'
export * from './calculators'
export * from './reports'
export * from './audit'
export * from './trash'
export * from './lettings'
export * from './featureFlags'
export * from './mtd'
export * from './xero'

// Extracted domains. Order doesn't matter — each file's exports are
// independently named.
export * from './notifications'
export * from './insights'
export * from './references'
export * from './bank'
export * from './insurance'
export * from './tenant_portal'
export * from './backups'
export * from './maintenanceTriage'
export * from './rentCollection'
export * from './autopilot'
export * from './lettingsAssistant'
export * from './hmoRooms'
export * from './esign'
export * from './referencing'
export * from './bookkeeping'
export * from './rentersRights'
export * from './epc'
export * from './lodgify'
export * from './hostaway'
export * from './ownership'
export * from './statements'
export * from './dataImport'
export * from './tenancies'
export * from './stlIncome'
export * from './refurbs'
export * from './refurbInvoices'
export * from './refurbWorkspace'
export * from './statementImports'
export * from './statementAudit'
export * from './externalLoans'
