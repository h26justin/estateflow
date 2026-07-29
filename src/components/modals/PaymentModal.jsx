import { useState } from 'react'
import { MONO } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import FocusTrap from '../../lib/FocusTrap'

export default function PaymentModal({ payment, onClose, onSave }) {
  const { T } = useTheme()
  // Two-step confirm for irreversible status changes. Single-click was
  // dangerous: a tenant or landlord mis-clicking "Not Paid" on a paid
  // month silently corrupted the rent record with no undo. Now we ask
  // for a second click ("Yes, set as X") before firing onSave.
  const [pending, setPending] = useState(null)

  const options = [
    { status:'paid',    label:'Paid',     icon:'✓', color:T.green,  bg:'#0D2B1F', border:'#1A4A2E' },
    { status:'overdue', label:'Not Paid', icon:'✗', color:T.red,    bg:'#2B1010', border:'#5C2C2C' },
    { status:'late',    label:'Late',     icon:'⏱', color:T.amber,  bg:'#2B1A0A', border:'#5C3A1A' },
    { status:'refurb',  label:'Refurb',   icon:'🔨', color:T.blue,   bg:'#0A1A2B', border:'#1A3A5C' },
    { status:'void',    label:'Void',     icon:'○', color:T.faint,  bg:'#1A1D27', border:'#2E3044' },
  ]

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <FocusTrap onEscape={onClose}>
      <div className="modal" style={{maxWidth:380}} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
        <div style={{padding:'24px 28px'}}>
          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Update Payment</div>
          <h2 id="payment-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>{payment.month_label}</h2>
          <div style={{fontFamily:MONO,fontSize:12,color:T.muted,marginBottom:24}}>
            Current status: <span style={{color:payment.status==='paid'?T.green:(payment.status==='overdue'||payment.status==='missed')?T.red:payment.status==='late'?T.amber:T.faint,fontWeight:700}}>{payment.status==='missed'?'overdue':payment.status}</span>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            {options.map(opt=>{
              const isPending = pending === opt.status
              return (
                <button key={opt.status}
                  aria-label={isPending
                    ? `Confirm: set as ${opt.label}`
                    : `Set as ${opt.label} (click twice to confirm)`}
                  onClick={()=>{
                    if (isPending) {
                      onSave(payment, opt.status)
                      setPending(null)
                    } else {
                      setPending(opt.status)
                    }
                  }}
                  style={{
                    fontFamily:MONO,fontWeight:600,fontSize:13,
                    background: isPending ? opt.color : (payment.status===opt.status ? opt.bg : T.surface),
                    color: isPending ? '#fff' : opt.color,
                    border: `2px solid ${isPending || payment.status===opt.status ? opt.color : T.border}`,
                    borderRadius:10, padding:'14px 12px', cursor:'pointer',
                    transition:'all 0.18s', textAlign:'center',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                  }}>
                  <span style={{fontSize:20}}>{opt.icon}</span>
                  {isPending ? 'Confirm?' : opt.label}
                </button>
              )
            })}
          </div>
          {pending && (
            <div role="status" aria-live="polite" style={{fontFamily:MONO,fontSize:11,color:T.amber,textAlign:'center',marginBottom:12}}>
              Click again to confirm — or pick a different status.
            </div>
          )}

          <button className="btn btn-ghost" style={{width:'100%',fontSize:12}} onClick={onClose}>Cancel</button>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
