import { useEffect, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

const fmtDate = (d) => {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '' }
}

// ── E-SIGN PANEL (SCAFFOLD, flag: esign) ─────────────────────────────────
// Pick a property document + a signer, then "Send for signature". Sending is
// INERT until a provider key (ESIGN_PROVIDER_API_KEY) is configured on the
// esign-envelope edge function — until then "Send for signature" creates the
// draft envelope and shows an "awaiting provider setup" notice rather than
// reaching any external API. Below the form, existing envelopes and their
// status are tracked.
//
// Props:
//   propertyId  — the property the document belongs to (required for create)
//   companyId   — fallback scope when there is no property (optional)
//   documents   — [{ id, name }] candidate documents to send (optional;
//                 a freeform "no document" envelope is allowed)
//   T           — theme passthrough

const STATUS_META = {
  draft:    { label: 'Draft',    tone: '#9ca3af' },
  sent:     { label: 'Sent',     tone: '#3b82f6' },
  signed:   { label: 'Signed',   tone: '#22c55e' },
  declined: { label: 'Declined', tone: '#ef4444' },
  voided:   { label: 'Voided',   tone: '#9ca3af' },
  error:    { label: 'Error',    tone: '#ef4444' },
}

export default function ESignPanel({ propertyId, companyId, documents = [], T }) {
  const themeContext = useTheme()
  const theme = T || themeContext.T
  const confirmDialog = useConfirm()
  const [envelopes, setEnvelopes] = useState([])
  const [loading, setLoading]     = useState(true)
  const [documentId, setDocumentId] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    try {
      const rows = await api.fetchEsignEnvelopes({ propertyId, companyId })
      setEnvelopes(rows)
    } catch (e) {
      showAppToast(e.message || 'Could not load envelopes', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId, companyId])

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail.trim())
  const canCreate = !busy && signerName.trim() && emailValid && (propertyId || companyId)

  async function createAndSend() {
    if (!canCreate) return
    setBusy(true)
    try {
      const env = await api.createEsignEnvelope({
        propertyId, companyId,
        documentId: documentId || null,
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
      })
      const result = await api.sendEsignEnvelope(env.id)
      if (result.inert) {
        showAppToast('Envelope saved as a draft — awaiting provider setup', 'info')
      } else {
        showAppToast('Sent for signature')
      }
      setSignerName(''); setSignerEmail(''); setDocumentId('')
      await load()
    } catch (e) {
      showAppToast(e.message || 'Could not create envelope', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resend(id) {
    setBusyId(id)
    try {
      const result = await api.sendEsignEnvelope(id)
      showAppToast(result.inert ? 'Still awaiting provider setup' : 'Sent for signature',
        result.inert ? 'info' : undefined)
      await load()
    } catch (e) {
      showAppToast(e.message || 'Send failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function voidEnvelope(id) {
    if (!await confirmDialog({
      title: 'Void this envelope?',
      body: 'It will be cancelled and can no longer be sent for signature.',
      confirmLabel: 'Void',
      destructive: true,
    })) return
    setBusyId(id)
    try {
      await api.voidEsignEnvelope(id)
      showAppToast('Envelope voided')
      await load()
    } catch (e) {
      showAppToast(e.message || 'Could not void', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const fieldStyle = {
    fontFamily: MONO, fontSize: 12, color: theme.text,
    background: theme.surface, padding: '8px 10px',
    borderRadius: 6, border: `1px solid ${theme.border}`, width: '100%',
  }

  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          E-signature
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Send a document for signature</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted, lineHeight: 1.65 }}>
          Pick a document and a signer, then send it for e-signature. Signing is
          provider-agnostic and activates once an e-signing provider is configured.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {documents.length > 0 && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: theme.muted }}>Document</span>
            <select value={documentId} onChange={e => setDocumentId(e.target.value)} style={fieldStyle}>
              <option value="">— No document (placeholder envelope) —</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: theme.muted }}>Signer name</span>
          <input value={signerName} onChange={e => setSignerName(e.target.value)}
            placeholder="Jane Tenant" style={fieldStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: theme.muted }}>Signer email</span>
          <input value={signerEmail} onChange={e => setSignerEmail(e.target.value)}
            placeholder="jane@example.com" type="email" style={fieldStyle} />
          {signerEmail && !emailValid && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: '#ef4444' }}>Enter a valid email</span>
          )}
        </label>
        <button onClick={createAndSend} disabled={!canCreate}
          style={{
            fontFamily: MONO, fontSize: 12, padding: '9px 14px',
            borderRadius: 6, border: `1px solid ${theme.gold}`,
            background: canCreate ? theme.gold + '22' : theme.surface,
            color: canCreate ? theme.gold : theme.muted,
            cursor: canCreate ? 'pointer' : 'not-allowed', fontWeight: 700,
            justifySelf: 'start',
          }}>
          {busy ? 'Sending…' : 'Send for signature'}
        </button>
      </div>

      <div style={{ fontFamily: MONO, fontSize: 10, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        Envelopes
      </div>
      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>Loading…</div>
      ) : envelopes.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>No envelopes yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {envelopes.map(env => {
            const meta = STATUS_META[env.status] || { label: env.status, tone: theme.muted }
            const canAct = env.status === 'draft' || env.status === 'error'
            return (
              <div key={env.id} style={{
                background: theme.bg, border: `1px solid ${theme.border}`,
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: MONO, fontSize: 10, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 4,
                  background: meta.tone + '22', color: meta.tone,
                }}>{meta.label}</span>
                <div style={{ flex: '1 1 180px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{env.signer_name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>{env.signer_email}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: theme.muted, whiteSpace: 'nowrap' }}>
                  {fmtDate(env.created_at)}
                </div>
                {canAct && (
                  <>
                    <button onClick={() => resend(env.id)} disabled={busyId === env.id}
                      style={{
                        fontFamily: MONO, fontSize: 11, padding: '6px 10px',
                        borderRadius: 6, border: `1px solid ${theme.gold}`,
                        background: theme.gold + '22', color: theme.gold,
                        cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                      {busyId === env.id ? '…' : 'Send'}
                    </button>
                    <button onClick={() => voidEnvelope(env.id)} disabled={busyId === env.id}
                      style={{
                        fontFamily: MONO, fontSize: 11, padding: '6px 10px',
                        borderRadius: 6, border: `1px solid ${theme.border}`,
                        background: 'transparent', color: theme.muted,
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                      Void
                    </button>
                  </>
                )}
                {env.error_message && (
                  <div style={{ flex: '1 1 100%', fontFamily: MONO, fontSize: 10, color: '#ef4444' }}>
                    {env.error_message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
