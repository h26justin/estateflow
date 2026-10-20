import { useState } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import MoneyInput from '../../lib/MoneyInput'
import { useConfirm } from '../../lib/ConfirmContext'
import { fmt } from '../../lib/format'
import { Button, Modal } from '../ui'

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
    <Modal onClose={onClose} size="sm" labelledBy="sell-property-modal-title" isDirty={isDirty} confirmFn={confirmDiscard}>
        <div style={{padding:'28px 28px'}}>
          <h2 id="sell-property-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8,color:T.text}}>Mark as sold</h2>
          <p style={{fontFamily:SANS,color:T.muted,fontSize:FS.sm,marginBottom:20}}>{property?.name}</p>
          <div style={{marginBottom:14}}>
            <label>Sale price</label>
            <MoneyInput aria-label="Sale Price" prefix="£" value={price} onChange={v=>setPrice(v)}
              onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
              placeholder="0" autoFocus/>
          </div>
          <div style={{marginBottom:14}}>
            <label>Sale date</label>
            <input aria-label="Sale Date" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
          </div>
          {numPrice > 0 && totalInvested > 0 && (
            <div style={{
              fontFamily:MONO,fontSize:11,
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
              <div style={{fontSize:FS.xs,color:T.faint,marginTop:8,lineHeight:1.5}}>
                Excludes selling costs (estate agent fees, solicitor) and CGT. For an actual tax figure, consult your accountant.
              </div>
            </div>
          )}
          <div style={{display:'flex',gap:10}}>
            <Button variant="secondary" onClick={onClose} style={{flex:1}}>Cancel</Button>
            <Button disabled={busy||!numPrice||!date} onClick={handleConfirm} style={{flex:1}}>
              {busy?'Saving…':'Mark as sold'}
            </Button>
          </div>
        </div>
      </Modal>
  )
}
