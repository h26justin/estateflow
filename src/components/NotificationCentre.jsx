import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { Icon } from '../lib/icons'
import * as api from '../lib/api'

const POLL_INTERVAL_MS = 60_000  // poll every minute while open; light-touch
const TYPE_ICON = {
  compliance:     'shield-check',
  rent:           'pound',
  maintenance:    'wrench',
  tenant_message: 'message',
  system:         'megaphone',
  backup:         'download',
  trial:          'clock',
  deal:           'target',
}

function timeAgo(iso) {
  if (!iso) return ''
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60)       return `${sec}s ago`
  if (sec < 3600)     return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400)    return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400*7)  return `${Math.floor(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB')
}

export default function NotificationCentre() {
  const { T } = useTheme()
  const mono = MONO
  const [open, setOpen]   = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef(null)

  const refreshUnread = useCallback(async () => {
    try { setUnread(await api.fetchUnreadNotificationCount()) } catch(e) {}
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [list, count] = await Promise.all([
        api.fetchNotifications(30),
        api.fetchUnreadNotificationCount(),
      ])
      setItems(list)
      setUnread(count)
    } catch(e) {}
    setLoading(false)
  }, [])

  // Initial unread count on mount + light polling so the badge stays current.
  // We only poll the cheap count query, not the full list — the list refetches
  // when the panel opens.
  useEffect(() => {
    refreshUnread()
    pollRef.current = setInterval(refreshUnread, POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [refreshUnread])

  // When the panel opens, fetch the full list.
  useEffect(() => {
    if (open) loadAll()
  }, [open, loadAll])

  async function handleClick(n) {
    // Optimistic: clear read state locally so the dot disappears immediately.
    if (!n.read_at) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      setUnread(u => Math.max(0, u - 1))
      try { await api.markNotificationRead(n.id) } catch(e) {}
    }
    if (n.link) {
      if (n.link.startsWith('#')) window.location.hash = n.link.slice(1)
      else {
        // notification links can be server-generated; never follow
        // javascript:/data: or other non-http schemes
        let safe = false
        try {
          const proto = new URL(String(n.link), window.location.origin).protocol
          safe = proto === 'http:' || proto === 'https:'
        } catch (e) { safe = false }
        if (safe) window.location.href = n.link
      }
    }
    setOpen(false)
  }

  async function handleMarkAll() {
    const now = new Date().toISOString()
    setItems(prev => prev.map(x => x.read_at ? x : { ...x, read_at: now }))
    setUnread(0)
    try { await api.markAllNotificationsRead() } catch(e) {}
  }

  async function handleDismiss(id, e) {
    e.stopPropagation()
    const wasUnread = !items.find(x => x.id === id)?.read_at
    setItems(prev => prev.filter(x => x.id !== id))
    if (wasUnread) setUnread(u => Math.max(0, u - 1))
    try { await api.deleteNotification(id) } catch(e) {}
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? T.bg : 'none',
          border: `1px solid ${open ? T.gold : T.border}`,
          borderRadius: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          color: T.text,
          fontSize: 15,
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 32, minWidth: 36,
          transition: 'border-color 0.15s, background 0.15s',
        }}>
        <span aria-hidden="true" style={{display:'flex',color:T.text}}><Icon name="bell" size={17}/></span>
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: -4, right: -4,
            background: T.red, color: 'white',
            fontFamily: mono, fontSize: 9, fontWeight: 700,
            borderRadius: 10, minWidth: 16, height: 16,
            padding: '0 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px solid ${T.surface}`,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop captures outside clicks */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setOpen(false)}/>
          {/* Panel */}
          <div role="dialog" aria-label="Notifications" style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
            // min() keeps the right-anchored panel on-screen on 360px phones —
            // a fixed 360px width would push its left edge past the viewport
            // and get clipped by the global overflow-x:hidden.
            width: 'min(360px, calc(100vw - 24px))', maxHeight: 480,
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{
              padding: '14px 16px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.text }}>
                Notifications {unread > 0 && <span style={{ color: T.muted, fontWeight: 400 }}>· {unread} unread</span>}
              </div>
              {unread > 0 && (
                <button onClick={handleMarkAll}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: mono, fontSize: 10, color: T.gold, textDecoration: 'underline' }}>
                  Mark all read
                </button>
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loading && items.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', fontFamily: mono, fontSize: 11, color: T.muted }}>
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ display:'flex', justifyContent:'center', marginBottom: 10, color: T.faint }}><Icon name="bell-off" size={26}/></div>
                  <div style={{ fontFamily: mono, fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 4 }}>You're all caught up</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, lineHeight: 1.5, maxWidth: 240, margin: '0 auto' }}>
                    Compliance reminders, rent activity and system updates will show up here.
                  </div>
                </div>
              ) : (
                items.map((n, i) => (
                  <div key={n.id} onClick={() => handleClick(n)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : 'none',
                      cursor: n.link ? 'pointer' : 'default',
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      background: !n.read_at ? T.gold + '0A' : 'transparent',
                      transition: 'background 0.15s',
                      position: 'relative',
                    }}
                    onMouseEnter={e => { if (n.link) e.currentTarget.style.background = T.bg }}
                    onMouseLeave={e => { e.currentTarget.style.background = !n.read_at ? T.gold + '0A' : 'transparent' }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: T.bg, border: `1px solid ${T.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, marginTop: 1, color: T.muted,
                    }} aria-hidden="true"><Icon name={TYPE_ICON[n.type] || 'bell'} size={16}/></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 13, fontWeight: !n.read_at ? 700 : 500, color: T.text, lineHeight: 1.35 }}>
                          {n.title}
                        </div>
                        <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, flexShrink: 0 }}>
                          {timeAgo(n.created_at)}
                        </div>
                      </div>
                      {n.body && (
                        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.55, marginTop: 3 }}>
                          {n.body}
                        </div>
                      )}
                      {n.metadata?.booking_url && n.metadata?.booking_label && (
                        <a href={n.metadata.booking_url} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{
                            display: 'inline-block', marginTop: 6,
                            fontFamily: mono, fontSize: 10, fontWeight: 600,
                            padding: '4px 9px', borderRadius: 6,
                            background: T.gold + '14', color: T.gold,
                            border: `1px solid ${T.gold}55`,
                            textDecoration: 'none',
                          }}>
                          {n.metadata.booking_label} →
                        </a>
                      )}
                    </div>
                    <button onClick={e => handleDismiss(n.id, e)}
                      aria-label="Dismiss"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: T.faint, fontSize: 14, lineHeight: 1, padding: 4,
                        alignSelf: 'flex-start',
                      }} aria-label="Dismiss notification">×</button>
                    {!n.read_at && (
                      <span aria-hidden="true" style={{
                        position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                        width: 4, height: 4, borderRadius: '50%', background: T.gold,
                      }}/>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
