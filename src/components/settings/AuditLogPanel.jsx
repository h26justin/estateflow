import { useState, useEffect, useCallback } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { logError } from '../../lib/logError'
import { SkeletonRows } from '../../lib/Skeleton'
import { EmptyState } from '../ui'

// ── AUDIT LOG PANEL ───────────────────────────────────────────────────────────
export function AuditLogPanel({ user, companies, T }) {
  const mono = MONO
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')

  const beginLoad = useLoadGuard()

  const loadLogs = useCallback(async () => {
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
  }, [beginLoad, user?.id, companyFilter])
  useEffect(() => { loadLogs() }, [loadLogs])

  const ACTION_LABELS = {
    'property.created':            { label: 'Property added',       color: T.green },
    'property.deleted':            { label: 'Property deleted',     color: T.red },
    'property.restored':           { label: 'Property restored',    color: T.blue },
    'property.updated':            { label: 'Property updated',     color: T.goldText },
    'rent.paid':                   { label: 'Rent marked paid',     color: T.green },
    'rent.updated':                { label: 'Rent updated',         color: T.goldText },
    'compliance.added':            { label: 'Certificate added',    color: T.green },
    'compliance.expired':          { label: 'Certificate expired',  color: T.red },
    'compliance.deleted':          { label: 'Certificate deleted',  color: T.red },
    'expense.created':             { label: 'Expense added',        color: T.green },
    'expense.deleted':             { label: 'Expense deleted',      color: T.red },
    'deal.created':                { label: 'Deal created',         color: T.goldText },
    'deal.deleted':                { label: 'Deal deleted',         color: T.red },
    'deal.updated':                { label: 'Deal updated',         color: T.goldText },
    'tenancy.created':             { label: 'Tenancy added',        color: T.green },
    'tenancy.updated':             { label: 'Tenancy updated',      color: T.goldText },
    'user.login':                  { label: 'Signed in',            color: T.blue },
    'user.logout':                 { label: 'Signed out',           color: T.muted },
    'company.created':             { label: 'Company created',      color: T.green },
    'company.updated':             { label: 'Company updated',      color: T.goldText },
    'company.deleted':             { label: 'Company deleted',      color: T.red },
    'user_company_access.created': { label: 'Access granted',       color: T.green },
    'user_company_access.deleted': { label: 'Access revoked',       color: T.red },
    'user_company_access.updated': { label: 'Access updated',       color: T.goldText },
    'invite.created':              { label: 'Invite sent',          color: T.blue },
    'invite.redeemed':             { label: 'Invite redeemed',      color: T.green },
    'subscription.created':        { label: 'Subscription started', color: T.green },
    'subscription.updated':        { label: 'Subscription changed', color: T.goldText },
    'subscription.canceled':       { label: 'Subscription cancelled', color: T.red },
    'document.uploaded':           { label: 'Document uploaded',    color: T.blue },
    'document.deleted':            { label: 'Document deleted',     color: T.red },
    'maintenance.created':         { label: 'Maintenance job',      color: T.goldText },
    'inspection.created':          { label: 'Inspection scheduled', color: T.blue },
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
          <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted }}>A record of all significant actions taken in your account</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {companies.length > 1 && (
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              style={{ fontFamily: SANS, fontSize: FS.sm, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '7px 12px' }}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={exportAuditCSV} style={{ fontFamily: SANS, fontSize: FS.sm, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
            ↓ Export
          </button>
        </div>
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr 1fr', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
          {['Date & time', 'Action', 'Item', 'Details'].map(h => (
            <div key={h} style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <SkeletonRows rows={5} height={44}/>
        ) : logs.length === 0 ? (
          <EmptyState compact icon="clock" title="No activity recorded yet" body="Actions you take in Properly will appear here."/>
        ) : (
          logs.map(log => {
            const cfg = ACTION_LABELS[log.action] || { label: log.action, color: T.muted }
            return (
              <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '85px minmax(150px, 200px) minmax(0, 1.5fr) minmax(0, 2fr)', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>
                  {new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  <br/>
                  {new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ minWidth: 0 }}>
                  {/* inline-block + max-width so long labels truncate inside their column
                      instead of overlapping into the entity column */}
                  <span style={{ display: 'inline-block', maxWidth: '100%', fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box' }}
                    title={log.action}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={log.entity_name || log.entity_type || ''}>
                  {log.entity_name || log.entity_type || '—'}
                </div>
                <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
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
