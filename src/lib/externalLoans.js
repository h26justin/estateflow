// ── EXTERNAL LOANS ENGINE ─────────────────────────────────────────────────
// Pure functions behind the External Loans page. No React, no DB.
//
// An external loan is money lent INTO a company by someone outside the
// mortgage book: a private lender, a director, family, a bridging lender.
// The user records who it is from, how much, when it arrived, the term and
// the annual rate, and the engine produces the monthly schedule. Each month
// is ticked off once it has been paid; a tick is a record that the payment
// happened, never an instruction to pay.
//
// Three repayment types:
//   repayment      capital + interest, the same payment every month
//                  (standard amortisation, last payment clears the pennies)
//   interest_only  interest every month, capital repaid with the last one
//   rolled_up      nothing monthly; capital + simple interest repaid in one
//                  payment at the end of the term
//
// Dates are ISO yyyy-mm-dd strings throughout.

export const REPAYMENT_TYPES = [
  { value: 'repayment',     label: 'Capital + interest (repayment)', short: 'Repayment' },
  { value: 'interest_only', label: 'Interest only, capital at end',  short: 'Interest only' },
  { value: 'rolled_up',     label: 'Rolled up, all repaid at end',   short: 'Rolled up' },
]

export const LENDER_TYPES = [
  { value: 'private',  label: 'Private lender' },
  { value: 'director', label: 'Director / shareholder' },
  { value: 'family',   label: 'Family or friend' },
  { value: 'bridging', label: 'Bridging lender' },
  { value: 'bank',     label: 'Bank / business loan' },
  { value: 'other',    label: 'Other' },
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100

const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)

// Add whole months to an ISO date, clamping to the end of a short month
// (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
export function addMonths(iso, months) {
  if (!isISO(iso)) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = (m - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const day = Math.min(d, last)
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// First payment defaults to one month after the money arrived.
export function firstPaymentDate(loan) {
  if (isISO(loan?.first_payment_date)) return loan.first_payment_date.slice(0, 10)
  return addMonths(loan?.received_date, 1)
}

/**
 * The regular monthly payment for a loan.
 *   repayment      P·r / (1 − (1+r)^−n), or P/n at 0%
 *   interest_only  P·r
 *   rolled_up      0 (nothing paid until the end)
 */
export function monthlyPayment({ principal, annual_rate, term_months, repayment_type = 'repayment' }) {
  const P = num(principal), n = Math.round(num(term_months)), r = num(annual_rate) / 100 / 12
  if (P <= 0 || n <= 0) return 0
  if (repayment_type === 'rolled_up') return 0
  if (repayment_type === 'interest_only') return round2(P * r)
  if (r === 0) return round2(P / n)
  return round2(P * r / (1 - Math.pow(1 + r, -n)))
}

/**
 * The full schedule: one row per month for repayment and interest_only
 * loans, a single row at the end of the term for rolled_up.
 * Row: { period, due_date, payment, interest, principal, balance }
 * `balance` is the capital still owed after that payment.
 */
export function buildSchedule(loan) {
  const P = num(loan?.principal), n = Math.round(num(loan?.term_months))
  const r = num(loan?.annual_rate) / 100 / 12
  const type = loan?.repayment_type || 'repayment'
  const first = firstPaymentDate(loan)
  if (P <= 0 || n <= 0 || !first) return []

  if (type === 'rolled_up') {
    const interest = round2(P * (num(loan?.annual_rate) / 100) * (n / 12))
    return [{ period: 1, due_date: addMonths(first, n - 1), payment: round2(P + interest), interest, principal: round2(P), balance: 0 }]
  }

  const pay = monthlyPayment(loan)
  const rows = []
  let balance = P
  for (let i = 1; i <= n; i++) {
    const interest = round2(balance * r)
    let principal
    if (type === 'interest_only') principal = i === n ? balance : 0
    else principal = i === n ? balance : Math.min(balance, round2(pay - interest))
    principal = round2(principal)
    balance = round2(balance - principal)
    rows.push({ period: i, due_date: addMonths(first, i - 1), payment: round2(interest + principal), interest, principal, balance })
  }
  return rows
}

export function livePayments(loan) {
  return (Array.isArray(loan?.external_loan_payments) ? loan.external_loan_payments : []).filter(p => p && !p.deleted_at)
}

/**
 * Schedule rows merged with ticks, plus the loan's money summary.
 *   rows[].paid       the tick row for that period, or null
 *   rows[].overdue    unpaid and due before today
 *   totalRepayable    sum of every scheduled payment
 *   totalInterest     totalRepayable − principal
 *   paidToDate        sum of amounts actually recorded on ticks
 *   outstanding       capital still owed: principal less the capital share
 *                     of every ticked period
 *   nextDue           the earliest unpaid row (may be overdue)
 *   overdueCount / overdueAmount
 *   status            'repaid' | 'overdue' | 'active'
 */
export function loanStatus(loan, today = todayISO()) {
  const schedule = buildSchedule(loan)
  const byPeriod = new Map(livePayments(loan).map(p => [Number(p.period), p]))
  const rows = schedule.map(row => {
    const paid = byPeriod.get(row.period) || null
    return { ...row, paid, overdue: !paid && row.due_date < today }
  })
  const principal = num(loan?.principal)
  const totalRepayable = round2(schedule.reduce((s, r) => s + r.payment, 0))
  const paidRows = rows.filter(r => r.paid)
  const paidToDate = round2(paidRows.reduce((s, r) => s + num(r.paid.amount ?? r.payment), 0))
  const capitalRepaid = round2(paidRows.reduce((s, r) => s + r.principal, 0))
  const unpaid = rows.filter(r => !r.paid)
  const overdueRows = unpaid.filter(r => r.overdue)
  const repaid = rows.length > 0 && unpaid.length === 0
  return {
    rows,
    regularPayment: monthlyPayment(loan),
    totalRepayable,
    totalInterest: round2(totalRepayable - principal),
    paidToDate,
    paidCount: paidRows.length,
    periods: rows.length,
    outstanding: round2(Math.max(0, principal - capitalRepaid)),
    nextDue: unpaid[0] || null,
    overdueCount: overdueRows.length,
    overdueAmount: round2(overdueRows.reduce((s, r) => s + r.payment, 0)),
    finalDate: rows.length ? rows[rows.length - 1].due_date : null,
    status: repaid ? 'repaid' : overdueRows.length ? 'overdue' : 'active',
  }
}

/**
 * Totals across a set of loans (all live loans, or one company's).
 *   borrowed        principal of loans not yet repaid
 *   outstanding     capital still owed across them
 *   monthlyOutgoing regular monthly payments on loans still running
 *                   (rolled-up loans contribute nothing until the end)
 *   dueNext30       unpaid payments due between today and 30 days out
 *   overdueCount / overdueAmount
 */
export function summariseLoans(loans, today = todayISO()) {
  const horizon = addDays(today, 30)
  const out = { count: 0, active: 0, repaid: 0, borrowed: 0, outstanding: 0, monthlyOutgoing: 0, dueNext30: 0, overdueCount: 0, overdueAmount: 0, interestTotal: 0 }
  for (const loan of loans || []) {
    if (!loan || loan.deleted_at) continue
    const s = loanStatus(loan, today)
    out.count++
    out.interestTotal += s.totalInterest
    if (s.status === 'repaid') { out.repaid++; continue }
    out.active++
    out.borrowed += num(loan.principal)
    out.outstanding += s.outstanding
    if (loan.repayment_type !== 'rolled_up') out.monthlyOutgoing += s.regularPayment
    out.overdueCount += s.overdueCount
    out.overdueAmount += s.overdueAmount
    for (const r of s.rows) if (!r.paid && r.due_date >= today && r.due_date <= horizon) out.dueNext30 += r.payment
  }
  for (const k of ['borrowed', 'outstanding', 'monthlyOutgoing', 'dueNext30', 'overdueAmount', 'interestTotal']) out[k] = round2(out[k])
  return out
}

/**
 * Every unpaid payment across loans in date order, for the "coming up" list.
 * Returns [{ loan, row }] limited to `limit` entries.
 */
export function upcomingPayments(loans, { today = todayISO(), limit = 12 } = {}) {
  const list = []
  for (const loan of loans || []) {
    if (!loan || loan.deleted_at) continue
    for (const row of loanStatus(loan, today).rows) if (!row.paid) list.push({ loan, row })
  }
  return list.sort((a, b) => a.row.due_date.localeCompare(b.row.due_date)).slice(0, limit)
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso, days) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Form validation shared by create and edit. Returns an error string or null.
export function validateLoan(f) {
  if (!f?.company_id) return 'Choose the company that received the loan'
  if (!String(f?.lender_name || '').trim()) return 'Say who the loan is from'
  if (!(num(f?.principal) > 0)) return 'Enter the amount borrowed'
  if (!isISO(f?.received_date)) return 'Enter the date the money came in'
  const n = num(f?.term_months)
  if (!(n >= 1 && n <= 600 && Number.isInteger(n))) return 'Term must be a whole number of months (1 to 600)'
  const rate = num(f?.annual_rate)
  if (rate < 0 || rate > 100) return 'Interest rate must be between 0% and 100%'
  if (f?.first_payment_date && isISO(f.first_payment_date) && f.first_payment_date < f.received_date) return 'First payment cannot be before the money came in'
  return null
}
