import { describe, it, expect } from 'vitest'
import { DEAL_STATUSES, DEAL_STATUS_CFG, LEGAL_STEPS, legalStepText, showsLegalStep } from '../dealStages'
import { STATUS_GROUP } from '../dealCashflow'

describe('deal stages', () => {
  it('runs in the agreed order', () => {
    expect(DEAL_STATUSES.map(s => s.label)).toEqual([
      'Analysing', 'Offer made', 'Under offer', 'Conveyancing', 'Ready to exchange', 'Exchanged', 'Completed',
      'Refurbishment', 'Ready to let', 'Let / income', 'Fallen through',
    ])
  })
  it('keeps every stored key an existing deal can have', () => {
    for (const k of ['analysing', 'offer_made', 'under_offer', 'exchanged', 'completed', 'dead']) expect(DEAL_STATUS_CFG[k]).toBeTruthy()
    expect(DEAL_STATUS_CFG.dead.label).toBe('Fallen through')
  })
  it('every stage has a cashflow group so none lands in "undated" by accident', () => {
    for (const s of DEAL_STATUSES) expect(s.key in STATUS_GROUP).toBe(true)
    expect(STATUS_GROUP.conveyancing).toBe('pipeline')
    expect(STATUS_GROUP.ready_to_exchange).toBe('pipeline')
  })
  it('has the eight legal steps, offered only at conveyancing', () => {
    expect(LEGAL_STEPS).toHaveLength(8)
    expect(legalStepText('draft_contract')).toBe('3/8 Draft contract awaited')
    expect(legalStepText(null)).toBeNull()
    expect(showsLegalStep('conveyancing')).toBe(true)
    expect(showsLegalStep('under_offer')).toBe(false)
  })
})

describe('lifecycle and attention (Deals brief, 19 Nov 2026)', () => {
  it('runs Analysing to Let, with Fallen through outside the tracker', async () => {
    const { LIFECYCLE, lifecycleIndex, isPostCompletion, ATTENTION_STATUSES } = await import('../dealStages')
    expect(LIFECYCLE.map(s => s.key)).toEqual(['analysing', 'offer_made', 'under_offer', 'conveyancing', 'ready_to_exchange', 'exchanged', 'completed', 'refurbishment', 'ready_to_let', 'let'])
    expect(lifecycleIndex('dead')).toBe(-1)
    expect(lifecycleIndex(null)).toBe(0)
    expect(isPostCompletion('exchanged')).toBe(false)
    expect(['completed', 'refurbishment', 'ready_to_let', 'let'].every(isPostCompletion)).toBe(true)
    expect(isPostCompletion('dead')).toBe(false)
    // Same keys as the deals_attention_status_check constraint.
    expect(ATTENTION_STATUSES.map(a => a.key)).toEqual(['on_track', 'awaiting_response', 'blocked', 'at_risk', 'overdue', 'on_hold'])
  })
  it('post-completion stages map to the right cashflow group', async () => {
    const { STATUS_GROUP } = await import('../dealCashflow')
    expect(STATUS_GROUP.refurbishment).toBe('refurb')
    expect(STATUS_GROUP.ready_to_let).toBeNull()
    expect(STATUS_GROUP.let).toBeNull()
  })
})
