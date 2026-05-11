import { useState } from 'react'
import * as api from '../lib/api'

// ── ONBOARDING WIZARD ───────────────────────────────────────────────────
// Shown to any signed-in user who has no companies attached to their
// account. Previously this auto-forced them to create a company, which
// caused duplicates whenever a team member signed up intending to join
// an existing company. Now it's a CHOICE GATE with three paths:
//
//   1. Create a new company    — original flow, for solo landlords / new orgs
//   2. Join an existing one    — paste an invite code from someone in the team
//   3. Skip for now            — explore the app, an admin can add them later
//
// We also do a fuzzy name check during creation: if the user types a name
// similar to an existing company, we warn them and suggest asking for an
// invite instead of creating a duplicate.

const COLOURS = ['#C8A84B', '#4B8FE0', '#2ECC8A', '#E05555', '#9B59B6', '#E0943A', '#1ABC9C', '#E74C3C', '#3498DB', '#2C3E50']

const SLATE  = '#2D3C4A'
const BG     = '#F4F3EF'
const WHITE  = '#FFFFFF'
const BORDER = '#DDE1E5'
const MUTED  = '#7A8694'
const GOLD   = '#C8A84B'

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  .ob-input{font-family:'DM Mono',monospace;background:#fff;border:1.5px solid #DDE1E5;color:#2D3C4A;border-radius:10px;padding:12px 14px;width:100%;font-size:14px;outline:none;transition:border-color 0.2s;}
  .ob-input:focus{border-color:#2D3C4A;box-shadow:0 0 0 3px rgba(45,60,74,0.08);}
  .ob-btn{font-family:'DM Mono',monospace;font-weight:600;background:#2D3C4A;color:white;border:none;border-radius:10px;padding:14px 24px;font-size:13px;cursor:pointer;transition:background 0.18s;width:100%;}
  .ob-btn:hover:not(:disabled){background:#1E2C38;}
  .ob-btn:disabled{background:#A3A8AC;cursor:not-allowed;}
  .ob-btn-ghost{background:transparent;border:1.5px solid #DDE1E5;color:#2D3C4A;}
  .ob-btn-ghost:hover:not(:disabled){border-color:#2D3C4A;}
  .ob-btn-gold{background:#C8A84B;color:#1A2530;}
  .ob-btn-gold:hover:not(:disabled){background:#B59736;}
  .ob-choice{font-family:'DM Mono',monospace;background:white;border:1.5px solid #DDE1E5;color:#2D3C4A;border-radius:14px;padding:20px 22px;cursor:pointer;text-align:left;width:100%;transition:border-color 0.18s, transform 0.12s, box-shadow 0.18s;display:block;}
  .ob-choice:hover{border-color:#2D3C4A;transform:translateY(-2px);box-shadow:0 4px 16px rgba(45,60,74,0.10);}
  .ob-choice-title{font-size:14px;font-weight:700;color:#2D3C4A;margin-bottom:4px;letter-spacing:-0.01em;}
  .ob-choice-desc{font-family:'DM Mono',monospace;font-size:11px;color:#7A8694;line-height:1.5;}
  .ob-choice-icon{font-size:24px;margin-bottom:10px;display:block;}
`

export default function OnboardingWizard({ user, onComplete }) {
  // Step state:
  //   'choose'  — initial choice gate
  //   'create'  — creating a new company (original flow)
  //   'join'    — joining via invite code
  //   'done'    — success splash (either path)
  const [step, setStep] = useState('choose')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [successCo, setSuccessCo] = useState('')

  // Create-company state
  const [companyName, setCompanyName] = useState('')
  const [companyAbbr, setCompanyAbbr] = useState('')
  const [companyColor, setCompanyColor] = useState(COLOURS[0])
  const [similarHits, setSimilarHits] = useState([])

  // Join-company state
  const [inviteCode, setInviteCode] = useState('')

  function handleNameChange(val) {
    setCompanyName(val)
    setSimilarHits([])
    if (val.trim()) {
      const words = val.trim().split(/\s+/)
      const abbr = words.length > 1
        ? words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
        : val.slice(0, 4).toUpperCase()
      setCompanyAbbr(abbr)
      // Fuzzy duplicate check — only after 3+ characters
      if (val.trim().length >= 3) {
        api.findCompaniesByNameFuzzy(val.trim())
          .then(hits => setSimilarHits(hits || []))
          .catch(() => {})
      }
    }
  }

  async function handleCreateCompany() {
    if (!companyName.trim() || !companyAbbr.trim()) return
    setSaving(true); setError('')
    try {
      const company = await api.createCompanyForOwner(companyName.trim(), companyAbbr.trim(), companyColor)
      try {
        const sub = companyName.trim()
          .toLowerCase()
          .replace(/\s+(property|group|ltd|limited|co|company|management|properties)\s*/gi, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 30)
        if (sub && company) await api.saveCompanySubdomain(company, sub)
      } catch (e) {}
      setSuccessCo(companyName.trim())
      setStep('done')
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function handleJoinCompany() {
    const code = inviteCode.trim()
    if (!code) return
    setSaving(true); setError('')
    try {
      const result = await api.redeemCompanyInvite(code)
      setSuccessCo(result?.company_name || 'your company')
      setStep('done')
    } catch (e) {
      setError(e.message || 'Could not redeem that invite code')
    }
    setSaving(false)
  }

  function handleSkip() {
    // No company joined. User lands in empty app state and can
    // create or join from Settings later.
    onComplete()
  }

  function handleFinish() {
    onComplete()
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{CSS}</style>
      <div style={{ width: '100%', maxWidth: 520 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo.svg" alt="OwnProperly" style={{ height: 52, width: 'auto' }}/>
        </div>

        {/* ── STEP: CHOOSE ── */}
        {step === 'choose' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>👋</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Welcome to OwnProperly
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              How would you like to get started?
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              <button className="ob-choice" onClick={() => { setError(''); setStep('join') }}>
                <span className="ob-choice-icon">🔑</span>
                <div className="ob-choice-title">Join an existing company</div>
                <div className="ob-choice-desc">
                  Someone in your team has shared an invite code with you. Paste it to join their company instantly.
                </div>
              </button>

              <button className="ob-choice" onClick={() => { setError(''); setStep('create') }}>
                <span className="ob-choice-icon">🏢</span>
                <div className="ob-choice-title">Create a new company</div>
                <div className="ob-choice-desc">
                  You're setting up a fresh property portfolio. Create your company to organise everything under.
                </div>
              </button>

              <button className="ob-choice" onClick={handleSkip}
                style={{ borderStyle: 'dashed', background: 'transparent' }}>
                <span className="ob-choice-icon">⏭</span>
                <div className="ob-choice-title">Skip for now</div>
                <div className="ob-choice-desc">
                  Just exploring? Have a look around. You can create or join a company later from Settings.
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: JOIN EXISTING ── */}
        {step === 'join' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🔑</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Join an existing company
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              Paste the invite code your colleague sent you. It usually looks like <code style={{ background: BG, padding: '2px 6px', borderRadius: 4 }}>ABC-XYZ</code>.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>
                Invite Code *
              </label>
              <input className="ob-input" value={inviteCode}
                onChange={e => { setInviteCode(e.target.value); setError('') }}
                placeholder="e.g. ABC-XYZ" autoFocus
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                onKeyDown={e => { if (e.key === 'Enter' && inviteCode.trim() && !saving) handleJoinCompany() }} />
            </div>

            {error && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              <button className="ob-btn ob-btn-gold" onClick={handleJoinCompany} disabled={saving || !inviteCode.trim()}>
                {saving ? 'Joining…' : 'Join Company →'}
              </button>
              <button className="ob-btn ob-btn-ghost" onClick={() => { setError(''); setStep('choose') }} disabled={saving}>
                ← Back
              </button>
            </div>

            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, marginTop: 20, padding: '12px 14px', background: BG, borderRadius: 8, lineHeight: 1.6 }}>
              <strong style={{ color: SLATE }}>Don't have an invite code?</strong> Ask your colleague to log in and go to <strong>Companies → Access</strong> to create one for you.
            </div>
          </div>
        )}

        {/* ── STEP: CREATE NEW ── */}
        {step === 'create' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🏢</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Create your company
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              Create a company to organise your properties under. You can add more companies later.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Company Name *</label>
              <input className="ob-input" value={companyName} onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Acme Property Group" autoFocus/>
            </div>

            {/* Duplicate warning — surfaces fuzzy matches and gently nudges
                toward joining instead of creating a duplicate. */}
            {similarHits.length > 0 && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#8A6A00', background: '#FFF8E1', border: '1px solid #F2D17A', borderRadius: 8, padding: '10px 14px', marginBottom: 16, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ A company with a similar name already exists:</div>
                <div style={{ marginBottom: 6 }}>
                  {similarHits.map(h => h.name).join(', ')}
                </div>
                <div>
                  Did you mean to <button
                    onClick={() => { setError(''); setStep('join') }}
                    style={{ background: 'none', border: 'none', color: '#8A6A00', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: 0, fontWeight: 700 }}>
                    join an existing company
                  </button> instead? Ask your team for an invite code.
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Short Code * (2–4 letters)</label>
              <input className="ob-input" value={companyAbbr} onChange={e => setCompanyAbbr(e.target.value.toUpperCase().slice(0,4))}
                placeholder="APG" maxLength={4}/>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, marginTop: 5 }}>
                This appears as a badge on your properties
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>Brand Colour</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLOURS.map(col => (
                  <div key={col} onClick={() => setCompanyColor(col)} style={{
                    width: 32, height: 32, borderRadius: 8, background: col, cursor: 'pointer',
                    border: `3px solid ${companyColor === col ? SLATE : 'transparent'}`,
                    transition: 'border 0.15s', boxSizing: 'border-box'
                  }}/>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              <button className="ob-btn" onClick={handleCreateCompany}
                disabled={saving || !companyName.trim() || !companyAbbr.trim()}>
                {saving ? 'Creating…' : 'Create Company →'}
              </button>
              <button className="ob-btn ob-btn-ghost" onClick={() => { setError(''); setStep('choose') }} disabled={saving}>
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: DONE ── */}
        {step === 'done' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '36px 32px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 10 }}>You're all set!</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 8, lineHeight: 1.7 }}>
              You're now part of <strong style={{ color: SLATE }}>{successCo}</strong>.
            </p>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              Head to the dashboard to see your portfolio.
            </p>
            <button className="ob-btn" onClick={handleFinish}>
              Go to Dashboard →
            </button>
          </div>
        )}

        <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 20 }}>
          Signed in as {user?.email}
        </p>
      </div>
    </div>
  )
}
