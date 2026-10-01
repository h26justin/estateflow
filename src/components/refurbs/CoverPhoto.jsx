// Cover photograph for a refurb: shown on the card and as the workspace
// hero. One stored (browser-resized) image plus a crop { x, y, zoom } saved
// on its refurb_files row, so re-cropping never re-uploads.
import { useState, useRef } from 'react'
import Modal from '../../lib/Modal'
import { Icon } from '../../lib/icons'
import { coverImgStyle, normaliseCrop } from '../../lib/imageResize'
import { mono, btn } from './ui'

export function CoverImage({ url, crop, alt = '', T, placeholder = 'No cover photo yet', compact = false }) {
  if (!url) return <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: `repeating-linear-gradient(135deg, ${T.bg}, ${T.bg} 10px, ${T.surface} 10px, ${T.surface} 20px)`, color: T.faint }}>
    <Icon name="building" size={compact ? 22 : 34} />
    {!compact && <span style={{ fontFamily: mono, fontSize: 11 }}>{placeholder}</span>}
  </div>
  return <img src={url} alt={alt} style={coverImgStyle(crop)} draggable={false} />
}

export default function CoverPhoto({ file, url, canEdit, onUpload, onCropSave, height = 300, aspect = 16 / 9, T, alt }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [cropping, setCropping] = useState(false)

  async function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!String(f.type || '').startsWith('image/')) { setError('Choose a photo (JPG, PNG, WebP or HEIC).'); return }
    setBusy(true); setError(null)
    try {
      const saved = await onUpload(f)
      if (saved) setCropping(true)
    } catch (err) { setError(err.message || 'Upload failed') }
    setBusy(false)
  }

  return <div style={{ position: 'relative', width: '100%', height, overflow: 'hidden', borderRadius: 12, background: T.bg }}>
    <CoverImage url={url} crop={file?.crop} alt={alt} T={T} />
    {canEdit && <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6 }}>
      {url && <button onClick={() => setCropping(true)} style={{ ...btn(T), background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>Adjust crop</button>}
      <button onClick={() => inputRef.current?.click()} disabled={busy} style={{ ...btn(T, 'gold'), opacity: busy ? 0.7 : 1 }}>
        {busy ? 'Uploading…' : url ? 'Replace photo' : 'Upload cover photo'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
    </div>}
    {error && <div role="alert" style={{ position: 'absolute', left: 10, bottom: 10, right: 160, fontFamily: mono, fontSize: 11, color: '#fff', background: T.red, padding: '6px 10px', borderRadius: 6 }}>{error}</div>}
    {cropping && url && <CropModal url={url} crop={file?.crop} aspect={aspect} T={T} onClose={() => setCropping(false)}
      onSave={async c => { await onCropSave(c); setCropping(false) }} />}
  </div>
}

function CropModal({ url, crop, aspect, onClose, onSave, T }) {
  const [c, setC] = useState(() => normaliseCrop(crop))
  const [saving, setSaving] = useState(false)
  const drag = useRef(null)
  const frame = useRef(null)

  function down(e) {
    drag.current = { x: e.clientX, y: e.clientY, start: c }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function move(e) {
    if (!drag.current || !frame.current) return
    const rect = frame.current.getBoundingClientRect()
    // Dragging the photo right reveals more of its left side: the focal
    // point moves left. Scaled by zoom so it tracks the finger.
    // Read the drag origin now: React may run the updater after pointerup
    // has already cleared drag.current.
    const { start } = drag.current
    const dx = (e.clientX - drag.current.x) / rect.width * 100 / start.zoom
    const dy = (e.clientY - drag.current.y) / rect.height * 100 / start.zoom
    setC(prev => normaliseCrop({ ...prev, x: start.x - dx, y: start.y - dy }))
  }
  function up() { drag.current = null }

  return <Modal onClose={onClose} size="lg" ariaLabel="Adjust cover photo">
    <div style={{ padding: '20px 22px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Adjust cover photo</h2>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12 }}>Drag the photo to position it, and use the slider to zoom.</div>
      <div ref={frame} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width: '100%', aspectRatio: String(aspect), overflow: 'hidden', borderRadius: 10, cursor: 'grab', touchAction: 'none', background: T.bg, border: `1px solid ${T.border}` }}>
        <img src={url} alt="" draggable={false} style={coverImgStyle(c)} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>Zoom</span>
        <input type="range" min="1" max="3" step="0.05" value={c.zoom} onChange={e => setC(p => normaliseCrop({ ...p, zoom: Number(e.target.value) }))} style={{ flex: 1 }} aria-label="Zoom" />
        <button onClick={() => setC({ x: 50, y: 50, zoom: 1 })} style={btn(T)}>Reset</button>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={btn(T)}>Cancel</button>
        <button disabled={saving} onClick={async () => { setSaving(true); try { await onSave(c) } finally { setSaving(false) } }} style={btn(T, 'gold')}>{saving ? 'Saving…' : 'Save crop'}</button>
      </div>
    </div>
  </Modal>
}
