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

// The legal step only means something while the deal is conveyancing.
export const showsLegalStep = status => status === 'conveyancing'
