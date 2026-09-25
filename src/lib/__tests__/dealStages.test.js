import { describe, it, expect } from 'vitest'
import { DEAL_STATUSES, DEAL_STATUS_CFG, LEGAL_STEPS, legalStepText, showsLegalStep } from '../dealStages'
import { STATUS_GROUP } from '../dealCashflow'

describe('deal stages', () => {
  it('runs in the agreed order', () => {
    expect(DEAL_STATUSES.map(s => s.label)).toEqual([
      'Analysing', 'Offer made', 'Under offer', 'Conveyancing', 'Ready to exchange', 'Exchanged', 'Completed', 'Fallen through',
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
