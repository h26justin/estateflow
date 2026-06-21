import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { showAppToast } from '../lib/toast'
import { fmt } from '../lib/format'
import {
  fetchEnquiries,
  createEnquiry,
  updateEnquiry,
  deleteEnquiry,
  triageEnquiry,
} from '../lib/api/lettingsAssistant'

const mono = "'DM Mono', monospace"

const STATUS_META = {
  new:        { label: 'New',        color: '#4B8FE0' },
  triaged:    { label: 'Triaged',    color: '#C8A84B' },
  replied:    { label: 'Replied',    color: '#2ECC8A' },
  rejected:   { label: 'Rejected',   color: '#E05555' },
  archived:   { label: 'Archived',   color: '#9095B0' },
}

const SCREEN_ROWS = [
  ['budget', 'Budget'],
  ['pets', 'Pets'],
  ['tenancy_length', 'Tenancy length'],
  ['right_to_rent', 'Right to rent'],
]

function statusColor(status, T) {
  return (STATUS_META[status] || { color: T.muted }).color
}

function scoreColor(score) {
  if (score == null) return '#9095B0'
  if (score >= 70) return '#2ECC8A'
  if (score >= 40) return '#E0943A'
  return '#E05555'
}

function screenColor(status) {
  if (status === 'pass' || status === 'ready') return '#2ECC8A'
  if (status === 'fail') return '#E05555'
  if (status === 'needs_check') return '#E0943A'
  return '#9095B0'
}

export default function LettingsAssistantPanel({ properties = [], companies = [] }) {
  const { T } = useTheme()
  const confirm = useConfirm()

  const [enquiries, setEnquiries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ property_id: '', applicant_name: '', applicant_email: '', message: '' })
  const [saving, setSaving] = useState(false)
  const [triaging, setTriaging] = useState(null)
  const [draftEdits, setDraftEdits] = useState({})
  const [criteria, setCriteria] = useState({ max_budget: '', pets_allowed: '', min_tenancy_months: '', notes: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const rows = await fetchEnquiries()
      setEnquiries(rows)
    } catch (e) {
      showAppToast('Could not load enquiries: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const selected = enquiries.find(e => e.id === selectedId) || null

  async function createNew() {
    if (!newForm.property_id) { showAppToast('Pick a property first', 'error'); return }
    setSaving(true)
    try {
      const prop = properties.find(p => p.id === newForm.property_id)
      const row = await createEnquiry({
        property_id: newForm.property_id,
        company_id: prop?.company_id || null,
        applicant_name: newForm.applicant_name,
        applicant_email: newForm.applicant_email,
        message: newForm.message,
      })
      setEnquiries(prev => [row, ...prev])
      setNewForm({ property_id: '', applicant_name: '', applicant_email: '', message: '' })
      setShowNew(false)
      setSelectedId(row.id)
      showAppToast('Enquiry added', 'success')
    } catch (e) {
      showAppToast('Could not add enquiry: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function runTriage(enquiry) {
    setTriaging(enquiry.id)
    try {
      const crit = {}
      if (criteria.max_budget) crit.max_budget = Number(criteria.max_budget)
      if (criteria.pets_allowed) crit.pets_allowed = criteria.pets_allowed === 'yes'
      if (criteria.min_tenancy_months) crit.min_tenancy_months = Number(criteria.min_tenancy_months)
      if (criteria.notes) crit.notes = criteria.notes
      const res = await triageEnquiry(enquiry.id, crit)
      setEnquiries(prev => prev.map(e => e.id === enquiry.id
        ? { ...e, ai_reply_draft: res.ai_reply_draft, ai_score: res.ai_score, ai_screening: res.ai_screening, status: 'triaged' }
        : e))
      setDraftEdits(prev => ({ ...prev, [enquiry.id]: res.ai_reply_draft }))
      showAppToast('AI draft ready — review before sending', 'success')
    } catch (e) {
      showAppToast('AI triage failed: ' + e.message, 'error')
    } finally {
      setTriaging(null)
    }
  }

  async function setStatus(id, status) {
    try {
      await updateEnquiry(id, { status })
      setEnquiries(prev => prev.map(e => e.id === id ? { ...e, status } : e))
    } catch (e) {
      showAppToast('Could not update: ' + e.message, 'error')
    }
  }

  async function remove(id) {
    const ok = await confirm({ title: 'Delete enquiry?', body: 'This removes the applicant enquiry and its AI draft.', confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    try {
      await deleteEnquiry(id)
      setEnquiries(prev => prev.filter(e => e.id !== id))
      if (selectedId === id) setSelectedId(null)
      showAppToast('Enquiry deleted', 'success')
    } catch (e) {
      showAppToast('Could not delete: ' + e.message, 'error')
    }
  }

  function copyDraft(id) {
    const text = draftEdits[id] ?? (selected?.ai_reply_draft || '')
    if (!text) return
    navigator.clipboard?.writeText(text).then(
      () => showAppToast('Reply copied to clipboard', 'success'),
      () => showAppToast('Copy failed — select and copy manually', 'error'),
    )
  }

  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5, display: 'block' }
  const inp = { width: '100%', fontFamily: mono, fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, boxSizing: 'border-box' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>AI Lettings Assistant</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 3 }}>
            Capture enquiries, draft replies, pre-screen and score — all drafts, nothing auto-sent.
          </div>
        </div>
        <button className="btn btn-gold" onClick={() => setShowNew(v => !v)}>
          {showNew ? 'Cancel' : '+ New enquiry'}
        </button>
      </div>

      {/* Landlord criteria */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ ...lbl, marginBottom: 10 }}>Pre-screen criteria (optional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Max budget (pcm)</label>
            <input style={inp} type="number" placeholder="e.g. 1200" value={criteria.max_budget}
              onChange={e => setCriteria(c => ({ ...c, max_budget: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Pets allowed</label>
            <select style={inp} value={criteria.pets_allowed}
              onChange={e => setCriteria(c => ({ ...c, pets_allowed: e.target.value }))}>
              <option value="">No preference</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Min tenancy (months)</label>
            <input style={inp} type="number" placeholder="e.g. 12" value={criteria.min_tenancy_months}
              onChange={e => setCriteria(c => ({ ...c, min_tenancy_months: e.target.value }))} />
          </div>
        </div>
        <div>
          <label style={lbl}>Notes</label>
          <input style={inp} type="text" placeholder="e.g. professional tenants, non-smoker" value={criteria.notes}
            onChange={e => setCriteria(c => ({ ...c, notes: e.target.value }))} />
        </div>
      </div>

      {/* New enquiry form */}
      {showNew && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: T.text }}>New applicant enquiry</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Property</label>
              <select style={inp} value={newForm.property_id}
                onChange={e => setNewForm(f => ({ ...f, property_id: e.target.value }))}>
                <option value="">Select property…</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.address}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Applicant name</label>
              <input style={inp} type="text" placeholder="e.g. Sarah Mitchell" value={newForm.applicant_name}
                onChange={e => setNewForm(f => ({ ...f, applicant_name: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Applicant email</label>
              <input style={inp} type="email" placeholder="e.g. sarah@email.com" value={newForm.applicant_email}
                onChange={e => setNewForm(f => ({ ...f, applicant_email: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Enquiry message</label>
            <textarea style={{ ...inp, height: 110, resize: 'vertical', lineHeight: 1.6 }}
              placeholder="Paste the applicant's message…" value={newForm.message}
              onChange={e => setNewForm(f => ({ ...f, message: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-gold" disabled={saving} onClick={createNew}>{saving ? 'Saving…' : 'Add enquiry'}</button>
            <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, fontFamily: mono, color: T.muted, fontSize: 12 }}>Loading…</div>
      ) : enquiries.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>✉️</div>
          <div style={{ fontFamily: mono, fontSize: 13, color: T.muted }}>No enquiries yet. Add one to draft an AI reply.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 14 }}>
          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {enquiries.map(e => {
              const prop = properties.find(p => p.id === e.property_id)
              const propName = prop?.name || prop?.address || 'Property'
              return (
                <div key={e.id} onClick={() => setSelectedId(e.id)}
                  className="card"
                  style={{ padding: 14, cursor: 'pointer', border: `1px solid ${selectedId === e.id ? T.gold : T.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 2 }}>
                        {e.applicant_name || 'Unnamed applicant'}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {propName}{e.applicant_email ? ` · ${e.applicant_email}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: statusColor(e.status, T) + '22', color: statusColor(e.status, T) }}>
                        {(STATUS_META[e.status] || { label: e.status }).label}
                      </span>
                      {e.ai_score != null && (
                        <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: scoreColor(e.ai_score) }}>
                          {e.ai_score}/100
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Detail */}
          {selected && (() => {
            const prop = properties.find(p => p.id === selected.property_id)
            const propName = prop?.name || prop?.address || 'Property'
            const screening = selected.ai_screening || {}
            const draftValue = draftEdits[selected.id] ?? (selected.ai_reply_draft || '')
            return (
              <div style={{ position: 'sticky', top: 80 }}>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{selected.applicant_name || 'Unnamed applicant'}</div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>{propName}</div>
                    </div>
                    <button onClick={() => setSelectedId(null)}
                      style={{ fontFamily: mono, fontSize: 18, background: 'none', border: 'none', color: T.muted, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>

                  {selected.message && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={lbl}>Their message</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.6, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap' }}>
                        {selected.message}
                      </div>
                    </div>
                  )}

                  <button className="btn btn-gold" style={{ width: '100%', marginBottom: 14 }}
                    disabled={triaging === selected.id}
                    onClick={() => runTriage(selected)}>
                    {triaging === selected.id ? 'Thinking…' : selected.ai_reply_draft ? '↻ Re-run AI triage' : 'Draft reply + screen + score'}
                  </button>

                  {selected.ai_score != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: scoreColor(selected.ai_score) }}>{selected.ai_score}</div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>lead score / 100{screening.confidence ? ` · ${screening.confidence} confidence` : ''}</div>
                    </div>
                  )}

                  {Object.keys(screening).length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={lbl}>Pre-screen</div>
                      {SCREEN_ROWS.map(([key, label]) => {
                        const row = screening[key]
                        if (!row) return null
                        return (
                          <div key={key} style={{ padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontFamily: mono, fontSize: 11, color: T.text }}>{label}</span>
                              <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: screenColor(row.status), textTransform: 'uppercase' }}>{row.status}</span>
                            </div>
                            {row.note && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>{row.note}</div>}
                          </div>
                        )
                      })}
                      {screening.summary && (
                        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 10, lineHeight: 1.6, fontStyle: 'italic' }}>{screening.summary}</div>
                      )}
                    </div>
                  )}

                  {selected.ai_reply_draft && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={lbl}>Draft reply (editable — not sent)</div>
                      <textarea style={{ ...inp, height: 200, resize: 'vertical', lineHeight: 1.6 }}
                        value={draftValue}
                        onChange={ev => setDraftEdits(prev => ({ ...prev, [selected.id]: ev.target.value }))} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => copyDraft(selected.id)}>Copy reply</button>
                        <button className="btn btn-ghost" onClick={() => setStatus(selected.id, 'replied')}>Mark replied</button>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
                        AI-generated draft. Review and edit before sending. Screening is a triage aid, not a right-to-rent or affordability decision.
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStatus(selected.id, 'rejected')}>Reject</button>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStatus(selected.id, 'archived')}>Archive</button>
                    <button className="btn btn-ghost" onClick={() => remove(selected.id)}>Delete</button>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
