// ── POSSESSION + RENT-INCREASE RULES (ENGLAND, RENTERS' RIGHTS ACT 2025) ─────
//
// Single source of truth for the notice tools: grounds for possession, their
// notice periods, and the section 13 rent-increase timing rules that apply to
// private assured tenancies in England from 1 May 2026.
//
// From that date section 21 ("no-fault") notices can no longer be served, all
// private tenancies are periodic, possession is sought on Form 3A (section 8)
// and rent increases go through Form 4A (section 13). Section 21 notices
// served before 1 May 2026 needed proceedings issued by 31 July 2026, so none
// can still be acted on.
//
// This is a drafting aid, not legal advice. Notice periods are grouped as
// published in the GOV.UK Form 3A guidance for landlords; check the current
// guidance before serving. Wales (Renting Homes (Wales) Act 2016), Scotland
// and Northern Ireland are different regimes and are not covered.

export const RRA_COMMENCEMENT = '2026-05-01'
export const S21_PROCEEDINGS_DEADLINE = '2026-07-31'
export const JURISDICTION_NOTE =
  'England only. Wales, Scotland and Northern Ireland have different rules and forms.'

// period: { months } | { weeks } | { none: true }. firstYearBar: the ground
// cannot be used to obtain possession in the first 12 months of the tenancy,
// so the earliest date in the notice is pushed past that point.
export const GROUNDS = [
  { id: '1',  mandatory: true,  period: { months: 4 }, firstYearBar: true,
    title: 'Occupation by landlord or family',
    detail: 'The landlord, or a close family member, intends to live in the property as their only or principal home.' },
  { id: '1A', mandatory: true,  period: { months: 4 }, firstYearBar: true,
    title: 'Sale of the property',
    detail: 'The landlord intends to sell the property. The property generally cannot be re-let or marketed for let for 12 months after the notice period ends.' },
  { id: '2',  mandatory: true,  period: { months: 4 },
    title: 'Sale by mortgage lender',
    detail: 'A lender with a mortgage granted before the tenancy is entitled to possession to sell the property.' },
  { id: '4A', mandatory: true,  period: { months: 4 },
    title: 'Student accommodation (HMO)',
    detail: 'HMO let to full-time students, needed for a new group of students for the academic year. Notice of this ground must have been given at the start of the tenancy.' },
  { id: '6',  mandatory: true,  period: { months: 4 },
    title: 'Redevelopment',
    detail: 'The landlord intends to demolish or substantially redevelop the property and cannot do so with the tenant in occupation.' },
  { id: '6A', mandatory: true,  period: { months: 4 },
    title: 'Compliance with enforcement action',
    detail: 'Possession is needed to comply with enforcement action, for example a banning order, overcrowding or licensing requirement.' },
  { id: '7',  mandatory: true,  period: { months: 2 },
    title: 'Death of tenant',
    detail: 'The tenancy passed by will or intestacy after the tenant died. Proceedings must begin within 12 months of the death, or of the landlord becoming aware of it.' },
  { id: '7A', mandatory: true,  period: { none: true },
    title: 'Severe antisocial behaviour',
    detail: 'A conviction for a serious offence, breach of an injunction or closure order, or similar. Proceedings can begin immediately after service.' },
  { id: '7B', mandatory: true,  period: { weeks: 2 },
    title: 'No right to rent',
    detail: 'At least one tenant has no right to rent under immigration law and the Home Office has notified the landlord.' },
  { id: '8',  mandatory: true,  period: { weeks: 4 },
    title: 'Serious rent arrears',
    detail: 'At least 3 months’ rent unpaid (13 weeks if rent is paid weekly or fortnightly), both when the notice is served and at the hearing. Universal Credit payments due but not yet received are disregarded.' },
  { id: '9',  mandatory: false, period: { months: 2 },
    title: 'Suitable alternative accommodation',
    detail: 'Suitable alternative accommodation is available for the tenant.' },
  { id: '10', mandatory: false, period: { weeks: 4 },
    title: 'Some rent arrears',
    detail: 'Some rent is unpaid when the notice is served and when proceedings begin.' },
  { id: '11', mandatory: false, period: { weeks: 4 },
    title: 'Persistent arrears',
    detail: 'The tenant has persistently delayed paying rent, even if nothing is owed today.' },
  { id: '12', mandatory: false, period: { weeks: 2 },
    title: 'Breach of tenancy',
    detail: 'An obligation of the tenancy, other than paying rent, has been broken.' },
  { id: '13', mandatory: false, period: { weeks: 2 },
    title: 'Deterioration of the property',
    detail: 'The condition of the property has got worse because of the tenant or someone living with them.' },
  { id: '14', mandatory: false, period: { none: true },
    title: 'Antisocial behaviour',
    detail: 'Nuisance or annoyance, or use of the property for illegal or immoral purposes. Proceedings can begin immediately after service.' },
  { id: '15', mandatory: false, period: { weeks: 2 },
    title: 'Deterioration of furniture',
    detail: 'Furniture provided under the tenancy has been damaged by the tenant or someone living with them.' },
  { id: '17', mandatory: false, period: { weeks: 2 },
    title: 'False statement',
    detail: 'The tenancy was granted because of a false statement made knowingly or recklessly by the tenant.' },
]

export const groundById = (id) => GROUNDS.find(g => g.id === String(id)) || null
export const groundLabel = (g) => `Ground ${g.id} — ${g.title}`

export function periodLabel(period) {
  if (!period || period.none) return 'no notice period (proceedings can begin straight away)'
  if (period.months) return `${period.months} month${period.months === 1 ? '' : 's'}`
  return `${period.weeks} week${period.weeks === 1 ? '' : 's'}`
}

// ── date helpers (date-only, UTC, so no timezone drift) ────────────────────
function parseISO(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const toISO = (dt) => dt.toISOString().slice(0, 10)

export function addDaysISO(iso, days) {
  const dt = parseISO(iso); if (!dt) return null
  dt.setUTCDate(dt.getUTCDate() + days); return toISO(dt)
}

// Same day-of-month n months later; clamps to the month's last day
// (31 Jan + 1 month = 28/29 Feb).
export function addMonthsISO(iso, months) {
  const dt = parseISO(iso); if (!dt) return null
  const day = dt.getUTCDate()
  const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return toISO(target)
}

const maxISO = (...dates) => dates.filter(Boolean).sort().pop() || null

// Earliest date a notice period beginning on dateServed has run out, i.e. the
// first day court proceedings can be issued.
export function periodEndISO(dateServed, period) {
  if (!dateServed) return null
  if (!period || period.none) return dateServed
  if (period.months) return addMonthsISO(dateServed, period.months)
  return addDaysISO(dateServed, period.weeks * 7)
}

// ── Section 8 (Form 3A) ────────────────────────────────────────────────────
// Earliest date that can go in the notice for the chosen grounds: the longest
// notice period, and for Grounds 1/1A no earlier than 12 months into the
// tenancy. Returns { date, drivers: [{ ground, date, reason }] }.
export function earliestPossessionDate({ dateServed, groundIds = [], tenancyStart }) {
  const drivers = []
  for (const id of groundIds) {
    const g = groundById(id); if (!g) continue
    const end = periodEndISO(dateServed, g.period)
    if (end) drivers.push({ ground: g.id, date: end, reason: `Ground ${g.id}: ${periodLabel(g.period)}` })
    if (g.firstYearBar && tenancyStart) {
      const yearOn = addMonthsISO(tenancyStart, 12)
      drivers.push({ ground: g.id, date: yearOn, reason: `Ground ${g.id}: not before 12 months into the tenancy` })
    }
  }
  return { date: maxISO(...drivers.map(d => d.date)), drivers }
}

// Months (or 13-week blocks) of rent owed, for the Ground 8 threshold.
export function ground8Threshold({ rentAmount, frequency = 'monthly' }) {
  const rent = Number(rentAmount) || 0
  if (frequency === 'weekly') return { amount: rent * 13, label: '13 weeks’ rent' }
  if (frequency === 'fortnightly') return { amount: (rent / 2) * 13, label: '13 weeks’ rent' }
  if (frequency === 'quarterly') return { amount: rent, label: '3 months’ rent (one quarter)' }
  if (frequency === 'annually') return { amount: rent / 4, label: '3 months’ rent' }
  return { amount: rent * 3, label: '3 months’ rent' }
}

// Problems that make the draft wrong. errors block printing; warnings are
// shown but don't block (the landlord may know something we don't).
export function validateSection8({ dateServed, possessionDate, groundIds = [], tenancyStart, arrears, rentAmount, frequency }) {
  const errors = [], warnings = []
  if (!groundIds.length) errors.push('Choose at least one ground.')
  if (!dateServed) errors.push('Enter the date the notice will be served.')
  const { date: earliest } = earliestPossessionDate({ dateServed, groundIds, tenancyStart })
  if (possessionDate && earliest && possessionDate < earliest) {
    errors.push(`The date in the notice must be on or after ${earliest} for the grounds chosen.`)
  }
  if (dateServed && dateServed < RRA_COMMENCEMENT) {
    errors.push('This tool prepares notices under the rules in force from 1 May 2026.')
  }
  const firstYear = groundIds.map(groundById).filter(g => g?.firstYearBar)
  if (firstYear.length && !tenancyStart) {
    warnings.push(`Add the tenancy start date: Ground ${firstYear.map(g => g.id).join('/')} cannot end a tenancy in its first 12 months.`)
  }
  if (groundIds.includes('8')) {
    const t = ground8Threshold({ rentAmount, frequency })
    const owed = Number(arrears)
    if (!(owed > 0)) warnings.push(`Ground 8 needs at least ${t.label} owed. Enter the arrears so we can check.`)
    else if (t.amount > 0 && owed < t.amount) {
      warnings.push(`Ground 8 needs at least ${t.label} (£${Math.round(t.amount).toLocaleString('en-GB')}) owed when the notice is served and at the hearing. Current arrears are below that; consider Grounds 10/11 instead.`)
    }
  }
  return { errors, warnings, earliest }
}

// ── Section 13 (Form 4A) ───────────────────────────────────────────────────
// A section 13 increase needs at least two months' notice, cannot take effect
// in the first 52 weeks of the tenancy, and cannot take effect within 52 weeks
// of the last section 13 increase. The new rent should start on the first day
// of a rental period. The tenant can ask the First-tier Tribunal to decide the
// rent before the new rent starts.
export function earliestRentIncreaseDate({ dateServed, tenancyStart, lastIncreaseDate }) {
  const drivers = []
  if (dateServed) drivers.push({ date: addMonthsISO(dateServed, 2), reason: 'At least two months’ notice' })
  if (tenancyStart) drivers.push({ date: addDaysISO(tenancyStart, 52 * 7), reason: 'Not within the first 52 weeks of the tenancy' })
  if (lastIncreaseDate) drivers.push({ date: addDaysISO(lastIncreaseDate, 52 * 7), reason: '52 weeks since the last section 13 increase' })
  return { date: maxISO(...drivers.map(d => d.date)), drivers }
}

export function validateSection13({ dateServed, startDate, tenancyStart, lastIncreaseDate, currentRent, proposedRent, rentDueDay }) {
  const errors = [], warnings = []
  if (!dateServed) errors.push('Enter the date the notice will be served.')
  if (!startDate) errors.push('Enter the date the new rent starts.')
  const cur = Number(currentRent), next = Number(proposedRent)
  if (!(next > 0)) errors.push('Enter the proposed new rent.')
  else if (cur > 0 && next <= cur) errors.push('The proposed rent must be higher than the current rent.')
  const { date: earliest } = earliestRentIncreaseDate({ dateServed, tenancyStart, lastIncreaseDate })
  if (startDate && earliest && startDate < earliest) {
    errors.push(`The new rent cannot start before ${earliest}.`)
  }
  if (!tenancyStart) warnings.push('Add the tenancy start date so we can check the first-year rule.')
  const day = Number(rentDueDay)
  if (startDate && day >= 1 && day <= 31 && Number(startDate.slice(8, 10)) !== day) {
    warnings.push(`Rent is due on day ${day} of the month. The new rent should start on the first day of a rental period.`)
  }
  if (cur > 0 && next > 0) {
    const pct = ((next - cur) / cur) * 100
    if (pct > 10) warnings.push(`This is a ${pct.toFixed(1)}% increase. The tenant can ask the First-tier Tribunal to set the rent, which will not be above the open-market rent.`)
  }
  return { errors, warnings, earliest }
}

// Start date of the tenancy currently running, best effort from the property
// row (tenancies join) with the legacy tenant_since column as fallback.
export function currentTenancyStart(property) {
  const ts = Array.isArray(property?.tenancies) ? property.tenancies : []
  const active = ts.filter(t => t?.tenancy_start && (!t.status || t.status === 'active'))
    .sort((a, b) => String(b.tenancy_start).localeCompare(String(a.tenancy_start)))[0]
  return (active?.tenancy_start || property?.tenant_since || '').slice(0, 10) || ''
}
