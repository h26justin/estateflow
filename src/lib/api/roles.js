// Role defaults, permission labels / groups and effective-permission
// resolution for user_company_access rows. Pure: no I/O.


// ── ROLE DEFAULTS ─────────────────────────────────────────────────────────────
// Each role has a default set of permissions. These can be overridden per-user
// via the permissions JSONB column.
export const ROLE_DEFAULTS = {
  owner: {
    // Owner has everything (hardcoded in code, never stored)
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: true, edit_financial: true,
    view_expenses: true, edit_expenses: true,
    manage_users: true,
    edit_company_settings: true,
    delete_company: true,
    access_billing: true,
    download_reports: true,
  },
  admin: {
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: true, edit_financial: true,
    view_expenses: true, edit_expenses: true,
    manage_users: true,
    edit_company_settings: true,
    delete_company: false,       // only owner
    access_billing: false,       // only owner
    download_reports: true,
  },
  editor: {
    view_properties: true, edit_properties: true,
    view_tenancies: true, edit_tenancies: true,
    view_tenant_personal: true,
    view_rent: true, edit_rent: true,
    view_compliance: true, edit_compliance: true,
    view_maintenance: true, edit_maintenance: true,
    view_financial: false, edit_financial: false,    // hidden by default
    view_expenses: true, edit_expenses: true,
    manage_users: false,
    edit_company_settings: false,
    delete_company: false,
    access_billing: false,
    download_reports: true,
  },
  viewer: {
    view_properties: true, edit_properties: false,
    view_tenancies: true, edit_tenancies: false,
    view_tenant_personal: false,       // GDPR-friendly default
    view_rent: true, edit_rent: false,
    view_compliance: true, edit_compliance: false,
    view_maintenance: true, edit_maintenance: false,
    view_financial: false, edit_financial: false,
    view_expenses: true, edit_expenses: false,
    manage_users: false,
    edit_company_settings: false,
    delete_company: false,
    access_billing: false,
    download_reports: true,
  },
}

// Friendly labels for each permission key
export const PERMISSION_LABELS = {
  view_properties: 'View properties',
  edit_properties: 'Edit properties',
  view_tenancies: 'View tenancies',
  edit_tenancies: 'Edit tenancies',
  view_tenant_personal: 'View tenant personal data (names, contacts)',
  view_rent: 'View rent records & arrears',
  edit_rent: 'Edit rent records',
  view_compliance: 'View compliance certificates',
  edit_compliance: 'Add/edit compliance certificates',
  view_maintenance: 'View maintenance jobs',
  edit_maintenance: 'Add/edit maintenance jobs',
  view_financial: 'View financial data (mortgages, equity, yields)',
  edit_financial: 'Edit financial data',
  view_expenses: 'View expenses',
  edit_expenses: 'Add/edit expenses',
  manage_users: 'Invite/remove users',
  edit_company_settings: 'Edit company settings & branding',
  delete_company: 'Delete company / transfer ownership',
  access_billing: 'Access billing & subscription',
  download_reports: 'Download reports & exports',
}

// Permission groups (for organizing the UI)
export const PERMISSION_GROUPS = [
  { label: 'Properties', keys: ['view_properties','edit_properties'] },
  { label: 'Tenancies', keys: ['view_tenancies','edit_tenancies','view_tenant_personal'] },
  { label: 'Rent', keys: ['view_rent','edit_rent'] },
  { label: 'Compliance', keys: ['view_compliance','edit_compliance'] },
  { label: 'Maintenance', keys: ['view_maintenance','edit_maintenance'] },
  { label: 'Financial', keys: ['view_financial','edit_financial'] },
  { label: 'Expenses', keys: ['view_expenses','edit_expenses'] },
  { label: 'Administration', keys: ['manage_users','edit_company_settings','delete_company','access_billing','download_reports'] },
]

// Resolve a user's effective permissions for a company
// accessRow can be undefined (non-member), then returns all-false
// If user is owner (company.owner_id === user.id), returns ROLE_DEFAULTS.owner
export function getEffectivePermissions(accessRow, isOwner = false) {
  if (isOwner) return { ...ROLE_DEFAULTS.owner }
  if (!accessRow) return Object.keys(ROLE_DEFAULTS.admin).reduce((acc,k)=>({...acc,[k]:false}),{})
  const role = accessRow.role || (accessRow.is_admin ? 'admin' : 'editor')
  const base = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.editor
  const overrides = accessRow.permissions || {}
  return { ...base, ...overrides }
}
