import { useState, useEffect } from 'react'
import { MONO } from '../../lib/styles'
import * as api from '../../lib/api'
import { showAppToast } from '../../lib/toast'
import { copyToClipboard } from '../../lib/clipboard'

// ── SHAREABLE LINKS TAB ─────────────────────────────────────────────────────
// Lets owners/admins generate shareable invite links (or short codes) for any
// of their companies. Each invite is a row in `company_invites` and can be
// configured with max_uses, expires_at, and is_admin. Shows active invites
// with copy-to-clipboard + revoke. Revoked invites stay in DB for audit but
// disappear from this list.
export function ShareableLinksTab({ companies, showToast, T }) {
  const mono = MONO
  // Group invites by company for the active list
  const [invitesByCompany, setInvitesByCompany] = useState({})
  const [loading, setLoading] = useState(true)

  // Form state for creating a new invite
  const [formCompanyId, setFormCompanyId] = useState(companies[0]?.id || '')
  const [formMaxUses,   setFormMaxUses]   = useState('')   // '' = unlimited
  const [formExpiry,    setFormExpiry]    = useState('7d') // preset key
  // Role joiners get when they redeem this code. Defaults to 'editor' which
  // matches what most "I'm sharing this with my team" cases want.
  const [formRole,      setFormRole]      = useState('editor')
  const [formLabel,     setFormLabel]     = useState('')
  const [creating,      setCreating]      = useState(false)

  // Track which invite was last "copied" so we can show "Copied!" briefly
  const [copiedId, setCopiedId] = useState(null)

  const EXPIRY_OPTIONS = [
    { v: '1d',     l: '1 day' },
    { v: '7d',     l: '7 days' },
    { v: '30d',    l: '30 days' },
    { v: 'never',  l: 'Never expires' },
  ]
  function expiryToTimestamp(key) {
    if (key === 'never') return null
    const days = key === '1d' ? 1 : key === '7d' ? 7 : 30
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString()
  }

  useEffect(() => { loadInvites() }, [])

  async function loadInvites() {
    setLoading(true)
    try {
      const grouped = {}
      for (const co of companies) {
        const list = await api.fetchCompanyInvites(co.id).catch(()=>[])
        grouped[co.id] = list
      }
      setInvitesByCompany(grouped)
    } catch(e) { /* non-fatal */ }
    setLoading(false)
  }

  async function createInvite(e) {
    if (e) e.preventDefault()
    if (!formCompanyId || creating) return
    setCreating(true)
    try {
      const maxUses = formMaxUses === '' ? null : Math.max(1, parseInt(formMaxUses) || 1)
      const expiresAt = expiryToTimestamp(formExpiry)
      const created = await api.createCompanyInvite(formCompanyId, {
        maxUses, expiresAt, role: formRole, label: formLabel.trim()
      })
      // Optimistically update the grouped list
      setInvitesByCompany(prev => ({
        ...prev,
        [formCompanyId]: [created, ...(prev[formCompanyId] || [])]
      }))
      setFormLabel('')
      setFormMaxUses('')
      showToast(`Invite created · code ${created.code}`)
    } catch(e) {
      showToast(e.message || 'Failed to create invite', 'error')
    }
    setCreating(false)
  }

  async function revoke(invite) {
    try {
      await api.revokeCompanyInvite(invite.id)
      setInvitesByCompany(prev => ({
        ...prev,
        [invite.company_id]: (prev[invite.company_id] || []).filter(i => i.id !== invite.id)
      }))
      showToast('Invite revoked')
    } catch(e) {
      showToast(e.message || 'Failed to revoke', 'error')
    }
  }

  function inviteUrl(code) {
    return `${window.location.origin}/?invite=${encodeURIComponent(code)}`
  }

  async function copy(text, id) {
    if (await copyToClipboard(text)) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(c => c === id ? null : c), 1500)
      showAppToast('Copied to clipboard')
    } else {
      // Clipboard blocked (restricted context / old browser). The code and
      // URL are both on screen, so point the user at them instead of a prompt.
      showAppToast('Could not copy automatically — select the invite link or code and copy it manually.', 'error')
    }
  }

  // Format an expiry timestamp as "in 6 days" or "Never"
  function expiryLabel(ts) {
    if (!ts) return 'Never expires'
    const d = new Date(ts)
    const days = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24))
    if (days < 0) return 'Expired'
    if (days === 0) return 'Expires today'
    if (days === 1) return 'Expires tomorrow'
    return `Expires in ${days} days`
  }

  function usesLabel(invite) {
    if (invite.max_uses == null) {
      return `${invite.used_count} ${invite.used_count === 1 ? 'use' : 'uses'}`
    }
    return `${invite.used_count} / ${invite.max_uses} uses`
  }

  const totalActive = Object.values(invitesByCompany).reduce((s, arr) => s + (arr?.length || 0), 0)

  return (
    <>
      {/* Explainer */}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 6 }}>
          🔗 <strong style={{ color: T.text }}>Shareable invite links</strong>
        </div>
        <p style={{ fontFamily: mono, fontSize: 11, color: T.faint, lineHeight: 1.6 }}>
          Generate a link or code that anyone can use to join your company —
          no need to type their email upfront. Useful for inviting via WhatsApp,
          Slack, or in person. Set a usage limit and expiry to keep it secure.
        </p>
      </div>

      {/* Create invite form */}
      <form onSubmit={createInvite}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Generate new invite
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Company</label>
            <select aria-label="Company" value={formCompanyId} onChange={e => setFormCompanyId(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Max uses</label>
            <input aria-label="Max uses" type="number" min={1} placeholder="Unlimited" value={formMaxUses}
              onChange={e => setFormMaxUses(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}/>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Expires</label>
            <select aria-label="Expires" value={formExpiry} onChange={e => setFormExpiry(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}>
              {EXPIRY_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Label (optional)</label>
            <input aria-label="Label (optional)" value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="e.g. WhatsApp share"
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}/>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Role for joiners</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { v: 'viewer', l: 'Viewer',  desc: 'Read-only access' },
              { v: 'editor', l: 'Editor',  desc: 'Edit properties, rent, compliance' },
              { v: 'admin',  l: 'Admin',   desc: 'Editor + manage users & settings' },
            ].map(opt => {
              const active = formRole === opt.v
              return (
                <label key={opt.v}
                  style={{
                    flex: '1 1 140px', cursor: 'pointer',
                    border: `1px solid ${active ? T.gold : T.border}`,
                    background: active ? T.gold + '11' : 'transparent',
                    borderRadius: 8, padding: '8px 12px',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}>
                  <input type="radio" name="formRole" value={opt.v} checked={active}
                    onChange={() => setFormRole(opt.v)}
                    style={{ marginRight: 6, verticalAlign: 'middle' }}/>
                  <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: active ? T.goldText : T.text, verticalAlign: 'middle' }}>
                    {opt.l}
                  </span>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2, marginLeft: 22 }}>
                    {opt.desc}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <button type="submit" disabled={creating || !formCompanyId} className="btn btn-gold" style={{ fontSize: 11 }}>
            {creating ? 'Generating…' : '+ Generate invite'}
          </button>
        </div>
      </form>

      {/* Active invites */}
      {loading
        ? <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, textAlign: 'center', padding: 24 }}>Loading invites…</div>
        : totalActive === 0
          ? <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, textAlign: 'center', padding: 32, background: T.bg, borderRadius: 10 }}>
              No active invites yet. Generate one above to share with your team.
            </div>
          : <div style={{ display: 'grid', gap: 14 }}>
              {companies.map(co => {
                const list = invitesByCompany[co.id] || []
                if (!list.length) return null
                return (
                  <div key={co.id}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      <span style={{ color: co.color || T.goldText }}>{co.abbr}</span> {co.name} · {list.length} active
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {list.map(inv => {
                        const isCopied = copiedId === inv.id
                        const isUrl = inv.code && true  // we always have a code
                        return (
                          <div key={inv.id}
                            style={{ background: T.bg, borderRadius: 10, border: `1px solid ${T.border}`, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '0.05em' }}>
                                  {inv.code}
                                </span>
                                {/* Role badge — colour-coded per role.
                                    Older rows pre-date the `role` column so we
                                    fall back to is_admin → Admin / Editor. */}
                                {(() => {
                                  const role = inv.role || (inv.is_admin ? 'admin' : 'editor')
                                  const meta = {
                                    admin:  { label: 'Admin',  bg: T.gold,  text: T.gold },
                                    editor: { label: 'Editor', bg: T.blue, text: T.blue },
                                    viewer: { label: 'Viewer', bg: T.muted, text: T.muted },
                                  }[role] || { label: role, bg: T.muted, text: T.muted }
                                  return (
                                    <span style={{ fontFamily: mono, fontSize: 9, color: meta.text, background: meta.bg + '22', padding: '2px 6px', borderRadius: 4 }}>
                                      {meta.label}
                                    </span>
                                  )
                                })()}
                                {inv.label && (
                                  <span style={{ fontFamily: mono, fontSize: 10, color: T.faint, fontStyle: 'italic' }}>{inv.label}</span>
                                )}
                              </div>
                              <button onClick={() => revoke(inv)}
                                style={{ fontFamily: mono, fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.red}`, color: T.red, background: T.red + '11' }}>
                                Revoke
                              </button>
                            </div>
                            {/* URL row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <input readOnly value={inviteUrl(inv.code)}
                                onClick={e => e.target.select()}
                                style={{ flex: 1, fontFamily: mono, fontSize: 11, padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, minWidth: 0 }}/>
                              <button onClick={() => copy(inviteUrl(inv.code), inv.id + '-url')}
                                style={{ fontFamily: mono, fontSize: 10, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.border}`, background: copiedId === inv.id + '-url' ? T.green + '22' : 'transparent', color: copiedId === inv.id + '-url' ? T.green : T.text, whiteSpace: 'nowrap' }}>
                                {copiedId === inv.id + '-url' ? 'Copied' : 'Copy URL'}
                              </button>
                              <button onClick={() => copy(inv.code, inv.id + '-code')}
                                style={{ fontFamily: mono, fontSize: 10, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.border}`, background: copiedId === inv.id + '-code' ? T.green + '22' : 'transparent', color: copiedId === inv.id + '-code' ? T.green : T.text, whiteSpace: 'nowrap' }}>
                                {copiedId === inv.id + '-code' ? 'Copied' : 'Copy code'}
                              </button>
                            </div>
                            {/* Status row */}
                            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              <span>{usesLabel(inv)}</span>
                              <span>·</span>
                              <span>{expiryLabel(inv.expires_at)}</span>
                              <span>·</span>
                              <span>Created {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
      }
    </>
  )
}
