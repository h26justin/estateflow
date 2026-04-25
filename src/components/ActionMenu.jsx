import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'

/**
 * ActionMenu — a "..." button that opens a dropdown of actions.
 * Handles click-outside, Escape, and basic accessibility.
 *
 * Items can be plain or destructive (highlighted in red).
 *
 * Usage:
 *   <ActionMenu items={[
 *     { label: 'Duplicate',    icon: '⊕', onSelect: handleDup },
 *     { label: 'Mark as sold', icon: '£', onSelect: handleMarkSold },
 *     { divider: true },
 *     { label: 'Archive',      icon: '📦', onSelect: handleArchive },
 *     { label: 'Delete',       icon: '🗑', onSelect: handleDelete, destructive: true },
 *   ]}/>
 *
 * Disabled items: pass `disabled: true` and they won't trigger.
 * Hidden items: filter them out in the parent before passing.
 */
export default function ActionMenu({ items = [], buttonLabel = 'More actions', align = 'right' }) {
  const { T } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const mono = "'DM Mono',monospace"

  useEffect(() => {
    if (!open) return
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visibleItems = items.filter(Boolean)
  if (visibleItems.length === 0) return null

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={buttonLabel}
        style={{ fontSize: 11, color: T.muted, borderColor: T.border, padding: '6px 10px' }}>
        ⋯
      </button>
      {open && (
        <div role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align]: 0,
            zIndex: 100,
            minWidth: 200,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 6,
          }}>
          {visibleItems.map((item, i) => {
            if (item.divider) {
              return <div key={`d${i}`} style={{ height: 1, background: T.border, margin: '4px 0' }}/>
            }
            const color = item.destructive ? T.red : T.text
            return (
              <button key={i} role="menuitem"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onSelect && item.onSelect() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none', background: 'transparent',
                  fontFamily: mono, fontSize: 12,
                  color: item.disabled ? T.faint : color,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = T.bg }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                {item.icon && <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: item.disabled ? 0.5 : 1 }}>{item.icon}</span>}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: 10, color: T.faint }}>{item.shortcut}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
