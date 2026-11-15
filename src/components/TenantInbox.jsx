import { useState, useEffect, useRef, useCallback } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { SignedPhoto } from '../lib/SignedPhoto'
import { pressable } from '../lib/pressable'
import { Skeleton, SkeletonList } from '../lib/Skeleton'
import { Button, EmptyState } from './ui'

const mono = MONO
// Functions of the theme so the colours follow light/dark tokens. Values are
// hex, so callers can still append alpha suffixes.
const priorityCfg = (T) => ({
  urgent: { color:T.red, label:'Urgent' },
  high:   { color:T.amber, label:'High' },
  normal: { color:T.blue, label:'Normal' },
})
const statusCfg = (T) => ({
  open:          { bg:T.amber+'22', color:T.amber, label:'Open' },
  'in-progress': { bg:T.blue+'22', color:T.blue, label:'In progress' },
  complete:      { bg:T.green+'22', color:T.green, label:'Complete' },
})

// One conversation per (property, tenant).
const threadKey = (propertyId, tenantUserId) => `${propertyId}|${tenantUserId || ''}`

export default function TenantInbox({ user, companies, showToast, companySettings = {} }) {
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
  // Stale-response guard for thread loads: opening A then B quickly must not
  // show A's thread under B.
  const threadReq = useRef(0)
  // Scope by the companies the user can see (App's visible companies), not
  // by who created the property: a team-mate's properties were missing.
  const companyKey = (companies || []).map(c => c.id).join(',')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // Live (not trashed) properties in the user's companies
      const companyIds = companyKey ? companyKey.split(',') : []
      if (!companyIds.length) { setJobs([]); setConvos([]); setLoading(false); return }
      const { data: props, error: propErr } = await supabase.from('properties')
        .select('id, name, address, company_id').in('company_id', companyIds).is('deleted_at', null)
      if (propErr) throw propErr
      if (!props?.length) { setJobs([]); setConvos([]); setLoading(false); return }
      const propIds = props.map(p => p.id)
      const propMap = Object.fromEntries(props.map(p => [p.id, p]))

      // Get ALL tenant-reported maintenance jobs (not just open)
      // (Trashed repair requests are excluded — they counted as open.)
      const { data: allJobs, error: jobsErr } = await supabase.from('maintenance_jobs')
        .select('*').in('property_id', propIds)
        .eq('reported_by_tenant', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (jobsErr) throw jobsErr

      // Get all tenant messages grouped by property (latest per property)
      const { data: allMessages, error: msgErr } = await supabase.from('tenant_messages')
        .select('*').in('property_id', propIds)
        .order('created_at', { ascending: false })
      if (msgErr) throw msgErr

      // Build conversations — one per (property, tenant). An HMO has several
      // tenants writing in about the same property: each is its own thread,
      // and a reply goes to that thread's tenant only.
      const convoMap = {}
      for (const msg of (allMessages || [])) {
        const key = threadKey(msg.property_id, msg.tenant_user_id)
        if (!convoMap[key]) {
          convoMap[key] = {
            key,
            property_id: msg.property_id,
            property: propMap[msg.property_id],
            tenant_user_id: msg.tenant_user_id,
            last_message: msg,
            unread_count: 0,
            messages: [],
          }
        }
        convoMap[key].messages.push(msg)
        if (msg.sender_type === 'tenant' && !msg.read_at) {
          convoMap[key].unread_count++
        }
      }
      // How many tenant threads each property has, so a card can say so.
      const perProp = {}
      for (const c of Object.values(convoMap)) perProp[c.property_id] = (perProp[c.property_id] || 0) + 1
      for (const c of Object.values(convoMap)) c.threads_at_property = perProp[c.property_id]

      setJobs((allJobs || []).map(j => ({ ...j, property: propMap[j.property_id] })))
      setConvos(Object.values(convoMap).sort((a, b) =>
        new Date(b.last_message.created_at) - new Date(a.last_message.created_at)
      ))
    } catch(e) {
      console.error(e)
      showToast?.('Could not load the tenant inbox. Refresh to try again.', 'error')
    }
    setLoading(false)
  // showToast is App's stable useCallback; the load is keyed to the company set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey])
  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread])

  async function openJob(job) {
    if (expanded?.id === job.id && expanded?.itemType === 'job') { setExpanded(null); return }
    // A tenant-reported job is owned by the reporting tenant (user_id): its
    // thread and any reply are that tenant's, never another tenant's.
    setExpanded({ ...job, tenant_user_id: job.user_id, itemType: 'job' })
    // Load the message thread for this property and tenant
    const req = ++threadReq.current
    setThread([])
    setLoadingThread(true)
    try {
      const msgs = await api.fetchAllTenantMessages(job.property_id)
      if (req !== threadReq.current) return
      setThread(msgs.filter(m => m.tenant_user_id === job.user_id))
    } catch(e) {
      if (req !== threadReq.current) return
      showToast?.('Could not load the messages for this property', 'error')
    }
    setLoadingThread(false)
  }

  async function openConvo(convo) {
    if (expanded?.key === convo.key && expanded?.itemType === 'convo') {
      setExpanded(null); return
    }
    setExpanded({ ...convo, itemType: 'convo' })
    const req = ++threadReq.current
    setThread([])
    setLoadingThread(true)
    try {
      const all = await api.fetchAllTenantMessages(convo.property_id)
      if (req !== threadReq.current) return
      const msgs = all.filter(m => threadKey(m.property_id, m.tenant_user_id) === convo.key)
      setThread(msgs)
      // Mark all unread as read
      for (const msg of msgs.filter(m => m.sender_type === 'tenant' && !m.read_at)) {
        await api.markTenantMessageReadByLandlord(msg.id)
      }
      // Update unread count in state
      setConvos(prev => prev.map(c =>
        c.key === convo.key ? { ...c, unread_count: 0 } : c
      ))
    } catch(e) {
      if (req !== threadReq.current) return
      showToast?.('Could not load this conversation', 'error')
    }
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
      if (!tenantId) throw new Error('No tenant is linked to this thread, so the reply has nowhere to go')
      const msg = await api.replyToTenantMessage(propId, tenantId, replyText.trim())
      setThread(prev => [...prev, msg])
      setReplyText('')
      // Update last message in this tenant's conversation only
      const key = threadKey(propId, tenantId)
      setConvos(prev => prev.map(c =>
        c.key === key ? { ...c, last_message: msg } : c
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
      style={{ fontFamily:SANS, fontSize:FS.sm, padding:'6px 16px', borderRadius:20, cursor:'pointer',
        border:`1px solid ${view===k ? T.gold : T.border}`,
        background: view===k ? T.gold+'22' : 'transparent',
        color: view===k ? T.goldText : T.muted }}>
      {label}{count > 0 ? ` (${count})` : ''}
    </button>
  )

  if (loading) return <div style={{ padding:'16px 0' }}><SkeletonList count={3}/></div>

  const hasAnything = jobs.length > 0 || convos.length > 0

  return (
    <div style={{ marginTop: 28 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <h2 style={{ fontSize:18, fontWeight:600, letterSpacing:'-0.02em', margin:0 }}>Tenant inbox</h2>
          {totalUnread > 0 && (
            <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'3px 10px', borderRadius:20, background:T.red+'22', color:T.red }}>
              {totalUnread} new
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {tabBtn('inbox',    'Inbox',    totalUnread)}
          {tabBtn('repairs',  'Repairs',  openJobs)}
          {tabBtn('messages', 'Messages',  unreadMessages)}
        </div>
      </div>

      {!hasAnything && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12 }}>
          <EmptyState compact icon="inbox" title="No tenant messages or repair requests yet." body="When tenants submit repairs or send messages, they'll appear here."/>
        </div>
      )}

      {/* ── INBOX VIEW — unread messages + open repairs ── */}
      {view === 'inbox' && hasAnything && (
        <div style={{ display:'grid', gap:10 }}>
          {unreadMessages === 0 && openJobs === 0 && (
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'24px', textAlign:'center', fontFamily:SANS, fontSize:FS.base, color:T.green }}>
              All caught up — no new messages or open repairs.
            </div>
          )}
          {/* Unread conversations */}
          {convos.filter(c => c.unread_count > 0).map(convo => (
            <ConvoCard key={convo.key} convo={convo} expanded={expanded} onOpen={openConvo}
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
              style={{ fontFamily:SANS, fontSize:FS.sm, marginTop:14, background:'none', border:`1px solid ${T.border}`, color:T.muted, borderRadius:8, padding:'6px 16px', cursor:'pointer' }}>
              {showArchived ? '▲ Hide archived' : `▼ Show ${archivedJobs.length} archived (complete)`}
            </button>
          )}
        </div>
      )}

      {/* ── MESSAGES VIEW — all conversations ── */}
      {view === 'messages' && (
        <div style={{ display:'grid', gap:10 }}>
          {convos.length === 0 && (
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'24px', textAlign:'center', fontFamily:SANS, fontSize:FS.base, color:T.muted }}>
              No tenant messages yet.
            </div>
          )}
          {convos.map(convo => (
            <ConvoCard key={convo.key} convo={convo} expanded={expanded} onOpen={openConvo}
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
  const STATUS_CFG = statusCfg(T)
  const PRIORITY_CFG = priorityCfg(T)
  const sc = STATUS_CFG[job.status] || STATUS_CFG.open
  const pc = PRIORITY_CFG[job.priority] || PRIORITY_CFG.normal
  const photos = Array.isArray(job.photos) ? job.photos : []

  return (
    <div>
      <div {...pressable(() => onOpen(job), { 'aria-expanded': isExpanded })}
        style={{ background:T.card, border:`1px solid ${isExpanded ? T.gold : job.status==='complete' ? T.border : T.border}`, borderRadius:isExpanded?'12px 12px 0 0':12, padding:'14px 18px', cursor:'pointer', opacity: job.status==='complete' ? 0.7 : 1 }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold+'88'}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isExpanded?T.gold:T.border}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:T.red+'22', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:T.red }}><Icon name="wrench" size={17}/></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>Repair request</span>
                <span style={{ fontFamily:SANS, fontSize:FS.sm, fontWeight:700, padding:'2px 8px', borderRadius:10, background:sc.bg, color:sc.color }}>{sc.label}</span>
                {job.priority && job.priority !== 'normal' && (
                  <span style={{ fontFamily:SANS, fontSize:FS.sm, fontWeight:700, padding:'2px 8px', borderRadius:10, background:pc.color+'22', color:pc.color, display:'inline-flex', alignItems:'center', gap:4 }}><Icon name="flag" size={10}/>{pc.label}</span>
                )}
              </div>
              <span style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, flexShrink:0 }}>
                {new Date(job.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {new Date(job.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
              </span>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{job.title || 'Repair request'}</div>
            <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, display:'flex', alignItems:'center', gap:4 }}><Icon name="pin" size={12}/>{job.property?.address||job.property?.name||'—'}</div>
          </div>
          <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>{isExpanded?'▲':'▼'}</div>
        </div>
      </div>

      {isExpanded && (
        <div style={{ background:T.surface, border:`1px solid ${T.gold}44`, borderTop:'none', borderRadius:'0 0 12px 12px', padding:'20px 18px' }}>
          {/* Description */}
          {job.description && (
            <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.text, lineHeight:1.7, marginBottom:14, padding:'10px 14px', background:T.bg, borderRadius:8 }}>
              {job.description}
            </div>
          )}
          {/* Photos */}
          {photos.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Photos from tenant</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {photos.map((p,i) => (
                  <SignedPhoto key={p.path || p.url || i} path={p.path} url={p.url}
                    style={{ width:100, height:100, objectFit:'cover', borderRadius:8, border:`1px solid ${T.border}`, cursor:'pointer' }}/>
                ))}
              </div>
            </div>
          )}
          {/* Status update */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Update status</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {['open','in-progress','complete'].map(s => (
                <button key={s} onClick={() => onStatusChange(job.id, s)}
                  style={{ fontFamily:SANS, fontSize:FS.sm, padding:'5px 14px', borderRadius:20, cursor:'pointer',
                    border:`1px solid ${STATUS_CFG[s]?.color}44`,
                    background: job.status===s ? STATUS_CFG[s]?.color+'33' : 'transparent',
                    color: STATUS_CFG[s]?.color, fontWeight: job.status===s ? 700 : 400 }}>
                  {STATUS_CFG[s]?.label}
                </button>
              ))}
            </div>
            {job.status === 'complete' && (
              <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.green, marginTop:8 }}>
                Marked complete — this repair will move to the archive
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
  const isExpanded = expanded?.key === convo.key && expanded?.itemType === 'convo'
  const lastMsg = convo.last_message
  const hasUnread = convo.unread_count > 0

  return (
    <div>
      <div {...pressable(() => onOpen(convo), { 'aria-expanded': isExpanded })}
        style={{ background:T.card, border:`1px solid ${isExpanded ? T.gold : hasUnread ? T.gold+'44' : T.border}`, borderRadius:isExpanded?'12px 12px 0 0':12, padding:'14px 18px', cursor:'pointer' }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold+'88'}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isExpanded?T.gold:hasUnread?T.gold+'44':T.border}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:T.gold+'22', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:T.goldText }}><Icon name="mail" size={17}/></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.gold+'22', color:T.goldText }}>Message</span>
                {hasUnread && <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>{convo.unread_count} unread</span>}
              </div>
              <span style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, flexShrink:0 }}>
                {new Date(lastMsg.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {new Date(lastMsg.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
              </span>
            </div>
            <div style={{ fontSize:13, fontWeight: hasUnread ? 700 : 400, color:T.text, marginBottom:3 }}>
              {lastMsg.message?.substring(0,80)}{lastMsg.message?.length>80?'…':''}
            </div>
            <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, display:'flex', alignItems:'center', gap:4 }}><Icon name="pin" size={12}/>{convo.property?.address||convo.property?.name||'—'}{convo.threads_at_property > 1 ? ` · one of ${convo.threads_at_property} tenants messaging about this property` : ''}</div>
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
      <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Conversation</div>
      <div style={{ maxHeight:320, overflowY:'auto', marginBottom:12, padding:'4px 0' }}>
        {loading && <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 8, padding: 20 }}><Skeleton h={14}/><Skeleton h={14} w="80%"/><Skeleton h={14} w="60%"/></div>}
        {!loading && thread.length === 0 && (
          <EmptyState compact icon="message" title="No messages in this thread yet."/>
        )}
        {thread.map(m => {
          const isLandlord = m.sender_type === 'landlord'
          return (
            <div key={m.id} style={{ display:'flex', justifyContent:isLandlord?'flex-end':'flex-start', marginBottom:12 }}>
              <div style={{ maxWidth:'75%' }}>
                <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, marginBottom:4, textAlign:isLandlord?'right':'left' }}>
                  {isLandlord?'You':'Tenant'} · {new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} {new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                </div>
                <div style={{ background:isLandlord?T.gold+'22':T.bg, border:`1px solid ${isLandlord?T.gold+'44':T.border}`,
                  borderRadius:isLandlord?'14px 14px 4px 14px':'14px 14px 14px 4px',
                  padding:'10px 14px', fontFamily:SANS, fontSize:FS.sm, color:T.text, lineHeight:1.7 }}>
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
          style={{ flex:1, fontFamily:SANS, fontSize:FS.sm, background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'9px 14px' }}/>
        <Button onClick={onReply} disabled={replying||!replyText.trim()} style={{ flexShrink:0 }}>
          {replying?'…':'Send'}
        </Button>
      </div>
    </div>
  )
}
