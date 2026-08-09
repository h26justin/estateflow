// Ownership & management fees — rendered per company inside the
// Portfolio → Companies tab (CompaniesPanel in App.jsx).
//
// Two cards:
//   1. Shareholders — the company's cap table. Name-based (shareholders
//      don't need an app account), optional email + dividend tax band.
//      Warns when percentages don't sum to 100.
//   2. Management fees — which estate agents this company pays, and the
//      fee % of rent collected. Agents live in a per-account directory
//      shared across companies; the fee % is per (company, agent).
//
// Data feeds the "Company P&L & Profit Share" report (ReportsPage).

import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { TAX_BAND_LABELS } from '../lib/companyPnl'

const inputStyle = (T) => ({
  fontFamily: MONO, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`,
  color: T.text, borderRadius: 8, padding: '7px 10px',
})

function CardShell({ title, sub, T, children, action }) {
  return (
    <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</div>
          {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function CompanyOwnershipSection({ company, user, canEdit, T, showToast }) {
  const [shareholders, setShareholders] = useState([])
  const [agents, setAgents] = useState([])
  const [fees, setFees] = useState([])
  const [loading, setLoading] = useState(true)

  // Add-shareholder form
  const [showShForm, setShowShForm] = useState(false)
  const [shForm, setShForm] = useState({ name: '', email: '', percentage: '', taxBand: '' })
  // Add-fee form
  const [showFeeForm, setShowFeeForm] = useState(false)
  const [feeForm, setFeeForm] = useState({ agentId: '', newAgentName: '', feePercent: '', vatTreatment: 'inc_vat' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [company.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    try {
      const [sh, ag, fe] = await Promise.all([
        api.fetchShareholders(company.id),
        api.fetchEstateAgents(),
        api.fetchAgentFees(company.id),
      ])
      setShareholders(sh); setAgents(ag); setFees(fe)
    } catch (e) {
      // Table-missing (migration not yet applied) reads as a load failure —
      // show the section empty rather than crashing the Companies tab.
      console.error('Ownership section load failed', e)
      showToast?.(e.message || 'Could not load ownership data', 'error')
    }
    setLoading(false)
  }

  const ownershipTotal = shareholders.reduce((s, r) => s + (Number(r.percentage) || 0), 0)
  const totalOk = Math.abs(ownershipTotal - 100) < 0.01

  async function addShareholder() {
    const pct = Number(shForm.percentage)
    if (!shForm.name.trim()) return showToast?.('Shareholder name is required', 'error')
    if (!(pct > 0 && pct <= 100)) return showToast?.('Percentage must be between 0 and 100', 'error')
    setSaving(true)
    try {
      // Auto-link the row to the signed-in user when they add themselves by
      // their own email — the P&L then recognises the row as "you".
      const isSelf = shForm.email && user?.email && shForm.email.toLowerCase() === user.email.toLowerCase()
      const row = await api.addShareholder({
        companyId: company.id, name: shForm.name.trim(),
        email: shForm.email.trim() || null, userId: isSelf ? user.id : null,
        percentage: pct, taxBand: shForm.taxBand || null,
      })
      setShareholders(s => [...s, row].sort((a, b) => b.percentage - a.percentage))
      setShForm({ name: '', email: '', percentage: '', taxBand: '' })
      setShowShForm(false)
    } catch (e) { showToast?.(e.message || 'Could not add shareholder', 'error') }
    setSaving(false)
  }

  async function patchShareholder(id, patch) {
    try {
      const row = await api.updateShareholder(id, patch)
      setShareholders(s => s.map(x => x.id === id ? row : x))
    } catch (e) { showToast?.(e.message || 'Could not update shareholder', 'error') }
  }

  async function removeShareholder(id) {
    try {
      await api.deleteShareholder(id)
      setShareholders(s => s.filter(x => x.id !== id))
    } catch (e) { showToast?.(e.message || 'Could not remove shareholder', 'error') }
  }

  async function addFee() {
    const pct = Number(feeForm.feePercent)
    if (!(pct >= 0 && pct <= 100)) return showToast?.('Fee % must be between 0 and 100', 'error')
    if (!feeForm.agentId && !feeForm.newAgentName.trim()) return showToast?.('Pick an agent or enter a new agent name', 'error')
    setSaving(true)
    try {
      let agentId = feeForm.agentId
      if (!agentId) {
        const agent = await api.addEstateAgent({ name: feeForm.newAgentName.trim() })
        agentId = agent.id
        setAgents(a => [...a, agent].sort((x, y) => x.name.localeCompare(y.name)))
      }
      const row = await api.upsertAgentFee({ companyId: company.id, agentId, feePercent: pct, vatTreatment: feeForm.vatTreatment })
      setFees(f => [...f.filter(x => x.agent_id !== agentId), row])
      setFeeForm({ agentId: '', newAgentName: '', feePercent: '', vatTreatment: 'inc_vat' })
      setShowFeeForm(false)
    } catch (e) { showToast?.(e.message || 'Could not save management fee', 'error') }
    setSaving(false)
  }

  async function patchFee(row, patch) {
    try {
      const updated = await api.upsertAgentFee({
        companyId: company.id, agentId: row.agent_id,
        feePercent: patch.fee_percent ?? row.fee_percent,
        vatTreatment: patch.vat_treatment ?? row.vat_treatment,
      })
      setFees(f => f.map(x => x.id === updated.id || x.agent_id === row.agent_id ? updated : x))
    } catch (e) { showToast?.(e.message || 'Could not update fee', 'error') }
  }

  async function removeFee(id) {
    try {
      await api.deleteAgentFee(id)
      setFees(f => f.filter(x => x.id !== id))
    } catch (e) { showToast?.(e.message || 'Could not remove fee', 'error') }
  }

  if (loading) return <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '14px 4px' }}>Loading ownership…</div>

  const inp = inputStyle(T)
  const smallBtn = { fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }

  return (
    <div style={{ marginTop: 22 }}>
      {/* ── Shareholders ── */}
      <CardShell T={T} title="Shareholders"
        sub="Who owns this company — feeds the Company P&L profit split"
        action={canEdit && (
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setShowShForm(v => !v)}>
            {showShForm ? 'Cancel' : '+ Add Shareholder'}
          </button>
        )}>
        {shareholders.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {shareholders.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{s.name}</span>
                  {(s.user_id === user?.id || (s.email && user?.email && s.email.toLowerCase() === user.email.toLowerCase())) &&
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: T.gold, background: T.gold + '22', padding: '1px 7px', borderRadius: 4, marginLeft: 8 }}>YOU</span>}
                  {s.email && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{s.email}</div>}
                </div>
                {canEdit ? (
                  <select value={s.tax_band || ''} onChange={e => patchShareholder(s.id, { tax_band: e.target.value || null })}
                    title="Dividend tax band — used to estimate personal tax on this shareholder's profit share"
                    style={{ ...inp, padding: '5px 8px', fontSize: 10 }}>
                    <option value="">No div. tax estimate</option>
                    {Object.entries(TAX_BAND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                ) : s.tax_band && <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{TAX_BAND_LABELS[s.tax_band]}</span>}
                {canEdit ? (
                  <input type="number" min="0.01" max="100" step="0.01" value={s.percentage}
                    aria-label={`${s.name} ownership percentage`}
                    onChange={e => setShareholders(list => list.map(x => x.id === s.id ? { ...x, percentage: e.target.value } : x))}
                    onBlur={e => {
                      const pct = Number(e.target.value)
                      if (pct > 0 && pct <= 100) patchShareholder(s.id, { percentage: pct })
                      else load()
                    }}
                    style={{ ...inp, width: 76, textAlign: 'right' }} />
                ) : <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T.gold }}>{Number(s.percentage).toFixed(2)}</span>}
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>%</span>
                {canEdit && (
                  <button onClick={() => removeShareholder(s.id)} aria-label={`Remove ${s.name}`}
                    style={{ ...smallBtn, color: T.red, borderColor: T.red + '33', padding: '4px 9px' }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {shareholders.length === 0 && !showShForm && (
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '10px 0' }}>
            No shareholders recorded yet.{canEdit ? ' Add each owner and their % to unlock the profit-share P&L.' : ''}
          </div>
        )}
        {shareholders.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, ownershipTotal)}%`, height: '100%', background: totalOk ? T.green : T.amber, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: totalOk ? T.green : T.amber }}>
              {ownershipTotal.toFixed(2)}% {totalOk ? '' : ownershipTotal > 100 ? '— over 100%' : '— unallocated ' + (100 - ownershipTotal).toFixed(2) + '%'}
            </span>
          </div>
        )}
        {showShForm && canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <input placeholder="Name" value={shForm.name} onChange={e => setShForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 130 }} />
            <input placeholder="Email (optional)" type="email" value={shForm.email} onChange={e => setShForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 150 }} />
            <input placeholder="%" type="number" min="0.01" max="100" step="0.01" value={shForm.percentage} onChange={e => setShForm(f => ({ ...f, percentage: e.target.value }))} style={{ ...inp, width: 80 }} />
            <select value={shForm.taxBand} onChange={e => setShForm(f => ({ ...f, taxBand: e.target.value }))} style={{ ...inp }}>
              <option value="">Tax band (optional)</option>
              {Object.entries(TAX_BAND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={saving} onClick={addShareholder}>{saving ? 'Saving…' : 'Add'}</button>
          </div>
        )}
      </CardShell>

      {/* ── Management fees ── */}
      <CardShell T={T} title="Management Fees"
        sub="What this company pays each estate agent, as % of rent collected"
        action={canEdit && (
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setShowFeeForm(v => !v)}>
            {showFeeForm ? 'Cancel' : '+ Add Agent Fee'}
          </button>
        )}>
        {fees.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {fees.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{f.agent?.name || 'Agent'}</span>
                  {f.agent?.email && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{f.agent.email}</div>}
                </div>
                {canEdit ? (
                  <>
                    <input type="number" min="0" max="100" step="0.01" value={f.fee_percent}
                      aria-label={`${f.agent?.name || 'Agent'} fee percentage`}
                      onChange={e => setFees(list => list.map(x => x.id === f.id ? { ...x, fee_percent: e.target.value } : x))}
                      onBlur={e => {
                        const pct = Number(e.target.value)
                        if (pct >= 0 && pct <= 100) patchFee(f, { fee_percent: pct })
                        else load()
                      }}
                      style={{ ...inp, width: 76, textAlign: 'right' }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>%</span>
                    <select value={f.vat_treatment} onChange={e => patchFee(f, { vat_treatment: e.target.value })} style={{ ...inp, padding: '5px 8px', fontSize: 10 }}>
                      <option value="inc_vat">inc. VAT</option>
                      <option value="ex_vat">+ VAT (20%)</option>
                    </select>
                    <button onClick={() => removeFee(f.id)} aria-label={`Remove ${f.agent?.name || 'agent'} fee`}
                      style={{ ...smallBtn, color: T.red, borderColor: T.red + '33', padding: '4px 9px' }}>✕</button>
                  </>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T.gold }}>
                    {Number(f.fee_percent).toFixed(2)}% {f.vat_treatment === 'ex_vat' ? '+ VAT' : 'inc. VAT'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {fees.length === 0 && !showFeeForm && (
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '10px 0' }}>
            No agent fees set.{canEdit ? ' Add each agent this company pays — the Company P&L calculates the fee from rent collected.' : ''}
          </div>
        )}
        {showFeeForm && canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <select value={feeForm.agentId} onChange={e => setFeeForm(f => ({ ...f, agentId: e.target.value }))} style={{ ...inp, minWidth: 150 }}>
              <option value="">New agent…</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {!feeForm.agentId && (
              <input placeholder="Agent name" value={feeForm.newAgentName} onChange={e => setFeeForm(f => ({ ...f, newAgentName: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 140 }} />
            )}
            <input placeholder="Fee %" type="number" min="0" max="100" step="0.01" value={feeForm.feePercent} onChange={e => setFeeForm(f => ({ ...f, feePercent: e.target.value }))} style={{ ...inp, width: 84 }} />
            <select value={feeForm.vatTreatment} onChange={e => setFeeForm(f => ({ ...f, vatTreatment: e.target.value }))} style={{ ...inp }}>
              <option value="inc_vat">inc. VAT</option>
              <option value="ex_vat">+ VAT (20%)</option>
            </select>
            <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={saving} onClick={addFee}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </CardShell>
    </div>
  )
}
