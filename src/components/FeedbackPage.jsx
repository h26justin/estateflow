import { useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'

export default function FeedbackPage({ user, showToast }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  const [type, setType] = useState('feature')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit() {
    if (!subject.trim() || !message.trim()) { showToast('Please fill in all fields', 'error'); return }
    setSending(true)
    try {
      const typeLabel = type === 'feature' ? 'Feature Request' : type === 'bug' ? 'Bug Report' : 'General Feedback'
      const body = `Type: ${typeLabel}\nFrom: ${user?.email}\n\nSubject: ${subject}\n\n${message}`
      await fetch('https://formsubmit.co/ajax/hello@ownproperly.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          name: user?.email,
          email: user?.email,
          subject: `[Properly ${typeLabel}] ${subject}`,
          message: body,
          _captcha: 'false'
        })
      })
      setSent(true)
      setSubject('')
      setMessage('')
    } catch(e) {
      showToast('Failed to send — please email hello@ownproperly.com directly', 'error')
    }
    setSending(false)
  }

  const inp = { fontFamily: mono, fontSize: 13, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '10px 14px', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }
  const TYPES = [
    { key: 'feature', icon: 'sparkle', label: 'Feature Request', desc: 'Suggest something new' },
    { key: 'bug',     icon: 'alert-circle', label: 'Bug Report',      desc: 'Something not working?' },
    { key: 'general', icon: 'message', label: 'General Feedback', desc: 'Anything else' },
  ]

  return (
    <div className="fade" style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 60px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 4 }}>Feedback</h1>
      <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 28 }}>
        Properly is new and your feedback shapes what we build next. Tell us what is broken, what is missing, or what you love.
      </p>

      {sent ? (
        <div style={{ background: T.card, border: `1px solid ${T.green}44`, borderRadius: 14, padding: '40px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: T.text }}>Thanks for your feedback!</div>
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 20 }}>We read every message and will be in touch if we have questions.</div>
          <button onClick={() => setSent(false)} style={{ fontFamily: mono, fontSize: 12, padding: '8px 20px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
            Send another
          </button>
        </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 24px' }}>

          <div style={{ marginBottom: 20 }}>
            <span style={lbl}>What kind of feedback?</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {TYPES.map(t => (
                <button key={t.key} onClick={() => setType(t.key)} style={{
                  fontFamily: mono, background: type === t.key ? T.gold + '18' : T.bg,
                  border: `1px solid ${type === t.key ? T.gold : T.border}`,
                  borderRadius: 10, padding: '10px 8px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s'
                }}>
                  <div style={{ display:'flex', justifyContent:'center', marginBottom: 4 }}>{ICON_NAMES.includes(t.icon)?<Icon name={t.icon} size={20}/>:t.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: type === t.key ? T.gold : T.text }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Subject</label>
            <input style={inp} value={subject} onChange={e => setSubject(e.target.value)}
              placeholder={type === 'feature' ? 'e.g. Bulk rent payment import' : type === 'bug' ? 'e.g. PDF report not downloading' : 'e.g. Love the compliance tracker'} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Details</label>
            <textarea style={{ ...inp, height: 130, resize: 'vertical', lineHeight: 1.5 }}
              value={message} onChange={e => setMessage(e.target.value)}
              placeholder={type === 'feature' ? 'Describe the feature and how it would help you...' : type === 'bug' ? 'What happened? What did you expect? Steps to reproduce...' : 'Share your thoughts...'} />
          </div>

          <button onClick={handleSubmit} disabled={sending} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            background: sending ? T.border : T.gold, color: sending ? T.muted : '#000',
            fontFamily: mono, fontSize: 13, fontWeight: 700, cursor: sending ? 'default' : 'pointer', transition: 'all 0.2s'
          }}>
            {sending ? 'Sending...' : 'Send Feedback'}
          </button>

          <p style={{ fontFamily: mono, fontSize: 10, color: T.muted, textAlign: 'center', marginTop: 12, marginBottom: 0 }}>
            Or email us directly at{' '}
            <a href="mailto:hello@ownproperly.com" style={{ color: T.gold, textDecoration: 'none' }}>hello@ownproperly.com</a>
          </p>
        </div>
      )}
    </div>
  )
}
