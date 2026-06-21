import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import FocusTrap from '../lib/FocusTrap'

// ── RECEIPT SCAN MODAL ───────────────────────────────────────────────
// Mobile-first expense capture. User taps "Scan receipt" → device
// camera opens (capture="environment") → snap → uploads → Claude
// extracts merchant/date/amount/category → form pre-fills → user
// picks property + saves as a property_expenses row.
//
// This is the audit's "Hammock parity for receipt-on-the-go" play.
// Hammock heavily markets their mobile receipt scan — we now match
// the workflow without needing a native app.
//
// File-input + capture attribute opens the camera directly on iOS +
// Android; on desktop it falls back to a file picker (fine).
//
// Note: the existing extract-document edge function gets a new
// 'receipt' schema; see the extract-document deploy in this commit.

const CATEGORY_OPTIONS = [
  { v: 'maintenance', label: 'Maintenance / Repairs' },
  { v: 'utilities',   label: 'Utilities' },
  { v: 'insurance',   label: 'Insurance' },
  { v: 'professional',label: 'Professional fees (legal, accounting)' },
  { v: 'agent_fees',  label: 'Agent fees' },
  { v: 'cleaning',    label: 'Cleaning' },
  { v: 'garden',      label: 'Garden / outside maintenance' },
  { v: 'compliance',  label: 'Compliance (gas/EICR/EPC)' },
  { v: 'other',       label: 'Other' },
]

export default function ReceiptScanModal({ properties = [], onClose, onSaved }) {
  const { T } = useTheme()
  const [stage, setStage]       = useState('capture')  // capture | scanning | review | saving
  const [error, setError]       = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileRef = useRef(null)

  // Form fields (pre-filled from extraction, user-editable)
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '')
  const [category, setCategory]     = useState('other')
  const [description, setDescription] = useState('')
  const [amount, setAmount]         = useState('')
  const [date, setDate]             = useState('')

  // Auto-fire the file picker on open (mobile-first UX)
  useEffect(() => {
    if (stage === 'capture') {
      // Defer so the modal mount completes before we trigger the picker
      const t = setTimeout(() => fileRef.current?.click(), 250)
      return () => clearTimeout(t)
    }
  }, [stage])

  async function handleFile(file) {
    if (!file) return
    setError(null)
    setPreviewUrl(URL.createObjectURL(file))
    setStage('scanning')
    try {
      // Attach to the first selected property — simplest schema-compliant
      // path. User can re-pick the property in the review step before save.
      const targetProperty = properties[0]?.id
      if (!targetProperty) throw new Error('Add a property first before scanning receipts')

      const { extracted: ex } = await api.uploadAndExtractMortgageDocument(file, targetProperty, 'receipt')
      if (!ex || ex._parse_error) throw new Error(ex?._parse_error || 'AI returned no structured data')

      setExtracted(ex)
      // Pre-fill form from extraction
      if (ex.merchant_name || ex.description) setDescription(ex.merchant_name || ex.description)
      if (ex.amount)   setAmount(String(ex.amount))
      if (ex.date)     setDate(toIsoDate(ex.date))
      if (ex.category) setCategory(mapCategory(ex.category))
      setStage('review')
    } catch (e) {
      setError(e?.message || 'Could not scan the receipt')
      setStage('capture')
    }
  }

  async function save() {
    if (!propertyId) { setError('Pick a property to attach this expense to'); return }
    if (!amount || isNaN(parseFloat(amount))) { setError('Amount is required'); return }
    setStage('saving')
    try {
      await api.createExpense(propertyId, {
        category,
        description: description || 'Scanned receipt',
        amount: parseFloat(amount),
        date: date || new Date().toISOString().slice(0, 10),
      })
      showAppToast('Expense saved')
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e?.message || 'Save failed')
      setStage('review')
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget && stage !== 'scanning') onClose() }}>
      <FocusTrap onEscape={() => { if (stage !== 'scanning') onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-labelledby="receipt-scan-modal-title">
        <div style={{ padding: '22px 24px 0' }}>
          <h2 id="receipt-scan-modal-title" style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Scan Receipt
          </h2>
          <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 16 }}>
            {stage === 'capture' && 'Snap or upload a receipt and we\'ll extract the details.'}
            {stage === 'scanning' && 'AI is reading your receipt…'}
            {stage === 'review' && 'Check the extracted fields, then save.'}
            {stage === 'saving' && 'Saving expense…'}
          </p>
        </div>

        <div style={{ padding: '0 24px 22px' }}>
          {error && (
            <div style={{ background: T.red+'11', border:`1px solid ${T.red}44`, borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontFamily: MONO, fontSize: 11, color: T.red }}>
              {error}
            </div>
          )}

          {/* Hidden file input — capture="environment" opens rear camera on mobile */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>

          {stage === 'capture' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <button onClick={() => fileRef.current?.click()}
                className="btn btn-gold" style={{ fontSize: 14, padding: '14px 28px', width: '100%' }}>
                Open camera
              </button>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 10 }}>
                On mobile this opens your camera. Desktop opens a file picker.
              </div>
            </div>
          )}

          {stage === 'scanning' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              {previewUrl && <img src={previewUrl} alt="" style={{ maxWidth: '60%', maxHeight: 200, borderRadius: 10, marginBottom: 16, objectFit: 'contain' }}/>}
              <div style={{ fontFamily: MONO, fontSize: 12, color: T.gold, marginBottom: 6 }}>Reading receipt…</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>Usually takes 5-10 seconds</div>
            </div>
          )}

          {stage === 'review' && (
            <div>
              {previewUrl && (
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <img src={previewUrl} alt="" style={{ maxWidth: '40%', maxHeight: 120, borderRadius: 8, border: `1px solid ${T.border}`, objectFit: 'contain' }}/>
                </div>
              )}
              {extracted?.merchant_name && (
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.green, marginBottom: 10 }}>
                  Extracted from {extracted.merchant_name}
                </div>
              )}

              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label>Property *</label>
                  <select value={propertyId} onChange={e => setPropertyId(e.target.value)}>
                    <option value="">— Pick a property —</option>
                    {[...properties].sort((a,b) => a.name.localeCompare(b.name)).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="g2">
                  <div>
                    <label>Amount (£) *</label>
                    <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/>
                  </div>
                  <div>
                    <label>Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}/>
                  </div>
                </div>
                <div>
                  <label>Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}>
                    {CATEGORY_OPTIONS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Description</label>
                  <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Plumber callout — new tap"/>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
                <button onClick={() => { setStage('capture'); setExtracted(null); setPreviewUrl(null) }} className="btn btn-ghost" style={{ fontSize: 12 }}>
                  ← Re-scan
                </button>
                <button onClick={save} className="btn btn-gold" style={{ fontSize: 12 }}>
                  Save expense
                </button>
              </div>
            </div>
          )}

          {stage === 'saving' && (
            <div style={{ textAlign: 'center', padding: 24, fontFamily: MONO, fontSize: 12, color: T.muted }}>
              Saving…
            </div>
          )}
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────

// "15/03/2026" → "2026-03-15" (HTML date input expects ISO)
function toIsoDate(s) {
  if (!s) return ''
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? iso[0] : ''
}

// Claude returns freeform categories; map to our enum.
function mapCategory(raw) {
  const s = String(raw || '').toLowerCase()
  if (/repair|plumb|electric|boiler|fix|maintenance/.test(s)) return 'maintenance'
  if (/util|gas|water|electric|broadband/.test(s)) return 'utilities'
  if (/insur/.test(s)) return 'insurance'
  if (/legal|accountant|professional|solicitor/.test(s)) return 'professional'
  if (/agent|letting|management fee/.test(s)) return 'agent_fees'
  if (/clean/.test(s)) return 'cleaning'
  if (/garden|landscape/.test(s)) return 'garden'
  if (/gas safe|eicr|epc|compliance|inspection/.test(s)) return 'compliance'
  return 'other'
}
