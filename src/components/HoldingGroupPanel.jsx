// Group view for a HOLDING company — rendered in the Portfolio → Companies
// tab in place of the operating company's stats + property list (a holding
// company has no properties; showing it an empty portfolio was noise).
//
// What it shows: every company this one holds a stake in — derived from
// company_shareholders rows linked via shareholder_company_id, looking
// through intermediate holdings (companyEffectiveStakes) — with the
// attributable slice of each company's value, invested capital, and rent.
// Attributable = stake % × the company's own figures: a planning view of
// "what is this holding company worth / earning", not a formal valuation.
//
// Also carries the holding-specific CT setting: whether the company is a
// PASSIVE holding company (shares + pass-through dividends only). Passive
// holdcos are excluded from HMRC's associated-company count, which sets how
// the corporation tax thresholds are split across the group — see
// countAssociatedCompanies in companyPnl.js.

import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import { fmt } from '../lib/format'
import * as api from '../lib/api'
import { companyEffectiveStakes } from '../lib/companyPnl'
import { isPropertyEarningRent } from '../lib/propertyStatus'

export default function HoldingGroupPanel({ company, companies = [], properties = [], T, canEdit, onUpdateCompany, showToast }) {
  const [shareholders, setShareholders] = useState(null) // null = loading
  const [savingPassive, setSavingPassive] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.fetchAllShareholders()
      .then(rows => { if (!cancelled) setShareholders(rows) })
      .catch(e => {
        console.error('Holding group panel load failed', e)
        if (!cancelled) { setShareholders([]); showToast?.(e.message || 'Could not load group holdings', 'error') }
      })
    return () => { cancelled = true }
  }, [company.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function togglePassive(next) {
    setSavingPassive(true)
    try {
      const row = await api.updateCompany(company.id, { ct_passive: next })
      onUpdateCompany?.(row)
    } catch (e) { showToast?.(e.message || 'Could not update CT setting', 'error') }
    setSavingPassive(false)
  }

  if (shareholders === null) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '14px 4px' }}>Loading group holdings…</div>
  }

  const stakes = companyEffectiveStakes(shareholders, company.id)
  const rows = companies
    .filter(c => stakes[c.id] > 0)
    .map(c => {
      const ps = properties.filter(p => p.company_id === c.id)
      const pct = stakes[c.id]
      const f = pct / 100
      const estVal = ps.reduce((s, p) => s + (p.est_value || 0), 0)
      const invested = ps.reduce((s, p) => s + (p.purchase_price || 0) + (p.refurb_cost || 0), 0)
      const monthlyRent = ps.filter(p => isPropertyEarningRent(p.status)).reduce((s, p) => s + (p.rent_pcm || 0), 0)
      return {
        c, pct, propCount: ps.length,
        attrVal: estVal * f, attrInvested: invested * f, attrRent: monthlyRent * f,
      }
    })
    .sort((a, b) => b.attrVal - a.attrVal)
  const tVal = rows.reduce((s, r) => s + r.attrVal, 0)
  const tInvested = rows.reduce((s, r) => s + r.attrInvested, 0)
  const tRent = rows.reduce((s, r) => s + r.attrRent, 0)

  const tile = (label, value, sub, accent) => (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent || T.text }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 18 }}>
        {tile('Attributable value', fmt(tVal), `across ${rows.length} ${rows.length === 1 ? 'company' : 'companies'}`, T.gold)}
        {tile('Attributable invested', fmt(tInvested))}
        {tile('Attributable rent', fmt(tRent) + '/mo', fmt(tRent * 12) + '/yr', T.green)}
      </div>

      <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2 }}>Group holdings</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 12, lineHeight: 1.6, maxWidth: 620 }}>
          Companies this one holds a stake in, from the shareholder links. Attributable figures are the stake %
          × each company's own numbers — a planning view, not a formal valuation of {company.abbr || company.name}.
        </div>
        {rows.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '10px 0', lineHeight: 1.7 }}>
            No holdings linked yet. On each company this one owns, open Shareholders, add
            "{company.name}" as a <b>Company</b> shareholder, and link it to this record — its stake
            and figures will appear here.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map(r => (
              <div key={r.c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.c.color || T.gold }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.c.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{r.propCount} {r.propCount === 1 ? 'property' : 'properties'}</span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.gold }} title="Effective stake, looking through any intermediate holding companies">{r.pct.toFixed(2)}%</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.text, minWidth: 90, textAlign: 'right' }} title="Stake × estimated value">{fmt(r.attrVal)}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.green, minWidth: 80, textAlign: 'right' }} title="Stake × monthly rent">{fmt(r.attrRent)}/mo</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 10 }}>
          Dividend income and the profit split live in Reports → Company P&L with {company.abbr || company.name} selected.
        </div>
      </div>

      <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2 }}>Corporation tax status</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: canEdit ? 'pointer' : 'default', marginTop: 8 }}>
          <input type="checkbox" checked={company.ct_passive !== false} disabled={!canEdit || savingPassive}
            onChange={e => togglePassive(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.text, lineHeight: 1.7 }}>
            Passive holding company — it only holds shares and passes dividends through.
            <span style={{ color: T.muted, display: 'block', fontSize: 10 }}>
              Passive holding companies are excluded from HMRC's associated-company count, which sets how the
              £50k/£250k corporation tax thresholds are split across your companies. Untick if it charges the
              group management fees or loan interest, holds its own assets, or retains dividends — it then
              counts, and every company's estimated CT thresholds shrink accordingly. Confirm with your accountant.
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
