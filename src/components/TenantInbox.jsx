import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'

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
  const [view, setView]               = useState('inbox')   // inbox | messages | repairs | all
  const [jobs, setJobs]               = useState([])
  const [convos, setConvos]           = useState([])        // all property conversations
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [thread, setThread]           = useState([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [replyText, setReplyText]     = useState('')
  const [replying, setReplying]       = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { loadAll() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread])

  async function loadAll() {
    setLoading(true)
    try {
      // Get all properties for this user
      const { data: props } = await supabase.from('properties')
        .select('id, name, address, company_id').eq('user_id', user.id)
      
      if (!props?.length) { setLoading(false); return }
      const propIds = props.map(p => p.id)
      const propMap = Object.fromEntries(props.map(p => [p.id, p]))

      // Get ALL tenant-reported maintenance jobs (not just open)
      const { data: allJobs } = await supabase.from('maintenance_jobs')
        .select('*').in('property_id', propIds)
        .eq('reported_by_tenant', true)
        .order('created_at', { ascending: false })

      // Get all tenant messages grouped by property (latest per property)
      const { data: allMessages } = await supabase.from('tenant_messages')
        .select('*').in('property_id', propIds)
        .order('created_at', { ascending: false })

      // Build conversations — one per property that has messages
      const convoMap = {}
      for (const msg of (allMessages || [])) {
        const propId = msg.property_id
        if (!convoMap[propId]) {
          convoMap[propId] = {
            property_id: propId,
            property: propMap[propId],
            tenant_user_id: msg.tenant_user_id,
            last_message: msg,
            unread_count: 0,
            messages: [],
          }
        }
        convoMap[propId].messages.push(msg)
        if (msg.sender_type === 'tenant' && !msg.read_at) {
          convoMap[propId].unread_count++
        }
      }

      setJobs((allJobs || []).map(j => ({ ...j, property: propMap[j.property_id] })))
      setConvos(Object.values(convoMap).sort((a, b) =>
        new Date(b.last_message.created_at) - new Date(a.last_message.created_at)
      ))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  async function openJob(job) {
    if (expanded?.id === job.id && expanded?.itemType === 'job') { setExpanded(null); return }
    setExpanded({ ...job, itemType: 'job' })
    // Load the message thread for this property
    setLoadingThread(true)
    try {
      const msgs = await api.fetchAllTenantMessages(job.property_id)
      setThread(msgs)
    } catch(e) {}
    setLoadingThread(false)
  }

  async function openConvo(convo) {
    if (expanded?.property_id === convo.property_id && expanded?.itemType === 'convo') {
      setExpanded(null); return
    }
    setExpanded({ ...convo, itemType: 'convo' })
    setLoadingThread(true)
    try {
      const msgs = await api.fetchAllTenantMessages(convo.property_id)
      setThread(msgs)
      // Mark all unread as read
      for (const msg of msgs.filter(m => m.sender_type === 'tenant' && !m.read_at)) {
        await api.markTenantMessageReadByLandlord(msg.id)
      }
      // Update unread count in state
      setConvos(prev => prev.map(c =>
        c.property_id === convo.property_id ? { ...c, unread_count: 0 } : c
      ))
    } catch(e) {}
    setLoadingThread(false)
  }

  async function updateJobStatus(jobId, status) {
    try {
      await api.updateMaintenance(jobId, { status })
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j))
      if (expanded?.id === jobId) setExpanded(prev => ({ ...prev, status }))
      showToast(`Repair marked as ${status}`)
    } catch(e) { showToast(e.message, 'error') }
  }

  async function sendReply() {
    if (!replyText.trim() || !expanded) return
    setReplying(true)
    try {
      const tenantId = expanded.tenant_user_id
      const propId   = expanded.property_id
      const msg = await api.replyToTenantMessage(propId, tenantId, replyText.trim())
      setThread(prev => [...prev, msg])
      setReplyText('')
      // Update last message in conversations
      setConvos(prev => prev.map(c =>
        c.property_id === propId ? { ...c, last_message: msg } : c
      ))
    } catch(e) { showToast(e.message, 'error') }
    setReplying(false)
  }

  // Counts
  const unreadMessages = convos.reduce((s, c) => s + c.unread_count, 0)
  const openJobs       = jobs.filter(j => j.status !== 'complete').length
  const totalUnread    = unreadMessages + openJobs

  const activeJobs     = jobs.filter(j => j.status !== 'complete')
  const archivedJobs   = jobs.filter(j => j.status === 'complete')
  const displayJobs    = showArchived ? jobs : activeJobs

  const tabBtn = (k, label, count) => (
    <button onClick={() => { setView(k); setExpanded(null) }}
      style={{ fontFamily:mono, fontSize:11, padding:'6px 16px', borderRadius:20, cursor:'pointer',
        border:`1px solid ${view===k ? T.gold : T.border}`,
        background: view===k ? T.gold+'22' : 'transparent',
        color: view===k ? T.gold : T.muted }}>
      {label}{count > 0 ? ` (${count})` : ''}
    </button>
  )

  if (loading) return <div style={{ fontFamily:mono, fontSize:12, color:T.muted, padding:'16px 0' }}>Loading tenant inbox…</div>

  const hasAnything = jobs.length > 0 || convos.length > 0

  return (
    <div style={{ marginTop: 28 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <h2 style={{ fontSize:18, fontWeight:600, letterSpacing:'-0.02em', margin:0 }}>Tenant inbox</h2>
          {totalUnread > 0 && (
            <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20, background:T.red+'22', color:T.red }}>
              {totalUnread} new
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {tabBtn('inbox',    '📬 Inbox',    totalUnread)}
          {tabBtn('repairs',  '🔧 Repairs',  openJobs)}
          {tabBtn('messages', '✉ Messages',  unreadMessages)}
        </div>
      </div>

      {!hasAnything && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'32px 24px', textAlign:'center' }}>
          <div style={{ fontSize:28, marginBottom:10 }}>📭</div>
          <div style={{ fontFamily:mono, fontSize:12, color:T.muted }}>No tenant messages or repair requests yet.</div>
          <div style={{ fontFamily:mono, fontSize:11, color:T.muted, marginTop:6 }}>When tenants submit repairs or send messages, they'll appear here.</div>
        </div>
      )}

      {/* ── INBOX VIEW — unread messages + open repairs ── */}
      {view === 'inbox' && hasAnything && (
        <div style={{ display:'grid', gap:10 }}>
          {unreadMessages === 0 && openJobs === 0 && (
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'24px', textAlign:'center', fontFamily:mono, fontSize:12, color:T.green }}>
              ✓ All caught up — no new messages or open repairs.
            </div>
          )}
          {/* Unread conversations */}
          {convos.filter(c => c.unread_count > 0).map(convo => (
            <ConvoCard key={convo.property_id} convo={convo} expanded={expanded} onOpen={openConvo}
              thread={thread} loadingThread={loadingThread} replyText={replyText} setReplyText={setReplyText}
              replying={replying} onReply={sendReply} bottomRef={bottomRef} T={T}/>
          ))}
          {/* Open repairs */}
          {activeJobs.map(job => (
            <JobCard key={job.id} job={job} expanded={expanded} onOpen={openJob}
              onStatusChange={updateJobStatus} thread={thread} loadingThread={loadingThread}
              replyText={replyText} setReplyText={setReplyText} replying={replying}
              onReply={sendReply} bottomRef={bottomRef} T={T}/>
          ))}
        </div>
      )}

      {/* ── REPAIRS VIEW — all repairs with archive ── */}
      {view === 'repairs' && (
        <div>
          {displayJobs.length === 0 && !showArchived && (
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'24px', textAlign:'center', fontFamily:mono, fontSize:12, color:T.muted }}>
              No open repairs. {archivedJobs.length > 0 && 'See archived repairs below.'}
            </div>
          )}
          <div style={{ display:'grid', gap:10 }}>
            {displayJobs.map(job => (
              <JobCard key={job.id} job={job} expanded={expanded} onOpen={openJob}
                onStatusChange={updateJobStatus} thread={thread} loadingThread={loadingThread}
                replyText={replyText} setReplyText={setReplyText} replying={replying}
                onReply={sendReply} bottomRef={bottomRef} T={T}/>
            ))}
          </div>
          {archivedJobs.length > 0 && (
            <button onClick={() => setShowArchived(v => !v)}
              style={{ fontFamily:mono, fontSize:11, marginTop:14, background:'none', border:`1px solid ${T.border}`, color:T.muted, borderRadius:8, padding:'6px 16px', cursor:'pointer' }}>
              {showArchived ? '▲ Hide archived' : `▼ Show ${archivedJobs.length} archived (complete)`}
            </button>
          )}
        </div>
      )}

      {/* ── MESSAGES VIEW — all conversations ── */}
      {view === 'messages' && (
        <div style={{ display:'grid', gap:10 }}>
          {convos.length === 0 && (
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'24px', textAlign:'center', fontFamily:mono, fontSize:12, color:T.muted }}>
              No tenant messages yet.
            </div>
          )}
          {convos.map(convo => (
            <ConvoCard key={convo.property_id} convo={convo} expanded={expanded} onOpen={openConvo}
              thread={thread} loadingThread={loadingThread} replyText={replyText} setReplyText={setReplyText}
              replying={replying} onReply={sendReply} bottomRef={bottomRef} T={T}/>
          ))}
        </div>
      )}
    </div>
  )
}

// ── JOB CARD ─────────────────────────────────────────────────────────────────
function JobCard({ job, expanded, onOpen, onStatusChange, thread, loadingThread, replyText, setReplyText, replying, onReply, bottomRef, T }) {
  const isExpanded = expanded?.id === job.id && expanded?.itemType === 'job'
  const sc = STATUS_CFG[job.status] || STATUS_CFG.open
  const pc = PRIORITY_CFG[job.priority] || PRIORITY_CFG.normal
  const photos = Array.isArray(job.photos) ? job.photos : []

  return (
    <div>
      <div onClick={() => onOpen(job)}
        style={{ background:T.card, border:`1px solid ${isExpanded ? T.gold : job.status==='complete' ? T.border : T.border}`, borderRadius:isExpanded?'12px 12px 0 0':12, padding:'14px 18px', cursor:'pointer', opacity: job.status==='complete' ? 0.7 : 1 }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold+'88'}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isExpanded?T.gold:T.border}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:T.red+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🔧</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>Repair request</span>
                <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:sc.bg, color:sc.color }}>{sc.label}</span>
                {job.priority && job.priority !== 'normal' && (
                  <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:pc.color+'22', color:pc.color }}>⚑ {pc.label}</span>
                )}
              </div>
              <span style={{ fontFamily:mono, fontSize:10, color:T.muted, flexShrink:0 }}>
                {new Date(job.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {new Date(job.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
              </span>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{job.title || 'Repair request'}</div>
            <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>📍 {job.property?.address||job.property?.name||'—'}</div>
          </div>
          <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>{isExpanded?'▲':'▼'}</div>
        </div>
      </div>

      {isExpanded && (
        <div style={{ background:T.surface, border:`1px solid ${T.gold}44`, borderTop:'none', borderRadius:'0 0 12px 12px', padding:'20px 18px' }}>
          {/* Description */}
          {job.description && (
            <div style={{ fontFamily:mono, fontSize:12, color:T.text, lineHeight:1.7, marginBottom:14, padding:'10px 14px', background:T.bg, borderRadius:8 }}>
              {job.description}
            </div>
          )}
          {/* Photos */}
          {photos.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Photos from tenant</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {photos.map((p,i) => (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt="" style={{ width:100, height:100, objectFit:'cover', borderRadius:8, border:`1px solid ${T.border}`, cursor:'pointer' }}/>
                  </a>
                ))}
              </div>
            </div>
          )}
          {/* Status update */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Update status</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {['open','in-progress','complete'].map(s => (
                <button key={s} onClick={() => onStatusChange(job.id, s)}
                  style={{ fontFamily:mono, fontSize:11, padding:'5px 14px', borderRadius:20, cursor:'pointer',
                    border:`1px solid ${STATUS_CFG[s]?.color}44`,
                    background: job.status===s ? STATUS_CFG[s]?.color+'33' : 'transparent',
                    color: STATUS_CFG[s]?.color, fontWeight: job.status===s ? 700 : 400 }}>
                  {STATUS_CFG[s]?.label}
                </button>
              ))}
            </div>
            {job.status === 'complete' && (
              <div style={{ fontFamily:mono, fontSize:10, color:T.green, marginTop:8 }}>
                ✓ Marked complete — this repair will move to the archive
              </div>
            )}
          </div>
          {/* Message thread */}
          <MessageThread thread={thread} loading={loadingThread} replyText={replyText}
            setReplyText={setReplyText} replying={replying} onReply={onReply} bottomRef={bottomRef} T={T}/>
        </div>
      )}
    </div>
  )
}

// ── CONVERSATION CARD ─────────────────────────────────────────────────────────
function ConvoCard({ convo, expanded, onOpen, thread, loadingThread, replyText, setReplyText, replying, onReply, bottomRef, T }) {
  const isExpanded = expanded?.property_id === convo.property_id && expanded?.itemType === 'convo'
  const lastMsg = convo.last_message
  const hasUnread = convo.unread_count > 0

  return (
    <div>
      <div onClick={() => onOpen(convo)}
        style={{ background:T.card, border:`1px solid ${isExpanded ? T.gold : hasUnread ? T.gold+'44' : T.border}`, borderRadius:isExpanded?'12px 12px 0 0':12, padding:'14px 18px', cursor:'pointer' }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold+'88'}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isExpanded?T.gold:hasUnread?T.gold+'44':T.border}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:T.gold+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>✉</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.gold+'22', color:T.gold }}>Message</span>
                {hasUnread && <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>{convo.unread_count} unread</span>}
              </div>
              <span style={{ fontFamily:mono, fontSize:10, color:T.muted, flexShrink:0 }}>
                {new Date(lastMsg.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {new Date(lastMsg.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
              </span>
            </div>
            <div style={{ fontSize:13, fontWeight: hasUnread ? 700 : 400, color:T.text, marginBottom:3 }}>
              {lastMsg.message?.substring(0,80)}{lastMsg.message?.length>80?'…':''}
            </div>
            <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>📍 {convo.property?.address||convo.property?.name||'—'}</div>
          </div>
          <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>{isExpanded?'▲':'▼'}</div>
        </div>
      </div>

      {isExpanded && (
        <div style={{ background:T.surface, border:`1px solid ${T.gold}44`, borderTop:'none', borderRadius:'0 0 12px 12px', padding:'20px 18px' }}>
          <MessageThread thread={thread} loading={loadingThread} replyText={replyText}
            setReplyText={setReplyText} replying={replying} onReply={onReply} bottomRef={bottomRef} T={T}/>
        </div>
      )}
    </div>
  )
}

// ── MESSAGE THREAD ────────────────────────────────────────────────────────────
function MessageThread({ thread, loading, replyText, setReplyText, replying, onReply, bottomRef, T }) {
  return (
    <div>
      <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Conversation</div>
      <div style={{ maxHeight:320, overflowY:'auto', marginBottom:12, padding:'4px 0' }}>
        {loading && <div style={{ fontFamily:mono, fontSize:12, color:T.muted, textAlign:'center', padding:20 }}>Loading…</div>}
        {!loading && thread.length === 0 && (
          <div style={{ fontFamily:mono, fontSize:12, color:T.muted, textAlign:'center', padding:20 }}>No messages in this thread yet.</div>
        )}
        {thread.map(m => {
          const isLandlord = m.sender_type === 'landlord'
          return (
            <div key={m.id} style={{ display:'flex', justifyContent:isLandlord?'flex-end':'flex-start', marginBottom:12 }}>
              <div style={{ maxWidth:'75%' }}>
                <div style={{ fontFamily:mono, fontSize:9, color:T.muted, marginBottom:4, textAlign:isLandlord?'right':'left' }}>
                  {isLandlord?'You':'Tenant'} · {new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} {new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                </div>
                <div style={{ background:isLandlord?T.gold+'22':T.bg, border:`1px solid ${isLandlord?T.gold+'44':T.border}`,
                  borderRadius:isLandlord?'14px 14px 4px 14px':'14px 14px 14px 4px',
                  padding:'10px 14px', fontFamily:mono, fontSize:12, color:T.text, lineHeight:1.7 }}>
                  {m.message}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef}/>
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <input value={replyText} onChange={e=>setReplyText(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),onReply())}
          placeholder="Reply to tenant…"
          style={{ flex:1, fontFamily:mono, fontSize:12, background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'9px 14px', outline:'none' }}/>
        <button onClick={onReply} disabled={replying||!replyText.trim()}
          style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'9px 20px', borderRadius:8, border:'none',
            background:replying||!replyText.trim()?T.border:T.gold, color:'white', cursor:'pointer', flexShrink:0 }}>
          {replying?'…':'Send'}
        </button>
      </div>
    </div>
  )
}
