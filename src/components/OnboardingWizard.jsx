import { useState } from 'react'
import { Icon, ICON_NAMES } from '../lib/icons'
import * as api from '../lib/api'

// ── ONBOARDING WIZARD ───────────────────────────────────────────────────
// Shown to any signed-in user who has no companies attached to their
// account. Three-stage flow:
//
//   1. CHOOSE        — join existing | create new | skip for now
//   2. CREATE / JOIN — the chosen flow
//   3. FIRST_PROPERTY — quick "add one property" prompt so the user
//                       lands in a non-empty dashboard
//   4. DONE          — success splash
//
// Fuzzy-name check on the create path nudges users toward joining
// rather than creating an accidental duplicate company.

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
  .ob-step-dot{width:6px;height:6px;border-radius:50%;background:#DDE1E5;transition:background 0.2s, width 0.2s;}
  .ob-step-dot.active{background:#C8A84B;width:18px;border-radius:3px;}
  .ob-step-dot.done{background:#2D3C4A;}
`

// Progress indicator: shows where we are in the 4-stage flow
function ProgressDots({ current }) {
  // current: 0 = choose, 1 = create/join, 2 = tax_setup, 3 = first_property/done
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={`ob-step-dot ${i === current ? 'active' : i < current ? 'done' : ''}`}/>
      ))}
    </div>
  )
}

export default function OnboardingWizard({ user, onComplete }) {
  // Step state:
  //   'choose'         — initial choice gate
  //   'create'         — creating a new company
  //   'join'           — joining via invite code
  //   'first_property' — optional: add first property after company exists
  //   'done'           — success splash
  const [step, setStep] = useState('choose')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [successCo, setSuccessCo] = useState('')
  const [createdCompanyId, setCreatedCompanyId] = useState(null)

  // Create-company state
  const [companyName, setCompanyName] = useState('')
  const [companyAbbr, setCompanyAbbr] = useState('')
  const [companyColor, setCompanyColor] = useState(COLOURS[0])
  const [similarHits, setSimilarHits] = useState([])

  // Join-company state
  const [inviteCode, setInviteCode] = useState('')

  // First-property state (deliberately minimal — full edit available later)
  const [propName,    setPropName]    = useState('')
  const [propAddress, setPropAddress] = useState('')
  const [propRent,    setPropRent]    = useState('')

  const progress = step === 'choose' ? 0
    : step === 'create' || step === 'join' ? 1
    : step === 'tax_setup' ? 2
    : 3  // first_property | done

  function handleNameChange(val) {
    setCompanyName(val)
    setSimilarHits([])
    if (val.trim()) {
      const words = val.trim().split(/\s+/)
      const abbr = words.length > 1
        ? words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
        : val.slice(0, 4).toUpperCase()
      setCompanyAbbr(abbr)
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
      setCreatedCompanyId(company)
      setStep('tax_setup')
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
      setStep('tax_setup')
    } catch (e) {
      setError(e.message || 'Could not redeem that invite code')
    }
    setSaving(false)
  }

  async function handlePickAccountType(type) {
    setSaving(true); setError('')
    try {
      // Persist the choice. Drives MTD nav visibility in App.jsx.
      await api.upsertUserProfile(user.id, user.email, { account_type: type })
      // Creators continue to the first-property step; joiners skip it
      // (the company they joined already has properties).
      setStep(createdCompanyId ? 'first_property' : 'done')
    } catch (e) {
      setError(e.message || 'Could not save your selection')
    }
    setSaving(false)
  }

  async function handleCreateFirstProperty() {
    if (!propName.trim() || !propAddress.trim() || !createdCompanyId) return
    setSaving(true); setError('')
    try {
      await api.createProperty({
        company_id: createdCompanyId,
        name: propName.trim(),
        address: propAddress.trim(),
        rent_pcm: parseFloat(propRent) || 0,
        status: 'purchased',
        refurb_status: 'planned',
      })
      setStep('done')
    } catch (e) {
      setError(e.message || 'Could not create property')
    }
    setSaving(false)
  }

  function handleSkip()    { onComplete() }
  function handleFinish()  { onComplete() }
  function skipFirstProp() { setStep('done') }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{CSS}</style>
      <div style={{ width: '100%', maxWidth: 520 }}>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/logo.svg" alt="Properly" style={{ height: 52, width: 'auto' }}/>
        </div>

        <ProgressDots current={progress}/>

        {/* ── STEP: CHOOSE ── */}
        {step === 'choose' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><Icon name="sparkle" size={26}/></div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Welcome to Properly
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              Let's get you set up. This takes about 30 seconds.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              <button className="ob-choice" onClick={() => { setError(''); setStep('join') }}>
                <span className="ob-choice-icon"><Icon name="key" size={20}/></span>
                <div className="ob-choice-title">I have an invite code</div>
                <div className="ob-choice-desc">
                  Someone on your team shared an invite code. Paste it to join their company.
                </div>
              </button>

              <button className="ob-choice" onClick={() => { setError(''); setStep('create') }}>
                <span className="ob-choice-icon"><Icon name="grid" size={20}/></span>
                <div className="ob-choice-title">I'm setting up a fresh portfolio</div>
                <div className="ob-choice-desc">
                  Create a company to organise your properties under. You can add more companies later.
                </div>
              </button>

              <button className="ob-choice" onClick={handleSkip}
                style={{ borderStyle: 'dashed', background: 'transparent' }}>
                <span className="ob-choice-icon">⏭</span>
                <div className="ob-choice-title">Just looking around</div>
                <div className="ob-choice-desc">
                  Explore first, set up later. You can create or join a company any time from Settings.
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: JOIN EXISTING ── */}
        {step === 'join' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><Icon name="key" size={26}/></div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Join an existing company
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              Paste the invite code your colleague sent you. It looks like <code style={{ background: BG, padding: '2px 6px', borderRadius: 4 }}>ABC-XYZ</code>.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>
                Invite Code
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
              <strong style={{ color: SLATE }}>No invite code yet?</strong> Ask your colleague to log in and go to <strong>Companies → Access</strong> to create one for you.
            </div>
          </div>
        )}

        {/* ── STEP: CREATE NEW ── */}
        {step === 'create' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><Icon name="grid" size={26}/></div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Name your company
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              This is the wrapper your properties sit under. Most landlords use their trading name or family name — it's easy to rename later.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Company Name</label>
              <input className="ob-input" value={companyName} onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Acme Property Group" autoFocus/>
            </div>

            {/* Duplicate warning */}
            {similarHits.length > 0 && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#8A6A00', background: '#FFF8E1', border: '1px solid #F2D17A', borderRadius: 8, padding: '10px 14px', marginBottom: 16, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>A similar company already exists:</div>
                <div style={{ marginBottom: 6 }}>
                  {similarHits.map(h => h.name).join(', ')}
                </div>
                <div>
                  Did you mean to <button
                    onClick={() => { setError(''); setStep('join') }}
                    style={{ background: 'none', border: 'none', color: '#8A6A00', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: 0, fontWeight: 700 }}>
                    join the existing one
                  </button>? Ask the owner for an invite code.
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Short Code (2–4 letters)</label>
              <input className="ob-input" value={companyAbbr} onChange={e => setCompanyAbbr(e.target.value.toUpperCase().slice(0,4))}
                placeholder="APG" maxLength={4}/>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, marginTop: 5 }}>
                Shown as a badge on every property in this company
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>Brand Colour</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLOURS.map(col => (
                  <button key={col} type="button" onClick={() => setCompanyColor(col)}
                    aria-label={`Brand colour ${col}`} aria-pressed={companyColor === col}
                    style={{
                      width: 32, height: 32, borderRadius: 8, background: col, cursor: 'pointer',
                      border: `3px solid ${companyColor === col ? SLATE : 'transparent'}`,
                      transition: 'border 0.15s', boxSizing: 'border-box', padding: 0
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
                {saving ? 'Creating…' : 'Continue →'}
              </button>
              <button className="ob-btn ob-btn-ghost" onClick={() => { setError(''); setStep('choose') }} disabled={saving}>
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: TAX SETUP ── */}
        {/* One quick question that decides which features appear in the user's
            nav. Individuals / sole-traders get MTD ITSA (mandate hits 6 Apr
            2026). Limited-company landlords file Corp Tax, not Self
            Assessment, so we hide the MTD page from their nav entirely. */}
        {step === 'tax_setup' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><Icon name="landmark" size={26}/></div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              How do you hold your properties?
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 24, lineHeight: 1.6 }}>
              We'll tailor your nav so you only see the tax features you actually need. You can change this any time in Settings.
            </p>

            {[
              { key: 'individual',      icon: 'users', title: 'As an individual (sole-trader)',
                desc: 'You file Self Assessment in your own name. MTD ITSA quarterly filing applies from 6 April 2026 if your rental income tops £50k.' },
              { key: 'limited_company', icon: 'building', title: 'Via a limited company (SPV)',
                desc: 'Property sits in a company — you file Corporation Tax (CT600) annually. MTD ITSA doesn\'t apply to companies, so we\'ll hide it.' },
              { key: 'mixed',           icon: 'grid', title: 'A mix of both',
                desc: 'Some personal, some in a company. We\'ll show every tax feature so you can pick what\'s relevant.' },
            ].map(opt => (
              <button key={opt.key} className="ob-choice" onClick={() => handlePickAccountType(opt.key)} disabled={saving}
                style={{ marginBottom: 10 }}>
                <span className="ob-choice-icon">{ICON_NAMES.includes(opt.icon)?<Icon name={opt.icon} size={20}/>:opt.icon}</span>
                <div className="ob-choice-title">{opt.title}</div>
                <div className="ob-choice-desc">{opt.desc}</div>
              </button>
            ))}

            {error && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginTop: 12 }}>
                {error}
              </div>
            )}

            <button onClick={() => setStep(createdCompanyId ? 'first_property' : 'done')}
              disabled={saving}
              style={{ background: 'none', border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 11, color: MUTED, cursor: 'pointer', marginTop: 14, padding: 6 }}>
              Skip for now — I'll set this up later
            </button>
          </div>
        )}

        {/* ── STEP: FIRST PROPERTY (optional) ── */}
        {step === 'first_property' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 30px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><Icon name="home" size={26}/></div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Add your first property?
            </h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 22, lineHeight: 1.6 }}>
              <strong style={{ color: SLATE }}>{successCo}</strong> is set up. Add one property now to see what the dashboard looks like with real data — just the basics, you can fill in the rest later.
            </p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Property Name</label>
              <input className="ob-input" value={propName} onChange={e => setPropName(e.target.value)}
                placeholder="e.g. Flat 1, Station Road" autoFocus/>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Address</label>
              <input className="ob-input" value={propAddress} onChange={e => setPropAddress(e.target.value)}
                placeholder="Full UK address"/>
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Monthly Rent (optional)</label>
              <input className="ob-input" value={propRent}
                onChange={e => setPropRent(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="£" inputMode="decimal"/>
            </div>

            {error && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              <button className="ob-btn ob-btn-gold" onClick={handleCreateFirstProperty}
                disabled={saving || !propName.trim() || !propAddress.trim()}>
                {saving ? 'Adding…' : 'Add Property & Finish →'}
              </button>
              <button className="ob-btn ob-btn-ghost" onClick={skipFirstProp} disabled={saving}>
                Skip — I'll add properties later
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: DONE ── */}
        {step === 'done' && (
          <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '36px 32px', boxShadow: '0 4px 24px rgba(45,60,74,0.08)', textAlign: 'center' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom: 16 }}><Icon name="sparkle" size={44}/></div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: SLATE, marginBottom: 10 }}>You're all set</h2>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 8, lineHeight: 1.7 }}>
              You're now part of <strong style={{ color: SLATE }}>{successCo}</strong>.
            </p>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              Head to the dashboard whenever you're ready.
            </p>
            <button className="ob-btn" onClick={handleFinish}>
              Open Dashboard →
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
