import { useState, useEffect } from 'react'
import { MONO, CV, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { copyToClipboard } from '../../lib/clipboard'

// ── REFERRAL PANEL ────────────────────────────────────────────────────────────
export function ReferralPanel({ user, T, showToast }) {
  const mono = MONO
  const [code, setCode]         = useState('')
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading]   = useState(true)
  const [copied, setCopied]     = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const c = await api.fetchOrCreateReferralCode(user?.id, user?.email)
        setCode(c)
        const r = await api.fetchReferrals(user?.id)
        setReferrals(r)
      } catch(e) {}
      setLoading(false)
    }
    load()
  }, [user?.id, user?.email])

  const referralUrl = `https://www.ownproperly.com?ref=${code}`
  const paying = referrals.filter(r => r.status === 'paying' || r.status === 'rewarded').length

  async function copy() {
    if (await copyToClipboard(referralUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showToast('Referral link copied!')
    } else {
      showToast('Could not copy automatically — select the link and copy it manually.', 'error')
    }
  }

  return (
    <div>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'24px', marginBottom:16 }}>
        <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, marginBottom:12 }}>Refer a landlord, get a free month</div>
        <div style={{ fontFamily:SANS, fontSize:FS.base, color:T.text, lineHeight:1.8, marginBottom:20 }}>
          Share your referral link with another landlord. When they sign up and become a paying customer, we'll give you both a free month.
        </div>
        {loading ? <div style={{ fontFamily:SANS, fontSize:FS.base, color:T.muted }}>Generating your link…</div> : (
          <>
            <div style={{ display:'flex', gap:10, marginBottom:14 }}>
              <input readOnly value={referralUrl}
                style={{ flex:1, fontFamily:SANS, fontSize:FS.sm, background:T.bg, border:`1px solid ${T.border}`, color:T.goldText, borderRadius:8, padding:'9px 12px' }}/>
              <button onClick={copy}
                style={{ fontFamily:SANS, fontSize:FS.sm, fontWeight:700, padding:'9px 18px', borderRadius:8, border:'none', background:copied?T.green:T.gold, color:CV.onGold, cursor:'pointer', transition:'background 0.2s', flexShrink:0 }}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
              {[
                { label:'Links shared', value: referrals.length },
                { label:'Signed up', value: referrals.filter(r=>r.status!=='pending').length },
                { label:'Free months earned', value: paying },
              ].map(k => (
                <div key={k.label} style={{ background:T.bg, borderRadius:8, padding:'12px 14px' }}>
                  <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:k.value>0?T.green:T.text }}>{k.value}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {referrals.length > 0 && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'10px 20px', background:T.bg, borderBottom:`1px solid ${T.border}`, fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>Referral history</div>
          {referrals.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 20px', borderBottom:`1px solid ${T.border}` }}>
              <div>
                <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.text }}>{r.referred_email || 'Link shared'}</div>
                <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted }}>{new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
              </div>
              <span style={{ fontFamily:SANS, fontSize:FS.sm, fontWeight:700, padding:'3px 10px', borderRadius:20,
                background: r.status==='paying'?T.green+'22':r.status==='signed_up'?T.blue+'22':T.border,
                color: r.status==='paying'?T.green:r.status==='signed_up'?T.blue:T.muted }}>
                {r.status === 'paying' ? 'Paying' : r.status === 'signed_up' ? 'Signed up' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
