import { useState, useEffect } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import MoneyInput from '../lib/MoneyInput'
import { Icon } from '../lib/icons'

const mono = MONO
const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)

const STAGES = [
  { key: 'vacant',       label: 'Vacant',       color: '#E05555', icon: 'home' },
  { key: 'advertising',  label: 'Advertising',  color: '#4B8FE0', icon: 'megaphone' },
  { key: 'viewings',     label: 'Viewings',     color: '#E0943A', icon: 'eye' },
  { key: 'referencing',  label: 'Referencing',  color: '#9B59B6', icon: 'search' },
  { key: 'contract',     label: 'Contract',     color: '#C8A84B', icon: 'file-text' },
  { key: 'movein',       label: 'Move-in',      color: '#2ECC8A', icon: 'key' },
]
// Inline stage label with its icon (not for <option>, which can't hold SVG).
const StageTag = ({ stage, size = 13 }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <Icon name={stage.icon} size={size} /> {stage.label}
  </span>
)

const STAGE_NEXT = {
  vacant: 'advertising', advertising: 'viewings', viewings: 'referencing',
  referencing: 'contract', contract: 'movein', movein: null,
}

const CHECKLISTS = {
  vacant: [
    { key: 'gas_cert',       label: 'Gas safety certificate valid' },
    { key: 'eicr_cert',      label: 'EICR valid' },
    { key: 'epc_cert',       label: 'EPC valid (min E rating)' },
    { key: 'deposit_cleared',label: 'Previous deposit scheme cleared' },
    { key: 'inspection',     label: 'Property inspection done' },
    { key: 'cleaning',       label: 'Professional clean complete' },
  ],
  advertising: [
    { key: 'listing_created', label: 'Listing description written' },
    { key: 'photos',          label: 'Photos uploaded' },
    { key: 'listed_rm',       label: 'Listed on Rightmove / Zoopla' },
    { key: 'boards',          label: 'For let board up (if applicable)' },
  ],
  viewings: [
    { key: 'first_viewing',   label: 'First viewing conducted' },
    { key: 'feedback_logged', label: 'Viewing feedback logged' },
    { key: 'applicant_chosen',label: 'Applicant chosen' },
    { key: 'holding_deposit', label: 'Holding deposit taken' },
  ],
  referencing: [
    { key: 'refs_sent',       label: 'Reference request letters sent' },
    { key: 'credit_check',    label: 'Credit check completed' },
    { key: 'employer_ref',    label: 'Employer reference received' },
    { key: 'landlord_ref',    label: 'Previous landlord reference received' },
    { key: 'right_to_rent',   label: 'Right to Rent documents verified' },
  ],
  contract: [
    { key: 'agreement_drafted', label: 'Tenancy agreement drafted' },
    { key: 'agreement_signed',  label: 'Agreement signed by tenant' },
    { key: 'deposit_received',  label: 'Deposit received & protected' },
    { key: 'standing_order',    label: 'Standing order / payment set up' },
    { key: 'inventory',         label: 'Inventory report prepared' },
  ],
  movein: [
    { key: 'keys_handed',     label: 'Keys handed over' },
    { key: 'meter_readings',  label: 'Meter readings logged' },
    { key: 'inventory_signed',label: 'Inventory signed by tenant' },
    { key: 'portal_invite',   label: 'Tenant portal invite sent' },
    { key: 'first_rent',      label: 'First rent payment confirmed' },
  ],
}

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000)
}

function stageProgress(stage, checklist = {}) {
  const items = CHECKLISTS[stage] || []
  if (!items.length) return 0
  const done = items.filter(i => checklist[i.key]).length
  return Math.round((done / items.length) * 100)
}

export default function LettingsPipeline({ user, companies = [], properties = [], showToast, triggerNew = false, onNewHandled }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [lettings, setLettings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [activeStage, setActiveStage] = useState('all')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ property_id: '', company_id: '', agreed_rent: '', available_date: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [detailTab, setDetailTab] = useState('details')

  useEffect(() => { load() }, [])
  useEffect(() => { if (triggerNew) { setShowNewForm(true); if (onNewHandled) onNewHandled() } }, [triggerNew])

  async function load() {
    setLoading(true)
    try {
      const data = await api.fetchLettingsProgressions(user.id)
      setLettings(data)
      if (selected) setSelected(data.find(l => l.id === selected.id) || null)
    } catch(e) { showToast('Failed to load lettings pipeline', 'error') }
    setLoading(false)
  }

  async function createLetting() {
    if (!newForm.property_id) { showToast('Please select a property', 'error'); return }
    setSaving(true)
    try {
      const prop = properties.find(p => p.id === newForm.property_id)
      const rec = await api.createLettingsProgression(user.id, {
        property_id: newForm.property_id,
        company_id: newForm.company_id || prop?.company_id || null,
        agreed_rent: parseFloat(newForm.agreed_rent) || prop?.rent_pcm || null,
        available_date: newForm.available_date || null,
        notes: newForm.notes || '',
        stage: 'vacant',
        checklist: {},
      })
      setLettings(prev => [rec, ...prev])
      setSelected(rec)
      setShowNewForm(false)
      setNewForm({ property_id: '', company_id: '', agreed_rent: '', available_date: '', notes: '' })
      showToast('Letting progression started')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  async function updateField(id, fields) {
    try {
      const updated = await api.updateLettingsProgression(id, fields)
      setLettings(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
      if (selected?.id === id) setSelected(s => ({ ...s, ...updated }))
    } catch(e) { showToast(e.message, 'error') }
  }

  async function toggleCheck(id, stage, key, current) {
    const checklist = { ...(selected?.checklist || {}) }
    checklist[key] = !current
    await updateField(id, { checklist })
  }

  async function moveStage(id, newStage) {
    if (newStage === null) {
      // Mark as let agreed — archive
      try {
        await api.archiveLettingsProgression(id)
        setLettings(prev => prev.filter(l => l.id !== id))
        setSelected(null)
        showToast('Let agreed! Letting archived.')
      } catch(e) { showToast(e.message, 'error') }
    } else {
      await updateField(id, { stage: newStage })
      showToast(`Moved to ${STAGES.find(s => s.key === newStage)?.label}`)
    }
  }

  async function deleteLetting(id) {
    if (!await confirmDialog({ title: 'Delete this letting progression?', confirmLabel: 'Delete', destructive: true })) return
    try {
      await api.deleteLettingsProgression(id)
      setLettings(prev => prev.filter(l => l.id !== id))
      if (selected?.id === id) setSelected(null)
      showToast('Deleted')
    } catch(e) { showToast(e.message, 'error') }
  }

  const filtered = activeStage === 'all' ? lettings : lettings.filter(l => l.stage === activeStage)
  const stageCounts = Object.fromEntries(STAGES.map(s => [s.key, lettings.filter(l => l.stage === s.key).length]))
  const totalVacantDays = lettings.filter(l => l.stage === 'vacant').reduce((s, l) => s + (daysSince(l.created_at) || 0), 0)

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 7, padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }

  return (
    <div>
      {/* ── STAT CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Vacant', value: stageCounts.vacant || 0, color: '#E05555' },
          { label: 'In progress', value: lettings.filter(l => !['vacant', 'movein'].includes(l.stage)).length, color: '#4B8FE0' },
          { label: 'Moving in', value: stageCounts.movein || 0, color: '#2ECC8A' },
          { label: 'Rent pending', value: fmt(lettings.filter(l => l.stage !== 'vacant').reduce((s, l) => s + (l.agreed_rent || 0), 0)), color: T.gold },
        ].map(s => (
          <div key={s.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── STAGE FILTER PILLS ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={() => setActiveStage('all')}
          style={{ fontFamily: mono, fontSize: 11, padding: '5px 14px', borderRadius: 20, border: `1px solid ${activeStage === 'all' ? T.gold : T.border}`, background: activeStage === 'all' ? T.gold + '22' : 'transparent', color: activeStage === 'all' ? T.gold : T.muted, cursor: 'pointer' }}>
          All ({lettings.length})
        </button>
        {STAGES.map(s => (
          <button key={s.key} onClick={() => setActiveStage(s.key)}
            style={{ fontFamily: mono, fontSize: 11, padding: '5px 14px', borderRadius: 20, border: `1px solid ${activeStage === s.key ? s.color : T.border}`, background: activeStage === s.key ? s.color + '22' : 'transparent', color: activeStage === s.key ? s.color : T.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
            {s.label} {stageCounts[s.key] > 0 ? `(${stageCounts[s.key]})` : ''}
          </button>
        ))}
      </div>

      {/* ── NEW LETTING FORM ── */}
      {showNewForm && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Start new letting</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Property</label>
              <select style={inp} value={newForm.property_id} onChange={e => {
                const prop = properties.find(p => p.id === e.target.value)
                setNewForm(f => ({ ...f, property_id: e.target.value, company_id: prop?.company_id || '', agreed_rent: prop?.rent_pcm || '' }))
              }}>
                <option value="">Select property…</option>
                {properties.filter(p => p.status === 'vacant' || p.status === 'refurb').map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.address}</option>
                ))}
                <option disabled>── All properties ──</option>
                {properties.filter(p => p.status !== 'vacant' && p.status !== 'refurb').map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.address}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Expected rent</label>
              <MoneyInput prefix="£" suffix="/mo" placeholder="e.g. 1,200" value={newForm.agreed_rent} onChange={v => setNewForm(f => ({ ...f, agreed_rent: v }))} style={inp} />
            </div>
            <div>
              <label style={lbl}>Available from</label>
              <input style={inp} type="date" value={newForm.available_date} onChange={e => setNewForm(f => ({ ...f, available_date: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <input style={inp} placeholder="Any initial notes…" value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={createLetting} disabled={saving}
              style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: T.gold, color: '#1A2530', cursor: 'pointer' }}>
              {saving ? 'Creating…' : 'Start letting'}
            </button>
            <button onClick={() => setShowNewForm(false)}
              style={{ fontFamily: mono, fontSize: 12, padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, fontFamily: mono, color: T.muted, fontSize: 12 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: T.card, border: `1px solid ${T.border}`, borderRadius: 14 }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom: 12 }}><Icon name="home" size={30} color={T.faint}/></div>
          <div style={{ fontFamily: mono, fontSize: 13, color: T.muted, marginBottom: 16 }}>
            {lettings.length === 0 ? 'No active lettings. Start tracking a property.' : 'No lettings in this stage.'}
          </div>
          {lettings.length === 0 && (
            <button onClick={() => setShowNewForm(true)}
              style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: T.gold, color: '#1A2530', cursor: 'pointer' }}>
              + New letting
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 360px' : '1fr', gap: 14 }}>

          {/* ── LETTING LIST ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(letting => {
              const stage = STAGES.find(s => s.key === letting.stage) || STAGES[0]
              const progress = stageProgress(letting.stage, letting.checklist)
              const days = daysSince(letting.created_at)
              const isSelected = selected?.id === letting.id
              const propName = letting.property?.name || letting.property?.address || 'Unknown property'
              const coName = letting.company?.name || ''

              return (
                <div key={letting.id}
                  onClick={() => { setSelected(isSelected ? null : letting); setDetailTab('details') }}
                  style={{
                    background: T.card, border: `1px solid ${isSelected ? stage.color : T.border}`,
                    borderLeft: `3px solid ${stage.color}`,
                    borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
                    transition: 'border-color 0.15s', boxSizing: 'border-box',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{propName}</div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                        {coName}{coName && ' · '}{letting.agreed_rent ? fmt(letting.agreed_rent) + '/mo' : 'Rent TBC'}
                      </div>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: stage.color + '22', color: stage.color, flexShrink: 0, marginLeft: 10 }}>
                      <StageTag stage={stage}/>
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 3, background: T.border, borderRadius: 2, marginTop: 12 }}>
                    <div style={{ height: '100%', borderRadius: 2, background: stage.color, width: `${progress}%`, transition: 'width 0.3s' }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                      {progress}% checklist · {letting.stage === 'vacant' && days !== null ? `${days} days vacant` : letting.applicant_name ? `Applicant: ${letting.applicant_name}` : 'No applicant yet'}
                    </div>
                    {letting.stage === 'vacant' && days > 14 && (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontFamily: mono, fontSize: 10, color: '#E05555' }}><Icon name="alert-triangle" size={11}/> {days} days</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── DETAIL PANEL ── */}
          {selected && (() => {
            const stage = STAGES.find(s => s.key === selected.stage) || STAGES[0]
            const nextStageKey = STAGE_NEXT[selected.stage]
            const nextStage = nextStageKey ? STAGES.find(s => s.key === nextStageKey) : null
            const checkItems = CHECKLISTS[selected.stage] || []
            const checklist = selected.checklist || {}
            const donePct = stageProgress(selected.stage, checklist)
            const propName = selected.property?.name || selected.property?.address || 'Unknown property'

            return (
              <div style={{ position: 'sticky', top: 80 }}>
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, marginBottom: 10 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 3 }}>{propName}</div>
                      <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: stage.color + '22', color: stage.color }}>
                        <StageTag stage={stage}/>
                      </span>
                    </div>
                    <button onClick={() => setSelected(null)}
                      style={{ fontFamily: mono, fontSize: 18, background: 'none', border: 'none', color: T.muted, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${T.border}`, paddingBottom: 10 }}>
                    {['details', 'applicant', 'checklist', 'notes'].map(tab => (
                      <button key={tab} onClick={() => setDetailTab(tab)}
                        style={{ fontFamily: mono, fontSize: 11, padding: '5px 10px', borderRadius: 6, border: `1px solid ${detailTab === tab ? T.gold : T.border}`, background: detailTab === tab ? T.gold + '18' : 'transparent', color: detailTab === tab ? T.gold : T.muted, cursor: 'pointer', textTransform: 'capitalize' }}>
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Details tab */}
                  {detailTab === 'details' && (
                    <div>
                      {[
                        ['Agreed rent', selected.agreed_rent ? fmt(selected.agreed_rent) + '/mo' : '—'],
                        ['Available from', selected.available_date || '—'],
                        ['Proposed start', selected.proposed_start_date || '—'],
                        ['Days active', daysSince(selected.created_at) + ' days'],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                          <span style={{ fontFamily: mono, color: T.muted }}>{label}</span>
                          <span style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{value}</span>
                        </div>
                      ))}

                      {/* Editable fields */}
                      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                        <div>
                          <label style={lbl}>Agreed rent</label>
                          <MoneyInput prefix="£" suffix="/mo" placeholder="e.g. 1,200"
                            value={selected.agreed_rent}
                            onChange={v => updateField(selected.id, { agreed_rent: v })}
                            style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Available from</label>
                          <input style={inp} type="date" value={selected.available_date || ''}
                            onChange={e => updateField(selected.id, { available_date: e.target.value })} />
                        </div>
                        <div>
                          <label style={lbl}>Proposed start date</label>
                          <input style={inp} type="date" value={selected.proposed_start_date || ''}
                            onChange={e => updateField(selected.id, { proposed_start_date: e.target.value })} />
                        </div>
                        <div>
                          <label style={lbl}>Listing URL</label>
                          <input style={inp} type="url" placeholder="https://rightmove.co.uk/..." defaultValue={selected.listing_url || ''}
                            onBlur={e => updateField(selected.id, { listing_url: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Applicant tab */}
                  {detailTab === 'applicant' && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {[
                        { field: 'applicant_name',  label: 'Full name',     type: 'text',  placeholder: 'e.g. Sarah Mitchell' },
                        { field: 'applicant_email', label: 'Email',         type: 'email', placeholder: 'e.g. sarah@email.com' },
                        { field: 'applicant_phone', label: 'Phone',         type: 'tel',   placeholder: 'e.g. 07700 900123' },
                        { field: 'enquiry_count',   label: 'Enquiry count', type: 'number', placeholder: '0' },
                      ].map(f => (
                        <div key={f.field}>
                          <label style={lbl}>{f.label}</label>
                          <input style={inp} type={f.type} placeholder={f.placeholder} defaultValue={selected[f.field] || ''}
                            onBlur={e => updateField(selected.id, { [f.field]: f.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value })} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Checklist tab */}
                  {detailTab === 'checklist' && (
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 12 }}>
                        Stage: {stage.label} · {checkItems.filter(i => checklist[i.key]).length}/{checkItems.length} complete
                      </div>
                      {/* Progress */}
                      <div style={{ height: 4, background: T.border, borderRadius: 3, marginBottom: 14 }}>
                        <div style={{ height: '100%', borderRadius: 3, background: stage.color, width: `${donePct}%`, transition: 'width 0.3s' }} />
                      </div>
                      {checkItems.map(item => (
                        <div key={item.key} onClick={() => toggleCheck(selected.id, selected.stage, item.key, !!checklist[item.key])}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${checklist[item.key] ? stage.color : T.border}`,
                            background: checklist[item.key] ? stage.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#fff', transition: 'all 0.15s',
                          }}>
                            {checklist[item.key] ? '✓' : ''}
                          </div>
                          <span style={{ fontFamily: mono, fontSize: 12, color: checklist[item.key] ? T.muted : T.text, textDecoration: checklist[item.key] ? 'line-through' : 'none' }}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes tab */}
                  {detailTab === 'notes' && (
                    <div>
                      <label style={lbl}>Notes</label>
                      <textarea style={{ ...inp, height: 160, resize: 'vertical', lineHeight: 1.6 }}
                        defaultValue={selected.notes || ''}
                        placeholder="Any notes about this letting…"
                        onBlur={e => updateField(selected.id, { notes: e.target.value })} />
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Actions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {nextStage && (
                      <button onClick={() => moveStage(selected.id, nextStageKey)}
                        style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 8, border: 'none', background: nextStage.color, color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                        Move to <StageTag stage={nextStage} size={12}/> →
                      </button>
                    )}
                    {selected.stage === 'movein' && (
                      <button onClick={() => moveStage(selected.id, null)}
                        style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 8, border: 'none', background: '#2ECC8A', color: '#0E3B27', cursor: 'pointer', textAlign: 'left' }}>
                        Mark as let agreed — archive
                      </button>
                    )}
                    {/* Move back */}
                    <select onChange={e => { if (e.target.value) { moveStage(selected.id, e.target.value); e.target.value = '' } }}
                      style={{ ...inp, fontSize: 11, color: T.muted }}>
                      <option value="">Move to different stage…</option>
                      {STAGES.filter(s => s.key !== selected.stage).map(s => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                      <option value="withdrawn">↩ Mark as withdrawn</option>
                    </select>
                    <button onClick={() => deleteLetting(selected.id)}
                      style={{ fontFamily: mono, fontSize: 11, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                      Delete letting
                    </button>
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
