// Deal stages and conveyancing legal steps: one list for the Deals page, the
// pipeline board, the PDF deal pack and the cashflow grouping.
//
// Order matters: dropdowns and kanban columns are built from it. Stored keys
// never change so existing deals keep their stage; 'dead' is shown as
// "Fallen through" (Justin, 25 Sep 2026) rather than migrating the key.

export const DEAL_STATUSES = Object.freeze([
  { key: 'analysing',         label: 'Analysing',         color: '#4B8FE0' },
  { key: 'offer_made',        label: 'Offer made',        color: '#E0943A' },
  { key: 'under_offer',       label: 'Under offer',       color: '#9B59B6' },
  { key: 'conveyancing',      label: 'Conveyancing',      color: '#3AA7B8' },
  { key: 'ready_to_exchange', label: 'Ready to exchange', color: '#7A9E3A' },
  { key: 'exchanged',         label: 'Exchanged',         color: '#C8A84B' },
  { key: 'completed',         label: 'Completed',         color: '#2ECC8A' },
  // After completion (Deals brief, 18 Nov 2026). Refurbishment is optional:
  // a deal can go straight from Completed to Ready to let.
  { key: 'refurbishment',     label: 'Refurbishment',     color: '#D9822B' },
  { key: 'ready_to_let',      label: 'Ready to let',      color: '#3A8FB8' },
  { key: 'let',               label: 'Let / income',      color: '#1F9E6E' },
  { key: 'dead',              label: 'Fallen through',    color: '#E05555' },
])

export const DEAL_STATUS_CFG = Object.freeze(Object.fromEntries(DEAL_STATUSES.map(s => [s.key, { label: s.label, color: s.color }])))
export const DEAL_STATUS_LABEL = Object.freeze(Object.fromEntries(DEAL_STATUSES.map(s => [s.key, s.label])))

// Optional, and only offered at the Conveyancing stage: not every purchase
// goes through every step (a cash purchase may skip several).
export const LEGAL_STEPS = Object.freeze([
  { key: 'solicitor_instructed', label: 'Solicitor instructed' },
  { key: 'client_care_pack',     label: 'Client care pack / initial payment' },
  { key: 'draft_contract',       label: 'Draft contract awaited' },
  { key: 'searches_underway',    label: 'Searches and checks underway' },
  { key: 'enquiries_raised',     label: 'Enquiries raised' },
  { key: 'replies_awaited',      label: 'Replies awaited' },
  { key: 'enquiries_resolved',   label: 'Enquiries resolved' },
  { key: 'contracts_funds_ready', label: 'Contracts and funds ready' },
])
export const LEGAL_STEP_LABEL = Object.freeze(Object.fromEntries(LEGAL_STEPS.map(s => [s.key, s.label])))

// "3 of 8: Draft contract awaited" style label, or null.
export function legalStepText(key) {
  const i = LEGAL_STEPS.findIndex(s => s.key === key)
  return i < 0 ? null : `${i + 1}/${LEGAL_STEPS.length} ${LEGAL_STEPS[i].label}`
}

// The lifecycle shown as a progress tracker: every stage except the terminal
// 'dead'. Returns the steps and the index of the deal's stage (-1 if dead or
// unknown).
export const LIFECYCLE = Object.freeze(DEAL_STATUSES.filter(s => s.key !== 'dead'))
export function lifecycleIndex(status) {
  return LIFECYCLE.findIndex(s => s.key === (status || 'analysing'))
}
// Purchase done: completed or any later stage.
export const isPostCompletion = status => lifecycleIndex(status) >= lifecycleIndex('completed')

// Attention status, kept separate from the stage so a solicitor delay never
// moves a deal backwards (deals.attention_status, check constraint lists the
// same keys).
export const ATTENTION_STATUSES = Object.freeze([
  { key: 'on_track',          label: 'On track',          color: '#2ECC8A' },
  { key: 'awaiting_response', label: 'Awaiting response', color: '#4B8FE0' },
  { key: 'blocked',           label: 'Blocked',           color: '#E05555' },
  { key: 'at_risk',           label: 'At risk',           color: '#E0943A' },
  { key: 'overdue',           label: 'Overdue',           color: '#C0392B' },
  { key: 'on_hold',           label: 'On hold',           color: '#8A8F98' },
])
export const ATTENTION_CFG = Object.freeze(Object.fromEntries(ATTENTION_STATUSES.map(s => [s.key, { label: s.label, color: s.color }])))

// The legal step only means something while the deal is conveyancing.
export const showsLegalStep = status => status === 'conveyancing'
