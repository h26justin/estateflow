import { useState, useEffect, useMemo, useCallback, useRef, Suspense, Fragment } from 'react'
import { useTheme } from './lib/ThemeContext'
import { useIsMobile } from './lib/useWindowSize'
import { getSubdomain } from './lib/subdomain'
import { ALL_NAV, DEFAULT_NAV_KEYS, VIEW_LABELS, SETTINGS_TABS, AUTO_ENABLE_NAV_KEYS, navSeenMarker } from './lib/nav'
import { REPORT_CATALOGUE } from './lib/reportCatalogue'
import { defaultRentYear, getMonthlyRentStats, stlPaymentIds } from './lib/rentStats'
import { canDo } from './lib/permissions'
import { rentMonthSnapshot, monthRate } from './lib/rentForecast'
import { resolveWidgetPrefs } from './lib/dashboardPrefs'
import RentIncomePanel from './components/RentIncomePanel'
import { SmartAlerts, ContractorsPage } from './components/DashboardComponents'
import { MarketingSite } from './lib/lazyPages'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/AuthContext'
import * as api from './lib/api'
import LoginPage from './components/LoginPage'
import CalcExplain from './components/CalcExplain'
import { ErrorBoundary } from './components/ErrorBoundary'
import ActionMenu from './components/ActionMenu'
import { aggregateDeals } from './lib/dealCashflow'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, isPropertyEarningRent, isPropertyOccupied, occupancySummary, planOnMarketPeriods } from './lib/propertyStatus'
import { propValue } from './lib/propertyValue'
import { isHoldingCompany } from './lib/companyPnl'
import { groupKeyForAddress, flatKeyWithinBuilding, groupPropertiesByBuilding } from './lib/addressUtils'
import { matchesQuery } from './lib/propertySearch'
import { useScrollRestoreOnClear } from './lib/useScrollRestoreOnClear'
import { ChromeLogo, ChromeIcon } from './components/Logo'
import { propertyComplianceSummary } from './lib/complianceStatus'
import { canonicalCertType } from './lib/complianceCatalogue'
import { useConfirm } from './lib/ConfirmContext'
import { looksLikeCompanyInviteCode } from './lib/inviteUtils'
import { logError } from './lib/logError'
import { MONO, SANS } from './lib/styles'
import { Icon, ICON_NAMES } from './lib/icons'
import NotificationCentre from './components/NotificationCentre'
import CommandPalette from './components/CommandPalette'
import PropertySearchBar from './components/PropertySearchBar'
import PortfolioInsightsWidget from './components/PortfolioInsightsWidget'
import TrialExpiredGate, { getOverdueCompanies } from './components/TrialExpiredGate'
import { canUseInvestorFeatures } from './lib/tierGating'
import { isSafeUrl, calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit } from './lib/propertyCalcs'
import { pressable } from './lib/pressable'
import { plural } from './lib/format'
import AppShellStyles from './lib/AppShellStyles'
import { ComplianceTab, TenancyTab, ExpensesTab, SettingsPage, OverviewTab, FinancialsTab, DocumentsTab, CompanyDocumentsTab, MaintenanceTab, RightToRentTab, DepositProtectionTab, NoticeTrackerTab, RentHistoryTab, TenancyRenewalAlert, ReportsPage, AdminDashboard, TenantInbox, TenancyPanel, PrivacyPolicy, TermsOfService, SecurityPage, FeedbackPage, TenantReferenceModal, SuspendedAccessBanner, BuildingMortgageModal, CompanyOwnershipSection, HoldingGroupPanel, PropertyModal, CompanyModal, DeleteConfirmModal, SellPropertyModal, DeleteCompanyModal, PaymentModal, CustomizeDashModal, TenantPortal, DealsPage, RefurbsPage, RefurbPropertyTab, DayTrackerPage, PropertyMap, CompliancePage, MtdItsaPage, ShortTermLetIncomePage, AutopilotWidget, AutopilotPage, RentersRightsCopilot, HmoRoomsPanel, EpcPlanner, RentCollectionPanel, ESignPanel, ReferencingPanel, StatementImporter, StatementAuditPage, ExternalLoansPage, DataImporter, OnboardingWizard, OnboardingTour, BulkAddPropertyModal, ReceiptScanModal } from './components/app/lazyViews'
import { fmt } from './lib/appFmt'
import { STATUS_CFG, Badge, CompanyPill } from './components/app/Badges'
import { StatCard } from './components/app/StatCard'
import { HealthRing } from './components/app/HealthRing'
import { RentDots } from './components/app/RentDots'
import { Spinner, PageLoadingSpinner, SR_ONLY, DashboardSkeleton } from './components/app/Loading'
import { PortfolioModellerWidget } from './components/app/PortfolioModellerWidget'
import { PropertyGrid } from './components/app/PropertyGrid'
import { DraggablePropertyList } from './components/app/DraggablePropertyList'
import { RentTrackerOverview } from './components/app/RentTrackerOverview'
import { RentTab } from './components/app/RentTab'

// canDo(permissionsMap, companyId, key) lives in src/lib/permissions.js so the
// components that gate write surfaces (Day Tracker, importers, Team & Access)
// share one fail-closed implementation with App.jsx.

export default function App({ initialLoginMode = null } = {}) {
  const {session,user,loading: authLoading} = useAuth()
  const confirmDialog = useConfirm()
  const [properties,  setProperties]  = useState([])
  // Deals loaded at App level so the Dashboard cashflow widget can read them.
  // DealsPage still owns its OWN local deals state for its own list/CRUD —
  // it pushes updates back here via onDealsChange so the dashboard stays
  // in sync without us having to fully lift state.
  const [dashboardDeals, setDashboardDeals] = useState([])
  // Insurance policies loaded at App level for the dashboard widget +
  // per-property indicators. The InsurancePage manages its own local copy
  // for CRUD; we don't try to keep them in sync constantly (re-fetched on
  // page mount). This is acceptable for slowly-changing data like policies.
  const [insurancePolicies, setInsurancePolicies] = useState([])
  const [companies,        setCompanies]        = useState([])
  const [companySettings,  setCompanySettings]   = useState({})  // companyId -> settings
  const [loading,     setLoading]      = useState(true)
  // Monotonic ids guarding loadData / refreshData against stale and
  // out-of-order responses; see the guards there.
  const loadGenRef = useRef(0)
  const refreshSeqRef = useRef(0)
  const userIdRef = useRef(null)
  userIdRef.current = user?.id ?? null
  // Set when the initial portfolio load fails — drives a dedicated error
  // screen with a Retry button instead of the misleading new-account
  // welcome zero-state. loadNonce re-runs loadData on Retry.
  const [loadError,   setLoadError]    = useState(null)
  const [loadNonce,   setLoadNonce]    = useState(0)
  // property_id -> tenancy_details row, for HealthBadge's tenancy deduction.
  // Loaded best-effort after boot; empty map degrades to "no deduction".
  const [tenanciesByProp, setTenanciesByProp] = useState({})
  const [view,        setView]         = useState('dashboard')
  const [importDocs, setImportDocs] = useState(null) // emailed statement ids to open in the importer
  const [selectedId,  setSelectedId]   = useState(null)
  const [detailTab,   setDetailTab]    = useState('overview')
  // Selected report id when drilled into a specific report. Lifted up here
  // so it can participate in browser history (back/forward) instead of
  // being purely local state inside ReportsPage. null = catalogue view.
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [portfolioTab, setPortfolioTab] = useState('properties')
  // Portfolio properties layout: dense list (default) or gradient card grid.
  const [propLayout, setPropLayout] = useState(() => { try { return localStorage.getItem('ef_prop_layout') || 'list' } catch(e) { return 'list' } })
  useEffect(() => { try { localStorage.setItem('ef_prop_layout', propLayout) } catch(e) {} }, [propLayout])
  const [coFilter,    setCoFilter]     = useState('all')
  const [dashCoFilter, setDashCoFilter] = useState([]) // [] = all companies
  const [statusFilter,setStatusFilter] = useState('all')
  const [searchQ,     setSearchQ]      = useState('')
  const [sortBy,      setSortBy]       = useState('company-name')
  const [showArchived,setShowArchived] = useState(false)
  const [activeCoTab, setActiveCoTab]  = useState(null)
  const [showAddProp, setShowAddProp]  = useState(false)
  const [showBuildingMortgage, setShowBuildingMortgage] = useState(false)
  const [showReceiptScan, setShowReceiptScan] = useState(false)
  const [showAddCo,   setShowAddCo]    = useState(false)
  const [renameCoTarget, setRenameCoTarget] = useState(null)
  const [renameCo, setRenameCo]        = useState({ name:'', abbr:'' })
  const [renameCoPassword, setRenameCoPassword] = useState('')
  const [renameCoError, setRenameCoError] = useState('')
  const [renameCoSaving, setRenameCoSaving] = useState(false)
  const [deleteCoTarget, setDeleteCoTarget] = useState(null)  // company being soft-deleted
  const [showNewMenu, setShowNewMenu]  = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showPalette, setShowPalette]   = useState(false)
  const [showReferencing, setShowReferencing] = useState(false)
  const [editProp,    setEditProp]     = useState(null)
  // When a property is being created by converting a completed deal, this
  // holds that deal's id. On a successful save we soft-delete the deal so it
  // drops off the Deals page (it now lives in the portfolio as a property).
  // Bumping convertRefreshKey tells DealsPage to reload + return to its list.
  const [convertSourceDealId, setConvertSourceDealId] = useState(null)
  // The full deal record, so the refurb budget, dates and BRRR end value
  // can become a refurb project once the property row exists.
  const [convertSourceDeal, setConvertSourceDeal] = useState(null)
  const [convertRefreshKey,   setConvertRefreshKey]   = useState(0)
  const [toast,       setToast]        = useState(null)
  const [editingPayment, setEditingPayment] = useState(null)  // {payment, propId}
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(null)
  const [showSellModal,      setShowSellModal]      = useState(null) // property id
  const [propertyActionBusy, setPropertyActionBusy] = useState(false)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [isTenant, setIsTenant] = useState(false)
  // /privacy and /terms render their own static pages, even when the
  // user isn't logged in. Detect from the URL on mount so HMRC reviewers
  // and Google can link to stable URLs.
  const [showPrivacy, setShowPrivacy] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/privacy')
  )
  const [showTerms, setShowTerms] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/terms')
  )
  const [showSecurity, setShowSecurity] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/security')
  )
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  // Subscription rows for the user's accessible companies. Loaded after
  // companies are known. Used by the trial-expired hard gate to decide
  // whether to lock the app. Empty array = "no subs yet" → only
  // trial_ends_at + is_free_tier on the company row matter.
  const [companySubs, setCompanySubs] = useState([])
  // Collaborator companies that were filtered out due to suspended billing
  // (owner stopped paying or trial expired). Surfaced via the
  // SuspendedAccessBanner when the user has no other accessible companies.
  const [suspendedAccess, setSuspendedAccess] = useState([])
  // Dashboard widget customization
  const [widgetPrefs, setWidgetPrefs] = useState(null) // null = defaults
  // Dashboard section reordering & show/hide. Stored per-user in localStorage.
  // Format: [{ key: 'kpi_grid', enabled: true }, ...]
  // Keyed by user id so multiple users on the same browser don't share prefs.
  const [sectionPrefs, setSectionPrefs] = useState(null)
  // Customize-dashboard modal has two tabs: 'sections' and 'widgets'
  const [showCustomizeDash, setShowCustomizeDash] = useState(false)
  const [customizeDashTab, setCustomizeDashTab] = useState('sections')

  // ── Metadata for the customize modal ────────────────────────────────────
  // The actual render functions live inside the dashboard render block (so
  // they close over dashProps, companies, etc). These metadata constants are
  // used by CustomizeDashModal for display only.
  // Keep in sync with SECTION_DEFS inside the dashboard render block below.
  // We need both because the modal closure needs metadata in scope, but
  // the render closures need access to dashProps/companies/etc. If you
  // add a new section, add it in BOTH places (the render fn list at
  // ~line 1750, plus the three constants here).
  const SECTION_META = {
    rent_income:        { icon:'pound',          label:'Rental Income',               description:'Due vs collected by month, year to date, with a per-company split' },
    kpi_grid:           { icon:'pie-chart',      label:'KPI cards',                   description:'Portfolio value, monthly rent, arrears, and other key metrics' },
    by_company:         { icon:'grid',           label:'By Company',                  description:'A card per company with its property/rent stats' },
    smart_alerts:       { icon:'alert-triangle', label:'Items needing attention',     description:'Smart alerts: overdue rent, expiring compliance, vacant properties' },
    tenant_inbox:       { icon:'inbox',          label:'Tenant Inbox',                description:'Latest messages and repair requests from tenants' },
    portfolio_insights: { icon:'sparkle',        label:'AI Portfolio Insights',       description:'Observations and opportunities generated by Claude (refreshable every 30 min)' },
    autopilot_widget:   { icon:'robot',          label:'Portfolio Autopilot',         description:'AI-drafted prioritised actions across your portfolio' },
    property_map:       { icon:'map',            label:'Property Map',                description:'Compact map showing all your properties' },
    portfolio_modeller: { icon:'trending-up',    label:'Portfolio What-If Modeller',  description:'Model rent changes, refinancing, and other scenarios' },
    company_documents:  { icon:'folder',         label:'Company Documents',           description:'Documents stored at company level (only shows when a company is selected)' },
  }
  // The KPI grid leads the default layout (2026-10: the headline numbers
  // were sixth, below alerts, inbox and AI widgets), with Rental Income
  // straight after it. Only the DEFAULT changes: a saved layout
  // (user_profiles.dashboard_sections) keeps its own order, and the resolver
  // slots any section it lacks in after its nearest default predecessor, so
  // a layout saved before Rental Income existed gets it just below the KPIs.
  const SECTION_DEFAULT_ORDER   = ['kpi_grid','rent_income','smart_alerts','autopilot_widget','tenant_inbox','portfolio_insights','by_company','property_map','portfolio_modeller','company_documents']
  const SECTION_DEFAULT_ENABLED = { rent_income:true, kpi_grid:true, by_company:true, smart_alerts:true, autopilot_widget:true, tenant_inbox:true, portfolio_insights:true, property_map:true, portfolio_modeller:false, company_documents:true }

  const WIDGET_META = {
    portfolio_value:    { icon:'home', label:'Portfolio Value',         description:'Total property value and unrealised gains' },
    monthly_rent:       { icon:'pound', label:'Monthly Rental Income',   description:'Rent expected this month from tenancies, contracted and annualised totals, next month ahead' },
    rent_received:      { icon:'receipt', label:'Rent Collected',         description:'Compact due / collected / outstanding table for the last three months and year to date (the Rental Income section shows this in full)' },
    arrears:          { icon:'alert-triangle', label:'Total Arrears',           description:'Overdue rent and vacant properties' },
    refurb:             { icon:'hammer', label:'In Refurbishment',        description:'Properties under renovation' },
    mortgages:          { icon:'landmark', label:'Mortgages Outstanding',   description:'Debt, equity and repayment costs' },
    cashflow_forecast:  { icon:'wallet', label:'Cash Committed', description:'Total cash out across deals + properties, with 90-day urgency split' },
    insurance_renewals: { icon:'shield-check', label:'Insurance Renewals',      description:'Policies expiring soon with annual premium totals' },
    compliance_status:  { icon:'clipboard-check', label:'Portfolio Compliance', description:'Certificates, licences and paperwork in date across the portfolio' },
    property_count:     { icon:'home', label:'Property Count',          description:'Total properties with rented/vacant split' },
    occupancy_rate:     { icon:'pie-chart', label:'Occupancy Rate',          description:'Occupancy % and vacancy cost' },
  }
  const WIDGET_DEFAULT_ORDER   = ['portfolio_value','monthly_rent','rent_received','arrears','refurb','mortgages','cashflow_forecast','insurance_renewals','compliance_status','property_count','occupancy_rate']
  // rent_received is off by default now that the Rental Income section carries
  // the same figures in full; it stays available for anyone who hides the section.
  const WIDGET_DEFAULT_ENABLED = { portfolio_value:true, monthly_rent:true, rent_received:false, arrears:true, refurb:true, mortgages:true, cashflow_forecast:true, insurance_renewals:true, compliance_status:true, property_count:false, occupancy_rate:false }

  // Developer mode toggle — lets a platform admin choose to "see everything"
  // (bypasses per-company permissions). Default OFF on every login: more
  // accurate preview of what a regular user sees, and avoids accidental
  // data exposure if the admin is screen-sharing.
  //
  // Persistence: stored in sessionStorage, OPT-IN. The flag records when
  // the user explicitly turned dev mode ON. Closing the tab / new login
  // clears it. (Previously this was inverted — default ON, opt-out — which
  // surprised admins on every login.)
  const [devModeEnabled, setDevModeEnabledState] = useState(() => {
    try { return sessionStorage.getItem('ownproperly_dev_mode_on') === '1' } catch(e) { return false }
  })
  const setDevModeEnabled = (v) => {
    try {
      if (v) sessionStorage.setItem('ownproperly_dev_mode_on', '1')
      else sessionStorage.removeItem('ownproperly_dev_mode_on')
    } catch(e) {}
    setDevModeEnabledState(v)
  }
  // Backwards-compat aliases for any code still using the old names —
  // these export the inverted semantics so callers don't need updating.
  const devModeDisabled = !devModeEnabled
  const setDevModeDisabled = (v) => setDevModeEnabled(!v)
  // Effective "see everything" flag — true ONLY when platform admin has
  // explicitly opted into dev mode for this session.
  const devModeActive = isPlatformAdmin && devModeEnabled
  // Per-company permission map: { [companyId]: { view_rent: true, edit_financial: false, ... } }
  const [permissionsMap, setPermissionsMap] = useState({})
  // Active feature flags for current user
  const [activeFlags, setActiveFlags] = useState(new Set())
  // Impersonation: when set, platform admin sees the app filtered to this user's data (read-only)
  const [impersonatingUser, setImpersonatingUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('ownproperly_impersonate') || 'null') } catch(e) { return null }
  })
  const [userNavPrefs, setUserNavPrefs] = useState(DEFAULT_NAV_KEYS)
  // Tenant-portal branding for the current subdomain (<sub>.ownproperly.com).
  // Looked up once on mount via a public RPC so a logged-OUT visitor sees the
  // company's branded login instead of the generic marketing site. null = no
  // subdomain / unknown company → fall back to marketing.
  const [portalBranding, setPortalBranding] = useState(null)
  useEffect(() => {
    const sub = getSubdomain()
    if (!sub) return
    let cancelled = false
    api.fetchCompanyBySubdomain(sub)
      .then(b => { if (!cancelled && b && b.tenant_portal_enabled !== false) setPortalBranding(b) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  // 'individual' | 'limited_company' | 'mixed' | null. Drives feature visibility —
  // limited_company users don't see MTD ITSA (they file Corp Tax, not Self Assessment).
  const [accountType, setAccountType] = useState(null)
  const [yieldBasis, setYieldBasis]      = useState('cost') // 'cost' = purchase+refurb, 'value' = current value
  // Invite emails link to /?invite=<token>. A logged-out visitor must land
  // straight in the signup modal (LoginPage reads the param itself and
  // redeems after auth), without this they just see the marketing page and
  // the invite goes nowhere.
  // initialLoginMode: Root (src/Root.jsx) only loads App once a marketing
  // visitor clicks Sign in / Sign up, so open the modal they asked for.
  const [showLoginModal, setShowLoginModal] = useState(() => !!initialLoginMode || new URLSearchParams(window.location.search).has('invite'))
  const [loginMode, setLoginMode] = useState(() => initialLoginMode || (new URLSearchParams(window.location.search).has('invite') ? 'signup' : 'login'))
  const [trialWarning, setTrialWarning] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [announcements, setAnnouncements] = useState([])
  const [dismissedAnns, setDismissedAnns] = useState(() => { try { return JSON.parse(localStorage.getItem('dismissed_anns')||'[]') } catch(e) { return [] } })
  const { T, darkMode, setDarkMode, loadUserTheme } = useTheme()

  const isMobile = useIsMobile(769)
  const [showDrawer, setShowDrawer] = useState(false)
  // Desktop left-rail collapse (redesign app shell). Snap between 212/68px —
  // do NOT CSS-transition width (caused a stuck-transition bug per the handoff);
  // only the label opacity fades. Mobile keeps the bottom tab bar (rail hidden).
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem('ef_rail_collapsed') === 'true' } catch(e) { return false }
  })
  useEffect(() => { try { localStorage.setItem('ef_rail_collapsed', String(railCollapsed)) } catch(e) {} }, [railCollapsed])
  const railWidth = isMobile ? 0 : (railCollapsed ? 68 : 212)
  const [userAccess,  setUserAccess]  = useState([])  // company_ids this user can see

  useEffect(()=>{
    const handler = () => setShowTour(true)
    window.addEventListener('ownproperly:restart-tour', handler)
    return () => window.removeEventListener('ownproperly:restart-tour', handler)
  }, [])

  // Last place we synced to the URL — used to decide pushState vs
  // replaceState (see the sync effect below).
  const lastSyncedNav = useRef(null)

  // ── BROWSER HISTORY INTEGRATION ────────────────────────────────────────────
  // URLs map to state:
  //   #/dashboard                         → view=dashboard
  //   #/properties                        → view=properties, portfolioTab=properties
  //   #/properties/companies              → view=properties, portfolioTab=companies
  //   #/rent                              → view=rent
  //   #/rent/day                          → view=daytracker
  //   #/detail/<id>                       → view=detail, selectedId=<id>
  //   #/detail/<id>/<tab>                 → view=detail, selectedId=<id>, detailTab=<tab>
  //   #/settings                          → view=settings
  //   #/settings/<tab>                    → view=settings, settingsTab=<tab>
  //   #/admin/<tab>                       → open admin on a specific tab
  //   #/<anything-else>                   → view=<anything-else>
  useEffect(() => {
    const parseHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '')
      if (!h) return { view: 'dashboard' }
      // Hash segments come back percent-encoded from window.location.hash
      // (e.g. a legacy '#/detail/<id>/epc%20plan' bookmark), so decode each
      // part before matching. Legacy space-keyed tabs map onto their slugs.
      const parts = h.split('/').filter(Boolean).map(p => {
        try { return decodeURIComponent(p) } catch { return p }
      })
      const LEGACY_TABS = { 'epc plan': 'epc-plan', 'right to rent': 'right-to-rent', 'rent history': 'rent-history' }
      if (parts[0] === 'detail' && parts[1]) {
        const rawTab = parts[2] || 'overview'
        return { view: 'detail', selectedId: parts[1], detailTab: LEGACY_TABS[rawTab] || rawTab }
      }
      if (parts[0] === 'settings') {
        return { view: 'settings', settingsTab: parts[1] || null }
      }
      if (parts[0] === 'admin') {
        return { view: 'admin', adminTab: parts[1] || null }
      }
      // #/import and the emailed-statement link #/import?docs=a,b (legacy #/import-statement)
      if (/^import(-statement)?(\?|$)/.test(parts[0] || '')) {
        const q = new URLSearchParams(parts[0].split('?')[1] || '')
        return { view: 'import', importDocs: (q.get('docs') || '').split(',').filter(Boolean) }
      }
      if (parts[0] === 'import-data') return { view: 'import-data' }
      if (parts[0] === 'statement-audit') return { view: 'statement-audit' }
      if (parts[0] === 'properties' && parts[1] === 'bulk') return { view: 'bulk-add' }
      // Compliance is the renamed top-level Insurance page (2026-08).
      // Sub-views are addressable (#/compliance/<sub>); the legacy
      // '#/insurance' route and the old Portfolio → Compliance sub-tab both
      // fold into it so old bookmarks and notification links keep working.
      if (parts[0] === 'compliance') return { view: 'compliance', complianceTab: parts[1] || null }
      if (parts[0] === 'insurance')  return { view: 'compliance', complianceTab: 'insurance' }
      if (parts[0] === 'properties' && parts[1] === 'compliance') return { view: 'compliance' }
      // All portfolio sub-tabs are addressable: #/properties/<tab>
      const PORTFOLIO_TABS = ['properties','companies','map','contractors']
      if (parts[0] === 'properties') {
        return { view: 'properties', portfolioTab: PORTFOLIO_TABS.includes(parts[1]) ? parts[1] : 'properties' }
      }
      // Legacy top-level views, folded into Portfolio sub-tabs (they used
      // to exist twice at two different levels).
      if (parts[0] === 'companies')   return { view: 'properties', portfolioTab: 'companies' }
      if (parts[0] === 'contractors') return { view: 'properties', portfolioTab: 'contractors' }
      if (parts[0] === 'rent' && parts[1] === 'day') {
        return { view: 'daytracker' }
      }
      // /reports                — catalogue
      // /reports/<reportId>     — drilled into a specific report
      if (parts[0] === 'reports' && parts[1]) {
        return { view: 'reports', selectedReportId: parts[1] }
      }
      // Unknown hashes (e.g. a stray #pricing from a marketing/blog link
      // opened while signed in) must not become a view — an unmatched view
      // key renders an empty main area. Fall back to the dashboard.
      const KNOWN_VIEWS = ['dashboard','properties','rent','stl','deals','refurbs','loans','compliance','reports','mtd','autopilot','renters-rights','settings','daytracker','feedback','detail','import','import-data','statement-audit']
      return { view: KNOWN_VIEWS.includes(parts[0]) ? parts[0] : 'dashboard' }
    }

    // Restore on first load
    const initial = parseHash()
    if (initial.view && initial.view !== 'dashboard') setView(initial.view === 'admin' ? 'dashboard' : initial.view)
    if (initial.selectedId) setSelectedId(initial.selectedId)
    if (initial.importDocs?.length) setImportDocs(initial.importDocs)
    if (initial.detailTab) setDetailTab(initial.detailTab)
    if (initial.portfolioTab) setPortfolioTab(initial.portfolioTab)
    if (initial.selectedReportId) setSelectedReportId(initial.selectedReportId)
    if (initial.view === 'admin') {
      setShowAdmin(true)
      if (initial.adminTab) window.dispatchEvent(new CustomEvent('ownproperly:set-admin-tab', { detail: { tab: initial.adminTab } }))
    }
    if (initial.settingsTab) window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab: initial.settingsTab } }))
    // (CompliancePage reads its initial sub-view from the hash at mount, so
    // no event needed on first load — only on later hash navigations below.)

    // Listen for browser back/forward
    const handlePopState = () => {
      const parsed = parseHash()
      if (parsed.view === 'admin') {
        setShowAdmin(true)
        if (parsed.adminTab) window.dispatchEvent(new CustomEvent('ownproperly:set-admin-tab', { detail: { tab: parsed.adminTab } }))
        return
      }
      setShowAdmin(false)
      setView(parsed.view || 'dashboard')
      setSelectedId(parsed.selectedId || null)
      setImportDocs(parsed.importDocs?.length ? parsed.importDocs : null)
      // Always reflect the report id from the URL (including clearing it
      // when the user pops back from a specific report to the catalogue).
      setSelectedReportId(parsed.selectedReportId || null)
      if (parsed.detailTab) setDetailTab(parsed.detailTab)
      // Always reflect the portfolio sub-tab when on the portfolio view —
      // popping back from #/properties/companies to #/properties must reset
      // the tab, not leave it stale.
      if (parsed.view === 'properties') setPortfolioTab(parsed.portfolioTab || 'properties')
      if (parsed.settingsTab) window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab: parsed.settingsTab } }))
      // Mounted CompliancePage tracks its sub-view from this event (e.g. a
      // dashboard widget navigating #/compliance → #/compliance/insurance).
      if (parsed.complianceTab) window.dispatchEvent(new CustomEvent('ownproperly:set-compliance-tab', { detail: { tab: parsed.complianceTab } }))
    }
    window.addEventListener('popstate', handlePopState)
    // Programmatic `window.location.hash = …` navigations (notification
    // links, insight actions, the error boundary's "go home") fire
    // `hashchange`, NOT `popstate` — without this listener they change the
    // URL but never the screen, and the sync effect then rewrites the URL
    // back to the stale view.
    window.addEventListener('hashchange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
    }
  }, [])

  // Sync to URL whenever navigation state changes
  useEffect(() => {
    if (!user) return
    // The admin overlay owns #/admin/<tab> (AdminDashboard pushes it) —
    // don't fight it by rewriting the hash back to the underlying view.
    if (showAdmin) return
    // Leaving the reports view? Drop any selected report id so we don't
    // carry stale state into the next visit.
    if (view !== 'reports' && selectedReportId) {
      setSelectedReportId(null)
      return  // re-trigger this effect with the cleared id
    }
    let target = `#/${view}`
    if (view === 'detail' && selectedId) {
      target = `#/detail/${selectedId}`
      if (detailTab && detailTab !== 'overview') target += `/${detailTab}`
    } else if (view === 'properties' && portfolioTab && portfolioTab !== 'properties') {
      target = `#/properties/${portfolioTab}`
    } else if (view === 'daytracker') {
      target = '#/rent/day'
    } else if (view === 'bulk-add') {
      target = '#/properties/bulk'
    } else if (view === 'reports' && selectedReportId) {
      // When drilled into a specific report, encode its id so browser
      // back returns to the catalogue (the bare /reports URL).
      target = `#/reports/${selectedReportId}`
    }
    // SettingsPage owns its sub-tab URL segment (#/settings/<tab>): it pushes
    // the hash itself on tab change, and — being lazy-loaded — reads its
    // INITIAL tab from the hash at mount. If the hash already carries a
    // settings sub-tab, leave it alone. Pushing the bare '#/settings' here
    // would race the Suspense fallback on a cold chunk load and clobber the
    // sub-tab (e.g. the upgrade CTA's '#/settings/billing') before
    // SettingsPage mounts, landing the user on the Account tab instead.
    if (view === 'settings' && /^#\/settings(\/|$)/.test(window.location.hash)) return
    // CompliancePage owns its sub-view URL segment the same way
    // (#/compliance/matrix, #/compliance/insurance).
    if (view === 'compliance' && /^#\/compliance(\/|$)/.test(window.location.hash)) return
    // DealsPage owns its sub-view / deal-detail URL segments the same way
    // (#/deals/pipeline, #/deals/deal/<id>).
    if (view === 'deals' && /^#\/deals(\/|$)/.test(window.location.hash)) return
    // RefurbsPage owns #/refurbs/list|board|payments and #/refurbs/project/<id>.
    if (view === 'refurbs' && /^#\/refurbs(\/|$)/.test(window.location.hash)) return
    // ExternalLoansPage owns #/loans/new and #/loans/<id>.
    if (view === 'loans' && /^#\/loans(\/|$)/.test(window.location.hash)) return
    if (window.location.hash !== target) {
      // Push a history entry only when the *place* changes (view, property,
      // report). Intra-page tab flips (detailTab, portfolioTab) REPLACE the
      // current entry — otherwise browsing a property's 9 tabs means
      // pressing Back 9 times to leave it.
      const prev = lastSyncedNav.current
      const placeChanged = !prev || prev.view !== view || prev.selectedId !== selectedId || prev.selectedReportId !== selectedReportId
      const historyState = { view, selectedId, detailTab, portfolioTab, selectedReportId }
      if (placeChanged) window.history.pushState(historyState, '', target)
      else window.history.replaceState(historyState, '', target)
    }
    lastSyncedNav.current = { view, selectedId, selectedReportId }
  // user.id only — see the note on the loadData useEffect below for why.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedId, detailTab, portfolioTab, selectedReportId, user?.id, showAdmin])

  // A deep link can name a detail tab this property/account doesn't have
  // (feature toggled off, non-HMO 'rooms', no 'epc-plan' flag). The strip
  // wouldn't show the tab, so the content pane rendered empty — clamp back
  // to Overview instead.
  useEffect(() => {
    if (view !== 'detail' || !selectedId) return
    const sel = properties.find(p => p.id === selectedId)
    if (!sel) return
    const cs = companySettings[sel.company_id] || {}
    const eligibility = {
      compliance: cs.feature_compliance, maintenance: cs.feature_maintenance,
      documents: cs.feature_documents, expenses: cs.feature_expenses,
      tenancy: cs.feature_tenancy, 'right-to-rent': cs.feature_tenancy,
      deposit: cs.feature_tenancy, notices: cs.feature_tenancy, 'rent-history': cs.feature_tenancy,
      rooms: sel.is_hmo || activeFlags.has('hmo_rooms'),
      'epc-plan': activeFlags.has('epc_planner'),
    }
    if (detailTab in eligibility && !eligibility[detailTab]) setDetailTab('overview')
  }, [view, selectedId, detailTab, properties, companySettings, activeFlags])

  // Per-view document titles so history entries, bookmarks and the browser
  // tab strip are tellable apart (index.html's marketing title otherwise
  // labels every page identically). Signed-in sessions only: hooks run
  // before the auth early-returns, so without the guard the logged-out
  // marketing page was titled "Dashboard · Properly" instead of the SEO
  // title. Restored on sign-out via the user-flip + cleanup.
  const titleName = view === 'detail' ? (properties.find(p => p.id === selectedId)?.name || null) : null
  useEffect(() => {
    const MARKETING_TITLE = 'Properly — Property Portfolio Management Software for UK Landlords'
    if (!user) { document.title = MARKETING_TITLE; return }
    const label = titleName || VIEW_LABELS[view] || null
    document.title = label ? `${label} · Properly` : MARKETING_TITLE
    return () => { document.title = MARKETING_TITLE }
  }, [view, titleName, user])

  useEffect(()=>{
    if (!user) return
    // Stale-response guard: a newer run (user switch, Retry, StrictMode
    // double-invoke) flips `cancelled` on the previous one, which then bails
    // at its next await instead of writing another user's / an older load's
    // data over the current one. Bumping loadGenRef also discards any
    // refreshData still in flight from before this load.
    let cancelled = false
    loadGenRef.current += 1
    const live = () => !cancelled
    const ifLive = (fn) => (v) => { if (live()) fn(v) }
    async function loadData() {
      setLoading(true)
      setLoadError(null)
      try {
        // Redeem any invite BEFORE fetching access rows, so the granted
        // companies appear in this very load (no reload needed). Two sources:
        //  - ?invite=<token> in the URL, when an already-logged-in user clicked
        //    an invite email link (logged-out users get the signup modal,
        //    which redeems via LoginPage instead).
        //  - pending_invite_token stashed at signup (email-confirmation flow).
        // Clear both regardless of outcome so we don't retry a bad token forever.
        try {
          const inviteParam = new URLSearchParams(window.location.search).get('invite')
          const pending = localStorage.getItem('pending_invite_token') || inviteParam
          if (pending) {
            const isCode = looksLikeCompanyInviteCode(pending)
            try {
              if (isCode) {
                const result = await api.redeemCompanyInvite(pending)
                showToast(`Joined ${result?.company_name || 'company'} ✓`)
              } else {
                await api.acceptInvitation(pending)
                showToast('Invitation accepted ✓')
              }
            } catch(e) {
              if (e.message) showToast(e.message, 'error')
            }
            localStorage.removeItem('pending_invite_token')
            if (inviteParam) window.history.replaceState({}, '', window.location.pathname)
          }
        } catch(e) { /* non-fatal */ }
        // One user_profiles read serves the developer flag AND nav/yield/
        // account prefs (previously three separate selects of the same row).
        const [cos, props, accessById, accessByEmail, prof] = await Promise.all([
          api.fetchCompanies(),
          api.fetchProperties(),
          api.fetchUserAccess(user.id),
          api.fetchUserAccessByEmail(user.email),
          supabase.from('user_profiles')
            .select('is_developer, platform_admin, nav_items, yield_basis, account_type')
            .eq('user_id', user.id).single()
            .then(r => r.data).catch(() => null),
        ])
        if (!live()) return
        // The signup form's profile upsert runs before email confirmation,
        // with no session, so RLS rejects it and confirmed users arrive with
        // no user_profiles row (whitneykolubayev, Sept 2026). Create it on
        // first boot from the signup metadata. Insert-only: never overwrites.
        if (!prof) {
          const md = user.user_metadata || {}
          supabase.from('user_profiles').upsert({
            user_id: user.id, email: user.email,
            full_name: md.full_name || null, first_name: md.first_name || null,
            last_name: md.last_name || null, phone: md.phone || null,
          }, { onConflict: 'user_id', ignoreDuplicates: true })
            .then(({ error }) => { if (error) logError('loadData:ensureProfile', error) })
        }
        // Load deals separately and non-blocking — if it fails, the
        // dashboard widget falls back to "no data". Deals are not critical
        // to App boot.
        api.fetchDeals(user.id).then(ifLive(setDashboardDeals)).catch(ifLive(()=>setDashboardDeals([])))
        // Load insurance policies for the dashboard widget. Non-blocking.
        api.fetchInsurancePolicies().then(ifLive(setInsurancePolicies)).catch(ifLive(()=>setInsurancePolicies([])))
        // Merge access by ID and by email
        const allAccess = [...accessById, ...accessByEmail.filter(a=>!accessById.find(b=>b.company_id===a.company_id))]
        // If user was found by email but not ID, update their user_id
        if (accessByEmail.length > 0 && accessById.length === 0) {
          await api.updateUserIdByEmail(user.email, user.id)
          if (!live()) return
        }
        const access = allAccess
        const accessIds = access.map(a=>a.company_id)
        // "isAdmin" here means "can see data for their companies" — NOT "can see all companies"
        // Only platform_admin should bypass filtering (handled separately below)
        const ownedCompanies = cos.filter(c => c.owner_id === user.id)
        const ownedIds = ownedCompanies.map(c => c.id)
        // A user has access to companies they own OR have been granted access to
        const isAdminUser = access.some(a=>a.is_admin || a.is_owner) || ownedCompanies.length > 0
        setIsAdmin(isAdminUser)
        setUserAccess(accessIds)

        // Developer status comes from the profile row fetched above —
        // developers see everything (site owner / devs only). Accept either
        // is_developer (new) or platform_admin (legacy) for backwards compat.
        const isPlatformAdminFlag = prof?.is_developer === true || prof?.platform_admin === true
        setIsPlatformAdmin(isPlatformAdminFlag)
        // Nav / yield / account prefs from the same row.
        // Stored prefs may predate the Insurance → Compliance rename (2026-08);
        // map the old key so nobody loses the entry from their rail.
        if (prof?.nav_items && prof.nav_items.length > 0) {
          let prefs = prof.nav_items.map(k => k === 'insurance' ? 'compliance' : k)
          // Items introduced after this account saved its list (e.g. Refurbs,
          // 2026-09) appear once automatically, with a seen-marker so a later
          // opt-out sticks. Persisted best-effort; the rail updates regardless.
          const missing = AUTO_ENABLE_NAV_KEYS.filter(k => !prefs.includes(k) && !prefs.includes(navSeenMarker(k)))
          if (missing.length > 0) {
            prefs = [...prefs, ...missing, ...missing.map(navSeenMarker)]
            supabase.from('user_profiles').update({ nav_items: prefs, updated_at: new Date().toISOString() }).eq('user_id', user.id)
              .then(({ error }) => { if (error) console.error('nav auto-enable persist failed', error) })
          }
          setUserNavPrefs(prefs)
        }
        else setUserNavPrefs(DEFAULT_NAV_KEYS)
        if (prof?.yield_basis) setYieldBasis(prof.yield_basis)
        setAccountType(prof?.account_type || null)

        // Everything below is independent — one parallel batch instead of a
        // serial waterfall: permissions/flags/widgets, theme, announcements,
        // onboarding status, tenant detection and the user's own companies.
        const devActiveEarly = isPlatformAdminFlag && !devModeDisabled
        const [permBatch, , anns, onboarded, prefetchedTenantRows, myCompanies] = await Promise.all([
          Promise.all([
            api.fetchMyPermissionsMap(devActiveEarly),
            api.fetchMyActiveFlags().catch(()=>new Set()),
            api.fetchWidgetPrefs().catch(()=>null),
            api.fetchSectionPrefs().catch(()=>null),
          ]).catch(e => { logError('loadData:permissions+flags', e); return null }),
          loadUserTheme(user.id, user.email).catch(()=>{}),
          api.fetchAnnouncements().catch(e => { logError('loadData:announcements', e); return [] }),
          api.fetchOnboardingStatus(user.id).catch(()=>true),
          api.checkIsTenant(user.id).catch(e => { logError('loadData:tenantDetection', e); return [] }),
          api.fetchMyCompanies().catch(()=>[]),
        ])
        if (!live()) return
        if (permBatch) {
          const [permMap, flags, widgets, sections] = permBatch
          // Stamp an __owner map onto permissionsMap so canDo() can grant
          // implicit allow to the company owner without having to look up
          // ownership in every check site. (Owners typically don't have a
          // user_company_access row at all.)
          const ownerMap = {}
          for (const id of ownedIds) ownerMap[id] = true
          setPermissionsMap({ ...(permMap || {}), __owner: ownerMap })
          setActiveFlags(flags)
          setWidgetPrefs(widgets)
          // Section order lives on the profile. Older saves exist only in this
          // browser's localStorage: adopt one and copy it up once.
          if (sections) setSectionPrefs(sections)
          else {
            try {
              const raw = localStorage.getItem(`ownproperly_section_prefs_${user.id}`)
              const local = raw ? JSON.parse(raw) : null
              if (Array.isArray(local) && local.length) {
                setSectionPrefs(local)
                api.saveSectionPrefs(local).catch(e => logError('saveSectionPrefs:migrate', e))
              }
            } catch(e) { /* non-fatal — fall back to defaults */ }
          }
        }
        setAnnouncements(anns)
        if (!onboarded) setShowTour(true)

        // (Invite redemption ran at the top of loadData, before the access
        // fetches, so any newly granted companies are already in scope.)
        // (Theme, nav prefs, announcements and onboarding status are loaded
        // in the parallel batch above.)
        // Build the set of company IDs this user has access to
        // = owned + shared-access rows
        const accessibleCompanyIds = new Set([...ownedIds, ...accessIds])

        // Check if developer mode is currently active (dev flag + toggle not disabled)
        const devActive = isPlatformAdminFlag && !devModeDisabled

        // Filter companies and properties:
        //   - Developers in active mode see EVERYTHING
        //   - Regular users (and devs who toggled dev mode off) see only companies they own or have shared access to
        let visibleCos = devActive ? cos : cos.filter(c => accessibleCompanyIds.has(c.id))
        let visibleProps = devActive ? props : props.filter(p => accessibleCompanyIds.has(p.company_id))

        // If impersonating, filter everything to only that user's data
        if (impersonatingUser) {
          try {
            const [targetAccess, targetAccessEmail] = await Promise.all([
              api.fetchUserAccess(impersonatingUser.id),
              api.fetchUserAccessByEmail(impersonatingUser.email)
            ])
            if (!live()) return
            const targetCompanyIds = new Set([
              ...cos.filter(c => c.owner_id === impersonatingUser.id).map(c => c.id),
              ...targetAccess.map(a => a.company_id),
              ...targetAccessEmail.map(a => a.company_id),
            ])
            visibleProps = props.filter(p => targetCompanyIds.has(p.company_id))
            // Until 2026-09-08 only the properties were filtered, so the
            // company chips, the By Company cards and the "N companies"
            // summary still showed every company the admin could see, each
            // with zero properties, next to the impersonated user's data.
            visibleCos = cos.filter(c => targetCompanyIds.has(c.id))
          } catch(e) { console.error('Impersonation filter failed', e) }
        }
        // ─── Suspended-company access control ────────────────────────────
        // If a company the user has access to (as collaborator) is
        // suspended (owner stopped paying, trial expired, no free-tier
        // grant), hide it from the collaborator's view. This is the
        // "if Justin stops paying, Alex loses access to ExH too" rule.
        //
        // Owners always see their own companies regardless of state —
        // they need to see them in order to pay (the gate shows pay
        // buttons). Platform admins / devs also bypass.
        //
        // We need subscriptions to make this decision. Fetch them
        // synchronously here so the filter is applied before the UI
        // sees `companies`. (The later best-effort fetch below stays
        // as a safety net for race-condition-free re-renders.)
        let initialSubs = []
        let settingsRows = null
        if (visibleCos.length > 0) {
          const coIds = visibleCos.map(c => c.id)
          // Subscriptions (needed for the suspension filter below) and
          // company settings (one .in() query instead of a request per
          // company) are independent — fetch together.
          ;[initialSubs, settingsRows] = await Promise.all([
            api.fetchSubscriptions(coIds).catch(() => []),
            supabase.from('company_settings').select('*').in('company_id', coIds)
              .then(r => r.data).catch(() => null),
          ])
          if (!live()) return
        }
        // Track companies we hide due to suspension so we can show the
        // collaborator a clear banner ("your account owner hasn't paid")
        // instead of the onboarding wizard, which would be misleading.
        let suspendedCollabCos = []
        if (!devActive) {
          const subByCo = new Map(initialSubs.map(s => [s.company_id, s]))
          const isCompanyLive = (c) => {
            // Owner always sees the company (so they can pay if needed).
            if (c.owner_id === user.id) return true
            // Free tier — always live (admin granted).
            if (c.is_free_tier) return true
            const sub = subByCo.get(c.id)
            // Paid OR in stripe-side trial OR grace-period past_due → live.
            if (sub && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due')) return true
            // Otherwise live only while in-app trial hasn't expired yet.
            const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : 0
            return trialEnd > Date.now()
          }
          suspendedCollabCos = visibleCos.filter(c => c.owner_id !== user.id && !isCompanyLive(c))
          visibleCos = visibleCos.filter(isCompanyLive)
          // Enrich suspended companies with the account owner's email so
          // the banner can show who to contact. Best-effort — if RLS
          // blocks the user_profiles read, the banner falls back to a
          // generic "your account owner" label.
          if (suspendedCollabCos.length > 0) {
            try {
              const ownerIds = [...new Set(suspendedCollabCos.map(c => c.owner_id).filter(Boolean))]
              const { data: profiles } = await supabase
                .from('user_profiles').select('user_id, email').in('user_id', ownerIds)
              if (!live()) return
              const emailById = {}
              for (const p of (profiles || [])) emailById[p.user_id] = p.email
              suspendedCollabCos = suspendedCollabCos.map(c => ({ ...c, owner_email: emailById[c.owner_id] || null }))
            } catch (e) { /* fall back to generic label */ }
          }
          // Also drop any properties whose company we just hid — so the
          // dashboard / reports / etc. don't surface data the user can
          // no longer access.
          const liveIds = new Set(visibleCos.map(c => c.id))
          visibleProps = visibleProps.filter(p => liveIds.has(p.company_id))
        }
        setCompanies(visibleCos)
        setCompanySubs(initialSubs)
        setProperties(visibleProps)
        setSuspendedAccess(suspendedCollabCos)
        if(visibleCos.length>0) setActiveCoTab(visibleCos[0].id)
        // Onboarding fires ONLY for genuinely new users (no companies anywhere).
        // Collaborators whose only access just got suspended see the
        // SuspendedAccessBanner instead — much clearer than asking them
        // to create a company they don't want.
        if (visibleCos.length === 0 && suspendedCollabCos.length === 0) {
          setShowOnboarding(true)
        }
        // Drop trial-expiring notifications into the bell (deduped daily
        // per company via localStorage). Fire-and-forget; failure is fine.
        api.maybeWarnTrialsExpiring(visibleCos).catch(() => {})
        // Same for compliance — fetch all compliance items for this user
        // and surface expired / soon-to-expire ones in the bell. This was
        // the biggest gap in the notification surface: zero rows despite
        // 90 occupied properties having no compliance tracking. Now any
        // compliance row whose expiry is within 60 days fires one notif
        // per item per day until renewed.
        api.fetchAllComplianceItems(user.id)
          .then(items => api.maybeWarnComplianceExpiring(items))
          .catch(() => {})
        // Mortgage product-end warnings: fires at 90 / 60 / 30 days
        // before each property's fixed/tracker rate expires. Same
        // dedup pattern as compliance. Lendlord-style "remortgage now"
        // nudge — biggest revenue lever once paired with a broker
        // referral partnership (£200-500/deal). Future work: add a
        // "Compare rates" CTA on the notification.
        api.maybeWarnMortgageExpiring(visibleProps).catch(() => {})
        // (Subscriptions already loaded above as part of the suspended-
        // company access filter. No need to re-fetch here.)
        // Check for tenant invite link param. Registration is bound to a
        // landlord-issued single-use token (redeemed via SECURITY DEFINER
        // RPC); legacy raw `?tenant_property=<uuid>` links are no longer
        // honoured — the DB blocks the old direct insert.
        const urlParams = new URLSearchParams(window.location.search)
        const tenantInviteToken = urlParams.get('tenant_invite')
        let tenantRows = prefetchedTenantRows
        if (tenantInviteToken) {
          try {
            await api.registerTenantProfile(user.id, null, tenantInviteToken)
            window.history.replaceState({}, '', window.location.pathname)
            // Re-check: the redemption may have just created this user's
            // first tenant_profiles row.
            tenantRows = await api.checkIsTenant(user.id)
          } catch(e) { logError('loadData:registerTenantProfile', e) }
          if (!live()) return
        } else if (urlParams.get('tenant_property')) {
          window.history.replaceState({}, '', window.location.pathname)
        }
        // Plaid Link runs in-page (no redirect handoff) — the OAuth
        // exchange happens inside BankConnectionsModal via onSuccess.
        // We still clean up any legacy `?bank_callback=1` URL params
        // from the old TrueLayer redirect flow so bookmarks don't break.
        if (urlParams.get('bank_callback') === '1') {
          window.history.replaceState({}, '', window.location.pathname)
        }
        // Check if this user is a tenant (not a landlord) — rows prefetched
        // in the parallel batch above (re-fetched after invite redemption).
        // Skip tenant portal if user has their own companies or is platform admin.
        const isLandlord = myCompanies.length > 0 || devActive
        if (tenantRows.length > 0 && !isLandlord) { setIsTenant(true); return }
        // Auto-generate future rent months silently in background
        api.ensureFutureRentMonths(visibleProps, 6).then(count=>{
          if(count>0){
            api.fetchProperties().then(refreshed=>{
              if (!live()) return
              const vis = devActive ? refreshed : refreshed.filter(p=>accessibleCompanyIds.has(p.company_id))
              setProperties(vis)
            }).catch(e => logError('loadData:refreshAfterRentMonths', e))
          }
        }).catch(e => logError('loadData:ensureFutureRentMonths', e))
        // Company settings — fetched in bulk alongside subscriptions above.
        const settingsMap = {}
        const settingsById = new Map((settingsRows || []).map(s => [s.company_id, s]))
        visibleCos.forEach(c => {
          settingsMap[c.id] = settingsById.get(c.id) || {
            feature_compliance:true, feature_tenancy:true,
            feature_maintenance:true, feature_documents:true,
            feature_expenses:true, feature_reports:true
          }
        })
        setCompanySettings(settingsMap)
        // Tenancy rows for HealthBadge's tenancy-end deduction — best-effort,
        // non-blocking (an empty map just means no deduction is applied).
        api.fetchAllTenancies(user.id).then(rows => {
          if (!live()) return
          const byProp = {}
          for (const t of (rows || [])) if (t.property_id) byProp[t.property_id] = t
          setTenanciesByProp(byProp)
        }).catch(e => logError('loadData:fetchAllTenancies', e))
      } catch(e) {
        if (!live()) return
        // Data load failed — DO NOT fall back to showing everything, and do
        // NOT let the dashboard render the new-account welcome zero-state
        // for a paying customer with a transient network error. The render
        // path shows a dedicated error screen with a Retry button.
        logError('loadData', e)
        setLoadError(e?.message || 'Something went wrong loading your portfolio')
        setCompanies([])
        setProperties([])
        setIsAdmin(false)
      } finally {
        if (live()) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
    // Use user.id (stable across token refreshes), not the user object
    // (which gets a new reference on every supabase TOKEN_REFRESHED event
    // that fires on tab focus). Without this, the whole loadData runs
    // every time the user switches browser tabs back to OwnProperly,
    // re-mounting all child pages and losing any in-memory tab state
    // (e.g. which Settings tab the user was on).
    // loadNonce re-runs the load when the user hits Retry on the error screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.id, loadNonce])

  // Expose loadData for refresh after import
  const refreshData = useCallback(async () => {
    // Out-of-order guard: only the most recent load/refresh may write, and
    // never after the signed-in user has changed underneath it.
    const seq = ++refreshSeqRef.current
    const gen = loadGenRef.current
    const uid = user?.id
    const live = () => refreshSeqRef.current === seq && loadGenRef.current === gen && userIdRef.current === uid
    try {
      const [props, cos] = await Promise.all([
        api.fetchProperties(),
        api.fetchCompanies(),
      ])
      if (!live()) return
      // Apply same access filter — use userAccess + owned
      const { data: ownedCos } = await supabase.from('companies').select('id').eq('owner_id', user.id).is('deleted_at', null)
      if (!live()) return
      const ownedIds = (ownedCos || []).map(c => c.id)
      const accessibleIds = new Set([...ownedIds, ...userAccess])
      if (isPlatformAdmin) {
        setProperties(props)
        setCompanies(cos)
      } else {
        setProperties(props.filter(p => accessibleIds.has(p.company_id)))
        setCompanies(cos.filter(c => accessibleIds.has(c.id)))
      }
      // If the user was viewing a tab for a company that no longer exists, clear it
      setActiveCoTab(prev => {
        if (!prev) return prev
        const stillExists = cos.some(c => c.id === prev)
        return stillExists ? prev : null
      })
    } catch(e) {
      // Refresh failed — keep the data we already have on screen, but don't
      // swallow it silently: log it and tell the user.
      if (!live()) return
      logError('refreshData', e)
      showToast('Refresh failed — showing last loaded data', 'error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAccess, isPlatformAdmin, user?.id])

  // Portfolio search: put the user back where they were once it is cleared.
  useScrollRestoreOnClear(Boolean(searchQ) || statusFilter !== 'all')
  const filtered = useMemo(()=>{
    const f = properties.filter(p=>{
      if(!showArchived && p.archived_at) return false
      if(coFilter!=='all'&&p.company_id!==coFilter) return false
      if(statusFilter!=='all'&&p.status!==statusFilter) return false
      // Name, address, building, unit, company and tenant name — every
      // whitespace-separated token must match somewhere (lib/propertySearch).
      if(searchQ&&!matchesQuery(p, searchQ)) return false
      return true
    })
    // Sort
    // Natural sort: handles "Room 2" < "Room 10" correctly
    const natSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    // Building-aware sort: properties in the same building cluster together,
    // then within a building they're ordered by flat/room number.
    const byBuilding = (a, b) => {
      const ka = groupKeyForAddress(a.address) || ''
      const kb = groupKeyForAddress(b.address) || ''
      if (ka !== kb) return natSort(ka, kb)
      return natSort(flatKeyWithinBuilding(a.name), flatKeyWithinBuilding(b.name))
    }
    return [...f].sort((a,b)=>{
      switch(sortBy) {
        case 'company-name': {
          const coA = a.company?.name||''; const coB = b.company?.name||''
          if(coA!==coB) return natSort(coA, coB)
          return byBuilding(a, b)
        }
        case 'name':         return byBuilding(a, b)
        case 'status':       return (a.status||'').localeCompare(b.status||'')
        case 'rent-high':    return (b.rent_pcm||0)-(a.rent_pcm||0)
        case 'rent-low':     return (a.rent_pcm||0)-(b.rent_pcm||0)
        case 'yield-high':   return calcGrossYield(b, yieldBasis)-calcGrossYield(a, yieldBasis)
        case 'arrears':      return (b.arrears||0)-(a.arrears||0)
        case 'value-high':   return propValue(b)-propValue(a)
        // Custom: drag positions first; rows never dragged (NULL sort_order)
        // tie at 0, so fall back to natural name order instead of DB order.
        case 'custom':       return ((a.sort_order||0)-(b.sort_order||0)) || natSort(a.name||a.address||'', b.name||b.address||'')
        default:             return 0
      }
    })
  },[properties,coFilter,statusFilter,searchQ,sortBy,showArchived])

  // Reset the drag ("Custom Order") positions back to the canonical default:
  // company, then building cluster, then natural unit order ("Room 2" before
  // "Room 10") — the same order the Company / Name sort displays. Persists a
  // fresh sort_order for every property, so every view that renders the
  // canonical array (Day Tracker, dashboards, dropdowns) reads it too.
  async function resetCustomOrder() {
    const ok = await confirmDialog({ title: 'Reset the custom order?', body: 'Every property goes back to the default order (company → building → unit). Any drag ordering you have done is overwritten.', confirmLabel: 'Reset order', danger: true })
    if (!ok) return
    const natSort = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
    const ordered = [...properties].sort((a, b) => {
      const coA = a.company?.name || '', coB = b.company?.name || ''
      if (coA !== coB) return natSort(coA, coB)
      const ka = groupKeyForAddress(a.address) || ''
      const kb = groupKeyForAddress(b.address) || ''
      if (ka !== kb) return natSort(ka, kb)
      return natSort(flatKeyWithinBuilding(a.name), flatKeyWithinBuilding(b.name))
    })
    const sortMap = new Map(ordered.map((p, i) => [p.id, i]))
    setProperties(prev => prev.map(p => sortMap.has(p.id) ? { ...p, sort_order: sortMap.get(p.id) } : p))
    ordered.forEach((p, i) => {
      if (p.sort_order !== i) api.updatePropertySortOrder(p.id, i).catch(() => {})
    })
    showToast('Property order reset to default ✓')
  }

  // Dashboard counts/widgets exclude archived properties unconditionally —
  // archived = "not actively managing." If you sold a flat 2 years ago you
  // don't want it inflating your Total Invested figure.
  const activeProperties = useMemo(() => properties.filter(p => !p.archived_at), [properties])
  const archivedCount = properties.length - activeProperties.length

  const dashProps = useMemo(()=>
    dashCoFilter.length === 0 ? activeProperties : activeProperties.filter(p => dashCoFilter.includes(p.company_id))
  , [activeProperties, dashCoFilter])

  const dashCos = useMemo(()=>
    dashCoFilter.length === 0 ? companies : companies.filter(c => dashCoFilter.includes(c.id))
  , [companies, dashCoFilter])

  // Stats computed from dashProps (filtered by selected companies).
  // Uses isPropertyEarningRent/isPropertyOccupied helpers so 'notice_given'
  // counts toward income and occupancy (tenant is still paying), while
  // 'let_agreed' does NOT (no tenant has moved in yet).
  const stats = useMemo(()=>({
    totalInvested:       dashProps.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
    totalEstVal:         dashProps.reduce((s,p)=>s+propValue(p),0),
    monthlyRent:         dashProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0),
    totalArrears:        dashProps.reduce((s,p)=>s+(p.arrears||0),0),
    totalMortgage:       dashProps.reduce((s,p)=>s+(p.mortgage_amount||0),0),
    totalEquity:         dashProps.reduce((s,p)=>s+propValue(p)-(p.mortgage_amount||0),0),
    monthlyMortgageCost: dashProps.reduce((s,p)=>{
      if(!p.mortgage_rate||!p.mortgage_amount) return s
      const r=p.mortgage_rate/12, n=(p.mortgage_term||25)*12
      return s+p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1)
    },0),
    mortgaged:           dashProps.filter(p=>(p.mortgage_amount||0)>0).length,
    rented:              dashProps.filter(p=>isPropertyOccupied(p.status)).length,
    noticeGiven:         dashProps.filter(p=>p.status==='notice_given').length,
    letAgreed:           dashProps.filter(p=>p.status==='let_agreed').length,
    vacant:              dashProps.filter(p=>p.status==='vacant').length,
    onMarket:            dashProps.filter(p=>p.status==='on_rental_market').length,
    inRefurb:            dashProps.filter(p=>p.refurb_status==='in-progress').length,
    total:               dashProps.length,
    occupancy:           occupancySummary(dashProps),
  }),[dashProps])

  // Forecast vs received rent for this month and the two before it, plus next
  // month's forecast, for the dashboard's Rent Forecast / Rent Received cards.
  // Runs the rent engine over the filtered properties so the cards agree with
  // the Rent Tracker; only the rows in those four months are evaluated.
  // `ytd` covers January to this month (newest first) for the Rental Income
  // section; `months` is its first three for the KPI card.
  const rentSnapshot = useMemo(() => {
    const ytd = rentMonthSnapshot(dashProps, { count: new Date().getMonth() + 1 })
    return { ytd, months: ytd.slice(0, 3), next: rentMonthSnapshot(dashProps, { count: 1, offset: 1 })[0] }
  }, [dashProps])

  // Property stats per company — operating companies only. A holding company
  // owns companies, not properties, so it has no property stats: including it
  // would just paint zero-value cards and chart segments on the dashboard.
  // Its group view lives in Portfolio → Companies.
  const companyStats = useMemo(()=>dashCos.filter(c=>!isHoldingCompany(c)).map(c=>{
    const ps=dashProps.filter(p=>p.company_id===c.id)
    return {...c, count:ps.length,
      invested:    ps.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
      estVal:      ps.reduce((s,p)=>s+propValue(p),0),
      monthlyRent: ps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0),
      arrears:     ps.reduce((s,p)=>s+(p.arrears||0),0),
      rented:      ps.filter(p=>isPropertyOccupied(p.status)).length,
      vacant:      ps.filter(p=>p.status==='vacant').length,
    }
  }),[dashCos, dashProps])


  // Success/info toasts auto-dismiss; ERROR toasts stay until dismissed —
  // a 3.5s window is not enough to read a failure, and the toast is the
  // only feedback channel most forms have.
  const toastTimer = useRef(null)
  const showToast = useCallback((msg,type='success')=>{
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null }
    setToast({msg,type})
    if (type !== 'error') toastTimer.current = setTimeout(()=>setToast(null),3500)
  },[])

  // Listen for global toast events so deep-tree components can trigger a
  // toast without receiving showToast as a prop. See src/lib/toast.js.
  useEffect(() => {
    function handler(e) { showToast(e.detail?.message, e.detail?.kind || 'success') }
    window.addEventListener('ownproperly:toast', handler)
    return () => window.removeEventListener('ownproperly:toast', handler)
  }, [showToast])

  // Global keyboard shortcut to open the command palette. Cmd+K on Mac,
  // Ctrl+K elsewhere. We skip when the user is typing into an input/textarea
  // or contenteditable to avoid hijacking their typing, EXCEPT when the
  // modifier is held (Cmd/Ctrl) — those combos should always open the
  // palette since the user is asking for the shortcut explicitly.
  useEffect(() => {
    function onKey(e) {
      const isPaletteKey = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (!isPaletteKey) return
      e.preventDefault()
      setShowPalette(o => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Commands list for the palette. Rebuilt whenever the underlying data
  // changes (properties / companies / view); cheap enough to recompute.
  // Top-level navigation tabs — the registry lives in lib/nav.js (shared with
  // the Settings → Navigation toggles so the two can never disagree again).
  // Feedback used to live here as a required tab, but it's not a daily-use
  // page — moved to the "⋯ More" menu / drawer instead.
  // MTD ITSA only applies to individuals/sole-traders. Limited-company landlords
  // file Corporation Tax, not Self Assessment — hide the page from their nav so
  // their UI isn't cluttered with an irrelevant feature.
  const navItems = ALL_NAV
    .filter(n => n.flag ? activeFlags.has(n.flag) : (n.required || userNavPrefs.includes(n.key)))
    .filter(n => n.key !== 'mtd' || accountType !== 'limited_company')

  const paletteCommands = useMemo(() => {
    const cmds = []
    // Navigation — generated from the effective nav (registry + user prefs +
    // flags + account-type gating), so the palette can never offer a page
    // the user can't have (e.g. MTD Tax for limited companies) and never
    // misses one they can (Autopilot, Renters Rights, Insurance…).
    for (const n of navItems) {
      cmds.push({
        id: `nav:${n.key}`, icon: n.icon, label: `Go to ${n.label}`,
        group: 'navigate', keywords: n.label,
        action: () => { setView(n.key); setSelectedId(null) },
      })
    }
    cmds.push(
      { id:'nav:portfolio-companies', icon:'grid', label:'Go to Companies', group:'navigate', keywords:'companies portfolio',
        action: () => { setSelectedId(null); setPortfolioTab('companies'); setView('properties') } },
      { id:'nav:compliance', icon:'shield-check', label:'Go to Compliance', group:'navigate', keywords:'certificates gas eicr epc insurance licences',
        action: () => { setSelectedId(null); setView('compliance') } },
      { id:'nav:portfolio-contractors', icon:'wrench', label:'Go to Contractors', group:'navigate', keywords:'trades contractors',
        action: () => { setSelectedId(null); setPortfolioTab('contractors'); setView('properties') } },
      { id:'nav:daytracker', icon:'calendar', label:'Go to Day Tracker', group:'navigate', keywords:'rent day tracker',
        action: () => { setSelectedId(null); setView('daytracker') } },
      { id:'nav:feedback', icon:'message', label:'Send Feedback', group:'navigate', keywords:'feedback bug feature',
        action: () => { setView('feedback'); setSelectedId(null) } },
    )
    // Settings sub-tabs — "Settings → Billing" etc., from the shared registry.
    for (const group of Object.values(SETTINGS_TABS)) {
      for (const t of group) {
        cmds.push({
          id: `settings:${t.key}`, icon: 'settings', label: `Settings → ${t.label}`,
          group: 'navigate', keywords: `settings ${t.label}`,
          action: () => openSettingsTab(t.key),
        })
      }
    }
    // Individual reports — "Report: Annual P&L" etc.
    for (const r of REPORT_CATALOGUE) {
      cmds.push({
        id: `report:${r.id}`, icon: r.icon, label: `Report: ${r.name}`,
        group: 'navigate', keywords: `report ${r.desc}`,
        action: () => { setSelectedId(null); setSelectedReportId(r.id); setView('reports') },
      })
    }
    // Open property by name/address
    for (const p of properties) {
      cmds.push({
        id: `prop:${p.id}`, icon: 'home', label: p.name || p.address || 'Untitled property',
        keywords: `${p.address || ''} ${p.company?.name || ''} ${p.company?.abbr || ''}`.trim(),
        group: 'open',
        hint: p.company?.abbr,
        action: () => { setSelectedId(p.id); setDetailTab('overview'); setView('detail') },
      })
    }
    // Open company by name
    for (const c of companies) {
      cmds.push({
        id: `co:${c.id}`, icon: 'grid', label: c.name,
        keywords: c.abbr,
        group: 'open',
        hint: 'Company',
        action: () => { setActiveCoTab(c.id); setView('properties'); setPortfolioTab('companies') },
      })
    }
    // Quick actions (matches the "+ New" menu)
    cmds.push(
      { id:'act:add-prop',   icon:'home', label:'Add Property',         group:'create', action:()=>{ setEditProp(null); setShowAddProp(true) } },
      { id:'act:add-bulk',   icon:'building', label:'Add Block of Flats',   group:'create', action:()=>openWorkflow('bulk-add') },
      { id:'act:add-co',     icon:'grid', label:'Add Company',          group:'create', action:()=>setShowAddCo(true) },
      { id:'act:import',     icon:'file-text', label:'Import Statement',     group:'create', action:()=>openWorkflow('import') },
      { id:'act:stmt-audit', icon:'clipboard-check', label:'Rental Statement Audit', group:'create', action:()=>openWorkflow('statement-audit') },
      { id:'act:import-data', icon:'upload', label:'Import Historic Data', group:'create', action:()=>openWorkflow('import-data') },
      { id:'act:scan-receipt', icon:'receipt', label:'Scan Receipt',       group:'create', keywords:'expense camera ocr', action:()=>setShowReceiptScan(true) },
      { id:'act:dark',       icon:'moon', label: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        group:'action', keywords: 'theme toggle', action:()=>setDarkMode(!darkMode) },
      { id:'act:signout',    icon:'log-out', label:'Sign Out',              group:'action', action:()=>supabase.auth.signOut() },
    )
    return cmds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, companies, darkMode, navItems])

  // Record where the user came from so the property page's Back returns
  // there (Portfolio sub-tab, Rent Tracker, Dashboard…) instead of always
  // dumping them on the Properties tab.
  const detailOrigin = useRef(null)
  // Full-page workflows (statement import, bulk add) record where the user
  // came from so closing them returns there.
  const workflowOrigin = useRef('dashboard')

  // Early returns AFTER all hooks — nothing below this line may call a hook.
  // (A hook after these returns crashes with React #300 the moment a gate
  // flips, e.g. a fresh signup being routed into the onboarding wizard.)
  // Privacy & Terms render at /privacy and /terms even when unauthenticated.
  // HMRC requires the URLs to be publicly reachable for production approval.
  // These checks sit BEFORE the auth gate.
  if (showPrivacy) return <PrivacyPolicy onBack={() => {
    setShowPrivacy(false)
    if (window.location.pathname.startsWith('/privacy')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>
  if (showTerms) return <TermsOfService onBack={() => {
    setShowTerms(false)
    if (window.location.pathname.startsWith('/terms')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>
  if (showSecurity) return <SecurityPage onBack={() => {
    setShowSecurity(false)
    if (window.location.pathname.startsWith('/security')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>

  if (authLoading) return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style><div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>
  // On a company tenant subdomain, a logged-out visitor gets the company's
  // branded tenant login, never the OwnProperly marketing site.
  if (!session && portalBranding) return (
    <LoginPage branding={portalBranding} />
  )
  if (!session) return (
    <>
      <Suspense fallback={<PageLoadingSpinner T={T}/>}>
        <MarketingSite
          onSignIn={()=>{ setLoginMode('login'); setShowLoginModal(true) }}
          onSignUp={()=>{ setLoginMode('signup'); setShowLoginModal(true) }}
          onPrivacy={()=>setShowPrivacy(true)}
        />
      </Suspense>
      {showLoginModal && (
        <div onClick={e=>e.target===e.currentTarget&&setShowLoginModal(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16,backdropFilter:'blur(4px)'}}>
          <LoginPage key={`login-${loginMode}`} initialMode={loginMode} onClose={()=>setShowLoginModal(false)}/>
        </div>
      )}
    </>
  )
  if (isTenant) return (
    <Suspense fallback={<PageLoadingSpinner T={T}/>}>
      <TenantPortal user={user}
        onSignOut={()=>supabase.auth.signOut()}
        onSwitchToLandlord={()=>setIsTenant(false)}
      />
    </Suspense>
  )

  // ── TRIAL EXPIRED HARD GATE ────────────────────────────────────────
  // Platform admins (Justin) bypass entirely so we never lock ourselves
  // out. Tenant-only users are already handled above. For everyone else,
  // if ANY of their accessible companies is past its trial and not on a
  // paying plan or free tier, show a full-screen blocker requiring
  // Stripe Checkout per overdue company before the app loads.
  if (!isPlatformAdmin && !impersonatingUser) {
    // Pass user.id so the gate only considers OWNED companies — we never
    // gate a user on someone else's billing state (they can't pay for it
    // anyway, and gating would just lock them out of their other paid
    // companies). Collaborator companies that are expired drop out of
    // the user's view naturally, owner gets nudged via their own gate.
    const overdue = getOverdueCompanies({ companies, subs: companySubs, userId: user?.id })
    if (overdue.length > 0) {
      return <TrialExpiredGate
        companies={overdue}
        subs={companySubs}
        properties={properties}
        user={user}
        onSignOut={()=>supabase.auth.signOut()}
      />
    }
  }

  // Collaborator whose only access just got suspended (account owner
  // stopped paying or trial expired with no Stripe sub). Show a clear
  // banner instead of dropping them on the onboarding wizard, which
  // would invite them to create a company they don't actually want.
  if (companies.length === 0 && suspendedAccess.length > 0 && !isPlatformAdmin) {
    return <SuspendedAccessBanner
      suspended={suspendedAccess}
      user={user}
      T={T}
      onSignOut={()=>supabase.auth.signOut()}
    />
  }

  if (showOnboarding) return <Suspense fallback={<PageLoadingSpinner T={T}/>}><OnboardingWizard user={user} onComplete={()=>{ setShowOnboarding(false); refreshData() }}/></Suspense>


  const selected = properties.find(p=>p.id===selectedId)

  function openDetail(p, tab='overview'){
    detailOrigin.current = { view, portfolioTab }
    setSelectedId(p.id);setDetailTab(tab);setView('detail')
  }
  function closeDetail(){
    const origin = detailOrigin.current
    detailOrigin.current = null
    setSelectedId(null)
    if (origin && origin.view !== 'detail') {
      if (origin.view === 'properties' && origin.portfolioTab) setPortfolioTab(origin.portfolioTab)
      setView(origin.view)
    } else {
      setView('properties')
    }
  }
  function openWorkflow(key){
    workflowOrigin.current = (view === 'import' || view === 'import-data' || view === 'bulk-add' || view === 'statement-audit') ? 'dashboard' : view
    setSelectedId(null)
    setView(key)
  }
  function closeWorkflow(){
    setView(workflowOrigin.current || 'dashboard')
  }
  // Settings sub-tabs are owned by SettingsPage (it reads its initial tab
  // from the hash at mount and listens for this event when already open).
  function openSettingsTab(tab){
    window.history.pushState({ view: 'settings', settingsTab: tab }, '', `#/settings/${tab}`)
    setView('settings')
    window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab } }))
  }

  async function handleSaveProp(formData){
    try{
      // Strip the compliance payload from the property write — it gets
      // persisted separately into compliance_items below.
      const { _compliance = [], _statusChange = null, ...propData } = formData
      let propId
      if(editProp?.id){
        const updated=await api.updateProperty(editProp.id, propData)
        setProperties(prev=>prev.map(p=>p.id===editProp.id?{...p,...updated}:p))
        propId = editProp.id
        showToast('Property updated')
      }else{
        const created=await api.createProperty({...propData,user_id:user.id})
        setProperties(prev=>[...prev,created])
        propId = created.id
        // If this property was created by converting a completed deal,
        // retire that deal now — it's become a portfolio property, so it
        // shouldn't linger on the Deals page. Soft-delete sends it to Trash
        // (restorable for 30 days), matching the manual delete users were
        // doing by hand. Best-effort: the property is already saved, so a
        // failed deal-delete shouldn't block the success path.
        if (convertSourceDealId) {
          // Carry the refurb across as a project: the deal's refurb budget
          // becomes the agreed price, its refurb dates the schedule, and
          // the BRRR end value the expected value after. Best-effort.
          const d = convertSourceDeal
          if (d && (Number(d.refurb_cost) > 0 || d.refurb_start_date || d.refurb_end_date)) {
            try {
              const project = await api.createRefurbProject({
                property_id: propId, company_id: created.company_id || d.company_id || null,
                title: 'Refurbishment', stage: 'planned',
                agreed_price: Number(d.refurb_cost) || 0,
                start_date: d.refurb_start_date || null, target_end_date: d.refurb_end_date || null,
                original_end_date: d.refurb_end_date || null, deal_id: convertSourceDealId,
                expected_value_after: Number(d.brrr_end_value) || null,
                expected_rent_after: Number(d.monthly_rent) || null,
                funding: d.purchase_type === 'bridge' ? 'bridge' : d.purchase_type === 'cash' ? 'cash' : 'mortgage',
              })
              setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_projects:[...(p.refurb_projects||[]),project],refurb_status:'planned'}:p))
            } catch (e) {
              console.error('failed to create refurb project from deal', e)
              showToast('Property added — add the refurb on its Refurb tab', 'error')
            }
          }
          setConvertSourceDeal(null)
          // Carry the deal's photos and documents onto the new property
          // first (copied into this user's folder), then retire the deal.
          let carried = null
          try { carried = await api.carryDealAttachmentsToProperty(convertSourceDealId, created.id, user.id) }
          catch (e) { console.error('failed to carry deal attachments', e) }
          try {
            await api.deleteDeal(convertSourceDealId, user.id)
            setConvertRefreshKey(k => k + 1) // tell DealsPage to refresh its list
            const parts = []
            if (carried?.photos) parts.push(`${carried.photos} photo${carried.photos === 1 ? '' : 's'}`)
            if (carried?.documents) parts.push(`${carried.documents} document${carried.documents === 1 ? '' : 's'}`)
            showToast(parts.length
              ? `Property added — ${parts.join(' and ')} carried across, deal moved to Trash`
              : 'Property added — deal moved to Trash')
            if (carried?.failed?.length) {
              showToast(`${carried.failed.length} attachment${carried.failed.length === 1 ? '' : 's'} could not be carried across — still on the deal in Trash`, 'error')
            }
          } catch (e) {
            console.error('failed to retire converted deal', e)
            showToast('Property added — but the deal could not be removed, delete it manually', 'error')
          }
          setConvertSourceDealId(null)
        } else {
          showToast('Property added')
        }
      }

      // On Rental Market: open / close the dated non-chargeable period so the
      // months on the market never count against collection %, and rent is
      // expected again from the tenancy start. Only the dates of this change
      // are touched; earlier months keep their history.
      if (_statusChange && propId) {
        try {
          const existing = properties.find(p=>p.id===propId)?.non_chargeable_periods || []
          const plan = planOnMarketPeriods({ ..._statusChange, periods: existing })
          let periods = [...existing]
          if (plan.create) periods = [await api.createNonChargeablePeriod({ ...plan.create, property_id: propId }), ...periods]
          for (const c of plan.close) { const u = await api.updateNonChargeablePeriod(c.id, { end_date: c.end_date }); periods = periods.map(x=>x.id===u.id?u:x) }
          for (const id of plan.remove) { await api.deleteNonChargeablePeriod(id); periods = periods.filter(x=>x.id!==id) }
          if (plan.create || plan.close.length || plan.remove.length) {
            setProperties(prev=>prev.map(p=>p.id===propId?{...p,non_chargeable_periods:periods}:p))
          }
        } catch (e) {
          console.error('failed to record on-market period', e)
          showToast('Status saved, but the on-market dates were not recorded. Add them on the Rent tab (non-chargeable periods).', 'error')
        }
      }

      // Persist compliance items. Best-effort: if it fails, the property
      // is already saved — we just lose the compliance dates and the
      // user can re-enter them from the Compliance tab.
      if (propId && Array.isArray(_compliance) && _compliance.length > 0) {
        try {
          // Load existing items so we update-not-duplicate when the user
          // edits a property and changes dates. Match on CANONICAL cert_type
          // so a legacy 'gas' row is updated by the modal's 'gas_safety'
          // prompt instead of gaining a duplicate.
          const existing = await api.fetchCompliance(propId).catch(() => [])
          const byType = new Map(existing.map(e => [canonicalCertType(e.cert_type), e]))
          for (const item of _compliance) {
            const match = byType.get(canonicalCertType(item.cert_type))
            if (match) {
              // In-place update via Supabase client — no dedicated update
              // helper exists yet so use the raw client.
              await supabase.from('compliance_items')
                .update({
                  expiry_date: item.expiry_date || null,
                  issue_date:  item.issue_date  || null,
                  reminder_days: item.reminder_days,
                  cert_name: item.cert_name,
                })
                .eq('id', match.id)
            } else {
              await api.createCompliance(propId, item)
            }
          }
        } catch (e) {
          console.error('compliance save failed', e)
          // Don't surface — property save succeeded which is the
          // critical path. User can fix from Compliance tab.
        }
      }

      setShowAddProp(false);setEditProp(null)
    }catch(e){showToast(e.message,'error')}
  }

  async function handleDeleteProp(id, password){
    try{
      // Re-authenticate with password before deleting
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email, password
      })
      if (error) { showToast('Incorrect password - property not deleted', 'error'); return false }
      // Soft-delete: flips deleted_at instead of hard-deleting. The property
      // moves to Trash where it can be restored within 30 days; the auto-purge
      // handles permanent removal. This means accidental deletes are
      // recoverable, and the row keeps existing for any FK-linked children
      // (refurb, expenses, compliance, etc) until the user explicitly purges.
      await api.softDeleteProperty(id, user.id)
      setProperties(prev=>prev.filter(p=>p.id!==id))
      setView('properties')
      setSelectedId(null)
      setShowDeleteConfirm(null)
      showToast('Property moved to Trash')
      return true
    }catch(e){showToast(e.message,'error'); return false}
  }

  async function handleDuplicateProp(id) {
    setPropertyActionBusy(true)
    try {
      const created = await api.duplicateProperty(id)
      setProperties(prev => [...prev, created])
      showToast(`Duplicated as "${created.name}"`)
      // Navigate to the new property
      setSelectedId(created.id)
      setView('detail')
      setDetailTab('overview')
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleArchiveProp(id, archive = true) {
    setPropertyActionBusy(true)
    try {
      const updated = archive
        ? await api.archiveProperty(id)
        : await api.unarchiveProperty(id)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
      showToast(archive ? 'Property archived' : 'Property restored')
      if (archive) {
        // Send the user back to the list — archived items are hidden by default
        setView('properties'); setSelectedId(null)
      }
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleMarkSold(id, salePrice, saleDate) {
    setPropertyActionBusy(true)
    try {
      const updated = await api.markPropertyAsSold(id, salePrice, saleDate)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
      setShowSellModal(null)
      showToast('Marked as sold')
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleSaveCo(formData){
    try{
      const coId=await api.createCompanyForOwner(formData.name, formData.abbr, formData.color)
      // Fetch the newly created company to get the full row
      let { data: co } = await supabase.from('companies').select('*').eq('id', coId).single()
      if (!co) throw new Error('Company created but could not be loaded')
      // The create RPC only takes name/abbr/colour, so the type is applied
      // as a follow-up write. Holding companies default to CT-passive.
      if (formData.companyType === 'holding') {
        co = await api.updateCompany(co.id, { company_type: 'holding' })
      }
      // Auto-generate and save subdomain — operating companies only (a
      // holding company has no tenants, so no tenant-portal subdomain).
      if (formData.companyType !== 'holding') {
        try {
          const sub = (formData.name||'')
            .toLowerCase()
            .replace(/\s+(property|group|ltd|limited|co|company|management|properties)\s*/gi,'')
            .replace(/[^a-z0-9]+/g,'-')
            .replace(/^-+|-+$/g,'')
            .slice(0,30)
          if (sub && co.id) await api.saveCompanySubdomain(co.id, sub)
        } catch(e) { logError('handleSaveCo:saveCompanySubdomain', e) }
      }
      setCompanies(prev=>[...prev,co]);setActiveCoTab(co.id)
      // The owner map inside permissionsMap was stamped at load time, so a
      // company created mid-session isn't in it — without this, every canDo()
      // on the new company denies (read-only Shareholders card, disabled
      // settings) until the page is refreshed.
      setPermissionsMap(prev=>({ ...prev, __owner: { ...(prev?.__owner||{}), [co.id]: true } }))
      showToast('Company added');setShowAddCo(false)
    }catch(e){showToast(e.message,'error')}
  }

  async function handleRenameCompany() {
    if (!renameCo.name.trim()) { setRenameCoError('Name is required'); return }
    if (!renameCoPassword) { setRenameCoError('Please enter your password to confirm'); return }
    setRenameCoSaving(true)
    setRenameCoError('')
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: renameCoPassword })
      if (authError) { setRenameCoError('Incorrect password'); setRenameCoSaving(false); return }
      const { error } = await supabase.from('companies')
        .update({ name: renameCo.name.trim(), abbr: renameCo.abbr.trim() || renameCo.name.trim().slice(0,5).toUpperCase() })
        .eq('id', renameCoTarget.id)
      if (error) throw error
      setCompanies(prev => prev.map(c => c.id === renameCoTarget.id ? { ...c, name: renameCo.name.trim(), abbr: renameCo.abbr.trim() || c.abbr } : c))
      showToast('Company renamed successfully')
      setRenameCoTarget(null)
      setRenameCo({ name: '', abbr: '' })
      setRenameCoPassword('')
    } catch(e) { setRenameCoError(e.message || 'Something went wrong') }
    setRenameCoSaving(false)
  }

  async function handleUpdatePropField(id,field,value){
    try{
      await api.updateProperty(id,{[field]:value})
      setProperties(prev=>prev.map(p=>p.id===id?{...p,[field]:value}:p))
    }catch(e){showToast(e.message,'error')}
  }

  async function handleUpdatePayment(payment, newStatus){
    try{
      // updateRentSegment stamps period_start/period_end onto legacy
      // whole-month rows on touch — merge the returned row into local state
      // so period-filtered readers (day tracker, MTD) see the stamped dates
      // without a refetch.
      const updated = await api.updateRentSegment(payment.id, { status: newStatus })
      setProperties(prev=>prev.map(p=>{
        if(p.id!==payment.property_id) return p
        return {...p, rent_payments: p.rent_payments.map(rp=>
          rp.id===payment.id ? {...rp, ...(updated||{}), status:newStatus} : rp
        )}
      }))
      setEditingPayment(null)
      showToast(`${payment.month_label} marked as ${newStatus}`)
    }catch(e){showToast(e.message,'error')}
  }

  function CompaniesPanel({ companies, setCompanies, user, showToast, companySettings, setCompanySettings, T }) {
    const mono = MONO

    function openRename(c) {
      setRenameCoTarget(c)
      setRenameCo({ name: c.name, abbr: c.abbr||'' })
      setRenameCoPassword('')
      setRenameCoError('')
    }

    return (
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',margin:0}}>Companies</h2>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowAddCo(true)}>+ Add Company</button>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
          {companies.map(c=>(
            <button key={c.id} className={`tab ${activeCoTab===c.id?'active':''}`}
              style={{border:`1px solid ${activeCoTab===c.id?c.color:T.border}`,color:activeCoTab===c.id?c.color:T.muted,background:activeCoTab===c.id?c.color+'11':'transparent'}}
              onClick={()=>setActiveCoTab(c.id)}>{c.name}{isHoldingCompany(c)&&<span style={{fontFamily:mono,fontSize:8,fontWeight:700,marginLeft:6,opacity:0.8,letterSpacing:'0.05em'}}>HOLDING</span>}</button>
          ))}
        </div>
        {companies.filter(c=>c.id===activeCoTab).map(c=>{
          const cs=companyStats.find(x=>x.id===c.id)||{count:0,rented:0,vacant:0,monthlyRent:0,invested:0,estVal:0,arrears:0}
          const cProps=activeProperties.filter(p=>p.company_id===c.id)
          const holding=isHoldingCompany(c)
          const canEditCo=canDo(permissionsMap, c.id, 'edit_company_settings') || devModeActive
          // Convert between operating and holding. Operating → holding only
          // while the company has no properties (they'd vanish from its view).
          async function convertType() {
            const toHolding=!holding
            if (toHolding && cProps.length>0) return showToast(`${c.name} has ${plural(cProps.length,'property','properties')} — move them to another company before converting to a holding company`,'error')
            if (!(await confirmDialog({ title: toHolding ? `Make ${c.name} a holding company?` : `Make ${c.name} an operating company?`, body: (toHolding
              ? `Make ${c.name} a holding company? It will show a group view of the companies it owns instead of a property portfolio, and (as a passive holdco) stop counting toward the corporation tax threshold split.`
              : `Make ${c.name} an operating company? It will show a property portfolio again and count as an associated company for corporation tax.`), confirmLabel: toHolding ? 'Make holding company' : 'Make operating company' }))) return
            try {
              const row=await api.updateCompany(c.id,{company_type:toHolding?'holding':'operating'})
              setCompanies(prev=>prev.map(x=>x.id===c.id?{...x,...row}:x))
              showToast(toHolding?'Now a holding company':'Now an operating company')
            } catch(e){ showToast(e.message,'error') }
          }
          return <div key={c.id}>
            {/* Company header with rename button */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:c.color||T.gold}}/>
                <span style={{fontSize:16,fontWeight:700,color:T.text}}>{c.name}</span>
                <span style={{fontFamily:mono,fontSize:10,fontWeight:700,background:(c.color||T.gold)+'22',color:c.color||T.goldText,padding:'2px 8px',borderRadius:4}}>{c.abbr}</span>
                {holding&&<span style={{fontFamily:mono,fontSize:9,fontWeight:700,color:T.muted,border:`1px solid ${T.border}`,padding:'2px 8px',borderRadius:4,letterSpacing:'0.05em'}}
                  title="Holding company — owns companies, not properties">HOLDING</span>}
              </div>
              {canEditCo && (
                <div style={{display:'flex',gap:8}}>
                  <button onClick={convertType}
                    title={holding?'Convert back to an operating (property-owning) company':'Convert to a holding company (owns companies, not properties)'}
                    style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                    {holding?'Make operating':'Make holding co'}
                  </button>
                  <button onClick={()=>openRename(c)}
                    style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                    Rename
                  </button>
                  {(c.owner_id === user?.id || devModeActive) && (
                    <button onClick={()=>setDeleteCoTarget(c)}
                      style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.red}33`,background:'transparent',color:T.red,cursor:'pointer'}}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            {holding ? (
              <HoldingGroupPanel company={c} companies={companies} properties={activeProperties} T={T}
                canEdit={canEditCo} showToast={showToast}
                onUpdateCompany={row=>setCompanies(prev=>prev.map(x=>x.id===c.id?{...x,...row}:x))}/>
            ) : (<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:12,marginBottom:22}}>
              <StatCard icon="🏠" label="Properties" value={cs.count} sub={`${cs.rented} rented · ${cs.vacant} vacant`}/>
              <StatCard icon="💷" label="Monthly Rent" value={fmt(cs.monthlyRent)} sub={fmt(cs.monthlyRent*12)+'/yr'} accent={T.green}/>
              <StatCard icon="📊" label="Total Invested" value={fmt(cs.invested)} sub={`Est. ${fmt(cs.estVal)}`}/>
              <StatCard icon="⚠" label="Arrears" value={fmt(cs.arrears)} accent={cs.arrears>0?T.red:T.green}/>
            </div>
            <div style={{display:'grid',gap:10}}>
              {groupPropertiesByBuilding(cProps).map(group => (
                <div key={group.tail || group.items[0].id}>
                  {group.isBuilding && (
                    <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6,marginBottom:6,paddingLeft:8}}>
                      <span style={{fontSize:13}} aria-hidden="true">🏘</span>
                      <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{group.tail}</span>
                      <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>· {plural(group.items.length,'unit')}</span>
                    </div>
                  )}
                  <div style={{display:'grid',gap:10,marginLeft:group.isBuilding?14:0,borderLeft:group.isBuilding?`2px solid ${T.gold}33`:'none',paddingLeft:group.isBuilding?10:0}}>
                    {group.items.map(p => {
                      const canFin = canDo(permissionsMap, p.company_id, 'view_financial') || devModeActive
                      const displayName = group.isBuilding ? (String(p.name||'').split(',')[0].trim() || p.name) : p.name
                      return (
                      <div key={p.id} className="card pcard" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}} {...pressable(()=>openDetail(p))}>
                        <div style={{flex:1,minWidth:150}}>
                          <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{displayName}</div>
                          <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}</div>
                        </div>
                        {p.arrears>0&&<div style={{fontFamily:MONO,fontSize:11,color:T.red}}>⚠ {fmt(p.arrears)}</div>}
                        {canFin && <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                            <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.goldText}}>{calcGrossYield(p, yieldBasis).toFixed(1)}%</div>
                            <div style={{fontFamily:MONO,fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'0.05em'}}>{yieldBasis==='value'?'on value':'on cost'}</div>
                          </div>}
                        {canFin && <div style={{fontFamily:MONO,fontSize:12,color:T.muted}}>{fmt(p.rent_pcm)+'/mo'}</div>}
                        <Badge status={p.status}/>
                      </div>
                    )})}
                  </div>
                </div>
              ))}
              {cProps.length===0&&<div style={{fontFamily:MONO,color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.{(canDo(permissionsMap, activeCoTab, 'edit_properties') || devModeActive) && <><br/><button className="btn btn-gold" style={{fontSize:11,marginTop:12}} onClick={()=>{setEditProp({company_id:activeCoTab});setShowAddProp(true)}}>+ Add Property</button></>}</div>}
            </div>
            </>)}
            <CompanyOwnershipSection company={c} companies={companies} properties={cProps} user={user} T={T} showToast={showToast}
              showAgents={!holding} canEdit={canEditCo}/>
          </div>
        })}


      </div>
    )
  }

  return (
    <div style={{fontFamily:SANS,minHeight:'100vh',width:'100%',maxWidth:'100vw',overflowX:'hidden',background:T.bg,color:T.text,transition:'background 0.3s, color 0.3s',paddingLeft:railWidth}}>
      <AppShellStyles/>
      {/* ── LEFT RAIL (desktop) ── redesign app shell. Fixed in the gutter the
          outer paddingLeft reserves. Mobile keeps the bottom tab bar instead. */}
      {!isMobile && (
        <aside style={{position:'fixed',left:0,top:0,bottom:0,width:railWidth,background:T.surface,borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column',zIndex:120}}>
          {/* Brand block — Properly mark (design/properly-brand): tile only
              when collapsed, sidebar/short lockup when expanded. */}
          <div style={{display:'flex',alignItems:'center',padding:railCollapsed?'14px 0':'14px 16px',justifyContent:railCollapsed?'center':'flex-start',height:52,flexShrink:0,borderBottom:`1px solid ${T.border}`}}>
            {railCollapsed ? <ChromeIcon size={30}/> : <ChromeLogo height={26}/>}
          </div>
          {/* Nav items */}
          <nav aria-label="Primary" style={{flex:1,overflowY:'auto',overflowX:'hidden',padding:'10px 8px',display:'flex',flexDirection:'column',gap:2}}>
            {navItems.map((n,i)=>{
              const active = view===n.key||(view==='detail'&&n.key==='properties')
              // Section header whenever the registry group changes (skip the
              // first group — a header above Dashboard is just noise).
              // Collapsed rail shows a hairline divider instead.
              const newGroup = i>0 && n.group !== navItems[i-1].group
              const header = newGroup && (railCollapsed
                ? <div key={`hdr-${n.group}`} aria-hidden="true" style={{height:1,background:T.border,margin:'8px 10px'}}/>
                : <div key={`hdr-${n.group}`} style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',padding:'12px 11px 4px'}}>{n.group}</div>)
              return (
                <Fragment key={n.key}>
                {header}
                <button title={railCollapsed?n.label:undefined} aria-current={active?'page':undefined}
                  onClick={()=>{setView(n.key);if(n.key!=='detail')setSelectedId(null)}}
                  style={{display:'flex',alignItems:'center',gap:11,padding:railCollapsed?'10px 0':'10px 11px',justifyContent:railCollapsed?'center':'flex-start',
                    borderRadius:10,border:'none',cursor:'pointer',width:'100%',textAlign:'left',
                    background:active?T.card:'transparent',color:active?T.text:T.muted,
                    fontFamily:SANS,fontSize:14,fontWeight:active?700:500,transition:'background 0.15s,color 0.15s'}}
                  onMouseEnter={e=>{if(!active)e.currentTarget.style.color=T.text}}
                  onMouseLeave={e=>{if(!active)e.currentTarget.style.color=T.muted}}>
                  <span style={{display:'flex',flexShrink:0,color:active?T.goldText:'inherit'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:n.icon}</span>
                  {!railCollapsed && <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.label}</span>}
                </button>
                </Fragment>
              )
            })}
          </nav>
          {/* Collapse toggle */}
          <button onClick={()=>setRailCollapsed(c=>!c)} aria-label={railCollapsed?'Expand sidebar':'Collapse sidebar'}
            style={{display:'flex',alignItems:'center',gap:10,padding:railCollapsed?'12px 0':'12px 16px',justifyContent:railCollapsed?'center':'flex-start',
              background:'none',border:'none',borderTop:`1px solid ${T.border}`,cursor:'pointer',color:T.muted,fontFamily:MONO,fontSize:11,flexShrink:0}}>
            <Icon name={railCollapsed?'chevron-right':'chevron-left'} size={18}/>
            {!railCollapsed && <span>Collapse</span>}
          </button>
        </aside>
      )}
      {/* ── IMPERSONATION BANNER ── */}
      {impersonatingUser && (
        <div style={{background:'#8B1F1F',color:'white',padding:'10px 16px',textAlign:'center',fontFamily:MONO,fontSize:12,fontWeight:600,position:'sticky',top:0,zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap'}}>
          <span>🎭 <strong>Impersonating {impersonatingUser.name || impersonatingUser.email}</strong> — viewing their data (read-only for safety)</span>
          <button onClick={()=>{
            sessionStorage.removeItem('ownproperly_impersonate')
            setImpersonatingUser(null)
            window.location.reload()
          }} style={{background:'white',color:'#8B1F1F',border:'none',padding:'5px 14px',borderRadius:5,fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer'}}>
            Stop impersonating
          </button>
        </div>
      )}
      {/* ── DEVELOPER MODE BANNER (with toggle) ── */}
      {isPlatformAdmin && !impersonatingUser && (
        <div style={{
          background: devModeActive ? '#1A2530' : '#2a4a2a',
          color: devModeActive ? '#C8A84B' : '#9ecb9e',
          padding:'6px 16px',
          textAlign:'center',
          fontFamily:MONO,
          fontSize:10,
          fontWeight:700,
          letterSpacing:'0.1em',
          borderBottom: devModeActive ? '1px solid #C8A84B44' : '1px solid #9ecb9e44',
          display:'flex',
          alignItems:'center',
          justifyContent:'center',
          gap:16,
          flexWrap:'wrap'
        }}>
          {devModeActive ? (
            <>
              <span>DEVELOPER MODE — you see all user data across the platform</span>
              <button onClick={()=>{ setDevModeDisabled(true); window.location.reload() }}
                style={{background:'#C8A84B',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                VIEW AS REGULAR USER
              </button>
            </>
          ) : (
            <>
              <span>REGULAR USER VIEW — permission gates active (data-level access unchanged)</span>
              <button onClick={()=>{ setDevModeDisabled(false); window.location.reload() }}
                style={{background:'#9ecb9e',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                ENABLE DEVELOPER MODE
              </button>
            </>
          )}
        </div>
      )}
      {/* ── HEADER ── */}
      {/* Skip link: focus <main> directly instead of navigating — setting
          location.hash to #main-content would be parsed by the hash router
          as an unknown view and blank the screen. */}
      <a href='#main-content' className="skip-link" onClick={e=>{e.preventDefault(); const m=document.getElementById('main-content'); if(m){m.focus(); m.scrollIntoView()}}}>Skip to main content</a>
      <header role='banner' style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 16px',position:'sticky',top:0,zIndex:100,width:'100%'}}>
        <div style={{maxWidth:1240,margin:'0 auto',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          {/* Left: logo on mobile, breadcrumb on desktop (nav lives in the rail) */}
          <div style={{display:'flex',alignItems:'center',flexShrink:0,minWidth:0}}>
            {isMobile
              ? <ChromeLogo height={26}/>
              : view==='detail' && selected
                // Real breadcrumb on the property page: Portfolio and the
                // company segment are clickable; the property name is the
                // current location. (The old header showed the static string
                // "Portfolio / Property".)
                ? <nav aria-label="Breadcrumb" style={{fontFamily:MONO,fontSize:12,color:T.muted,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                    <button onClick={closeDetail} style={{background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.text} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>Portfolio</button>
                    {(()=>{ const co = companies.find(c=>c.id===selected.company_id); return co ? <>
                      <span aria-hidden="true">/</span>
                      <button onClick={()=>{setCoFilter(co.id);setStatusFilter('all');setPortfolioTab('properties');setSelectedId(null);setView('properties')}}
                        style={{background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}
                        onMouseEnter={e=>e.currentTarget.style.color=T.text} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>{co.abbr||co.name}</button>
                    </> : null })()}
                    <span aria-hidden="true">/</span>
                    <span aria-current="page" style={{color:T.text,overflow:'hidden',textOverflow:'ellipsis',maxWidth:260}}>{selected.name}</span>
                  </nav>
                : <span style={{fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',whiteSpace:'nowrap'}}>
                    {navItems.find(n=>n.key===view)?.label || VIEW_LABELS[view] || 'Dashboard'}
                  </span>}
          </div>

          {/* Desktop nav lives in the left rail, so the middle of the header
              is free for the property search — the most common thing anyone
              does on landing (dashboard → a specific property). It doubles as
              the spacer that pushes the action cluster right. "/" focuses it. */}
          {!isMobile&&(
            <div style={{flex:1,display:'flex',justifyContent:'center',minWidth:0,padding:'0 16px'}}>
              <PropertySearchBar
                properties={activeProperties}
                onOpen={p=>openDetail(p)}
                slashToFocus
                placeholder="Search properties by name, address or tenant…"
                style={{width:'100%',maxWidth:440}}/>
            </div>
          )}

          {/* Mobile: current page title */}
          {isMobile&&<div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>
            {(()=>{const ni=navItems.find(n=>n.key===view); return ni&&ICON_NAMES.includes(ni.icon)?<Icon name={ni.icon} size={15} color={T.muted}/>:ni?.icon})()} <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{view==='detail'&&selected?selected.name:(navItems.find(n=>n.key===view)?.label||VIEW_LABELS[view]||'Dashboard')}</span>
          </div>}

          {/* Right side */}
          <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
            {!isMobile&&(
              <div style={{position:'relative'}}>
                <button className="btn btn-gold" style={{fontSize:11,padding:'6px 14px',display:'flex',alignItems:'center',gap:6}}
                  onClick={()=>setShowNewMenu(m=>!m)}>
                  <span style={{fontSize:14,fontWeight:700}}>+</span> New
                  <span style={{fontSize:9,opacity:0.8}}>{showNewMenu?'▲':'▼'}</span>
                </button>
                {showNewMenu&&(
                  <>
                    {/* Backdrop to close */}
                    <div style={{position:'fixed',inset:0,zIndex:199}} onClick={()=>setShowNewMenu(false)}/>
                    {/* Dropdown */}
                    <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:200,
                      background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
                      padding:'6px',minWidth:210,boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}}>
                      {[
                        {icon:'home',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true)}},
                        {icon:'building',label:'Add Block of Flats', action:()=>openWorkflow('bulk-add')},
                        {icon:'grid',label:'Add Company',     action:()=>setShowAddCo(true)},
                        {icon:'file-text',label:'Import Statement',action:()=>openWorkflow('import')},
                        {icon:'clipboard-check',label:'Rental Statement Audit',action:()=>openWorkflow('statement-audit')},
                        {icon:'upload',label:'Import Historic Data',action:()=>openWorkflow('import-data')},
                        {icon:'receipt',label:'Scan Receipt',    action:()=>setShowReceiptScan(true)},
                        // For these three "drill into a property" actions:
                        // if the user has exactly one property, just open it on
                        // the right tab. If they have many, take them to the
                        // portfolio so they can pick. (Was previously a toast
                        // instruction with no action — looked broken.)
                        {icon:'pound',label:'Log Expense',     action:()=>{
                          if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('expenses'); setView('detail') }
                          else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log against' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                        }},
                        {icon:'clipboard-check',label:'Add Compliance',  action:()=>{
                          if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('compliance'); setView('detail') }
                          else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to add a certificate to' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                        }},
                        {icon:'wrench',label:'Log Maintenance', action:()=>{
                          if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('maintenance'); setView('detail') }
                          else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log a job on' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                        }},
                      ].map((item,i,arr)=>(
                        <button key={item.label} onClick={()=>{item.action();setShowNewMenu(false)}}
                          style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                            background:'none',border:'none',borderRadius:8,cursor:'pointer',textAlign:'left',
                            borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',
                            transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}>
                          <span style={{width:22,display:'flex',justifyContent:'center',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={16}/>:<span style={{fontSize:16}}>{item.icon}</span>}</span>
                          <span style={{fontFamily:MONO,fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Trial countdown pill — always visible while any company is
                still on trial. Was previously buried in Billing settings
                until ≤7 days remained, so users got surprised by the
                hard gate. Click to jump to Billing. */}
            {(() => {
              const trialing = companies
                .filter(c => !c.is_free_tier && c.trial_ends_at)
                .map(c => ({ c, days: Math.ceil((new Date(c.trial_ends_at) - Date.now()) / 86400000) }))
                .filter(x => x.days >= 0)
                .sort((a, b) => a.days - b.days)
              if (trialing.length === 0) return null
              const soonest = trialing[0]
              const tone = soonest.days <= 3 ? T.red : soonest.days <= 7 ? T.amber : T.gold
              const toneText = tone === T.gold ? T.goldText : tone
              return (
                <button
                  onClick={() => {
                    // Hash first, then view — the lazy SettingsPage reads its
                    // initial tab from the URL at mount (the event below only
                    // reaches an already-mounted page). Same pattern as the
                    // dashboard upgrade CTA.
                    window.history.pushState({ view: 'settings', settingsTab: 'billing' }, '', '#/settings/billing')
                    setView('settings')
                    window.dispatchEvent(new CustomEvent(
                      'ownproperly:set-settings-tab',
                      { detail: { tab: 'billing' } }
                    ))
                  }}
                  title={trialing.length > 1
                    ? `${trialing.length} companies on trial — soonest ends in ${soonest.days} day${soonest.days===1?'':'s'} (${soonest.c.name})`
                    : `Trial ends in ${soonest.days} day${soonest.days===1?'':'s'} (${soonest.c.name})`}
                  style={{
                    fontFamily:MONO, fontSize:11, fontWeight:700,
                    padding:'5px 12px', borderRadius:20, cursor:'pointer',
                    border:`1px solid ${tone}`, background:tone+'22', color:toneText,
                    whiteSpace:'nowrap',
                  }}>
                  {isMobile ? `${soonest.days}d` : `Trial: ${soonest.days} day${soonest.days===1?'':'s'} left`}
                </button>
              )
            })()}
            <NotificationCentre/>
            {isPlatformAdmin&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 12px',color:T.goldText,borderColor:T.gold+'44'}} onClick={()=>setShowAdmin(true)}>Admin</button>}
            {/* "⋯ More" menu — houses pages that aren't worth their own tab
                (Feedback, Sign Out, etc.). Keeps primary nav focused on
                daily-use pages. */}
            {!isMobile&&(
              <div style={{position:'relative'}}>
                <button className="btn btn-ghost" style={{fontSize:13,padding:'6px 11px',fontWeight:700,letterSpacing:'0.05em'}}
                  onClick={()=>setShowMoreMenu(m=>!m)}
                  aria-label="More options" aria-expanded={showMoreMenu}>
                  ⋯
                </button>
                {showMoreMenu&&(
                  <>
                    <div style={{position:'fixed',inset:0,zIndex:199}} onClick={()=>setShowMoreMenu(false)}/>
                    <div role="menu" style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:200,
                      background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
                      padding:'6px',minWidth:180,boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}}>
                      {[
                        {icon:'search', label:'Search & jump…', hint:'⌘K', action:()=>setShowPalette(true)},
                        {icon:'sparkle',label:'Help & Guides', action:()=>openSettingsTab('help')},
                        {icon:'trash',label:'Trash', action:()=>openSettingsTab('trash')},
                        {icon:'message',label:'Feedback',  action:()=>{setView('feedback');setSelectedId(null)}},
                        {icon:'log-out', label:'Sign Out',  action:()=>supabase.auth.signOut(), divider:true},
                      ].map((item,i,arr)=>(
                        <button key={item.label} role="menuitem"
                          onClick={()=>{item.action();setShowMoreMenu(false)}}
                          style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                            background:'none',border:'none',borderRadius:8,cursor:'pointer',textAlign:'left',
                            borderTop:item.divider?`1px solid ${T.border}`:'none',
                            marginTop:item.divider?4:0,paddingTop:item.divider?12:'10px',
                            transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}>
                          <span style={{width:22,display:'flex',justifyContent:'center',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={15}/>:<span style={{fontSize:14}}>{item.icon}</span>}</span>
                          <span style={{flex:1,fontFamily:MONO,fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                          {item.hint && <span style={{fontFamily:MONO,fontSize:10,color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,padding:'1px 5px'}}>{item.hint}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Search - mobile only (desktop has ⌘K + the ⋯ menu entry) */}
            {isMobile&&<button onClick={()=>setShowPalette(true)}
              aria-label="Search and jump" style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',color:T.text,display:'flex',alignItems:'center',justifyContent:'center',width:36,height:36}}>
              <Icon name="search" size={16}/>
            </button>}
            {/* Hamburger - mobile only */}
            {isMobile&&<button onClick={()=>setShowDrawer(true)}
              aria-label="Open menu" style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',color:T.text,fontSize:16,display:'flex',flexDirection:'column',gap:4,alignItems:'center',justifyContent:'center',width:36,height:36}}>
              <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
              <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
              <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
            </button>}
          </div>
        </div>
      </header>

      {/* ── MOBILE DRAWER ── */}
      {isMobile&&showDrawer&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex'}}>
          {/* Backdrop */}
          <div style={{flex:1,background:'rgba(0,0,0,0.6)'}} onClick={()=>setShowDrawer(false)}/>
          {/* Drawer panel */}
          <div role="dialog" aria-modal="true" aria-label="Navigation menu" style={{width:260,background:T.surface,height:'100%',display:'flex',flexDirection:'column',borderLeft:`1px solid ${T.border}`}}>
            {/* Drawer header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:`1px solid ${T.border}`}}>
              <div style={{display:'flex',alignItems:'center'}}>
                <ChromeLogo height={26}/>
              </div>
              <button onClick={()=>setShowDrawer(false)} aria-label="Close menu"
                style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer',padding:'4px'}}>✕</button>
            </div>
            {/* Search row — the palette's only other mobile entry point is
                the header icon; keyboard ⌘K needs a keyboard. */}
            <button onClick={()=>{setShowDrawer(false);setShowPalette(true)}}
              style={{display:'flex',alignItems:'center',gap:10,margin:'12px 16px 0',padding:'10px 12px',
                background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left'}}>
              <Icon name="search" size={16} color={T.muted}/>
              <span style={{fontFamily:MONO,fontSize:12,color:T.muted}}>Search & jump…</span>
            </button>
            {/* Nav items — grouped with the same section headers as the
                desktop rail */}
            <nav aria-label="Primary" style={{flex:1,overflowY:'auto',padding:'12px 0'}}>
              {navItems.map((n,i)=>{
                const active = view===n.key||(view==='detail'&&n.key==='properties')
                const newGroup = i>0 && n.group !== navItems[i-1].group
                return (
                <Fragment key={n.key}>
                {newGroup && <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',padding:'14px 20px 4px'}}>{n.group}</div>}
                <button aria-current={active?'page':undefined}
                  onClick={()=>{setView(n.key);setSelectedId(null);setShowDrawer(false)}}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 20px',
                    background:active?T.gold+'18':'none',
                    border:'none',borderLeft:active?`3px solid ${T.gold}`:'3px solid transparent',
                    cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
                  <span style={{width:24,display:'flex',justifyContent:'center',color:active?T.goldText:T.muted}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={19}/>:<span style={{fontSize:18}}>{n.icon}</span>}</span>
                  <span style={{fontSize:14,fontWeight:active?600:400,color:active?T.goldText:T.text}}>{n.label}</span>
                </button>
                </Fragment>
              )})}
            </nav>
            {/* Drawer footer */}
            <div style={{padding:'16px 20px',borderTop:`1px solid ${T.border}`,display:'flex',flexDirection:'column',gap:6}}>
              {[
                {icon:'home',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true);setShowDrawer(false)}},
                {icon:'building',label:'Add Block of Flats', action:()=>{openWorkflow('bulk-add');setShowDrawer(false)}},
                {icon:'grid',label:'Add Company',     action:()=>{setShowAddCo(true);setShowDrawer(false)}},
                {icon:'file-text',label:'Import Statement',action:()=>{openWorkflow('import');setShowDrawer(false)}},
                {icon:'clipboard-check',label:'Rental Statement Audit',action:()=>{openWorkflow('statement-audit');setShowDrawer(false)}},
                {icon:'upload',label:'Import Historic Data',action:()=>{openWorkflow('import-data');setShowDrawer(false)}},
                {icon:'receipt',label:'Scan Receipt',    action:()=>{setShowReceiptScan(true);setShowDrawer(false)}},
                {icon:'pound',label:'Log Expense',     action:()=>{
                  if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('expenses'); setView('detail') }
                  else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log against' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                  setShowDrawer(false)
                }},
                {icon:'wrench',label:'Log Maintenance', action:()=>{
                  if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('maintenance'); setView('detail') }
                  else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log a job on' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                  setShowDrawer(false)
                }},
              ].map(item=>(
                <button key={item.label} onClick={item.action}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                    background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                  <span style={{display:'flex',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={15}/>:<span style={{fontSize:15}}>{item.icon}</span>}</span>
                  <span style={{fontFamily:MONO,fontSize:11,color:T.text,fontWeight:500}}>{item.label}</span>
                </button>
              ))}
              <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px',marginTop:4}}
                onClick={()=>{openSettingsTab('help');setShowDrawer(false)}}>
                Help & Guides
              </button>
              <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px'}}
                onClick={()=>{setView('feedback');setSelectedId(null);setShowDrawer(false)}}>
                Send Feedback
              </button>
              <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px'}}
                onClick={()=>supabase.auth.signOut()}>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform announcement banner */}
      {announcements.filter(a=>!dismissedAnns.includes(a.id)).map(a=>{
        const colors={info:'#4B8FE0',warning:'#E0943A',success:'#2ECC8A'}
        const col=colors[a.type]||colors.info
        return (
          <div key={a.id} style={{background:col+'18',borderBottom:`1px solid ${col}33`,padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
            <span style={{fontFamily:MONO,fontSize:12,color:col}}>
              {a.message}{a.link_url&&a.link_text&&isSafeUrl(a.link_url)&&<a href={a.link_url} target="_blank" rel="noreferrer" style={{color:col,marginLeft:12,fontWeight:700}}>{a.link_text} →</a>}
            </span>
            <button onClick={()=>{const n=[...dismissedAnns,a.id];setDismissedAnns(n);localStorage.setItem('dismissed_anns',JSON.stringify(n))}}
              style={{background:'none',border:'none',color:col,cursor:'pointer',fontFamily:MONO,fontSize:11,flexShrink:0}}>Dismiss ✕</button>
          </div>
        )
      })}
      <main id="main-content" tabIndex={-1} style={{maxWidth:1240,margin:'0 auto',padding:isMobile?'16px 12px 90px':'28px 24px',width:'100%',outline:'none'}}>
        {loading?(<>
          {/* Keep a page heading in the outline while data loads. */}
          <h1 style={SR_ONLY}>{view==='dashboard' ? 'Dashboard' : 'Loading'}</h1>
          {view==='dashboard'?<DashboardSkeleton/>:<Spinner/>}
        </>):loadError?(
          /* Load failure — a transient Supabase/network error must never look
             like a wiped account. Render ONLY this panel (no £0 dashboard or
             empty lists underneath) on every view. The raw error is logged by
             loadData; users get plain English and a Retry. */
          <div className="card" role="alert" style={{padding:isMobile?'24px 18px':'40px 32px',marginBottom:20,textAlign:'center',background:T.card,border:`1px solid ${T.red}66`}}>
            <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="alert-triangle" size={isMobile?30:38} color={T.red}/></div>
            <h1 style={{fontSize:isMobile?20:24,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>We couldn't load your portfolio</h1>
            <p style={{fontFamily:MONO,fontSize:13,color:T.muted,lineHeight:1.6,maxWidth:520,margin:'0 auto 20px'}}>
              Your data is safe. This is usually a temporary connection problem, so please try again in a moment. If it keeps happening, contact support.
            </p>
            <button className="btn btn-gold" onClick={()=>{ setLoadError(null); setLoadNonce(n=>n+1) }}>Retry</button>
          </div>
        ):<ErrorBoundary variant="panel" theme={T} resetKey={view==='detail'?`detail:${selectedId}`:view}><Suspense fallback={<PageLoadingSpinner T={T}/>}>

          {view==='dashboard'&&<div className="fade">
            {/* First-run zero-state. Accounts with no properties land here —
                including the most common post-onboarding state (a company
                created by the wizard but no property yet, which previously
                skipped this hero and dumped the user on a wall of £0 KPIs).
                While this shows, the dashboard sections below are skipped
                entirely. */}
            {activeProperties.length === 0 && (
              <div className="card" style={{padding:isMobile?'24px 18px':'40px 32px',marginBottom:20,textAlign:'center',background:T.card,border:`1px dashed ${T.gold}66`}}>
                <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="home" size={isMobile?30:38} color={T.gold}/></div>
                <h1 style={{fontSize:isMobile?20:24,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>Welcome to Properly</h1>
                <p style={{fontFamily:MONO,fontSize:13,color:T.muted,marginBottom:20,lineHeight:1.6,maxWidth:520,margin:'0 auto 20px'}}>
                  {companies.length === 0
                    ? "You're on a 14-day free trial. The fastest way to see what the app does is to add your first company and one property — takes about 2 minutes."
                    : 'Your company is set up — now add your first property to bring the dashboard to life. Takes about a minute.'}
                </p>
                <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                  {companies.length === 0
                    ? <>
                        <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>1. Add a Company</button>
                        <button className="btn btn-ghost" onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled title="Add a company first">2. Add a Property</button>
                      </>
                    : <button className="btn btn-gold" onClick={()=>{setEditProp(null);setShowAddProp(true)}}>Add your first property</button>}
                </div>
              </div>
            )}
            {/* Mobile property search. The header bar has no room for it at
                phone widths (logo + title + actions already fill 52px), so on
                mobile it sits at the top of the dashboard instead. */}
            {isMobile && activeProperties.length > 0 && (
              <div style={{marginBottom:14}}>
                <PropertySearchBar
                  properties={activeProperties}
                  onOpen={p=>openDetail(p)}
                  placeholder="Search properties…"/>
              </div>
            )}
            <div style={{marginBottom:isMobile?14:20,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16,marginBottom:isMobile?10:16}}>
                <div style={{flex:'1 1 auto',minWidth:0}}>
                  {(() => {
                    const fn = (user?.user_metadata?.first_name || (user?.user_metadata?.full_name||'').trim().split(' ')[0] || '').trim()
                    const hr = new Date().getHours()
                    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
                    return (
                      <h1 style={{fontSize:isMobile?22:30,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?2:4}}>
                        {greet}{fn ? <>, {fn}</> : ''}
                      </h1>
                    )
                  })()}
                  {activeProperties.length > 0 && <p style={{fontFamily:MONO,color:T.muted,fontSize:isMobile?11:12,lineHeight:1.5,wordBreak:'break-word',overflowWrap:'anywhere'}}>
                    {plural(stats.total,'property','properties')} · {stats.rented} rented{stats.noticeGiven>0?` (${stats.noticeGiven} on notice)`:''}{stats.letAgreed>0?` · ${stats.letAgreed} let agreed`:''} · {stats.vacant} vacant{dashCoFilter.length>0?` · ${dashCoFilter.length} of ${plural(companies.length,'company','companies')}`:` · ${plural(companies.length,'company','companies')}`}
                    {dashProps.some(p=>p.current_value>0) && <>
                      {/* On mobile drop to a new line so the value/equity pair has its own row */}
                      {isMobile ? <br/> : ' · '}
                      <span style={{color:T.muted}}>Value </span>
                      <span style={{color:T.green,fontWeight:700}}>
                        {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0),0))}
                      </span>
                      {' · '}
                      <span style={{color:T.muted}}>Equity </span>
                      <span style={{color:T.green,fontWeight:700}}>
                        {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0)-(p.mortgage_amount||0),0))}
                      </span>
                    </>}
                  </p>}
                </div>
                {/* Portfolio health ring — average of per-property health
                    scores, consistent with the per-card HealthBadge. */}
                {dashProps.length > 0 && (() => {
                  const avg = dashProps.reduce((sum,p)=>sum+(api.calcPropertyHealthScore(p, p.compliance_items||[], tenanciesByProp[p.id]||p.tenancy||null, p.maintenance_jobs||[], p.rent_payments||[]).score||0),0)/dashProps.length
                  return <HealthRing score={avg}/>
                })()}
              </div>
              {/* Company filter pills */}
              {companies.length > 1 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
                  <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                  <button
                    onClick={()=>setDashCoFilter([])}
                    style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                      border:`1px solid ${dashCoFilter.length===0?T.gold:T.border}`,
                      background:dashCoFilter.length===0?T.gold:'transparent',
                      color:dashCoFilter.length===0?'#1C2830':T.muted,fontWeight:dashCoFilter.length===0?700:400}}>
                    All companies
                  </button>
                  {companies.map(c=>{
                    const sel = dashCoFilter.includes(c.id)
                    return (
                      <button key={c.id}
                        onClick={()=>setDashCoFilter(prev=>{
                          if(prev.length===0) {
                            // Was 'all' — switch to just this one
                            return [c.id]
                          }
                          if(prev.includes(c.id)) {
                            // Already selected — deselect. If empty after, go back to 'all'
                            const next = prev.filter(id=>id!==c.id)
                            return next
                          }
                          // Add to selection
                          const next = [...prev, c.id]
                          // If all companies selected, snap back to 'all'
                          return next.length===companies.length ? [] : next
                        })}
                        style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                          border:`1px solid ${sel?(c.color||T.gold):T.border}`,
                          background:sel?(c.color||T.gold)+'22':'transparent',
                          color:sel?(c.color||T.goldText):T.muted}}>
                        {sel?'✓ ':''}{c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {(() => {
              // First-run: the welcome hero above is the whole dashboard.
              // Rendering the sections under it would just be a wall of £0
              // KPIs and empty widgets.
              if (activeProperties.length === 0) return null
              // ───────────────────────────────────────────────────────────────
              // Dashboard sections registry — each section is a labelled chunk
              // that the user can reorder and show/hide. Section content is
              // rendered by the function below. The KPI grid is one of these
              // sections too, with its own internal customisation preserved.
              // ───────────────────────────────────────────────────────────────

              const SECTION_DEFS = {
                rent_income: {
                  icon: 'pound',
                  label: 'Rental Income',
                  description: 'Due vs collected by month, year to date, with a per-company split',
                  render: () => <RentIncomePanel months={rentSnapshot.ytd} companies={companyStats} onOpenRent={()=>setView('rent')} isMobile={isMobile}/>,
                },
                kpi_grid: {
                  icon: 'pie-chart',
                  label: 'KPI cards',
                  description: 'Portfolio value, monthly rent, arrears, and other key metrics',
                  render: () => renderKpiGrid(),
                },
                by_company: {
                  icon: 'grid',
                  label: 'By Company',
                  description: 'A card per company with its property/rent stats',
                  render: () => renderByCompany(),
                },
                smart_alerts: {
                  icon: '⚠',
                  label: 'Items needing attention',
                  description: 'Smart alerts: overdue rent, expiring compliance, vacant properties',
                  render: () => <SmartAlerts properties={dashProps} companies={dashCos} fmt={fmt} openDetail={openDetail}/>,
                },
                autopilot_widget: {
                  icon: '🤖',
                  label: 'Portfolio Autopilot',
                  description: 'AI-drafted prioritised actions across your portfolio',
                  render: () => {
                    if (!activeFlags.has('portfolio_autopilot')) return null
                    const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
                    return (
                      <div style={{ marginTop: 28 }}>
                        <AutopilotWidget companyId={scopedId} companies={companies} onOpenFull={() => { window.location.hash = '#/autopilot' }}/>
                      </div>
                    )
                  },
                },
                tenant_inbox: {
                  icon: '📬',
                  label: 'Tenant Inbox',
                  description: 'Latest messages and repair requests from tenants',
                  render: () => <TenantInbox user={user} companies={companies} showToast={showToast} companySettings={companySettings}/>,
                },
                portfolio_insights: {
                  icon: '✨',
                  label: 'AI Portfolio Insights',
                  description: 'Observations and opportunities generated by Claude (refreshable every 30 min) — Investor tier',
                  // Investor-tier feature. Gates via canUseInvestorFeatures
                  // helper — platform admins + free-tier companies pass; otherwise
                  // need an active 'investor' subscription. Falls back to an
                  // upgrade prompt for starter-tier users.
                  render: () => {
                    const hasInvestor = canUseInvestorFeatures({
                      subs: companySubs, companies, isPlatformAdmin,
                    })
                    if (!hasInvestor) {
                      return (
                        <div style={{ marginTop: 28, marginBottom: 20, background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 14, padding: '20px 22px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 16 }}>✨</span>
                            <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0 }}>AI Portfolio Insights</h2>
                            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.gold + '22', color: T.goldText }}>INVESTOR</span>
                          </div>
                          <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.7, marginBottom: 12 }}>
                            Get Claude-generated weekly observations about under-rented units, expiring certs, high LTVs and refinance opportunities. Available on the £5/property Investor tier.
                          </p>
                          <button className="btn btn-gold" style={{ fontSize: 12 }}
                            onClick={() => {
                              // 'billing' is a Settings sub-tab, not a top-level
                              // view. Set the hash BEFORE switching views —
                              // SettingsPage reads its initial tab from the URL
                              // at mount, whereas the tab-change event would
                              // fire before its listener exists. The event is
                              // still dispatched for an already-mounted page.
                              window.history.pushState({ view: 'settings', settingsTab: 'billing' }, '', '#/settings/billing')
                              setView('settings')
                              window.dispatchEvent(new CustomEvent(
                                'ownproperly:set-settings-tab',
                                { detail: { tab: 'billing' } }
                              ))
                            }}>
                            Upgrade to Investor →
                          </button>
                        </div>
                      )
                    }
                    const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
                    const scopedName = scopedId ? companies.find(c => c.id === scopedId)?.name : null
                    return <PortfolioInsightsWidget companyId={scopedId} companyName={scopedName}/>
                  },
                },
                property_map: {
                  icon: '🗺',
                  label: 'Property Map',
                  description: 'Compact map showing all your properties',
                  render: () => (
                    <div style={{ marginTop: 28 }}>
                      <PropertyMap
                        compact
                        properties={dashProps}
                        setProperties={setProperties}
                        showToast={showToast}
                        onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}
                        onViewFullMap={()=>{ setView('properties'); setPortfolioTab('map') }}
                      />
                    </div>
                  ),
                },
                portfolio_modeller: {
                  icon: '📈',
                  label: 'Portfolio What-If Modeller',
                  description: 'Model rent changes, refinancing, and other scenarios',
                  render: () => <PortfolioModellerWidget properties={dashProps}/>,
                },
                company_documents: {
                  icon: '📁',
                  label: 'Company Documents',
                  description: 'Documents stored at company level (only shows when a company is selected)',
                  render: () => (
                    activeCoTab && (companySettings[activeCoTab]||{}).feature_documents
                      ? <div style={{marginTop:28}}>
                          <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:6}}>Company Documents</h2>
                          <p style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:14}}>
                            Documents stored at company level — for items that apply across all properties (e.g. company insurance, bank letters)
                          </p>
                          <CompanyDocumentsTab companyId={activeCoTab} showToast={showToast} isAdmin={isAdmin} user={user}/>
                        </div>
                      : null
                  ),
                },
              }

              // Default order + enabled are defined ONCE at the top of this
              // component (SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED).
              // Previously redeclared here, which caused the customise modal
              // to silently miss new sections (e.g. portfolio_insights).
              // Resolve current section prefs, filling in any missing keys from defaults.
              // Same resolver as the KPI widgets: a section the user has never
              // saved lands where the default order puts it (after its nearest
              // default predecessor), not at the bottom of the page.
              const resolvedSections = resolveWidgetPrefs(sectionPrefs, SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED)
                .filter(s => SECTION_DEFS[s.key])

              // ── Renderers for each section. Defined here to keep closures
              //    over dashProps/companies/etc lexically simple.

              function renderKpiGrid() {
                // Widget definitions — each returns a StatCard JSX element
                const WIDGET_DEFS = {
                  portfolio_value: { icon:'home', label:'Portfolio Value', render: () => (
                    <StatCard icon="home" label="Portfolio Value" value={fmt(stats.totalEstVal)} sub={`Invested ${fmt(stats.totalInvested)}`} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                      breakdown={[
                        {label:'Estimated portfolio value', value:fmt(stats.totalEstVal), color:T.goldText},
                        {label:'Total invested (purchase + refurb)', value:fmt(stats.totalInvested)},
                        {label:'Purchase prices', value:fmt(dashProps.reduce((s,p)=>s+(p.purchase_price||0),0)), indent:true},
                        {label:'Refurb costs', value:fmt(dashProps.reduce((s,p)=>s+(p.refurb_cost||0),0)), indent:true},
                        {label:'Unrealised gain', value:fmt(stats.totalEstVal-stats.totalInvested), color:stats.totalEstVal>stats.totalInvested?T.green:T.red, separator:true, note:'Est. portfolio value minus total invested (purchase + refurb)'},
                        {label:'Transaction costs', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0)+(p.legal_fees||0),0)), separator:true},
                        {label:'Stamp duty', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0),0)), indent:true},
                        {label:'Legal fees', value:fmt(dashProps.reduce((s,p)=>s+(p.legal_fees||0),0)), indent:true},
                      ]}
                    />
                  )},
                  monthly_rent: { icon:'pound', label:'Monthly Rental Income', render: () => {
                    // One card for "what should this month bring in": the
                    // headline is the rent engine's collectible rent for the
                    // month (tenancy-aware, prorated for move-ins/outs, voids
                    // and non-chargeable periods). The contracted rent_pcm
                    // total, annualised figure and next month's forecast sit on
                    // the face; the previous separate Rent Forecast card was
                    // retired because it duplicated this one.
                    // This card answers "what should come in"; what HAS come
                    // in lives on Rent Collected, so nothing is repeated.
                    const cur = rentSnapshot.months[0]
                    const next = rentSnapshot.next
                    const hasPeriods = cur.periods > 0
                    const headline = hasPeriods ? cur.expected : stats.monthlyRent
                    const gap = cur.expected - stats.monthlyRent
                    const sub = !hasPeriods ? `${cur.label} · no rent periods yet, showing contracted rent`
                      : Math.abs(gap) < 1 ? `Expected ${cur.label} · matches contracted rent`
                      : `Expected ${cur.label} · ${fmt(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'} contracted`
                    return (
                      <StatCard icon="pound" label="Monthly Rental Income" value={fmt(headline)} sub={sub} accent={T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                        strip={[
                          {label:'Contracted', value:`${fmt(stats.monthlyRent)}/mo`},
                          {label:`${next.label.slice(0,3)} forecast`, value:fmt(next.expected), color:T.goldText},
                          {label:'Annualised', value:`${fmt(stats.monthlyRent*12)}/yr`},
                          {label:'Rented', value:`${stats.rented} of ${stats.total}`},
                        ]}
                        breakdown={[
                          {label:`Expected ${cur.label}`, value:fmt(cur.expected), color:T.green, note:'What the tenancies say is due this month: mid-month move-ins and move-outs, voids and approved non-chargeable periods are prorated'},
                          {label:'Contracted monthly rent', value:fmt(stats.monthlyRent), note:'Sum of the monthly rent on every rented or notice-given property'},
                          {label:'Expected vs contracted', value:`${gap >= 0 ? '+' : '-'}${fmt(Math.abs(gap))}`, color:Math.abs(gap) < 1 ? T.muted : gap > 0 ? T.green : T.amber},
                          {label:'Annualised (contracted)', value:fmt(stats.monthlyRent*12), color:T.green},
                          {label:`${next.label} forecast`, value:fmt(next.expected), color:T.goldText, separator:true, note:next.periods === 0 ? 'No rent periods generated for next month yet' : undefined},
                          {label:'Rented units', value:`${stats.rented} of ${stats.total}`, separator:true},
                          {label:'Occupancy rate', value:`${Math.round(stats.occupancy.rate)}%`, color:T.green, note:'Occupied units over lettable units (refurb and purchased left out)'},
                          ...companyStats.map(c=>({label:`${c.name} · expected ${cur.label.slice(0,3)}`, value:fmt(cur.byCompany[c.id]?.expected || 0), color:c.color, separator:c===companyStats[0]})),
                        ]}
                      />
                    )
                  }},
                  rent_received: { icon:'receipt', label:'Rent Collected', render: () => {
                    // What HAS come in: this month's collected rent with its
                    // percentage and outstanding, and the two previous months
                    // on the face. By rent period (the month the rent is for,
                    // as the Rent Tracker lays it out). Short-term-let income
                    // is excluded from the headline and footnoted.
                    //
                    // Colour semantics: green = money in; the warning colours
                    // are reserved for COMPLETED months whose collection window
                    // has closed. This month mid-collection is never red.
                    const [cur, prev, prev2] = rentSnapshot.months
                    const rate = monthRate(cur)
                    const completedColor = r => r == null ? T.muted : r >= 95 ? T.green : r >= 80 ? T.amber : T.red
                    const stlTotal = cur.stlReceived + prev.stlReceived + prev2.stlReceived
                    const sub = cur.expected > 0
                      ? `${cur.label} · ${rate}% of ${fmt(cur.expected)} · ${fmt(cur.outstanding)} outstanding`
                      : `${cur.label} · ${cur.periods === 0 ? 'no rent periods yet' : 'nothing expected'}`
                    // Card face: one row per month (oldest first, this month
                    // bold) plus year to date: Due · Collected · Outstanding · %.
                    const ytd = rentSnapshot.ytd.reduce((a, mo) => ({ expected: a.expected + mo.expected, received: a.received + mo.received }), { expected: 0, received: 0 })
                    ytd.outstanding = Math.max(0, ytd.expected - ytd.received)
                    const tableRow = (mo, isCurrent, label) => {
                      const r = monthRate(mo)
                      const col = isCurrent ? T.green : completedColor(r)
                      return { strong: isCurrent, cells: [label, fmt(mo.expected), fmt(mo.received), fmt(mo.outstanding), r == null ? '–' : `${r}%`],
                        colors: [isCurrent ? T.text : T.muted, T.text, T.green, mo.outstanding > 0 ? (isCurrent ? T.amber : col) : T.green, col] }
                    }
                    const table = { columns: ['Month', 'Due', 'Collected', 'Outstanding', '%'], rows: [
                      tableRow(prev2, false, prev2.label.slice(0,3)), tableRow(prev, false, prev.label.slice(0,3)), tableRow(cur, true, `${cur.label.slice(0,3)} so far`),
                      tableRow(ytd, true, `${cur.year} YTD`),
                    ] }
                    const monthRow = (mo, isCurrent) => {
                      const r = monthRate(mo)
                      return {
                        label: `${mo.label}${isCurrent ? ' (so far)' : ''}`,
                        value: fmt(mo.received),
                        color: isCurrent ? T.green : completedColor(r),
                        note: mo.expected > 0
                          ? `${r}% of ${fmt(mo.expected)} expected${mo.outstanding > 0 ? ` · ${fmt(mo.outstanding)} outstanding` : ''}${mo.needsBackfill > 0 ? ` · ${mo.needsBackfill} paid with no amount` : ''}`
                          : (mo.periods === 0 ? 'No rent periods recorded' : 'Nothing expected'),
                      }
                    }
                    return (
                      <StatCard icon="receipt" label="Rent Collected" value={fmt(cur.received)} sub={sub} accent={T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                        table={table}
                        breakdown={[
                          monthRow(cur, true),
                          monthRow(prev, false),
                          monthRow(prev2, false),
                          {label:'Three-month total', value:fmt(cur.received + prev.received + prev2.received), color:T.green, separator:true, note:'Figures are by rent period, the month the rent is for, matching the Rent Tracker'},
                          ...(cur.needsBackfill > 0 ? [{label:`${cur.needsBackfill} paid ${cur.needsBackfill===1?'period':'periods'} with no amount this month`, value:'⚠', color:T.amber, note:'Marked paid in the Rent Tracker without a figure, so collected is understated until the amounts are entered'}] : []),
                          ...companyStats.map(c=>({label:`${c.name} · collected ${cur.label.slice(0,3)}`, value:fmt(cur.byCompany[c.id]?.received || 0), color:c.color, separator:c===companyStats[0]})),
                          ...(stlTotal > 0 ? [{label:'Short-term let income (excluded above)', value:fmt(stlTotal), color:'#9B6FDE', separator:true, note:'Booking income over the same three months, reported in full on the Short-Term Let Income page'}] : []),
                        ]}
                      />
                    )
                  }},
                  arrears: { icon:'alert-triangle', label:'Total Arrears', render: () => (
                    <StatCard icon="alert-triangle" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                      breakdown={[
                        // Each property in arrears links straight to its Rent
                        // tab — that's where the payment history and arrears
                        // detail live, which is what you want next after
                        // spotting the number here.
                        ...dashProps.filter(p=>(p.arrears||0)>0).map(p=>({label:p.name, value:fmt(p.arrears), color:T.red,
                          onClick:()=>openDetail(p,'rent'), linkTitle:`Open ${p.name} — rent & arrears`})),
                        ...(dashProps.filter(p=>(p.arrears||0)>0).length===0?[{label:'No arrears - all clear!', value:'✓', color:T.green}]:[]),
                        {label:'Vacant units', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                      ]}
                    />
                  )},
                  refurb: { icon:'hammer', label:'In Refurbishment', render: () => (
                    <StatCard icon="hammer" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue} onNavigate={()=>{setStatusFilter('refurb');setPortfolioTab('properties');setView('properties')}} navLabel="View"
                      breakdown={[
                        // Same for live refurbs — straight to the Refurb tab
                        // for phases, costs and progress notes.
                        ...dashProps.filter(p=>p.refurb_status==='in-progress').map(p=>({label:p.name, value:p.company?.abbr||'', color:T.blue,
                          onClick:()=>openDetail(p,'refurb'), linkTitle:`Open ${p.name} — refurbishment`})),
                        ...(stats.inRefurb===0?[{label:'No active refurbs', value:'✓', color:T.green}]:[]),
                        {label:'Planned refurbs', value:dashProps.filter(p=>p.refurb_status==='planned').length},
                        {label:'Completed refurbs', value:dashProps.filter(p=>p.refurb_status==='complete').length, color:T.green},
                      ]}
                    />
                  )},
                  mortgages: { icon:'landmark', label:'Mortgages Outstanding', render: () => (
                    <StatCard icon="landmark" label="Mortgages Outstanding" value={fmt(stats.totalMortgage)} sub={`${stats.mortgaged} mortgaged properties`} accent={T.purple} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                      breakdown={[
                        {label:'Total mortgage debt', value:fmt(stats.totalMortgage), color:'#9B59B6'},
                        {label:'Total portfolio equity', value:fmt(stats.totalEquity), color:stats.totalEquity>0?T.green:T.red},
                        {label:'Monthly repayments', value:fmt(stats.monthlyMortgageCost)},
                        {label:'Annual repayments', value:fmt(stats.monthlyMortgageCost*12)},
                        {label:'Average LTV', value:stats.totalEstVal>0?((stats.totalMortgage/stats.totalEstVal)*100).toFixed(1)+'%':'-'},
                        ...companyStats.map(c=>({
                          label:c.name+' debt',
                          value:fmt(dashProps.filter(p=>p.company_id===c.id).reduce((s,p)=>s+(p.mortgage_amount||0),0)),
                          color:c.color
                        })),
                      ]}
                    />
                  )},
                  cashflow_forecast: { icon:'wallet', label:'Cash Committed', render: () => {
                    // Filter deals by the dashboard's company filter so the
                    // widget stays in sync with the rest of the page. Properties
                    // are already filtered (dashProps).
                    const filteredDeals = dashCoFilter.length === 0
                      ? dashboardDeals
                      : dashboardDeals.filter(d => dashCoFilter.includes(d.company_id))
                    const cashAgg = aggregateDeals(filteredDeals, dashProps)
                    // Big number is total cash out across ALL live items
                    // (committed AND pipeline). The sub-line and breakdown
                    // give the urgency split. Earlier we tried "next 90 days"
                    // as the headline but it was £0 for users without dates
                    // set — useless out of the box. Total exposure is more
                    // honest as a glanceable headline.
                    const next90 = (cashAgg.byBucket.overdue?.cashOut || 0)
                                 + (cashAgg.byBucket['0-30']?.cashOut || 0)
                                 + (cashAgg.byBucket['31-60']?.cashOut || 0)
                                 + (cashAgg.byBucket['61-90']?.cashOut || 0)
                    const next90Count = (cashAgg.byBucket.overdue?.count || 0)
                                      + (cashAgg.byBucket['0-30']?.count || 0)
                                      + (cashAgg.byBucket['31-60']?.count || 0)
                                      + (cashAgg.byBucket['61-90']?.count || 0)
                    const overdueCash = cashAgg.byBucket.overdue?.cashOut || 0
                    const overdueCount = cashAgg.byBucket.overdue?.count || 0
                    const pipelineCash = cashAgg.byGroup.pipeline?.cashOut || 0
                    // Accent: red if overdue, amber if anything due in 30d,
                    // gold otherwise (purely planning view).
                    const accent = overdueCash > 0 ? T.red
                                 : (cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber
                                 : T.gold
                    // Sub-line gives the urgency split at a glance:
                    //   "£X due in 90d · £Y in pipeline"
                    // Falls back to a friendly hint if there's nothing live.
                    const sub = cashAgg.totalCount === 0
                      ? 'No live deals or properties'
                      : `${fmt(next90)} due in 90d · ${fmt(pipelineCash)} in pipeline`
                    return (
                      <StatCard icon="wallet" label="Cash Committed" value={fmt(cashAgg.totalCashOut)} sub={sub} accent={accent} onNavigate={()=>setView('deals')} navLabel="Deals"
                        breakdown={[
                          ...(overdueCash > 0 ? [{label:`Overdue (${overdueCount} ${overdueCount===1?'item':'items'})`, value:fmt(overdueCash), color:T.red, separator:true}] : []),
                          {label:'Next 30 days', value:fmt(cashAgg.byBucket['0-30']?.cashOut || 0), color:(cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber : T.muted, note:`${cashAgg.byBucket['0-30']?.count || 0} item(s) needing cash this month`},
                          {label:'31-60 days',   value:fmt(cashAgg.byBucket['31-60']?.cashOut || 0), color:T.text},
                          {label:'61-90 days',   value:fmt(cashAgg.byBucket['61-90']?.cashOut || 0), color:T.text},
                          {label:'Subtotal: due in next 90 days', value:fmt(next90), color:next90 > 0 ? T.goldText : T.muted, separator:true, note:`${next90Count} item(s) with completion or refurb dates set`},
                          {label:'Later (90+ days)', value:fmt(cashAgg.byBucket['91+']?.cashOut || 0), color:T.muted, separator:true},
                          {label:'Pipeline (no date set)', value:fmt(pipelineCash), color:T.muted, note:'Deals still being analysed/offered. Set expected completion dates to move these into the dated buckets above.'},
                          {label:'Total cash out across all live items', value:fmt(cashAgg.totalCashOut), color:T.goldText, separator:true},
                          ...(cashAgg.propertyRefurbUndated > 0 ? [{label:`${cashAgg.propertyRefurbUndated} refurb${cashAgg.propertyRefurbUndated===1?'':'s'} without a target finish date`, value:'⚠', color:T.amber, note:'Set a target finish on the Refurbs page to place it in the 90-day view'}] : []),
                        ]}
                      />
                    )
                  }},
                  insurance_renewals: { icon:'shield-check', label:'Insurance Renewals', render: () => {
                    // Filter policies by the dashboard's company filter, mirroring
                    // how the cashflow widget handles dashCoFilter. RLS already
                    // limits the user's visible set.
                    const visiblePolicies = dashCoFilter.length === 0
                      ? insurancePolicies
                      : insurancePolicies.filter(p => dashCoFilter.includes(p.company_id))
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const daysUntil = (d) => Math.floor((new Date(d) - today) / (1000 * 60 * 60 * 24))
                    // Buckets:
                    //   expired   — already past expiry, needs urgent action
                    //   d30       — renewing in next 30 days (amber alert)
                    //   d60       — renewing in 31-60 days
                    //   d90       — renewing in 61-90 days
                    //   later     — beyond 90 days
                    // For each bucket we sum premiums so the user sees what
                    // money is committed and roughly when.
                    const bucketed = { expired: [], d30: [], d60: [], d90: [], later: [] }
                    visiblePolicies.forEach(p => {
                      if (!p.expiry_date) return
                      const d = daysUntil(p.expiry_date)
                      if (d < 0)       bucketed.expired.push(p)
                      else if (d <= 30) bucketed.d30.push(p)
                      else if (d <= 60) bucketed.d60.push(p)
                      else if (d <= 90) bucketed.d90.push(p)
                      else              bucketed.later.push(p)
                    })
                    const sumP = (arr) => arr.reduce((s, p) => s + (Number(p.premium) || 0), 0)
                    // Big number = total annual premium across all active
                    // policies (anything not yet expired). Catches the eye and
                    // tells the user their total insurance bill.
                    const totalAnnual = visiblePolicies
                      .filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0)
                      .reduce((s, p) => s + (Number(p.premium) || 0), 0)
                    const activeCount = visiblePolicies.filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0).length
                    // Accent: red if anything's expired, amber if renewing
                    // in 30 days, gold otherwise.
                    const accent = bucketed.expired.length > 0 ? T.red
                                 : bucketed.d30.length > 0 ? T.amber
                                 : T.gold
                    const sub = visiblePolicies.length === 0
                      ? 'No policies tracked'
                      : bucketed.expired.length > 0
                        ? `${bucketed.expired.length} expired · ${activeCount} active`
                        : bucketed.d30.length > 0
                          ? `${bucketed.d30.length} renewing in 30 days · ${activeCount} active`
                          : `${activeCount} active ${activeCount === 1 ? 'policy' : 'policies'}`
                    return (
                      <StatCard icon="shield-check" label="Insurance Renewals" value={fmt(totalAnnual)} sub={sub} accent={accent} onNavigate={()=>{window.location.hash='#/compliance/insurance'}} navLabel="Insurance"
                        breakdown={[
                          ...(bucketed.expired.length > 0 ? [{label:`Expired (${bucketed.expired.length})`, value:fmt(sumP(bucketed.expired)), color:T.red, separator:true, note:'Policies past their expiry date. Renew immediately.'}] : []),
                          {label:'Next 30 days', value:fmt(sumP(bucketed.d30)), color:bucketed.d30.length > 0 ? T.amber : T.muted, note:`${bucketed.d30.length} ${bucketed.d30.length === 1 ? 'policy' : 'policies'} renewing this month`},
                          {label:'31-60 days',   value:fmt(sumP(bucketed.d60)), color:T.text, note:bucketed.d60.length > 0 ? `${bucketed.d60.length} ${bucketed.d60.length === 1 ? 'policy' : 'policies'}` : null},
                          {label:'61-90 days',   value:fmt(sumP(bucketed.d90)), color:T.text, note:bucketed.d90.length > 0 ? `${bucketed.d90.length} ${bucketed.d90.length === 1 ? 'policy' : 'policies'}` : null},
                          {label:'Later',        value:fmt(sumP(bucketed.later)), color:T.muted, note:`${bucketed.later.length} ${bucketed.later.length === 1 ? 'policy' : 'policies'} beyond 90 days`, separator:true},
                          {label:'Total annual premium (all active)', value:fmt(totalAnnual), color:T.goldText, separator:true},
                        ]}
                      />
                    )
                  }},
                  property_count: { icon:'home', label:'Property Count', render: () => (
                    <StatCard icon="home" label="Property Count" value={stats.total} sub={`${stats.rented} rented · ${stats.vacant} vacant`} accent={T.gold} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                      breakdown={[
                        {label:'Total properties', value:stats.total},
                        {label:'Rented', value:stats.rented, color:T.green},
                        {label:'Vacant', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                        {label:'In refurbishment', value:stats.inRefurb, color:T.blue},
                        ...companyStats.map(c=>({label:c.name, value:c.count, color:c.color})),
                      ]}
                    />
                  )},
                  occupancy_rate: { icon:'pie-chart', label:'Occupancy Rate', render: () => {
                    // Over lettable units only: refurb and purchased units
                    // can't take a tenant yet, so they'd drag the % down for
                    // no reason. The empty lettable units sit on the card face.
                    const o = stats.occupancy
                    const rate = Math.round(o.rate)
                    return (
                      <StatCard icon="pie-chart" label="Occupancy Rate" value={rate+'%'} sub={`${o.occupied} of ${o.lettable} lettable occupied`} accent={rate>=90?T.green:rate>=75?T.amber:T.red} onNavigate={()=>{setStatusFilter('vacant');setPortfolioTab('properties');setView('properties')}} navLabel="Vacant"
                        strip={[
                          {label:'Let agreed', value:o.letAgreed, color:o.letAgreed?T.amber:T.muted},
                          {label:'On market', value:o.onMarket, color:o.onMarket?'#3AA7B8':T.muted},
                          {label:'Vacant', value:o.vacant, color:o.vacant?T.red:T.muted},
                          {label:'Not lettable', value:o.notLettable, color:T.muted},
                        ]}
                        breakdown={[
                          {label:'Rented', value:o.rented, color:T.green},
                          ...(o.shortTermLet ? [{label:'Short-term let', value:o.shortTermLet, color:T.green}] : []),
                          ...(o.noticeGiven ? [{label:'Notice given', value:o.noticeGiven, color:T.amber, note:'Tenant still paying through the notice period'}] : []),
                          {label:'Occupied', value:o.occupied, color:T.green},
                          {label:'Let agreed', value:o.letAgreed, color:T.amber, separator:true, note:'Tenant found, not moved in yet'},
                          {label:'On rental market', value:o.onMarket, color:'#3AA7B8', note:'Being marketed, rent not expected yet'},
                          {label:'Vacant', value:o.vacant, color:T.red},
                          {label:'Lettable units', value:o.lettable},
                          {label:'Occupancy %', value:rate+'%', color:rate>=90?T.green:T.amber, note:'Occupied over lettable units'},
                          ...(o.refurb ? [{label:'In refurb (not counted)', value:o.refurb, color:T.muted, separator:true}] : []),
                          ...(o.purchased ? [{label:'Purchased (not counted)', value:o.purchased, color:T.muted, separator:!o.refurb}] : []),
                          {label:'Vacancy cost (est)', value:fmt(dashProps.filter(p=>p.status==='vacant').reduce((s,p)=>s+(p.rent_pcm||0),0))+'/mo lost', color:T.red, separator:true},
                        ]}
                      />
                    )
                  }},
                  compliance_status: { icon:'clipboard-check', label:'Portfolio Compliance', render: () => {
                    // Same rollup as the Compliance overview cards: every
                    // tracked+applicable requirement per property, with
                    // insurance status pulled from the policy register.
                    const tracked = dashProps.filter(p => p.status !== 'sold' && !p.archived_at)
                    let expired = 0, expiring = 0, missingReq = 0, fully = 0, scored = 0
                    tracked.forEach(p => {
                      const s = propertyComplianceSummary(p, companySettings[p.company_id] || {}, insurancePolicies)
                      if (s.total === 0) return
                      scored++
                      expired += s.expired
                      expiring += s.expiring
                      missingReq += s.rows.filter(r => r.status.state === 'missing' && r.req.tier <= 2).length
                      if (s.expired === 0 && s.expiring === 0 && s.missing === 0) fully++
                    })
                    const accent = (expired > 0 || missingReq > 0) ? T.red : expiring > 0 ? T.amber : T.green
                    const sub = expired > 0 ? `${expired} expired · ${missingReq} missing required`
                      : missingReq > 0 ? `${missingReq} missing required`
                      : expiring > 0 ? `${expiring} expiring soon`
                      : 'All tracked items in date'
                    return (
                      <StatCard icon="clipboard-check" label="Portfolio Compliance" value={`${fully}/${scored}`} sub={sub} accent={accent}
                        onNavigate={()=>setView('compliance')} navLabel="Compliance"
                        breakdown={[
                          {label:'Properties fully in date', value:String(fully), color:T.green},
                          {label:'Expired items', value:String(expired), color:expired>0?T.red:T.muted},
                          {label:'Expiring within 60 days', value:String(expiring), color:expiring>0?T.amber:T.muted},
                          {label:'Missing required items', value:String(missingReq), color:missingReq>0?T.red:T.muted, note:'Legal certificates, licences and tenancy paperwork with nothing on file'},
                        ]}
                      />
                    )
                  }},
                }
                // Saved layout + defaults, resolved by the same helper the
                // Customize modal uses: a widget the user has never saved is
                // slotted where the default order puts it (the rent cards sit
                // beside Monthly Rental Income, not on a row of their own) and
                // starts with its default enabled flag.
                const currentWidgets = resolveWidgetPrefs(widgetPrefs, WIDGET_DEFAULT_ORDER, WIDGET_DEFAULT_ENABLED)
                const enabledWidgets = currentWidgets.filter(w => w.enabled && WIDGET_DEFS[w.key])
                const count = enabledWidgets.length
                return (
                  <div style={{marginBottom:20}}>
                    {/* Rows stretch to even heights; a card's detail panel is an
                        overlay (see StatCard) so opening one never resizes the row. */}
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':`repeat(${Math.min(count,5)},1fr)`,gap:10}}>
                      {enabledWidgets.map(w => (
                        <div key={w.key} style={{display:'contents'}}>{WIDGET_DEFS[w.key].render()}</div>
                      ))}
                    </div>
                  </div>
                )
              }

              function renderByCompany() {
                return (
                  <>
                    <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:14}}>By Company</h2>
                    {companies.length===0
                      ?<div className="card" style={{padding:32,textAlign:'center'}}>
                          <div style={{fontFamily:MONO,color:T.muted,fontSize:12,marginBottom:16}}>No companies yet. Add your first one to get started.</div>
                          <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>+ Add Company</button>
                        </div>
                      :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14,marginBottom:28}}>
                          {companyStats.map(c=>(
                            <div key={c.id} className="card" style={{padding:'20px 22px',borderLeft:`3px solid ${c.color}`}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:c.color,background:c.color+'22',padding:'3px 10px',borderRadius:4}}>{c.abbr}</div>
                                <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                                {[{l:'Properties',v:c.count},{l:'Rented',v:`${c.rented}/${c.count}`},{l:'Monthly Income',v:fmt(c.monthlyRent)},{l:'Arrears',v:fmt(c.arrears),red:c.arrears>0}].map((item,i)=>(
                                  <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                                    <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>{item.l}</div>
                                    <div style={{fontFamily:MONO,fontSize:15,fontWeight:700,color:item.red?T.red:T.goldText}}>{item.v}</div>
                                  </div>
                                ))}
                              </div>
                              <button className="btn btn-ghost" style={{width:'100%',marginTop:12,fontSize:11}} onClick={()=>{setCoFilter(c.id);setStatusFilter('all');setPortfolioTab('properties');setView('properties')}}>View Properties -&gt;</button>
                            </div>
                          ))}
                        </div>
                    }
                  </>
                )
              }

              // ── Render the visible sections in their preferred order ──
              const visibleSections = resolvedSections.filter(s => s.enabled)
              return (
                <>
                  {/* Customize Dashboard button — single source of truth for both sections and widget toggles */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:8}}>
                    <div style={{flex:'1 1 auto',minWidth:0,fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                      Dashboard · {visibleSections.length} sections shown
                    </div>
                    <button onClick={()=>{ setCustomizeDashTab('sections'); setShowCustomizeDash(true) }}
                      style={{fontFamily:MONO,fontSize:10,padding:'4px 10px',minHeight:28,borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                      Customise
                    </button>
                  </div>
                  {visibleSections.map(s => {
                    const def = SECTION_DEFS[s.key]
                    if (!def) return null
                    return <div key={s.key}>{def.render()}</div>
                  })}
                </>
              )
            })()}
          </div>}

          {view==='deals'&&<div className="fade">
            <DealsPage user={user} companies={companies} properties={properties} showToast={showToast} activeFlags={activeFlags}
              canUseInvestor={canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin })}
              onDealsChange={setDashboardDeals}
              convertRefreshKey={convertRefreshKey}
              onConvertToProperty={(deal)=>{
                // Map deal fields to property fields so the user doesn't
                // have to retype everything. Fields without a clean 1:1
                // mapping (e.g. timeline dates, deal_type) are dropped —
                // they live on the deal record. The user just fills in
                // anything that's specific to the property going forward
                // (estimated value, rent, tenancy details).
                //
                // Computed fields:
                //   mortgage_amount = purchase * (1 - deposit_percent/100)
                //   deposit         = purchase * deposit_percent/100
                // Cash deals get mortgage_amount=0, deposit=full price.
                const num = (v) => Number(v) || 0
                const price = num(deal.purchase_price)
                const depPct = num(deal.deposit_percent) || 25
                const isCash = deal.purchase_type === 'cash'
                const mortgageAmount = isCash ? 0 : Math.round(price * (1 - depPct / 100))
                const depositAmount  = isCash ? price : Math.round(price * depPct / 100)
                // Stamp duty: the user's override if they set one, otherwise
                // the SDLT calculator on the deal's flags. (There is no
                // stamp_duty column on deals — the previous fallback read one
                // and silently converted every non-overridden deal with £0.)
                const sd = deal.stamp_duty_override != null
                  ? num(deal.stamp_duty_override)
                  : api.calcStampDuty(price, deal.is_additional_property, deal.is_first_time_buyer)
                const prefill = {
                  // UI hint — lets PropertyModal start with the mortgage block
                  // hidden for cash deals. Stripped before save (no column).
                  is_cash:     isCash,
                  // Identity
                  name:        deal.name || deal.address || '',
                  address:     deal.address || '',
                  company_id:  deal.company_id || '',
                  // Money
                  purchase_price:  price || '',
                  stamp_duty:      sd || '',
                  legal_fees:      num(deal.legal_fees) || '',
                  mortgage_amount: mortgageAmount || '',
                  deposit:         depositAmount || '',
                  // Mortgage terms
                  mortgage_rate:   num(deal.mortgage_rate) || '',
                  mortgage_term:   num(deal.mortgage_term) || 25,
                  // Status: 'purchased' makes sense for a freshly converted
                  // deal — the user will switch it to 'refurb' or 'rented'
                  // once that phase begins.
                  status:          'purchased',
                  // Notes carry across — useful context for property
                  notes:           deal.notes || '',
                  // Source link — once we add a deal_id column on properties
                  // this would be deal.id. For now we just store a
                  // breadcrumb in notes if there isn't already a notes
                  // value, so the user can find their way back to the deal.
                  // Skipped to avoid clobbering — left as a TODO.
                }
                setEditProp(prefill)
                // Remember which deal this came from. Once the property is
                // saved we soft-delete this deal so it leaves the Deals page.
                setConvertSourceDealId(deal.id)
                setConvertSourceDeal(deal)
                setShowAddProp(true)
                showToast('Deal data pre-filled — review and save')
              }}/>
          </div>}

          {view==='properties'&&<div className="fade">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div style={{flex:'1 1 auto',minWidth:0}}>
                <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio</h1>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{filtered.length} of {plural(properties.length,'property','properties')} shown</div>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {[['properties','building','Properties'],['companies','grid','Companies'],['map','map','Map'],['contractors','wrench','Contractors']].map(([k,ic,l])=>(
                  <button key={k} onClick={()=>setPortfolioTab(k)}
                    style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:MONO,fontSize:11,padding:'6px 14px',borderRadius:8,cursor:'pointer',
                      border:`1px solid ${portfolioTab===k?T.gold:T.border}`,
                      background:portfolioTab===k?T.gold:'transparent',
                      color:portfolioTab===k?'#1C2830':T.muted,fontWeight:portfolioTab===k?700:400}}>
                    <Icon name={ic} size={14}/>{l}
                  </button>
                ))}
              </div>
            </div>
            {portfolioTab==='companies'&&<CompaniesPanel companies={companies} setCompanies={setCompanies} user={user} showToast={showToast} companySettings={companySettings} setCompanySettings={setCompanySettings} T={T}/>}
            {/* The Compliance matrix moved to the top-level Compliance page
                (#/compliance/matrix); legacy #/properties/compliance links
                are mapped across in parseHash. */}
            {portfolioTab==='contractors'&&<ContractorsPage user={user} companies={companies} showToast={showToast}/>}
            {portfolioTab==='map'&&<>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
                <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                {[{id:'all',abbr:'All',color:T.goldText},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted,transition:'all 0.18s'}}>{c.abbr||c.name}</button>
                ))}
              </div>
              <PropertyMap
                properties={filtered}
                setProperties={setProperties}
                showToast={showToast}
                onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}/>
            </>}
            {portfolioTab==='properties'&&<div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,marginBottom:16,flexWrap:'wrap'}}>
              {/* 🏦 Building Mortgage — bulk-edit mortgage details across
                  every unit in a building in one save. Hidden unless the
                  user can edit properties; modal itself handles the case
                  where there are no multi-unit buildings yet. */}
              <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:'nowrap'}}
                onClick={()=>setShowBuildingMortgage(true)}
                disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive}
                title="Update a mortgage across all units in a building in one go"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="landmark" size={14}/>Building Mortgage</span></button>
              <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>openWorkflow('bulk-add')} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title="Add a block of flats (multiple units in one building)"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="building" size={14}/>+ Add Block</span></button>
              <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive ? 'You don\'t have permission to add properties to this company' : ''}>+ Add Property</button>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
              <div style={{flex:'1 1 220px',minWidth:0,maxWidth:'100%',position:'relative',display:'flex',alignItems:'center'}}>
                <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Search properties" placeholder="Search name, address, building, unit or tenant…" style={{flex:1,minWidth:0,width:'auto',padding:'7px 30px 7px 12px',fontSize:12}}/>
                {searchQ&&<button type="button" onClick={()=>setSearchQ('')} aria-label="Clear search" title="Clear search"
                  style={{position:'absolute',right:6,background:'transparent',border:'none',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,padding:'2px 4px'}}>×</button>}
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[{id:'all',abbr:'All',color:T.goldText},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted,transition:'all 0.18s'}}>{c.abbr||c.name}</button>
                ))}
                <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                {['all', ...PROPERTY_STATUSES].map(f=>(
                  <button key={f} onClick={()=>setStatusFilter(f)} aria-pressed={statusFilter===f} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold:'transparent',color:statusFilter===f?'#1C2830':T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':(PROPERTY_STATUS_LABELS[f] || STATUS_CFG[f]?.label || f)}</button>
                ))}
                {archivedCount > 0 && (
                  <>
                    <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                    <button onClick={()=>setShowArchived(v=>!v)}
                      title={showArchived ? `Hide ${archivedCount} archived` : `Show ${archivedCount} archived`}
                      style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                        border:`1px solid ${showArchived?T.muted:T.border}`,
                        background:showArchived?T.muted+'22':'transparent',
                        color:showArchived?T.text:T.muted,transition:'all 0.18s',display:'inline-flex',alignItems:'center',gap:5}}>
                      <Icon name="trash" size={12}/>{showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Sort control */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>Sort by:</span>
              {[
                {v:'company-name', l:'Company / Name'},
                {v:'name',         l:'Name A-Z'},
                {v:'status',       l:'Status'},
                {v:'rent-high',    l:'Rent (High-Low)'},
                {v:'yield-high',   l:'Yield (High-Low)'},
                {v:'arrears',      l:'Arrears'},
                {v:'value-high',   l:'Value (High-Low)'},
                {v:'custom',       l:'Custom Order'},
              ].map(opt=>(
                <button key={opt.v} onClick={()=>setSortBy(opt.v)} aria-pressed={sortBy===opt.v}
                  style={{fontFamily:MONO,fontSize:isMobile?9:10,padding:isMobile?'3px 8px':'4px 12px',minHeight:28,borderRadius:20,cursor:'pointer',
                    border:`1px solid ${sortBy===opt.v?T.gold:T.border}`,
                    background:sortBy===opt.v?T.gold:'transparent',
                    color:sortBy===opt.v?'#1C2830':T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
                  {opt.l}
                </button>
              ))}
              {sortBy==='custom'&&(
                <button onClick={resetCustomOrder} title="Reset to the default order (company → building → unit)"
                  style={{fontFamily:MONO,fontSize:isMobile?9:10,padding:isMobile?'3px 8px':'4px 12px',minHeight:28,borderRadius:20,cursor:'pointer',
                    border:`1px dashed ${T.border}`,background:'transparent',color:T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
                  ↺ Reset to default
                </button>
              )}
              {/* List / Grid layout toggle (grid is the redesign card view) */}
              <div style={{display:'flex',gap:2,marginLeft:'auto',background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:2}}>
                {[['list','list','List'],['grid','grid-2','Grid']].map(([k,ic,lbl])=>(
                  <button key={k} onClick={()=>setPropLayout(k)} title={`${lbl} view`} aria-label={`${lbl} view`} aria-pressed={propLayout===k}
                    style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',minHeight:28,minWidth:36,justifyContent:'center',borderRadius:7,cursor:'pointer',border:'none',
                      background:propLayout===k?T.gold:'transparent',color:propLayout===k?'#1C2830':T.muted,
                      fontFamily:MONO,fontSize:10,fontWeight:propLayout===k?700:400}}>
                    <Icon name={ic} size={14}/>{!isMobile&&lbl}
                  </button>
                ))}
              </div>
            </div>
            {propLayout==='grid'
              ? <PropertyGrid filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} yieldBasis={yieldBasis}/>
              : <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy} yieldBasis={yieldBasis}/>}
            </div>}
          </div>}

          {/* Standalone Companies view removed — Companies now lives solely
              as a Portfolio sub-tab (#/properties/companies); legacy #/companies
              deep links are mapped across in parseHash. */}
          {view==='rent'&&<RentTrackerOverview companies={companies} properties={activeProperties} fmt={fmt} openDetail={openDetail} onDayTracker={()=>setView('daytracker')} yieldBasis={yieldBasis} onRefresh={refreshData} showToast={showToast} canSeed={cid=>canDo(permissionsMap, cid, 'edit_tenancies') || devModeActive} canEditRent={cid=>canDo(permissionsMap, cid, 'edit_rent') || devModeActive}/>}
          {view==='stl'&&<ShortTermLetIncomePage companies={companies} properties={activeProperties} permissionsMap={permissionsMap} devModeActive={devModeActive} showToast={showToast} openDetail={openDetail} onPropertyUpdated={(id, patch)=>setProperties(prev=>prev.map(p=>p.id===id?{...p,...patch}:p))}/>}
          {view==='refurbs'&&<RefurbsPage user={user} companies={companies} properties={activeProperties} permissionsMap={permissionsMap} devModeActive={devModeActive} showToast={showToast} openDetail={openDetail} onPropertyPatch={(id, patch)=>setProperties(prev=>prev.map(p=>p.id===id?{...p,...patch}:p))}/>}
          {view==='loans'&&<ExternalLoansPage companies={companies} companySettings={companySettings} properties={activeProperties} permissionsMap={permissionsMap} devModeActive={devModeActive} showToast={showToast} openDetail={openDetail}/>}
          {view==='daytracker'&&<DayTrackerPage companies={companies} properties={activeProperties} setProperties={setProperties} showToast={showToast} onBack={()=>setView('rent')}
            canEdit={companyId => canDo(permissionsMap, companyId, 'edit_rent') || devModeActive}/>}
          {view==='settings'&&<SettingsPage companies={companies} setCompanies={setCompanies} companySettings={companySettings} setCompanySettings={setCompanySettings} user={user} showToast={showToast} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} darkMode={darkMode} setDarkMode={setDarkMode} userNavPrefs={userNavPrefs} setUserNavPrefs={setUserNavPrefs} yieldBasis={yieldBasis} setYieldBasis={setYieldBasis} accountType={accountType} setAccountType={setAccountType} properties={activeProperties} activeFlags={activeFlags} companySubs={companySubs} activeCompanyId={activeCoTab||null} permissionsMap={permissionsMap} devModeActive={devModeActive}/>}
          {view==='reports'&&<div className="fade"><ReportsPage properties={properties} companies={companies} companySettings={companySettings} user={user} activeFlags={activeFlags} selectedReportId={selectedReportId} onSelectReport={setSelectedReportId}/></div>}
          {view==='mtd'&&<div className="fade"><MtdItsaPage properties={activeProperties} accountType={accountType}/></div>}
          {view==='compliance'&&<div className="fade"><CompliancePage user={user} companies={companies} properties={activeProperties} companySettings={companySettings} showToast={showToast} openDetail={(p)=>openDetail(p,'compliance')}/></div>}
          {view==='feedback'&&<div className="fade"><FeedbackPage user={user} showToast={showToast}/></div>}
          {view==='import'&&<StatementImporter asPage initialDocIds={importDocs} properties={activeProperties} companies={companies} showToast={showToast} onClose={()=>{closeWorkflow(); refreshData()}}
            canEdit={companyId => canDo(permissionsMap, companyId, 'edit_rent') || devModeActive}/>}
          {view==='statement-audit'&&<StatementAuditPage user={user} showToast={showToast} onClose={closeWorkflow}/>}
          {view==='import-data'&&<DataImporter asPage properties={activeProperties} companies={companies} showToast={showToast} onClose={()=>{closeWorkflow(); refreshData()}}
            canEdit={companyId => canDo(permissionsMap, companyId, 'edit_rent') || devModeActive}/>}
          {view==='bulk-add'&&<BulkAddPropertyModal asPage
            companies={companies.filter(c=>!isHoldingCompany(c))}
            onClose={closeWorkflow}
            onSaved={(created)=>{
              setProperties(prev => [...prev, ...created])
              setPortfolioTab('properties')
              setView('properties')
            }}
            showToast={showToast}
          />}
          {view==='autopilot'&&activeFlags.has('portfolio_autopilot')&&<div className="fade"><AutopilotPage companyId={activeCoTab||null} companies={companies}/></div>}
          {view==='renters-rights'&&activeFlags.has('renters_rights')&&<div className="fade"><RentersRightsCopilot companyId={activeCoTab||null}/></div>}
          {/* A bookmark/shared link can name a flag-gated view the account
              doesn't have — say so instead of rendering an empty pane. */}
          {((view==='autopilot'&&!activeFlags.has('portfolio_autopilot'))||(view==='renters-rights'&&!activeFlags.has('renters_rights')))&&(
            <div className="card fade" style={{padding:'40px 32px',textAlign:'center'}}>
              <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="lock" size={32} color={T.muted}/></div>
              <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>This feature isn't enabled for your account</h1>
              <p style={{fontFamily:MONO,fontSize:12,color:T.muted,marginBottom:20,maxWidth:440,margin:'0 auto 20px',lineHeight:1.6}}>
                {view==='autopilot'?'Portfolio Autopilot':'The Renters Rights copilot'} is rolling out gradually. If you'd like early access, send us a message from the Feedback page.
              </p>
              <button className="btn btn-gold" onClick={()=>setView('dashboard')}>Back to Dashboard</button>
            </div>
          )}

          {view==='detail'&&!selected&&<div className="fade" style={{padding:40,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔒</div>
            <h2 style={{fontSize:20,color:T.text,marginBottom:8}}>Property not found</h2>
            <p style={{fontFamily:MONO,fontSize:12,color:T.muted,marginBottom:20}}>
              This property doesn't exist or you don't have access to it.
            </p>
            <button className="btn btn-gold" onClick={closeDetail}>&lt;- Back to Properties</button>
          </div>}

          {view==='detail'&&selected&&<div className="fade">
            <button className="btn btn-ghost" style={{marginBottom:20,fontSize:11}} onClick={closeDetail}>&lt;- Back</button>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 280px',gap:18,alignItems:'start'}}>
              <div style={{minWidth:0}}>
                <div className="card" style={{padding:isMobile?'18px 16px':'24px 28px',marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
                    <div style={{flex:'1 1 auto',minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}><CompanyPill company={selected.company}/><Badge status={selected.status}/></div>
                      <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:3}}>{selected.name}</h1>
                      <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{selected.address}</div>
                      <div style={{fontFamily:MONO,fontSize:11,color:T.faint}}>{selected.prop_type}</div>
                      {selected.managed_by&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,padding:'2px 10px',borderRadius:20,background:'#1A1D27',border:'1px solid #2E3044',fontFamily:MONO,fontSize:10,color:'#8B8FA8'}}>🏢 {selected.managed_by}</div>}
                      {selected.archived_at&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,marginLeft:6,padding:'2px 10px',borderRadius:20,background:T.bg,border:`1px solid ${T.border}`,fontFamily:MONO,fontSize:10,color:T.muted}}>Archived {new Date(selected.archived_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>}
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      {(canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive) && (
                        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditProp(selected);setShowAddProp(true)}}>Edit</button>
                      )}
                      {(() => {
                        const canEdit = canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive
                        return (
                          <ActionMenu items={[
                            // Duplicate / Mark sold / Archive / Delete all mutate the property — gate by edit permission
                            ...(canEdit ? [{ label: 'Duplicate property', icon: '⊕',
                              onSelect: () => handleDuplicateProp(selected.id) }] : []),
                            ...(canEdit && selected.status !== 'sold' ? [{
                              label: 'Mark as sold', icon: '£',
                              onSelect: () => setShowSellModal(selected.id) }] : []),
                            // Export PDF is read-only — available to anyone who can see the property
                            { label: 'Export PDF summary', icon: '⤓',
                              onSelect: async () => {
                                try { await api.exportPropertySummaryPDF(selected) }
                                catch(e) { showToast(e.message, 'error') }
                              }},
                            ...(canEdit ? [
                              { divider: true },
                              ...(selected.archived_at
                                ? [{ label: 'Restore from archive', icon: '↩',
                                     onSelect: () => handleArchiveProp(selected.id, false) }]
                                : [{ label: 'Archive property', icon: '📦',
                                     onSelect: async () => {
                                       if (await confirmDialog({
                                         title: 'Archive this property?',
                                         body: 'It will be hidden from the active list and dashboard. You can restore it later.',
                                         confirmLabel: 'Archive',
                                       }))
                                         handleArchiveProp(selected.id, true)
                                     }}]
                              ),
                              { label: 'Delete property', icon: 'trash',
                                destructive: true,
                                onSelect: () => setShowDeleteConfirm(selected.id) },
                            ] : []),
                          ]}/>
                        )
                      })()}
                    </div>
                  </div>
                </div>
                {(()=>{
                  const co = selected?.company_id
                  const cs = companySettings[co] || {}
                  // Top-level tabs: 9 max. Tenancy-related sub-views (Right to Rent / Deposit /
                  // Notices / Rent History) are now nested inside Tenancy as sub-tabs to keep
                  // the top row scannable. Old deep-link URLs (#/detail/<id>/deposit etc.) still
                  // work because the tenancy section detects sub-tab URLs and switches accordingly.
                  const tabs = ['overview','refurb','rent','financials']
                  if(cs.feature_compliance)  tabs.push('compliance')
                  if(cs.feature_tenancy)     tabs.push('tenancy')
                  if(cs.feature_maintenance) tabs.push('maintenance')
                  if(cs.feature_documents)   tabs.push('documents')
                  if(cs.feature_expenses)    tabs.push('expenses')
                  if(selected.is_hmo || activeFlags.has('hmo_rooms')) tabs.push('rooms')
                  if(activeFlags.has('epc_planner')) tabs.push('epc-plan')
                  // Tab keys are URL slugs (they form the #/detail/<id>/<tab>
                  // segment — keys with spaces came back percent-encoded on
                  // refresh and matched nothing, rendering a blank pane).
                  // Multi-word keys need explicit display labels.
                  const TAB_LABELS = { 'epc-plan': 'EPC Plan' }
                  // Treat tenancy sub-tab URLs as if "tenancy" is the active top-level tab
                  const TENANCY_SUB = ['right-to-rent','deposit','notices','rent-history']
                  const activeTop = TENANCY_SUB.includes(detailTab) ? 'tenancy' : detailTab
                  return (
                    <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                      {tabs.map(t=>(
                        <button key={t} className={`tab ${activeTop===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:TAB_LABELS[t]?'none':'capitalize'}}>{TAB_LABELS[t]||t}</button>
                      ))}
                    </div>
                  )
                })()}
                {detailTab==='overview'&&<OverviewTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditProperty={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}

                {/* Rent-at-a-glance — most landlords arriving from Rent
                    Tracker care about rent more than property metadata.
                    Show this year's payment dots + YTD summary + a
                    "Open full rent tracker" CTA. Stays on Overview so
                    they don't need to switch tabs.

                    Renders only when there's payment data; for brand-new
                    properties we skip it so the Overview isn't padded
                    with empty cards. */}
                {detailTab==='overview' && (() => {
                  const payments = selected.rent_payments || []
                  if (payments.length === 0) return null
                  // Current year when it has data, else the most recent
                  // year that does (shared defaultRentYear helper).
                  const focusYear = defaultRentYear(payments)
                  // Month-collapsed stats — same maths as the Rent Tracker
                  // page so the two screens agree for the same year.
                  const { paid, missed, late, income: collected } = getMonthlyRentStats(payments, focusYear, selected.rent_pcm)
                  const arrears = selected.arrears || 0

                  return (
                    <div className="card" style={{padding:'16px 20px',marginTop:14,borderLeft:`3px solid ${T.green}`}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                            Rent · {focusYear}
                          </div>
                          {arrears > 0 && (
                            <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.red+'22',color:T.red}}>
                              {fmt(arrears)} in arrears
                            </span>
                          )}
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:10}} onClick={()=>setDetailTab('rent')}>
                          Full history →
                        </button>
                      </div>

                      {/* Year of dots */}
                      <RentDots payments={payments} filterYear={focusYear} stlIds={stlPaymentIds(selected)} property={selected}
                        onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})}
                        onDayTracker={(canDo(permissionsMap, selected.company_id, 'edit_rent') || devModeActive) ? ()=>setView('daytracker') : undefined}/>

                      {/* YTD summary — compact 4-stat grid */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:14}}>
                        {[
                          {l:'Months paid',    v:paid,             c:T.green,  sub:fmt(collected)},
                          {l:'Months missed',  v:missed,           c:missed>0?T.red:T.muted,    sub:missed>0?fmt(missed*(selected.rent_pcm||0)):''},
                          {l:'Months late',    v:late,             c:late>0?T.amber:T.muted},
                          {l:'Monthly rent',   v:fmt(selected.rent_pcm), c:T.gold},
                        ].map((item,i)=>(
                          <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                            <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                            <div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:item.c}}>{item.v}</div>
                            {item.sub&&<div style={{fontFamily:MONO,fontSize:9,color:T.faint,marginTop:2}}>{item.sub}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {detailTab==='overview' && (() => {
                  // Insurance summary: find policies covering THIS property.
                  // Includes:
                  //  - policies with an explicit property link
                  //  - company-wide policies (no property links) belonging to
                  //    the same company as this property
                  const myPolicies = insurancePolicies.filter(pol => {
                    if (pol.company_id !== selected.company_id) return false
                    const links = pol.properties || []
                    return links.length === 0 || links.some(p => p.id === selected.id)
                  })
                  if (myPolicies.length === 0) {
                    return (
                      <div className="card" style={{padding:'14px 20px',marginTop:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                        <div>
                          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Insurance</div>
                          <div style={{fontFamily:MONO,fontSize:12,color:T.muted}}>No policies cover this property yet.</div>
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{window.location.hash='#/compliance/insurance'}}>Add policy →</button>
                      </div>
                    )
                  }
                  // Show the next-expiring policy prominently, with a small
                  // list of any others. Sorted by expiry date ascending.
                  const sorted = [...myPolicies].sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date))
                  const today = new Date(); today.setHours(0,0,0,0)
                  return (
                    <div className="card" style={{padding:'16px 20px',marginTop:14}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                          Insurance · {myPolicies.length} {myPolicies.length===1?'policy':'policies'}
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:10}} onClick={()=>{window.location.hash='#/compliance/insurance'}}>Manage →</button>
                      </div>
                      <div style={{display:'grid',gap:6}}>
                        {sorted.map(pol => {
                          const expiry = new Date(pol.expiry_date)
                          const days = Math.floor((expiry - today) / (1000*60*60*24))
                          const color = days < 0 ? T.red : days <= 30 ? T.amber : days <= 90 ? T.gold : T.green
                          const status = days < 0
                            ? `Expired ${Math.abs(days)} ${Math.abs(days)===1?'day':'days'} ago`
                            : `Renews in ${days} ${days===1?'day':'days'}`
                          const isCompanyWide = (pol.properties || []).length === 0
                          return (
                            <div key={pol.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:12,alignItems:'center',padding:'8px 10px',background:T.bg,borderRadius:8,borderLeft:`3px solid ${color}`}}>
                              <div style={{minWidth:0}}>
                                <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                                  {pol.policy_name}
                                  {isCompanyWide && <span style={{fontSize:9,color:T.muted,marginLeft:6,fontWeight:400}}>· company-wide</span>}
                                </div>
                                <div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>{pol.provider || '—'} · expires {pol.expiry_date}</div>
                              </div>
                              <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:color}}>{status}</div>
                              <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{fmt(pol.premium)}/yr</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
                {false&&detailTab==='overview-old'&&<div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
                    {[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)},{l:'Total Invested',v:fmt((selected.purchase_price||0)+(selected.refurb_cost||0)),gold:true},{l:'Est. Value',v:fmt(selected.est_value)},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(1)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0}].map((item,i)=>(
                      <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
                        <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
                        <div style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:item.gold?T.goldText:item.green?T.green:T.text}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  {selected.notes&&<div className="card" style={{padding:'16px 20px'}}>
                    <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Notes</div>
                    <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
                  </div>}
                </div>}
                {detailTab==='refurb'&&<RefurbPropertyTab property={selected} companies={companies} properties={properties} permissionsMap={permissionsMap} devModeActive={devModeActive} showToast={showToast} onPropertyPatch={(id, patch)=>setProperties(prev=>prev.map(p=>p.id===id?{...p,...patch}:p))} openRefurbs={()=>{setSelectedId(null);setView('refurbs')}}/>}
                {detailTab==='rent'&&<RentTab selected={selected} fmt={fmt} setEditingPayment={setEditingPayment} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} onDayTracker={()=>setView('daytracker')} canEdit={canDo(permissionsMap, selected.company_id, 'edit_rent') || devModeActive}/>}
                {detailTab==='financials'&&<FinancialsTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} calcMonthlyProfit={calcMonthlyProfit} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditFinancial={canDo(permissionsMap, selected.company_id, 'edit_financial') || devModeActive}/>}
                {false&&<div style={{display:'grid',gap:12}}>
                  {[{title:'Purchase & Costs',items:[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Deposit',v:fmt(selected.deposit)},{l:'Mortgage Amount',v:fmt(selected.mortgage_amount)},{l:'Stamp Duty',v:fmt(selected.stamp_duty)},{l:'Legal Fees',v:fmt(selected.legal_fees)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)}]},{title:'Mortgage',items:[{l:'Rate',v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'-'},{l:'Term',v:selected.mortgage_term?selected.mortgage_term+' years':'-'},{l:'Monthly (Repay)',v:fmt(calcMonthlyMortgage(selected))},{l:'Monthly (IO)',v:selected.mortgage_amount&&selected.mortgage_rate?fmt(selected.mortgage_amount*selected.mortgage_rate/12):'-'}]},{title:'Returns',items:[{l:'Monthly Rent',v:fmt(selected.rent_pcm),gold:true},{l:'Annual Rent',v:fmt((selected.rent_pcm||0)*12),gold:true},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(2)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0},{l:'Annual Profit',v:fmt(calcMonthlyProfit(selected)*12),green:calcMonthlyProfit(selected)>0}]}].map((section,si)=>(
                    <div key={si} className="card" style={{padding:'18px 22px'}}>
                      <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        {section.items.map((item,i)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                            <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                            <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:item.gold?T.goldText:item.green?T.green:T.text}}>{item.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>}
                {/* NOTE: no 'contractors' detail tab — it was renderable here
                    but never present in the tab strip, so it was reachable
                    only by hand-typed URL with nothing highlighted. Property-
                    scoped contractor history lives in Maintenance. */}
                {(detailTab==='overview'||detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&<TenancyRenewalAlert propertyId={selected.id} rentPcm={selected.rent_pcm} userId={user?.id} showToast={showToast} T={T}/>}
                {detailTab==='compliance'&&<ComplianceTab propertyId={selected.id} property={selected} companySettings={companySettings[selected.company_id]||{}}
                  onPropertyChange={(patch)=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,...patch}:p))}
                  showToast={showToast} isAdmin={isAdmin} user={user} category="compliance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_compliance') || devModeActive}/>}
                {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&(()=>{
                  // The four legacy values map to themselves as sub-tabs; "tenancy" => "details".
                  const subTab = detailTab==='tenancy' ? 'details' : detailTab
                  const SUBS = [
                    ['details',       'Details'],
                    ['right-to-rent', 'Right to Rent'],
                    ['deposit',       'Deposit'],
                    ['notices',       'Notices'],
                    ['rent-history',  'Rent History'],
                  ]
                  return (
                    <div>
                      <div style={{display:'flex',gap:2,marginBottom:14,flexWrap:'wrap',borderBottom:`1px solid ${T.border}`,paddingBottom:0,alignItems:'center'}}>
                        {SUBS.map(([k,label])=>(
                          <button key={k}
                            onClick={()=>setDetailTab(k==='details' ? 'tenancy' : k)}
                            style={{
                              fontFamily:MONO,fontSize:11,padding:'8px 14px',
                              border:'none',borderBottom:`2px solid ${subTab===k?T.gold:'transparent'}`,
                              background:'transparent',cursor:'pointer',
                              color:subTab===k?T.text:T.muted,
                              fontWeight:subTab===k?700:400,
                              transition:'all 0.15s',
                              marginBottom:-1,
                            }}>
                            {label}
                          </button>
                        ))}
                        <button onClick={()=>setShowReferencing(true)}
                          style={{
                            marginLeft:'auto',marginBottom:6,
                            fontFamily:MONO,fontSize:11,fontWeight:700,
                            padding:'5px 12px',borderRadius:6,
                            border:`1px solid ${T.gold}66`,background:T.gold+'14',color:T.goldText,
                            cursor:'pointer',display:'flex',alignItems:'center',gap:6,
                          }}>
                          Tenant Referencing
                          <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.gold+'33',color:T.goldText}}>EARLY</span>
                        </button>
                      </div>
                      {subTab==='details'      &&<><TenancyPanel property={selected} showToast={showToast} canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive} onChanged={t=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,tenancies:t}:p))}/><TenancyTab key={selected.id} propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="tenancy" canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive}/></>}
                      {subTab==='right-to-rent'&&<RightToRentTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='deposit'      &&<DepositProtectionTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='notices'      &&<NoticeTrackerTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T} property={selected}/>}
                      {subTab==='rent-history' &&<RentHistoryTab propertyId={selected.id} userId={user?.id} currentRent={selected.rent_pcm} showToast={showToast} T={T} property={selected}/>}
                    </div>
                  )
                })()}
                {detailTab==='maintenance'&&<MaintenanceTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="maintenance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_maintenance') || devModeActive} activeFlags={activeFlags}/>}
                {detailTab==='expenses'&&<ExpensesTab propertyId={selected.id} showToast={showToast} fmt={fmt} rentPcm={selected.rent_pcm||0} isAdmin={isAdmin} user={user} category="expenses" canEdit={canDo(permissionsMap, selected.company_id, 'edit_expenses') || devModeActive} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive}/>}
                {detailTab==='documents'&&<DocumentsTab key={selected.id} propertyId={selected.id} propertyName={selected.name} showToast={showToast} isAdmin={isAdmin} user={user}/>}
                {detailTab==='rooms'&&(selected.is_hmo||activeFlags.has('hmo_rooms'))&&<HmoRoomsPanel propertyId={selected.id} isHmo={!!selected.is_hmo} onHmoChange={v=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,is_hmo:v}:p))} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
                {detailTab==='epc-plan'&&activeFlags.has('epc_planner')&&<EpcPlanner property={selected} T={T} canWrite={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
                {activeFlags.has('rent_collection')&&(detailTab==='rent'||detailTab==='rent-history')&&<RentCollectionPanel property={selected} companyId={selected.company_id} tenantUserId={null}/>}
                {detailTab==='documents'&&activeFlags.has('esign')&&<ESignPanel propertyId={selected.id} companyId={selected.company_id} documents={[]} T={T}/>}
                {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&activeFlags.has('referencing')&&<ReferencingPanel propertyId={selected.id} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
              </div>
              <div style={{display:'grid',gap:12}}>
                <div className="card" style={{padding:'18px 20px'}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Quick Stats</div>
                  {(() => {
                    const cv = selected.current_value || selected.est_value || 0
                    const totalCapIn = (selected.deposit||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)+(selected.refurb_cost||0)
                    const eq = cv - (selected.mortgage_amount||0)
                    const ltvNum = cv && selected.mortgage_amount ? (selected.mortgage_amount/cv)*100 : null
                    return [
                      {l:'Total Capital In', v:fmt(totalCapIn),
                        explain: {
                          title: 'Total Capital In',
                          formula: 'Deposit + Stamp Duty + Legal Fees + Refurb Cost',
                          inputs: [
                            { label: 'Deposit',     value: fmt(selected.deposit) },
                            { label: 'Stamp Duty',  value: fmt(selected.stamp_duty) },
                            { label: 'Legal Fees',  value: fmt(selected.legal_fees) },
                            { label: 'Refurb Cost', value: fmt(selected.refurb_cost) },
                          ],
                          result: fmt(totalCapIn),
                          note: !selected.mortgage_amount
                            ? "Heads up: this property has no mortgage recorded. For cash purchases, you may want to add the Purchase Price into Deposit so this number reflects the true cash you put in."
                            : "Cash you actually put in (excluding the mortgage). For mortgage purchases this is your real out-of-pocket.",
                        }},
                      {l:'Current Value', v:fmt(cv),
                        explain: {
                          title: 'Current Value',
                          formula: 'Current Value (or Estimated Value as fallback)',
                          inputs: [
                            { label: 'Current Value',   value: selected.current_value ? fmt(selected.current_value) : '— (not set)' },
                            { label: 'Estimated Value', value: fmt(selected.est_value) },
                          ],
                          result: fmt(cv),
                          note: 'Set Current Value separately on Overview to track market changes vs. your initial estimate.',
                        }},
                      {l:'Equity', v:fmt(eq),
                        explain: {
                          title: 'Equity',
                          formula: 'Current Value − Mortgage Amount',
                          inputs: [
                            { label: 'Current Value',   value: fmt(cv) },
                            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                          ],
                          result: fmt(eq),
                          note: 'Your stake today. Goes negative if mortgage > value.',
                        }},
                      {l:'LTV', v: ltvNum !== null ? ltvNum.toFixed(0)+'%' : '-',
                        explain: {
                          title: 'Loan to Value (LTV)',
                          formula: 'Mortgage Amount ÷ Current Value × 100',
                          inputs: [
                            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                            { label: 'Current Value',   value: fmt(cv) },
                          ],
                          result: ltvNum !== null ? ltvNum.toFixed(1)+'%' : '— (no mortgage or value)',
                        }},
                    ]
                  })().map((item,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8,marginBottom:6}}>
                      <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                      <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.goldText,display:'inline-flex',alignItems:'center',gap:2}}>
                        {item.v}
                        {item.explain && <CalcExplain {...item.explain}/>}
                      </span>
                    </div>
                  ))}
                </div>
                {(selected.arrears||0)>0&&<div className="card" style={{padding:'16px 18px',borderLeft:`3px solid ${T.red}`}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.red,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Rent Arrears</div>
                  <div style={{fontFamily:MONO,fontSize:22,fontWeight:700,color:T.red,marginBottom:4}}>{fmt(selected.arrears)}</div>
                  {selected.notes&&<div style={{fontFamily:MONO,fontSize:11,color:T.muted,lineHeight:1.6}}>{selected.notes}</div>}
                </div>}
              </div>
            </div>
          </div>}
        </Suspense></ErrorBoundary>}
      </main>

      <CommandPalette open={showPalette} commands={paletteCommands} onClose={()=>setShowPalette(false)}/>
      {showReferencing && selected && <TenantReferenceModal property={selected} onClose={()=>setShowReferencing(false)}/>}
      {showAddProp&&<PropertyModal prop={editProp} companies={companies.filter(c=>!isHoldingCompany(c))} onClose={()=>{setShowAddProp(false);setEditProp(null);setConvertSourceDealId(null)}} onSave={handleSaveProp}/>}
      {showBuildingMortgage && <BuildingMortgageModal
        properties={activeCoTab ? activeProperties.filter(p => p.company_id === activeCoTab) : activeProperties}
        setProperties={setProperties}
        onClose={()=>setShowBuildingMortgage(false)}
      />}
      {showReceiptScan && <Suspense fallback={null}><ReceiptScanModal
        properties={activeProperties}
        onClose={()=>setShowReceiptScan(false)}
        onSaved={()=>{ /* expense saved — no refetch needed at App level */ }}
      /></Suspense>}
      {showAddCo&&<CompanyModal onClose={()=>setShowAddCo(false)} onSave={handleSaveCo}/>}
      {showCustomizeDash && <CustomizeDashModal
        initialTab={customizeDashTab}
        sectionDefs={SECTION_META}
        currentSectionPrefs={sectionPrefs}
        defaultSectionOrder={SECTION_DEFAULT_ORDER}
        defaultSectionEnabled={SECTION_DEFAULT_ENABLED}
        onSave={async (sections, widgets) => {
          setSectionPrefs(sections)
          setWidgetPrefs(widgets)
          // Don't pretend it's saved if the API call failed — the user
          // would see "Dashboard saved" and then their changes vanish on
          // next refresh with no clue why.
          try {
            await Promise.all([api.saveSectionPrefs(sections), api.saveWidgetPrefs(widgets)])
            showToast('Dashboard saved')
          } catch (e) {
            logError('saveDashboardPrefs', e)
            showToast('Dashboard not saved — ' + (e.message || 'try again'), 'error')
          }
        }}
        widgetDefs={WIDGET_META}
        currentWidgetPrefs={widgetPrefs}
        defaultWidgetOrder={WIDGET_DEFAULT_ORDER}
        defaultWidgetEnabled={WIDGET_DEFAULT_ENABLED}
        onClose={() => setShowCustomizeDash(false)}
        T={T}
      />}
      {renameCoTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:420,padding:'32px 28px',border:`1px solid ${T.border}`}}>
            <div style={{fontSize:32,marginBottom:12,textAlign:'center'}}>✏️</div>
            <h2 style={{fontSize:18,fontWeight:700,textAlign:'center',marginBottom:6}}>Rename company</h2>
            <p style={{fontFamily:MONO,fontSize:12,color:T.muted,textAlign:'center',marginBottom:24}}>Currently: <strong style={{color:T.text}}>{renameCoTarget.name}</strong></p>
            <div style={{display:'grid',gap:14,marginBottom:20}}>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>New company name</label>
                <input aria-label="New company name" value={renameCo.name} onChange={e=>setRenameCo(p=>({...p,name:e.target.value}))} autoFocus
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation (up to 5 chars)</label>
                <input aria-label="Abbreviation (up to 5 chars)" value={renameCo.abbr} onChange={e=>setRenameCo(p=>({...p,abbr:e.target.value.toUpperCase().slice(0,5)}))} placeholder="e.g. ACME"
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your password to confirm</label>
                <input aria-label="Your password to confirm" type="password" value={renameCoPassword} onChange={e=>{setRenameCoPassword(e.target.value);setRenameCoError('')}}
                  placeholder="Enter your password"
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1.5px solid ${renameCoError?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',boxSizing:'border-box'}}/>
                {renameCoError&&<div style={{fontFamily:MONO,fontSize:11,color:T.red,marginTop:6}}>{renameCoError}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setRenameCoTarget(null)}
                style={{flex:1,fontFamily:MONO,fontSize:12,padding:'11px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                Cancel
              </button>
              <button onClick={handleRenameCompany} disabled={renameCoSaving}
                style={{flex:2,fontFamily:MONO,fontSize:12,fontWeight:700,padding:'11px',borderRadius:10,border:'none',background:renameCoSaving?T.border:T.gold,color:'#1A2530',cursor:'pointer'}}>
                {renameCoSaving?'Saving…':'Save new name'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editingPayment&&<PaymentModal payment={editingPayment.payment} onClose={()=>setEditingPayment(null)} onSave={handleUpdatePayment}/>}
      {/* Access modal now lives inside Settings page */}
      {showDeleteConfirm&&<DeleteConfirmModal propName={properties.find(p=>p.id===showDeleteConfirm)?.name||''} onClose={()=>setShowDeleteConfirm(null)} onConfirm={pwd=>handleDeleteProp(showDeleteConfirm,pwd)}/>}
      {showSellModal&&<SellPropertyModal
        property={properties.find(p=>p.id===showSellModal)}
        onClose={()=>setShowSellModal(null)}
        onConfirm={(price, date)=>handleMarkSold(showSellModal, price, date)}
        busy={propertyActionBusy}/>}
      {deleteCoTarget&&<DeleteCompanyModal
        company={deleteCoTarget}
        userId={user?.id}
        onClose={()=>setDeleteCoTarget(null)}
        onDeleted={()=>{
          setDeleteCoTarget(null)
          refreshData()
          showToast(`${deleteCoTarget.name} deleted — restore from Trash within 30 days`)
        }}/>}

      {/* Toast: role=alert + aria-live=assertive for errors (so screen readers
          interrupt and announce), role=status + aria-live=polite for success
          notices (so they're announced without interrupting the user). */}
      {toast&&(()=>{
        // Theme-aware surface (the old hardcoded dark panels failed AA in
        // light mode, the shipped default) + clear of the mobile bottom bar
        // and iPhone safe area. Errors persist (no auto-dismiss), so always
        // offer an explicit close.
        // 'info' is the muted variant for notices that are neither a success
        // nor a failure (e.g. a read-only click on the Day Tracker).
        const tint = toast.type==='error'?T.red:toast.type==='info'?T.muted:T.green
        return <div
          role={toast.type==='error'?'alert':'status'}
          aria-live={toast.type==='error'?'assertive':'polite'}
          aria-atomic="true"
          style={{position:'fixed',bottom:isMobile?'calc(env(safe-area-inset-bottom) + 76px)':24,right:isMobile?12:24,left:isMobile?12:'auto',zIndex:999,background:T.card,border:`1px solid ${tint}`,borderLeft:`3px solid ${tint}`,color:T.text,fontFamily:MONO,fontSize:13,fontWeight:500,padding:'12px 16px',borderRadius:10,animation:'fadeIn 0.2s ease',boxShadow:'0 6px 24px rgba(0,0,0,0.18)',display:'flex',alignItems:'center',gap:12,maxWidth:isMobile?'none':420}}>
          <span style={{flex:1}}>{toast.msg}</span>
          <button onClick={()=>setToast(null)} aria-label="Dismiss notification"
            style={{background:'none',border:'none',cursor:'pointer',color:T.muted,padding:'4px 6px',margin:'-4px -6px',fontSize:14,lineHeight:1,flexShrink:0}}>✕</button>
        </div>
      })()}

      {/* Mobile bottom nav - consistent icons, + More opens drawer */}
      <nav className="mobile-nav" aria-label="Primary" style={{display:'flex',justifyContent:'space-around',alignItems:'center'}}>
        {/* Mobile bottom-nav: 6 slots — Dashboard, the user's 3 highest-
            priority items (mobileRank from lib/nav.js, not registry
            declaration order), Settings, and More (opens the drawer with
            everything else). */}
        {(() => {
          const dash = navItems.find(n => n.key === 'dashboard')
          const settingsItem = navItems.find(n => n.key === 'settings')
          const middle = navItems
            .filter(n => n.key !== 'dashboard' && n.key !== 'settings')
            .sort((a, b) => (a.mobileRank ?? 99) - (b.mobileRank ?? 99))
            .slice(0, 3)
          return [dash, ...middle, settingsItem].filter(Boolean)
        })().map(n=>{
          const key = n.key
          const active = view===key||(view==='detail'&&key==='properties')
          return (
            <button key={key} aria-current={active?'page':undefined} onClick={()=>{setView(key);setSelectedId(null)}}
              style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
                alignItems:'center',gap:2,padding:'4px 8px',flex:1,
                color:active?T.goldText:T.muted,fontFamily:MONO}}>
              <span style={{display:'flex'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:<span style={{fontSize:20}}>{n.icon}</span>}</span>
              <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>{n.short}</span>
            </button>
          )
        })}
        <button onClick={()=>setShowDrawer(true)}
          style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
            alignItems:'center',gap:2,padding:'4px 8px',flex:1,
            color:T.muted,fontFamily:MONO}}>
          <span style={{fontSize:20}}>☰</span>
          <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>More</span>
        </button>
      </nav>

      {/* ── ADMIN DASHBOARD OVERLAY ── */}
      {showAdmin && isPlatformAdmin && (
        <Suspense fallback={<PageLoadingSpinner T={T}/>}>
          <AdminDashboard onClose={()=>setShowAdmin(false)} user={user}/>
        </Suspense>
      )}

      {/* ── ONBOARDING TOUR ── */}
      {showTour && (
        <Suspense fallback={null}>
          <OnboardingTour user={user} onComplete={()=>setShowTour(false)}/>
        </Suspense>
      )}
    </div>
  )
}
