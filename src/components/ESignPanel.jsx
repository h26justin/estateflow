import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { MONO, FS, SANS } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useLoadGuard } from '../lib/useLoadGuard'
import { EmptyState } from './ui'
import { SkeletonRows } from '../lib/Skeleton'

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
//                 when empty, the property's own documents are loaded).
//                 An envelope must carry a document before it can be sent.
//   T           — theme passthrough

const STATUS_META = {
  draft:    { label: 'Draft',    tone: 'muted' },
  sent:     { label: 'Sent',     tone: 'blue' },
  signed:   { label: 'Signed',   tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  voided:   { label: 'Voided',   tone: 'muted' },
  error:    { label: 'Error',    tone: 'red' },
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
  // Candidate documents: the caller's list, else this property's documents.
  const [ownDocs, setOwnDocs] = useState([])
  useEffect(() => {
    if (documents.length > 0 || !propertyId) return
    let live = true
    supabase.from('property_documents').select('id, name')
      .eq('property_id', propertyId).is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (live) setOwnDocs(data || []) })
      .catch(() => {})
    return () => { live = false }
  }, [documents.length, propertyId])
  const docOptions = documents.length > 0 ? documents : ownDocs

  const beginLoad = useLoadGuard()
  const load = useCallback(async () => {
    const isCurrent = beginLoad()
    try {
      const rows = await api.fetchEsignEnvelopes({ propertyId, companyId })
      if (!isCurrent()) return
      setEnvelopes(rows)
    } catch (e) {
      if (!isCurrent()) return
      showAppToast(e.message || 'Could not load envelopes', 'error')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [beginLoad, propertyId, companyId])

  useEffect(() => { load() }, [load])

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail.trim())
  // A document is required: an envelope with nothing to sign can't be sent.
  const canCreate = !busy && !!documentId && signerName.trim() && emailValid && (propertyId || companyId)

  // Sending goes to a real person's inbox, so it is always confirmed first.
  function confirmSend(name, email, docName) {
    return confirmDialog({
      title: 'Send for signature?',
      body: `${docName ? `"${docName}"` : 'This document'} will be emailed to ${name} <${email}> to sign. Check the name and email address before sending.`,
      confirmLabel: 'Send',
    })
  }

  async function createAndSend() {
    if (!canCreate) return
    const name = signerName.trim(), email = signerEmail.trim()
    const docName = docOptions.find(d => d.id === documentId)?.name
    if (!await confirmSend(name, email, docName)) return
    setBusy(true)
    let env = null
    try {
      env = await api.createEsignEnvelope({
        propertyId, companyId,
        documentId,
        signerName: name,
        signerEmail: email,
      })
    } catch (e) {
      showAppToast(`Could not create envelope: ${e.message || 'unknown error'}`, 'error')
      setBusy(false)
      return
    }
    // The draft exists from here on — report the send separately so a send
    // failure never reads as "nothing was created".
    setSignerName(''); setSignerEmail(''); setDocumentId('')
    try {
      const result = await api.sendEsignEnvelope(env.id)
      if (result.inert) {
        showAppToast('Envelope saved as a draft — awaiting provider setup', 'info')
      } else {
        showAppToast('Sent for signature')
      }
    } catch (e) {
      showAppToast(`Draft envelope saved, but sending failed: ${e.message || 'unknown error'}. You can retry with Send below.`, 'error')
    } finally {
      await load()
      setBusy(false)
    }
  }

  async function resend(id) {
    const env = envelopes.find(x => x.id === id)
    if (env && !env.document_id) {
      showAppToast('This envelope has no document attached, so it can’t be sent. Void it and create a new one with a document.', 'error')
      return
    }
    if (!await confirmSend(env?.signer_name || 'the signer', env?.signer_email || '', docOptions.find(d => d.id === env?.document_id)?.name)) return
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
        <div style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          E-signature
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Send a document for signature</div>
        <div style={{ fontFamily: SANS, fontSize: FS.sm, color: theme.muted, lineHeight: 1.65 }}>
          Pick a document and a signer, then send it for e-signature. Signing is
          provider-agnostic and activates once an e-signing provider is configured.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted }}>Document</span>
          <select value={documentId} onChange={e => setDocumentId(e.target.value)} style={fieldStyle} disabled={docOptions.length === 0}>
            <option value="">{docOptions.length === 0 ? '— Upload a document first —' : '— Choose a document —'}</option>
            {docOptions.map(d => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
          </select>
          {docOptions.length === 0 && (
            <span style={{ fontFamily: SANS, fontSize: FS.sm, color: theme.muted }}>Add the document on the Documents tab, then choose it here.</span>
          )}
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted }}>Signer name</span>
          <input value={signerName} onChange={e => setSignerName(e.target.value)}
            placeholder="Jane Tenant" style={fieldStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted }}>Signer email</span>
          <input value={signerEmail} onChange={e => setSignerEmail(e.target.value)}
            placeholder="jane@example.com" type="email" style={fieldStyle} />
          {signerEmail && !emailValid && (
            <span style={{ fontFamily: SANS, fontSize: FS.sm, color: theme.red }}>Enter a valid email</span>
          )}
        </label>
        <button onClick={createAndSend} disabled={!canCreate}
          style={{
            fontFamily: SANS, fontSize: FS.sm, padding: '9px 14px',
            borderRadius: 6, border: `1px solid ${theme.gold}`,
            background: canCreate ? theme.gold + '22' : theme.surface,
            color: canCreate ? theme.goldText : theme.muted,
            cursor: canCreate ? 'pointer' : 'not-allowed', fontWeight: 700,
            justifySelf: 'start',
          }}>
          {busy ? 'Sending…' : 'Send for signature'}
        </button>
      </div>

      <div style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        Envelopes
      </div>
      {loading ? (
        <SkeletonRows rows={2} height={48}/>
      ) : envelopes.length === 0 ? (
        <EmptyState compact icon="send" title="No envelopes yet"/>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {envelopes.map(env => {
            const m = STATUS_META[env.status] || { label: env.status, tone: 'muted' }
            const meta = { ...m, tone: theme[m.tone] || theme.muted }
            const canAct = env.status === 'draft' || env.status === 'error'
            return (
              <div key={env.id} style={{
                background: theme.bg, border: `1px solid ${theme.border}`,
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: SANS, fontSize: FS.sm, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 4,
                  background: meta.tone + '22', color: meta.tone,
                }}>{meta.label}</span>
                <div style={{ flex: '1 1 180px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{env.signer_name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>{env.signer_email}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: FS.xs, color: theme.muted, whiteSpace: 'nowrap' }}>
                  {fmtDate(env.created_at)}
                </div>
                {canAct && (
                  <>
                    <button onClick={() => resend(env.id)} disabled={busyId === env.id}
                      style={{
                        fontFamily: SANS, fontSize: FS.sm, padding: '6px 10px',
                        borderRadius: 6, border: `1px solid ${theme.gold}`,
                        background: theme.gold + '22', color: theme.goldText,
                        cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                      {busyId === env.id ? '…' : 'Send'}
                    </button>
                    <button onClick={() => voidEnvelope(env.id)} disabled={busyId === env.id}
                      style={{
                        fontFamily: SANS, fontSize: FS.sm, padding: '6px 10px',
                        borderRadius: 6, border: `1px solid ${theme.border}`,
                        background: 'transparent', color: theme.muted,
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                      Void
                    </button>
                  </>
                )}
                {env.error_message && (
                  <div style={{ flex: '1 1 100%', fontFamily: SANS, fontSize: FS.sm, color: theme.red }}>
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
