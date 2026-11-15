import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ rows: [], ops: [], insertError: null, readError: null }))
vi.mock('../supabase', () => ({
  supabase: {
    from: () => {
      const filters = []
      let op = null
      const b = {
        select() { if (!op) op = 'select'; return b },
        insert(rows) {
          db.ops.push(['insert', rows])
          return Promise.resolve({ error: db.insertError })
        },
        delete() { op = 'delete'; return b },
        eq(col, val) { filters.push(['eq', col, val]); return b },
        in(col, vals) { filters.push(['in', col, vals]); return b },
        then(resolve) {
          if (op === 'delete') { db.ops.push(['delete', filters]); return Promise.resolve({ error: null }).then(resolve) }
          return Promise.resolve({ data: db.readError ? null : db.rows, error: db.readError }).then(resolve)
        },
      }
      return b
    },
  },
}))

import { setAllCompanyAccess, planCompanyAccessDiff, accessRoleForNewGrants } from '../api/access'

describe('accessRoleForNewGrants', () => {
  it("uses the member's most common role and never upgrades a viewer", () => {
    expect(accessRoleForNewGrants([{ role: 'viewer' }, { role: 'viewer' }, { role: 'editor' }]).role).toBe('viewer')
    // A tie goes to the least privileged role.
    expect(accessRoleForNewGrants([{ role: 'admin' }, { role: 'viewer' }]).role).toBe('viewer')
    // Legacy rows with no role resolve via is_admin.
    expect(accessRoleForNewGrants([{ role: null, is_admin: true }]).role).toBe('admin')
    // Rent Tracker Editor (viewer + edit_rent) keeps its overrides.
    expect(accessRoleForNewGrants([{ role: 'viewer', permissions: { edit_rent: true } }]))
      .toEqual({ role: 'viewer', permissions: { edit_rent: true } })
    expect(accessRoleForNewGrants([])).toEqual({ role: 'viewer', permissions: {} })
  })
})

describe('planCompanyAccessDiff', () => {
  const rows = [{ company_id: 'a' }, { company_id: 'b' }, { company_id: 'x', is_owner: true }, { company_id: 'other' }]
  it('adds only missing companies and removes only dropped ones within scope', () => {
    expect(planCompanyAccessDiff(rows, ['a', 'c'], ['a', 'b', 'c', 'x'])).toEqual({ toAdd: ['c'], toRemove: ['b'] })
  })
  it('never removes an owner row', () => {
    expect(planCompanyAccessDiff(rows, [], null).toRemove.sort()).toEqual(['a', 'b', 'other'])
  })
})

describe('setAllCompanyAccess', () => {
  beforeEach(() => { db.ops.length = 0; db.insertError = null; db.readError = null })

  it('keeps existing roles, grants new companies at the existing role, then deletes', async () => {
    db.rows = [{ company_id: 'a', role: 'viewer', permissions: {} }, { company_id: 'b', role: 'viewer', permissions: {} }]
    const res = await setAllCompanyAccess('u1', 'u1@example.com', ['a', 'c'], { scopeCompanyIds: ['a', 'b', 'c'] })
    expect(res).toEqual({ added: ['c'], removed: ['b'] })
    expect(db.ops[0][0]).toBe('insert')
    expect(db.ops[0][1]).toEqual([{ user_id: 'u1', company_id: 'c', email: 'u1@example.com', role: 'viewer', permissions: {}, is_admin: false }])
    expect(db.ops[1][0]).toBe('delete')
  })

  it('deletes nothing when the insert fails', async () => {
    db.rows = [{ company_id: 'a', role: 'admin' }]
    db.insertError = new Error('insert refused')
    await expect(setAllCompanyAccess('u1', 'e', ['b'])).rejects.toThrow('insert refused')
    expect(db.ops.some(o => o[0] === 'delete')).toBe(false)
  })

  it('throws when the existing rows cannot be read', async () => {
    db.readError = new Error('read failed')
    await expect(setAllCompanyAccess('u1', 'e', [])).rejects.toThrow('read failed')
    expect(db.ops).toHaveLength(0)
  })
})
