import { useState, useEffect, useRef } from 'react'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { EmptyState } from '../ui'

// ── COMPANY BRANDING SETTINGS PANEL ──────────────────────────────────────────
export function BrandingSettingsPanel({ companies, setCompanies, companySettings, setCompanySettings, user, showToast, T }) {
  const mono = MONO
  const [selectedCo, setSelectedCo] = useState(companies[0]?.id || '')
  const [uploading, setUploading]   = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [savingColor, setSavingColor] = useState(false)
  const [colorDraft, setColorDraft]   = useState(null)
  const colorSaveTimer = useRef(null)

  const co = companies.find(c => c.id === selectedCo)
  const cs = companySettings[selectedCo] || {}

  useEffect(() => {
    if (selectedCo && companySettings[selectedCo]) {
      setLogoPreview(companySettings[selectedCo].logo_url || null)
    }
  }, [selectedCo, companySettings])

  useEffect(() => {
    clearTimeout(colorSaveTimer.current)
    setColorDraft(null)
  }, [selectedCo])

  useEffect(() => () => clearTimeout(colorSaveTimer.current), [])

  // The native picker fires input continuously while dragging and blur is
  // unreliable (Chrome blurs as the picker opens), so show the draft live and
  // save once the user has stopped moving it.
  function pickCustomColor(value) {
    setColorDraft(value)
    clearTimeout(colorSaveTimer.current)
    colorSaveTimer.current = setTimeout(() => updateCompanyColor(value), 500)
  }

  async function updateCompanyColor(newColor) {
    if (!co || !newColor) return
    if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) { showToast('Enter a valid hex colour (e.g. #4B8FE0)', 'error'); return }
    if (newColor.toLowerCase() === (co.color || '').toLowerCase()) { setColorDraft(null); return }
    setSavingColor(true)
    try {
      const { error } = await supabase.from('companies').update({ color: newColor }).eq('id', co.id)
      if (error) throw error
      setCompanies(prev => prev.map(c => c.id === co.id ? { ...c, color: newColor } : c))
      setColorDraft(null)
      showToast('Report colour updated')
    } catch(e) { showToast(e.message || 'Failed to save colour', 'error') }
    setSavingColor(false)
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showToast('Logo must be under 2MB', 'error'); return }
    setUploading(true)
    try {
      const url = await api.uploadCompanyLogo(selectedCo, file)
      setLogoPreview(url)
      setCompanySettings(prev => ({
        ...prev,
        [selectedCo]: { ...prev[selectedCo], logo_url: url }
      }))
      showToast('Logo uploaded')
    } catch(e) { showToast(e.message, 'error') }
    setUploading(false)
  }

  async function removeLogo() {
    try {
      await api.saveReportSettings(selectedCo, { logo_url: null, logo_path: null })
      setLogoPreview(null)
      setCompanySettings(prev => ({
        ...prev,
        [selectedCo]: { ...prev[selectedCo], logo_url: null, logo_path: null }
      }))
      showToast('Logo removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  if (companies.length === 0) return (
    <EmptyState compact icon="building" title="No companies yet" body="Add a company first."/>
  )

  return (
    <div>
      {/* Company selector */}
      {companies.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Select company</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {companies.map(c => (
              <button key={c.id} onClick={() => setSelectedCo(c.id)}
                style={{ fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${selectedCo === c.id ? (c.color || T.gold) : T.border}`,
                  background: selectedCo === c.id ? (c.color || T.gold) + '22' : 'transparent',
                  color: selectedCo === c.id ? (c.color || T.goldText) : T.muted,
                  fontWeight: selectedCo === c.id ? 700 : 400 }}>
                {c.abbr} {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {co && (
        <div style={{ display: 'grid', gap: 16 }}>

          {/* Logo upload */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Company logo for reports</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Preview */}
              <div style={{ width: 160, height: 80, background: T.bg, border: `1px dashed ${T.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {logoPreview
                  ? <img src={logoPreview} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}/>
                  : <span style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>No logo</span>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 8, lineHeight: 1.7 }}>
                  Upload your company logo to brand PDF report exports. Recommended: PNG or SVG with transparent background, max 2MB.
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <span className="btn btn-gold" style={{ fontSize: 11 }}>
                      {uploading ? 'Uploading…' : logoPreview ? '↑ Replace logo' : '↑ Upload logo'}
                    </span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} disabled={uploading}/>
                  </label>
                  {logoPreview && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, color: T.red, borderColor: T.red + '44' }} onClick={removeLogo}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Report accent colour */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Report colour</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 16, lineHeight: 1.7 }}>
              PDF report headers and accents will use this colour. It is also used as the accent colour for this company throughout the app.
            </div>

            {/* Preset swatches */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {['#C8A84B','#4B8FE0','#2ECC8A','#E0943A','#9B59B6','#E05555','#16A085','#34495E','#D35400','#7F8C8D'].map(c => {
                const selected = (co.color || '').toLowerCase() === c.toLowerCase()
                return (
                  <button key={c} onClick={() => updateCompanyColor(c)}
                    disabled={savingColor}
                    style={{ width: 36, height: 36, borderRadius: 8, cursor: savingColor ? 'wait' : 'pointer',
                      border: `2px solid ${selected ? T.text : 'transparent'}`,
                      background: c, padding: 0, boxShadow: selected ? `0 0 0 2px ${T.card}, 0 0 0 3px ${c}` : 'none' }}
                    title={c}/>
                )
              })}
            </div>

            {/* Custom colour picker + hex input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="color"
                  value={colorDraft && /^#[0-9A-Fa-f]{6}$/.test(colorDraft) ? colorDraft : (co.color || '#C8A84B')}
                  onChange={e => pickCustomColor(e.target.value)}
                  style={{ width: 48, height: 36, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', background: 'transparent', padding: 2 }}/>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Custom</span>
              </label>
              <input type="text" value={colorDraft !== null ? colorDraft : (co.color || '#C8A84B')}
                onChange={e => setColorDraft(e.target.value)}
                onBlur={() => { if (colorDraft && /^#[0-9A-Fa-f]{6}$/.test(colorDraft)) updateCompanyColor(colorDraft); else setColorDraft(null) }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                placeholder="#C8A84B"
                style={{ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', width: 110 }}/>
              {savingColor && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Saving…</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current:</div>
              <div style={{ width: 48, height: 24, borderRadius: 6, background: co.color || T.gold }}/>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.text, fontWeight: 700 }}>{co.color || '#C8A84B'}</span>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

// ── BRANDING PANEL ────────────────────────────────────────────────────────────
function BrandingPanel({ companies, companySettings, setCompanySettings, user, showToast, T }) {
  const mono = MONO
  const [uploading, setUploading] = useState(null)

  async function handleLogoUpload(companyId, file) {
    if (!file) return
    setUploading(companyId)
    try {
      const url = await api.uploadCompanyLogo(companyId, file)
      setCompanySettings(prev => ({
        ...prev,
        [companyId]: { ...(prev[companyId]||{}), logo_url: url }
      }))
      showToast('Logo uploaded successfully')
    } catch(e) { showToast(e.message || 'Upload failed', 'error') }
    setUploading(null)
  }

  async function removeLogo(companyId) {
    try {
      await api.saveReportSettings(companyId, { logo_url: null, logo_path: null })
      setCompanySettings(prev => ({
        ...prev,
        [companyId]: { ...(prev[companyId]||{}), logo_url: null }
      }))
      showToast('Logo removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Company logos for PDF reports</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7 }}>
          Upload a logo for each company. It will appear on all PDF reports generated for that company. Supported formats: PNG, JPG, SVG. Recommended: PNG with transparent background, at least 400px wide.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {companies.map(co => {
          const cs = companySettings?.[co.id] || {}
          const isUploading = uploading === co.id
          return (
            <div key={co.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', borderLeft: `3px solid ${co.color||T.gold}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: co.color||T.goldText, background: (co.color||T.gold)+'22', padding: '3px 10px', borderRadius: 4 }}>{co.abbr}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{co.name}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                {/* Logo preview */}
                <div style={{ width: 180, height: 80, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                  {cs.logo_url
                    ? <img src={cs.logo_url} alt={co.name} style={{ maxWidth: '90%', maxHeight: '70%', objectFit: 'contain' }}/>
                    : <span style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>No logo uploaded</span>
                  }
                </div>

                {/* Upload controls */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ cursor: 'pointer' }}>
                      <span className="btn btn-gold" style={{ fontSize: 11, display: 'inline-block' }}>
                        {isUploading ? 'Uploading…' : cs.logo_url ? '↑ Replace logo' : '↑ Upload logo'}
                      </span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={isUploading}
                        onChange={e => handleLogoUpload(co.id, e.target.files?.[0])}/>
                    </label>
                    {cs.logo_url && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, color: T.red, borderColor: T.red+'44' }} onClick={() => removeLogo(co.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, marginTop: 8, lineHeight: 1.6 }}>
                    This logo will appear on all PDF reports for {co.name}.<br/>
                    PNG with transparent background works best on dark PDF headers.
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
