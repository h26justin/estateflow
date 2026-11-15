import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent = vi.hoisted(() => ({ patches: [] }))
vi.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      const b = {
        update(patch) { sent.patches.push({ table, patch }); return b },
        eq() { return b },
        select() { return b },
        single: async () => ({ data: { id: 'x' }, error: null }),
      }
      return b
    },
  },
}))

import { updateRoom, updateLicence, rollupRooms } from '../api/hmoRooms'

describe('hmoRooms date columns', () => {
  beforeEach(() => { sent.patches.length = 0 })

  it('updateRoom sends null, not "", for a cleared tenancy date', async () => {
    await updateRoom('r1', { tenancy_start: '2026-01-01', tenancy_end: '' })
    expect(sent.patches[0].patch).toMatchObject({ tenancy_start: '2026-01-01', tenancy_end: null })
  })

  it('updateLicence sends null for cleared issued / expiry dates', async () => {
    await updateLicence('l1', { issued_date: '', expiry_date: '', licence_number: 'ABC' })
    expect(sent.patches[0].patch).toMatchObject({ issued_date: null, expiry_date: null, licence_number: 'ABC' })
  })

  it('leaves date keys alone when they are not being updated', async () => {
    await updateRoom('r1', { room_name: 'Room 2' })
    expect('tenancy_end' in sent.patches[0].patch).toBe(false)
  })
})

describe('rollupRooms', () => {
  it('counts a room on notice as collectable and occupied', () => {
    const roll = rollupRooms([
      { id: 'a', status: 'occupied', rent_pcm: 500 },
      { id: 'b', status: 'notice', rent_pcm: 450 },
      { id: 'c', status: 'vacant', rent_pcm: 400 },
    ])
    expect(roll.monthlyRent).toBe(950)
    expect(roll.occupiedRooms).toBe(2)
    expect(roll.voidRent).toBe(400)
  })
})
