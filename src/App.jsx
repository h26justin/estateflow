import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import { useTheme } from './lib/ThemeContext'
import { useIsMobile } from './lib/useWindowSize'
import { getSubdomain } from './lib/subdomain'
import { ALL_NAV, DEFAULT_NAV_KEYS, VIEW_LABELS, SETTINGS_TABS, AUTO_ENABLE_NAV_KEYS, navSeenMarker } from './lib/nav'
import { REPORT_CATALOGUE } from './lib/reportCatalogue'
import { canDo } from './lib/permissions'
import { rentMonthSnapshot } from './lib/rentForecast'
import { MarketingSite } from './lib/lazyPages'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/AuthContext'
import * as api from './lib/api'
import LoginPage from './components/LoginPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isPropertyEarningRent, isPropertyOccupied, occupancySummary, planOnMarketPeriods } from './lib/propertyStatus'
import { propValue } from './lib/propertyValue'
import { isHoldingCompany } from './lib/companyPnl'
import { groupKeyForAddress, flatKeyWithinBuilding, groupPropertiesByBuilding } from './lib/addressUtils'
import { matchesQuery } from './lib/propertySearch'
import { useScrollRestoreOnClear } from './lib/useScrollRestoreOnClear'
import { canonicalCertType } from './lib/complianceCatalogue'
import { useConfirm } from './lib/ConfirmContext'
import { looksLikeCompanyInviteCode } from './lib/inviteUtils'
import { logError } from './lib/logError'
import { MONO, SANS, CV, FS } from './lib/styles'
import { Icon, ICON_NAMES } from './lib/icons'
import CommandPalette from './components/CommandPalette'
import TrialExpiredGate, { getOverdueCompanies } from './components/TrialExpiredGate'
import { isSafeUrl, calcGrossYield } from './lib/propertyCalcs'
import { pressable } from './lib/pressable'
import { plural } from './lib/format'
import AppShellStyles from './lib/AppShellStyles'
import { SettingsPage, ReportsPage, AdminDashboard, PrivacyPolicy, TermsOfService, SecurityPage, FeedbackPage, TenantReferenceModal, SuspendedAccessBanner, BuildingMortgageModal, CompanyOwnershipSection, HoldingGroupPanel, PropertyModal, CompanyModal, DeleteConfirmModal, SellPropertyModal, DeleteCompanyModal, PaymentModal, CustomizeDashModal, TenantPortal, RefurbsPage, DayTrackerPage, CompliancePage, MtdItsaPage, ShortTermLetIncomePage, AutopilotPage, RentersRightsCopilot, StatementImporter, StatementAuditPage, ExternalLoansPage, DataImporter, OnboardingWizard, OnboardingTour, BulkAddPropertyModal, ReceiptScanModal } from './components/app/lazyViews'
import { fmt } from './lib/appFmt'
import { Badge } from './components/app/Badges'
import { StatCard } from './components/app/StatCard'
import { Spinner, PageLoadingSpinner, SR_ONLY, DashboardSkeleton } from './components/app/Loading'
import { RentTrackerOverview } from './components/app/RentTrackerOverview'
import { DashboardView } from './components/app/DashboardView'
import { PropertyDetailView } from './components/app/PropertyDetailView'
import { AppHeader } from './components/app/AppHeader'
import { MobileDrawer } from './components/app/MobileDrawer'
import { PropertiesView } from './components/app/PropertiesView'
import { DealsView } from './components/app/DealsView'
import { RenameCompanyModal } from './components/app/RenameCompanyModal'
import { LeftRail } from './components/app/LeftRail'

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
                <span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,background:(c.color||T.gold)+'22',color:c.color||T.goldText,padding:'2px 8px',borderRadius:4}}>{c.abbr}</span>
                {holding&&<span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,color:T.muted,border:`1px solid ${T.border}`,padding:'2px 8px',borderRadius:4,letterSpacing:'0.05em'}}
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
                      <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>· {plural(group.items.length,'unit')}</span>
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
        <LeftRail
          railWidth={railWidth} T={T} railCollapsed={railCollapsed} navItems={navItems} view={view}
          setView={setView} setSelectedId={setSelectedId} setRailCollapsed={setRailCollapsed}
        />
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
          color: devModeActive ? T.gold : '#9ecb9e',
          padding:'6px 16px',
          textAlign:'center',
          fontFamily:MONO,
          fontSize:FS.xs,
          fontWeight:700,
          letterSpacing:'0.1em',
          borderBottom: devModeActive ? `1px solid ${T.gold}44` : '1px solid #9ecb9e44',
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
                style={{background:T.gold,color:CV.onGold,border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:FS.xs,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                VIEW AS REGULAR USER
              </button>
            </>
          ) : (
            <>
              <span>REGULAR USER VIEW — permission gates active (data-level access unchanged)</span>
              <button onClick={()=>{ setDevModeDisabled(false); window.location.reload() }}
                style={{background:'#9ecb9e',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:FS.xs,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
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
      <AppHeader
        T={T} isMobile={isMobile} view={view} selected={selected} closeDetail={closeDetail}
        companies={companies} setCoFilter={setCoFilter} setStatusFilter={setStatusFilter}
        setPortfolioTab={setPortfolioTab} setSelectedId={setSelectedId} setView={setView} navItems={navItems}
        activeProperties={activeProperties} openDetail={openDetail} setShowNewMenu={setShowNewMenu}
        showNewMenu={showNewMenu} setEditProp={setEditProp} setShowAddProp={setShowAddProp}
        openWorkflow={openWorkflow} setShowAddCo={setShowAddCo} setShowReceiptScan={setShowReceiptScan}
        setDetailTab={setDetailTab} showToast={showToast} isPlatformAdmin={isPlatformAdmin}
        setShowAdmin={setShowAdmin} setShowMoreMenu={setShowMoreMenu} showMoreMenu={showMoreMenu}
        setShowPalette={setShowPalette} openSettingsTab={openSettingsTab} setShowDrawer={setShowDrawer}
      />

      {/* ── MOBILE DRAWER ── */}
      {isMobile&&showDrawer&&(
        <MobileDrawer
          setShowDrawer={setShowDrawer} T={T} setShowPalette={setShowPalette} navItems={navItems} view={view}
          setView={setView} setSelectedId={setSelectedId} setEditProp={setEditProp}
          setShowAddProp={setShowAddProp} openWorkflow={openWorkflow} setShowAddCo={setShowAddCo}
          setShowReceiptScan={setShowReceiptScan} activeProperties={activeProperties}
          setDetailTab={setDetailTab} showToast={showToast} openSettingsTab={openSettingsTab}
        />
      )}

      {/* Platform announcement banner */}
      {announcements.filter(a=>!dismissedAnns.includes(a.id)).map(a=>{
        const colors={info:T.blue,warning:T.amber,success:T.green}
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

          {view==='dashboard'&&<DashboardView
            activeProperties={activeProperties} isMobile={isMobile} T={T} companies={companies}
            setShowAddCo={setShowAddCo} setEditProp={setEditProp} setShowAddProp={setShowAddProp}
            openDetail={openDetail} user={user} stats={stats} dashCoFilter={dashCoFilter}
            dashProps={dashProps} tenanciesByProp={tenanciesByProp} setDashCoFilter={setDashCoFilter}
            rentSnapshot={rentSnapshot} companyStats={companyStats} setView={setView} dashCos={dashCos}
            activeFlags={activeFlags} showToast={showToast} companySettings={companySettings}
            companySubs={companySubs} isPlatformAdmin={isPlatformAdmin} setProperties={setProperties}
            setSelectedId={setSelectedId} setDetailTab={setDetailTab} setPortfolioTab={setPortfolioTab}
            activeCoTab={activeCoTab} isAdmin={isAdmin} sectionPrefs={sectionPrefs}
            SECTION_DEFAULT_ORDER={SECTION_DEFAULT_ORDER} SECTION_DEFAULT_ENABLED={SECTION_DEFAULT_ENABLED}
            setStatusFilter={setStatusFilter} dashboardDeals={dashboardDeals}
            insurancePolicies={insurancePolicies} widgetPrefs={widgetPrefs}
            WIDGET_DEFAULT_ORDER={WIDGET_DEFAULT_ORDER} WIDGET_DEFAULT_ENABLED={WIDGET_DEFAULT_ENABLED}
            setCoFilter={setCoFilter} setCustomizeDashTab={setCustomizeDashTab}
            setShowCustomizeDash={setShowCustomizeDash}
          />}

          {view==='deals'&&<DealsView
            user={user} companies={companies} properties={properties} showToast={showToast}
            activeFlags={activeFlags} companySubs={companySubs} isPlatformAdmin={isPlatformAdmin}
            setDashboardDeals={setDashboardDeals} convertRefreshKey={convertRefreshKey}
            setEditProp={setEditProp} setConvertSourceDealId={setConvertSourceDealId}
            setConvertSourceDeal={setConvertSourceDeal} setShowAddProp={setShowAddProp}
          />}

          {view==='properties'&&<PropertiesView
            isMobile={isMobile} T={T} filtered={filtered} properties={properties}
            setPortfolioTab={setPortfolioTab} portfolioTab={portfolioTab} CompaniesPanel={CompaniesPanel}
            companies={companies} setCompanies={setCompanies} user={user} showToast={showToast}
            companySettings={companySettings} setCompanySettings={setCompanySettings}
            setCoFilter={setCoFilter} coFilter={coFilter} setProperties={setProperties}
            setSelectedId={setSelectedId} setView={setView} setDetailTab={setDetailTab}
            setShowBuildingMortgage={setShowBuildingMortgage} permissionsMap={permissionsMap}
            activeCoTab={activeCoTab} devModeActive={devModeActive} openWorkflow={openWorkflow}
            setEditProp={setEditProp} setShowAddProp={setShowAddProp} searchQ={searchQ}
            setSearchQ={setSearchQ} setStatusFilter={setStatusFilter} statusFilter={statusFilter}
            archivedCount={archivedCount} setShowArchived={setShowArchived} showArchived={showArchived}
            setSortBy={setSortBy} sortBy={sortBy} resetCustomOrder={resetCustomOrder}
            setPropLayout={setPropLayout} propLayout={propLayout} openDetail={openDetail}
            yieldBasis={yieldBasis}
          />}

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

          {view==='detail'&&selected&&<PropertyDetailView
            closeDetail={closeDetail} isMobile={isMobile} selected={selected} T={T}
            permissionsMap={permissionsMap} devModeActive={devModeActive} setEditProp={setEditProp}
            setShowAddProp={setShowAddProp} handleDuplicateProp={handleDuplicateProp}
            setShowSellModal={setShowSellModal} showToast={showToast} handleArchiveProp={handleArchiveProp}
            confirmDialog={confirmDialog} setShowDeleteConfirm={setShowDeleteConfirm}
            companySettings={companySettings} activeFlags={activeFlags} detailTab={detailTab}
            setDetailTab={setDetailTab} yieldBasis={yieldBasis} isAdmin={isAdmin} user={user}
            setEditingPayment={setEditingPayment} setView={setView} insurancePolicies={insurancePolicies}
            companies={companies} properties={properties} setProperties={setProperties}
            setSelectedId={setSelectedId} setShowReferencing={setShowReferencing}
          />}
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
        <RenameCompanyModal
          T={T} renameCoTarget={renameCoTarget} renameCo={renameCo} setRenameCo={setRenameCo}
          renameCoPassword={renameCoPassword} setRenameCoPassword={setRenameCoPassword}
          setRenameCoError={setRenameCoError} renameCoError={renameCoError}
          setRenameCoTarget={setRenameCoTarget} handleRenameCompany={handleRenameCompany}
          renameCoSaving={renameCoSaving}
        />
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
                alignItems:'center',gap:2,padding:'4px 8px',flex:1,minWidth:0,
                color:active?T.goldText:T.muted,fontFamily:MONO}}>
              <span style={{display:'flex'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:<span style={{fontSize:20}}>{n.icon}</span>}</span>
              <span style={{fontSize:FS.xs,textTransform:'uppercase',letterSpacing:'0.02em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%'}}>{n.short}</span>
            </button>
          )
        })}
        <button onClick={()=>setShowDrawer(true)}
          style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
            alignItems:'center',gap:2,padding:'4px 8px',flex:1,
            color:T.muted,fontFamily:MONO}}>
          <span style={{display:'flex'}} aria-hidden="true"><Icon name="menu" size={20}/></span>
          <span style={{fontSize:FS.xs,textTransform:'uppercase',letterSpacing:'0.02em',whiteSpace:'nowrap'}}>More</span>
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
