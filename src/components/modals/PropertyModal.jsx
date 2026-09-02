import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import MoneyInput from '../../lib/MoneyInput'
import { isFormDirty, safeOverlayClose } from '../../lib/modalUtils'
import { useConfirm } from '../../lib/ConfirmContext'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS } from '../../lib/propertyStatus'
import { HEATING_TYPES, LICENSING_SCHEMES, canonicalCertType } from '../../lib/complianceCatalogue'
import { showAppToast } from '../../lib/toast'
import { fetchEstateAgents } from '../../lib/api/ownership'
import FocusTrap from '../../lib/FocusTrap'
import { MONO } from '../../lib/styles'

// Light section header used to break the long form into scannable groups.
// Just a divider + an uppercase mono caption — no card, so it stays cheap
// visually inside the already-bordered modal.
function Section({ title, T, first }) {
  return <div style={{
    fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: T.text,
    paddingBottom: 8, borderBottom: `1px solid ${T.border}`,
    marginTop: first ? 0 : 8,
  }}>{title}</div>
}

// The four core UK landlord compliance certificates we prompt for at
// property add/edit time. Anything more granular (PAT, legionella, fire
// alarm full report, etc) is added later via the Compliance tab on the
// property page. We pick these four because:
//   - they're legally required for most BTL properties
//   - they're the only ones with hard expiry dates landlords typically
//     have to hand (gas annual, EICR 5yr, EPC 10yr, smoke alarm yearly)
//   - asking for more in the add-flow risks abandonment
//
// Each entry: form field key, DB cert_type, display label, default
// reminder window (days before expiry to nudge in the bell).
export const COMPLIANCE_PROMPTS = [
  { key:'gas_safety_expiry',  cert_type:'gas_safety',  cert_name:'Gas Safety Certificate', label:'Gas Safety expiry',  reminder_days:30 },
  { key:'eicr_expiry',        cert_type:'eicr',        cert_name:'EICR',                    label:'EICR expiry',         reminder_days:60 },
  { key:'epc_expiry',         cert_type:'epc',         cert_name:'EPC',                     label:'EPC expiry',          reminder_days:90 },
  { key:'smoke_alarm_checked',cert_type:'smoke_alarm', cert_name:'Smoke Alarm Check',       label:'Smoke alarm last checked', reminder_days:30, isCheckDate:true },
]

export default function PropertyModal({ prop, companies, onClose, onSave }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const blank = { name:'',company_id:prop?.company_id||companies[0]?.id||'',address:'',prop_type:'',status:'purchased',refurb_status:'planned',purchase_price:'',purchase_date:'',refurb_cost:'',refurb_cost_unpaid:false,est_value:'',mortgage_amount:'',deposit:'',stamp_duty:'',legal_fees:'',rent_pcm:'',mortgage_rate:'',mortgage_term:25,mortgage_type:'repayment',mortgage_monthly_payment:'',mortgage_fees:'',mortgage_product_end_date:'',insurance:'',arrears:0,tenancy_end:'',rent_due_day:'',notes:'',managed_by:'',managed_by_agent_id:'',
    // Compliance dates (form-only — extracted into compliance_items rows
    // by handleSaveProp). When editing an existing property we pre-fill
    // from any compliance_items rows that already exist for the matching
    // cert_type.
    gas_safety_expiry:'', eicr_expiry:'', epc_expiry:'', smoke_alarm_checked:'',
    // Compliance applicability flags (real columns) — they decide which
    // requirements the Compliance page expects this property to hold
    // (no gas = no CP12 chase; licensing scheme = licence expected).
    has_gas_supply:true, heating_type:'', licensing_scheme:'', is_hmo:false,
  }
  // Pre-fill compliance dates from existing items (edit mode).
  const existingCompliance = prop?.compliance_items || []
  const compPrefill = {}
  for (const p of COMPLIANCE_PROMPTS) {
    // Canonical compare so a legacy 'gas' row prefills the 'gas_safety' field.
    const match = existingCompliance.find(c => canonicalCertType(c.cert_type) === p.cert_type && !c.deleted_at)
    if (match) {
      compPrefill[p.key] = p.isCheckDate ? (match.issue_date || '') : (match.expiry_date || '')
    }
  }
  // Three modes:
  //   1. Edit existing property — prop has an id, spread it over blank, and
  //      scale the mortgage_rate from decimal (0.05 stored) to percent (5.00).
  //   2. Convert from deal — prop is a prefill object WITHOUT id; spread it
  //      over blank so the user sees pre-populated fields. mortgage_rate
  //      from a deal is already in percent form so no scaling needed.
  //   3. Add fresh — no prop at all; just blank.
  const initialForm = prop?.id
    ? { ...blank, ...prop, ...compPrefill, company_id: prop.company_id || prop.company?.id || '', mortgage_rate: prop.mortgage_rate ? (prop.mortgage_rate*100).toFixed(2) : '' }
    : (prop ? { ...blank, ...prop } : blank)
  const [form, setForm] = useState(initialForm)
  // Managing-agent directory for the "Managed By" picker. Fees live on the
  // agency (Companies tab), so picking the agent here is all a property
  // needs for the Company P&L fee calculation.
  const [agents, setAgents] = useState([])
  useEffect(() => { fetchEstateAgents().then(setAgents).catch(() => {}) }, [])
  const [snapshot] = useState(initialForm)
  const isDirty = isFormDirty(snapshot, form)
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Cash-purchase toggle. No is_cash column on properties, so this is UI
  // state: we persist the signal by zeroing the mortgage fields on save and
  // re-infer it on open. A converted deal passes prop.is_cash directly; an
  // existing property is cash if it has a price but no mortgage at all.
  const inferCash = prop?.is_cash != null
    ? !!prop.is_cash
    : !!(prop?.id && Number(prop.purchase_price) > 0 && !Number(prop.mortgage_amount) && !Number(prop.mortgage_rate) && !Number(prop.mortgage_monthly_payment))
  const [isCash, setIsCash] = useState(inferCash)
  // Escape hatch: a cash buyer with a small bridging loan can reveal the
  // mortgage fields without un-ticking cash.
  const [revealMortgage, setRevealMortgage] = useState(false)
  const showMortgage = !isCash || revealMortgage

  // Drives inline required-field highlighting — set once the user has tried
  // to save with something missing.
  const [triedSave, setTriedSave] = useState(false)

  function handleSave() {
    // Don't silently no-op — the user clicks Save and the button looks
    // broken. Surface what's missing inline AND via the global toast.
    if (!form.name || !form.address) {
      setTriedSave(true)
      const missing = !form.name && !form.address ? 'Name and Address' : (!form.name ? 'Name' : 'Address')
      showAppToast(`${missing} required — please fill it in before saving`, 'error')
      return
    }
    // Strip joined relation fields that aren't real columns on the
    // properties table. Also strip the compliance_* keys — they're
    // form-only state; we surface them as a separate `_compliance`
    // payload for the save handler to persist into compliance_items.
    const {
      company, compliance_items, tenancy, maintenance_jobs, rent_payments,
      refurb_phases, refurb_costs, documents, stl_bookings, tenancies, rent_receipts, non_chargeable_periods, rent_overrides, payment_plans, is_cash,
      gas_safety_expiry, eicr_expiry, epc_expiry, smoke_alarm_checked,
      ...clean
    } = form

    // Cash purchase with the mortgage block hidden: don't persist any stale
    // pre-filled mortgage data. (If the user revealed the fields for a
    // bridging loan, we respect whatever they entered.)
    const cashOverride = (isCash && !revealMortgage)
      ? { mortgage_amount: 0, mortgage_rate: 0, mortgage_monthly_payment: null, mortgage_fees: 0, mortgage_product_end_date: null }
      : {}

    // Build the compliance payload — one entry per prompt that has a
    // non-empty date. handleSaveProp will upsert these into
    // compliance_items after the property write succeeds.
    const compliancePayload = COMPLIANCE_PROMPTS
      .map(p => ({ ...p, value: form[p.key]?.trim() }))
      .filter(p => !!p.value)
      // No gas supply → don't create a gas cert row even if a stale date
      // was entered before the flag was unticked.
      .filter(p => p.cert_type !== 'gas_safety' || form.has_gas_supply !== false)
      .map(p => ({
        cert_type: p.cert_type,
        cert_name: p.cert_name,
        reminder_days: p.reminder_days,
        // For check-date fields (smoke alarm), the date is issue_date;
        // for expiry fields it's expiry_date.
        ...(p.isCheckDate ? { issue_date: p.value } : { expiry_date: p.value }),
      }))

    onSave({
      ...clean,
      purchase_price:parseFloat(clean.purchase_price)||0,
      // Completion date. Null (not '') when blank so the date column stays
      // empty rather than erroring on an invalid date literal.
      purchase_date: clean.purchase_date || null,
      refurb_cost:parseFloat(clean.refurb_cost)||0,
      est_value:parseFloat(clean.est_value)||0,
      mortgage_amount:parseFloat(clean.mortgage_amount)||0,
      deposit:parseFloat(clean.deposit)||0,
      stamp_duty:parseFloat(clean.stamp_duty)||0,
      legal_fees:parseFloat(clean.legal_fees)||0,
      rent_pcm:parseFloat(clean.rent_pcm)||0,
      mortgage_rate:parseFloat(clean.mortgage_rate)/100||0,
      mortgage_term:parseInt(clean.mortgage_term)||25,
      // New mortgage fields. monthly_payment / fees default to null
      // (not 0) when blank so the calculator's "is set?" check works.
      mortgage_type: clean.mortgage_type || 'repayment',
      mortgage_monthly_payment: clean.mortgage_monthly_payment ? parseFloat(clean.mortgage_monthly_payment) : null,
      mortgage_fees: clean.mortgage_fees ? parseFloat(clean.mortgage_fees) : 0,
      mortgage_product_end_date: clean.mortgage_product_end_date || null,
      insurance:parseFloat(clean.insurance)||0,
      arrears:parseFloat(clean.arrears)||0,
      has_gas_supply: form.has_gas_supply !== false,
      heating_type: clean.heating_type || null,
      licensing_scheme: clean.licensing_scheme || null,
      is_hmo: !!clean.is_hmo,
      managed_by_agent_id: clean.managed_by_agent_id || null,
      managed_by: clean.managed_by_agent_id ? (agents.find(a=>a.id===clean.managed_by_agent_id)?.name || clean.managed_by || null) : (clean.managed_by || null),
      _compliance: compliancePayload,
      ...cashOverride,
    })
  }
  return <div className="overlay" onClick={safeOverlayClose(isDirty, onClose, confirmDiscard)}>
    <FocusTrap onEscape={() => safeOverlayClose(isDirty, onClose, confirmDiscard)({ target: null, currentTarget: null })}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="property-modal-title">
      <div style={{padding:'24px 28px 0'}}>
        <h2 id="property-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>{prop?.id ? 'Edit Property' : (prop?.purchase_price ? 'Convert Deal to Property' : 'Add New Property')}</h2>
        <p style={{fontFamily:MONO,color:T.muted,fontSize:11,marginBottom:20}}>{prop?.id ? 'Fill in the details below.' : (prop?.purchase_price ? 'Pre-filled from your deal. Review, adjust, and save.' : 'Fill in the details below.')}</p>
      </div>
      <form onSubmit={e=>{e.preventDefault(); handleSave()}}>
      <div style={{padding:'0 28px 20px',display:'flex',flexDirection:'column',gap:14}}>

        <Section title="Property" T={T} first />
        <div className="g2">
          <div>
            <label htmlFor="pm-name">Property Name *</label>
            <input id="pm-name" value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Flat 1, Station Road" style={triedSave && !form.name ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.name ? 'true' : undefined} aria-describedby={triedSave && !form.name ? 'pm-name-err' : undefined}/>
            {triedSave && !form.name && <span id="pm-name-err" style={{fontFamily:MONO,fontSize:10,color:T.red,display:'block',marginTop:4}}>Required</span>}
          </div>
          <div><label htmlFor="pm-company">Company *</label><select id="pm-company" value={form.company_id} onChange={e=>s('company_id',e.target.value)}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div>
          <label htmlFor="pm-address">Full Address *</label>
          <input id="pm-address" value={form.address} onChange={e=>s('address',e.target.value)} style={triedSave && !form.address ? {borderColor:T.red} : undefined} aria-invalid={triedSave && !form.address ? 'true' : undefined} aria-describedby={triedSave && !form.address ? 'pm-address-err' : undefined}/>
          {triedSave && !form.address && <span id="pm-address-err" style={{fontFamily:MONO,fontSize:10,color:T.red,display:'block',marginTop:4}}>Required</span>}
        </div>
        <div className="g2"><div><label htmlFor="pm-prop-type">Property Type</label><input id="pm-prop-type" value={form.prop_type} onChange={e=>s('prop_type',e.target.value)} placeholder="e.g. 2-Bed Flat"/></div><div><label htmlFor="pm-status">Status</label><select id="pm-status" value={form.status} onChange={e=>s('status',e.target.value)}>{PROPERTY_STATUSES.map(x=><option key={x} value={x}>{PROPERTY_STATUS_LABELS[x]}</option>)}</select></div></div>
        <div><label htmlFor="pm-managed-by">Managed By</label>
          <select id="pm-managed-by" value={form.managed_by_agent_id||''} onChange={e=>{
            const agent = agents.find(a=>a.id===e.target.value)
            setForm(f=>({ ...f, managed_by_agent_id: e.target.value, managed_by: agent ? agent.name : f.managed_by }))
          }}>
            <option value="">Self-managed / none</option>
            {agents.map(a=><option key={a.id} value={a.id}>{a.name}{a.fee_percent!=null?` — ${Number(a.fee_percent)}%${a.vat_treatment==='ex_vat'?' + VAT':''}`:''}</option>)}
          </select>
          {!form.managed_by_agent_id && form.managed_by && <div style={{fontFamily:MONO,fontSize:10,opacity:0.7,marginTop:4}}>Previously: “{form.managed_by}” — pick the agent above to link fees.</div>}
        </div>

        <Section title="Purchase & costs" T={T} />
        <div className="g2"><div><label htmlFor="pm-purchase-price">Purchase Price</label><MoneyInput id="pm-purchase-price" prefix="£" value={form.purchase_price} onChange={v=>s('purchase_price',v)}/></div><div><label htmlFor="pm-est-value">Estimated Value</label><MoneyInput id="pm-est-value" prefix="£" value={form.est_value} onChange={v=>s('est_value',v)}/></div></div>
        <div className="g2"><div><label htmlFor="pm-purchase-date">Completion Date</label><input id="pm-purchase-date" type="date" value={form.purchase_date || ''} onChange={e=>s('purchase_date', e.target.value)}/></div><div><label htmlFor="pm-refurb-cost">Refurb Cost</label><MoneyInput id="pm-refurb-cost" prefix="£" value={form.refurb_cost} onChange={v=>s('refurb_cost',v)}/></div></div>
        {/* Unpaid-refurb flag — drives the cashflow panel on the Deals page.
            Only meaningful when there's a refurb cost set, so we hide it
            otherwise to avoid clutter. */}
        {Number(form.refurb_cost) > 0 && (
          <div style={{padding:'8px 12px',background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,marginTop:-4}}>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontFamily:MONO,fontSize:11,color:T.text}}>
              <input type="checkbox" checked={!!form.refurb_cost_unpaid} onChange={e=>s('refurb_cost_unpaid',e.target.checked)} style={{width:'auto',margin:0,marginTop:2}}/>
              <span>
                <strong>Refurb cost is unpaid (still owed)</strong>
                <span style={{display:'block',color:T.muted,fontSize:10,marginTop:2,fontWeight:400}}>Tick this if you haven't yet paid the refurb. Surfaces it on the Deals → Cashflow panel as money still to pay out, regardless of property status.</span>
              </span>
            </label>
          </div>
        )}
        <div className="g2"><div><label htmlFor="pm-stamp-duty">Stamp Duty</label><MoneyInput id="pm-stamp-duty" prefix="£" value={form.stamp_duty} onChange={v=>s('stamp_duty',v)}/></div><div><label htmlFor="pm-legal-fees">Legal Fees</label><MoneyInput id="pm-legal-fees" prefix="£" value={form.legal_fees} onChange={v=>s('legal_fees',v)}/></div></div>

        <Section title="Financing" T={T} />
        {/* Cash-purchase toggle. When on, the whole mortgage block collapses
            (and is zeroed on save) so a cash buyer isn't wading through
            irrelevant fields. "Show anyway" reveals them for the bridging-
            loan edge case without un-ticking cash. */}
        <div style={{padding:'8px 12px',background:T.bg,border:`1px solid ${T.border}`,borderRadius:8}}>
          <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontFamily:MONO,fontSize:11,color:T.text}}>
            <input type="checkbox" checked={isCash} onChange={e=>{ setIsCash(e.target.checked); if(e.target.checked) setRevealMortgage(false) }} style={{width:'auto',margin:0,marginTop:2}}/>
            <span>
              <strong>Cash purchase (no mortgage)</strong>
              <span style={{display:'block',color:T.muted,fontSize:10,marginTop:2,fontWeight:400}}>Tick if you bought outright. We'll hide the mortgage fields and skip them on save.</span>
            </span>
          </label>
        </div>
        {showMortgage ? (<>
        <div className="g2"><div><label htmlFor="pm-mortgage-amount">Mortgage Amount</label><MoneyInput id="pm-mortgage-amount" prefix="£" value={form.mortgage_amount} onChange={v=>s('mortgage_amount',v)}/></div><div><label htmlFor="pm-mortgage-rate">Mortgage Rate</label><MoneyInput id="pm-mortgage-rate" suffix="%" value={form.mortgage_rate || ''} onChange={v=>s('mortgage_rate',v)}/></div></div>

        {/* Extended mortgage fields — type, actual monthly payment,
            arrangement fees. All optional. monthly_payment overrides
            the formula when set, which is the right call for real-
            world mortgages with fees / part-and-part / product
            transitions baked into the direct debit. */}
        <div className="g2">
          <div>
            <label htmlFor="pm-mortgage-type">
              Mortgage Type
              <span style={{ color: T.muted, fontWeight: 400, fontSize: 10, display: 'block', marginTop: 2 }}>
                {(() => {
                  const t = form.mortgage_type || 'repayment'
                  if (t === 'repayment')      return 'Each payment covers interest + a bit of capital. Balance reduces over the term.'
                  if (t === 'interest_only')  return 'Each payment covers interest only. Full balance is owed at the end of the term.'
                  if (t === 'mixed')          return 'Part interest-only + part repayment. We treat this like repayment for calculations.'
                  if (t === 'bridging')       return 'Short-term loan, usually interest-only. Use the Monthly Payment override below.'
                  return ''
                })()}
              </span>
            </label>
            <select id="pm-mortgage-type" value={form.mortgage_type || 'repayment'} onChange={e=>s('mortgage_type', e.target.value)}>
              <option value="repayment">Repayment</option>
              <option value="interest_only">Interest-only</option>
              <option value="mixed">Mixed (IO + repayment)</option>
              <option value="bridging">Bridging</option>
            </select>
          </div>
          <div>
            <label htmlFor="pm-mortgage-monthly">
              Monthly Payment
              <span style={{ color: T.muted, fontWeight: 400, fontSize: 10, display: 'block', marginTop: 2 }}>
                Optional. Leave blank to calculate from rate + term. Fill in if your direct
                debit includes fees or you have a fixed deal that doesn't match the formula.
              </span>
            </label>
            <MoneyInput id="pm-mortgage-monthly" prefix="£" value={form.mortgage_monthly_payment} onChange={v=>s('mortgage_monthly_payment', v)}/>
          </div>
        </div>
        <div className="g2">
          <div>
            <label htmlFor="pm-mortgage-term">Mortgage Term (years)</label>
            <input id="pm-mortgage-term" type="number" value={form.mortgage_term} onChange={e=>s('mortgage_term', e.target.value)} placeholder="25"/>
          </div>
          <div>
            <label htmlFor="pm-mortgage-fees">Setup / Arrangement Fees</label>
            <MoneyInput id="pm-mortgage-fees" prefix="£" value={form.mortgage_fees} onChange={v=>s('mortgage_fees', v)}/>
          </div>
        </div>
        <div>
          <label htmlFor="pm-mortgage-end-date">Mortgage Product End Date <span style={{ color: T.muted, fontWeight: 400, fontSize: 10 }}>(when fixed/tracker rate expires — we'll remind you to remortgage)</span></label>
          <input id="pm-mortgage-end-date" type="date" value={form.mortgage_product_end_date || ''} onChange={e=>s('mortgage_product_end_date', e.target.value)}/>
        </div>
        </>) : (
          <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>
            Mortgage fields hidden for a cash purchase.{' '}
            <button type="button" onClick={()=>setRevealMortgage(true)} style={{background:'none',border:'none',color:T.gold,cursor:'pointer',fontFamily:MONO,fontSize:11,padding:0,textDecoration:'underline'}}>Show anyway</button>
          </div>
        )}

        <Section title="Tenancy & rent" T={T} />
        <div className="g2"><div><label htmlFor="pm-rent-pcm">Monthly Rent</label><MoneyInput id="pm-rent-pcm" prefix="£" value={form.rent_pcm} onChange={v=>s('rent_pcm',v)}/></div><div><label htmlFor="pm-rent-due-day">Rent Due Day</label><input id="pm-rent-due-day" value={form.rent_due_day} onChange={e=>s('rent_due_day',e.target.value)} placeholder="e.g. 1st"/></div></div>
        <div className="g2">
          <div><label htmlFor="pm-arrears">Arrears</label><MoneyInput id="pm-arrears" prefix="£" value={form.arrears} onChange={v=>s('arrears',v)}/></div>
          <div>
            <label htmlFor="pm-tenancy-end">Tenancy End <span style={{ color: T.muted, fontWeight: 400, fontSize: 10 }}>(when the current AST expires)</span></label>
            {/* type=date so renewal-alerts logic can parse it and we don't
                get inconsistent date strings. */}
            <input id="pm-tenancy-end" type="date" value={form.tenancy_end || ''} onChange={e=>s('tenancy_end',e.target.value)}/>
          </div>
        </div>

        <Section title="Compliance & notes" T={T} />

        {/* Applicability flags — these drive which certificates the
            Compliance page expects for this property (a gas-free flat
            shouldn't show a missing CP12; an HMO needs its licence and
            fire paperwork). */}
        <div className="g2">
          <div><label htmlFor="pm-heating-type">Heating</label><select id="pm-heating-type" value={form.heating_type||''} onChange={e=>s('heating_type',e.target.value)}>{HEATING_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          <div><label htmlFor="pm-licensing">Licensing</label><select id="pm-licensing" value={form.licensing_scheme||''} onChange={e=>s('licensing_scheme',e.target.value)}>{LICENSING_SCHEMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div style={{display:'flex',gap:18,flexWrap:'wrap',padding:'8px 12px',background:T.bg,border:`1px solid ${T.border}`,borderRadius:8}}>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontFamily:MONO,fontSize:11,color:T.text}}>
            <input type="checkbox" checked={form.has_gas_supply!==false} onChange={e=>s('has_gas_supply',e.target.checked)} style={{width:'auto',margin:0}}/>
            <span>Has gas supply</span>
          </label>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontFamily:MONO,fontSize:11,color:T.text}}>
            <input type="checkbox" checked={!!form.is_hmo} onChange={e=>s('is_hmo',e.target.checked)} style={{width:'auto',margin:0}}/>
            <span>HMO (house in multiple occupation)</span>
          </label>
        </div>

        {/* ── COMPLIANCE PROMPTS ──────────────────────────────────
            Four optional date fields covering the legally-required
            UK landlord compliance certificates. Empty = skip; a date
            creates/updates a compliance_items row on save and surfaces
            in the bell as expiry approaches. The whole section
            collapses by default so the form doesn't feel longer for
            users who don't care about compliance. */}
        <details style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: T.text, fontWeight: 700, listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Compliance dates (optional)</span>
            <span style={{ fontSize: 10, color: T.muted, fontWeight: 400 }}>tap to expand</span>
          </summary>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.6, marginTop: 8, marginBottom: 12 }}>
            Add what you know now — leave the rest blank. We'll remind you in the bell as expiries approach. You can also upload certificates later on the Compliance tab and we'll auto-fill the dates.
          </div>
          <div className="g2">
            {form.has_gas_supply!==false && <div>
              <label htmlFor="pm-gas-safety">Gas Safety expiry</label>
              <input id="pm-gas-safety" type="date" value={form.gas_safety_expiry || ''} onChange={e=>s('gas_safety_expiry', e.target.value)}/>
            </div>}
            <div>
              <label htmlFor="pm-eicr">EICR expiry</label>
              <input id="pm-eicr" type="date" value={form.eicr_expiry || ''} onChange={e=>s('eicr_expiry', e.target.value)}/>
            </div>
          </div>
          <div className="g2" style={{ marginTop: 10 }}>
            <div>
              <label htmlFor="pm-epc">EPC expiry</label>
              <input id="pm-epc" type="date" value={form.epc_expiry || ''} onChange={e=>s('epc_expiry', e.target.value)}/>
            </div>
            <div>
              <label htmlFor="pm-smoke-alarm">Smoke alarm last checked</label>
              <input id="pm-smoke-alarm" type="date" value={form.smoke_alarm_checked || ''} onChange={e=>s('smoke_alarm_checked', e.target.value)}/>
            </div>
          </div>
        </details>

        <div><label htmlFor="pm-notes">Notes</label><textarea id="pm-notes" value={form.notes} onChange={e=>s('notes',e.target.value)} rows={3} style={{resize:'vertical'}}/></div>
      </div>
      {/* Sticky footer — keeps the primary action reachable without scrolling
          to the bottom of a long form. Sits inside the scrolling .modal so
          position:sticky pins it to the modal's bottom edge. */}
      <div style={{position:'sticky',bottom:0,background:T.surface,borderTop:`1px solid ${T.border}`,padding:'14px 28px',display:'flex',gap:10,justifyContent:'flex-end',borderBottomLeftRadius:18,borderBottomRightRadius:18}}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-gold">{prop?.id?'Save Changes':'Add Property'}</button>
      </div>
      </form>
    </div>
    </FocusTrap>
  </div>
}
