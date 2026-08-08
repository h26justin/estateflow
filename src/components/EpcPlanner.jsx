import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { showAppToast } from '../lib/toast'
import { fmt } from '../lib/format'
import { fetchLatestEpcAssessment, generateEpcPlan, deleteEpcAssessment, fetchEpcCertificate, syncEpcFromRegister, syncAllEpcFromRegister } from '../lib/api/epc'

const mono = MONO
const RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const DEADLINE_ISO = '2030-12-31'

// Band colours roughly mirror the EPC certificate gradient (green → red).
const BAND_COLOR = {
  A: '#1a8a3c', B: '#3aa655', C: '#8dc63f',
  D: '#f0c419', E: '#f39c12', F: '#e8770c', G: '#d0021b',
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function countdownToDeadline() {
  const now = new Date()
  const end = new Date(DEADLINE_ISO + 'T00:00:00')
  const ms = end - now
  if (ms <= 0) return { passed: true, days: 0, years: 0, months: 0 }
  const days = Math.floor(ms / 86400000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return { passed: false, days, years, months }
}

function RatingBadge({ rating, label, T }) {
  const r = (rating || '?').toUpperCase()
  const bg = BAND_COLOR[r] || T.border
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 12, background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: mono, fontSize: 26, fontWeight: 700, color: '#fff',
      }}>{r}</div>
      <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginTop: 6 }}>{label}</div>
    </div>
  )
}

export default function EpcPlanner({ property, T: TProp, canWrite = true }) {
  const { T: TCtx } = useTheme()
  const T = TProp || TCtx
  const confirm = useConfirm()

  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [manualRating, setManualRating] = useState(property?.epc_rating || '')
  const [propertyType, setPropertyType] = useState('')
  const [region, setRegion] = useState('')
  const [cert, setCert] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncNote, setSyncNote] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchLatestEpcAssessment(property.id)
      .then(row => { if (alive) { setPlan(row); if (row?.current_rating) setManualRating(row.current_rating) } })
      .catch(e => { if (alive) setError(e.message || 'Could not load EPC plan') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [property.id])

  // Certificate from the official register. If this property has never been
  // checked, quietly check it the first time the tab opens.
  useEffect(() => {
    let alive = true
    setCert(null)
    setSyncNote('')
    fetchEpcCertificate(property.id)
      .then(row => {
        if (!alive) return
        setCert(row)
        if (row?.current_rating) setManualRating(m => m || row.current_rating)
        if (!row && canWrite && !property?.epc_last_checked_at) runSync(true)
      })
      .catch(() => { /* table may predate feature rollout */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id])

  async function refreshCert() {
    const row = await fetchEpcCertificate(property.id)
    setCert(row)
    if (row?.current_rating) setManualRating(m => m || row.current_rating)
    return row
  }

  async function runSync(silent = false) {
    setSyncing(true)
    setSyncNote('')
    try {
      const res = await syncEpcFromRegister(property.id)
      await refreshCert()
      if (res?.status === 'found') {
        if (!silent) showAppToast(`EPC found — band ${res.rating || '?'}`)
      } else if (res?.status === 'no_postcode') {
        setSyncNote('No postcode found in the property address — add one to enable the register lookup.')
      } else if (res?.status === 'not_found') {
        setSyncNote('No EPC found on the register for this address (England & Wales only).')
      } else if (res?.error) {
        setSyncNote(res.error)
      }
    } catch (e) {
      setSyncNote(e.message || 'EPC register lookup failed')
      if (!silent) showAppToast(e.message || 'EPC register lookup failed', 'error')
    }
    setSyncing(false)
  }

  async function runSyncAll() {
    setSyncingAll(true)
    setSyncNote('')
    try {
      const res = await syncAllEpcFromRegister()
      await refreshCert()
      showAppToast(`EPC register: checked ${res?.checked ?? 0} properties, found ${res?.found ?? 0} certificates`)
    } catch (e) {
      showAppToast(e.message || 'EPC register sync failed', 'error')
    }
    setSyncingAll(false)
  }

  async function runGenerate(save) {
    setGenerating(true)
    setError('')
    try {
      const result = await generateEpcPlan(property.id, {
        current_rating: manualRating || undefined,
        property_type: propertyType || undefined,
        region: region || undefined,
        save,
      })
      setPlan(result)
      if (result.current_rating) setManualRating(result.current_rating)
      showAppToast(save ? 'EPC plan saved' : 'EPC plan generated')
    } catch (e) {
      setError(e.message || 'Could not generate plan')
      showAppToast(e.message || 'Could not generate plan', 'error')
    }
    setGenerating(false)
  }

  async function handleDelete() {
    if (!plan?.id) return
    const ok = await confirm({ title: 'Delete EPC plan?', body: 'This removes the saved retrofit plan for this property.', confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    try {
      await deleteEpcAssessment(plan.id)
      setPlan(null)
      showAppToast('EPC plan deleted')
    } catch (e) {
      showAppToast(e.message || 'Could not delete plan', 'error')
    }
  }

  const cd = countdownToDeadline()
  const measures = Array.isArray(plan?.measures) ? plan.measures : []
  const total = plan?.est_total_cost != null
    ? plan.est_total_cost
    : measures.reduce((s, m) => s + (Number(m?.rough_cost_gbp) || 0), 0)
  const currentRating = plan?.current_rating || manualRating || cert?.current_rating
  const targetRating = plan?.target_rating || 'C'
  const certExpired = cert?.expiry_date && new Date(cert.expiry_date + 'T00:00:00') < new Date()

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', width: '100%' }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5 }
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }

  if (loading) {
    return <div style={{ ...card, fontFamily: mono, fontSize: 12, color: T.muted }}>Loading EPC plan…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header: current vs target + deadline countdown */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <RatingBadge rating={currentRating} label="Current" T={T} />
          <span style={{ fontFamily: mono, fontSize: 20, color: T.muted }}>→</span>
          <RatingBadge rating={targetRating} label="Target" T={T} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>2030 MEES deadline</div>
          <div style={{ fontFamily: mono, fontSize: 18, color: cd.passed ? T.gold : T.text, marginTop: 4 }}>
            {cd.passed ? 'Deadline passed' : `${cd.years}y ${cd.months}m left`}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
            {cd.passed ? '' : `${cd.days.toLocaleString('en-GB')} days · target 31 Dec 2030`}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 130 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>Est. cost to band {targetRating}</div>
          <div style={{ fontFamily: mono, fontSize: 22, color: T.gold, marginTop: 4 }}>{fmt(total)}</div>
        </div>
      </div>

      {/* Official certificate from the EPC register */}
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, letterSpacing: 1 }}>EPC REGISTER</div>
            {cert ? (
              <>
                <div style={{ fontFamily: mono, fontSize: 13, color: T.text, marginTop: 6 }}>
                  Band {cert.current_rating || '?'}
                  {cert.potential_rating ? ` (potential ${cert.potential_rating})` : ''}
                  {' · certificate '}{cert.certificate_number}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: certExpired ? '#d0021b' : T.muted, marginTop: 4 }}>
                  {cert.lodgement_date ? `Assessed ${fmtDate(cert.lodgement_date)}` : ''}
                  {cert.lodgement_date && cert.expiry_date ? ' · ' : ''}
                  {cert.expiry_date ? (certExpired ? `Expired ${fmtDate(cert.expiry_date)}` : `Valid until ${fmtDate(cert.expiry_date)}`) : ''}
                </div>
                {cert.register_address && (
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginTop: 4 }}>
                    Register address: {cert.register_address}{cert.fetched_at ? ` · last checked ${fmtDate(cert.fetched_at)}` : ''}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginTop: 6 }}>
                {syncing ? 'Checking the EPC register…' : 'No certificate logged yet.'}
              </div>
            )}
            {syncNote && (
              <div style={{ fontFamily: mono, fontSize: 10, color: T.gold, marginTop: 6 }}>{syncNote}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {cert?.certificate_url && (
              <a className="btn" href={cert.certificate_url} target="_blank" rel="noopener noreferrer">
                View certificate ↗
              </a>
            )}
            {canWrite && (
              <button className="btn" disabled={syncing || syncingAll} onClick={() => runSync(false)}>
                {syncing ? 'Checking…' : (cert ? 'Re-check register' : 'Check register')}
              </button>
            )}
            {canWrite && (
              <button className="btn btn-ghost" disabled={syncing || syncingAll} onClick={runSyncAll}>
                {syncingAll ? 'Syncing portfolio…' : 'Sync all properties'}
              </button>
            )}
          </div>
        </div>
        <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginTop: 10 }}>
          Data from the official EPC register (England &amp; Wales). Certificates open on find-energy-certificate.service.gov.uk; found EPCs are also logged on the Compliance tab with expiry reminders.
        </div>
      </div>

      {/* Inputs + generate */}
      {canWrite && (
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Current rating {(cert?.current_rating || plan?.source === 'epc_register') ? '(from EPC register)' : '(manual)'}</label>
              <select style={inp} value={manualRating} onChange={e => setManualRating(e.target.value)}>
                <option value="">Unknown</option>
                {RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Property type</label>
              <input style={inp} placeholder="e.g. Victorian terrace" value={propertyType} onChange={e => setPropertyType(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Region</label>
              <input style={inp} placeholder="e.g. North West" value={region} onChange={e => setRegion(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-gold" disabled={generating} onClick={() => runGenerate(false)}>
              {generating ? 'Generating…' : (plan ? 'Regenerate plan' : 'Generate plan')}
            </button>
            {measures.length > 0 && (
              <button className="btn" disabled={generating} onClick={() => runGenerate(true)}>Save plan</button>
            )}
            {plan?.id && (
              <button className="btn btn-ghost" disabled={generating} onClick={handleDelete}>Delete</button>
            )}
          </div>
          <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginTop: 10 }}>
            AI-generated planning guidance, not a survey or quote. Review with a qualified retrofit assessor before acting.
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...card, fontFamily: mono, fontSize: 11, color: '#d0021b' }}>⚠ {error}</div>
      )}

      {/* Summary */}
      {plan?.summary && (
        <div style={{ ...card, fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.6 }}>{plan.summary}</div>
      )}

      {/* Measures table */}
      {measures.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: mono, fontSize: 11 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', color: T.muted, fontWeight: 400 }}>#</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', color: T.muted, fontWeight: 400 }}>Measure</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', color: T.muted, fontWeight: 400 }}>Category</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', color: T.muted, fontWeight: 400 }}>SAP uplift</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', color: T.muted, fontWeight: 400 }}>Rough cost</th>
              </tr>
            </thead>
            <tbody>
              {measures.map((m, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ padding: '10px 14px', color: T.muted }}>{m.priority || i + 1}</td>
                  <td style={{ padding: '10px 14px', color: T.text }}>
                    <div>{m.name || '—'}</div>
                    {m.notes && <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>{m.notes}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', color: T.muted }}>{m.category || '—'}</td>
                  <td style={{ padding: '10px 14px', color: T.text, textAlign: 'right' }}>
                    {m.expected_sap_uplift != null ? `+${m.expected_sap_uplift}` : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: T.text, textAlign: 'right' }}>{fmt(m.rough_cost_gbp)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${T.border}`, background: T.bg }}>
                <td colSpan={4} style={{ padding: '10px 14px', color: T.muted, textAlign: 'right' }}>Estimated total</td>
                <td style={{ padding: '10px 14px', color: T.gold, textAlign: 'right' }}>{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && measures.length === 0 && !error && (
        <div style={{ ...card, fontFamily: mono, fontSize: 12, color: T.muted }}>
          No retrofit plan yet. {canWrite ? 'Generate one above to model the cheapest route to EPC C.' : 'Ask an editor to generate one.'}
        </div>
      )}
    </div>
  )
}
