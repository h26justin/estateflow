import { useState, useEffect } from 'react'
import { MONO } from '../../lib/styles'
import * as api from '../../lib/api'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { logError } from '../../lib/logError'

// ── AUDIT LOG PANEL ───────────────────────────────────────────────────────────
export function AuditLogPanel({ user, companies, T }) {
  const mono = MONO
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')

  const beginLoad = useLoadGuard()
  useEffect(() => { loadLogs() }, [companyFilter])

  async function loadLogs() {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const data = await api.fetchAuditLog(user?.id, companyFilter||null)
      if (!isCurrent()) return
      setLogs(data)
    } catch(e) {
      if (!isCurrent()) return
      logError('AuditLogPanel:loadLogs', e)
    }
    setLoading(false)
  }

  const ACTION_LABELS = {
    'property.created':            { label: 'Property added',       color: '#2ECC8A' },
    'property.deleted':            { label: 'Property deleted',     color: '#E05555' },
    'property.restored':           { label: 'Property restored',    color: '#4B8FE0' },
    'property.updated':            { label: 'Property updated',     color: '#C8A84B' },
    'rent.paid':                   { label: 'Rent marked paid',     color: '#2ECC8A' },
    'rent.updated':                { label: 'Rent updated',         color: '#C8A84B' },
    'compliance.added':            { label: 'Certificate added',    color: '#2ECC8A' },
    'compliance.expired':          { label: 'Certificate expired',  color: '#E05555' },
    'compliance.deleted':          { label: 'Certificate deleted',  color: '#E05555' },
    'expense.created':             { label: 'Expense added',        color: '#2ECC8A' },
    'expense.deleted':             { label: 'Expense deleted',      color: '#E05555' },
    'deal.created':                { label: 'Deal created',         color: '#C8A84B' },
    'deal.deleted':                { label: 'Deal deleted',         color: '#E05555' },
    'deal.updated':                { label: 'Deal updated',         color: '#C8A84B' },
    'tenancy.created':             { label: 'Tenancy added',        color: '#2ECC8A' },
    'tenancy.updated':             { label: 'Tenancy updated',      color: '#C8A84B' },
    'user.login':                  { label: 'Signed in',            color: '#4B8FE0' },
    'user.logout':                 { label: 'Signed out',           color: '#888EA8' },
    'company.created':             { label: 'Company created',      color: '#2ECC8A' },
    'company.updated':             { label: 'Company updated',      color: '#C8A84B' },
    'company.deleted':             { label: 'Company deleted',      color: '#E05555' },
    'user_company_access.created': { label: 'Access granted',       color: '#2ECC8A' },
    'user_company_access.deleted': { label: 'Access revoked',       color: '#E05555' },
    'user_company_access.updated': { label: 'Access updated',       color: '#C8A84B' },
    'invite.created':              { label: 'Invite sent',          color: '#4B8FE0' },
    'invite.redeemed':             { label: 'Invite redeemed',      color: '#2ECC8A' },
    'subscription.created':        { label: 'Subscription started', color: '#2ECC8A' },
    'subscription.updated':        { label: 'Subscription changed', color: '#C8A84B' },
    'subscription.canceled':       { label: 'Subscription cancelled', color: '#E05555' },
    'document.uploaded':           { label: 'Document uploaded',    color: '#4B8FE0' },
    'document.deleted':            { label: 'Document deleted',     color: '#E05555' },
    'maintenance.created':         { label: 'Maintenance job',      color: '#C8A84B' },
    'inspection.created':          { label: 'Inspection scheduled', color: '#4B8FE0' },
  }

  // Neutralise CSV formula injection: a cell starting with = + - @ or a tab
  // executes as a formula in Excel/Sheets. Prefix a quote unless the value is
  // purely numeric.
  function csvSafe(v) {
    const s = String(v == null ? '' : v)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) return "'" + s
    return s
  }

  function exportAuditCSV() {
    const rows = [
      ['Date', 'Action', 'Entity', 'Details'],
      ...logs.map(l => [
        new Date(l.created_at).toLocaleString('en-GB'),
        ACTION_LABELS[l.action]?.label || l.action,
        l.entity_name || l.entity_type || '—',
        JSON.stringify(l.metadata || {}),
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${csvSafe(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = 'ownproperly-audit-log.csv'; a.click()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 4 }}>Activity audit log</h3>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>A record of all significant actions taken in your account</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {companies.length > 1 && (
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              style={{ fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '7px 12px' }}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={exportAuditCSV} style={{ fontFamily: mono, fontSize: 11, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
            ↓ Export
          </button>
        </div>
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr 1fr', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
          {['Date & time', 'Action', 'Item', 'Details'].map(h => (
            <div key={h} style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>Loading audit log…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No activity recorded yet. Actions you take in Properly will appear here.</div>
        ) : (
          logs.map(log => {
            const cfg = ACTION_LABELS[log.action] || { label: log.action, color: T.muted }
            return (
              <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '85px minmax(150px, 200px) minmax(0, 1.5fr) minmax(0, 2fr)', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                  {new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  <br/>
                  {new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ minWidth: 0 }}>
                  {/* inline-block + max-width so long labels truncate inside their column
                      instead of overlapping into the entity column */}
                  <span style={{ display: 'inline-block', maxWidth: '100%', fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box' }}
                    title={log.action}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={log.entity_name || log.entity_type || ''}>
                  {log.entity_name || log.entity_type || '—'}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={log.metadata && Object.keys(log.metadata).length > 0 ? JSON.stringify(log.metadata) : ''}>
                  {log.metadata && Object.keys(log.metadata).length > 0 ? JSON.stringify(log.metadata) : '—'}
                </div>
              </div>
            )
          })
        )}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 10 }}>{logs.length} events · Last 100 shown</div>
    </div>
  )
}
