import { useState } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../../lib/icons'
import { Button, Modal } from '../ui'

export default function PaymentModal({ payment, onClose, onSave }) {
  const { T } = useTheme()
  // Two-step confirm for irreversible status changes. Single-click was
  // dangerous: a tenant or landlord mis-clicking "Not Paid" on a paid
  // month silently corrupted the rent record with no undo. Now we ask
  // for a second click ("Yes, set as X") before firing onSave.
  const [pending, setPending] = useState(null)

  const options = [
    { status:'paid',    label:'Paid',     icon:'check',  color:T.green },
    { status:'overdue', label:'Not Paid', icon:'x',      color:T.red   },
    { status:'late',    label:'Late',     icon:'clock',  color:T.amber },
    { status:'refurb',  label:'Refurb',   icon:'hammer', color:T.blue  },
    { status:'void',    label:'Void',     icon:'○',      color:T.faint },
  ]

  return (
    <Modal onClose={onClose} size="sm" title={`Update payment: ${payment.month_label}`}
      description={<>Current status: <span style={{color:payment.status==='paid'?T.green:(payment.status==='overdue'||payment.status==='missed')?T.red:payment.status==='late'?T.amber:T.faint,fontWeight:700}}>{payment.status==='missed'?'overdue':payment.status}</span></>}
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
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
                    fontFamily:SANS,fontWeight:600,fontSize:FS.base,
                    background: isPending ? opt.color : (payment.status===opt.status ? opt.color + '1A' : T.surface),
                    color: isPending ? '#fff' : opt.color,
                    border: `2px solid ${isPending || payment.status===opt.status ? opt.color : T.border}`,
                    borderRadius:10, padding:'14px 12px', cursor:'pointer',
                    transition:'all 0.18s', textAlign:'center',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                  }}>
                  <span aria-hidden="true" style={{fontSize:20,display:'flex',lineHeight:1}}>{ICON_NAMES.includes(opt.icon) ? <Icon name={opt.icon} size={20}/> : opt.icon}</span>
                  {isPending ? 'Confirm?' : opt.label}
                </button>
              )
            })}
          </div>
          {pending && (
            <div role="status" aria-live="polite" style={{fontFamily:SANS,fontSize:FS.sm,color:T.amber,textAlign:'center',marginTop:12}}>
              Click again to confirm — or pick a different status.
            </div>
          )}
      </Modal>
  )
}
