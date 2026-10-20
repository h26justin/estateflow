import { useState, useRef, useEffect } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'
import { Button } from './ui'

/**
 * ActionMenu — a "..." button that opens a dropdown of actions.
 * Handles click-outside, Escape, and basic accessibility.
 *
 * Items can be plain or destructive (highlighted in red).
 *
 * `icon` accepts either a name from the SVG icon set (lib/icons.jsx, e.g.
 * 'trash') or a literal glyph string (e.g. '£').
 *
 * Usage:
 *   <ActionMenu items={[
 *     { label: 'Duplicate',    icon: '⊕', onSelect: handleDup },
 *     { label: 'Mark as sold', icon: '£', onSelect: handleMarkSold },
 *     { divider: true },
 *     { label: 'Archive',      icon: '📦', onSelect: handleArchive },
 *     { label: 'Delete',       icon: 'trash', onSelect: handleDelete, destructive: true },
 *   ]}/>
 *
 * Disabled items: pass `disabled: true` and they won't trigger.
 * Hidden items: filter them out in the parent before passing.
 */
export default function ActionMenu({ items = [], buttonLabel = 'More actions', align = 'right' }) {
  const { T } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const mono = MONO

  useEffect(() => {
    if (!open) return
    // Move focus into the menu so keyboard users land on the first action.
    const first = menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')
    if (first) first.focus()
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    // Escape closes and hands focus back to the ⋯ trigger.
    function onKey(e)  { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
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
      <Button variant="secondary" size="sm" iconOnly ref={triggerRef} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={buttonLabel}>
        ⋯
      </Button>
      {open && (
        <div role="menu" ref={menuRef} aria-label={buttonLabel}
          onKeyDown={e => {
            // Up/Down arrows move between the enabled items (wrapping).
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const els = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
            if (!els.length) return
            const i = els.indexOf(document.activeElement)
            const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length
            els[next].focus()
          }}
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
              <button key={i} role="menuitem" type="button"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onSelect && item.onSelect() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none', background: 'transparent',
                  fontFamily: SANS, fontSize: FS.sm,
                  color: item.disabled ? T.faint : color,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = T.bg }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                onFocus={e => { if (!item.disabled) e.currentTarget.style.background = T.bg }}
                onBlur={e => { e.currentTarget.style.background = 'transparent' }}>
                {item.icon && (
                  <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: item.disabled ? 0.5 : 1 }}>
                    {typeof item.icon === 'string' && ICON_NAMES.includes(item.icon)
                      ? <Icon name={item.icon} size={15} style={{ margin: '0 auto' }}/>
                      : item.icon}
                  </span>
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: FS.xs, color: T.faint }}>{item.shortcut}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
