// Shared presentational bits for the refurb workspace. Same look as
// RefurbsPage.jsx (mono labels, gold primary, card panels).
import { MONO } from '../../lib/styles'
import { STAGE_STATUS_CFG, statusLabel } from '../../lib/refurbWorkspace'

export const mono = MONO
export const fmt = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
export const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const fmtShort = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
export const fmtWhen = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const inputStyle = T => ({ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '7px 9px', outline: 'none', width: '100%', minHeight: 34, boxSizing: 'border-box' })
export const btn = (T, kind = 'ghost') => ({
  fontFamily: mono, fontSize: 11, fontWeight: kind === 'gold' ? 700 : 500, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', minHeight: 32,
  background: kind === 'gold' ? T.gold : 'transparent', color: kind === 'gold' ? '#fff' : kind === 'danger' ? T.red : T.muted,
  border: `1px solid ${kind === 'gold' ? T.gold : kind === 'danger' ? T.red + '66' : T.border}`, whiteSpace: 'nowrap',
})
export const panel = T => ({ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12, minWidth: 0 })
export const label = T => ({ fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 4 })
export const sectionHead = T => ({ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 })

export function Field({ label: text, children, T, hint }) {
  return <div style={{ minWidth: 0 }}>
    <label style={label(T)}>{text}</label>
    {children}
    {hint && <div style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, marginTop: 3 }}>{hint}</div>}
  </div>
}

export function StatusChip({ stage, T }) {
  const c = STAGE_STATUS_CFG[stage?.status] || STAGE_STATUS_CFG.not_started
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.color + '22', color: c.color, border: `1px solid ${c.color}44`, whiteSpace: 'nowrap' }}>{statusLabel(stage)}</span>
}

export function Pill({ children, color, T }) {
  const col = color || T.muted
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: col + '1f', color: col, whiteSpace: 'nowrap' }}>{children}</span>
}

export function Bar({ pct, color, T, height = 6 }) {
  return <div style={{ height, background: T.bg, borderRadius: height / 2, overflow: 'hidden', border: `1px solid ${T.border}` }}>
    <div style={{ width: `${Math.max(0, Math.min(100, Number(pct) || 0))}%`, height: '100%', background: color || T.green, transition: 'width .2s' }} />
  </div>
}

export function Empty({ title, body, action, T }) {
  return <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{title}</div>
    {body && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: action ? 14 : 0 }}>{body}</div>}
    {action}
  </div>
}

/** A headline tile that can be clicked to open the records behind it. */
export function Tile({ label: text, value, sub, onClick, color, T, icon }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag onClick={onClick} style={{ textAlign: 'left', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', color: T.text, display: 'flex', gap: 12, alignItems: 'center', minWidth: 0, width: '100%' }}>
    {icon && <span style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${T.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: T.gold, flexShrink: 0 }}>{icon}</span>}
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'block', fontFamily: mono, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted }}>{text}</span>
      <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: color || T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      {sub && <span style={{ display: 'block', fontFamily: mono, fontSize: 10, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
    </span>
  </Tag>
}
