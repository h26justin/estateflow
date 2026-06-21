// BulkAddPropertyModal — wizard for adding many flats in a building at once.
//
// Three step flow:
//   1. Setup — naming pattern, count, building details, company
//   2. Shared — fields that are typically the same across all units
//                (property type, default status, mortgage info, etc)
//   3. Per-unit — editable grid where the user can override rent, status,
//                 and (in per-unit pricing mode) individual purchase prices
//
// Saves all properties in a single DB round-trip via api.bulkCreateProperties.
// On any validation error the user stays in the wizard with the offending
// row highlighted — partial saves are never attempted.

import { useState, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { safeOverlayClose, isFormDirty } from '../lib/modalUtils'
import MoneyInput from '../lib/MoneyInput'
import FocusTrap from '../lib/FocusTrap'

const mono = "'DM Mono',monospace"

// Pre-set unit prefixes the wizard offers. Custom is just a free text field.
const PREFIXES = [
  { v: 'Flat',      l: 'Flat' },
  { v: 'Apartment', l: 'Apartment' },
  { v: 'Room',      l: 'Room (HMO)' },
  { v: 'Unit',      l: 'Unit' },
  { v: 'Suite',     l: 'Suite' },
  { v: 'custom',    l: 'Custom prefix…' },
]

// Status options aligned with the rest of the app. Order matches the typical
// lifecycle: bought → refurbed → let-agreed → rented → notice → vacant.
const STATUSES = [
  { v: 'purchased',    l: 'Purchased (not let)' },
  { v: 'refurb',       l: 'In Refurb' },
  { v: 'let_agreed',   l: 'Let agreed' },
  { v: 'rented',       l: 'Rented' },
  { v: 'notice_given', l: 'Notice given' },
  { v: 'vacant',       l: 'Vacant' },
]

export default function BulkAddPropertyModal({ companies = [], onClose, onSaved, showToast }) {
  const { T } = useTheme()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  // ── Step 1: Setup ────────────────────────────────────────────────────
  const [unitCount, setUnitCount] = useState(6)
  const [prefix, setPrefix] = useState('Flat')
  const [customPrefix, setCustomPrefix] = useState('')
  const [startingNumber, setStartingNumber] = useState(1)
  const [buildingName, setBuildingName] = useState('')
  const [streetAddress, setStreetAddress] = useState('')  // e.g. "High Street East"
  const [town, setTown] = useState('')
  const [postcode, setPostcode] = useState('')
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')

  // ── Step 2: Shared fields ─────────────────────────────────────────────
  const [propType, setPropType] = useState('')
  // Default to 'rented' — bulk-add is almost always used for an existing
  // block where most units are tenanted. Starting at 'vacant' made the
  // dashboard show alarming vacancy figures until the user manually fixed
  // each row. The user can flip individual units in the table on step 3.
  const [defaultStatus, setDefaultStatus] = useState('rented')
  const [pricingMode, setPricingMode] = useState('total')  // 'total' | 'per_unit'
  const [totalPurchase, setTotalPurchase] = useState('')
  const [totalMortgage, setTotalMortgage] = useState('')
  const [totalStampDuty, setTotalStampDuty] = useState('')
  const [totalLegalFees, setTotalLegalFees] = useState('')
  const [defaultRent, setDefaultRent] = useState('')
  const [mortgageRate, setMortgageRate] = useState('')
  const [mortgageTerm, setMortgageTerm] = useState(25)
  const [insurance, setInsurance] = useState('')
  const [managedBy, setManagedBy] = useState('')
  const [notes, setNotes] = useState('')

  // ── Step 3: Per-unit overrides ────────────────────────────────────────
  // Keyed by row index. Falls back to step-2 defaults if blank.
  const [rowOverrides, setRowOverrides] = useState({})
  // Each entry shape: { name?, rent?, status?, purchase?, mortgage? }

  // Effective prefix string (custom or chosen)
  const effectivePrefix = prefix === 'custom' ? customPrefix.trim() : prefix

  // ── Computed: the list of units ─────────────────────────────────────
  // This is THE source of truth. Re-derived whenever inputs change.
  const units = useMemo(() => {
    const list = []
    const n = Math.max(1, Math.min(50, parseInt(unitCount) || 1))
    const start = Math.max(1, parseInt(startingNumber) || 1)
    const purchasePerUnit = pricingMode === 'total' && totalPurchase
      ? (parseFloat(totalPurchase) || 0) / n
      : 0
    const mortgagePerUnit = pricingMode === 'total' && totalMortgage
      ? (parseFloat(totalMortgage) || 0) / n
      : 0
    const stampDutyPerUnit  = totalStampDuty ? (parseFloat(totalStampDuty) || 0) / n : 0
    const legalFeesPerUnit  = totalLegalFees ? (parseFloat(totalLegalFees) || 0) / n : 0

    for (let i = 0; i < n; i++) {
      const num = start + i
      const fullName = effectivePrefix
        ? `${effectivePrefix} ${num}${buildingName ? ', ' + buildingName : ''}`
        : `${buildingName} #${num}`
      const fullAddress = [
        effectivePrefix ? `${effectivePrefix} ${num}` : `#${num}`,
        buildingName,
        streetAddress,
        town,
        postcode,
      ].filter(Boolean).join(', ')

      const ov = rowOverrides[i] || {}
      list.push({
        index: i,
        name:    ov.name    !== undefined ? ov.name    : fullName,
        address: fullAddress,
        rent:    ov.rent    !== undefined ? ov.rent    : (defaultRent || ''),
        status:  ov.status  !== undefined ? ov.status  : defaultStatus,
        purchase: ov.purchase !== undefined ? ov.purchase
          : (pricingMode === 'total' ? Math.round(purchasePerUnit) : ''),
        mortgage: ov.mortgage !== undefined ? ov.mortgage
          : (pricingMode === 'total' ? Math.round(mortgagePerUnit) : ''),
        stampDuty: Math.round(stampDutyPerUnit),
        legalFees: Math.round(legalFeesPerUnit),
      })
    }
    return list
  }, [unitCount, startingNumber, effectivePrefix, buildingName, streetAddress, town, postcode,
      defaultRent, defaultStatus, pricingMode, totalPurchase, totalMortgage, totalStampDuty,
      totalLegalFees, rowOverrides])

  // Update a single row override
  function setRow(index, patch) {
    setRowOverrides(prev => ({ ...prev, [index]: { ...(prev[index] || {}), ...patch } }))
  }
  // "Fill down": copy a value from row 0 to all rows
  function fillDown(field) {
    const firstVal = units[0]?.[field]
    if (firstVal === undefined) return
    setRowOverrides(prev => {
      const next = { ...prev }
      units.forEach((_, i) => {
        if (i === 0) return
        next[i] = { ...(next[i] || {}), [field]: firstVal }
      })
      return next
    })
  }
  // Reset overrides for a single row (back to defaults from steps 1-2)
  function resetRow(index) {
    setRowOverrides(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  // ── Validation per step ─────────────────────────────────────────────
  const step1Errors = []
  if (!effectivePrefix) step1Errors.push('Choose a unit prefix (or enter a custom one)')
  if (!buildingName.trim()) step1Errors.push('Building name is required')
  if (!streetAddress.trim()) step1Errors.push('Street address is required')
  if (!companyId) step1Errors.push('Pick a company')
  if (unitCount < 1 || unitCount > 50) step1Errors.push('Number of units must be 1-50')

  // No hard requirements at step 2 — financial info is optional
  const step2Errors = []
  if (pricingMode === 'total' && totalPurchase && parseFloat(totalPurchase) < 0) step2Errors.push('Purchase price cannot be negative')

  const step3Errors = []
  const seenNames = new Set()
  for (const u of units) {
    if (!u.name || !u.name.trim()) { step3Errors.push(`Row ${u.index + 1} has no name`); break }
    if (seenNames.has(u.name)) { step3Errors.push(`Duplicate name: "${u.name}"`); break }
    seenNames.add(u.name)
  }

  function canProceed() {
    if (step === 1) return step1Errors.length === 0
    if (step === 2) return step2Errors.length === 0
    if (step === 3) return step3Errors.length === 0
    return true
  }

  // ── Save ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!canProceed()) return
    setSaving(true)
    try {
      const props = units.map(u => ({
        name: u.name.trim(),
        address: u.address,
        company_id: companyId,
        prop_type: propType || '',
        status: u.status,
        refurb_status: 'planned',
        purchase_price: parseFloat(u.purchase) || 0,
        mortgage_amount: parseFloat(u.mortgage) || 0,
        stamp_duty: u.stampDuty || 0,
        legal_fees: u.legalFees || 0,
        rent_pcm: parseFloat(u.rent) || 0,
        mortgage_rate: (parseFloat(mortgageRate) / 100) || 0,
        mortgage_term: parseInt(mortgageTerm) || 25,
        insurance: parseFloat(insurance) || 0,
        arrears: 0,
        managed_by: managedBy || '',
        notes: notes || '',
      }))
      const created = await api.bulkCreateProperties(props)
      showToast(`Added ${created.length} ${created.length === 1 ? 'property' : 'properties'} to ${buildingName}`)
      onSaved(created)
    } catch (e) {
      showToast(e.message || 'Bulk save failed', 'error')
    }
    setSaving(false)
  }

  // ── Dirty check (for click-outside protection) ───────────────────────
  // Treat the modal as dirty if user has typed anything beyond the trivial defaults.
  const isDirty = !!(buildingName || streetAddress || town || postcode || propType
    || totalPurchase || totalMortgage || defaultRent || notes
    || Object.keys(rowOverrides).length > 0)

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="overlay" onClick={safeOverlayClose(isDirty, onClose)}>
      <FocusTrap onEscape={() => safeOverlayClose(isDirty, onClose)({ target: null, currentTarget: null })}>
      <div className="modal" style={{ maxWidth: step === 3 ? 920 : 640 }} role="dialog" aria-modal="true" aria-labelledby="bulk-add-property-modal-title">
        <div style={{ padding: '24px 28px 0' }}>
          <h2 id="bulk-add-property-modal-title" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: T.text }}>
            Add a block of flats
          </h2>
          <p style={{ fontFamily: mono, color: T.muted, fontSize: 11, marginBottom: 14 }}>
            {step === 1 && `Step 1 of 3 — Set up the building and how many units.`}
            {step === 2 && `Step 2 of 3 — Fields shared across all units.`}
            {step === 3 && `Step 3 of 3 — Review and tweak each unit.`}
          </p>
          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: n <= step ? T.gold : T.border,
                transition: 'background 0.2s',
              }}/>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {step === 1 && <Step1
            unitCount={unitCount} setUnitCount={setUnitCount}
            prefix={prefix} setPrefix={setPrefix}
            customPrefix={customPrefix} setCustomPrefix={setCustomPrefix}
            startingNumber={startingNumber} setStartingNumber={setStartingNumber}
            buildingName={buildingName} setBuildingName={setBuildingName}
            streetAddress={streetAddress} setStreetAddress={setStreetAddress}
            town={town} setTown={setTown}
            postcode={postcode} setPostcode={setPostcode}
            companyId={companyId} setCompanyId={setCompanyId}
            companies={companies}
            units={units}
            errors={step1Errors}
            T={T}
          />}
          {step === 2 && <Step2
            propType={propType} setPropType={setPropType}
            defaultStatus={defaultStatus} setDefaultStatus={setDefaultStatus}
            pricingMode={pricingMode} setPricingMode={setPricingMode}
            totalPurchase={totalPurchase} setTotalPurchase={setTotalPurchase}
            totalMortgage={totalMortgage} setTotalMortgage={setTotalMortgage}
            totalStampDuty={totalStampDuty} setTotalStampDuty={setTotalStampDuty}
            totalLegalFees={totalLegalFees} setTotalLegalFees={setTotalLegalFees}
            defaultRent={defaultRent} setDefaultRent={setDefaultRent}
            mortgageRate={mortgageRate} setMortgageRate={setMortgageRate}
            mortgageTerm={mortgageTerm} setMortgageTerm={setMortgageTerm}
            insurance={insurance} setInsurance={setInsurance}
            managedBy={managedBy} setManagedBy={setManagedBy}
            notes={notes} setNotes={setNotes}
            unitCount={unitCount}
            errors={step2Errors}
            T={T}
          />}
          {step === 3 && <Step3
            units={units} setRow={setRow} resetRow={resetRow} fillDown={fillDown}
            pricingMode={pricingMode}
            errors={step3Errors}
            T={T}
          />}

          {/* Errors list */}
          {(step === 1 ? step1Errors : step === 2 ? step2Errors : step3Errors).length > 0 && (
            <div style={{ background: T.red + '11', border: `1px solid ${T.red}44`, borderRadius: 8, padding: '10px 12px' }}>
              {(step === 1 ? step1Errors : step === 2 ? step2Errors : step3Errors).map((e, i) => (
                <div key={i} style={{ fontFamily: mono, fontSize: 11, color: T.red }}>• {e}</div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 10 }}>
            <div>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={saving}>← Back</button>}
              {step < 3 && (
                <button className="btn btn-gold" onClick={() => setStep(step + 1)} disabled={!canProceed()}>
                  Next →
                </button>
              )}
              {step === 3 && (
                <button className="btn btn-gold" onClick={handleSave} disabled={!canProceed() || saving}>
                  {saving ? 'Saving…' : `✓ Create ${units.length} ${units.length === 1 ? 'property' : 'properties'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}

// ─── Step 1: Setup ────────────────────────────────────────────────────────
function Step1({
  unitCount, setUnitCount, prefix, setPrefix, customPrefix, setCustomPrefix,
  startingNumber, setStartingNumber, buildingName, setBuildingName,
  streetAddress, setStreetAddress, town, setTown, postcode, setPostcode,
  companyId, setCompanyId, companies, units, T,
}) {
  return (
    <>
      <div className="g2">
        <div>
          <label>Number of units *</label>
          <input type="number" min={1} max={50} value={unitCount}
            onChange={e => setUnitCount(parseInt(e.target.value) || 1)}/>
        </div>
        <div>
          <label>Starting number</label>
          <input type="number" min={1} value={startingNumber}
            onChange={e => setStartingNumber(parseInt(e.target.value) || 1)}/>
        </div>
      </div>
      <div className="g2">
        <div>
          <label>Unit prefix *</label>
          <select value={prefix} onChange={e => setPrefix(e.target.value)}>
            {PREFIXES.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>
        <div>
          <label>{prefix === 'custom' ? 'Custom prefix *' : 'Company *'}</label>
          {prefix === 'custom'
            ? <input value={customPrefix} onChange={e => setCustomPrefix(e.target.value)} placeholder="e.g. Studio"/>
            : <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
        </div>
      </div>
      {prefix === 'custom' && (
        <div>
          <label>Company *</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label>Building name *</label>
        <input value={buildingName} onChange={e => setBuildingName(e.target.value)}
          placeholder="e.g. Watts Moses House"/>
      </div>
      <div>
        <label>Street address *</label>
        <input value={streetAddress} onChange={e => setStreetAddress(e.target.value)}
          placeholder="e.g. High Street East"/>
      </div>
      <div className="g2">
        <div>
          <label>Town</label>
          <input value={town} onChange={e => setTown(e.target.value)} placeholder="e.g. Sunderland"/>
        </div>
        <div>
          <label>Postcode</label>
          <input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="e.g. SR1 2BX"/>
        </div>
      </div>
      {/* Live preview of generated names */}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          Preview ({units.length} {units.length === 1 ? 'unit' : 'units'})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 120, overflowY: 'auto' }}>
          {units.slice(0, 8).map((u, i) => (
            <div key={i} style={{ fontFamily: mono, fontSize: 11, color: T.text }}>
              <span style={{ fontWeight: 700 }}>{u.name}</span>
              {u.address && <span style={{ color: T.muted }}> · {u.address}</span>}
            </div>
          ))}
          {units.length > 8 && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, fontStyle: 'italic' }}>
              … and {units.length - 8} more
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Step 2: Shared fields ─────────────────────────────────────────────────
function Step2({
  propType, setPropType, defaultStatus, setDefaultStatus,
  pricingMode, setPricingMode,
  totalPurchase, setTotalPurchase, totalMortgage, setTotalMortgage,
  totalStampDuty, setTotalStampDuty, totalLegalFees, setTotalLegalFees,
  defaultRent, setDefaultRent,
  mortgageRate, setMortgageRate, mortgageTerm, setMortgageTerm,
  insurance, setInsurance, managedBy, setManagedBy, notes, setNotes,
  unitCount, T,
}) {
  const fmt = (n) => n ? '£' + Math.round(n).toLocaleString('en-GB') : '—'
  const splitPurchase = pricingMode === 'total' && totalPurchase ? parseFloat(totalPurchase) / unitCount : 0
  const splitMortgage = pricingMode === 'total' && totalMortgage ? parseFloat(totalMortgage) / unitCount : 0

  return (
    <>
      <div className="g2">
        <div>
          <label>Property type</label>
          <input value={propType} onChange={e => setPropType(e.target.value)} placeholder="e.g. 1-Bed Flat"/>
        </div>
        <div>
          <label>Default status</label>
          <select value={defaultStatus} onChange={e => setDefaultStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </div>
      </div>

      {/* Pricing mode toggle */}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
          Pricing mode
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setPricingMode('total')}
            style={{ flex: 1, fontFamily: mono, fontSize: 11, padding: '8px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${pricingMode === 'total' ? T.gold : T.border}`,
              background: pricingMode === 'total' ? T.gold + '22' : 'transparent',
              color: pricingMode === 'total' ? T.gold : T.muted,
              fontWeight: pricingMode === 'total' ? 700 : 400 }}>
            Total for whole building (split evenly)
          </button>
          <button onClick={() => setPricingMode('per_unit')}
            style={{ flex: 1, fontFamily: mono, fontSize: 11, padding: '8px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${pricingMode === 'per_unit' ? T.gold : T.border}`,
              background: pricingMode === 'per_unit' ? T.gold + '22' : 'transparent',
              color: pricingMode === 'per_unit' ? T.gold : T.muted,
              fontWeight: pricingMode === 'per_unit' ? 700 : 400 }}>
            Per-unit (set on next step)
          </button>
        </div>

        {pricingMode === 'total' && (
          <>
            <div className="g2">
              <div>
                <label>Total purchase price</label>
                <MoneyInput prefix="£" value={totalPurchase} onChange={v => setTotalPurchase(v)}/>
                {totalPurchase && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 3 }}>
                  ≈ {fmt(splitPurchase)} per unit
                </div>}
              </div>
              <div>
                <label>Total mortgage</label>
                <MoneyInput prefix="£" value={totalMortgage} onChange={v => setTotalMortgage(v)}/>
                {totalMortgage && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 3 }}>
                  ≈ {fmt(splitMortgage)} per unit
                </div>}
              </div>
            </div>
            <div className="g2" style={{ marginTop: 8 }}>
              <div>
                <label>Total stamp duty</label>
                <MoneyInput prefix="£" value={totalStampDuty} onChange={v => setTotalStampDuty(v)}/>
              </div>
              <div>
                <label>Total legal fees</label>
                <MoneyInput prefix="£" value={totalLegalFees} onChange={v => setTotalLegalFees(v)}/>
              </div>
            </div>
          </>
        )}
        {pricingMode === 'per_unit' && (
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, fontStyle: 'italic' }}>
            Enter each unit's purchase price and mortgage on the next step.
          </div>
        )}
      </div>

      <div className="g2">
        <div>
          <label>Default rent per unit</label>
          <MoneyInput prefix="£" suffix="/mo" value={defaultRent} onChange={v => setDefaultRent(v)}
            placeholder="Override per unit on next step"/>
        </div>
        <div>
          <label>Insurance</label>
          <MoneyInput prefix="£" value={insurance} onChange={v => setInsurance(v)}/>
        </div>
      </div>
      <div className="g2">
        <div>
          <label>Mortgage rate</label>
          <MoneyInput suffix="%" value={mortgageRate} onChange={v => setMortgageRate(v)}/>
        </div>
        <div>
          <label>Mortgage term (years)</label>
          <input type="number" value={mortgageTerm} onChange={e => setMortgageTerm(e.target.value)}/>
        </div>
      </div>
      <div>
        <label>Managed by</label>
        <input value={managedBy} onChange={e => setManagedBy(e.target.value)} placeholder="e.g. Self / Letting agent name"/>
      </div>
      <div>
        <label>Notes (applied to all units)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }}/>
      </div>
    </>
  )
}

// ─── Step 3: Per-unit grid ─────────────────────────────────────────────────
function Step3({ units, setRow, resetRow, fillDown, pricingMode, T }) {
  const fmt = (n) => n ? '£' + Math.round(parseFloat(n) || 0).toLocaleString('en-GB') : '—'
  const totalRent = units.reduce((s, u) => s + (parseFloat(u.rent) || 0), 0)
  const totalPurchase = units.reduce((s, u) => s + (parseFloat(u.purchase) || 0), 0)

  return (
    <>
      {/* Quick stats above the grid */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 4 }}>
        <span>{units.length} {units.length === 1 ? 'unit' : 'units'}</span>
        <span>· Total rent: <strong style={{ color: T.green }}>{fmt(totalRent)}/mo</strong></span>
        {totalPurchase > 0 && <span>· Total purchase: <strong style={{ color: T.gold }}>{fmt(totalPurchase)}</strong></span>}
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              <th style={cellStyle(T, 'header', 'left')}>Name</th>
              <th style={cellStyle(T, 'header')}>Status</th>
              <th style={cellStyle(T, 'header')}>
                Rent £/mo <FillDownLink onClick={() => fillDown('rent')} T={T}/>
              </th>
              {pricingMode === 'per_unit' && (
                <>
                  <th style={cellStyle(T, 'header')}>
                    Purchase £ <FillDownLink onClick={() => fillDown('purchase')} T={T}/>
                  </th>
                  <th style={cellStyle(T, 'header')}>
                    Mortgage £ <FillDownLink onClick={() => fillDown('mortgage')} T={T}/>
                  </th>
                </>
              )}
              <th style={cellStyle(T, 'header')}/>
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={cellStyle(T, 'cell', 'left')}>
                  <input value={u.name} onChange={e => setRow(i, { name: e.target.value })}
                    style={cellInput(T)}/>
                </td>
                <td style={cellStyle(T, 'cell')}>
                  <select value={u.status} onChange={e => setRow(i, { status: e.target.value })} style={cellInput(T)}>
                    {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </select>
                </td>
                <td style={cellStyle(T, 'cell')}>
                  <MoneyInput value={u.rent} onChange={v => setRow(i, { rent: v })}
                    style={cellInput(T)}/>
                </td>
                {pricingMode === 'per_unit' && (
                  <>
                    <td style={cellStyle(T, 'cell')}>
                      <MoneyInput value={u.purchase} onChange={v => setRow(i, { purchase: v })}
                        style={cellInput(T)}/>
                    </td>
                    <td style={cellStyle(T, 'cell')}>
                      <MoneyInput value={u.mortgage} onChange={v => setRow(i, { mortgage: v })}
                        style={cellInput(T)}/>
                    </td>
                  </>
                )}
                <td style={cellStyle(T, 'cell')}>
                  <button onClick={() => resetRow(i)} title="Reset this row to defaults"
                    style={{ background: 'transparent', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 12 }}>↻</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, fontStyle: 'italic' }}>
        Tip: change a value in the first row, then click "Fill down" in the column header to copy it to all rows.
      </div>
    </>
  )
}

function FillDownLink({ onClick, T }) {
  return (
    <button onClick={onClick} title="Fill this column with the first row's value"
      style={{ background: 'transparent', border: 'none', color: T.gold, cursor: 'pointer', fontSize: 9, fontFamily: mono, marginLeft: 6, textDecoration: 'underline' }}>
      ↓ Fill
    </button>
  )
}

function cellStyle(T, kind, align = 'center') {
  if (kind === 'header') {
    return {
      fontFamily: mono, fontSize: 10, fontWeight: 700, color: T.muted,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '8px 10px', textAlign: align,
      whiteSpace: 'nowrap',
    }
  }
  return { padding: '6px 8px', textAlign: align }
}
function cellInput(T) {
  return {
    fontFamily: mono, fontSize: 11, padding: '5px 8px',
    border: `1px solid ${T.border}`, borderRadius: 4,
    background: T.surface, color: T.text,
    width: '100%', minWidth: 80,
  }
}
