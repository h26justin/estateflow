import { useState, useEffect } from 'react'
import { MONO, CV, FS } from '../../lib/styles'
import { naturalCompare } from '../../lib/addressUtils'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { pressable } from '../../lib/pressable'
import { Button } from '../ui'

// ── TENANT PORTAL SETTINGS ────────────────────────────────────────────────────
export function TenantPortalSettings({ companies, companySettings, setCompanySettings, showToast, T }) {
  const mono = MONO
  const [selectedCo, setSelectedCo] = useState(companies[0]?.id || '')
  const [mode, setMode]           = useState('landlord')
  const [agentName, setAgentName] = useState('')
  const [agentPhone, setAgentPhone] = useState('')
  const [agentEmail, setAgentEmail] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [bankName, setBankName]   = useState('')
  const [bankSort, setBankSort]   = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankRef, setBankRef]     = useState('RENT')
  const [saving, setSaving]       = useState(false)
  const [savingBank, setSavingBank] = useState(false)
  const [notifyEmail, setNotifyEmail] = useState('')
  const [savingNotify, setSavingNotify] = useState(false)
  const [inviteProperty, setInviteProperty] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [properties, setProperties] = useState([])

  const co = companies.find(c => c.id === selectedCo)

  // Auto-generate subdomain from company name
  function generateSubdomain(name) {
    return name
      .toLowerCase()
      .replace(/\s+(property|group|ltd|limited|co|company|management|properties)\s*/gi, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
  }

  useEffect(() => {
    if (!selectedCo) return
    const c = companies.find(x => x.id === selectedCo)
    setMode(c?.contact_mode || 'landlord')
    setAgentName(c?.agent_name || '')
    setAgentPhone(c?.agent_phone || '')
    setAgentEmail(c?.agent_email || '')
    // Auto-generate subdomain if not already set
    setSubdomain(c?.subdomain || generateSubdomain(c?.name || ''))
    setInviteLink('')
    supabase.from('properties').select('id,name,address').eq('company_id', selectedCo)
      .then(({data}) => {
        const sorted = (data||[]).sort((a,b)=>naturalCompare(a.name||a.address, b.name||b.address))
        setProperties(sorted); setInviteProperty(sorted[0]?.id||'')
      })
    // Load bank details
    api.fetchCompanyBankDetails(selectedCo).then(b => {
      setBankName(b.bank_name||''); setBankSort(b.bank_sort_code||'')
      setBankAccount(b.bank_account_no||''); setBankRef(b.bank_reference_prefix||'RENT')
      setNotifyEmail(b.tenant_notification_email||'')
    }).catch(()=>{})
    // Seed the drafts only when switching company: a refreshed `companies`
    // prop (e.g. after a save) must not overwrite fields being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCo])

  async function saveContact() {
    setSaving(true)
    try {
      await api.saveCompanyContactMode(selectedCo, mode, agentName, agentPhone, agentEmail)
      if (subdomain) await api.saveCompanySubdomain(selectedCo, subdomain)
      showToast('Settings saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(false)
  }

  async function saveBank() {
    setSavingBank(true)
    try {
      await api.saveCompanyBankDetails(selectedCo, { bank_name:bankName, bank_sort_code:bankSort, bank_account_no:bankAccount, bank_reference_prefix:bankRef })
      showToast('Bank details saved')
    } catch(e) { showToast(e.message,'error') }
    setSavingBank(false)
  }

  async function saveNotifyEmail() {
    setSavingNotify(true)
    try {
      await api.saveTenantNotificationEmail(selectedCo, notifyEmail)
      showToast('Notification email saved')
    } catch(e) { showToast(e.message,'error') }
    setSavingNotify(false)
  }

  async function generateInviteLink() {
    if (!inviteProperty) { showToast('Select a property first','error'); return }
    try {
      // Invites are DB-issued single-use tokens (tenant_invites) — raw
      // `?tenant_property=<uuid>` links are no longer honoured.
      const { data: { session } } = await supabase.auth.getSession()
      const { signupUrl } = await api.inviteTenant(inviteProperty, null, session?.user?.id ?? null)
      setInviteLink(signupUrl)
      showToast('Invite link generated')
    } catch(e) { showToast(e.message,'error') }
  }

  const inp = { fontFamily:mono, fontSize:12, background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'8px 12px', outline:'none', width:'100%' }
  const lbl = { fontFamily:mono, fontSize:FS.xs, color:T.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }

  return (
    <div>
      {companies.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Company</label>
          <select aria-label="Company" value={selectedCo} onChange={e=>setSelectedCo(e.target.value)} style={inp}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Subdomain */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Tenant portal subdomain</div>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12 }}>
          <input value={subdomain} onChange={e=>setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}
            placeholder="e.g. nouchette"
            style={{...inp, width:'auto', flex:1}}/>
          <span style={{ fontFamily:mono, fontSize:12, color:T.muted, flexShrink:0 }}>.ownproperly.com</span>
        </div>
        {subdomain && (
          <div style={{ background:T.gold+'18', border:`1px solid ${T.gold}44`, borderRadius:8, padding:'10px 14px', marginBottom:10 }}>
            <div style={{ fontFamily:mono, fontSize:11, color:T.muted, marginBottom:4 }}>Tenant portal URL:</div>
            <div style={{ fontFamily:mono, fontSize:13, fontWeight:700, color:T.goldText }}>
              https://{subdomain}.ownproperly.com
            </div>
          </div>
        )}
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, lineHeight:1.6 }}>
          Auto-generated from company name. Lowercase letters, numbers and hyphens only.
        </div>
      </div>

      {/* Contact mode */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>Contact mode</div>
        <div style={{ display:'grid', gap:10, marginBottom:16 }}>
          {[
            ['landlord','Landlord mode','Tenants message you via the portal. No direct contact details shown.'],
            ['agent','Managing agent mode','Tenants see the agent name, phone and email instead of yours.'],
          ].map(([k,l,d])=>(
            <div key={k} {...pressable(()=>setMode(k), { role: 'radio', 'aria-checked': mode===k })} style={{ display:'flex', gap:14, padding:'14px 16px', borderRadius:10, cursor:'pointer',
              border:`2px solid ${mode===k?T.gold:T.border}`, background:mode===k?T.gold+'11':T.bg }}>
              <div style={{ width:18, height:18, borderRadius:9, border:`2px solid ${mode===k?T.gold:T.border}`, background:mode===k?T.gold:'transparent', flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{l}</div>
                <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
        {mode==='agent' && (
          <div style={{ background:T.bg, borderRadius:10, padding:16, marginBottom:16 }}>
            <div style={{ display:'grid', gap:10 }}>
              <div><label style={lbl}>Agent / company name</label><input aria-label="Agent / company name" value={agentName} onChange={e=>setAgentName(e.target.value)} placeholder="Smith Property Management" style={inp}/></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><label style={lbl}>Phone</label><input aria-label="Phone" value={agentPhone} onChange={e=>setAgentPhone(e.target.value)} placeholder="01234 567890" style={inp}/></div>
                <div><label style={lbl}>Email</label><input aria-label="Email" value={agentEmail} onChange={e=>setAgentEmail(e.target.value)} placeholder="agent@firm.com" style={inp}/></div>
              </div>
            </div>
          </div>
        )}
        <Button onClick={saveContact} disabled={saving}>
          {saving?'Saving…':'Save contact & subdomain settings'}
        </Button>
      </div>

      {/* Bank details */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Bank payment details</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          These details are shown to tenants on their Home and Rent tabs so they know where to pay.
        </div>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          <div><label style={lbl}>Bank name</label><input aria-label="Bank name" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. NatWest" style={inp}/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div><label style={lbl}>Sort code</label><input aria-label="Sort code" value={bankSort} onChange={e=>setBankSort(e.target.value)} placeholder="00-00-00" style={inp}/></div>
            <div><label style={lbl}>Account number</label><input aria-label="Account number" value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder="12345678" style={inp}/></div>
          </div>
          <div><label style={lbl}>Reference prefix</label>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <input value={bankRef} onChange={e=>setBankRef(e.target.value.toUpperCase())} placeholder="RENT" style={{...inp,width:'auto'}}/>
              <span style={{ fontFamily:mono, fontSize:11, color:T.muted }}>e.g. RENT-14MAPLESTREET</span>
            </div>
          </div>
        </div>
        <Button onClick={saveBank} disabled={savingBank}>
          {savingBank?'Saving…':'Save bank details'}
        </Button>
      </div>

      {/* Notification email */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Tenant notification email</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          When a tenant submits a repair request or sends a message, we will email this address instantly. Leave blank to disable email notifications.
        </div>
        <div style={{ display:'flex', gap:10, marginBottom:0 }}>
          <input value={notifyEmail} onChange={e=>setNotifyEmail(e.target.value)} type="email"
            placeholder="e.g. justin@jvhammond.com"
            style={{...inp, flex:1}}/>
          <Button onClick={saveNotifyEmail} disabled={savingNotify} style={{flexShrink:0}}>
            {savingNotify?'Saving…':'Save'}
          </Button>
        </div>
      </div>

      {/* Invite tenant */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px' }}>
        <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Invite a tenant</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          Generate a sign-up link for a specific property. Share it with your tenant — when they create an account, they're automatically linked to that property.
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={lbl}>Property</label>
          <select aria-label="Property" value={inviteProperty} onChange={e=>setInviteProperty(e.target.value)} style={inp}>
            {properties.map(p=><option key={p.id} value={p.id}>{p.address||p.name}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:10, marginBottom: inviteLink ? 14 : 0, flexWrap:'wrap' }}>
          <Button onClick={generateInviteLink} disabled={!inviteProperty}>
            Generate invite link
          </Button>
          {inviteLink && (
            <div style={{ display:'flex', gap:8, alignItems:'center', flex:1, minWidth:240 }}>
              <input
                type="email"
                placeholder="tenant@email.com"
                id="tenant-invite-email"
                style={{ ...inp, flex:1 }}
              />
              <button
                onClick={async () => {
                  const emailInput = document.getElementById('tenant-invite-email')
                  const email = emailInput?.value?.trim()
                  if (!email) { showToast('Enter tenant email first', 'error'); return }
                  try {
                    const { data: { session } } = await supabase.auth.getSession()
                    const prop = properties.find(p => p.id === inviteProperty)
                    const co = companies.find(c => c.id === selectedCo)
                    await api.sendTenantInviteEmail(session, email, inviteProperty, prop?.address || prop?.name, co?.name)
                    showToast(`Invite sent to ${email}`)
                    if (emailInput) emailInput.value = ''
                  } catch(e) { showToast(e.message || 'Failed to send', 'error') }
                }}
                style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 16px', borderRadius:8, border:'none', background:T.blue, color:'white', cursor:'pointer', flexShrink:0 }}>
                Email invite
              </button>
            </div>
          )}
        </div>
        {inviteLink && (
          <div style={{ background:T.bg, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, marginBottom:8 }}>Share this with your tenant:</div>
            <div style={{ display:'flex', gap:10 }}>
              <input readOnly value={inviteLink} style={{ ...inp, color:T.goldText, fontWeight:600 }}/>
              <button onClick={()=>{navigator.clipboard.writeText(inviteLink);showToast('Copied!')}}
                style={{ fontFamily:mono, fontSize:11, padding:'8px 14px', borderRadius:8, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer', flexShrink:0 }}>
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
