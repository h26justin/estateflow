import { useState, useEffect, Suspense, lazy } from 'react'
import { useIsMobile } from '../../lib/useWindowSize'
import { useTheme } from '../../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../../lib/icons'
import { MONO, CV, FS } from '../../lib/styles'
import { NAV_TOGGLE_OPTIONS, DEFAULT_NAV_KEYS, SETTINGS_PAGES, resolveSettingsKey, settingsKeyFromHash } from '../../lib/nav'
import { COMPLIANCE_CATALOGUE, TIER_LABELS } from '../../lib/complianceCatalogue'
import BillingPage from '../BillingPage'
import TrashPage from '../TrashPage'
import BackupsPage from '../BackupsPage'
import CompanyInboxPanel from '../CompanyInboxPanel'
import IntegrationsPanel from '../IntegrationsPanel'
import TwoFactorPanel from '../TwoFactorPanel'
import ApiAccessPanel from '../ApiAccessPanel'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { canUseInvestorFeatures } from '../../lib/tierGating'
import { AccessModal } from './AccessModal'
import { MilestoneSettingsPanel } from './MilestoneSettingsPanel'
import { AdminSettingsPanel } from './AdminSettingsPanel'
import { BrandingSettingsPanel } from './BrandingSettingsPanel'
import { TenantPortalSettings } from './TenantPortalSettings'
import { SecurityDataPanel } from './SecurityDataPanel'
import { AuditLogPanel } from './AuditLogPanel'
import { ReferralPanel } from './ReferralPanel'
import { AccountTypePanel } from './AccountTypePanel'
import { SkeletonRows } from '../../lib/Skeleton'
// HelpCenter is ~800 lines of static guide content only seen on the Settings
// "Help" tab — lazy-load it so it stays out of the main bundle.
const HelpCenter = lazy(() => import('../HelpCenter'))
const BookkeepingRules = lazy(() => import('../BookkeepingRules'))

// Wraps BookkeepingRules with a company selector for the Settings sub-tab,
// since Settings has no global "active company" the way the detail view does.
function BookkeepingTabBody({ companies, properties = [], T, mono }) {
  const [coId, setCoId] = useState(companies[0]?.id || '')
  const coProps = coId ? properties.filter(p => p.company_id === coId) : properties
  return (
    <div style={{display:'grid',gap:16}}>
      {companies.length > 1 && (
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Company</span>
          <select value={coId} onChange={e=>setCoId(e.target.value)}
            style={{fontFamily:mono,fontSize:12,padding:'6px 10px',borderRadius:8,background:T.bg,color:T.text,border:`1px solid ${T.border}`}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <BookkeepingRules companyId={coId} properties={coProps}/>
    </div>
  )
}

// ── SETTINGS PAGE ─────────────────────────────────────────────────────────────
export function SettingsPage({companies, setCompanies, companySettings, setCompanySettings, user, showToast, isAdmin, isPlatformAdmin, darkMode, setDarkMode, userNavPrefs, setUserNavPrefs, yieldBasis, setYieldBasis, accountType, setAccountType, properties = [], activeFlags = new Set(), companySubs = [], activeCompanyId = null, permissionsMap = null, devModeActive = false}) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const [saving, setSaving] = useState(null)
  const [showAccessModal, setShowAccessModal] = useState(false)
  // Settings is five pages of stacked sections (lib/nav.js SETTINGS_PAGES).
  // The URL keeps one key — #/settings/<page-or-section> — so every old
  // sub-tab link (#/settings/billing, #/settings/backups…) still resolves:
  // it opens the section's page and scrolls to the section. `n` bumps on
  // every request so re-picking the same section scrolls again.
  const [settingsJump, setSettingsJump] = useState(() => ({ key: settingsKeyFromHash(window.location.hash) || 'account', n: 0 }))

  // replaceState, not pushState: flipping through settings pages/sections
  // must not bury the page the user came from under a pile of history
  // entries (Back should leave Settings; refresh/bookmark still restore the
  // section from the hash).
  const setSettingsTab = (key) => {
    setSettingsJump(prev => ({ key, n: prev.n + 1 }))
    const target = `#/settings/${key}`
    if (window.location.hash !== target) {
      window.history.replaceState({ view: 'settings', settingsTab: key }, '', target)
    }
  }

  // Listen for URL-driven changes (browser back/forward, command palette,
  // drawer shortcuts) — they still send old tab keys.
  useEffect(() => {
    const handler = (e) => {
      const key = e.detail?.tab
      if (key) setSettingsJump(prev => ({ key, n: prev.n + 1 }))
    }
    window.addEventListener('ownproperly:set-settings-tab', handler)
    return () => window.removeEventListener('ownproperly:set-settings-tab', handler)
  }, [])

  // Page-level company filter shared by every company-scoped tab (same pill
  // UI as the Autopilot/Insurance pages). Previously each tab rolled its own
  // selector (Branding pills, Tenant Portal dropdown, Features stacked all
  // companies), so the selection never carried between tabs. Seeded from the
  // app-level company tab so Settings opens scoped to the company being viewed.
  const [settingsCoFilter, setSettingsCoFilter] = useState(activeCompanyId || 'all')
  const coFilter = settingsCoFilter !== 'all' && companies.some(c => c.id === settingsCoFilter) ? settingsCoFilter : 'all'
  const scopedCompanies = coFilter === 'all' ? companies : companies.filter(c => c.id === coFilter)

  // ── Account state ──────────────────────────────────────────────────────────
  const [fullName, setFullName]             = useState('')
  const [phone, setPhone]                   = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [milestoneConfig, setMilestoneConfig] = useState({})
  const [profileSaving, setProfileSaving]   = useState(false)
  const [newEmail, setNewEmail]             = useState('')
  const [emailSaving, setEmailSaving]       = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving]             = useState(false)
  const [showPw, setShowPw]                 = useState(false)
  const [notifSaving, setNotifSaving]       = useState(false)
  const [notifs, setNotifs] = useState({
    rent_arrears: true, lease_expiry: true, compliance_expiry: true,
    vacant_properties: true, weekly_summary: false,
  })

  useEffect(() => { loadProfile() }, [])

  async function loadProfile() {
    setProfileLoading(true)
    try {
      const data = await api.fetchUserProfile(user?.id)
      if (data) {
        setFullName(data.full_name || '')
        setPhone(data.phone || '')
        if (data.notifications) setNotifs(prev => ({ ...prev, ...data.notifications }))
      }
      const mc = await api.fetchMilestoneDefaults(user?.id)
      setMilestoneConfig(mc || {})
    } catch(e) { showToast(e.message || 'Failed to load profile', 'error') }
    setProfileLoading(false)
  }

  async function saveProfile() {
    setProfileSaving(true)
    try {
      await api.upsertUserProfile(user?.id, user?.email, { full_name: fullName, phone })
      showToast('Profile saved')
    } catch(e) { showToast(e.message, 'error') }
    setProfileSaving(false)
  }

  async function saveNotifications() {
    setNotifSaving(true)
    try {
      await api.upsertUserProfile(user?.id, user?.email, { notifications: notifs })
      showToast('Notification preferences saved')
    } catch(e) { showToast(e.message, 'error') }
    setNotifSaving(false)
  }

  async function updateEmail() {
    if (!newEmail.trim()) return
    setEmailSaving(true)
    try {
      await api.updateUserEmail(newEmail.trim())
      showToast('Confirmation sent to ' + newEmail + ' — check your inbox')
      setNewEmail('')
    } catch(e) { showToast(e.message, 'error') }
    setEmailSaving(false)
  }

  async function updatePassword() {
    if (!newPassword) return
    if (newPassword !== confirmPassword) { showToast('Passwords do not match', 'error'); return }
    if (newPassword.length < 8) { showToast('Password must be at least 8 characters', 'error'); return }
    setPwSaving(true)
    try {
      await api.updateUserPassword(currentPassword, newPassword, user?.email)
      showToast('Password updated successfully')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch(e) { showToast(e.message, 'error') }
    setPwSaving(false)
  }

  async function sendResetEmail() {
    try {
      await api.sendPasswordReset(user?.email)
      showToast('Reset email sent to ' + user?.email)
    } catch(e) { showToast(e.message, 'error') }
  }

  const FEATURES = [
    {key:'feature_compliance',  label:'Compliance & Certificates', desc:'Track gas safety, EICR, EPC, HMO licences and other certificates with expiry alerts', icon:'shield-check'},
    {key:'feature_tenancy',     label:'Tenancy Details',           desc:'Store tenant contact details, deposit info, rent review dates and break clauses', icon:'users'},
    {key:'feature_maintenance', label:'Maintenance & Repairs',     desc:'Log repair jobs with contractor details, costs and status tracking', icon:'wrench'},
    {key:'feature_documents',   label:'Document Storage',          desc:'Upload and store tenancy agreements, certificates and other documents', icon:'folder'},
    {key:'feature_expenses',    label:'Expenses Tracker',          desc:'Track all property expenses to calculate true net profit per property', icon:'wallet'},
    {key:'feature_reports',     label:'Reports & Export',          desc:'Generate P&L reports and export data to CSV for your accountant', icon:'pie-chart'},
    {key:'feature_statements',  label:'Statement Importer',        desc:'Upload PNE and RMS rental statements to automatically log rent payments, management fees and maintenance costs', icon:'file-text'},
    {key:'feature_tenant_portal',    label:'Tenant Portal',             desc:'Allow tenants to log in and access their own portal — see rent history, tenancy details and documents', icon:'home', section:'tenant'},
    {key:'feature_tenant_messaging', label:'Tenant Messaging',          desc:'Allow tenants to send messages to you directly through the portal — you reply from the inbox on your dashboard', icon:'mail', section:'tenant'},
    {key:'feature_tenant_repairs',   label:'Tenant Repair Requests',    desc:'Allow tenants to submit maintenance requests with photos — appears in your inbox instantly', icon:'wrench', section:'tenant'},
    {key:'feature_tenant_documents', label:'Tenant Document Access',    desc:'Allow tenants to download documents you have shared with them from the portal', icon:'file-text', section:'tenant'},
  ]

  async function toggleFeature(companyId, featureKey, currentValue) {
    setSaving(`${companyId}-${featureKey}`)
    try {
      const current = companySettings[companyId] || {}
      const updated = { ...current, [featureKey]: !currentValue }
      const saved = await api.upsertCompanySettings(companyId, updated)
      setCompanySettings(prev=>({...prev, [companyId]: saved || updated}))
      showToast('Settings saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  // Settings → Compliance Tracking: flip one catalogue key in the
  // company's compliance_tracked JSONB. Missing key = tracked (default on).
  async function toggleComplianceTracked(companyId, certKey, currentOn) {
    setSaving(`${companyId}-ct-${certKey}`)
    try {
      const current = companySettings[companyId] || {}
      const tracked = { ...(current.compliance_tracked || {}), [certKey]: !currentOn }
      const saved = await api.upsertCompanySettings(companyId, { compliance_tracked: tracked })
      setCompanySettings(prev=>({...prev, [companyId]: saved || { ...current, compliance_tracked: tracked }}))
      showToast('Settings saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  const mono = MONO
  const sectionStyle = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 16 }
  const fieldStyle = { marginBottom: 14 }
  const labelStyle = { fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }

  // Toggle list + seed default both come from lib/nav.js — the previous
  // local copies disagreed with the runtime rail (no Insurance row here, and
  // a seed default that dropped `insurance`), so a single toggle save could
  // permanently strip Insurance from a user's nav.
  async function saveNavPref(key, enabled) {
    const current = (userNavPrefs||[]).length > 0 ? userNavPrefs : DEFAULT_NAV_KEYS
    const next = enabled
      ? [...current, key].filter((v,i,a)=>a.indexOf(v)===i)
      : current.filter(k=>k!==key)
    if(setUserNavPrefs) setUserNavPrefs(next)
    try {
      await supabase.from('user_profiles').upsert(
        { user_id: user?.id, email: user?.email, nav_items: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      showToast('Navigation updated')
    } catch(e) { showToast(e.message,'error') }
  }

  // Conditional sections: shown only when their gate passes. A deep link to
  // a hidden one opens its page at the top.
  const showBookkeeping = activeFlags.has('ai_bookkeeping') && canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin })
  const hiddenSections = new Set([
    ...(showBookkeeping ? [] : ['bookkeeping']),
    ...(isPlatformAdmin ? [] : ['admin']),
  ])
  const settingsPages = SETTINGS_PAGES.map(p => ({ ...p, sections: p.sections.filter(sec => !hiddenSections.has(sec.key)) }))
  const { page: settingsPageKey, section: targetSection } = resolveSettingsKey(settingsJump.key, hiddenSections)
  const currentPage = settingsPages.find(p => p.key === settingsPageKey) || settingsPages[0]
  const shownSections = new Set(currentPage.sections.map(sec => sec.key))
  const show = key => shownSections.has(key)
  const activeSection = targetSection || currentPage.sections[0]?.key
  const pageIsCompanyScoped = currentPage.sections.some(sec => sec.companyScoped)

  // Scroll to the requested section (or the top for a bare page). Sections
  // above the target can still be loading and grow, so settle once more
  // shortly after.
  useEffect(() => {
    const go = () => {
      const el = targetSection && document.getElementById(`settings-section-${targetSection}`)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
      else if (!targetSection && typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0) } catch { /* jsdom */ } }
    }
    const raf = requestAnimationFrame(go)
    const t = targetSection ? setTimeout(go, 400) : null
    return () => { cancelAnimationFrame(raf); if (t) clearTimeout(t) }
  }, [settingsJump.n, settingsJump.key, targetSection])

  const sectionHeading = key => {
    if (!show(key)) return null
    const sec = currentPage.sections.find(x => x.key === key)
    const first = currentPage.sections[0]?.key === key
    return (
      <h2 id={`settings-section-${key}`} style={{
        fontSize:17,fontWeight:700,letterSpacing:'-0.02em',color:T.text,scrollMarginTop:84,
        margin:first?'0 0 12px':'32px 0 12px',paddingTop:first?0:20,borderTop:first?'none':`1px solid ${T.border}`,
      }}>{sec.label}</h2>
    )
  }

  return (
    <div className="fade">
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Settings</h1>
        <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>{currentPage.desc}</p>
      </div>

      {/* Settings navigation: five pages, each a stack of sections. Desktop
          gets a sticky left rail with the open page's jump list nested under
          it; mobile gets page pills plus a "Jump to" select. */}
      <div style={{display:'flex',gap:28,alignItems:'flex-start',flexDirection:isMobile?'column':'row'}}>
      <nav aria-label="Settings pages" style={isMobile
        ? {width:'100%',borderBottom:`1px solid ${T.border}`,paddingBottom:12,display:'grid',gap:10}
        : {width:210,flexShrink:0,position:'sticky',top:76,display:'grid',gap:2}}>
        {isMobile ? (
          <>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {settingsPages.map(p=>{
                const active = p.key===currentPage.key
                return (
                  <button key={p.key} onClick={()=>setSettingsTab(p.key)} aria-current={active?'page':undefined} style={{
                    fontFamily:mono,fontSize:11,padding:'6px 13px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${active?T.gold:T.border}`,background:active?T.gold:'transparent',
                    color:active?CV.onGold:T.muted,fontWeight:active?700:400,
                  }}>{p.label}</button>
                )
              })}
            </div>
            {currentPage.sections.length > 1 && (
              <label style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Jump to</span>
                <select value={activeSection} onChange={e=>setSettingsTab(e.target.value)}
                  style={{flex:1,fontFamily:mono,fontSize:12,padding:'6px 10px',borderRadius:8,background:T.bg,color:T.text,border:`1px solid ${T.border}`}}>
                  {currentPage.sections.map(sec=><option key={sec.key} value={sec.key}>{sec.label}</option>)}
                </select>
              </label>
            )}
          </>
        ) : settingsPages.map(p=>{
          const active = p.key===currentPage.key
          return (
            <div key={p.key}>
              <button onClick={()=>setSettingsTab(p.key)} aria-current={active?'page':undefined} style={{
                fontFamily:mono,fontSize:12,padding:'8px 11px',borderRadius:8,cursor:'pointer',textAlign:'left',width:'100%',
                border:'none',borderLeft:`3px solid ${active?T.gold:'transparent'}`,background:active?T.gold+'18':'transparent',
                color:active?T.text:T.muted,fontWeight:active?700:400,transition:'background 0.15s,color 0.15s',
              }}
              onMouseEnter={e=>{if(!active)e.currentTarget.style.color=T.text}}
              onMouseLeave={e=>{if(!active)e.currentTarget.style.color=T.muted}}>{p.label}</button>
              {active && p.sections.length > 1 && (
                <div role="list" aria-label={`${p.label} sections`} style={{display:'grid',gap:1,margin:'4px 0 8px 14px',borderLeft:`1px solid ${T.border}`}}>
                  {p.sections.map(sec=>{
                    const on = sec.key===activeSection
                    return (
                      <a role="listitem" key={sec.key} href={`#/settings/${sec.key}`}
                        onClick={e=>{e.preventDefault();setSettingsTab(sec.key)}}
                        aria-current={on?'location':undefined}
                        style={{fontFamily:mono,fontSize:11,padding:'5px 10px',textDecoration:'none',
                          color:on?(sec.key==='admin'?T.red:T.goldText):T.muted,fontWeight:on?700:400}}>{sec.label}</a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div style={{flex:1,minWidth:0,width:'100%'}}>
      {/* Company switcher — only on pages with per-company sections */}
      {companies.length > 1 && pageIsCompanyScoped && (
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:18}}>
          <span style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Company:</span>
          {[{id:'all',name:'All companies',color:T.goldText},...companies].map(c=>{
            const active = coFilter===c.id
            const accent = c.color || T.gold
            return (
              <button key={c.id} onClick={()=>setSettingsCoFilter(c.id)}
                style={{
                  fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${active?accent:T.border}`,
                  background:active?accent+'22':'transparent',
                  color:active?accent:T.muted,fontWeight:active?700:400,
                  transition:'all 0.18s',
                }}>
                {c.id==='all' ? c.name : `${c.abbr?c.abbr+' ':''}${c.name}`}
              </button>
            )
          })}
        </div>
      )}
      {/* ── ACCOUNT TAB ── */}
      {sectionHeading('account')}
      {show('account') && (
        profileLoading
          ? <SkeletonRows rows={3} height={36}/>
          : <>
            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Personal Information</div>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="settings-full-name">Full Name</label>
                <input id="settings-full-name" autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your full name"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="settings-phone">Phone Number</label>
                <input id="settings-phone" type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 000000"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="settings-email">Email Address</label>
                <input id="settings-email" value={user?.email||''} disabled style={{opacity:0.5,cursor:'not-allowed'}}/>
                <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,marginTop:5}}>To change your email or password, see Security &amp; Data below.</div>
              </div>
              <button className="btn btn-gold" onClick={saveProfile} disabled={profileSaving} style={{marginTop:8}}>
                {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>

            <AccountTypePanel T={T} mono={mono} user={user} accountType={accountType} setAccountType={setAccountType}/>

            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>App Tour</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:12}}>Replay the getting started tour at any time.</div>
              <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>window.dispatchEvent(new CustomEvent('ownproperly:restart-tour'))}>Replay tour</button>
            </div>
          </>
      )}

      {/* ── SECURITY TAB ── */}
      {sectionHeading('security')}
      {show('security') && (
        <>
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Change Email Address</div>
            <div style={fieldStyle}>
              <label style={labelStyle}>New Email Address</label>
              <input aria-label="New Email Address" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder={user?.email} type="email"/>
            </div>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,marginBottom:12,lineHeight:1.6}}>A confirmation link will be sent to both addresses. The change takes effect once confirmed.</div>
            <button className="btn btn-gold" onClick={updateEmail} disabled={emailSaving||!newEmail.trim()}>
              {emailSaving ? 'Sending…' : 'Update Email'}
            </button>
          </div>
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Change Password</div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Current Password</label>
              <input aria-label="Current Password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} type={showPw?'text':'password'} placeholder="Your current password"/>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>New Password</label>
              <input aria-label="New Password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} type={showPw?'text':'password'} placeholder="At least 8 characters"/>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Confirm New Password</label>
              <input aria-label="Confirm New Password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} type={showPw?'text':'password'} placeholder="Repeat new password"/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
              <input type="checkbox" id="showpwS" checked={showPw} onChange={e=>setShowPw(e.target.checked)} style={{width:'auto',margin:0}}/>
              <label htmlFor="showpwS" style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,cursor:'pointer',margin:0}}>Show passwords</label>
            </div>
            <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              <button className="btn btn-gold" onClick={updatePassword} disabled={pwSaving||!currentPassword||!newPassword||!confirmPassword}>
                {pwSaving ? 'Updating…' : 'Update Password'}
              </button>
              <button className="btn btn-ghost" onClick={sendResetEmail} style={{fontSize:11}}>Send Reset Email Instead</button>
            </div>
          </div>
          <TwoFactorPanel T={T}/>
          <ApiAccessPanel T={T}/>
          <SecurityDataPanel user={user} T={T} showToast={showToast}/>
        </>
      )}

      {/* ── DISPLAY TAB ── */}
      {sectionHeading('display')}
      {show('display') && (
        <>
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Colour Mode</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:2}}>Theme</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{darkMode?'Dark mode — easier on the eyes':'Light mode — clean and bright'}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={async()=>{setDarkMode(true);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:true})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                    border:`1px solid ${darkMode?T.gold:T.border}`,
                    background:darkMode?T.gold+'22':'transparent',
                    color:darkMode?T.goldText:T.muted,transition:'all 0.2s'}}>
                  Dark
                </button>
                <button onClick={async()=>{setDarkMode(false);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:false})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                    border:`1px solid ${!darkMode?T.gold:T.border}`,
                    background:!darkMode?T.gold+'22':'transparent',
                    color:!darkMode?T.goldText:T.muted,transition:'all 0.2s'}}>
                  Light
                </button>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Yield Calculation</div>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>Yield basis</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>
                  {yieldBasis==='cost'
                    ? 'Calculated on purchase price + refurb cost — your return on actual money invested.'
                    : "Calculated on current property value — yield at today's market price."}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8,flexShrink:0}}>
                <button onClick={async()=>{setYieldBasis('cost');try{await api.upsertUserProfile(user?.id,user?.email,{yield_basis:'cost'})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',textAlign:'left',
                    border:`1px solid ${yieldBasis==='cost'?T.gold:T.border}`,
                    background:yieldBasis==='cost'?T.gold+'22':'transparent',
                    color:yieldBasis==='cost'?T.goldText:T.muted,transition:'all 0.2s'}}>
                  Purchase + refurb cost
                </button>
                <button onClick={async()=>{setYieldBasis('value');try{await api.upsertUserProfile(user?.id,user?.email,{yield_basis:'value'})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',textAlign:'left',
                    border:`1px solid ${yieldBasis==='value'?T.gold:T.border}`,
                    background:yieldBasis==='value'?T.gold+'22':'transparent',
                    color:yieldBasis==='value'?T.goldText:T.muted,transition:'all 0.2s'}}>
                  Current property value
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {sectionHeading('notifications')}
      {show('notifications') && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Alert Preferences</div>
          <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,marginBottom:16,lineHeight:1.6}}>Control which alerts appear in your Smart Alerts dashboard panel.</div>
          {[
            {key:'rent_arrears',      label:'Rent Arrears',      desc:'Alert when a property has overdue rent'},
            {key:'lease_expiry',      label:'Lease Expiry',      desc:'Alert when tenancy agreements are expiring'},
            {key:'compliance_expiry', label:'Compliance Expiry', desc:'Alert for gas, electrical, EPC certificates nearing expiry'},
            {key:'vacant_properties', label:'Vacant Properties', desc:'Alert when properties are sitting vacant'},
            {key:'weekly_summary',    label:'Weekly Summary',    desc:'Email every Monday morning: rent in vs expected, arrears, certificates due and tenancies ending'},
          ].map(item=>(
            <div key={item.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:`1px solid ${T.border}`}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{item.label}</div>
                <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>{item.desc}</div>
              </div>
              <button role="switch" aria-checked={!!notifs[item.key]} aria-label={item.label} onClick={()=>setNotifs(n=>({...n,[item.key]:!n[item.key]}))} style={{border:'none',padding:0,
                width:42,height:24,borderRadius:12,cursor:'pointer',transition:'background 0.2s',flexShrink:0,
                background:notifs[item.key]?T.gold:T.border,position:'relative',marginLeft:16,
              }}>
                <div style={{position:'absolute',top:3,left:notifs[item.key]?21:3,width:18,height:18,
                  borderRadius:9,background:'white',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>
              </button>
            </div>
          ))}
          <button className="btn btn-gold" onClick={saveNotifications} disabled={notifSaving} style={{marginTop:20}}>
            {notifSaving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      )}

      {/* ── FEATURES TAB ── */}
      {sectionHeading('features')}
      {show('features') && <>
      {scopedCompanies.map(company=>{
        const settings = companySettings[company.id] || {}
        return (
          <div key={company.id} className="card" style={{padding:'22px 26px',marginBottom:16,borderLeft:`3px solid ${company.color}`}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
              <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:company.color,background:company.color+'22',padding:'3px 10px',borderRadius:4}}>{company.abbr}</div>
              <h2 style={{fontSize:17,fontWeight:700}}>{company.name}</h2>
            </div>

            <div style={{display:'grid',gap:12}}>
              {/* Core features */}
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6,marginTop:4}}>Core features</div>
            {FEATURES.filter(f=>!f.section).map(feature=>{
                const isOn = settings[feature.key] !== false
                const isSaving = saving===`${company.id}-${feature.key}`
                return (
                  <div key={feature.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap'}}>
                    <span style={{flexShrink:0,display:'flex'}}>{ICON_NAMES.includes(feature.icon)?<Icon name={feature.icon} size={20} color={T.gold}/>:<span style={{fontSize:20}}>{feature.icon}</span>}</span>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{feature.label}</div>
                      <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{feature.desc}</div>
                    </div>
                    {/* Toggle switch */}
                    <button role="switch" aria-checked={isOn} aria-label={feature.label} disabled={isSaving} onClick={()=>!isSaving&&toggleFeature(company.id, feature.key, isOn)}
                      style={{
                        border:'none', padding:0,
                        width:44, height:24, borderRadius:12, cursor:'pointer',
                        background: isOn ? company.color : T.faint,
                        position:'relative', transition:'background 0.2s', flexShrink:0,
                        opacity: isSaving ? 0.6 : 1,
                      }}>
                      <div style={{
                        width:18, height:18, borderRadius:'50%', background:'white',
                        position:'absolute', top:3,
                        left: isOn ? 23 : 3,
                        transition:'left 0.2s',
                        boxShadow:'0 1px 3px rgba(0,0,0,0.3)',
                      }}/>
                    </button>
                    <span style={{fontFamily:MONO,fontSize:11,color:isOn?company.color:T.muted,fontWeight:600,width:20,flexShrink:0}}>
                      {isSaving?'…':isOn?'ON':'OFF'}
                    </span>
                  </div>
                )
              })}

            {/* Tenant portal features */}
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6,marginTop:16,paddingTop:16,borderTop:`1px solid ${T.border}`}}>Tenant portal features</div>
            <div style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:10,lineHeight:1.6}}>Control what tenants can do when they log into their portal for this company.</div>
            {FEATURES.filter(f=>f.section==='tenant').map(feature=>{
                const isOn = settings[feature.key] !== false
                const isSaving = saving===`${company.id}-${feature.key}`
                // If portal is off, disable all sub-features
                const portalEnabled = settings['feature_tenant_portal'] !== false
                const disabled = feature.key !== 'feature_tenant_portal' && !portalEnabled
                return (
                  <div key={feature.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap',opacity:disabled?0.4:1}}>
                    <span style={{flexShrink:0,display:'flex'}}>{ICON_NAMES.includes(feature.icon)?<Icon name={feature.icon} size={20} color={T.gold}/>:<span style={{fontSize:20}}>{feature.icon}</span>}</span>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{feature.label}</div>
                      <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{feature.desc}</div>
                      {disabled && <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginTop:3}}>Enable Tenant Portal first</div>}
                    </div>
                    <button role="switch" aria-checked={isOn} aria-label={feature.label} disabled={isSaving||disabled} onClick={()=>!isSaving&&!disabled&&toggleFeature(company.id, feature.key, isOn)}
                      style={{
                        border:'none', padding:0,
                        width:44, height:24, borderRadius:12, cursor:disabled?'not-allowed':'pointer',
                        background: isOn && !disabled ? company.color : T.faint,
                        position:'relative', transition:'background 0.2s', flexShrink:0,
                        opacity: isSaving ? 0.6 : 1,
                      }}>
                      <div style={{
                        width:18, height:18, borderRadius:'50%', background:'white',
                        position:'absolute', top:3,
                        left: isOn && !disabled ? 23 : 3,
                        transition:'left 0.2s',
                        boxShadow:'0 1px 3px rgba(0,0,0,0.3)',
                      }}/>
                    </button>
                    <span style={{fontFamily:MONO,fontSize:11,color:isOn&&!disabled?company.color:T.muted,fontWeight:600,width:20,flexShrink:0}}>
                      {isSaving?'…':isOn&&!disabled?'ON':'OFF'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      </>}

      {/* ── COMPLIANCE TRACKING TAB ── which requirements the Compliance
          page chases per company. Everything defaults ON; property-level
          applicability flags (gas supply, HMO, licensing) do the fine-grain
          filtering, so these toggles are for "we never want to track X". */}
      {sectionHeading('compliance')}
      {show('compliance') && <>
      <div style={{...sectionStyle,paddingBottom:18}}>
        <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Compliance tracking</div>
        <div style={{fontFamily:mono,fontSize:12,color:T.text,lineHeight:1.6}}>
          Choose which certificates, licences and paperwork the Compliance page tracks for each company.
          Items that don't apply to a property (no gas supply, not an HMO) are skipped automatically —
          set those flags on each property's edit form.
        </div>
      </div>
      {scopedCompanies.map(company=>{
        const settings = companySettings[company.id] || {}
        const tracked = settings.compliance_tracked || {}
        return (
          <div key={company.id} className="card" style={{padding:'22px 26px',marginBottom:16,borderLeft:`3px solid ${company.color}`}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
              <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:company.color,background:company.color+'22',padding:'3px 10px',borderRadius:4}}>{company.abbr}</div>
              <h2 style={{fontSize:17,fontWeight:700}}>{company.name}</h2>
            </div>
            <div style={{display:'grid',gap:12}}>
              {[1,2,3].map(tier=>(<div key={tier} style={{display:'grid',gap:12}}>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:-4,marginTop:tier===1?4:12}}>{TIER_LABELS[tier]}</div>
                {COMPLIANCE_CATALOGUE.filter(r=>r.tier===tier).map(req=>{
                  const isOn = tracked[req.key] !== false
                  const isSaving = saving===`${company.id}-ct-${req.key}`
                  return (
                    <div key={req.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap'}}>
                      <span style={{flexShrink:0,display:'flex'}}>{ICON_NAMES.includes(req.icon)?<Icon name={req.icon} size={20} color={T.gold}/>:<span style={{fontSize:20}}>{req.icon}</span>}</span>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{req.label}{req.cycleMonths ? <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,fontWeight:400,marginLeft:8}}>{req.cycleMonths>=12?`every ${req.cycleMonths/12}yr${req.cycleMonths>12?'s':''}`:`every ${req.cycleMonths}mo`}</span> : null}</div>
                        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{req.desc}</div>
                      </div>
                      <button role="switch" aria-checked={isOn} aria-label={req.label} disabled={isSaving} onClick={()=>!isSaving&&toggleComplianceTracked(company.id, req.key, isOn)}
                        style={{
                          border:'none', padding:0,
                          width:44, height:24, borderRadius:12, cursor:'pointer',
                          background: isOn ? company.color : T.faint,
                          position:'relative', transition:'background 0.2s', flexShrink:0,
                          opacity: isSaving ? 0.6 : 1,
                        }}>
                        <div style={{
                          width:18, height:18, borderRadius:'50%', background:'white',
                          position:'absolute', top:3,
                          left: isOn ? 23 : 3,
                          transition:'left 0.2s',
                          boxShadow:'0 1px 3px rgba(0,0,0,0.3)',
                        }}/>
                      </button>
                      <span style={{fontFamily:MONO,fontSize:11,color:isOn?company.color:T.muted,fontWeight:600,width:20,flexShrink:0}}>
                        {isSaving?'…':isOn?'ON':'OFF'}
                      </span>
                    </div>
                  )
                })}
              </div>))}
            </div>
          </div>
        )
      })}
      </>}

      {sectionHeading('billing')}
      {show('billing') && (
        <BillingPage key={coFilter} companies={scopedCompanies} user={user} isPlatformAdmin={isPlatformAdmin}/>
      )}

      {sectionHeading('integrations')}
      {show('integrations') && (
        <IntegrationsPanel T={T} mono={mono} companies={scopedCompanies} properties={properties}/>
      )}

      {sectionHeading('bookkeeping')}
      {show('bookkeeping') && activeFlags.has('ai_bookkeeping') && canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin }) && (
        <Suspense fallback={null}>
          {/* Keyed by filter so the panel's internal company selection resets
              to the newly scoped company when the page-level filter changes */}
          <BookkeepingTabBody key={coFilter} companies={scopedCompanies} properties={properties} T={T} mono={mono}/>
        </Suspense>
      )}

      {sectionHeading('navbar')}
      {show('navbar') && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Navigation bar</div>
          <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:16}}>Choose which sections appear in your navigation. Dashboard, Properties and Settings are always shown.</div>
          <div style={{display:'grid',gap:10}}>
            {NAV_TOGGLE_OPTIONS.map(item=>{
              const enabled = (userNavPrefs||[]).includes(item.key)
              return (
                <div key={item.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',background:T.bg,borderRadius:10,border:`1px solid ${T.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <span style={{display:'flex',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={18}/>:<span style={{fontSize:18}}>{item.icon}</span>}</span>
                    <span style={{fontFamily:mono,fontSize:13,color:T.text}}>{item.label}</span>
                  </div>
                  <button role="switch" aria-checked={enabled} aria-label={item.label} onClick={()=>saveNavPref(item.key,!enabled)}
                    style={{border:'none',padding:0,width:44,height:24,borderRadius:12,background:enabled?T.gold:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:enabled?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}


      {sectionHeading('branding')}
      {show('branding') && (
        <BrandingSettingsPanel
          key={coFilter}
          companies={scopedCompanies}
          setCompanies={setCompanies}
          companySettings={companySettings}
          setCompanySettings={setCompanySettings}
          user={user}
          showToast={showToast}
          T={T}
        />
      )}

      {sectionHeading('tenant')}
      {show('tenant') && (
        <TenantPortalSettings key={coFilter} companies={scopedCompanies} companySettings={companySettings} setCompanySettings={setCompanySettings} showToast={showToast} T={T}/>
      )}

      {sectionHeading('inbox')}
      {show('inbox') && (
        <CompanyInboxPanel key={coFilter} companies={scopedCompanies} T={T}/>
      )}

      {sectionHeading('milestones')}
      {show('milestones') && (
        <MilestoneSettingsPanel
          user={user}
          config={milestoneConfig}
          onChange={setMilestoneConfig}
          showToast={showToast}
          T={T}
        />
      )}

      {sectionHeading('backups')}
      {show('backups') && (
        <BackupsPage user={user} showToast={showToast}/>
      )}

      {sectionHeading('trash')}
      {show('trash') && (
        <TrashPage user={user}/>
      )}

      {sectionHeading('admin')}
      {show('admin') && isPlatformAdmin && (
        <AdminSettingsPanel user={user} T={T} showToast={showToast}/>
      )}

      {sectionHeading('referral')}
      {show('referral') && (
        <ReferralPanel user={user} T={T} showToast={showToast}/>
      )}

      {/* ── HELP & GUIDES TAB ── */}
      {sectionHeading('help')}
      {show('help') && (
        <Suspense fallback={null}>
          <HelpCenter/>
        </Suspense>
      )}

      {/* ── REPORTING TAB ── */}
      {sectionHeading('reporting')}
      {show('reporting') && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Default Reporting Period</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20,lineHeight:1.7}}>
            Choose whether reports default to the UK tax year (6 Apr — 5 Apr), the calendar year (1 Jan — 31 Dec), or a custom date range you set yourself. You can always override this when running individual reports.
          </div>
          {scopedCompanies.map(company => {
            const cs = companySettings[company.id] || {}
            // Normalise legacy short forms ('tax'/'calendar') to the canonical keys.
            const rawType = cs.year_type || 'tax_year'
            const yearType = rawType==='tax' ? 'tax_year' : rawType==='calendar' ? 'calendar_year' : rawType
            // Persist a patch on top of the company's existing settings row.
            const saveSettings = async(patch)=>{
              const updated={...cs,...patch}
              try{
                const saved=await api.upsertCompanySettings(company.id,updated)
                setCompanySettings(prev=>({...prev,[company.id]:saved||updated}))
                showToast('Reporting period saved')
              }catch(e){showToast(e.message,'error')}
            }
            const dateInputStyle={fontFamily:mono,fontSize:12,padding:'8px 10px',borderRadius:8,border:`1px solid ${T.border}`,background:T.bg,color:T.text}
            return (
              <div key={company.id} style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                  <span style={{fontFamily:mono,fontSize:FS.xs,fontWeight:700,color:company.color,background:company.color+'22',padding:'2px 8px',borderRadius:4}}>{company.abbr}</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{company.name}</span>
                </div>
                <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                  {[{k:'tax_year',label:'UK Tax Year',sub:'6 Apr — 5 Apr'},{k:'calendar_year',label:'Calendar Year',sub:'1 Jan — 31 Dec'},{k:'custom',label:'Custom Dates',sub:'Set your own range'}].map(opt=>(
                    <button key={opt.k} onClick={()=>saveSettings({year_type:opt.k})}
                    style={{fontFamily:mono,fontSize:11,padding:'10px 16px',borderRadius:10,cursor:'pointer',textAlign:'left',
                      border:`2px solid ${yearType===opt.k?T.gold:T.border}`,
                      background:yearType===opt.k?T.gold+'11':T.bg,
                      color:yearType===opt.k?T.goldText:T.text,transition:'all 0.2s'}}>
                      <div style={{fontWeight:700,marginBottom:2}}>{opt.label}</div>
                      <div style={{fontSize:FS.xs,color:yearType===opt.k?T.goldText:T.muted}}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
                {yearType==='custom' && (
                  <div style={{display:'flex',gap:14,flexWrap:'wrap',marginTop:14}}>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      <label style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Start date</label>
                      <input aria-label="Start date" type="date" value={cs.custom_period_start||''} max={cs.custom_period_end||undefined}
                        onChange={e=>{
                          const start=e.target.value
                          if(cs.custom_period_end && start && start>cs.custom_period_end){showToast('Start date must be on or before the end date','error');return}
                          saveSettings({year_type:'custom',custom_period_start:start||null})
                        }}
                        style={dateInputStyle}/>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      <label style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>End date</label>
                      <input aria-label="End date" type="date" value={cs.custom_period_end||''} min={cs.custom_period_start||undefined}
                        onChange={e=>{
                          const end=e.target.value
                          if(cs.custom_period_start && end && end<cs.custom_period_start){showToast('End date must be on or after the start date','error');return}
                          saveSettings({year_type:'custom',custom_period_end:end||null})
                        }}
                        style={dateInputStyle}/>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── TEAM & ACCESS TAB ── */}
      {sectionHeading('team')}
      {show('team') && (
        <>
          {isAdmin&&(
            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>User Access</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:4}}>Manage who can access each company in your portfolio, and what each member may do there (Viewer, Rent Tracker Editor, Editor or Admin).</div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16}}>Signed in as <span style={{color:T.goldText}}>{user?.email}</span></div>
              <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowAccessModal(true)}>Manage User Access</button>
            </div>
          )}
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Audit Log</div>
            <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16,lineHeight:1.7}}>A full record of all actions taken in your account — for GDPR compliance and dispute resolution.</div>
            <AuditLogPanel user={user} companies={companies} T={T}/>
          </div>
        </>
      )}

      </div>{/* /settings content */}
      </div>{/* /settings flex row */}

      {showAccessModal&&<AccessModal companies={companies} onClose={()=>setShowAccessModal(false)} showToast={showToast} user={user} permissionsMap={permissionsMap} devModeActive={devModeActive}/>}
    </div>
  )
}
