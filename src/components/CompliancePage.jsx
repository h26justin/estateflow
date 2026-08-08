// ── COMPLIANCE PAGE ──────────────────────────────────────────────────────────
// Top-level portfolio compliance home (replaced the old top-level Insurance
// tab — insurance is now a sub-view here). Three sub-views:
//   • Overview  — one card per property: every tracked requirement with a
//                 tick / cross / countdown, so the whole portfolio's position
//                 is readable in one scroll.
//   • Matrix    — the dense properties × certificates grid (moved out of
//                 Portfolio → Compliance, which this page supersedes).
//   • Insurance — the full policy register (InsurancePage, embedded).
//
// What each property is judged against comes from lib/complianceCatalogue.js
// filtered by (a) the company's Settings → Compliance Tracking toggles and
// (b) the property's applicability flags (gas supply, heating type, HMO,
// licensing scheme). Sub-view is addressable: #/compliance/<sub>.

import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import * as api from '../lib/api'
import { MONO } from '../lib/styles'
import InsurancePage from './InsurancePage'
import EpcBadge from './EpcBadge'
import { COMPLIANCE_CATALOGUE, TIER_LABELS, requirementsForProperty, trackedRequirements, isOptedOut } from '../lib/complianceCatalogue'
import { requirementStatus, propertyComplianceSummary, certTypeStatus, insuranceStatusFor } from '../lib/complianceStatus'

const mono = MONO
const SUBS = [['overview', 'Overview'], ['matrix', 'Matrix'], ['insurance', 'Insurance']]

// Small local company pill (CompanyPill lives in App.jsx; not worth a
// cross-module export for two colour spans).
function CoPill({ company, T }) {
  if (!company) return null
  const col = company.color || T.gold
  return <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: col, background: col + '1A', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{company.abbr || company.name}</span>
}

// One requirement line on a property card: status glyph + label + detail.
// tick = in date, amber = due soon, red cross = expired or missing-required,
// muted cross = recommended-but-absent (tier 3).
function ReqRow({ req, status, T, onClick }) {
  const days = status.days
  let color, iconName, detail
  if (status.state === 'off') {
    // Switched off for this property (per-property toggle on the
    // Compliance tab) — visible but dimmed, so the card still shows what's
    // deliberately not tracked without shouting about it.
    return (
      <button onClick={onClick} title={`${req.label} — switched off for this property`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%', background: 'transparent', border: `1px dashed ${T.border}`, opacity: 0.45 }}>
        <Icon name="bell-off" size={14} color={T.faint} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.short}</span>
        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: T.faint, whiteSpace: 'nowrap' }}>Off</span>
      </button>
    )
  }
  if (status.state === 'valid') {
    color = T.green; iconName = 'check-circle'
    detail = days === null ? 'On file' : `${days}d`
  } else if (status.state === 'expiring') {
    color = T.amber; iconName = 'alert-circle'; detail = `${days}d left`
  } else if (status.state === 'expired') {
    color = T.red; iconName = 'alert-triangle'; detail = `${Math.abs(days)}d overdue`
  } else {
    // missing — severity depends on the tier. Insurance isn't statutory but
    // a gap is money-serious, so it warns amber rather than reading muted.
    const required = req.tier <= 2
    color = required ? T.red : (req.key === 'insurance' ? T.amber : T.faint)
    iconName = 'x'
    detail = required ? 'Missing' : (req.key === 'insurance' ? 'None on file' : 'Not on file')
  }
  return (
    <button onClick={onClick} title={`${req.label} — ${TIER_LABELS[req.tier]}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%', background: 'transparent', border: `1px solid ${T.border}`, transition: 'border-color 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color + '88' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border }}>
      <Icon name={iconName} size={14} color={color} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.short}</span>
      <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{detail}</span>
    </button>
  )
}

// One property's compliance card: header (name / company / score) + a
// responsive grid of every tracked requirement that applies to it.
function PropertyCard({ property, company, settings, policies, T, openDetail, gotoInsurance }) {
  const summary = propertyComplianceSummary(property, settings, policies)
  const missingRequired = summary.rows.filter(r => r.status.state === 'missing' && r.req.tier <= 2).length
  const scoreColor = (summary.expired > 0 || missingRequired > 0) ? T.red
    : (summary.expiring > 0 || summary.missing > 0) ? T.amber : T.green
  const allGood = summary.expired === 0 && summary.expiring === 0 && summary.missing === 0
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => openDetail(property)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{property.name}</span>
        </button>
        <CoPill company={company} T={T} />
        {property.prop_type && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{property.prop_type}</span>}
        <EpcBadge property={property} T={T} />
        <span style={{ flex: 1 }} />
        {allGood && <Icon name="check-circle" size={15} color={T.green} />}
        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: scoreColor, background: scoreColor + '1A', padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
          {summary.held}/{summary.total} in date
        </span>
      </div>
      {summary.total === 0
        ? <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>Nothing tracked for this property — check Settings → Compliance Tracking.</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {summary.rows.map(({ req, status }) => (
              <ReqRow key={req.key} req={req} status={status} T={T}
                onClick={() => req.group === 'insurance' ? gotoInsurance() : openDetail(property)} />
            ))}
          </div>}
    </div>
  )
}

// ── MATRIX (moved from App.jsx's Portfolio → Compliance sub-tab) ─────────────
// Dense properties × requirement grid. Columns come from the catalogue
// (certificates + licences + insurance — tenancy paperwork stays on the
// Overview cards where there's room to read it), filtered to what at least
// one visible company still tracks. n/a cells mark not-applicable, so a
// gas-free flat isn't "missing" a CP12.
function ComplianceMatrix({ properties, companies, settingsFor, policies, openDetail, T }) {
  const trackedAnywhere = useMemo(() => {
    const keys = new Set()
    const lists = companies.length ? companies.map(c => trackedRequirements(settingsFor(c.id))) : [trackedRequirements({})]
    for (const list of lists) for (const r of list) keys.add(r.key)
    return keys
  }, [companies, settingsFor])
  const cols = COMPLIANCE_CATALOGUE.filter(r => r.group !== 'tenancy' && trackedAnywhere.has(r.key))

  const cellFor = (p, req) => {
    if (req.applies && !req.applies(p)) return { state: 'na' }
    if (!trackedRequirements(settingsFor(p.company_id)).some(r => r.key === req.key)) return { state: 'na' }
    if (isOptedOut(p, req.key)) return { state: 'off' }
    return req.group === 'insurance' ? insuranceStatusFor(p, policies) : certTypeStatus(p, req.key)
  }

  let expired = 0, expiring = 0, valid = 0
  properties.forEach(p => cols.forEach(req => { const c = cellFor(p, req); if (c.state === 'expired') expired++; else if (c.state === 'expiring') expiring++; else if (c.state === 'valid') valid++ }))
  const attention = properties.map(p => ({ p, issues: cols.map(req => ({ lbl: req.short, ...cellFor(p, req) })).filter(c => c.state === 'expired' || c.state === 'expiring') }))
    .filter(x => x.issues.length)
    .sort((a, b) => Math.min(...a.issues.map(i => i.days)) - Math.min(...b.issues.map(i => i.days)))
  const tiles = [{ l: 'Expired', v: expired, c: T.red }, { l: 'Expiring soon', v: expiring, c: T.amber }, { l: 'Valid', v: valid, c: T.green }]

  const cellPill = (c) => {
    if (c.state === 'na') return <span style={{ color: T.faint, fontFamily: mono, fontSize: 9 }}>n/a</span>
    if (c.state === 'off') return <span style={{ color: T.faint, fontFamily: mono, fontSize: 9, opacity: 0.6 }}>off</span>
    if (c.state === 'missing') return <span style={{ color: T.faint, fontFamily: mono, fontSize: 12 }}>—</span>
    const map = { expired: [T.red, 'Expired'], expiring: [T.amber, `${c.days}d`], valid: [T.green, 'Valid'] }
    const [col, txt] = map[c.state]
    return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '3px 8px', borderRadius: 999, background: col + '1A', color: col, fontFamily: mono, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>{txt}</span>
  }

  const GRID = `minmax(150px,1.4fr) repeat(${cols.length}, minmax(58px,1fr))`
  if (!properties.length) return <div style={{ fontFamily: mono, color: T.muted, fontSize: 12, padding: 32, textAlign: 'center' }}>No properties to track compliance for yet.</div>
  const ordered = [...companies, { id: null }].flatMap(co => properties.filter(p => p.company_id === co.id).map(p => ({ ...p, _co: co })))
  return (
    <div className="fade">
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        {tiles.map(t => (
          <div key={t.l} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{t.l}</div>
            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 500, color: t.c }}>{t.v}</div>
          </div>
        ))}
      </div>
      {attention.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10 }}>Needs attention</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {attention.slice(0, 8).map(({ p, issues }) => (
              <div key={p.id} className="card pcard" onClick={() => openDetail(p)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{p.name}</span>
                <CoPill company={p._co?.id ? p._co : null} T={T} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  {issues.map(i => (
                    <span key={i.lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: (i.state === 'expired' ? T.red : T.amber) + '1A', color: i.state === 'expired' ? T.red : T.amber, fontFamily: mono, fontSize: 9, fontWeight: 700 }}>
                      {i.lbl} {i.state === 'expired' ? 'expired' : `${i.days}d`}
                    </span>
                  ))}
                </div>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.gold, whiteSpace: 'nowrap' }}>Review →</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 14, background: T.card }}>
        <div style={{ minWidth: 380 + cols.length * 62 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: T.card }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Property</div>
            {cols.map(req => <div key={req.key} title={req.label} style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>{req.short}</div>)}
          </div>
          {ordered.map((p, i) => {
            const prev = i > 0 ? ordered[i - 1] : null
            const showCo = !prev || prev.company_id !== p.company_id
            return (
              <div key={p.id}>
                {showCo && p._co?.id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ width: 3, height: 14, borderRadius: 2, background: p._co.color || T.gold }} />
                    <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: p._co.color || T.gold }}>{p._co.abbr}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{p._co.name}</span>
                  </div>
                )}
                <div onClick={() => openDetail(p)} className="pcard" style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '9px 14px', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
                  <div style={{ minWidth: 0, paddingRight: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.prop_type}</div>
                  </div>
                  {cols.map(req => <div key={req.key} style={{ textAlign: 'center' }}>{cellPill(cellFor(p, req))}</div>)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function CompliancePage({ user, companies = [], properties = [], companySettings = {}, showToast, openDetail }) {
  const { T } = useTheme()
  // Sub-view is addressable (#/compliance/<sub>) so deep links from the old
  // #/insurance route and the dashboard widget land on the right pane.
  // App.jsx maps legacy hashes and dispatches set-compliance-tab on popstate.
  const initialSub = () => {
    const m = window.location.hash.match(/^#\/compliance\/([a-z]+)/)
    return m && SUBS.some(([k]) => k === m[1]) ? m[1] : 'overview'
  }
  const [sub, setSub] = useState(initialSub)
  const [policies, setPolicies] = useState([])
  const [coFilter, setCoFilter] = useState('all')

  useEffect(() => {
    const handler = (e) => { const t = e.detail?.tab; if (t && SUBS.some(([k]) => k === t)) setSub(t) }
    window.addEventListener('ownproperly:set-compliance-tab', handler)
    return () => window.removeEventListener('ownproperly:set-compliance-tab', handler)
  }, [])

  useEffect(() => {
    api.fetchInsurancePolicies().then(setPolicies).catch(() => setPolicies([]))
  }, [])

  function changeSub(k) {
    setSub(k)
    window.history.replaceState(null, '', k === 'overview' ? '#/compliance' : `#/compliance/${k}`)
  }

  const settingsFor = (companyId) => companySettings[companyId] || {}
  // Sold/archived properties don't need live compliance (matches the old
  // Portfolio matrix behaviour).
  const active = useMemo(() => (properties || []).filter(p => p.status !== 'sold' && !p.archived_at), [properties])
  const filtered = coFilter === 'all' ? active : active.filter(p => p.company_id === coFilter)
  const coById = Object.fromEntries(companies.map(c => [c.id, c]))

  // Portfolio-level summary tiles for the overview.
  const totals = useMemo(() => {
    let expired = 0, expiring = 0, missingRequired = 0, fullyInDate = 0
    for (const p of filtered) {
      const s = propertyComplianceSummary(p, settingsFor(p.company_id), policies)
      expired += s.expired
      expiring += s.expiring
      missingRequired += s.rows.filter(r => r.status.state === 'missing' && r.req.tier <= 2).length
      if (s.total > 0 && s.expired === 0 && s.missing === 0 && s.expiring === 0) fullyInDate++
    }
    return { expired, expiring, missingRequired, fullyInDate }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, policies, companySettings])

  const ordered = [...companies, { id: null }].flatMap(co => filtered.filter(p => p.company_id === co.id).map(p => ({ p, co: co.id ? co : null })))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 4 }}>Compliance</h1>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
            Certificates, licences, tenancy paperwork and insurance across {active.length} {active.length === 1 ? 'property' : 'properties'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUBS.map(([k, l]) => (
            <button key={k} onClick={() => changeSub(k)}
              style={{
                fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${sub === k ? T.gold : T.border}`,
                background: sub === k ? T.gold + '22' : 'transparent',
                color: sub === k ? T.gold : T.muted, fontWeight: sub === k ? 700 : 400,
              }}>{l}</button>
          ))}
        </div>
      </div>

      {sub === 'insurance' ? (
        <InsurancePage embedded user={user} companies={companies} properties={properties} showToast={showToast} />
      ) : (
        <>
          {companies.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>Filter:</span>
              {[{ id: 'all', abbr: 'All', color: T.gold }, ...companies].map(c => (
                <button key={c.id} onClick={() => setCoFilter(c.id)}
                  style={{
                    fontFamily: mono, fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                    border: `1px solid ${coFilter === c.id ? (c.color || T.gold) : T.border}`,
                    background: coFilter === c.id ? (c.color || T.gold) + '22' : 'transparent',
                    color: coFilter === c.id ? (c.color || T.gold) : T.muted, transition: 'all 0.18s',
                  }}>{c.abbr || c.name}</button>
              ))}
            </div>
          )}

          {sub === 'matrix' ? (
            <ComplianceMatrix properties={filtered} companies={companies} settingsFor={settingsFor} policies={policies} openDetail={openDetail} T={T} />
          ) : (
            <div className="fade">
              <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
                {[
                  { l: 'Expired', v: totals.expired, c: T.red },
                  { l: 'Expiring soon', v: totals.expiring, c: T.amber },
                  { l: 'Missing required', v: totals.missingRequired, c: T.red },
                  { l: 'Fully in date', v: totals.fullyInDate, c: T.green },
                ].map(t => (
                  <div key={t.l} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '16px 18px' }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{t.l}</div>
                    <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 500, color: t.c }}>{t.v}</div>
                  </div>
                ))}
              </div>
              {ordered.length === 0
                ? <div style={{ fontFamily: mono, color: T.muted, fontSize: 12, padding: 32, textAlign: 'center' }}>No properties to track compliance for yet.</div>
                : <div style={{ display: 'grid', gap: 12 }}>
                    {ordered.map(({ p, co }, i) => {
                      const prev = i > 0 ? ordered[i - 1] : null
                      const showCo = co && (!prev || prev.p.company_id !== p.company_id)
                      return (
                        <div key={p.id}>
                          {showCo && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 10px 2px' }}>
                              <span style={{ width: 3, height: 14, borderRadius: 2, background: co.color || T.gold }} />
                              <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: co.color || T.gold }}>{co.abbr}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{co.name}</span>
                            </div>
                          )}
                          <PropertyCard property={p} company={co} settings={settingsFor(p.company_id)} policies={policies}
                            T={T} openDetail={openDetail} gotoInsurance={() => changeSub('insurance')} />
                        </div>
                      )
                    })}
                  </div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
