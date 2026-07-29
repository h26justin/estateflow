import { useState, useRef, useEffect } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'

/**
 * CalcExplain — a small "ⓘ" affordance that, on hover/tap, shows the
 * formula and inputs behind a computed number. Used to make yield, equity,
 * LTV etc. transparent so users can verify the maths.
 *
 * Usage:
 *   <CalcExplain
 *     title="Gross Yield"
 *     formula="(Monthly Rent × 12) ÷ Total Cost × 100"
 *     inputs={[
 *       { label: 'Monthly Rent', value: '£950' },
 *       { label: 'Refurb Cost',  value: '£12,000' },
 *       { label: 'Purchase Price', value: '£135,000' },
 *     ]}
 *     result="7.20%"
 *     note="Total Cost = Purchase Price + Refurb. Switch to 'on value' in Settings to use current value instead."
 *   />
 *
 * Renders a tiny info icon. Click (or hover on desktop) to open the popover.
 * Click outside or Escape to close.
 */
export default function CalcExplain({ title, formula, inputs = [], result, note }) {
  const { T } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const mono = MONO

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onEscape(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        aria-label={`How is ${title} calculated?`}
        style={{
          width: 14, height: 14, borderRadius: '50%',
          border: `1px solid ${T.border}`, background: T.bg,
          color: T.muted, fontSize: 9, lineHeight: '12px',
          cursor: 'pointer', padding: 0, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: mono, fontWeight: 700,
        }}>
        i
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            zIndex: 100, minWidth: 260, maxWidth: 340,
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 10, padding: '12px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            textAlign: 'left',
          }}
          // Stop the popover's clicks from triggering parent row handlers
          onClick={(e) => e.stopPropagation()}>
          <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            How {title} is calculated
          </div>
          {formula && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.text, marginBottom: 10, padding: '6px 8px', background: T.bg, borderRadius: 6 }}>
              {formula}
            </div>
          )}
          {inputs.length > 0 && (
            <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
              {inputs.map((inp, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: mono, fontSize: 11 }}>
                  <span style={{ color: T.muted }}>{inp.label}</span>
                  <span style={{ color: T.text, fontWeight: 600 }}>{inp.value}</span>
                </div>
              ))}
            </div>
          )}
          {result && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: mono, fontSize: 11, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
              <span style={{ color: T.muted }}>Result</span>
              <span style={{ color: T.gold, fontWeight: 700 }}>{result}</span>
            </div>
          )}
          {note && (
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10, lineHeight: 1.5 }}>
              {note}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
