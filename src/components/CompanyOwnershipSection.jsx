// Ownership & managing agents — rendered per company inside the
// Portfolio → Companies tab (CompaniesPanel in App.jsx).
//
// Two cards:
//   1. Shareholders — the company's cap table. Name-based (shareholders
//      don't need an app account), optional email + dividend tax band.
//      Name/email/% all edit inline. Warns when percentages don't sum
//      to 100. A shareholder is a PERSON or a COMPANY (holding company):
//      company rows get no dividend tax band (inter-company dividends are
//      normally CT-exempt) and can instead link to that company's own
//      record here, so "My share" reports follow your stake through the
//      holding chain.
//   2. Managing Agents — the estate-agent directory with each agency's
//      standard fee (% of rent collected, inc/ex VAT). Fees live on the
//      AGENCY: change once here and it applies to every property that
//      agency manages, across the whole portfolio. Properties pick their
//      agent in the property form ("Managed By").
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
          {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2, maxWidth: 560, lineHeight: 1.6 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function CompanyOwnershipSection({ company, companies = [], properties = [], user, canEdit, T, showToast }) {
  const [shareholders, setShareholders] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)

  // Add-shareholder form
  const [showShForm, setShowShForm] = useState(false)
  const [shForm, setShForm] = useState({ name: '', email: '', percentage: '', taxBand: '', type: 'individual', linkCompanyId: '' })
  // Add-agent form
  const [showAgForm, setShowAgForm] = useState(false)
  const [agForm, setAgForm] = useState({ name: '', feePercent: '', vatTreatment: 'ex_vat' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [company.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    try {
      const [sh, ag] = await Promise.all([
        api.fetchShareholders(company.id),
        api.fetchEstateAgents(),
      ])
      setShareholders(sh); setAgents(ag)
    } catch (e) {
      console.error('Ownership section load failed', e)
      showToast?.(e.message || 'Could not load ownership data', 'error')
    }
    setLoading(false)
  }

  const ownershipTotal = shareholders.reduce((s, r) => s + (Number(r.percentage) || 0), 0)
  const totalOk = Math.abs(ownershipTotal - 100) < 0.01

  // ── Shareholders ──
  async function addShareholder() {
    const pct = Number(shForm.percentage)
    if (!shForm.name.trim()) return showToast?.('Shareholder name is required', 'error')
    if (!(pct > 0 && pct <= 100)) return showToast?.('Percentage must be between 0 and 100', 'error')
    setSaving(true)
    try {
      const corp = shForm.type === 'company'
      // Auto-link the row to the signed-in user when they add themselves by
      // their own email — the P&L then recognises the row as "you". Never
      // for company rows: a holding company isn't the user personally, even
      // when their email is its contact address.
      const isSelf = !corp && shForm.email && user?.email && shForm.email.toLowerCase() === user.email.toLowerCase()
      const row = await api.addShareholder({
        companyId: company.id, name: shForm.name.trim(),
        email: shForm.email.trim() || null, userId: isSelf ? user.id : null,
        percentage: pct, taxBand: shForm.taxBand || null,
        shareholderType: shForm.type, shareholderCompanyId: shForm.linkCompanyId || null,
      })
      setShareholders(s => [...s, row].sort((a, b) => b.percentage - a.percentage))
      setShForm({ name: '', email: '', percentage: '', taxBand: '', type: 'individual', linkCompanyId: '' })
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

  // ── Agents ──
  async function addAgent() {
    if (!agForm.name.trim()) return showToast?.('Agent name is required', 'error')
    const pct = agForm.feePercent === '' ? null : Number(agForm.feePercent)
    if (pct != null && !(pct >= 0 && pct <= 100)) return showToast?.('Fee % must be between 0 and 100', 'error')
    setSaving(true)
    try {
      const agent = await api.addEstateAgent({ name: agForm.name.trim(), feePercent: pct, vatTreatment: agForm.vatTreatment })
      setAgents(a => [...a, agent].sort((x, y) => x.name.localeCompare(y.name)))
      setAgForm({ name: '', feePercent: '', vatTreatment: 'ex_vat' })
      setShowAgForm(false)
    } catch (e) { showToast?.(e.message || 'Could not add agent', 'error') }
    setSaving(false)
  }

  async function patchAgent(id, patch) {
    try {
      const row = await api.updateEstateAgent(id, patch)
      setAgents(a => a.map(x => x.id === id ? row : x))
    } catch (e) { showToast?.(e.message || 'Could not update agent', 'error') }
  }

  async function removeAgent(agent) {
    const managedHere = properties.filter(p => p.managed_by_agent_id === agent.id).length
    if (managedHere > 0 && !window.confirm(`${agent.name} manages ${managedHere} of this company's properties — remove anyway? Properties keep their data but lose the agent link.`)) return
    try {
      await api.deleteEstateAgent(agent.id)
      setAgents(a => a.filter(x => x.id !== agent.id))
    } catch (e) { showToast?.(e.message || 'Could not remove agent', 'error') }
  }

  if (loading) return <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '14px 4px' }}>Loading ownership…</div>

  const inp = inputStyle(T)
  const smallBtn = { fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }
  // Companies a corporate shareholder can link to — everything but this one.
  const linkableCompanies = companies.filter(c => c.id !== company.id)
  const isCorp = s => (s.shareholder_type || 'individual') === 'company'

  return (
    <div style={{ marginTop: 22 }}>
      {/* ── Shareholders ── */}
      <CardShell T={T} title="Shareholders"
        sub="Who owns this company — people or holding companies — feeds the Company P&L profit split. Link a corporate shareholder to its own company record and your share flows through it."
        action={canEdit && (
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setShowShForm(v => !v)}>
            {showShForm ? 'Cancel' : '+ Add Shareholder'}
          </button>
        )}>
        {shareholders.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {shareholders.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {canEdit ? (
                    <>
                      <input value={s.name} aria-label="Shareholder name"
                        onChange={e => setShareholders(list => list.map(x => x.id === s.id ? { ...x, name: e.target.value } : x))}
                        onBlur={e => {
                          const name = e.target.value.trim()
                          if (name && name !== '') patchShareholder(s.id, { name })
                          else load()
                        }}
                        style={{ ...inp, fontWeight: 600, minWidth: 130, flex: 1 }} />
                      <input value={s.email || ''} placeholder="email (links across companies)" type="email" aria-label="Shareholder email"
                        onChange={e => setShareholders(list => list.map(x => x.id === s.id ? { ...x, email: e.target.value } : x))}
                        onBlur={e => {
                          const email = e.target.value.trim()
                          const isSelf = email && user?.email && email.toLowerCase() === user.email.toLowerCase()
                          patchShareholder(s.id, { email: email || null, ...(isSelf && !s.user_id ? { user_id: user.id } : {}) })
                        }}
                        style={{ ...inp, fontSize: 10, minWidth: 170, flex: 1 }} />
                    </>
                  ) : (
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{s.name}</span>
                      {s.email && <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{s.email}</div>}
                    </div>
                  )}
                  {isCorp(s) &&
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: T.muted, border: `1px solid ${T.border}`, padding: '1px 7px', borderRadius: 4 }}
                      title="Corporate shareholder — no personal dividend tax is estimated (company-to-company dividends are normally CT-exempt)">COMPANY</span>}
                  {!isCorp(s) && (s.user_id === user?.id || (s.email && user?.email && s.email.toLowerCase() === user.email.toLowerCase())) &&
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: T.gold, background: T.gold + '22', padding: '1px 7px', borderRadius: 4 }}>YOU</span>}
                </div>
                {canEdit && (
                  <select value={isCorp(s) ? 'company' : 'individual'} aria-label={`${s.name} shareholder type`}
                    title="Person or company? Company shareholders get no dividend tax estimate and can link to their own company record."
                    onChange={e => patchShareholder(s.id, e.target.value === 'company'
                      ? { shareholder_type: 'company', tax_band: null, user_id: null }
                      : { shareholder_type: 'individual', shareholder_company_id: null })}
                    style={{ ...inp, padding: '5px 8px', fontSize: 10 }}>
                    <option value="individual">Person</option>
                    <option value="company">Company</option>
                  </select>
                )}
                {isCorp(s) ? (
                  canEdit ? (
                    <select value={s.shareholder_company_id || ''} aria-label={`${s.name} linked company`}
                      title="Link to this holding company's own record — 'My share' reports then follow your stake through it"
                      onChange={e => patchShareholder(s.id, { shareholder_company_id: e.target.value || null })}
                      style={{ ...inp, padding: '5px 8px', fontSize: 10 }}>
                      <option value="">Not managed in Properly</option>
                      {linkableCompanies.map(c => <option key={c.id} value={c.id}>↳ {c.abbr || c.name}</option>)}
                    </select>
                  ) : s.shareholder_company_id && (
                    <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
                      ↳ {linkableCompanies.find(c => c.id === s.shareholder_company_id)?.abbr || linkableCompanies.find(c => c.id === s.shareholder_company_id)?.name || 'linked company'}
                    </span>
                  )
                ) : canEdit ? (
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
            <select value={shForm.type} aria-label="Shareholder type"
              onChange={e => setShForm(f => ({ ...f, type: e.target.value, taxBand: '', linkCompanyId: '' }))} style={{ ...inp }}>
              <option value="individual">Person</option>
              <option value="company">Company</option>
            </select>
            <input placeholder={shForm.type === 'company' ? 'Company name' : 'Name'} value={shForm.name} onChange={e => setShForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 130 }} />
            <input placeholder={shForm.type === 'company' ? 'Contact email (optional)' : 'Email (optional)'} type="email" value={shForm.email} onChange={e => setShForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 150 }} />
            <input placeholder="%" type="number" min="0.01" max="100" step="0.01" value={shForm.percentage} onChange={e => setShForm(f => ({ ...f, percentage: e.target.value }))} style={{ ...inp, width: 80 }} />
            {shForm.type === 'company' ? (
              <select value={shForm.linkCompanyId} aria-label="Linked company"
                title="Link to this holding company's own record — 'My share' reports then follow your stake through it"
                onChange={e => setShForm(f => ({ ...f, linkCompanyId: e.target.value }))} style={{ ...inp }}>
                <option value="">Not managed in Properly</option>
                {linkableCompanies.map(c => <option key={c.id} value={c.id}>↳ {c.abbr || c.name}</option>)}
              </select>
            ) : (
              <select value={shForm.taxBand} onChange={e => setShForm(f => ({ ...f, taxBand: e.target.value }))} style={{ ...inp }}>
                <option value="">Tax band (optional)</option>
                {Object.entries(TAX_BAND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
            <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={saving} onClick={addShareholder}>{saving ? 'Saving…' : 'Add'}</button>
            {shForm.type === 'company' && (
              <div style={{ flexBasis: '100%', fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.6 }}>
                Company shareholders get no dividend tax estimate — dividends between UK companies are normally
                corporation-tax-exempt. To follow your personal share through this holding company, link its
                Properly record and enter its own shareholders there.
              </div>
            )}
          </div>
        )}
      </CardShell>

      {/* ── Managing agents ── */}
      <CardShell T={T} title="Managing Agents"
        sub="Each agency's standard fee (% of rent collected). Fees are portfolio-wide — change a fee here and it updates every property that agency manages. Assign an agent to a property in the property form."
        action={canEdit && (
          <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={() => setShowAgForm(v => !v)}>
            {showAgForm ? 'Cancel' : '+ Add Agent'}
          </button>
        )}>
        {agents.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {agents.map(a => {
              const managedHere = properties.filter(p => p.managed_by_agent_id === a.id).length
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {canEdit ? (
                      <input value={a.name} aria-label="Agent name"
                        onChange={e => setAgents(list => list.map(x => x.id === a.id ? { ...x, name: e.target.value } : x))}
                        onBlur={e => { const name = e.target.value.trim(); if (name) patchAgent(a.id, { name }); else load() }}
                        style={{ ...inp, fontWeight: 600, minWidth: 140, flex: 1 }} />
                    ) : <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{a.name}</span>}
                    <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
                      {managedHere} {managedHere === 1 ? 'property' : 'properties'} in {company.abbr || company.name}
                    </span>
                  </div>
                  {canEdit ? (
                    <>
                      <input type="number" min="0" max="100" step="0.01" value={a.fee_percent ?? ''}
                        placeholder="fee %" aria-label={`${a.name} fee percentage`}
                        onChange={e => setAgents(list => list.map(x => x.id === a.id ? { ...x, fee_percent: e.target.value } : x))}
                        onBlur={e => {
                          if (e.target.value === '') return patchAgent(a.id, { fee_percent: null })
                          const pct = Number(e.target.value)
                          if (pct >= 0 && pct <= 100) patchAgent(a.id, { fee_percent: pct })
                          else load()
                        }}
                        style={{ ...inp, width: 76, textAlign: 'right' }} />
                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>%</span>
                      <select value={a.vat_treatment || 'ex_vat'} onChange={e => patchAgent(a.id, { vat_treatment: e.target.value })} style={{ ...inp, padding: '5px 8px', fontSize: 10 }}>
                        <option value="ex_vat">+ VAT (20%)</option>
                        <option value="inc_vat">inc. VAT</option>
                      </select>
                      <button onClick={() => removeAgent(a)} aria-label={`Remove ${a.name}`}
                        style={{ ...smallBtn, color: T.red, borderColor: T.red + '33', padding: '4px 9px' }}>✕</button>
                    </>
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T.gold }}>
                      {a.fee_percent != null ? `${Number(a.fee_percent).toFixed(2)}% ${a.vat_treatment === 'ex_vat' ? '+ VAT' : 'inc. VAT'}` : 'no fee set'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {agents.length === 0 && !showAgForm && (
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: '10px 0' }}>
            No agents yet.{canEdit ? ' Add each agency and its fee % — then pick the agent on each property it manages.' : ''}
          </div>
        )}
        {showAgForm && canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <input placeholder="Agency name" value={agForm.name} onChange={e => setAgForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 150 }} />
            <input placeholder="Fee %" type="number" min="0" max="100" step="0.01" value={agForm.feePercent} onChange={e => setAgForm(f => ({ ...f, feePercent: e.target.value }))} style={{ ...inp, width: 84 }} />
            <select value={agForm.vatTreatment} onChange={e => setAgForm(f => ({ ...f, vatTreatment: e.target.value }))} style={{ ...inp }}>
              <option value="ex_vat">+ VAT (20%)</option>
              <option value="inc_vat">inc. VAT</option>
            </select>
            <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={saving} onClick={addAgent}>{saving ? 'Saving…' : 'Add'}</button>
          </div>
        )}
      </CardShell>
    </div>
  )
}
