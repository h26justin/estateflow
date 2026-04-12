import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'

const mono = "'DM Mono',monospace"
const PRIORITY_CFG = {
  urgent: { color:'#E05555', label:'Urgent' },
  high:   { color:'#E0943A', label:'High' },
  normal: { color:'#4B8FE0', label:'Normal' },
}
const STATUS_CFG = {
  open:          { bg:'#E0943A22', color:'#E0943A', label:'Open' },
  'in-progress': { bg:'#4B8FE022', color:'#4B8FE0', label:'In progress' },
  complete:      { bg:'#2ECC8A22', color:'#2ECC8A', label:'Complete' },
}

export default function TenantInbox({ user, companies, showToast }) {
  const { T } = useTheme()
  const [inbox, setInbox]           = useState({ messages: [], maintenance: [] })
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState('all')
  const [expanded, setExpanded]     = useState(null)
  const [replyText, setReplyText]   = useState('')
  const [replying, setReplying]     = useState(false)
  const [thread, setThread]         = useState([])
  const [loadingThread, setLoadingThread] = useState(false)

  useEffect(() => { loadInbox() }, [])

  async function loadInbox() {
    setLoading(true)
    try {
      const data = await api.fetchTenantInbox(user.id)
      setInbox(data)
    } catch(e) {}
    setLoading(false)
  }

  async function openMessage(msg) {
    if (expanded?.id === msg.id && expanded?.type === 'message') { setExpanded(null); return }
    setExpanded({ ...msg, type: 'message' })
    setLoadingThread(true)
    try {
      const all = await api.fetchAllTenantMessages(msg.property_id)
      setThread(all)
      // Mark as read
      await api.markTenantMessageReadByLandlord(msg.id)
      setInbox(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== msg.id) }))
    } catch(e) {}
    setLoadingThread(false)
  }

  async function openJob(job) {
    if (expanded?.id === job.id && expanded?.type === 'job') { setExpanded(null); return }
    setExpanded({ ...job, type: 'job' })
    // Load message thread for this property/tenant combo
    setLoadingThread(true)
    try {
      const all = await api.fetchAllTenantMessages(job.property_id)
      setThread(all)
    } catch(e) {}
    setLoadingThread(false)
  }

  async function sendReply() {
    if (!replyText.trim() || !expanded) return
    setReplying(true)
    try {
      const tenantId = expanded.tenant_user_id || expanded.user_id
      const msg = await api.replyToTenantMessage(expanded.property_id, tenantId, replyText.trim())
      setThread(prev => [...prev, msg])
      setReplyText('')
      showToast('Reply sent to tenant')
    } catch(e) { showToast(e.message, 'error') }
    setReplying(false)
  }

  const allItems = [
    ...inbox.messages.map(m => ({ ...m, itemType: 'message', date: new Date(m.created_at) })),
    ...inbox.maintenance.map(j => ({ ...j, itemType: 'job', date: new Date(j.created_at) })),
  ].sort((a, b) => b.date - a.date)

  const filtered = activeTab === 'all' ? allItems
    : activeTab === 'messages' ? allItems.filter(i => i.itemType === 'message')
    : allItems.filter(i => i.itemType === 'job')

  const unreadMsg  = inbox.messages.length
  const unreadJobs = inbox.maintenance.filter(j => j.status === 'open').length
  const totalUnread = unreadMsg + unreadJobs

  const tabBtn = k => ({
    fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 20,
    border: `1px solid ${activeTab===k ? T.gold : T.border}`,
    background: activeTab===k ? T.gold+'22' : 'transparent',
    color: activeTab===k ? T.gold : T.muted, cursor: 'pointer',
  })

  if (loading) return (
    <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: '16px 0' }}>Loading tenant inbox…</div>
  )

  return (
    <div style={{ marginTop: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Tenant inbox</h2>
          {totalUnread > 0 && (
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: T.red + '22', color: T.red }}>
              {totalUnread} new
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={tabBtn('all')} onClick={() => setActiveTab('all')}>All {allItems.length > 0 && `(${allItems.length})`}</button>
          <button style={tabBtn('messages')} onClick={() => setActiveTab('messages')}>
            Messages {unreadMsg > 0 && `• ${unreadMsg}`}
          </button>
          <button style={tabBtn('jobs')} onClick={() => setActiveTab('jobs')}>
            Repairs {unreadJobs > 0 && `• ${unreadJobs}`}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>
            {activeTab === 'all' ? 'No new tenant messages or repair requests.' : `No ${activeTab === 'messages' ? 'unread messages' : 'repair requests'}.`}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map(item => (
            <div key={item.id}>
              {/* Card */}
              <div onClick={() => item.itemType === 'message' ? openMessage(item) : openJob(item)}
                style={{ background: T.card, border: `1px solid ${expanded?.id === item.id ? T.gold : T.border}`, borderRadius: 12, padding: '14px 18px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = T.gold + '88'}
                onMouseLeave={e => e.currentTarget.style.borderColor = expanded?.id === item.id ? T.gold : T.border}>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Icon */}
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: item.itemType === 'message' ? T.gold + '22' : T.red + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {item.itemType === 'message' ? '✉' : '🔧'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <div>
                        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, marginRight: 8,
                          background: item.itemType === 'message' ? T.gold + '22' : T.red + '22',
                          color: item.itemType === 'message' ? T.gold : T.red }}>
                          {item.itemType === 'message' ? 'Message' : 'Repair request'}
                        </span>
                        {item.priority && item.priority !== 'normal' && (
                          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: PRIORITY_CFG[item.priority]?.color + '22', color: PRIORITY_CFG[item.priority]?.color }}>
                            ⚑ {PRIORITY_CFG[item.priority]?.label}
                          </span>
                        )}
                      </div>
                      <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, flexShrink: 0 }}>
                        {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {new Date(item.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 3 }}>
                      {item.itemType === 'message' ? item.message?.substring(0, 80) + (item.message?.length > 80 ? '…' : '') : item.title || item.description?.substring(0, 60)}
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                        📍 {item.property?.address || item.property?.name || '—'}
                      </span>
                      {item.itemType === 'job' && item.status && (
                        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: STATUS_CFG[item.status]?.bg, color: STATUS_CFG[item.status]?.color }}>
                          {STATUS_CFG[item.status]?.label}
                        </span>
                      )}
                      {item.itemType === 'message' && (
                        <span style={{ fontFamily: mono, fontSize: 10, color: T.gold, fontWeight: 700 }}>● Unread</span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, flexShrink: 0 }}>
                    {expanded?.id === item.id ? '▲' : '▼'}
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {expanded?.id === item.id && (
                <div style={{ background: T.surface, border: `1px solid ${T.gold}44`, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '20px 18px' }}>
                  {item.itemType === 'job' && (
                    <>
                      {/* Maintenance detail */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Repair details</div>
                        {item.description && <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 10 }}>{item.description}</div>}
                        {/* Photos */}
                        {Array.isArray(item.photos) && item.photos.length > 0 && (
                          <div>
                            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 8 }}>Photos from tenant:</div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              {item.photos.map((p, i) => (
                                <a key={i} href={p.url} target="_blank" rel="noreferrer">
                                  <img src={p.url} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.border}`, cursor: 'pointer' }}/>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Update status */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Update status</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {['open', 'in-progress', 'complete'].map(s => (
                            <button key={s} onClick={async () => {
                              try {
                                await api.updateMaintenance(item.id, { status: s })
                                setInbox(prev => ({ ...prev, maintenance: prev.maintenance.map(j => j.id === item.id ? { ...j, status: s } : j) }))
                                setExpanded(prev => ({ ...prev, status: s }))
                                showToast('Status updated')
                              } catch(e) {}
                            }} style={{ fontFamily: mono, fontSize: 11, padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                              border: `1px solid ${STATUS_CFG[s]?.color}44`,
                              background: item.status === s ? STATUS_CFG[s]?.color + '33' : 'transparent',
                              color: STATUS_CFG[s]?.color, fontWeight: item.status === s ? 700 : 400 }}>
                              {STATUS_CFG[s]?.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Message thread */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                      {item.itemType === 'message' ? 'Full conversation' : 'Messages with tenant'}
                    </div>
                    {loadingThread ? (
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
                    ) : thread.length === 0 ? (
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>No messages yet.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', padding: '4px 0' }}>
                        {thread.map(m => {
                          const isLandlord = m.sender_type === 'landlord'
                          return (
                            <div key={m.id} style={{ display: 'flex', justifyContent: isLandlord ? 'flex-end' : 'flex-start' }}>
                              <div style={{ maxWidth: '75%', background: isLandlord ? T.gold + '22' : T.bg, borderRadius: isLandlord ? '12px 12px 4px 12px' : '12px 12px 12px 4px', padding: '8px 12px', border: `1px solid ${isLandlord ? T.gold + '44' : T.border}` }}>
                                <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginBottom: 4 }}>{isLandlord ? 'You' : 'Tenant'} · {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} {new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                                <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.6 }}>{m.message}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Reply box */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input value={replyText} onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendReply())}
                      placeholder="Reply to tenant…"
                      style={{ flex: 1, fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none' }}/>
                    <button onClick={sendReply} disabled={replying || !replyText.trim()}
                      style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: replying || !replyText.trim() ? T.border : T.gold, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
                      {replying ? '…' : 'Reply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
