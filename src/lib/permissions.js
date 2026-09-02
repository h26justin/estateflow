// Client-side permission helpers shared by App.jsx and the components that
// gate write surfaces (Day Tracker, importers, Team & Access).
//
// The source of truth for what a role may do is ROLE_DEFAULTS in
// src/lib/api/_monolith.js; the permissions JSONB on a user_company_access row
// overrides individual keys. This module only knows how to READ a loaded
// permissions map and how to describe a member's row as one of the four
// role presets shown in the Team & Access tab.

// Check if the current user can perform an action on a company.
// permissionsMap: { [companyId]: { edit_properties: true, view_financial: false, ... } }
// Fail-CLOSED: if we have no permission record for the company, deny the action.
// The map is loaded together with the user's companies; once it's loaded but
// missing a company entry that means the user is not a collaborator on it.
// (The OWNER of a company gets an implicit allow via `permissionsMap.__owner`
// stamped by the loader. Platform admins bypass canDo entirely at the call
// site via devModeActive.)
export function canDo(permissionsMap, companyId, permissionKey) {
  if (!companyId) return true  // no company context = global / personal action
  if (!permissionsMap) return false  // not loaded yet -> deny by default
  if (permissionsMap.__owner?.[companyId]) return true  // owner can do anything
  const perms = permissionsMap[companyId]
  if (!perms) return false  // collaborator row missing -> no access
  return perms[permissionKey] === true
}

// ── Role presets ─────────────────────────────────────────────────────────────
// The DB role column only allows admin | editor | viewer. "Rent Tracker
// Editor" is not a fourth role: it is a viewer whose permissions JSONB grants
// the rent pair. Storing it that way keeps the DB role check unchanged and
// lets has_rent_permission() read `permissions->>'edit_rent'` directly.
export const RENT_EDITOR_OVERRIDES = Object.freeze({ view_rent: true, edit_rent: true })

export const ROLE_OPTIONS = Object.freeze([
  { value: 'viewer',      label: 'Viewer',              hint: 'Read-only across the company' },
  { value: 'rent_editor', label: 'Rent Tracker Editor', hint: 'Read-only, plus can log and edit rent' },
  { value: 'editor',      label: 'Editor',              hint: 'Can add and edit records; no user management' },
  { value: 'admin',       label: 'Admin',               hint: 'Full access, can manage the team' },
])

export const ROLE_OPTION_LABELS = Object.freeze(
  ROLE_OPTIONS.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), { owner: 'Owner' })
)

// Map a user_company_access row to one of the four preset values (or 'owner'
// for a row flagged is_owner, which the UI renders as a locked pill).
// A viewer whose overrides grant edit_rent is the Rent Tracker Editor preset,
// regardless of whatever else the overrides say. Legacy rows with no role
// fall back the same way getEffectivePermissions does: is_admin -> admin,
// otherwise editor.
export function roleFromAccessRow(row) {
  if (!row) return 'viewer'
  if (row.is_owner === true) return 'owner'
  const role = row.role || (row.is_admin ? 'admin' : 'editor')
  const perms = row.permissions || {}
  if (role === 'viewer' && perms.edit_rent === true) return 'rent_editor'
  if (role === 'admin' || role === 'editor' || role === 'viewer') return role
  return 'editor'
}

// The (role, overrides) pair to persist for a chosen preset. Choosing a plain
// role clears any per-key overrides, matching RolePermissionsModal, so a
// member switched from Rent Tracker Editor to Viewer really does lose
// edit_rent. Unknown values throw rather than silently writing 'editor'.
export function roleUpdateFor(option) {
  switch (option) {
    case 'rent_editor': return { role: 'viewer', overrides: { ...RENT_EDITOR_OVERRIDES } }
    case 'viewer':
    case 'editor':
    case 'admin':
      return { role: option, overrides: {} }
    default:
      throw new Error('Unknown role option: ' + option)
  }
}

// True when moving from `fromOption` to `toOption` takes away admin rights,
// which is the one change the Team tab confirms before saving.
export function isAdminDemotion(fromOption, toOption) {
  return fromOption === 'admin' && toOption !== 'admin'
}
