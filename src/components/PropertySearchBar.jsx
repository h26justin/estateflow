import { useState, useRef, useEffect, useMemo, useId } from 'react'
import { Icon } from '../lib/icons'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { rankProperties } from '../lib/propertySearch'
import { PROPERTY_STATUS_LABELS } from '../lib/propertyStatus'

// ── PROPERTY SEARCH BAR ───────────────────────────────────────────────────
// Always-visible type-ahead for jumping straight to a property. Lives in the
// header on desktop and at the top of the dashboard on mobile, because
// "open the dashboard, go to a property" is the single most common trip
// through the app and the Cmd+K palette isn't discoverable (or reachable at
// all on a phone).
//
// Matching and ordering are the shared portfolio rules (lib/propertySearch),
// so a query behaves identically here, on the Portfolio list, and in the
// Rent Tracker.
//
// Props:
//   properties  — the searchable set (caller decides; we don't filter
//                 archived/sold here, that's the caller's call)
//   onOpen(p)   — open that property (receives the property row)
//   placeholder — override the input placeholder
//   slashToFocus— when true, "/" anywhere focuses this bar
export default function PropertySearchBar({ properties = [], onOpen, placeholder = 'Search properties…', slashToFocus = false, style }) {
  const { T } = useTheme()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const listId = useId()

  const results = useMemo(() => rankProperties(properties, q, 8), [properties, q])

  // Keep the highlight inside the current result list
  useEffect(() => { setHighlight(0) }, [q])

  // Click outside closes the dropdown (but keeps whatever was typed)
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // "/" focuses the bar — skipped while the user is typing somewhere else,
  // while a modifier is held (that's a browser shortcut), and while any
  // dialog is on screen so we never yank focus out from under a modal.
  useEffect(() => {
    if (!slashToFocus) return
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slashToFocus])

  function choose(p) {
    if (!p) return
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
    onOpen?.(p)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight(h => Math.min(results.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      if (results.length) { e.preventDefault(); choose(results[highlight]) }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (q) { setQ('') } else { inputRef.current?.blur() }
      setOpen(false)
    }
  }

  const showList = open && q.trim().length > 0

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: T.bg, border: `1px solid ${showList ? T.gold + '99' : T.border}`,
        borderRadius: 10, padding: '0 10px', height: 34, transition: 'border-color 0.15s',
      }}>
        <Icon name="search" size={14} color={T.muted}/>
        <input
          ref={inputRef}
          value={q}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-label="Search properties"
          autoComplete="off"
          placeholder={placeholder}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: T.text, fontFamily: MONO, fontSize: 12, padding: 0, height: '100%',
          }}/>
        {q
          ? <button onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Clear search"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontFamily: MONO, fontSize: 12, padding: '0 2px' }}>✕</button>
          : slashToFocus && <kbd style={{ fontFamily: MONO, fontSize: 9, color: T.muted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 5px' }}>/</kbd>}
      </div>

      {showList && (
        <div id={listId} role="listbox" style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 300,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
          boxShadow: '0 12px 36px rgba(0,0,0,0.22)', overflow: 'hidden', maxHeight: 340, overflowY: 'auto',
        }}>
          {results.length === 0 ? (
            <div style={{ padding: '16px 14px', fontFamily: MONO, fontSize: 11, color: T.muted }}>
              No property matches "{q.trim()}"
            </div>
          ) : results.map((p, i) => {
            const active = i === highlight
            const co = p.company?.abbr || p.company?.name || ''
            const coColor = p.company?.color || T.muted
            return (
              <div key={p.id} role="option" aria-selected={active}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
                  background: active ? T.gold + '18' : 'transparent',
                  borderLeft: `3px solid ${active ? T.gold : 'transparent'}`,
                }}>
                <Icon name="home" size={14} color={T.muted}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: T.text, fontWeight: active ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name || p.address || 'Untitled property'}
                  </div>
                  {p.address && p.address !== p.name && (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.address}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {p.status && <span style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {PROPERTY_STATUS_LABELS[p.status] || p.status}
                  </span>}
                  {co && <span style={{ fontFamily: MONO, fontSize: 9, color: coColor, border: `1px solid ${coColor}55`, borderRadius: 4, padding: '1px 5px' }}>{co}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
