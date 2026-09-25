import { describe, it, expect } from 'vitest'
import {
  COPY_OPTIONS, DEFAULT_COPY_OPTIONS, isCopyOptionActive,
  buildDealCopyFields, buildMilestoneCopies, summariseCopy,
} from '../dealCopy'

const deal = {
  id: 'deal-1', user_id: 'owner-1', created_at: 'x', updated_at: 'y',
  deleted_at: 'z', deleted_by: 'someone',
  name: '33 Lyndhurst Terrace', address: '33 Lyndhurst Terrace, Sunderland SR4 6SQ',
  notes: 'Vendor wants a quick sale', company_id: 'co-1', deal_type: 'brrr',
  purchase_type: 'mortgage', is_auction: false, ownership_type: 'company',
  status: 'under_offer', purchase_price: 85000, monthly_rent: 650,
  refurb_cost: 12000, brrr_end_value: 120000,
  target_completion_date: '2026-10-01', exchanged_date: '2026-09-15',
}

const none = COPY_OPTIONS.reduce((a, o) => ({ ...a, [o.key]: false }), {})
const all = COPY_OPTIONS.reduce((a, o) => ({ ...a, [o.key]: true }), {})

describe('buildDealCopyFields', () => {
  it('never carries identity, trash markers or the original status', () => {
    const row = buildDealCopyFields(deal, all, { userId: 'copier-1' })
    for (const f of ['id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
      expect(row).not.toHaveProperty(f)
    }
    expect(row.user_id).toBe('copier-1')
    expect(row.status).toBe('analysing')
    expect(row.name).toBe('33 Lyndhurst Terrace (copy)')
  })

  it('keeps the structural fields even with every box unticked', () => {
    const row = buildDealCopyFields(deal, none, { userId: 'copier-1' })
    expect(row.company_id).toBe('co-1')
    expect(row.deal_type).toBe('brrr')
    expect(row.purchase_type).toBe('mortgage')
    expect(row.ownership_type).toBe('company')
    expect(row).not.toHaveProperty('address')
    expect(row).not.toHaveProperty('purchase_price')
  })

  it('copies figures only when figures is ticked', () => {
    const withFigures = buildDealCopyFields(deal, { ...none, figures: true })
    expect(withFigures.purchase_price).toBe(85000)
    expect(withFigures.monthly_rent).toBe(650)
    expect(withFigures.brrr_end_value).toBe(120000)
    expect(withFigures).not.toHaveProperty('address')
  })

  it('copies address and notes only when details is ticked', () => {
    const withDetails = buildDealCopyFields(deal, { ...none, details: true })
    expect(withDetails.address).toBe(deal.address)
    expect(withDetails.notes).toBe(deal.notes)
    expect(withDetails).not.toHaveProperty('purchase_price')
  })

  it('leaves the original purchase dates behind unless tracker progress is ticked', () => {
    const plain = buildDealCopyFields(deal, { ...all, trackerProgress: false })
    expect(plain).not.toHaveProperty('target_completion_date')
    expect(plain).not.toHaveProperty('exchanged_date')
    const withProgress = buildDealCopyFields(deal, all)
    expect(withProgress.target_completion_date).toBe('2026-10-01')
    expect(withProgress.exchanged_date).toBe('2026-09-15')
  })

  it('ignores tracker progress when its parent option is unticked', () => {
    const row = buildDealCopyFields(deal, { ...none, trackerProgress: true })
    expect(row).not.toHaveProperty('target_completion_date')
    expect(isCopyOptionActive({ ...none, trackerProgress: true }, 'trackerProgress')).toBe(false)
  })

  it('defaults to details, figures, tracker steps and contacts', () => {
    expect(DEFAULT_COPY_OPTIONS).toEqual({
      details: true, figures: true, tracker: true, trackerProgress: false,
      contacts: true, photos: false, documents: false,
    })
  })
})

describe('buildMilestoneCopies', () => {
  const milestones = [
    { id: 'm1', deal_id: 'deal-1', milestone_key: 'offer_submitted', label: 'Offer submitted', stage: 'offer', sort_order: 1, is_required: true, is_enabled: true, completed: true, completed_date: '2026-08-01', notes: 'verbal' },
    { id: 'm2', deal_id: 'deal-1', milestone_key: 'survey_booked', label: 'Survey booked', stage: 'legal', sort_order: 2, is_required: false, is_enabled: false, completed: false, completed_date: null, notes: null },
  ]

  it('clones the customised step setup without progress by default', () => {
    const rows = buildMilestoneCopies(milestones, 'deal-2', { ...all, trackerProgress: false })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      deal_id: 'deal-2', milestone_key: 'offer_submitted', is_enabled: true,
      completed: false, completed_date: null, notes: null,
    })
    // The step the user switched off stays off in the copy.
    expect(rows[1].is_enabled).toBe(false)
    expect(rows[0]).not.toHaveProperty('id')
  })

  it('carries ticks, dates and notes when tracker progress is ticked', () => {
    const rows = buildMilestoneCopies(milestones, 'deal-2', all)
    expect(rows[0]).toMatchObject({ completed: true, completed_date: '2026-08-01', notes: 'verbal' })
  })
})

describe('summariseCopy', () => {
  it('lists what came across', () => {
    expect(summariseCopy({ milestones: 24, contacts: 1, photos: 3, documents: 0 }))
      .toBe('Deal copied with 24 tracker steps, 1 contact, 3 photos')
  })

  it('falls back to a bare message when nothing was carried', () => {
    expect(summariseCopy({})).toBe('Deal copied')
  })
})
