import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import FocusTrap from '../lib/FocusTrap'

// Tenant referencing modal.
//
// PRE-PARTNERSHIP STAGE — see /supabase-migrations/2026-05-19_tenant_references.sql
// for context. Submission saves a row in tenant_references but does NOT yet
// hit a third-party API. When we sign a partner contract (Goodlord,
// RentProfile, OpenRent or similar) the "Place order" step will POST to an
// edge function that forwards to their API, updates the row's status and
// stores the partner_reference + result.
//
// We surface the pre-launch state clearly in the UI so users know what
// they're getting today.

const STATUS_LABEL = {
  requested:   'Saved · waiting for our referencing partner to launch',
  submitted:   'Sent to partner',
  in_progress: 'Partner is gathering data',
  complete:    'Reference complete',
  failed:      'Could not complete',
}

const STATUS_COLOR = {
  requested:   '#888EA8',
  submitted:   '#4B8FE0',
  in_progress: '#E0943A',
  complete:    '#2ECC8A',
  failed:      '#E05555',
}

export default function TenantReferenceModal({ property, onClose }) {
  const { T } = useTheme()
  const mono = MONO
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm] = useState({
    tenant_full_name: '',
    tenant_email:     '',
    tenant_phone:     '',
    tenant_dob:       '',
    current_address:  '',
    employer_name:    '',
    monthly_income:   '',
  })

  useEffect(() => {
    if (!property?.id) return
    api.fetchTenantReferences(property.id).then(r => { setHistory(r); setLoading(false) })
      .catch(() => setLoading(false))
  }, [property?.id])

  function update(patch) { setForm(f => ({ ...f, ...patch })) }

  const isValid = form.tenant_full_name.trim().length > 1

  async function submit() {
    if (!isValid) return
    setSaving(true)
    try {
      const fields = {
        ...form,
        monthly_income: form.monthly_income ? Number(form.monthly_income) : null,
        tenant_dob: form.tenant_dob || null,
      }
      const row = await api.createTenantReference(property.id, fields)
      setHistory(prev => [row, ...prev])
      setShowForm(false)
      setForm({
        tenant_full_name: '', tenant_email: '', tenant_phone: '',
        tenant_dob: '', current_address: '', employer_name: '', monthly_income: '',
      })
      showAppToast("Reference request saved. We'll send it to our partner once they're live.")
    } catch(e) {
      showAppToast(e.message || 'Could not save reference request', 'error')
    }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Delete this reference request?')) return
    try {
      await api.deleteTenantReference(id)
      setHistory(prev => prev.filter(r => r.id !== id))
    } catch(e) {
      showAppToast(e.message || 'Could not delete', 'error')
    }
  }

  const inp = {
    fontFamily: mono, fontSize: 13,
    background: T.bg, border: `1px solid ${T.border}`, color: T.text,
    borderRadius: 8, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <FocusTrap onEscape={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} role="dialog" aria-modal="true" aria-labelledby="tenant-reference-modal-title">
        <div style={{ padding: '22px 26px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="tenant-reference-modal-title" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
              Tenant Referencing
            </h2>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
              {property?.name || property?.address || 'Property'}
            </p>
          </div>
          <span style={{
            fontFamily: mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            padding: '4px 9px', borderRadius: 12,
            background: T.amber + '22', color: T.amber, border: `1px solid ${T.amber}44`,
            flexShrink: 0,
          }}>EARLY ACCESS</span>
        </div>

        <div style={{ padding: '14px 26px 22px' }}>
          {/* Pre-launch note */}
          <div style={{
            background: T.amber + '11', border: `1px solid ${T.amber}44`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 16,
            fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.65,
          }}>
            <strong>Coming soon.</strong> We're finalising a partnership with a
            UK referencing provider (credit check, employer verification,
            previous landlord check). Submit a reference request now and we'll
            run it through our partner as soon as the integration goes live —
            you'll be notified at the email on your account.
          </div>

          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="btn btn-gold" style={{ width: '100%', fontSize: 12, padding: '10px 18px', marginBottom: 16 }}>
              + Request a reference
            </button>
          )}

          {showForm && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={lbl}>Tenant full name *</label>
                  <input style={inp} value={form.tenant_full_name}
                    onChange={e => update({ tenant_full_name: e.target.value })}
                    placeholder="As it appears on their ID" autoFocus/>
                </div>
                <div>
                  <label style={lbl}>Email</label>
                  <input style={inp} type="email" value={form.tenant_email}
                    onChange={e => update({ tenant_email: e.target.value })}/>
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input style={inp} type="tel" value={form.tenant_phone}
                    onChange={e => update({ tenant_phone: e.target.value })}/>
                </div>
                <div>
                  <label style={lbl}>Date of birth</label>
                  <input style={inp} type="date" value={form.tenant_dob}
                    onChange={e => update({ tenant_dob: e.target.value })}/>
                </div>
                <div>
                  <label style={lbl}>Monthly income (gross)</label>
                  <input style={inp} type="number" value={form.monthly_income}
                    onChange={e => update({ monthly_income: e.target.value })}
                    placeholder="£" inputMode="decimal"/>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={lbl}>Current address</label>
                  <input style={inp} value={form.current_address}
                    onChange={e => update({ current_address: e.target.value })}/>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={lbl}>Employer name</label>
                  <input style={inp} value={form.employer_name}
                    onChange={e => update({ employer_name: e.target.value })}/>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={submit} disabled={!isValid || saving}
                  className="btn btn-gold" style={{ fontSize: 12, padding: '9px 18px', opacity: isValid ? 1 : 0.5, cursor: isValid && !saving ? 'pointer' : 'not-allowed' }}>
                  {saving ? 'Saving…' : 'Save request'}
                </button>
                <button onClick={() => setShowForm(false)} disabled={saving}
                  style={{ fontFamily: mono, fontSize: 12, padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* History */}
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Reference requests
          </div>
          {loading ? (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>
              No reference requests yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {history.map(r => (
                <div key={r.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 3 }}>
                      {r.tenant_full_name}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 6 }}>
                      {r.tenant_email || '—'}
                      {r.employer_name && ` · ${r.employer_name}`}
                      {r.monthly_income && ` · £${Number(r.monthly_income).toLocaleString()}/mo`}
                    </div>
                    <span style={{
                      fontFamily: mono, fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 10,
                      background: (STATUS_COLOR[r.status] || T.muted) + '22',
                      color: STATUS_COLOR[r.status] || T.muted,
                    }}>{STATUS_LABEL[r.status] || r.status}</span>
                  </div>
                  <button onClick={() => remove(r.id)}
                    aria-label="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, fontSize: 14, padding: 4 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 18px' }}>Close</button>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
