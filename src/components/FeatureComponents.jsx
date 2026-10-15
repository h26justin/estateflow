// Barrel kept for back-compat: the property-detail tabs and Settings pages
// that used to live in this file now have one module each under
// ./feature and ./settings. Lazy call sites (App.jsx) import those modules
// directly so each tab/page gets its own chunk; prefer that for new code.
export { ComplianceTab } from './feature/ComplianceTab'
export { TenancyTab } from './feature/TenancyTab'
export { ExpensesTab } from './feature/ExpensesTab'
export { NotesTimeline } from './feature/NotesTimeline'
export { DocumentsTab } from './feature/DocumentsTab'
export { OverviewTab } from './feature/OverviewTab'
export { FinancialsTab } from './feature/FinancialsTab'
export { CompanyDocumentsTab } from './feature/CompanyDocumentsTab'
export { SettingsPage } from './settings/SettingsPage'
