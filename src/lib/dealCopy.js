// What "Copy" on a deal actually carries over.
//
// Copy used to duplicate the whole deals row and then start the new deal's
// Purchase Tracker from scratch — so it copied things people didn't want
// (the address, half-finished completion dates) and dropped things they did
// (their customised tracker steps, contacts, photos). Now the button opens a
// picker and each group below is one tick box.
//
// The groups are defined here rather than in the modal so the API layer and
// the tests build the copy from the same list — a new deals column only has
// to be added in one place.

// Structural fields that always come across. They define what kind of deal
// it is (and therefore which milestone set the tracker builds), so a copy
// without them wouldn't be a copy of anything.
export const ALWAYS_FIELDS = [
  'company_id', 'deal_type', 'purchase_type', 'is_auction', 'ownership_type',
]

// Address + free-text notes. Off-by-default cases live in COPY_OPTIONS.
export const DETAIL_FIELDS = ['address', 'notes']

// Everything the Calculator tab feeds on: purchase costs, finance, rent and
// running costs, plus the BRRR refinance assumptions.
export const FIGURE_FIELDS = [
  'purchase_price', 'purchase_price_paid', 'stamp_duty_override',
  'is_additional_property', 'is_first_time_buyer',
  'legal_fees', 'solicitor_fee', 'search_fees', 'disbursements',
  'survey_cost', 'auction_fees', 'broker_fee', 'refurb_cost',
  'other_costs', 'other_costs_label',
  'deposit_percent', 'mortgage_rate', 'mortgage_term', 'mortgage_type',
  'mortgage_fee_percent',
  'monthly_rent', 'hmo_rooms', 'hmo_rent_per_room', 'hmo_room_rents',
  'hmo_rent_mode', 'sa_nightly_rate', 'sa_occupancy_percent',
  'void_percent', 'agent_fee_percent', 'agent_fee_vat', 'maintenance_percent',
  'insurance_monthly', 'service_charge_monthly', 'ground_rent_monthly',
  'hmo_utilities_monthly', 'hmo_council_tax_monthly', 'hmo_licence_annual',
  'brrr_end_value', 'brrr_refinance_ltv', 'brrr_new_rate', 'brrr_new_term',
  'section24_rate',
]

// Dates that record how far the original purchase actually got. They belong
// with tracker progress, not with the figures — a copy used as a template
// for the next deal must not inherit the first one's exchange date.
export const PROGRESS_DATE_FIELDS = [
  'target_completion_date', 'actual_completion_date', 'exchanged_date',
  'expected_completion_date', 'refurb_start_date', 'refurb_end_date',
]

// One entry per tick box, in display order.
//   key      — option key, also the checkbox name
//   label    — what the user reads
//   hint     — one line under it explaining the consequence
//   default  — ticked on open
//   requires — only selectable while the named option is ticked
export const COPY_OPTIONS = [
  { key: 'details', label: 'Address & notes', hint: 'The property address and any notes on the deal', default: true },
  { key: 'figures', label: 'Calculator figures', hint: 'Purchase costs, finance, rent and running costs', default: true },
  { key: 'tracker', label: 'Purchase tracker steps', hint: 'Which steps are switched on, in your customised order', default: true },
  { key: 'trackerProgress', label: 'Tracker progress', hint: 'Completed ticks, step dates and the target completion date', default: false, requires: 'tracker' },
  { key: 'contacts', label: 'Contacts', hint: 'Solicitor, broker, agent and any other saved contacts', default: true },
  { key: 'photos', label: 'Photos', hint: 'Copies the image files into the new deal', default: false },
  { key: 'documents', label: 'Documents', hint: 'Copies the non-image files into the new deal', default: false },
]

export const DEFAULT_COPY_OPTIONS = COPY_OPTIONS.reduce(
  (acc, o) => { acc[o.key] = o.default; return acc },
  {},
)

// True when the option is ticked and everything it depends on is too, so the
// caller never has to re-check `requires` by hand.
export function isCopyOptionActive(options, key) {
  const opt = COPY_OPTIONS.find(o => o.key === key)
  if (!opt) return false
  if (!options?.[key]) return false
  return opt.requires ? isCopyOptionActive(options, opt.requires) : true
}

// Build the deals-row insert payload for a copy. Identity, trash markers and
// timestamps are never carried; the copy is owned by whoever clicked Copy and
// always starts back at 'analysing' whatever the original's status.
export function buildDealCopyFields(deal = {}, options = DEFAULT_COPY_OPTIONS, { userId } = {}) {
  const pick = (fields, out) => {
    for (const f of fields) if (f in deal) out[f] = deal[f]
    return out
  }
  const row = {
    user_id: userId || deal.user_id || null,
    name: (deal.name || 'Deal') + ' (copy)',
    status: 'analysing',
  }
  pick(ALWAYS_FIELDS, row)
  if (isCopyOptionActive(options, 'details')) pick(DETAIL_FIELDS, row)
  if (isCopyOptionActive(options, 'trackerProgress')) pick(PROGRESS_DATE_FIELDS, row)
  if (isCopyOptionActive(options, 'figures')) pick(FIGURE_FIELDS, row)
  return row
}

// Milestone rows for the copy, cloned from the original's own steps so a
// customised tracker (steps toggled off, extra BRRR stage) comes across as
// the user left it. Ticks, dates and per-step notes only ride along when
// tracker progress is ticked.
export function buildMilestoneCopies(milestones = [], dealId, options = DEFAULT_COPY_OPTIONS) {
  const withProgress = isCopyOptionActive(options, 'trackerProgress')
  return milestones.map(m => ({
    deal_id: dealId,
    milestone_key: m.milestone_key,
    label: m.label,
    stage: m.stage,
    sort_order: m.sort_order,
    is_required: m.is_required,
    is_enabled: m.is_enabled,
    completed: withProgress ? !!m.completed : false,
    completed_date: withProgress ? (m.completed_date || null) : null,
    notes: withProgress ? (m.notes || null) : null,
  }))
}

// Human summary of what landed, for the toast. Counts come from the API.
export function summariseCopy({ milestones = 0, contacts = 0, photos = 0, documents = 0 } = {}) {
  const bits = []
  if (milestones) bits.push(`${milestones} tracker step${milestones === 1 ? '' : 's'}`)
  if (contacts) bits.push(`${contacts} contact${contacts === 1 ? '' : 's'}`)
  if (photos) bits.push(`${photos} photo${photos === 1 ? '' : 's'}`)
  if (documents) bits.push(`${documents} document${documents === 1 ? '' : 's'}`)
  return bits.length ? `Deal copied with ${bits.join(', ')}` : 'Deal copied'
}
