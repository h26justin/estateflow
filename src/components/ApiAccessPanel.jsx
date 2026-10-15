// Personal API access tokens panel.
//
// Rendered inside Settings → Security & Data. Lets the user mint a
// read-only token that external tools they trust (e.g. a Claude session)
// can use to reference their portfolio via the api-access edge function.
//
// The token plaintext is shown ONCE at creation — only a SHA-256 hash is
// stored server-side — so the panel keeps the fresh token on screen with a
// copy button until dismissed. Revocation is immediate and permanent.

import { useEffect, useState } from 'react'
import { MONO, FS } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import { useConfirm } from '../lib/ConfirmContext'
import { listApiTokens, createApiToken, revokeApiToken } from '../lib/api/apiAccess'
import { Skeleton } from '../lib/Skeleton'
import { ensureAal2, isMfaRequiredError, totpPrompt } from '../lib/mfaStepUp'

const EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

const mono = MONO

export default function ApiAccessPanel({ T }) {
  const confirmDialog = useConfirm()

  const [loading, setLoading]   = useState(true)
  const [tokens, setTokens]     = useState([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [freshToken, setFreshToken] = useState(null) // { token, name } shown once
  const [busy, setBusy]         = useState(null)     // 'revoke-<id>' while revoking
  const [expiryDays, setExpiryDays] = useState(90)
  const [mfaError, setMfaError] = useState('')

  async function load() {
    try {
      const { tokens } = await listApiTokens()
      setTokens(tokens || [])
    } catch (e) {
      // Pre-deploy of the api-access function this 404s — don't break Settings.
      console.error('listApiTokens', e)
      setTokens([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Minting needs an aal2 session when the account has 2FA. Step up first
  // (no-op without a factor or when already aal2), and if the server still
  // says mfa_required (e.g. the prompt was skipped) explain inline.
  async function handleCreate() {
    setCreating(true)
    setMfaError('')
    try {
      const step = await ensureAal2(totpPrompt(confirmDialog,
        'Creating an API token needs your authenticator code. Enter the 6-digit code to continue.'))
      if (step === 'cancelled') {
        setMfaError('Two-factor verification is required to create a token.')
        return
      }
      const res = await createApiToken({ name: newName.trim() || 'Claude', expiresInDays: expiryDays })
      setFreshToken({ token: res.token, name: res.name })
      setNewName('')
      await load()
    } catch (e) {
      if (isMfaRequiredError(e)) {
        setMfaError('Two-factor verification is required to create a token. Click Create token again and enter your authenticator code.')
      } else {
        showAppToast(e.message || 'Failed to create token', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(tok) {
    const ok = await confirmDialog({
      title: 'Revoke API token?',
      body: `"${tok.name}" (${tok.token_prefix}…) will stop working immediately. This cannot be undone.`,
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (!ok) return
    setBusy(`revoke-${tok.id}`)
    try {
      await revokeApiToken(tok.id)
      showAppToast('Token revoked')
      await load()
    } catch (e) {
      showAppToast(e.message || 'Failed to revoke token', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function copyFresh() {
    try {
      await navigator.clipboard.writeText(freshToken.token)
      showAppToast('Token copied to clipboard')
    } catch {
      showAppToast('Copy failed — select the token text manually', 'error')
    }
  }

  const active = tokens.filter(t => !t.revoked_at)
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, marginBottom: 20 }}>
      <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        API Access
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.7, marginBottom: 16 }}>
        Personal tokens give <span style={{ color: T.text }}>read-only</span> access to your portfolio data
        (properties, rent, expenses, compliance, maintenance) for tools you trust — for example a Claude
        session referencing your numbers. Tokens can't change anything, and you can revoke them here at any time.
        Changing your password revokes every token. If you use two-factor authentication you'll be asked for a code.
      </div>

      {freshToken && (
        <div style={{ border: `1px solid ${T.gold}`, background: T.gold + '11', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.text, fontWeight: 700, marginBottom: 6 }}>
            Token created — copy it now
          </div>
          <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, marginBottom: 10 }}>
            This is the only time it will be shown. Store it somewhere safe.
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.text, wordBreak: 'break-all', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            {freshToken.token}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold" style={{ fontSize: 11 }} onClick={copyFresh}>Copy token</button>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setFreshToken(null)}>Done — I've saved it</button>
          </div>
        </div>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 8 }}><Skeleton h={14}/><Skeleton h={14} w="80%"/><Skeleton h={14} w="60%"/></div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {active.map(tok => (
                <div key={tok.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      {tok.name} <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>({tok.token_prefix}…)</span>
                    </div>
                    <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, marginTop: 2 }}>
                      Created {fmtDate(tok.created_at)}
                      {' · '}Last used {tok.last_used_at ? fmtDate(tok.last_used_at) : 'never'}
                      {tok.expires_at ? ` · Expires ${fmtDate(tok.expires_at)}` : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, color: T.red, flexShrink: 0 }}
                    disabled={busy === `revoke-${tok.id}`}
                    onClick={() => handleRevoke(tok)}
                  >
                    {busy === `revoke-${tok.id}` ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {active.length === 0 && !freshToken && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 16 }}>No active tokens.</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Token name (e.g. Claude)"
              style={{ maxWidth: 240 }}
            />
            <select aria-label="Token expiry" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))}
              style={{ fontFamily: mono, fontSize: 11 }}>
              {EXPIRY_OPTIONS.map(o => <option key={o.days} value={o.days}>Expires in {o.label}</option>)}
            </select>
            <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={creating} onClick={handleCreate}>
              {creating ? 'Creating…' : 'Create token'}
            </button>
          </div>
          {mfaError && (
            <div role="alert" style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 10 }}>
              {mfaError}
            </div>
          )}
        </>
      )}
    </div>
  )
}
