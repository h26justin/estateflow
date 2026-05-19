import { useTheme } from '../../lib/ThemeContext'

export default function PaymentModal({ payment, onClose, onSave }) {
  const { T } = useTheme()

  const options = [
    { status:'paid',    label:'Paid',     icon:'✓', color:T.green,  bg:'#0D2B1F', border:'#1A4A2E' },
    { status:'missed',  label:'Not Paid', icon:'✗', color:T.red,    bg:'#2B1010', border:'#5C2C2C' },
    { status:'late',    label:'Late',     icon:'⏱', color:T.amber,  bg:'#2B1A0A', border:'#5C3A1A' },
    { status:'refurb',  label:'Refurb',   icon:'🔨', color:T.blue,   bg:'#0A1A2B', border:'#1A3A5C' },
    { status:'void',    label:'Void',     icon:'○', color:T.faint,  bg:'#1A1D27', border:'#2E3044' },
  ]

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:380}}>
        <div style={{padding:'24px 28px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Update Payment</div>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>{payment.month_label}</h2>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted,marginBottom:24}}>
            Current status: <span style={{color:payment.status==='paid'?T.green:payment.status==='missed'?T.red:payment.status==='late'?T.amber:T.faint,fontWeight:700}}>{payment.status}</span>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            {options.map(opt=>(
              <button key={opt.status}
                onClick={()=>onSave(payment, opt.status)}
                style={{
                  fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:13,
                  background: payment.status===opt.status ? opt.bg : T.surface,
                  color: opt.color,
                  border: `2px solid ${payment.status===opt.status ? opt.color : T.border}`,
                  borderRadius:10, padding:'14px 12px', cursor:'pointer',
                  transition:'all 0.18s', textAlign:'center',
                  display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                }}>
                <span style={{fontSize:20}}>{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost" style={{width:'100%',fontSize:12}} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
