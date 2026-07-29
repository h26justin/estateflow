import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import MoneyInput from '../../lib/MoneyInput'
import { safeOverlayClose } from '../../lib/modalUtils'
import { useConfirm } from '../../lib/ConfirmContext'
import { fmt } from '../../lib/format'
import FocusTrap from '../../lib/FocusTrap'

export default function SellPropertyModal({ property, onClose, onConfirm, busy }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const initialPrice = property?.current_value || property?.est_value || ''
  const initialDate  = new Date().toISOString().slice(0, 10)
  const [price, setPrice] = useState(initialPrice)
  const [date,  setDate]  = useState(initialDate)
  const isDirty = String(price) !== String(initialPrice) || date !== initialDate

  // Total invested for capital-gain preview
  const totalInvested = (property?.purchase_price||0)+(property?.refurb_cost||0)+(property?.stamp_duty||0)+(property?.legal_fees||0)
  const numPrice = parseFloat(price) || 0
  const gain = numPrice ? numPrice - totalInvested : 0

  function handleConfirm() {
    if (!numPrice) return
    if (!date)     return
    onConfirm(numPrice, date)
  }

  return (
    <div className="overlay" onClick={safeOverlayClose(isDirty, onClose, confirmDiscard)}>
      <FocusTrap onEscape={() => safeOverlayClose(isDirty, onClose, confirmDiscard)({ target: null, currentTarget: null })}>
      <div className="modal" style={{maxWidth:460}} role="dialog" aria-modal="true" aria-labelledby="sell-property-modal-title">
        <div style={{padding:'28px 28px'}}>
          <h2 id="sell-property-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8,color:T.text}}>Mark as Sold</h2>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,marginBottom:20}}>{property?.name}</p>
          <div style={{marginBottom:14}}>
            <label>Sale Price</label>
            <MoneyInput prefix="£" value={price} onChange={v=>setPrice(v)}
              onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
              placeholder="0" autoFocus/>
          </div>
          <div style={{marginBottom:14}}>
            <label>Sale Date</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}/>
          </div>
          {numPrice > 0 && totalInvested > 0 && (
            <div style={{
              fontFamily:"'DM Mono',monospace",fontSize:11,
              padding:'10px 12px',marginBottom:18,
              background:T.bg,borderRadius:8,
              border:`1px solid ${T.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,color:T.muted}}>
                <span>Total invested</span>
                <span>{fmt(totalInvested)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,color:T.muted}}>
                <span>Sale price</span>
                <span>{fmt(numPrice)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',paddingTop:6,marginTop:4,borderTop:`1px solid ${T.border}`,fontWeight:700,color:gain>=0?T.green:T.red}}>
                <span>Capital gain (gross)</span>
                <span>{gain>=0?'+':''}{fmt(gain)}</span>
              </div>
              <div style={{fontSize:9,color:T.faint,marginTop:8,lineHeight:1.5}}>
                Excludes selling costs (estate agent fees, solicitor) and CGT. For an actual tax figure, consult your accountant.
              </div>
            </div>
          )}
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
            <button disabled={busy||!numPrice||!date} onClick={handleConfirm}
              style={{flex:1,fontFamily:"'DM Mono',monospace",fontWeight:600,background:T.gold,color:'white',border:'none',borderRadius:8,padding:'10px',fontSize:13,cursor:busy?'wait':'pointer',opacity:(!numPrice||!date)?0.5:1}}>
              {busy?'Saving…':'Mark as sold'}
            </button>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
