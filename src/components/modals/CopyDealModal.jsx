import { useState } from 'react'
import { MONO } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import Modal from '../../lib/Modal'
import { COPY_OPTIONS, DEFAULT_COPY_OPTIONS, isCopyOptionActive } from '../../lib/dealCopy'

// Asks what to carry over before a deal is copied. Everything not ticked is
// left behind, so a copy can be anything from a full clone to a bare shell
// with just the deal type and company on it.
export default function CopyDealModal({ deal, onClose, onConfirm, busy }) {
  const { T } = useTheme()
  const [opts, setOpts] = useState(DEFAULT_COPY_OPTIONS)

  const toggle = (key) => setOpts(prev => ({ ...prev, [key]: !prev[key] }))
  const setAll = (value) => setOpts(COPY_OPTIONS.reduce((acc, o) => { acc[o.key] = value; return acc }, {}))

  const label = { fontFamily: MONO, fontSize: 12, color: T.text, fontWeight: 600 }
  const hint = { fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.5 }
  const quick = {
    fontFamily: MONO, fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${T.border}`, background: 'transparent', color: T.muted,
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} size="md" labelledBy="copy-deal-title">
      <div style={{ padding: '26px 28px' }}>
        <h2 id="copy-deal-title" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6, color: T.text }}>
          What should the copy include?
        </h2>
        <p style={{ fontFamily: MONO, color: T.muted, fontSize: 12, marginBottom: 16 }}>{deal?.name}</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button type="button" style={quick} onClick={() => setAll(true)}>Select all</button>
          <button type="button" style={quick} onClick={() => setAll(false)}>Select none</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 18 }}>
          {COPY_OPTIONS.map(o => {
            // A child option (tracker progress) can't be ticked on its own —
            // there'd be nothing to hang the dates off.
            const blocked = o.requires && !opts[o.requires]
            const checked = isCopyOptionActive(opts, o.key)
            return (
              <label key={o.key} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 8,
                marginLeft: o.requires ? 22 : 0,
                background: checked ? T.gold + '11' : 'transparent',
                border: `1px solid ${checked ? T.gold + '44' : T.border}`,
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.45 : 1,
              }}>
                <input type="checkbox" checked={checked} disabled={blocked}
                  onChange={() => toggle(o.key)}
                  style={{ marginTop: 2, width: 15, height: 15, accentColor: T.gold, cursor: blocked ? 'not-allowed' : 'pointer' }} />
                <span>
                  <span style={label}>{o.label}</span>
                  <div style={hint}>{o.hint}</div>
                </span>
              </label>
            )
          })}
        </div>

        <p style={{ fontFamily: MONO, fontSize: 10, color: T.faint, lineHeight: 1.6, marginBottom: 18 }}>
          The copy always keeps the deal type, purchase type and company, and starts back at
          Analysing. {opts.tracker ? '' : 'With tracker steps unticked it gets a fresh tracker from your milestone defaults.'}
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={onClose}>Cancel</button>
          <button disabled={busy} onClick={() => onConfirm(opts)}
            style={{
              flex: 1, fontFamily: MONO, fontWeight: 600, background: T.gold, color: '#1C2830',
              border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, cursor: busy ? 'wait' : 'pointer',
            }}>
            {busy ? 'Copying…' : 'Copy deal'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
