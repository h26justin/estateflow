import { describe, it, expect } from 'vitest'
import {
  canDo, roleFromAccessRow, roleUpdateFor, isAdminDemotion,
  ROLE_OPTIONS, ROLE_OPTION_LABELS, RENT_EDITOR_OVERRIDES,
} from '../permissions'

describe('canDo', () => {
  const map = {
    __owner: { 'co-owned': true },
    'co-editor': { edit_rent: true, view_rent: true, manage_users: false },
    'co-viewer': { edit_rent: false, view_rent: true },
  }

  it('allows actions with no company context', () => {
    expect(canDo(map, null, 'edit_rent')).toBe(true)
    expect(canDo(null, undefined, 'edit_rent')).toBe(true)
  })

  it('denies everything until the map is loaded', () => {
    expect(canDo(null, 'co-editor', 'edit_rent')).toBe(false)
    expect(canDo(undefined, 'co-editor', 'edit_rent')).toBe(false)
  })

  it('grants the owner everything via the __owner stamp', () => {
    expect(canDo(map, 'co-owned', 'edit_rent')).toBe(true)
    expect(canDo(map, 'co-owned', 'delete_company')).toBe(true)
  })

  it('reads the effective key for a collaborator and fails closed otherwise', () => {
    expect(canDo(map, 'co-editor', 'edit_rent')).toBe(true)
    expect(canDo(map, 'co-editor', 'manage_users')).toBe(false)
    expect(canDo(map, 'co-editor', 'not_a_key')).toBe(false)
    expect(canDo(map, 'co-viewer', 'edit_rent')).toBe(false)
    expect(canDo(map, 'co-unknown', 'view_rent')).toBe(false)
  })
})

describe('roleFromAccessRow', () => {
  it('maps the three stored roles straight through', () => {
    expect(roleFromAccessRow({ role: 'admin' })).toBe('admin')
    expect(roleFromAccessRow({ role: 'editor' })).toBe('editor')
    expect(roleFromAccessRow({ role: 'viewer' })).toBe('viewer')
  })

  it('recognises the Rent Tracker Editor preset (viewer + edit_rent override)', () => {
    expect(roleFromAccessRow({ role: 'viewer', permissions: { view_rent: true, edit_rent: true } })).toBe('rent_editor')
    expect(roleFromAccessRow({ role: 'viewer', permissions: { edit_rent: true } })).toBe('rent_editor')
  })

  it('does not call an editor or admin with edit_rent a rent editor', () => {
    expect(roleFromAccessRow({ role: 'editor', permissions: { edit_rent: true } })).toBe('editor')
    expect(roleFromAccessRow({ role: 'admin', permissions: { edit_rent: true } })).toBe('admin')
  })

  it('treats a viewer with edit_rent explicitly false, or absent, as a plain viewer', () => {
    expect(roleFromAccessRow({ role: 'viewer', permissions: { edit_rent: false } })).toBe('viewer')
    expect(roleFromAccessRow({ role: 'viewer', permissions: null })).toBe('viewer')
    expect(roleFromAccessRow({ role: 'viewer' })).toBe('viewer')
  })

  it('falls back like getEffectivePermissions for legacy rows without a role', () => {
    expect(roleFromAccessRow({ role: null, is_admin: true })).toBe('admin')
    expect(roleFromAccessRow({ role: null, is_admin: false })).toBe('editor')
    expect(roleFromAccessRow({})).toBe('editor')
  })

  it('flags an is_owner row as owner and a missing row as viewer', () => {
    expect(roleFromAccessRow({ role: 'admin', is_owner: true })).toBe('owner')
    expect(roleFromAccessRow(null)).toBe('viewer')
    expect(roleFromAccessRow(undefined)).toBe('viewer')
  })

  it('never returns a value outside the labelled set', () => {
    expect(roleFromAccessRow({ role: 'superuser' })).toBe('editor')
    for (const v of ['admin', 'editor', 'viewer', 'rent_editor', 'owner']) {
      expect(ROLE_OPTION_LABELS[v]).toBeTruthy()
    }
  })
})

describe('roleUpdateFor', () => {
  it('persists Rent Tracker Editor as viewer plus the rent override pair', () => {
    expect(roleUpdateFor('rent_editor')).toEqual({ role: 'viewer', overrides: { view_rent: true, edit_rent: true } })
    expect(roleUpdateFor('rent_editor').overrides).toEqual(RENT_EDITOR_OVERRIDES)
  })

  it('returns a fresh overrides object each time so callers cannot mutate the preset', () => {
    const a = roleUpdateFor('rent_editor')
    a.overrides.edit_rent = false
    expect(roleUpdateFor('rent_editor').overrides.edit_rent).toBe(true)
    expect(RENT_EDITOR_OVERRIDES.edit_rent).toBe(true)
  })

  it('clears overrides for the plain roles', () => {
    expect(roleUpdateFor('viewer')).toEqual({ role: 'viewer', overrides: {} })
    expect(roleUpdateFor('editor')).toEqual({ role: 'editor', overrides: {} })
    expect(roleUpdateFor('admin')).toEqual({ role: 'admin', overrides: {} })
  })

  it('rejects unknown options instead of guessing', () => {
    expect(() => roleUpdateFor('owner')).toThrow(/Unknown role option/)
    expect(() => roleUpdateFor('')).toThrow()
  })

  it('round-trips every selectable option through roleFromAccessRow', () => {
    for (const o of ROLE_OPTIONS) {
      const { role, overrides } = roleUpdateFor(o.value)
      expect(roleFromAccessRow({ role, permissions: overrides })).toBe(o.value)
    }
  })
})

describe('isAdminDemotion', () => {
  it('is true only when leaving admin', () => {
    expect(isAdminDemotion('admin', 'editor')).toBe(true)
    expect(isAdminDemotion('admin', 'rent_editor')).toBe(true)
    expect(isAdminDemotion('admin', 'admin')).toBe(false)
    expect(isAdminDemotion('editor', 'viewer')).toBe(false)
    expect(isAdminDemotion('viewer', 'admin')).toBe(false)
  })
})
