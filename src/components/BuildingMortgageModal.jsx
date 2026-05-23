import { useMemo, useRef, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import { groupPropertiesByBuilding } from '../lib/addressUtils'

// ── BUILDING MORTGAGE EDITOR ─────────────────────────────────────────
// Lets a user attach (or edit) ONE mortgage that covers ALL the units
// in a building. Picks a building → enters total loan + monthly + rate
// + term + type + fees ONCE → the modal splits across N units and
// writes each property in a single batch.
//
// Why this exists: Justin has buildings with 11 and 43 units. Editing
// each unit's mortgage one-at-a-time in the PropertyModal is brutal
// for someone with a real multi-flat building. This is the bulk path.
//
// Two pieces of UI:
//   1. Building picker — buildings are derived live from properties
//      via groupPropertiesByBuilding (existing helper). Skips
//      single-property "buildings".
//   2. Form — total numbers go in, split-per-unit numbers come out as
//      a preview, then save writes one updateProperty call per unit.
//
// On save we mutate the local `properties` array via setProperties so
// the UI updates without a full reload.

function buildingsFor(properties) {
  // groupPropertiesByBuilding returns { tail, name, items, isBuilding }.
  // Filter out single-unit "buildings" — those aren't worth a bulk editor.
  // Normalise to { key, label, properties } for this modal's local shape.
  const groups = groupPropertiesByBuilding(properties || [])
  return groups
    .filter(g => g.isBuilding && g.items.length >= 2)
    .map(g => ({ key: g.tail, label: g.name || g.tail, properties: g.items }))
}

export default function BuildingMortgageModal({ properties, setProperties, onClose }) {
  const { T } = useTheme()
  const buildings = useMemo(() => buildingsFor(properties), [properties])
  const [selectedKey, setSelectedKey] = useState(buildings[0]?.key || null)
  const building = buildings.find(b => b.key === selectedKey)
  const units = building?.properties || []
  const unitCount = units.length

  // Pre-fill from existing data: if all units share the same mortgage
  // values, use them. Otherwise leave blank so the user starts fresh.
  function commonOrBlank(field) {
    if (unitCount === 0) return ''
    const first = units[0]?.[field]
    return units.every(u => u?.[field] === first) ? (first ?? '') : ''
  }
  // Totals derived from the existing data — display only.
  const currentTotalLoan    = units.reduce((s,u) => s + Number(u.mortgage_amount || 0), 0)
  const currentTotalMonthly = units.reduce((s,u) => s + Number(u.mortgage_monthly_payment || 0), 0)

  // Form state — totals (what the user actually knows from their bank).
  const [totalLoan, setTotalLoan] = useState(currentTotalLoan ? currentTotalLoan.toFixed(2) : '')
  const [totalMonthly, setTotalMonthly] = useState(currentTotalMonthly ? currentTotalMonthly.toFixed(2) : '')
  const [rate, setRate]   = useState((commonOrBlank('mortgage_rate') * 100).toString())
  const [term, setTerm]   = useState((commonOrBlank('mortgage_term') || 25).toString())
  const [type, setType]   = useState(commonOrBlank('mortgage_type') || 'repayment')
  const [fees, setFees]   = useState(commonOrBlank('mortgage_fees')?.toString() || '')
  const [saving, setSaving] = useState(false)
  // PDF scan state
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState(null)
  const fileInputRef = useRef(null)

  // Drive the file picker. Scans the uploaded PDF/image via Claude
  // through the extract-document edge function. On success, pre-fills
  // every form field that came back. User reviews + saves.
  async function handleScanPdf(file) {
    if (!file || !building) return
    setScanning(true)
    setScanMessage('Uploading + sending to AI…')
    try {
      // Attach the document to the first unit in the building (schema
      // requires a property_id). The doc still appears in that unit's
      // Documents tab for later reference.
      const firstUnit = units[0]
      const { extracted } = await api.uploadAndExtractMortgageDocument(file, firstUnit.id, 'mortgage')
      if (!extracted || extracted._parse_error) {
        throw new Error(extracted?._parse_error || 'AI returned no structured data')
      }

      // Map extracted fields into the form. Be defensive about missing
      // fields and treat 0/null as "skip" so we don't blank user input.
      if (extracted.loan_amount)         setTotalLoan(String(extracted.loan_amount))
      if (extracted.monthly_repayment)   setTotalMonthly(String(extracted.monthly_repayment))
      if (extracted.interest_rate_percent) setRate(String(extracted.interest_rate_percent))
      if (extracted.term_years)          setTerm(String(extracted.term_years))
      if (extracted.repayment_type)      setType(extracted.repayment_type)
      if (extracted.arrangement_fees)    setFees(String(extracted.arrangement_fees))

      const bits = []
      if (extracted.lender)             bits.push(`Lender: ${extracted.lender}`)
      if (extracted.loan_amount)        bits.push(`Loan: £${Number(extracted.loan_amount).toLocaleString('en-GB')}`)
      if (extracted.repayment_type)     bits.push(`Type: ${extracted.repayment_type}`)
      setScanMessage('✓ Pre-filled from ' + (bits.join(' · ') || 'document'))
    } catch (e) {
      console.error('Mortgage PDF scan failed', e)
      setScanMessage('⚠ ' + (e?.message || 'Could not scan the document'))
    }
    setScanning(false)
  }

  // Re-pre-fill when the user switches building.
  function pickBuilding(key) {
    setSelectedKey(key)
    const b = buildings.find(x => x.key === key)
    const us = b?.properties || []
    const tot   = us.reduce((s,u) => s + Number(u.mortgage_amount || 0), 0)
    const totM  = us.reduce((s,u) => s + Number(u.mortgage_monthly_payment || 0), 0)
    setTotalLoan(tot ? tot.toFixed(2) : '')
    setTotalMonthly(totM ? totM.toFixed(2) : '')
    const r0 = us.every(u => u.mortgage_rate === us[0]?.mortgage_rate) ? us[0]?.mortgage_rate : 0
    setRate(r0 ? (r0 * 100).toString() : '')
    setTerm((us.every(u => u.mortgage_term === us[0]?.mortgage_term) ? us[0]?.mortgage_term : 25).toString())
    setType(us.every(u => u.mortgage_type === us[0]?.mortgage_type) ? (us[0]?.mortgage_type || 'repayment') : 'repayment')
    const f0 = us.every(u => u.mortgage_fees === us[0]?.mortgage_fees) ? us[0]?.mortgage_fees : 0
    setFees(f0 ? f0.toString() : '')
  }

  // Per-unit numbers derived from totals — shown to the user as a
  // preview so they can sanity-check the split before saving.
  const perUnitLoan    = unitCount > 0 ? (parseFloat(totalLoan)    || 0) / unitCount : 0
  const perUnitMonthly = unitCount > 0 ? (parseFloat(totalMonthly) || 0) / unitCount : 0
  const perUnitFees    = unitCount > 0 ? (parseFloat(fees)         || 0) / unitCount : 0

  async function handleSave() {
    if (unitCount === 0) return
    setSaving(true)
    try {
      // Build the patch and apply to every unit. We write in parallel
      // for speed but await all so the UI reload reflects the truth.
      const patch = {
        mortgage_amount:          Number(perUnitLoan.toFixed(2)),
        mortgage_rate:            (parseFloat(rate) || 0) / 100,
        mortgage_term:            parseInt(term, 10) || 25,
        mortgage_type:            type || 'repayment',
        mortgage_monthly_payment: Number(perUnitMonthly.toFixed(2)),
        mortgage_fees:            Number(perUnitFees.toFixed(2)),
      }
      const results = await Promise.all(
        units.map(u => api.updateProperty(u.id, patch).then(updated => ({ id: u.id, updated })))
      )
      // Update local state so the page reflects the change immediately.
      setProperties(prev => prev.map(p => {
        const hit = results.find(r => r.id === p.id)
        return hit ? { ...p, ...hit.updated } : p
      }))
      showAppToast(`Updated ${unitCount} units in ${building?.label || 'building'}`)
      onClose()
    } catch (e) {
      console.error('BuildingMortgage save failed', e)
      showAppToast(e?.message || 'Could not save mortgage', 'error')
    }
    setSaving(false)
  }

  // Currency formatter — shared style with the rest of the app.
  const fmt = n => new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 2,
  }).format(n || 0)

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div style={{ padding: '22px 26px 0' }}>
          <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
            🏦 Building Mortgage
          </h2>
          <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.6 }}>
            Set one mortgage that covers every unit in a building. We split the
            loan, monthly payment, and fees equally across the units in one save.
          </p>
        </div>

        <div style={{ padding: '14px 26px 22px' }}>
          {/* Building picker */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>
              Building ({buildings.length} eligible)
            </label>
            {buildings.length === 0 ? (
              <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px', fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                No multi-unit buildings detected. Buildings are detected automatically when 2+ properties share an address (e.g. "Flat 1, X House" / "Flat 2, X House"). For a single property, edit the mortgage directly from the property's edit form.
              </div>
            ) : (
              <select value={selectedKey || ''} onChange={e => pickBuilding(e.target.value)}
                style={{ width: '100%', fontFamily: MONO, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '10px 12px' }}>
                {buildings.map(b => (
                  <option key={b.key} value={b.key}>
                    {b.label}  ·  {b.properties.length} units
                  </option>
                ))}
              </select>
            )}
          </div>

          {building && (
            <>
              {/* Current state */}
              {(currentTotalLoan > 0 || currentTotalMonthly > 0) && (
                <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                  Currently: <strong style={{ color: T.text }}>{fmt(currentTotalLoan)}</strong> total loan,
                  <strong style={{ color: T.text }}> {fmt(currentTotalMonthly)}/mo</strong> across {unitCount} units
                </div>
              )}

              {/* PDF scan — drop a Handelsbanken offer / mortgage deed in and
                  let Claude pre-fill the fields. Total time ~5-10s for a
                  10-page PDF. The doc gets attached to the first unit's
                  Documents tab too, so it's findable later. */}
              <div style={{
                background: T.blue + '0F', border: `1px dashed ${T.blue}44`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: T.text, fontWeight: 700, marginBottom: 2 }}>
                    📄 Scan a mortgage offer / facility agreement
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.5 }}>
                    We'll extract loan amount, rate, term, type, monthly payment and fees, then pre-fill the form for you to verify.
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="application/pdf,image/*"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleScanPdf(f); e.target.value = '' }}/>
                <button onClick={() => fileInputRef.current?.click()} disabled={scanning || !building}
                  className="btn btn-ghost" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {scanning ? 'Scanning…' : '📤 Upload PDF'}
                </button>
              </div>
              {scanMessage && (
                <div style={{
                  background: scanMessage.startsWith('⚠') ? T.red + '11' : T.green + '11',
                  border: `1px solid ${scanMessage.startsWith('⚠') ? T.red : T.green}44`,
                  borderRadius: 8, padding: '8px 12px', marginBottom: 14,
                  fontFamily: MONO, fontSize: 11,
                  color: scanMessage.startsWith('⚠') ? T.red : T.green,
                }}>
                  {scanMessage}
                </div>
              )}

              {/* Form */}
              <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
                <div className="g2">
                  <div>
                    <label>Total Loan</label>
                    <input value={totalLoan} onChange={e => setTotalLoan(e.target.value)} placeholder="e.g. 913068.75" />
                  </div>
                  <div>
                    <label>Total Monthly Payment</label>
                    <input value={totalMonthly} onChange={e => setTotalMonthly(e.target.value)} placeholder="e.g. 4025.11" />
                  </div>
                </div>
                <div className="g2">
                  <div>
                    <label>Rate (%)</label>
                    <input value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 6.40" />
                  </div>
                  <div>
                    <label>Term (years)</label>
                    <input type="number" value={term} onChange={e => setTerm(e.target.value)} placeholder="25" />
                  </div>
                </div>
                <div className="g2">
                  <div>
                    <label>Type</label>
                    <select value={type} onChange={e => setType(e.target.value)}>
                      <option value="repayment">Repayment</option>
                      <option value="interest_only">Interest-only</option>
                      <option value="mixed">Mixed (IO + repayment)</option>
                      <option value="bridging">Bridging</option>
                    </select>
                  </div>
                  <div>
                    <label>Setup / Arrangement Fees (total)</label>
                    <input value={fees} onChange={e => setFees(e.target.value)} placeholder="e.g. 9375.00" />
                  </div>
                </div>
              </div>

              {/* Per-unit preview */}
              <div style={{ background: T.gold + '11', border: `1px solid ${T.gold}44`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  Split per unit ({unitCount} × equal share)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 2 }}>Loan / unit</div>
                    <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: T.text }}>{fmt(perUnitLoan)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 2 }}>Monthly / unit</div>
                    <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: T.text }}>{fmt(perUnitMonthly)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 2 }}>Fees / unit</div>
                    <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: T.text }}>{fmt(perUnitFees)}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12 }}>Cancel</button>
                <button onClick={handleSave} disabled={saving || unitCount === 0} className="btn btn-gold" style={{ fontSize: 12 }}>
                  {saving ? `Updating ${unitCount} units…` : `💾 Save across ${unitCount} units`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
