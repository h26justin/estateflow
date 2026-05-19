import { useState, useEffect, useRef, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'

// ── COMMAND PALETTE ─────────────────────────────────────────────────────
// Cmd+K / Ctrl+K modal for keyboard-driven navigation and quick actions.
//
// Receives a flat array of commands and renders a filterable list. Each
// command:
//   {
//     id:       unique string,
//     label:    short title (the searchable thing),
//     keywords: optional extra words to match against,
//     group:    'navigate' | 'create' | 'open' | 'action',  // section header
//     icon:     emoji shown left of the label,
//     hint:     optional grey right-side annotation (e.g. "→ Dashboard"),
//     action:   () => void, fires when chosen,
//   }
//
// We do simple substring + word-boundary matching — not full fuzzy. Good
// enough for landlords with <500 properties; if it ever feels slow we'd
// switch to fuse.js.
//
// Keyboard:
//   ↑/↓      navigate results
//   Enter    fire highlighted command
//   Esc      close
//   Tab      no-op (intercepted; the palette is modal so tabbing out is
//            counter-intuitive)

function score(cmd, q) {
  if (!q) return 1
  const hay = (cmd.label + ' ' + (cmd.keywords || '') + ' ' + (cmd.group || '')).toLowerCase()
  // Word-start matches rank higher than mid-word
  if (hay.startsWith(q)) return 100
  if (hay.split(/\s+/).some(w => w.startsWith(q))) return 50
  if (hay.includes(q)) return 10
  return 0
}

const GROUP_LABEL = {
  navigate: 'Navigate',
  open:     'Open',
  create:   'Create',
  action:   'Actions',
}

export default function CommandPalette({ open, commands, onClose }) {
  const { T } = useTheme()
  const [q, setQ] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ('')
      setHighlight(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const scored = commands
      .map(c => ({ cmd: c, s: score(c, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.cmd)
    // Cap to keep the UI snappy
    return scored.slice(0, 50)
  }, [q, commands])

  // Group adjacent matches that share a group key, preserving the sorted order
  const grouped = useMemo(() => {
    const groups = []
    let current = null
    for (const c of filtered) {
      const g = c.group || 'action'
      if (!current || current.key !== g) {
        current = { key: g, items: [] }
        groups.push(current)
      }
      current.items.push(c)
    }
    return groups
  }, [filtered])

  // Keep highlight in range when results change
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1))
  }, [filtered, highlight])

  function handleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[highlight]
      if (cmd) { cmd.action(); onClose() }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      // Block tabbing out of the palette while it's open
      e.preventDefault()
    }
  }

  // Scroll the highlighted row into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  if (!open) return null

  // Flatten the grouped list back into a linear list so highlight index
  // matches `filtered` order, but render section headers at group boundaries.
  let runningIdx = 0

  return (
    <div role="dialog" aria-label="Command palette"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'center',
        paddingTop: '12vh', paddingLeft: 16, paddingRight: 16,
      }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: '70vh',
      }}>
        {/* Search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 16, opacity: 0.6 }} aria-hidden="true">⌘</span>
          <input ref={inputRef} value={q}
            onChange={e => { setQ(e.target.value); setHighlight(0) }}
            onKeyDown={handleKey}
            placeholder="Jump to a page, property, company, or action…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: T.text, fontSize: 15, fontFamily: 'inherit',
            }}/>
          <kbd style={{
            fontFamily: MONO, fontSize: 9, color: T.muted,
            background: T.bg, border: `1px solid ${T.border}`,
            borderRadius: 4, padding: '2px 6px',
          }}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: T.muted }}>
              {q ? `No matches for "${q}"` : 'No commands available'}
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.key}>
                <div style={{
                  padding: '10px 16px 4px', fontFamily: MONO, fontSize: 9,
                  color: T.muted, textTransform: 'uppercase', letterSpacing: '0.12em',
                }}>{GROUP_LABEL[group.key] || group.key}</div>
                {group.items.map(cmd => {
                  const idx = runningIdx++
                  const active = idx === highlight
                  return (
                    <div key={cmd.id} data-idx={idx}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => { cmd.action(); onClose() }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 16px', cursor: 'pointer',
                        background: active ? T.gold + '18' : 'transparent',
                        borderLeft: `3px solid ${active ? T.gold : 'transparent'}`,
                        transition: 'background 0.1s',
                      }}>
                      <span style={{ fontSize: 16, width: 22, textAlign: 'center' }} aria-hidden="true">{cmd.icon || '•'}</span>
                      <span style={{ flex: 1, fontSize: 13, color: T.text, fontWeight: active ? 600 : 400 }}>
                        {cmd.label}
                      </span>
                      {cmd.hint && (
                        <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{cmd.hint}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer with key hints */}
        <div style={{
          padding: '8px 16px', borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: MONO, fontSize: 10, color: T.muted,
        }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <span><kbd style={kbdStyle(T)}>↑</kbd> <kbd style={kbdStyle(T)}>↓</kbd> navigate</span>
            <span><kbd style={kbdStyle(T)}>↵</kbd> select</span>
            <span><kbd style={kbdStyle(T)}>Esc</kbd> close</span>
          </div>
          <span>{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</span>
        </div>
      </div>
    </div>
  )
}

function kbdStyle(T) {
  return {
    fontFamily: MONO, fontSize: 9, color: T.muted,
    background: T.bg, border: `1px solid ${T.border}`,
    borderRadius: 3, padding: '1px 4px',
  }
}
