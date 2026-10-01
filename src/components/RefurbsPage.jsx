// Refurbs — every refurbishment across every company in one place.
//
// Two numbers run the page: what was AGREED with the builder (original quote
// plus extras) and what has been PAID. Everything else (stage board,
// milestones, dates, contractor) is an optional layer. All arithmetic lives
// in lib/refurbs.js (pure, tested); this file is layout and forms.
//
// Data flows through App's `properties` state: each property carries
// refurb_projects (with refurb_lines) from fetchProperties(). Every write
// here patches that state via onPropertyPatch so Deals cashflow, the
// dashboard and the property Refurb tab stay in step without a refetch.
// The DB mirrors properties.refurb_cost (= paid) and refurb_status by
// trigger; mirrorFields() reproduces that locally.
//
// URL: #/refurbs (cards) | #/refurbs/list | #/refurbs/board | #/refurbs/payments |
//      #/refurbs/invoices | #/refurbs/invoices/import | #/refurbs/invoice/<id> |
//      #/refurbs/project/<id>/<section>[/<stageId>]  (the workspace, refurbs/RefurbWorkspace.jsx)
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { useIsMobile } from '../lib/useWindowSize'
import { useConfirm } from '../lib/ConfirmContext'
import { canDo } from '../lib/permissions'
import MoneyInput from '../lib/MoneyInput'
import {
  STAGES, STAGE_CFG, FUNDING_OPTIONS,
  projectTotals, daysLeft, isOverdue, suggestStage, mirrorFields,
  projectsFromProperties, summariseProjects, ledgerLines, knownPayees, isActiveProject,
} from '../lib/refurbs'
import { invoicedByProject, outstandingOn } from '../lib/refurbInvoices'
import { BUILT_IN_TEMPLATES, PROJECT_TYPES, filterProjects, distinctValues, journeySummary, forecastFinalCost } from '../lib/refurbWorkspace'
import { useRefurbInvoices, allLinesOf, ImportRefurbInvoice, InvoiceList, InvoiceDetail, ProjectInvoices } from './RefurbInvoices'
import RefurbWorkspace, { WORKSPACE_TABS } from './refurbs/RefurbWorkspace'
import { CoverImage } from './refurbs/CoverPhoto'

const mono = MONO
const fmt = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const fmtLine = n => {
  const v = Number(n) || 0
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const todayISO = () => new Date().toISOString().slice(0, 10)
const ACTIVE_VIEWS = ['cards', 'list', 'board', 'payments', 'invoices']

// ── Shared: permissions + mutations ────────────────────────────────────────
function useCanEdit(permissionsMap, devModeActive) {
  return useCallback(companyId => devModeActive
    || canDo(permissionsMap, companyId, 'edit_properties')
    || canDo(permissionsMap, companyId, 'edit_financial'), [permissionsMap, devModeActive])
}

// All writes go through here so the property patch (projects + mirror) is
// applied identically from the page and from the property tab.
function useRefurbMutations({ properties, onPropertyPatch, showToast }) {
  const propsRef = useRef(properties)
  useEffect(() => { propsRef.current = properties }, [properties])

  const patch = useCallback((propertyId, nextProjects) => {
    onPropertyPatch(propertyId, { refurb_projects: nextProjects, ...(mirrorFields(nextProjects) || {}) })
  }, [onPropertyPatch])

  const projectsOf = propertyId => ((propsRef.current || []).find(p => p.id === propertyId)?.refurb_projects) || []

  const wrap = fn => async (...args) => {
    try { return await fn(...args) }
    catch (e) { console.error(e); showToast?.(e.message || 'Something went wrong', 'error'); return null }
  }

  const createProject = wrap(async (propertyId, fields, opts) => {
    const prop = (propsRef.current || []).find(p => p.id === propertyId)
    const created = await api.createRefurbProject({ property_id: propertyId, company_id: prop?.company_id || null, ...fields }, opts)
    patch(propertyId, [...projectsOf(propertyId), created])
    return created
  })

  const updateProject = wrap(async (propertyId, projectId, fields) => {
    const updated = await api.updateRefurbProject(projectId, fields)
    patch(propertyId, projectsOf(propertyId).map(p => p.id === projectId ? { ...p, ...updated, refurb_lines: updated.refurb_lines ?? p.refurb_lines } : p))
    return updated
  })

  const deleteProject = wrap(async (propertyId, projectId) => {
    await api.deleteRefurbProject(projectId)
    patch(propertyId, projectsOf(propertyId).filter(p => p.id !== projectId))
    return true
  })

  const addLine = wrap(async (propertyId, projectId, line) => {
    const created = await api.createRefurbLine(projectId, line)
    patch(propertyId, projectsOf(propertyId).map(p => p.id === projectId ? { ...p, refurb_lines: [...(p.refurb_lines || []), created] } : p))
    return created
  })

  const updateLine = wrap(async (propertyId, projectId, lineId, fields) => {
    const updated = await api.updateRefurbLine(lineId, fields)
    patch(propertyId, projectsOf(propertyId).map(p => p.id === projectId ? { ...p, refurb_lines: (p.refurb_lines || []).map(l => l.id === lineId ? updated : l) } : p))
    return updated
  })

  const deleteLine = wrap(async (propertyId, projectId, lineId) => {
    await api.deleteRefurbLine(lineId)
    patch(propertyId, projectsOf(propertyId).map(p => p.id === projectId ? { ...p, refurb_lines: (p.refurb_lines || []).filter(l => l.id !== lineId) } : p))
    return true
  })

  return { createProject, updateProject, deleteProject, addLine, updateLine, deleteLine }
}

// ── Small presentational bits ──────────────────────────────────────────────
function StageChip({ stage, T }) {
  const c = STAGE_CFG[stage] || STAGE_CFG.planned
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.color + '22', color: c.color, border: `1px solid ${c.color}44`, whiteSpace: 'nowrap' }}>{c.label}</span>
}

function CoChip({ company, T }) {
  if (!company) return null
  const col = company.color || T.gold
  return <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: col + '22', color: col, whiteSpace: 'nowrap' }}>{company.abbr || company.name}</span>
}

function Progress({ pct, tone, T, height = 6, max = 420 }) {
  const col = tone === 'bad' ? T.red : tone === 'warn' ? T.amber : T.green
  return <div style={{ height, background: T.bg, borderRadius: height / 2, overflow: 'hidden', maxWidth: max, border: `1px solid ${T.border}` }}>
    <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: col, transition: 'width .2s' }} />
  </div>
}

function Metric({ label, value, color, T }) {
  return <div>
    <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
    <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: color || T.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
}

function toneFor(project, t, today) {
  if (t.over || t.overpaid > 0) return 'bad'
  if (project.stage === 'snagging' || isOverdue(project, today)) return 'warn'
  return 'ok'
}

const inputStyle = T => ({ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '6px 8px', outline: 'none', width: '100%' })
const btn = (T, kind = 'ghost') => ({
  fontFamily: mono, fontSize: 11, fontWeight: kind === 'gold' ? 700 : 500, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  background: kind === 'gold' ? T.gold : 'transparent', color: kind === 'gold' ? '#fff' : kind === 'danger' ? T.red : T.muted,
  border: `1px solid ${kind === 'gold' ? T.gold : kind === 'danger' ? T.red + '66' : T.border}`,
})

// ── New refurb form ────────────────────────────────────────────────────────
function NewRefurbForm({ properties, companies, fixedPropertyId, defaultType = 'residential', templates = [], people = [], onCreate, onCancel, T }) {
  const [propertyId, setPropertyId] = useState(fixedPropertyId || '')
  const [type, setType] = useState(defaultType)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [contractor, setContractor] = useState('')
  const [manager, setManager] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [journey, setJourney] = useState('builtin')
  const [saving, setSaving] = useState(false)
  const byCompany = useMemo(() => {
    const groups = new Map()
    for (const p of properties) {
      if (p.status === 'sold') continue
      const key = p.company_id || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(p)
    }
    return groups
  }, [properties])
  const coName = id => companies.find(c => c.id === id)?.name || 'No company'
  const prop = properties.find(p => p.id === propertyId)
  const saved = templates.filter(t => !t.company_id || t.company_id === prop?.company_id)

  async function submit() {
    if (!propertyId) return
    setSaving(true)
    const tpl = journey === 'builtin' ? BUILT_IN_TEMPLATES[type]
      : journey === 'none' ? null
      : (() => { const t = saved.find(x => x.id === journey); return t ? { name: t.name, stages: t.stages } : null })()
    await onCreate(propertyId, {
      title: title.trim() || 'Refurbishment', stage: 'planned', project_type: type,
      agreed_price: Number(price) || 0,
      contractor_name: contractor.trim() || null,
      project_manager_name: manager.trim() || null,
      start_date: start || null, target_end_date: end || null, original_end_date: end || null,
    }, tpl)
    setSaving(false)
  }

  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 4 }
  return <div style={{ background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
    <div style={{ fontFamily: mono, fontSize: 11, color: T.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>New refurb</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {!fixedPropertyId && <div>
        <label style={lbl}>Property</label>
        <select value={propertyId} onChange={e => setPropertyId(e.target.value)} style={inputStyle(T)}>
          <option value="">Choose a property</option>
          {[...byCompany.entries()].map(([cid, list]) => (
            <optgroup key={cid || 'none'} label={coName(cid)}>
              {list.map(p => <option key={p.id} value={p.id}>{p.name || p.address}</option>)}
            </optgroup>
          ))}
        </select>
      </div>}
      <div>
        <label style={lbl}>Type</label>
        <select value={type} onChange={e => setType(e.target.value)} style={inputStyle(T)}>
          {PROJECT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Project name (optional)</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Full refurb and rewire" style={inputStyle(T)} />
      </div>
      <div>
        <label style={lbl}>Agreed price</label>
        <MoneyInput prefix="£" value={price} onChange={v => setPrice(v == null ? '' : v)} placeholder="0" style={inputStyle(T)} />
      </div>
      <div>
        <label style={lbl}>Main contractor</label>
        <input list="refurb-payees" value={contractor} onChange={e => setContractor(e.target.value)} placeholder="e.g. GLB Builders" style={inputStyle(T)} />
      </div>
      <div>
        <label style={lbl}>Project manager</label>
        <input list="refurb-new-people" value={manager} onChange={e => setManager(e.target.value)} placeholder="Name" style={inputStyle(T)} />
        <datalist id="refurb-new-people">{people.map(p => <option key={p} value={p} />)}</datalist>
      </div>
      <div>
        <label style={lbl}>Planned start</label>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle(T)} />
      </div>
      <div>
        <label style={lbl}>Planned completion</label>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle(T)} />
      </div>
      <div>
        <label style={lbl}>Journey</label>
        <select value={journey} onChange={e => setJourney(e.target.value)} style={inputStyle(T)}>
          <option value="builtin">{type === 'commercial' ? 'Commercial' : 'Residential'} template</option>
          {saved.map(t => <option key={t.id} value={t.id}>Saved: {t.name}</option>)}
          <option value="none">Choose later</option>
        </select>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      <button onClick={submit} disabled={!propertyId || saving} style={{ ...btn(T, 'gold'), opacity: !propertyId || saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create refurb'}</button>
      <button onClick={onCancel} style={btn(T)}>Cancel</button>
    </div>
    <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 10 }}>Only the property is required. The cover photo, stages, dates and payments are added in the workspace.</div>
  </div>
}

// ── Project detail ─────────────────────────────────────────────────────────
function ProjectDetail({ project, property, company, canEdit, payees, mutations, onBack, onDelete, embedded = false, costsOnly = false, invoices = [], allLines = [], onOpenInvoice, T, isMobile }) {
  const confirmDialog = useConfirm()
  const t = projectTotals(project)
  const today = new Date()
  const days = daysLeft(project, today)
  const tone = toneFor(project, t, today)
  const [form, setForm] = useState(() => detailForm(project))
  useEffect(() => { setForm(detailForm(project)) }, [project.id, project.updated_at])
  const [milestones, setMilestones] = useState(null)
  const [suggest, setSuggest] = useState(null)
  const [quick, setQuick] = useState({ kind: 'payment', amount: '', date: todayISO(), payee: project.contractor_name || '', description: '' })
  const [editingLine, setEditingLine] = useState(null)
  const [lineEdit, setLineEdit] = useState({})
  const lines = (project.refurb_lines || []).filter(l => !l.deleted_at)
  // Invoiced sits beside Agreed and Paid and never changes either (25 Sep
  // 2026 ruling): only a variation extra raises Agreed, only payments Paid.
  const invoiced = useMemo(() => invoicedByProject(invoices).get(project.id) || 0, [invoices, project.id])
  const extras = lines.filter(l => l.kind === 'extra').sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const payments = lines.filter(l => l.kind !== 'extra').sort((a, b) => String(a.date).localeCompare(String(b.date)))

  useEffect(() => {
    if (costsOnly) return undefined
    let alive = true
    api.fetchRefurbMilestones(project.id).then(rows => {
      if (!alive) return
      if (rows.length === 0 && canEdit) {
        api.initialiseRefurbMilestones(project.id).then(() => api.fetchRefurbMilestones(project.id)).then(r => alive && setMilestones(r)).catch(() => alive && setMilestones([]))
      } else setMilestones(rows)
    }).catch(() => alive && setMilestones([]))
    return () => { alive = false }
  }, [project.id, canEdit, costsOnly])

  function detailForm(p) {
    return {
      agreed_price: p.agreed_price ?? '', contractor_name: p.contractor_name || '', start_date: p.start_date || '',
      target_end_date: p.target_end_date || '', completed_date: p.completed_date || '', funding: p.funding || '',
      expected_rent_after: p.expected_rent_after ?? '', expected_value_after: p.expected_value_after ?? '',
      treatment: p.treatment || 'capital', notes: p.notes || '', title: p.title || 'Refurbishment',
    }
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  async function saveField(k) {
    if (!canEdit) return
    let v = form[k]
    if (['agreed_price', 'expected_rent_after', 'expected_value_after'].includes(k)) v = v === '' || v == null ? (k === 'agreed_price' ? 0 : null) : Number(v)
    if (['start_date', 'target_end_date', 'completed_date', 'funding', 'contractor_name', 'notes'].includes(k)) v = v === '' ? null : v
    if (v === (project[k] ?? (k === 'agreed_price' ? 0 : null))) return
    await mutations.updateProject(property.id, project.id, { [k]: v })
  }

  async function changeStage(stage) {
    if (!canEdit || stage === project.stage) return
    const fields = { stage }
    if (stage === 'complete' && !project.completed_date) fields.completed_date = todayISO()
    if (stage !== 'complete' && project.completed_date) fields.completed_date = null
    await mutations.updateProject(property.id, project.id, fields)
    setSuggest(null)
  }

  async function addQuick() {
    const amount = Number(quick.amount)
    if (!amount || amount <= 0) return
    const created = await mutations.addLine(property.id, project.id, {
      kind: quick.kind, amount, date: quick.date || todayISO(),
      payee: quick.payee.trim() || null, description: quick.description.trim() || null,
    })
    if (!created) return
    setQuick(q => ({ ...q, amount: '', description: '' }))
    // Forward-only nudges: first payment on a planned job moves it on
    // quietly; paying in full asks before marking complete.
    const next = { ...project, refurb_lines: [...lines, created] }
    const s = suggestStage(next)
    if (s === 'in_progress') mutations.updateProject(property.id, project.id, { stage: 'in_progress' })
    else if (s === 'complete') setSuggest('complete')
  }

  function startEdit(l) { setEditingLine(l.id); setLineEdit({ amount: l.amount, date: l.date || '', payee: l.payee || '', description: l.description || '', kind: l.kind }) }
  async function saveEdit() {
    const amount = Number(lineEdit.amount)
    if (!amount || amount <= 0) return
    await mutations.updateLine(property.id, project.id, editingLine, { amount, date: lineEdit.date || todayISO(), payee: lineEdit.payee.trim() || null, description: lineEdit.description.trim() || null, kind: lineEdit.kind })
    setEditingLine(null)
  }
  async function removeLine(l) {
    if (!await confirmDialog({ title: `Delete this ${l.kind}?`, body: `${fmtLine(l.amount)} on ${fmtDate(l.date)}. It goes to Trash.`, confirmLabel: 'Delete', destructive: true })) return
    await mutations.deleteLine(property.id, project.id, l.id)
  }
  async function toggleMilestone(m) {
    if (!canEdit) return
    const fields = { completed: !m.completed, completed_date: !m.completed ? todayISO() : null }
    setMilestones(ms => ms.map(x => x.id === m.id ? { ...x, ...fields } : x))
    try { await api.updateRefurbMilestone(m.id, fields) } catch (e) { setMilestones(ms => ms.map(x => x.id === m.id ? m : x)) }
  }

  const panel = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }
  const ph = { fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const lineRow = { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.border}`, fontSize: 13 }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 4 }
  const iconBtn = { fontFamily: mono, fontSize: 11, padding: '3px 7px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', color: T.muted }

  const renderLine = (l, showKind) => editingLine === l.id ? (
    <div key={l.id} style={{ ...lineRow, gridTemplateColumns: '1fr', border: `1px solid ${T.gold}44`, borderRadius: 8, padding: 10, marginBottom: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1.2fr 1.4fr', gap: 8 }}>
        <div><label style={lbl}>Amount</label><MoneyInput prefix="£" value={lineEdit.amount} onChange={v => setLineEdit(e => ({ ...e, amount: v == null ? '' : v }))} allowDecimals style={inputStyle(T)} /></div>
        <div><label style={lbl}>Date</label><input type="date" value={lineEdit.date} onChange={e => setLineEdit(x => ({ ...x, date: e.target.value }))} style={inputStyle(T)} /></div>
        <div><label style={lbl}>Paid to</label><input list="refurb-payees" value={lineEdit.payee} onChange={e => setLineEdit(x => ({ ...x, payee: e.target.value }))} style={inputStyle(T)} /></div>
        <div><label style={lbl}>Note</label><input value={lineEdit.description} onChange={e => setLineEdit(x => ({ ...x, description: e.target.value }))} style={inputStyle(T)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {showKind && <select value={lineEdit.kind} onChange={e => setLineEdit(x => ({ ...x, kind: e.target.value }))} style={{ ...inputStyle(T), width: 'auto' }}><option value="payment">Payment</option><option value="credit">Credit / refund</option></select>}
        <button onClick={saveEdit} style={btn(T, 'gold')}>Save</button>
        <button onClick={() => setEditingLine(null)} style={btn(T)}>Cancel</button>
      </div>
    </div>
  ) : (
    <div key={l.id} style={lineRow}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description || (l.kind === 'extra' ? 'Extra' : l.kind === 'credit' ? 'Credit' : 'Payment')}</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{fmtDate(l.date)}{l.payee ? ` · ${l.payee}` : ''}{l.kind === 'credit' ? ' · credit' : ''}</div>
      </div>
      <div style={{ fontFamily: mono, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: l.kind === 'extra' ? T.amber : l.kind === 'credit' ? T.blue : T.green }}>
        {l.kind === 'extra' ? '+ ' : l.kind === 'credit' ? '− ' : ''}{fmtLine(l.amount)}
      </div>
      {canEdit ? <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => startEdit(l)} style={iconBtn} title="Edit">✎</button>
        <button onClick={() => removeLine(l)} style={iconBtn} title="Delete">🗑</button>
      </div> : <span />}
    </div>
  )

  return <div className="fade">
    <datalist id="refurb-payees">{payees.map(p => <option key={p} value={p} />)}</datalist>

    {/* Header (the workspace has its own when costsOnly) */}
    {!costsOnly && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        {!embedded && <button onClick={onBack} style={{ ...btn(T), marginBottom: 8 }}>← All refurbs</button>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!embedded && <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{property.name || property.address}</h2>}
          {embedded && <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{project.title || 'Refurbishment'}</h3>}
          <StageChip stage={project.stage} T={T} />
          {!embedded && <CoChip company={company} T={T} />}
          {t.over && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.red + '22', color: T.red }}>{fmt(t.extras)} over original</span>}
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
          {!embedded && property.address && property.address !== property.name ? `${property.address} · ` : ''}
          {project.start_date ? `started ${fmtDate(project.start_date)}` : 'not started'}
          {days != null && project.stage !== 'complete' ? ` · ${days < 0 ? `${-days} days overdue` : days === 0 ? 'due today' : `${days} days left`}` : ''}
          {project.stage === 'complete' && project.completed_date ? ` · finished ${fmtDate(project.completed_date)}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={project.stage} disabled={!canEdit} onChange={e => changeStage(e.target.value)} style={{ ...inputStyle(T), width: 'auto', fontWeight: 700 }}>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_CFG[s].label}</option>)}
        </select>
        {canEdit && <button onClick={onDelete} style={btn(T, 'danger')}>Delete</button>}
      </div>
    </div>}

    {suggest === 'complete' && project.stage !== 'complete' && (
      <div style={{ background: T.green + '15', border: `1px solid ${T.green}55`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.text }}>Paid in full. Mark this refurb as complete?</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => changeStage('complete')} style={btn(T, 'gold')}>Mark complete</button>
          <button onClick={() => setSuggest(null)} style={btn(T)}>Not yet</button>
        </div>
      </div>
    )}

    {/* Summary strip */}
    <div style={{ ...panel, display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${invoiced ? 6 : 5}, 1fr)`, gap: 14 }}>
      <Metric label="Agreed" value={fmt(t.agreed)} T={T} />
      {invoiced !== 0 && <Metric label="Invoiced" value={fmt(invoiced)} color={T.blue} T={T} />}
      <Metric label="Extras" value={fmt(t.extras)} color={t.extras > 0 ? T.amber : T.muted} T={T} />
      <Metric label="Paid" value={fmt(t.paid)} color={T.green} T={T} />
      <Metric label="Remaining" value={t.overpaid > 0 ? `${fmt(t.overpaid)} over` : fmt(t.remaining)} color={t.overpaid > 0 ? T.red : T.gold} T={T} />
      <div><Metric label="Progress" value={`${t.pct}%`} T={T} /><Progress pct={t.pct} tone={tone} T={T} height={5} max={200} /></div>
    </div>

    {/* Traceability: which contractor invoices generated this refurb's cost. */}
    <ProjectInvoices project={project} invoices={invoices} lines={allLines} onOpenInvoice={onOpenInvoice} T={T} />

    <div style={{ display: 'grid', gridTemplateColumns: isMobile || costsOnly ? '1fr' : '1.6fr 1fr', gap: 14 }}>
      <div>
        {/* Agreed price */}
        <div style={panel}>
          <div style={ph}><span>Agreed price</span></div>
          <div style={lineRow}>
            <div>
              <div style={{ color: T.text }}>Original quote</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{project.contractor_name ? `${project.contractor_name} · ` : ''}what was agreed before work started</div>
            </div>
            <div style={{ width: 130 }}>
              <MoneyInput prefix="£" value={form.agreed_price} onChange={v => set('agreed_price', v == null ? '' : v)} onBlur={() => saveField('agreed_price')} disabled={!canEdit} placeholder="0"
                style={{ ...inputStyle(T), textAlign: 'right', fontWeight: 700 }} />
            </div>
            <span />
          </div>
          {extras.map(l => renderLine(l, false))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 12, paddingTop: 10, marginTop: 4, borderTop: `1px dashed ${T.border}` }}>
            <span style={{ color: T.muted }}>Total agreed</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(t.agreed)}</b>
          </div>
          {canEdit && quick.kind === 'extra' ? (
            <QuickAdd quick={quick} setQuick={setQuick} onAdd={addQuick} onCancel={() => setQuick(q => ({ ...q, kind: 'payment' }))} T={T} isMobile={isMobile} />
          ) : canEdit && (
            <button onClick={() => setQuick(q => ({ ...q, kind: 'extra', description: '' }))} style={{ ...btn(T), marginTop: 10 }}>+ Extra (builder added cost)</button>
          )}
        </div>

        {/* Payments */}
        <div style={panel}>
          <div style={ph}><span>Payments</span><span style={{ fontFamily: mono, fontSize: 10, color: T.faint, textTransform: 'none', letterSpacing: 0 }}>{payments.length} {payments.length === 1 ? 'entry' : 'entries'}</span></div>
          {payments.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '10px 0' }}>Nothing paid yet.</div>}
          {payments.map(l => renderLine(l, true))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 12, paddingTop: 10, marginTop: 4, borderTop: `1px dashed ${T.border}` }}>
            <span style={{ color: T.muted }}>Paid so far</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(t.paid)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 12, paddingTop: 4 }}>
            <span style={{ color: T.muted }}>{t.overpaid > 0 ? 'Paid over agreed' : 'Remaining to pay'}</span><b style={{ color: t.overpaid > 0 ? T.red : T.gold, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.overpaid > 0 ? t.overpaid : t.remaining)}</b>
          </div>
          {canEdit && quick.kind !== 'extra' && <QuickAdd quick={quick} setQuick={setQuick} onAdd={addQuick} T={T} isMobile={isMobile} allowCredit />}
        </div>
      </div>

      {!costsOnly && <div>
        {/* Details */}
        <div style={panel}>
          <div style={ph}><span>Details</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={lbl}>Contractor</label><input list="refurb-payees" value={form.contractor_name} onChange={e => set('contractor_name', e.target.value)} onBlur={() => saveField('contractor_name')} disabled={!canEdit} placeholder="Main contractor" style={inputStyle(T)} /></div>
            <div><label style={lbl}>Funded by</label>
              <select value={form.funding} onChange={e => { set('funding', e.target.value); setTimeout(() => saveField('funding'), 0) }} onBlur={() => saveField('funding')} disabled={!canEdit} style={inputStyle(T)}>
                <option value="">Not set</option>{FUNDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></div>
            <div><label style={lbl}>Started</label><input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} onBlur={() => saveField('start_date')} disabled={!canEdit} style={inputStyle(T)} /></div>
            <div><label style={lbl}>Target finish</label><input type="date" value={form.target_end_date} onChange={e => set('target_end_date', e.target.value)} onBlur={() => saveField('target_end_date')} disabled={!canEdit} style={inputStyle(T)} /></div>
            {project.stage === 'complete' && <div><label style={lbl}>Finished</label><input type="date" value={form.completed_date} onChange={e => set('completed_date', e.target.value)} onBlur={() => saveField('completed_date')} disabled={!canEdit} style={inputStyle(T)} /></div>}
            <div><label style={lbl}>Expected rent after</label><MoneyInput prefix="£" value={form.expected_rent_after} onChange={v => set('expected_rent_after', v == null ? '' : v)} onBlur={() => saveField('expected_rent_after')} disabled={!canEdit} placeholder="pcm" style={inputStyle(T)} /></div>
            <div><label style={lbl}>Expected value after</label><MoneyInput prefix="£" value={form.expected_value_after} onChange={v => set('expected_value_after', v == null ? '' : v)} onBlur={() => saveField('expected_value_after')} disabled={!canEdit} placeholder="0" style={inputStyle(T)} /></div>
            <div><label style={lbl}>Treatment</label>
              <select value={form.treatment} onChange={e => { set('treatment', e.target.value); setTimeout(() => saveField('treatment'), 0) }} disabled={!canEdit} style={inputStyle(T)}>
                <option value="capital">Capital (improvement)</option><option value="revenue">Revenue (repair)</option>
              </select></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={lbl}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} onBlur={() => saveField('notes')} disabled={!canEdit} rows={3} placeholder="Scope, quotes, anything worth remembering" style={{ ...inputStyle(T), resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
          </div>
        </div>

        {/* Milestones */}
        <div style={panel}>
          <div style={ph}><span>Milestones</span>{milestones && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint, textTransform: 'none', letterSpacing: 0 }}>{milestones.filter(m => m.completed).length}/{milestones.length}</span>}</div>
          {milestones == null && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>Loading…</div>}
          {milestones && milestones.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No checklist for this refurb.</div>}
          {milestones && milestones.filter(m => m.is_enabled !== false).map(m => (
            <button key={m.id} onClick={() => toggleMilestone(m)} disabled={!canEdit}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', padding: '6px 0', cursor: canEdit ? 'pointer' : 'default', textAlign: 'left', color: m.completed ? T.muted : T.text, fontSize: 13, textDecoration: m.completed ? 'line-through' : 'none' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${m.completed ? T.green : T.border}`, background: m.completed ? T.green : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, flexShrink: 0 }}>{m.completed ? '✓' : ''}</span>
              <span style={{ flex: 1 }}>{m.label}</span>
              {m.completed && m.completed_date && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{fmtDate(m.completed_date)}</span>}
            </button>
          ))}
        </div>
      </div>}
    </div>
  </div>
}

function QuickAdd({ quick, setQuick, onAdd, onCancel, T, isMobile, allowCredit = false }) {
  const isExtra = quick.kind === 'extra'
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 4 }
  return <div style={{ marginTop: 12, padding: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8 }}>
    <div style={{ fontFamily: mono, fontSize: 10, color: isExtra ? T.amber : T.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{isExtra ? 'Add an extra' : 'Log a payment'}</div>
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1.2fr 1.6fr auto', gap: 8, alignItems: 'end' }}>
      <div><label style={lbl}>Amount</label><MoneyInput prefix="£" value={quick.amount} onChange={v => setQuick(q => ({ ...q, amount: v == null ? '' : v }))} allowDecimals placeholder="0" style={inputStyle(T)}
        onKeyDown={e => { if (e.key === 'Enter') onAdd() }} /></div>
      <div><label style={lbl}>Date</label><input type="date" value={quick.date} onChange={e => setQuick(q => ({ ...q, date: e.target.value }))} style={inputStyle(T)} /></div>
      <div><label style={lbl}>{isExtra ? 'Agreed with' : 'Paid to'}</label><input list="refurb-payees" value={quick.payee} onChange={e => setQuick(q => ({ ...q, payee: e.target.value }))} placeholder="Contractor" style={inputStyle(T)} /></div>
      <div><label style={lbl}>{isExtra ? 'What was added' : 'Note'}</label><input value={quick.description} onChange={e => setQuick(q => ({ ...q, description: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') onAdd() }} placeholder={isExtra ? 'e.g. Rewire to current regs' : 'e.g. Second stage payment'} style={inputStyle(T)} /></div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onAdd} disabled={!Number(quick.amount)} style={{ ...btn(T, 'gold'), opacity: Number(quick.amount) ? 1 : 0.5 }}>Add</button>
        {onCancel && <button onClick={onCancel} style={btn(T)}>Cancel</button>}
      </div>
    </div>
    {allowCredit && !isExtra && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={quick.kind === 'credit'} onChange={e => setQuick(q => ({ ...q, kind: e.target.checked ? 'credit' : 'payment' }))} style={{ width: 'auto', margin: 0 }} />
      This is a refund or credit from the contractor
    </label>}
  </div>
}

// ── List row ───────────────────────────────────────────────────────────────
function ProjectRow({ project, journey, canEdit, onOpen, onQuickPay, T, isMobile }) {
  const t = projectTotals(project)
  const today = new Date()
  const days = daysLeft(project, today)
  const tone = toneFor(project, t, today)
  const stripe = tone === 'bad' ? T.red : tone === 'warn' ? T.amber : (STAGE_CFG[project.stage]?.color || T.blue)
  const p = project.property
  return <div style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `4px solid ${stripe}`, borderRadius: 12, padding: '14px 18px', marginBottom: 10, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: 12, alignItems: 'center' }}>
    <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{p?.name || p?.address || 'Property'}</b>
        <StageChip stage={project.stage} T={T} />
        <CoChip company={p?.company} T={T} />
        {project.contractor_name && <span style={{ fontFamily: mono, fontSize: 10, padding: '2px 8px', borderRadius: 20, background: T.bg, color: T.muted, border: `1px solid ${T.border}` }}>{project.contractor_name}</span>}
        {t.over && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.red + '22', color: T.red }}>{fmt(t.extras)} over</span>}
        {t.agreed <= 0 && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.amber + '22', color: T.amber }}>No price yet</span>}
        {journey?.overdueTasks?.length > 0 && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.red + '22', color: T.red }}>{journey.overdueTasks.length} overdue</span>}
        {journey?.blocked?.length > 0 && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.red + '22', color: T.red }}>{journey.blocked.length} blocked</span>}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>
        {journey?.current ? `${journey.current.name} · works ${journey.progress.pct}% · ` : journey?.progress?.hasJourney ? `All stages complete · ` : ''}
        {project.project_manager_name ? `PM ${project.project_manager_name} · ` : ''}
        {project.next_action ? `Next: ${project.next_action}` : ''}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>
        {p?.address && p.address !== p.name ? `${p.address} · ` : ''}
        {project.target_end_date ? `target ${fmtDate(project.target_end_date)}` : 'no target date'}
        {days != null && project.stage !== 'complete' ? ` · ${days < 0 ? `${-days} days overdue` : days === 0 ? 'due today' : `${days} days left`}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 22, marginTop: 10, flexWrap: 'wrap' }}>
        <Metric label="Agreed" value={fmt(t.agreed)} T={T} />
        <Metric label="Extras" value={fmt(t.extras)} color={t.extras > 0 ? T.amber : T.muted} T={T} />
        <Metric label="Paid" value={fmt(t.paid)} color={T.green} T={T} />
        <Metric label="Remaining" value={t.overpaid > 0 ? `${fmt(t.overpaid)} over` : fmt(t.remaining)} color={t.overpaid > 0 ? T.red : T.gold} T={T} />
        <Metric label="Paid %" value={`${t.pct}%`} T={T} />
      </div>
      <Progress pct={t.pct} tone={tone} T={T} />
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      {canEdit && project.stage !== 'complete' && <button onClick={onQuickPay} style={btn(T, 'gold')}>+ Payment</button>}
      <button onClick={onOpen} style={btn(T)}>Open →</button>
    </div>
  </div>
}

// ── Board ──────────────────────────────────────────────────────────────────
function Board({ projects, canEdit, onOpen, onStage, T }) {
  const [dragId, setDragId] = useState(null)
  const cols = STAGES
  return <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(200px, 1fr))`, gap: 10, minWidth: 1000 }}>
      {cols.map(stage => {
        const items = projects.filter(p => p.stage === stage)
        const total = items.reduce((s, p) => s + projectTotals(p).remaining, 0)
        return <div key={stage}
          onDragOver={e => { if (canEdit) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); if (dragId && canEdit) onStage(dragId, stage); setDragId(null) }}
          style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, minHeight: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
            <StageChip stage={stage} T={T} />
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{items.length}{stage !== 'complete' && total > 0 ? ` · ${fmt(total)} to pay` : ''}</span>
          </div>
          {items.map(p => {
            const t = projectTotals(p)
            const tone = toneFor(p, t, new Date())
            return <div key={p.id} draggable={canEdit} onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)} onClick={() => onOpen(p)}
              style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', opacity: dragId === p.id ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property?.name || p.property?.address}</b>
                <CoChip company={p.property?.company} T={T} />
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                {stage === 'complete' ? `${fmt(t.paid)}${p.completed_date ? ` · finished ${fmtDate(p.completed_date)}` : ''}` : t.agreed > 0 ? `${fmt(t.paid)} / ${fmt(t.agreed)}` : 'no price yet'}
              </div>
              {stage !== 'complete' && t.agreed > 0 && <div style={{ marginTop: 8 }}><Progress pct={t.pct} tone={tone} T={T} height={4} /></div>}
              {canEdit && <select value={p.stage} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); onStage(p.id, e.target.value) }}
                style={{ ...inputStyle(T), marginTop: 8, fontSize: 10, padding: '3px 6px' }}>
                {STAGES.map(s => <option key={s} value={s}>{STAGE_CFG[s].label}</option>)}
              </select>}
            </div>
          })}
          {items.length === 0 && <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, textAlign: 'center', padding: '20px 0' }}>Nothing here</div>}
        </div>
      })}
    </div>
    {canEdit && <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 6 }}>Drag a card between columns to change its stage, or use the picker on the card.</div>}
  </div>
}

// ── Payments ledger ────────────────────────────────────────────────────────
function Ledger({ projects, onOpen, T, isMobile }) {
  const [payee, setPayee] = useState('all')
  const [kind, setKind] = useState('money') // money = payments + credits, extra, all
  const rows = useMemo(() => ledgerLines(projects).filter(l => (kind === 'all' || (kind === 'money' ? l.kind !== 'extra' : l.kind === kind)) && (payee === 'all' || (l.payee || '') === payee)), [projects, kind, payee])
  const payees = useMemo(() => knownPayees(projects), [projects])
  const total = rows.reduce((s, l) => s + (l.kind === 'credit' ? -1 : l.kind === 'extra' ? 0 : 1) * (Number(l.amount) || 0), 0)

  function exportCsv() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Date', 'Property', 'Company', 'Type', 'Paid to', 'Note', 'Amount']
    const body = rows.map(l => [l.date, l.project.property?.name || l.project.property?.address, l.project.property?.company?.abbr || '', l.kind, l.payee || '', l.description || '', l.kind === 'credit' ? -Number(l.amount) : Number(l.amount)].map(esc).join(','))
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `refurb-payments-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const th = { fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 13, verticalAlign: 'top' }
  return <div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...inputStyle(T), width: 'auto' }}>
        <option value="money">Payments and credits</option><option value="extra">Extras only</option><option value="all">Everything</option>
      </select>
      <select value={payee} onChange={e => setPayee(e.target.value)} style={{ ...inputStyle(T), width: 'auto' }}>
        <option value="all">All payees</option>{payees.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginLeft: 'auto' }}>{rows.length} {rows.length === 1 ? 'line' : 'lines'}{kind !== 'extra' ? ` · ${fmt(total)}` : ''}</span>
      <button onClick={exportCsv} disabled={rows.length === 0} style={btn(T)}>Export CSV</button>
    </div>
    <div style={{ overflowX: 'auto', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: isMobile ? 600 : 0 }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Refurb</th><th style={th}>Type</th><th style={th}>Paid to</th><th style={th}>Note</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} style={{ ...td, fontFamily: mono, fontSize: 11, color: T.faint, textAlign: 'center' }}>No lines yet. Payments logged on any refurb appear here.</td></tr>}
          {rows.map(l => <tr key={l.id}>
            <td style={{ ...td, fontFamily: mono, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(l.date)}</td>
            <td style={td}><button onClick={() => onOpen(l.project)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.text, fontWeight: 600, fontSize: 13, textAlign: 'left' }}>{l.project.property?.name || l.project.property?.address}</button><div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{l.project.property?.company?.abbr || ''}</div></td>
            <td style={{ ...td, fontFamily: mono, fontSize: 11, color: l.kind === 'extra' ? T.amber : l.kind === 'credit' ? T.blue : T.green }}>{l.kind}</td>
            <td style={td}>{l.payee || <span style={{ color: T.faint }}>—</span>}</td>
            <td style={{ ...td, color: T.muted }}>{l.description || ''}</td>
            <td style={{ ...td, fontFamily: mono, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{l.kind === 'credit' ? '−' : ''}{fmtLine(l.amount)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>
}

// ── Card (default view) ───────────────────────────────────────────────────
function ProjectCard({ project, journey, coverUrl, cover, invoiced, onOpen, T }) {
  const t = projectTotals(project)
  const p = project.property
  const days = daysLeft(project)
  const ffc = forecastFinalCost({ agreed: t.agreed, invoiced, committed: 0, override: project.forecast_cost_override })
  const wp = journey?.progress
  const overdue = journey?.overdueTasks?.length || 0
  const blocked = journey?.blocked?.length || 0
  return <button onClick={onOpen} style={{ textAlign: 'left', background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 0, overflow: 'hidden', cursor: 'pointer', color: T.text, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <div style={{ position: 'relative', height: 150, overflow: 'hidden', background: T.bg }}>
      <CoverImage url={coverUrl} crop={cover?.crop} T={T} compact />
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 5 }}>
        <StageChip stage={project.stage} T={T} />
        {project.archived_at && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#000a', color: '#fff' }}>Archived</span>}
      </div>
      {(overdue > 0 || blocked > 0) && <div style={{ position: 'absolute', top: 8, right: 8, fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: T.red, color: '#fff' }}>
        {[overdue ? `${overdue} overdue` : null, blocked ? `${blocked} blocked` : null].filter(Boolean).join(' · ')}
      </div>}
    </div>
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
        <b style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title && project.title !== 'Refurbishment' ? project.title : (p?.name || p?.address || 'Property')}</b>
        <CoChip company={p?.company} T={T} />
      </div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {[p?.address || p?.name, project.project_type === 'commercial' ? 'Commercial' : 'Residential'].filter(Boolean).join(' · ')}
      </div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted }}>
        PM {project.project_manager_name || '—'} · {project.contractor_name || 'No contractor'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginTop: 2 }}>
        <span>{journey?.current ? journey.current.name : wp?.hasJourney ? 'All stages complete' : <span style={{ color: T.faint }}>No journey yet</span>}</span>
        <b>{wp?.hasJourney ? `${wp.pct}%` : ''}</b>
      </div>
      {wp?.hasJourney && <Progress pct={wp.pct} tone="ok" T={T} height={5} max={9999} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
        <Metric label="Start" value={project.start_date ? fmtDate(project.start_date) : '—'} T={T} />
        <Metric label="Forecast finish" value={project.target_end_date ? fmtDate(project.target_end_date) : '—'} color={days != null && days < 0 && project.stage !== 'complete' ? T.red : undefined} T={T} />
        <Metric label="Agreed budget" value={fmt(t.agreed)} T={T} />
        <Metric label="Forecast cost" value={fmt(ffc.value)} color={ffc.variance > 0 ? T.red : undefined} T={T} />
      </div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: project.next_action ? T.gold : T.faint, marginTop: 'auto', paddingTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {project.next_action ? `Next: ${project.next_action}` : 'No next action set'}
      </div>
    </div>
  </button>
}

// ── Page ───────────────────────────────────────────────────────────────────
const VIEWS = [['cards', 'Cards'], ['list', 'List'], ['board', 'Board'], ['payments', 'Payments'], ['invoices', 'Invoices']]
const TAB_KEYS = WORKSPACE_TABS.map(([k]) => k)

function parseRefurbHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  if (parts[0] !== 'refurbs') return null
  if (parts[1] === 'project' && parts[2]) return { projectId: parts[2], section: TAB_KEYS.includes(parts[3]) ? parts[3] : 'overview', stageId: parts[4] || null }
  if (parts[1] === 'invoice' && parts[2]) return { sub: 'invoices', invoiceId: parts[2] }
  if (parts[1] === 'invoices' && parts[2] === 'import') return { sub: 'invoices', importing: true }
  return { sub: ACTIVE_VIEWS.includes(parts[1]) ? parts[1] : 'cards' }
}

const FILTER_KEY = 'refurbs.filters.v1'
const loadFilters = () => {
  try { return { type: 'residential', q: '', companyId: 'all', status: 'active', contractor: 'all', manager: 'all', from: '', to: '', archived: false, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') } }
  catch (_) { return { type: 'residential', q: '', companyId: 'all', status: 'active', contractor: 'all', manager: 'all', from: '', to: '', archived: false } }
}

export default function RefurbsPage({ user, companies = [], properties = [], permissionsMap, devModeActive = false, showToast, openDetail, onPropertyPatch }) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const confirmDialog = useConfirm()
  const canEditFor = useCanEdit(permissionsMap, devModeActive)
  const mutations = useRefurbMutations({ properties, onPropertyPatch, showToast })

  const initial = parseRefurbHash()
  const [sub, setSub] = useState(initial?.sub || 'cards')
  const [selectedId, setSelectedId] = useState(initial?.projectId || null)
  const [section, setSection] = useState(initial?.section || 'overview')
  const [stageId, setStageId] = useState(initial?.stageId || null)
  const [invoiceId, setInvoiceId] = useState(initial?.invoiceId || null)
  const [importing, setImporting] = useState(!!initial?.importing)
  const { invoices, setInvoices } = useRefurbInvoices(showToast)
  const [filters, setFilters] = useState(loadFilters)
  const [creating, setCreating] = useState(false)
  const [quickPayFor, setQuickPayFor] = useState(null)
  const [portfolio, setPortfolio] = useState({ stages: [], tasks: [], covers: [], loaded: false })
  const [coverUrls, setCoverUrls] = useState(new Map())
  const [templates, setTemplates] = useState([])
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters)) } catch (_) { /* per-tab convenience only */ } }, [filters])

  // URL sync: the hash always says which project and section is open, so
  // coming back from an attachment, the property page or a search lands in
  // the same place.
  useEffect(() => {
    const target = selectedId ? `#/refurbs/project/${selectedId}/${section}${stageId ? `/${stageId}` : ''}`
      : invoiceId ? `#/refurbs/invoice/${invoiceId}`
      : importing ? '#/refurbs/invoices/import'
      : sub === 'cards' ? '#/refurbs' : `#/refurbs/${sub}`
    if (window.location.hash !== target) window.location.hash = target
  }, [sub, selectedId, section, stageId, invoiceId, importing])
  useEffect(() => {
    const onHash = () => {
      const h = parseRefurbHash(); if (!h) return
      setSelectedId(h.projectId || null); setSection(h.section || 'overview'); setStageId(h.stageId || null)
      setInvoiceId(h.invoiceId || null); setImporting(!!h.importing); if (h.sub) setSub(h.sub)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Portfolio journey data for the cards, plus signed cover URLs.
  useEffect(() => {
    let alive = true
    api.fetchRefurbPortfolio().then(async d => {
      if (!alive) return
      setPortfolio({ ...d, loaded: true })
      try { const urls = await api.signRefurbPaths(d.covers.map(c => c.file_path)); if (alive) setCoverUrls(urls) } catch (_) { /* covers fall back to placeholder */ }
    }).catch(e => { console.error(e); if (alive) setPortfolio(p => ({ ...p, loaded: true })) })
    api.fetchRefurbTemplates().then(t => alive && setTemplates(t)).catch(() => {})
    return () => { alive = false }
  }, [])

  const onJourneyChange = useCallback((projectId, { stages, tasks, cover }) => {
    setPortfolio(p => ({
      ...p,
      stages: [...p.stages.filter(s => s.project_id !== projectId), ...stages],
      tasks: [...p.tasks.filter(t => t.project_id !== projectId), ...tasks],
      covers: [...p.covers.filter(c => c.project_id !== projectId), ...(cover ? [cover] : [])],
    }))
    if (cover?.file_path) setCoverUrls(m => {
      if (m.has(cover.file_path)) return m
      api.signRefurbPaths([cover.file_path]).then(u => setCoverUrls(prev => new Map([...prev, ...u]))).catch(() => {})
      return m
    })
  }, [])

  const allProjects = useMemo(() => projectsFromProperties(properties), [properties])
  const typed = useMemo(() => filterProjects(allProjects, { type: filters.type, archived: filters.archived }), [allProjects, filters.type, filters.archived])
  const filtered = useMemo(() => filterProjects(allProjects, filters), [allProjects, filters])
  const summary = useMemo(() => summariseProjects(filtered), [filtered])
  const payees = useMemo(() => knownPayees(allProjects), [allProjects])
  const contractors = useMemo(() => distinctValues(typed, 'contractor_name'), [typed])
  const managers = useMemo(() => distinctValues(typed, 'project_manager_name'), [typed])
  const people = useMemo(() => [...new Set([
    ...distinctValues(allProjects, 'project_manager_name'),
    ...portfolio.stages.map(s => (s.responsible_name || '').trim()).filter(Boolean),
  ])], [allProjects, portfolio.stages])
  const selected = selectedId ? allProjects.find(p => p.id === selectedId) : null
  const allLines = useMemo(() => allLinesOf(allProjects), [allProjects])
  const invoicedMap = useMemo(() => invoicedByProject(invoices), [invoices])
  const coInvoices = useMemo(() => filters.companyId === 'all' ? invoices : invoices.filter(i => i.company_id === filters.companyId), [invoices, filters.companyId])
  const invoicesUnpaid = useMemo(() => coInvoices.reduce((s, i) => s + outstandingOn(i, allLines), 0), [coInvoices, allLines])
  const selectedInvoice = invoiceId ? invoices.find(i => i.id === invoiceId) : null
  const journeys = useMemo(() => {
    const m = new Map()
    for (const p of filtered) m.set(p.id, journeySummary(p, portfolio.stages, portfolio.tasks))
    return m
  }, [filtered, portfolio.stages, portfolio.tasks])
  const coverOf = p => portfolio.covers.find(c => c.id === p.cover_file_id) || null

  const applyLineChanges = useCallback((added = [], removed = []) => {
    const removedIds = new Set(removed.map(l => l.id))
    const touched = new Map()
    for (const l of [...added, ...removed]) {
      const proj = allProjects.find(p => p.id === l.project_id)
      if (proj) touched.set(proj.property_id, true)
    }
    for (const propertyId of touched.keys()) {
      const prop = properties.find(p => p.id === propertyId)
      const next = (prop?.refurb_projects || []).map(p => ({
        ...p,
        refurb_lines: [...(p.refurb_lines || []).filter(l => !removedIds.has(l.id)), ...added.filter(l => l.project_id === p.id)],
      }))
      onPropertyPatch(propertyId, { refurb_projects: next, ...(mirrorFields(next) || {}) })
    }
  }, [allProjects, properties, onPropertyPatch])
  const openInvoice = inv => { setSelectedId(null); setImporting(false); setSub('invoices'); setInvoiceId(inv.id) }
  const openProject = (p, sec = 'overview') => { setSelectedId(p.id); setSection(sec); setStageId(null) }

  const stageOrder = { in_progress: 0, snagging: 1, planned: 2, on_hold: 3, complete: 4 }
  const listed = useMemo(() => [...filtered]
    .sort((a, b) => (stageOrder[a.stage] - stageOrder[b.stage]) || String(a.target_end_date || '9999').localeCompare(String(b.target_end_date || '9999'))), [filtered])

  async function handleCreate(propertyId, fields, template) {
    const created = await createWithJourney(mutations, propertyId, fields, template, showToast)
    if (created) { setCreating(false); openProject(created); showToast?.('Refurb created. Add a cover photo and dates in the workspace.') }
  }
  async function handleDelete(project) {
    if (!await confirmDialog({ title: 'Delete this refurb?', body: 'The refurb, its payments, journey and files move to Trash. The property keeps its other data.', confirmLabel: 'Delete', destructive: true })) return
    const ok = await mutations.deleteProject(project.property_id, project.id)
    if (ok) { setSelectedId(null); showToast?.('Refurb deleted') }
  }
  async function handleStage(projectId, stage) {
    const p = allProjects.find(x => x.id === projectId)
    if (!p || p.stage === stage) return
    const fields = { stage }
    if (stage === 'complete' && !p.completed_date) fields.completed_date = todayISO()
    if (stage !== 'complete' && p.completed_date) fields.completed_date = null
    await mutations.updateProject(p.property_id, projectId, fields)
  }

  const typeToggle = <div role="tablist" aria-label="Project type" style={{ display: 'inline-flex', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
    {PROJECT_TYPES.map(o => <button key={o.value} role="tab" aria-selected={filters.type === o.value} onClick={() => { setFilter('type', o.value); setSelectedId(null) }}
      style={{ fontSize: 13, fontWeight: filters.type === o.value ? 700 : 500, padding: '8px 18px', border: 'none', cursor: 'pointer', background: filters.type === o.value ? T.gold : 'transparent', color: filters.type === o.value ? '#fff' : T.muted }}>{o.label}</button>)}
  </div>

  const pageHead = <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>Refurbs</h1>
        {!selected && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
          {summary.active} active · {summary.overBudget} over budget · {fmt(summary.remaining)} remaining to pay
        </div>}
      </div>
      {typeToggle}
    </div>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', flexWrap: 'wrap' }}>
        {VIEWS.map(([k, l]) => (
          <button key={k} onClick={() => { setSub(k); setSelectedId(null); setInvoiceId(null); setImporting(false) }}
            style={{ fontFamily: mono, fontSize: 11.5, padding: '7px 14px', border: 'none', cursor: 'pointer', background: sub === k && !selectedId ? T.gold : 'transparent', color: sub === k && !selectedId ? '#fff' : T.muted }}>{l}</button>
        ))}
      </div>
      <button onClick={() => { setImporting(true); setSub('invoices'); setSelectedId(null); setInvoiceId(null) }} style={{ ...btn(T), padding: '8px 14px', fontSize: 12 }}>Import refurb invoice</button>
      <button onClick={() => { setCreating(true); setSelectedId(null) }} style={{ ...btn(T, 'gold'), padding: '8px 16px', fontSize: 12 }}>+ New Refurb</button>
    </div>
  </div>

  if (sub === 'invoices' && importing) return <div className="fade">
    {pageHead}
    <ImportRefurbInvoice properties={properties} companies={companies} invoices={invoices} canEditFor={canEditFor} mutations={mutations}
      defaultCompanyId={filters.companyId !== 'all' ? filters.companyId : null} showToast={showToast} T={T} isMobile={isMobile}
      onCancel={() => setImporting(false)}
      onCreated={({ invoice, extras }) => {
        setInvoices(list => [invoice, ...list])
        if (extras.length) applyLineChanges(extras, [])
        setImporting(false); setInvoiceId(invoice.id)
        showToast?.(`${invoice.doc_kind === 'credit_note' ? 'Credit note' : 'Invoice'} saved across ${(invoice.refurb_invoice_allocations || []).length} ${(invoice.refurb_invoice_allocations || []).length === 1 ? 'property' : 'properties'}. Nothing marked paid.`)
      }} />
  </div>

  if (sub === 'invoices' && selectedInvoice) return <div className="fade">
    {pageHead}
    <InvoiceDetail invoice={selectedInvoice} properties={properties} companies={companies} projects={allProjects} lines={allLines}
      canEdit={canEditFor(selectedInvoice.company_id)} showToast={showToast} T={T} isMobile={isMobile}
      onBack={() => setInvoiceId(null)}
      onUpdated={inv => setInvoices(list => list.map(i => i.id === inv.id ? inv : i))}
      onDeleted={(inv, removedExtras) => { setInvoices(list => list.filter(i => i.id !== inv.id)); applyLineChanges([], removedExtras); setInvoiceId(null); showToast?.('Invoice deleted') }}
      onLinesAdded={created => applyLineChanges(created, [])}
      onOpenProject={p => { setInvoiceId(null); openProject(p, 'costs') }} />
  </div>

  if (selectedId && !selected) return <div className="fade">
    {pageHead}
    <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{properties.length ? 'This refurb is not available' : 'Loading…'}</div>
      {properties.length > 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12 }}>It may have been deleted, or it belongs to a company you no longer have access to.</div>}
      <button onClick={() => setSelectedId(null)} style={btn(T)}>← All refurbs</button>
    </div>
  </div>

  if (selected) {
    const canEdit = canEditFor(selected.property?.company_id)
    return <div className="fade">
      {pageHead}
      <RefurbWorkspace key={selected.id} project={selected} property={selected.property} company={selected.property?.company} canEdit={canEdit}
        mutations={mutations} invoices={invoices} allLines={allLines} people={people} templates={templates}
        section={section} stageId={stageId}
        onSection={s => { setSection(s); setStageId(null) }}
        onOpenStage={id => { setStageId(id); if (id && section === 'overview') setSection('journey') }}
        onBack={() => setSelectedId(null)} onDelete={() => handleDelete(selected)}
        onOpenProperty={openDetail ? () => openDetail(selected.property, 'refurb') : null}
        onOpenDeal={selected.deal_id ? () => { window.location.hash = `#/deals/deal/${selected.deal_id}` } : null}
        coverUrl={coverOf(selected) ? coverUrls.get(coverOf(selected).file_path) : null}
        onJourneyChange={onJourneyChange} showToast={showToast} T={T} isMobile={isMobile}
        renderCosts={() => <ProjectDetail project={selected} property={selected.property} company={selected.property?.company} canEdit={canEdit} payees={payees}
          mutations={mutations} onDelete={() => handleDelete(selected)} embedded costsOnly
          invoices={invoices} allLines={allLines} onOpenInvoice={openInvoice} T={T} isMobile={isMobile} />} />
    </div>
  }

  const stat = (label, value, color) => <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
    <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted, marginBottom: 4 }}>{label}</div>
    <div style={{ fontFamily: mono, fontSize: 19, fontWeight: 700, color: color || T.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
  const fsel = { ...inputStyle(T), width: 'auto', minWidth: 120 }
  const activeFilters = ['q', 'contractor', 'manager', 'from', 'to'].some(k => filters[k] && filters[k] !== 'all') || filters.companyId !== 'all' || filters.status !== 'active'

  return <div className="fade">
    {pageHead}

    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
      {stat('Active refurbs', summary.active)}
      {stat('Agreed total', fmt(summary.agreed))}
      {stat('Paid so far', fmt(summary.paid), T.green)}
      {stat('Remaining to pay', fmt(summary.remaining), T.gold)}
      {stat('Over budget', summary.overBudget, summary.overBudget > 0 ? T.red : T.muted)}
      {stat('Invoices unpaid', fmt(invoicesUnpaid), invoicesUnpaid > 0 ? T.blue : T.muted)}
    </div>

    {/* Search and filters */}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <input value={filters.q} onChange={e => setFilter('q', e.target.value)} placeholder="Search address, contractor, PM…" aria-label="Search refurbs" style={{ ...inputStyle(T), width: isMobile ? '100%' : 240 }} />
      {companies.length > 1 && <select value={filters.companyId} onChange={e => setFilter('companyId', e.target.value)} style={fsel} aria-label="Company">
        <option value="all">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.abbr || c.name}</option>)}
      </select>}
      <select value={filters.status} onChange={e => setFilter('status', e.target.value)} style={fsel} aria-label="Status">
        <option value="active">Active</option><option value="all">All statuses</option>
        {STAGES.map(s => <option key={s} value={s}>{STAGE_CFG[s].label}</option>)}
      </select>
      <select value={filters.contractor} onChange={e => setFilter('contractor', e.target.value)} style={fsel} aria-label="Contractor">
        <option value="all">All contractors</option>{contractors.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={filters.manager} onChange={e => setFilter('manager', e.target.value)} style={fsel} aria-label="Project manager">
        <option value="all">All project managers</option>{managers.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'inline-flex', gap: 4, alignItems: 'center' }}>Finish from
        <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} style={{ ...inputStyle(T), width: 'auto' }} /></label>
      <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'inline-flex', gap: 4, alignItems: 'center' }}>to
        <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} style={{ ...inputStyle(T), width: 'auto' }} /></label>
      <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.archived} onChange={e => setFilter('archived', e.target.checked)} style={{ width: 'auto', margin: 0 }} /> Archived only
      </label>
      {activeFilters && <button onClick={() => setFilters(f => ({ ...f, q: '', companyId: 'all', status: 'active', contractor: 'all', manager: 'all', from: '', to: '' }))} style={btn(T)}>Clear filters</button>}
    </div>

    {creating && <NewRefurbForm properties={properties.filter(p => canEditFor(p.company_id))} companies={companies} defaultType={filters.type} templates={templates} people={people}
      onCreate={handleCreate} onCancel={() => setCreating(false)} T={T} />}
    <datalist id="refurb-payees">{payees.map(p => <option key={p} value={p} />)}</datalist>

    {(sub === 'cards' || sub === 'list') && listed.length === 0 && !creating && <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{filters.archived ? 'Nothing archived' : activeFilters ? 'No refurbs match these filters' : `No ${filters.type} refurbs on the go`}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 14 }}>{activeFilters ? 'Clear the filters to see everything.' : 'Start one with the property and, if you have it, the price agreed with the builder.'}</div>
      {!filters.archived && <button onClick={() => setCreating(true)} style={btn(T, 'gold')}>+ New Refurb</button>}
    </div>}

    {sub === 'cards' && listed.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
      {listed.map(p => <ProjectCard key={p.id} project={p} journey={journeys.get(p.id)} cover={coverOf(p)} coverUrl={coverOf(p) ? coverUrls.get(coverOf(p).file_path) : null}
        invoiced={invoicedMap.get(p.id) || 0} onOpen={() => openProject(p)} T={T} />)}
    </div>}

    {sub === 'list' && <div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 10 }}>List view · {listed.length} {listed.length === 1 ? 'refurb' : 'refurbs'}</div>
      {listed.map(p => <div key={p.id}>
        <ProjectRow project={p} journey={journeys.get(p.id)} canEdit={canEditFor(p.property?.company_id)} onOpen={() => openProject(p)} onQuickPay={() => setQuickPayFor(quickPayFor === p.id ? null : p.id)} T={T} isMobile={isMobile} />
        {quickPayFor === p.id && <InlineQuickPay project={p} mutations={mutations} onDone={() => setQuickPayFor(null)} T={T} isMobile={isMobile} />}
      </div>)}
    </div>}

    {sub === 'board' && <Board projects={filterProjects(allProjects, { ...filters, status: 'all' })} canEdit={allProjects.every(p => canEditFor(p.property?.company_id))} onOpen={p => openProject(p)} onStage={handleStage} T={T} />}

    {sub === 'payments' && <Ledger projects={filterProjects(allProjects, { ...filters, status: 'all' })} onOpen={p => openProject(p, 'costs')} T={T} isMobile={isMobile} />}

    {sub === 'invoices' && <InvoiceList invoices={coInvoices} companies={companies} lines={allLines} onOpen={openInvoice}
      canImport={companies.some(c => canEditFor(c.id))} onImport={() => setImporting(true)} T={T} isMobile={isMobile} />}
  </div>
}

// Create a refurb and, when a template is chosen, seed its journey. The
// project is saved first; a failed journey seed leaves a project with no
// stages, which the workspace offers to start again.
async function createWithJourney(mutations, propertyId, fields, template, showToast) {
  const created = await mutations.createProject(propertyId, fields, { seedMilestones: !template })
  if (!created || !template || !(template.stages || []).length) return created
  try {
    await api.applyRefurbTemplate(created.id, template)
    const updated = await mutations.updateProject(propertyId, created.id, { template_name: template.name })
    return updated || created
  } catch (e) {
    console.error(e)
    showToast?.('Refurb saved, but its journey could not be created. Start it from the Journey tab.', 'error')
    return created
  }
}

// Row-level quick payment without opening the refurb.
function InlineQuickPay({ project, mutations, onDone, T, isMobile }) {
  const [quick, setQuick] = useState({ kind: 'payment', amount: '', date: todayISO(), payee: project.contractor_name || '', description: '' })
  async function add() {
    const amount = Number(quick.amount)
    if (!amount) return
    const created = await mutations.addLine(project.property_id, project.id, { kind: quick.kind, amount, date: quick.date || todayISO(), payee: quick.payee.trim() || null, description: quick.description.trim() || null })
    if (!created) return
    if (project.stage === 'planned') mutations.updateProject(project.property_id, project.id, { stage: 'in_progress' })
    onDone()
  }
  return <div style={{ margin: '-4px 0 12px 22px' }}>
    <QuickAdd quick={quick} setQuick={setQuick} onAdd={add} onCancel={onDone} T={T} isMobile={isMobile} allowCredit />
  </div>
}

// ── Property detail tab ────────────────────────────────────────────────────
// Same components, scoped to one property. Shown on the property page's
// Refurb tab; the full page is one click away via openRefurbs.
export function RefurbPropertyTab({ property, companies = [], properties = [], permissionsMap, devModeActive = false, showToast, onPropertyPatch, openRefurbs }) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const confirmDialog = useConfirm()
  const canEdit = useCanEdit(permissionsMap, devModeActive)(property.company_id)
  const mutations = useRefurbMutations({ properties, onPropertyPatch, showToast })
  const projects = (property.refurb_projects || []).filter(p => !p.deleted_at)
  const active = projects.filter(isActiveProject)
  const [selectedId, setSelectedId] = useState(active[0]?.id || projects[0]?.id || null)
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (selectedId && !projects.find(p => p.id === selectedId)) setSelectedId(active[0]?.id || projects[0]?.id || null) }, [projects.length])
  const selected = projects.find(p => p.id === selectedId) || null
  const payees = useMemo(() => knownPayees(projectsFromProperties(properties)), [properties])
  const { invoices } = useRefurbInvoices(showToast)
  const allLines = useMemo(() => allLinesOf(projectsFromProperties(properties)), [properties])
  const openInvoice = inv => { window.location.hash = `#/refurbs/invoice/${inv.id}`; openRefurbs?.() }

  async function handleCreate(_pid, fields, template) {
    const created = await createWithJourney(mutations, property.id, fields, template, showToast)
    if (created) { setCreating(false); setSelectedId(created.id); showToast?.('Refurb created') }
  }
  async function handleDelete(project) {
    if (!await confirmDialog({ title: 'Delete this refurb?', body: 'The refurb and its payments move to Trash.', confirmLabel: 'Delete', destructive: true })) return
    const ok = await mutations.deleteProject(property.id, project.id)
    if (ok) showToast?.('Refurb deleted')
  }

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {projects.length > 1 && projects.map(p => {
          const t = projectTotals(p)
          return <button key={p.id} onClick={() => setSelectedId(p.id)}
            style={{ fontFamily: mono, fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${selectedId === p.id ? T.gold : T.border}`, background: selectedId === p.id ? T.gold + '22' : 'transparent', color: selectedId === p.id ? T.gold : T.muted }}>
            {STAGE_CFG[p.stage]?.label} · {fmt(t.agreed)}
          </button>
        })}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {openRefurbs && selected && <button onClick={() => { window.location.hash = `#/refurbs/project/${selected.id}/overview`; openRefurbs() }} style={btn(T, 'gold')}>Open workspace →</button>}
        {openRefurbs && <button onClick={openRefurbs} style={btn(T)}>All refurbs →</button>}
        {canEdit && <button onClick={() => setCreating(v => !v)} style={btn(T, 'gold')}>+ New refurb</button>}
      </div>
    </div>
    {creating && <NewRefurbForm properties={[property]} companies={companies} fixedPropertyId={property.id} onCreate={handleCreate} onCancel={() => setCreating(false)} T={T} />}
    {!selected && !creating && <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No refurb on this property</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
        {Number(property.refurb_cost) > 0 ? `${fmt(property.refurb_cost)} of historic refurb spend is recorded on the property. ` : ''}
        {canEdit ? 'Start a refurb with the agreed price, then log payments against it.' : ''}
      </div>
    </div>}
    {selected && <ProjectDetail project={selected} property={property} company={property.company} canEdit={canEdit} payees={payees}
      mutations={mutations} onDelete={() => handleDelete(selected)} embedded
      invoices={invoices} allLines={allLines} onOpenInvoice={openInvoice} T={T} isMobile={isMobile} />}
  </div>
}
