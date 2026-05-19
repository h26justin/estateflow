import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import MoneyInput from '../../lib/MoneyInput'
import { isFormDirty, safeOverlayClose } from '../../lib/modalUtils'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS } from '../../lib/propertyStatus'

export default function PropertyModal({ prop, companies, onClose, onSave }) {
  const { T } = useTheme()
  const blank = { name:'',company_id:prop?.company_id||companies[0]?.id||'',address:'',prop_type:'',status:'purchased',refurb_status:'planned',purchase_price:'',refurb_cost:'',refurb_cost_unpaid:false,est_value:'',mortgage_amount:'',deposit:'',stamp_duty:'',legal_fees:'',rent_pcm:'',mortgage_rate:'',mortgage_term:25,insurance:'',arrears:0,tenancy_end:'',rent_due_day:'',notes:'',managed_by:'' }
  // Three modes:
  //   1. Edit existing property — prop has an id, spread it over blank, and
  //      scale the mortgage_rate from decimal (0.05 stored) to percent (5.00).
  //   2. Convert from deal — prop is a prefill object WITHOUT id; spread it
  //      over blank so the user sees pre-populated fields. mortgage_rate
  //      from a deal is already in percent form so no scaling needed.
  //   3. Add fresh — no prop at all; just blank.
  const initialForm = prop?.id
    ? { ...blank, ...prop, company_id: prop.company_id || prop.company?.id || '', mortgage_rate: prop.mortgage_rate ? (prop.mortgage_rate*100).toFixed(2) : '' }
    : (prop ? { ...blank, ...prop } : blank)
  const [form, setForm] = useState(initialForm)
  const [snapshot] = useState(initialForm)
  const isDirty = isFormDirty(snapshot, form)
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))
  function handleSave() {
    if (!form.name || !form.address) return
    // Strip joined relation fields that aren't real columns on the properties table
    const { company, compliance_items, tenancy, maintenance_jobs, rent_payments, refurb_phases, refurb_costs, documents, ...clean } = form
    onSave({ ...clean, purchase_price:parseFloat(clean.purchase_price)||0, refurb_cost:parseFloat(clean.refurb_cost)||0, est_value:parseFloat(clean.est_value)||0, mortgage_amount:parseFloat(clean.mortgage_amount)||0, deposit:parseFloat(clean.deposit)||0, stamp_duty:parseFloat(clean.stamp_duty)||0, legal_fees:parseFloat(clean.legal_fees)||0, rent_pcm:parseFloat(clean.rent_pcm)||0, mortgage_rate:parseFloat(clean.mortgage_rate)/100||0, mortgage_term:parseInt(clean.mortgage_term)||25, insurance:parseFloat(clean.insurance)||0, arrears:parseFloat(clean.arrears)||0 })
  }
  return <div className="overlay" onClick={safeOverlayClose(isDirty, onClose)}>
    <div className="modal">
      <div style={{padding:'24px 28px 0'}}>
        <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>{prop?.id ? 'Edit Property' : (prop?.purchase_price ? 'Convert Deal to Property' : 'Add New Property')}</h2>
        <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:11,marginBottom:20}}>{prop?.id ? 'Fill in the details below.' : (prop?.purchase_price ? 'Pre-filled from your deal. Review, adjust, and save.' : 'Fill in the details below.')}</p>
      </div>
      <div style={{padding:'0 28px 28px',display:'flex',flexDirection:'column',gap:12}}>
        <div className="g2"><div><label>Property Name *</label><input value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Flat 1, Station Road"/></div><div><label>Company *</label><select value={form.company_id} onChange={e=>s('company_id',e.target.value)}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
        <div><label>Full Address *</label><input value={form.address} onChange={e=>s('address',e.target.value)}/></div>
        <div className="g2"><div><label>Property Type</label><input value={form.prop_type} onChange={e=>s('prop_type',e.target.value)} placeholder="e.g. 2-Bed Flat"/></div><div><label>Status</label><select value={form.status} onChange={e=>s('status',e.target.value)}>{PROPERTY_STATUSES.map(x=><option key={x} value={x}>{PROPERTY_STATUS_LABELS[x]}</option>)}</select></div></div>
          <div><label>Managed By</label><input value={form.managed_by||''} onChange={e=>s('managed_by',e.target.value)} placeholder="e.g. Propertunity, Rook Matthews Sayer"/></div>
        <div className="g2"><div><label>Purchase Price</label><MoneyInput prefix="£" value={form.purchase_price} onChange={v=>s('purchase_price',v)}/></div><div><label>Estimated Value</label><MoneyInput prefix="£" value={form.est_value} onChange={v=>s('est_value',v)}/></div></div>
        <div className="g2"><div><label>Refurb Cost</label><MoneyInput prefix="£" value={form.refurb_cost} onChange={v=>s('refurb_cost',v)}/></div><div><label>Mortgage Amount</label><MoneyInput prefix="£" value={form.mortgage_amount} onChange={v=>s('mortgage_amount',v)}/></div></div>
        {/* Unpaid-refurb flag — drives the cashflow panel on the Deals page.
            Only meaningful when there's a refurb cost set, so we hide it
            otherwise to avoid clutter. */}
        {Number(form.refurb_cost) > 0 && (
          <div style={{padding:'8px 12px',background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,marginTop:-4}}>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text}}>
              <input type="checkbox" checked={!!form.refurb_cost_unpaid} onChange={e=>s('refurb_cost_unpaid',e.target.checked)} style={{width:'auto',margin:0,marginTop:2}}/>
              <span>
                <strong>Refurb cost is unpaid (still owed)</strong>
                <span style={{display:'block',color:T.muted,fontSize:10,marginTop:2,fontWeight:400}}>Tick this if you haven't yet paid the refurb. Surfaces it on the Deals → Cashflow panel as money still to pay out, regardless of property status.</span>
              </span>
            </label>
          </div>
        )}
        <div className="g2"><div><label>Stamp Duty</label><MoneyInput prefix="£" value={form.stamp_duty} onChange={v=>s('stamp_duty',v)}/></div><div><label>Legal Fees</label><MoneyInput prefix="£" value={form.legal_fees} onChange={v=>s('legal_fees',v)}/></div></div>
        <div className="g2"><div><label>Monthly Rent</label><MoneyInput prefix="£" value={form.rent_pcm} onChange={v=>s('rent_pcm',v)}/></div><div><label>Mortgage Rate</label><MoneyInput suffix="%" value={form.mortgage_rate} onChange={v=>s('mortgage_rate',v)}/></div></div>
        <div className="g2"><div><label>Rent Due Day</label><input value={form.rent_due_day} onChange={e=>s('rent_due_day',e.target.value)} placeholder="e.g. 1st"/></div><div><label>Arrears</label><MoneyInput prefix="£" value={form.arrears} onChange={v=>s('arrears',v)}/></div></div>
        <div><label>Tenancy End</label><input value={form.tenancy_end} onChange={e=>s('tenancy_end',e.target.value)} placeholder="e.g. 31st March 2026"/></div>
        <div><label>Notes</label><textarea value={form.notes} onChange={e=>s('notes',e.target.value)} rows={3} style={{resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={handleSave}>{prop?.id?'Save Changes':'Add Property'}</button>
        </div>
      </div>
    </div>
  </div>
}
