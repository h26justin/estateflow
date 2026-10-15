// Code-split views, panels and modals rendered by App and its view
// components (moved out of App.jsx). One lazy object per component, shared
// by every importer, so a chunk is fetched once and never re-suspends.
import { lazy } from 'react'
import { lazyPanel } from '../../lib/lazyPages'

// The property-detail tabs (components/feature/*), Settings
// (components/settings/*, pulls in HelpCenter) and the tenancy/
// maintenance tab modules (which pull in NoticeGenerator) only render on
// the property-detail / settings / companies views — lazy-load them so
// they drop out of the entry chunk. Logged-out marketing visitors and the
// first dashboard paint no longer pay for them. lazyNamed() adapts a
// named export to React.lazy's default-export contract; repeated imports
// of the same module share one chunk/fetch.
const lazyNamed = (loader, name) => lazy(() => loader().then(m => ({ default: m[name] })))
export const ComplianceTab       = lazyNamed(() => import('../feature/ComplianceTab'), 'ComplianceTab')
export const TenancyTab          = lazyNamed(() => import('../feature/TenancyTab'), 'TenancyTab')
export const ExpensesTab         = lazyNamed(() => import('../feature/ExpensesTab'), 'ExpensesTab')
export const SettingsPage        = lazyNamed(() => import('../settings/SettingsPage'), 'SettingsPage')
export const NotesTimeline       = lazyNamed(() => import('../feature/NotesTimeline'), 'NotesTimeline')
export const OverviewTab         = lazyNamed(() => import('../feature/OverviewTab'), 'OverviewTab')
export const FinancialsTab       = lazyNamed(() => import('../feature/FinancialsTab'), 'FinancialsTab')
export const DocumentsTab        = lazyNamed(() => import('../feature/DocumentsTab'), 'DocumentsTab')
export const CompanyDocumentsTab = lazyNamed(() => import('../feature/CompanyDocumentsTab'), 'CompanyDocumentsTab')
const maintenanceModule = () => import('../maintenance')
export const MaintenanceTab = lazyNamed(maintenanceModule, 'MaintenanceTab')
const tenancyModule = () => import('../tenancy')
export const RightToRentTab       = lazyNamed(tenancyModule, 'RightToRentTab')
export const DepositProtectionTab = lazyNamed(tenancyModule, 'DepositProtectionTab')
export const NoticeTrackerTab     = lazyNamed(tenancyModule, 'NoticeTrackerTab')
export const RentHistoryTab       = lazyNamed(tenancyModule, 'RentHistoryTab')
export const TenancyRenewalAlert  = lazyNamed(tenancyModule, 'TenancyRenewalAlert')
// Heavy / rarely-on-first-paint pages — code-split via React.lazy so they
// don't bloat the initial bundle. Each one drops into its own chunk and
// only fetches when the user navigates there.
export const ReportsPage     = lazy(() => import('../ReportsPage'))
export const AdminDashboard  = lazy(() => import('../AdminDashboard'))
// Off-first-paint panels and modals (detail-page tabs, dialogs, legal
// pages): code-split so they leave the App chunk. lazyPanel wraps each in
// its own <Suspense>, so call sites are unchanged; a modal simply appears
// once its chunk (a few KB) has loaded.
export const TenantInbox = lazyPanel(() => import('../TenantInbox'))
export const TenancyPanel = lazyPanel(() => import('../TenancyPanel'))
export const ReceiptsPanel = lazyPanel(() => import('../ReceiptsPanel'))
export const ArrearsPanel = lazyPanel(() => import('../ArrearsPanel'))
export const ReviewQueuePanel = lazyPanel(() => import('../ReviewQueuePanel'))
export const PrivacyPolicy = lazyPanel(() => import('../PrivacyPolicy'))
export const TermsOfService = lazyPanel(() => import('../TermsOfService'))
export const SecurityPage = lazyPanel(() => import('../SecurityPage'))
export const FeedbackPage = lazyPanel(() => import('../FeedbackPage'))
export const TenantReferenceModal = lazyPanel(() => import('../TenantReferenceModal'))
export const BankConnectionsModal = lazyPanel(() => import('../BankConnectionsModal'))
export const BankInboxModal = lazyPanel(() => import('../BankInboxModal'))
export const SuspendedAccessBanner = lazyPanel(() => import('../SuspendedAccessBanner'))
export const BuildingMortgageModal = lazyPanel(() => import('../BuildingMortgageModal'))
export const CompanyOwnershipSection = lazyPanel(() => import('../CompanyOwnershipSection'))
export const HoldingGroupPanel = lazyPanel(() => import('../HoldingGroupPanel'))
export const CompanyLegalOwnerSetting = lazyPanel(() => import('../CompanyLegalOwner'))
export const PropertyModal = lazyPanel(() => import('../modals/PropertyModal'))
export const CompanyModal = lazyPanel(() => import('../modals/CompanyModal'))
export const DeleteConfirmModal = lazyPanel(() => import('../modals/DeleteConfirmModal'))
export const SellPropertyModal = lazyPanel(() => import('../modals/SellPropertyModal'))
export const DeleteCompanyModal = lazyPanel(() => import('../modals/DeleteCompanyModal'))
export const PaymentModal = lazyPanel(() => import('../modals/PaymentModal'))
export const CustomizeDashModal = lazyPanel(() => import('../modals/CustomizeDashModal'))
export const TenantPortal    = lazy(() => import('../TenantPortal'))
export const DealsPage       = lazy(() => import('../DealsPage'))
const refurbsModule   = () => import('../RefurbsPage')
export const RefurbsPage     = lazy(refurbsModule)
export const RefurbPropertyTab = lazyNamed(refurbsModule, 'RefurbPropertyTab')
export const DayTrackerPage  = lazy(() => import('../DayTrackerPage'))
export const PropertyMap     = lazy(() => import('../PropertyMap'))
export const CompliancePage  = lazy(() => import('../CompliancePage'))
export const MtdItsaPage     = lazy(() => import('../MtdItsaPage'))
export const ShortTermLetIncomePage = lazy(() => import('../ShortTermLetIncomePage'))
export const AutopilotWidget = lazyNamed(() => import('../AutopilotPanel'), 'AutopilotWidget')
export const AutopilotPage   = lazyNamed(() => import('../AutopilotPanel'), 'AutopilotPage')
export const RentersRightsCopilot = lazyNamed(() => import('../RentersRightsCopilot'), 'RentersRightsCopilot')
export const HmoRoomsPanel   = lazy(() => import('../HmoRoomsPanel'))
export const EpcPlanner      = lazy(() => import('../EpcPlanner'))
export const RentCollectionPanel = lazyNamed(() => import('../RentCollectionPanel'), 'RentCollectionPanel')
export const ESignPanel      = lazy(() => import('../ESignPanel'))
export const ReferencingPanel = lazy(() => import('../ReferencingPanel'))
export const StatementImporter = lazyNamed(() => import('../StatementImporter'), 'StatementImporter')
// Standalone rental-statement / bank reconciliation audit register (2026-09).
// Reads and writes only its own statement_audit_* tables.
export const StatementAuditPage = lazy(() => import('../StatementAuditPage'))
export const ExternalLoansPage = lazy(() => import('../ExternalLoansPage'))
export const DataImporter = lazyNamed(() => import('../DataImporter'), 'DataImporter')
export const OnboardingWizard = lazy(() => import('../OnboardingWizard'))
export const OnboardingTour = lazy(() => import('../OnboardingTour'))
export const BulkAddPropertyModal = lazy(() => import('../BulkAddPropertyModal'))
export const ReceiptScanModal = lazy(() => import('../ReceiptScanModal'))
