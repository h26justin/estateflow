import { useState } from 'react'
import * as api from '../lib/api'

const COLOURS = ['#C8A84B','#4B8FE0','#2ECC8A','#E05555','#9B59B6','#E0943A','#1ABC9C','#E74C3C','#3498DB','#2C3E50']

const SLATE = '#2D3C4A'
const BG    = '#F4F3EF'
const WHITE = '#FFFFFF'
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
`

export default function OnboardingWizard({ user, onComplete }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1: Company details
  const [companyName, setCompanyName] = useState('')
  const [companyAbbr, setCompanyAbbr] = useState('')
  const [companyColor, setCompanyColor] = useState(COLOURS[0])

  // Auto-generate abbr from name
  function handleNameChange(val) {
    setCompanyName(val)
    if (val.trim()) {
      const words = val.trim().split(/\s+/)
      const abbr = words.length > 1
        ? words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
        : val.slice(0, 4).toUpperCase()
      setCompanyAbbr(abbr)
    }
  }

  async function handleCreateCompany() {
    if (!companyName.trim() || !companyAbbr.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.createCompanyForOwner(companyName.trim(), companyAbbr.trim(), companyColor)
      setStep(2)
    } catch(e) {
      setError(e.message)
    }
    setSaving(false)
  }

  function handleFinish() {
    onComplete()
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{CSS}</style>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <img src="/logo.svg" alt="OwnProperly" style={{ height: 52, width: 'auto' }}/>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
          {[1,2].map(s => (
            <div key={s} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: step >= s ? SLATE : BORDER,
              transition: 'background 0.3s'
            }}/>
          ))}
        </div>

        {/* ── STEP 1: Create company ── */}
        {step === 1 && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '36px 32px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🏢</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 6 }}>Set up your first company</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 28, lineHeight: 1.6 }}>
              Create a company to organise your properties under. You can add more companies later.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Company Name *</label>
              <input className="ob-input" value={companyName} onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Acme Property Group" autoFocus/>
            </div>

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

            <button className="ob-btn" onClick={handleCreateCompany}
              disabled={saving || !companyName.trim() || !companyAbbr.trim()}>
              {saving ? 'Creating…' : 'Create Company →'}
            </button>
          </div>
        )}

        {/* ── STEP 2: All done ── */}
        {step === 2 && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '36px 32px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 10 }}>You're all set!</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 8, lineHeight: 1.7 }}>
              Your company <strong style={{ color: SLATE }}>{companyName}</strong> has been created.
            </p>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              Add your first property from the dashboard, then invite team members from Settings → User Access.
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
