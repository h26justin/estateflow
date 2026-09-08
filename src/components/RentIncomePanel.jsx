import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import { monthRate } from '../lib/rentForecast'

// ── RENTAL INCOME DASHBOARD SECTION ──────────────────────────────────────────
// The one place on the dashboard that answers, month by month, "what should
// we have collected, what have we collected, what is still outstanding" — the
// view the lettings agents work from to find the gaps. Sits above the KPI
// cards by default.
//
//   months     rentMonthSnapshot() output for the year to date, newest first
//   companies  companyStats rows (id, name, color) for the per-company table
//   onOpenRent navigate to the Rent Tracker
//
// Figures are by rent period (the month the rent is for), matching the Rent
// Tracker. Short-term-let income is excluded: it has no monthly expectation.

const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
const pct = r => r == null ? '–' : `${r}%`

export default function RentIncomePanel({ months = [], companies = [], onOpenRent, isMobile = false }) {
  const { T } = useTheme()
  if (!months.length) return null
  const cur = months[0]
  const chrono = [...months].reverse()
  const ytd = months.reduce((a, mo) => ({
    expected: a.expected + mo.expected, received: a.received + mo.received, needsBackfill: a.needsBackfill + mo.needsBackfill,
  }), { expected: 0, received: 0, needsBackfill: 0 })
  ytd.outstanding = Math.max(0, ytd.expected - ytd.received)
  const ytdRate = monthRate(ytd)
  const curRate = monthRate(cur)
  const year = cur.year

  // Warning colours belong to completed months only; this month is still
  // being collected, so its figures stay neutral/green.
  const rateColor = (r, isCurrent) => r == null ? T.muted : isCurrent ? T.green : r >= 95 ? T.green : r >= 80 ? T.amber : T.red
  const outstandingColor = (mo, isCurrent) => mo.outstanding <= 0 ? T.green : isCurrent ? T.amber : rateColor(monthRate(mo), false)

  const th = { fontFamily: MONO, fontSize: 9, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', padding: '0 0 8px 14px', whiteSpace: 'nowrap', fontWeight: 400 }
  const thFirst = { ...th, textAlign: 'left', padding: '0 0 8px 0' }
  const td = { fontFamily: MONO, fontSize: 12, color: T.text, textAlign: 'right', padding: '7px 0 7px 14px', borderTop: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const tdFirst = { ...td, textAlign: 'left', padding: '7px 0', color: T.muted }

  const tile = (label, value, sub, color) => (
    <div style={{ background: T.bg, borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || T.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 4 }}>{sub}</div>}
    </div>
  )

  const backfillMonths = chrono.filter(mo => mo.needsBackfill > 0)
  const recent = months.slice(0, 3) // newest first: this month and the two before

  return (
    <section className="card" style={{ padding: '20px 22px', marginBottom: 20 }} aria-label="Rental income">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Rental Income</h2>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>Due vs collected by rent month · {year} to date</div>
        </div>
        {onOpenRent && (
          <button onClick={onOpenRent} aria-label="Open Rent Tracker"
            style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: 10, color: T.muted, letterSpacing: '0.1em', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            RENT TRACKER <Icon name="arrow-right" size={11} />
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {tile(`Due · ${cur.label}`, fmt(cur.expected), 'Collectible rent from tenancies this month', T.gold)}
        {tile(`Collected so far · ${cur.label.slice(0, 3)}`, fmt(cur.received), cur.expected > 0 ? `${pct(curRate)} of what is due` : 'Nothing due yet', T.green)}
        {tile(`Outstanding · ${cur.label.slice(0, 3)}`, fmt(cur.outstanding), 'Still to collect this month', cur.outstanding > 0 ? T.amber : T.green)}
        {tile(`${year} to date`, fmt(ytd.received), `${pct(ytdRate)} of ${fmt(ytd.expected)} due · ${fmt(ytd.outstanding)} outstanding`, T.text)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,1fr)', gap: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>By month</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th style={thFirst}>Month</th><th style={th}>Due</th><th style={th}>Collected</th><th style={th}>Outstanding</th><th style={th}>Collected %</th></tr>
              </thead>
              <tbody>
                {chrono.map(mo => {
                  const isCurrent = mo === cur
                  const r = monthRate(mo)
                  const empty = mo.periods === 0
                  return (
                    <tr key={mo.key} style={{ fontWeight: isCurrent ? 700 : 400 }}>
                      <td style={{ ...tdFirst, color: isCurrent ? T.text : T.muted }}>{mo.label}{isCurrent ? ' (so far)' : ''}</td>
                      <td style={td}>{empty ? '–' : fmt(mo.expected)}</td>
                      <td style={{ ...td, color: T.green }}>{empty ? '–' : fmt(mo.received)}</td>
                      <td style={{ ...td, color: empty ? T.muted : outstandingColor(mo, isCurrent) }}>{empty ? '–' : fmt(mo.outstanding)}</td>
                      <td style={{ ...td, color: rateColor(r, isCurrent) }}>{pct(r)}</td>
                    </tr>
                  )
                })}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...tdFirst, color: T.text, borderTop: `2px solid ${T.border}` }}>{year} to date</td>
                  <td style={{ ...td, borderTop: `2px solid ${T.border}` }}>{fmt(ytd.expected)}</td>
                  <td style={{ ...td, color: T.green, borderTop: `2px solid ${T.border}` }}>{fmt(ytd.received)}</td>
                  <td style={{ ...td, color: ytd.outstanding > 0 ? T.amber : T.green, borderTop: `2px solid ${T.border}` }}>{fmt(ytd.outstanding)}</td>
                  <td style={{ ...td, color: rateColor(ytdRate, true), borderTop: `2px solid ${T.border}` }}>{pct(ytdRate)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {backfillMonths.length > 0 && (
            <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>
              Collected is understated where a month was marked paid with no amount: {backfillMonths.map(mo => `${mo.label.slice(0, 3)} ${mo.needsBackfill}`).join(' · ')}. Enter the amounts in the Rent Tracker.
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>By company · {cur.label}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thFirst}>Company</th><th style={th}>Due</th><th style={th}>Collected</th><th style={th}>Outstanding</th>
                  {recent.map(mo => <th key={mo.key} style={th}>{mo.label.slice(0, 3)} %</th>)}
                </tr>
              </thead>
              <tbody>
                {companies.map(c => {
                  const s = cur.byCompany[c.id] || { expected: 0, received: 0 }
                  const outstanding = Math.max(0, s.expected - s.received)
                  const curR = monthRate(s)
                  return (
                    <tr key={c.id}>
                      <td style={{ ...tdFirst, color: T.text }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c.color, marginRight: 8, verticalAlign: 'middle' }} />{c.name}</td>
                      <td style={td}>{fmt(s.expected)}</td>
                      <td style={{ ...td, color: T.green }}>{fmt(s.received)}</td>
                      <td style={{ ...td, color: outstanding > 0 ? T.amber : T.green }}>{fmt(outstanding)}</td>
                      {recent.map((mo, i) => {
                        const ms = mo.byCompany[c.id]
                        const r = ms ? monthRate(ms) : null
                        return <td key={mo.key} style={{ ...td, color: rateColor(r, i === 0) }}>{i === 0 ? pct(curR) : pct(r)}</td>
                      })}
                    </tr>
                  )
                })}
                {companies.length === 0 && <tr><td style={tdFirst} colSpan={4 + recent.length}>No companies selected</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>
            Figures are by rent period, the month the rent is for, matching the Rent Tracker. Short-term-let income is reported on its own page.
          </div>
        </div>
      </div>
    </section>
  )
}
