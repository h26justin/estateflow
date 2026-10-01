// Refurb project workspace (brief part 3): a large cover photograph, the
// essential project details beside it, and working sections. The Overview
// pulls from the other sections; nothing is entered twice.
//
// Data: the project row comes from App state (properties -> refurb_projects)
// and is written through the existing refurb mutations so the property
// mirror, Deals cashflow and dashboard stay in step. Everything else
// (stages, deps, tasks, updates, history, files) is loaded here per
// project and patched locally after each write. Each write that matters is
// logged to refurb_events with old and new values.
//
// URL: #/refurbs/project/<id>/<section>[/<stageId>]
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import * as api from '../../lib/api'
import { useConfirm } from '../../lib/ConfirmContext'
import { resizeImage } from '../../lib/imageResize'
import { PROPERTY_STATUS_LABELS } from '../../lib/propertyStatus'
import { projectTotals, STAGES, STAGE_CFG } from '../../lib/refurbs'
import { invoicedByProject } from '../../lib/refurbInvoices'
import {
  cascadeDates, programmeEnd, worksProgress, currentStage, stageDelay, flatStages, isTaskOverdue,
  forecastFinalCost, PROJECT_TYPES, isoDate,
} from '../../lib/refurbWorkspace'
import CoverPhoto from './CoverPhoto'
import JourneyTab, { JourneyStrip, CascadeModal, ProgressExplainer } from './JourneyTab'
import StageDrawer, { TaskList, Updates, HistoryRow, ContractorSelect } from './StageDrawer'
import Gantt from './Gantt'
import { Icon } from '../../lib/icons'
import MoneyInput from '../../lib/MoneyInput'
import { mono, fmt, fmtDate, btn, inputStyle, panel, sectionHead, Field, Pill, Bar, Tile, todayISO } from './ui'

export const WORKSPACE_TABS = [
  ['overview', 'Overview'],
  ['journey', 'Journey & Timeline'],
  ['costs', 'Costs'],
  ['history', 'History'],
]

const DATE_KEYS = ['planned_start', 'planned_end', 'forecast_start', 'forecast_end', 'actual_start', 'actual_end']
const EMPTY = { stages: [], deps: [], tasks: [], updates: [], events: [], files: [] }

// ── Data + operations ─────────────────────────────────────────────────────
function useWorkspace({ project, property, mutations, showToast, onJourneyChange }) {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actor, setActor] = useState(null)
  const [pending, setPending] = useState(null) // cascade awaiting confirmation
  const dataRef = useRef(data)
  dataRef.current = data
  const projRef = useRef(project)
  projRef.current = project
  const confirm = useConfirm()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [d, a] = await Promise.all([api.fetchRefurbWorkspace(project.id), api.currentRefurbActor()])
      setData(d); setActor(a)
    } catch (e) { console.error(e); setError(e.message || 'Could not load this refurb') }
    setLoading(false)
  }, [project.id])
  useEffect(() => { load() }, [load])

  // Tell the page (cards, filters) whenever stages / tasks / cover change.
  useEffect(() => {
    if (loading) return
    onJourneyChange?.(project.id, { stages: data.stages, tasks: data.tasks, cover: data.files.find(f => f.id === project.cover_file_id) || null })
  }, [data.stages, data.tasks, data.files, project.cover_file_id, loading])

  const patch = fn => setData(d => ({ ...d, ...fn(d) }))
  const fail = e => { console.error(e); showToast?.(e.message || 'Something went wrong', 'error'); return null }
  const log = async evs => {
    const saved = await api.logRefurbEvents(project.id, evs)
    if (saved.length) patch(d => ({ events: [...saved, ...d.events] }))
  }

  function diffEvents(entity, before, fields, extra = {}) {
    return Object.keys(fields).filter(k => k !== 'updated_at').filter(k => String(before?.[k] ?? '') !== String(fields[k] ?? ''))
      .map(k => ({ entity, entity_id: before?.id, action: 'updated', field: k, old_value: before?.[k], new_value: fields[k] == null ? null : typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k], ...extra }))
  }

  // Programme check after any date / dependency change.
  function checkCascade(stages, deps) {
    const moves = cascadeDates(stages, deps)
    const after = moves.length ? stages.map(s => { const m = moves.find(x => x.stage_id === s.id); return m ? { ...s, forecast_start: m.to_start, forecast_end: m.to_end } : s }) : stages
    const newEnd = programmeEnd(after)
    const projectEnd = isoDate(projRef.current.target_end_date)
    if (moves.length || (newEnd && projectEnd && newEnd > projectEnd)) setPending({ moves, newEnd, projectEnd })
  }

  const ops = {
    reload: load,

    async updateProject(fields, { reason } = {}) {
      const before = projRef.current
      const updated = await mutations.updateProject(property.id, before.id, fields)
      if (!updated) return false
      const evs = diffEvents('project', before, fields, { reason })
      if (evs.length) await log(evs)
      return true
    },

    async addStage({ name, parent_id = null }) {
      try {
        const siblings = dataRef.current.stages.filter(s => (s.parent_id || null) === parent_id && !s.deleted_at)
        const sort_order = siblings.reduce((m, s) => Math.max(m, s.sort_order || 0), 0) + 1
        const created = await api.createRefurbStage(project.id, { name, parent_id, sort_order })
        patch(d => ({ stages: [...d.stages, created] }))
        await log({ entity: 'stage', entity_id: created.id, stage_id: created.id, action: 'created', new_value: name })
        return created
      } catch (e) { return fail(e) }
    },

    async updateStage(stage, fields, { reason, action } = {}) {
      try {
        const saved = await api.updateRefurbStage(stage.id, fields)
        const stages = dataRef.current.stages.map(s => s.id === stage.id ? saved : s)
        patch(() => ({ stages }))
        const evs = action
          ? [{ entity: 'stage', entity_id: stage.id, stage_id: stage.id, action, reason, new_value: fields.signed_off_by || null }]
          : diffEvents('stage', stage, fields, { stage_id: stage.id, reason })
        if (evs.length) await log(evs)
        if (Object.keys(fields).some(k => DATE_KEYS.includes(k)) || fields.status === 'skipped') checkCascade(stages, dataRef.current.deps)
        return saved
      } catch (e) { return fail(e) }
    },

    async applyCascade(reason) {
      const p = pending
      if (!p) return
      try {
        const saved = await api.updateRefurbStages(p.moves.map(m => ({ id: m.stage_id, fields: { forecast_start: m.to_start, forecast_end: m.to_end } })))
        patch(d => ({ stages: d.stages.map(s => saved.find(x => x.id === s.id) || s) }))
        await log(p.moves.flatMap(m => [
          { entity: 'stage', entity_id: m.stage_id, stage_id: m.stage_id, action: 'dates_cascaded', field: 'forecast_end', old_value: m.from_end, new_value: m.to_end, reason: `Waits for ${m.because}` },
        ]))
        if (p.newEnd && p.projectEnd && p.newEnd > p.projectEnd) await ops.updateProject({ target_end_date: p.newEnd }, { reason })
        setPending(null)
      } catch (e) { fail(e) }
    },
    dismissCascade() { setPending(null) },

    async reorder(siblings, i, j) {
      const list = [...siblings]
      const [m] = list.splice(i, 1)
      list.splice(j, 0, m)
      try {
        const changes = list.map((s, idx) => ({ id: s.id, fields: { sort_order: idx + 1 } })).filter((c, idx) => list[idx].sort_order !== idx + 1)
        const saved = await api.updateRefurbStages(changes)
        patch(d => ({ stages: d.stages.map(s => saved.find(x => x.id === s.id) || s) }))
        await log({ entity: 'stage', entity_id: m.id, stage_id: m.id, action: 'reordered', field: 'sort_order', old_value: i + 1, new_value: j + 1 })
      } catch (e) { fail(e) }
    },

    async archiveStage(stage) {
      try {
        const saved = await api.updateRefurbStage(stage.id, { archived_at: new Date().toISOString() })
        patch(d => ({ stages: d.stages.map(s => s.id === stage.id ? saved : s) }))
        await log({ entity: 'stage', entity_id: stage.id, stage_id: stage.id, action: 'archived', old_value: stage.name })
      } catch (e) { fail(e) }
    },
    async restoreStage(stage) {
      try {
        const saved = await api.updateRefurbStage(stage.id, { archived_at: null })
        patch(d => ({ stages: d.stages.map(s => s.id === stage.id ? saved : s) }))
        await log({ entity: 'stage', entity_id: stage.id, stage_id: stage.id, action: 'restored', new_value: stage.name })
      } catch (e) { fail(e) }
    },

    async applyTemplate(tpl) {
      try {
        const rows = await api.applyRefurbTemplate(project.id, tpl)
        patch(d => ({ stages: [...d.stages, ...rows] }))
        await mutations.updateProject(property.id, project.id, { template_name: tpl.name })
        await log({ entity: 'project', action: 'template_applied', new_value: tpl.name })
      } catch (e) { fail(e) }
    },
    async saveTemplate(name, stages) {
      try {
        const t = await api.createRefurbTemplate({ company_id: project.company_id, name, project_type: project.project_type || 'residential', stages })
        showToast?.(`Template "${t.name}" saved`)
        return t
      } catch (e) { return fail(e) }
    },

    async addDependency(stage, dependsOnId) {
      try {
        const dep = await api.createRefurbDependency(project.id, stage.id, dependsOnId, 0)
        const deps = [...dataRef.current.deps, dep]
        patch(() => ({ deps }))
        const other = dataRef.current.stages.find(s => s.id === dependsOnId)
        await log({ entity: 'dependency', entity_id: dep.id, stage_id: stage.id, action: 'created', new_value: `waits for ${other?.name || 'stage'}` })
        checkCascade(dataRef.current.stages, deps)
      } catch (e) { fail(e) }
    },
    async updateDependency(dep, lag) {
      try {
        const saved = await api.updateRefurbDependency(dep.id, { lag_days: lag })
        const deps = dataRef.current.deps.map(d => d.id === dep.id ? saved : d)
        patch(() => ({ deps }))
        await log({ entity: 'dependency', entity_id: dep.id, stage_id: dep.stage_id, action: 'updated', field: 'lag_days', old_value: dep.lag_days, new_value: lag })
        checkCascade(dataRef.current.stages, deps)
      } catch (e) { fail(e) }
    },
    async removeDependency(dep) {
      try {
        await api.deleteRefurbDependency(dep.id)
        patch(d => ({ deps: d.deps.filter(x => x.id !== dep.id) }))
        const other = dataRef.current.stages.find(s => s.id === dep.depends_on_id)
        await log({ entity: 'dependency', entity_id: dep.id, stage_id: dep.stage_id, action: 'removed', old_value: `waits for ${other?.name || 'stage'}` })
      } catch (e) { fail(e) }
    },

    async addTask(fields) {
      try {
        const sort_order = dataRef.current.tasks.length + 1
        const t = await api.createRefurbTask(project.id, { ...fields, sort_order })
        patch(d => ({ tasks: [...d.tasks, t] }))
        await log({ entity: t.kind, entity_id: t.id, stage_id: t.stage_id, action: 'created', new_value: t.title })
        return t
      } catch (e) { return fail(e) }
    },
    async toggleTask(t) {
      const done = t.status !== 'done'
      try {
        const saved = await api.updateRefurbTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null, completed_by: done ? actor?.name || null : null })
        patch(d => ({ tasks: d.tasks.map(x => x.id === t.id ? saved : x) }))
        await log({ entity: t.kind, entity_id: t.id, stage_id: t.stage_id, action: 'updated', field: 'status', old_value: t.status, new_value: saved.status })
      } catch (e) { fail(e) }
    },
    async removeTask(t) {
      if (!await confirm({ title: `Delete "${t.title}"?`, body: 'It goes to Trash and the removal is kept in history.', confirmLabel: 'Delete', destructive: true })) return
      try {
        await api.deleteRefurbTask(t.id)
        patch(d => ({ tasks: d.tasks.filter(x => x.id !== t.id) }))
        await log({ entity: t.kind, entity_id: t.id, stage_id: t.stage_id, action: 'removed', old_value: t.title })
      } catch (e) { fail(e) }
    },

    async addUpdate(fields) {
      try {
        const u = await api.createRefurbUpdate(project.id, fields)
        patch(d => ({ updates: [u, ...d.updates].sort((a, b) => String(b.update_date).localeCompare(String(a.update_date))) }))
        return u
      } catch (e) { return fail(e) }
    },
    async removeUpdate(u) {
      if (!await confirm({ title: 'Delete this update?', body: 'It goes to Trash.', confirmLabel: 'Delete', destructive: true })) return
      try {
        await api.deleteRefurbUpdate(u.id)
        patch(d => ({ updates: d.updates.filter(x => x.id !== u.id) }))
        await log({ entity: 'update', entity_id: u.id, stage_id: u.stage_id, action: 'removed', old_value: u.body.slice(0, 80) })
      } catch (e) { fail(e) }
    },

    async addContractor(companyId) {
      const name = await confirm({ title: 'Add a contractor', body: 'Saved to the company contractor list so it can be picked on any refurb.', prompt: true, placeholder: 'Contractor name', confirmLabel: 'Add' })
      if (!name || !name.trim()) return null
      try { return await ws_addContractor(name.trim(), companyId) } catch (e) { return fail(e) }
    },

    async uploadCover(file) {
      try {
        const { file: small, width, height } = await resizeImage(file)
        const row = await api.uploadRefurbFile(project.id, small, { kind: 'cover', width, height, title: 'Cover photo', captured_at: todayISO() })
        const old = dataRef.current.files.find(f => f.id === projRef.current.cover_file_id)
        const ok = await mutations.updateProject(property.id, project.id, { cover_file_id: row.id })
        if (!ok) return null
        if (old) { try { await api.deleteRefurbFile(old.id) } catch (_) { /* old cover stays, harmless */ } }
        patch(d => ({ files: [row, ...d.files.filter(f => f.id !== old?.id)] }))
        await log({ entity: 'cover', entity_id: row.id, action: old ? 'replaced' : 'created', new_value: file.name })
        return row
      } catch (e) { fail(e); throw e }
    },
    async saveCrop(crop) {
      const cover = dataRef.current.files.find(f => f.id === projRef.current.cover_file_id)
      if (!cover) return
      try {
        const saved = await api.updateRefurbFile(cover.id, { crop })
        patch(d => ({ files: d.files.map(f => f.id === cover.id ? saved : f) }))
      } catch (e) { fail(e) }
    },
  }

  const [contractors, setContractors] = useState([])
  useEffect(() => { api.fetchContractors().then(setContractors).catch(() => setContractors([])) }, [])
  async function ws_addContractor(name, companyId) {
    const c = await api.createContractor({ name, company_id: companyId })
    setContractors(list => [...list, c].sort((a, b) => a.name.localeCompare(b.name)))
    return c
  }

  return { data, loading, error, actor, ops, pending, contractors }
}

// ── Workspace ─────────────────────────────────────────────────────────────
export default function RefurbWorkspace({
  project, property, company, canEdit, mutations, invoices = [], allLines = [], people = [], templates = [],
  section = 'overview', stageId = null, onSection, onOpenStage, onBack, onDelete, onOpenProperty, onOpenDeal,
  renderCosts, showToast, onJourneyChange, coverUrl, T, isMobile,
}) {
  const confirm = useConfirm()
  const { data, loading, error, actor, ops, pending, contractors } = useWorkspace({ project, property, mutations, showToast, onJourneyChange })
  const [signed, setSigned] = useState({})
  const cover = data.files.find(f => f.id === project.cover_file_id) || null

  // Sign the cover (page may already have one from the card).
  useEffect(() => {
    if (!cover?.file_path || signed[cover.file_path]) return
    api.signRefurbPaths([cover.file_path]).then(m => setSigned(s => ({ ...s, ...Object.fromEntries(m) }))).catch(() => {})
  }, [cover?.file_path])
  const coverSrc = (cover && signed[cover.file_path]) || (cover ? coverUrl : null)

  const t = projectTotals(project)
  const invoiced = useMemo(() => invoicedByProject(invoices).get(project.id) || 0, [invoices, project.id])
  const ffc = forecastFinalCost({ agreed: t.agreed, invoiced, committed: 0, override: project.forecast_cost_override })
  const wp = worksProgress(data.stages, data.tasks)
  const cur = currentStage(data.stages)
  const stageName = id => data.stages.find(s => s.id === id)?.name || ''
  const ws = {
    data, ops, project, property, canEdit, contractors, people: [...new Set([actor?.name, ...people].filter(Boolean))],
    templates, T, isMobile, actor, stageName, propertyName: property?.name || property?.address || 'Refurb',
    openStage: id => onOpenStage(id),
  }

  async function changeForecastCompletion(v) {
    const prev = isoDate(project.target_end_date)
    const next = v || null
    if (prev === next) return
    let reason = null
    if (prev) {
      reason = await confirm({ title: 'Change the forecast completion?', body: `From ${fmtDate(prev)} to ${next ? fmtDate(next) : 'no date'}. The original planned completion stays as it is. Why has it changed?`, prompt: true, placeholder: 'Reason (required)', confirmLabel: 'Save new date' })
      if (!reason || !reason.trim()) return false
    }
    const fields = { target_end_date: next }
    if (!project.original_end_date && next) fields.original_end_date = next
    return ops.updateProject(fields, { reason })
  }
  async function changeOriginal(v) {
    const prev = isoDate(project.original_end_date)
    if (prev === (v || null)) return
    let reason = null
    if (prev) {
      reason = await confirm({ title: 'Change the original planned completion?', body: 'This is the baseline the project is measured against. The change is recorded in history.', prompt: true, placeholder: 'Reason (required)', confirmLabel: 'Change baseline' })
      if (!reason || !reason.trim()) return false
    }
    return ops.updateProject({ original_end_date: v || null }, { reason })
  }
  async function changeOverall(stage) {
    if (stage === project.stage) return
    const fields = { stage }
    if (stage === 'complete' && !project.completed_date) fields.completed_date = todayISO()
    if (stage !== 'complete' && project.completed_date) fields.completed_date = null
    await ops.updateProject(fields)
  }
  async function toggleArchive() {
    if (project.archived_at) { await ops.updateProject({ archived_at: null }); showToast?.('Refurb restored from the archive'); return }
    const ok = await confirm({ title: 'Archive this refurb?', body: 'It leaves the active views and moves to Archived. Nothing is deleted and it can be restored at any time.', confirmLabel: 'Archive' })
    if (ok && await ops.updateProject({ archived_at: new Date().toISOString() })) showToast?.('Refurb archived')
  }

  const slipDays = project.original_end_date && project.target_end_date ? Math.round((new Date(project.target_end_date) - new Date(project.original_end_date)) / 86400000) : 0
  const occupancy = PROPERTY_STATUS_LABELS[property?.status] || property?.status || 'Unknown'

  // ── Hero ──
  const hero = <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 0, background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
    <CoverPhoto file={cover} url={coverSrc} canEdit={canEdit} T={T} height={isMobile ? 220 : 340} aspect={isMobile ? 16 / 9 : 1.3}
      alt={ws.propertyName} onUpload={ops.uploadCover} onCropSave={ops.saveCrop} />
    <div style={{ padding: isMobile ? 14 : '18px 22px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Pill color={T.blue} T={T}>{project.project_type === 'commercial' ? 'Commercial' : 'Residential'}</Pill>
            {project.archived_at && <Pill color={T.muted} T={T}>Archived</Pill>}
          </div>
          <h2 style={{ margin: 0, fontSize: isMobile ? 21 : 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{project.title && project.title !== 'Refurbishment' ? project.title : `${ws.propertyName} refurb`}</h2>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 4 }}>{company?.name || company?.abbr || 'No company'} · {property?.prop_type || 'Property type not set'}</div>
        </div>
        <select value={project.stage} disabled={!canEdit} onChange={e => changeOverall(e.target.value)} aria-label="Overall status"
          style={{ ...inputStyle(T), width: 'auto', fontWeight: 700, color: STAGE_CFG[project.stage]?.color }}>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_CFG[s].label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {onOpenProperty && <button onClick={onOpenProperty} style={btn(T)}>Property record ↗</button>}
        {project.deal_id && onOpenDeal && <button onClick={onOpenDeal} style={btn(T)}>Linked deal ↗</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginTop: 12, fontSize: 12.5 }}>
        <Detail label="Address" value={property?.address || '—'} T={T} wide />
        <Detail label="Occupancy" value={occupancy} T={T} />
        <Detail label="Acquired" value={property?.purchase_date ? fmtDate(property.purchase_date) : 'Not recorded'} T={T} />
        <Detail label="Project manager" value={project.project_manager_name || 'Not assigned'} T={T} />
        <Detail label="Main contractor" value={project.contractor_name || 'Not assigned'} T={T} />
        <Detail label="Current stage" value={cur ? cur.name : wp.hasJourney ? 'All stages complete' : 'No journey yet'} T={T} onClick={() => onSection('journey')} />
        <div>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Works progress</div>
          {wp.hasJourney ? <><div style={{ fontWeight: 700 }}>{wp.pct}%</div><Bar pct={wp.pct} T={T} height={5} /></> : <div style={{ color: T.faint }}>No journey yet</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
        <DateCell label="Original planned" value={project.original_end_date} editable={canEdit} onSave={changeOriginal} T={T} />
        <DateCell label="Forecast completion" value={project.target_end_date} editable={canEdit} onSave={changeForecastCompletion} T={T}
          note={slipDays > 0 ? `${slipDays} days later than planned` : slipDays < 0 ? `${-slipDays} days early` : null} warn={slipDays > 0} />
        <DateCell label="Actual completion" value={project.completed_date} editable={canEdit && project.stage === 'complete'} onSave={v => ops.updateProject({ completed_date: v || null })} T={T}
          note={project.stage !== 'complete' ? 'Set when complete' : null} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
        <Detail label="Budget (agreed)" value={fmt(t.agreed)} T={T} onClick={() => onSection('costs')} />
        <Detail label={ffc.overridden ? 'Forecast final cost (set)' : 'Forecast final cost'} value={fmt(ffc.value)} T={T} onClick={() => onSection('costs')} color={ffc.variance > 0 ? T.red : undefined} />
        <Detail label="Next action" value={project.next_action || 'None set'} T={T} onClick={() => onSection('overview')} />
      </div>
    </div>
  </div>

  const tabs = <div role="tablist" style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${T.border}`, marginBottom: 14, overflowX: 'auto' }}>
    {WORKSPACE_TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={section === k} onClick={() => onSection(k)}
      style={{ fontSize: 13.5, fontWeight: section === k ? 700 : 500, padding: '10px 14px', background: 'none', border: 'none', borderBottom: `2.5px solid ${section === k ? T.gold : 'transparent'}`, color: section === k ? T.text : T.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}>{l}</button>)}
  </div>

  return <div className="fade">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <button onClick={onBack} style={btn(T)}>← All refurbs</button>
      {canEdit && <div style={{ display: 'flex', gap: 6 }}>
        {(project.stage === 'complete' || project.archived_at) && <button onClick={toggleArchive} style={btn(T)}>{project.archived_at ? 'Restore from archive' : 'Archive'}</button>}
        <button onClick={onDelete} style={btn(T, 'danger')}>Delete</button>
      </div>}
    </div>
    {hero}
    {tabs}
    {error && <div role="alert" style={{ ...panel(T), borderColor: T.red, color: T.red, fontFamily: mono, fontSize: 12 }}>{error} <button onClick={ops.reload} style={btn(T)}>Try again</button></div>}
    {loading && !error && <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: 20 }}>Loading the workspace…</div>}
    {!loading && !error && <>
      {section === 'overview' && <Overview ws={ws} wp={wp} cur={cur} t={t} ffc={ffc} invoiced={invoiced} onSection={onSection} />}
      {section === 'journey' && <JourneyTab ws={ws} />}
      {section === 'costs' && <CostsTab ws={ws} t={t} ffc={ffc} invoiced={invoiced}>{renderCosts?.()}</CostsTab>}
      {section === 'history' && <HistoryTab ws={ws} />}
    </>}
    {stageId && !loading && data.stages.some(s => s.id === stageId) && <StageDrawer ws={ws} stageId={stageId} onClose={() => onOpenStage(null)} />}
    {pending && <CascadeModal moves={pending.moves} projectEnd={pending.projectEnd} newEnd={pending.newEnd} T={T}
      onApply={ops.applyCascade} onSkip={ops.dismissCascade} />}
  </div>
}

function Detail({ label, value, T, wide, onClick, color }) {
  const inner = <>
    <div style={{ fontFamily: mono, fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
    <div style={{ fontWeight: 600, color: color || T.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
  </>
  if (onClick) return <button onClick={onClick} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.text, gridColumn: wide ? '1 / -1' : undefined, minWidth: 0, fontSize: 'inherit' }}>{inner}</button>
  return <div style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>{inner}</div>
}

function DateCell({ label, value, editable, onSave, note, warn, T }) {
  const [v, setV] = useState(isoDate(value) || '')
  useEffect(() => { setV(isoDate(value) || '') }, [value])
  return <div style={{ minWidth: 0 }}>
    <div style={{ fontFamily: mono, fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
    {editable
      ? <input type="date" value={v} aria-label={label} onChange={e => setV(e.target.value)}
          onBlur={async () => { const r = await onSave(v); if (r === false) setV(isoDate(value) || '') }} style={{ ...inputStyle(T), padding: '4px 6px', marginTop: 2 }} />
      : <div style={{ fontWeight: 600 }}>{value ? fmtDate(value) : '—'}</div>}
    {note && <div style={{ fontFamily: mono, fontSize: 9.5, color: warn ? T.red : T.faint, marginTop: 2 }}>{note}</div>}
  </div>
}

// ── Overview ──────────────────────────────────────────────────────────────
function Overview({ ws, wp, cur, t, ffc, invoiced, onSection }) {
  const { data, ops, project, canEdit, T, isMobile, stageName } = ws
  const overdue = data.tasks.filter(x => isTaskOverdue(x))
  const blocked = flatStages(data.stages).filter(s => s.status === 'blocked')
  const delayed = flatStages(data.stages).filter(s => { const d = stageDelay(s); return d.overdue || d.slippedDays > 0 })
  const [na, setNa] = useState({ text: project.next_action || '', due: project.next_action_due || '' })
  useEffect(() => { setNa({ text: project.next_action || '', due: project.next_action_due || '' }) }, [project.next_action, project.next_action_due])
  const attention = [
    ...overdue.map(x => ({ key: 'task' + x.id, color: T.red, text: `Overdue: ${x.title}`, sub: `${x.owner_name || 'No owner'} · due ${fmtDate(x.due_date)}${x.stage_id ? ` · ${stageName(x.stage_id)}` : ''}`, onClick: x.stage_id ? () => ws.openStage(x.stage_id) : null })),
    ...blocked.map(s => ({ key: 'blk' + s.id, color: T.red, text: `Blocked: ${s.name}`, sub: s.blockers || 'No blocker described', onClick: () => ws.openStage(s.id) })),
    ...delayed.filter(s => s.status !== 'blocked').map(s => { const d = stageDelay(s); return { key: 'dly' + s.id, color: T.amber, text: `${d.overdue ? 'Overdue' : 'Behind plan'}: ${s.name}`, sub: d.overdue ? `${d.overdueDays} days past its expected finish` : `${d.slippedDays} days later than planned`, onClick: () => ws.openStage(s.id) } }),
  ]

  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
      <Tile T={T} icon={<Icon name="hammer" size={18} />} label="Current stage" value={cur?.name || (wp.hasJourney ? 'All complete' : 'No journey')} sub={wp.hasJourney ? `Works ${wp.pct}% · ${wp.complete}/${wp.counted} stages` : 'Start one in Journey'} onClick={() => cur ? ws.openStage(cur.id) : onSection('journey')} />
      <Tile T={T} icon={<Icon name="calendar" size={18} />} label="Forecast completion" value={project.target_end_date ? fmtDate(project.target_end_date) : 'Not set'} sub={project.original_end_date ? `Planned ${fmtDate(project.original_end_date)}` : 'No baseline yet'} onClick={() => onSection('journey')} />
      <Tile T={T} icon={<Icon name="pound" size={18} />} label="Budget" value={fmt(t.agreed)} sub={`Forecast ${fmt(ffc.value)} · paid ${fmt(t.paid)}`} onClick={() => onSection('costs')} color={ffc.variance > 0 ? T.red : undefined} />
      <Tile T={T} icon={<Icon name="clipboard-check" size={18} />} label="Attention" value={attention.length ? `${attention.length} ${attention.length === 1 ? 'item' : 'items'}` : 'Nothing flagged'} sub={`${overdue.length} overdue tasks · ${blocked.length} blocked`} color={attention.length ? T.red : T.green} onClick={() => document.getElementById('refurb-attention')?.scrollIntoView({ behavior: 'smooth' })} />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={panel(T)}>
          <div style={sectionHead(T)}><span>Refurb journey</span><button onClick={() => onSection('journey')} style={btn(T)}>Open journey</button></div>
          {wp.hasJourney ? <>
            <JourneyStrip stages={data.stages} onOpen={s => ws.openStage(s.id)} T={T} />
            <div style={{ marginTop: 14 }}><Gantt stages={data.stages} onOpen={s => ws.openStage(s.id)} T={T} maxRows={6} /></div>
          </> : <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No journey yet. <button onClick={() => onSection('journey')} style={{ ...btn(T), marginLeft: 6 }}>Start from a template</button></div>}
        </div>
        <TaskList ws={ws} stage={null} items={data.tasks.filter(x => x.kind !== 'checklist')} title="Tasks and milestones (all stages)" />
        <Updates ws={ws} stage={null} items={data.updates.slice(0, 8)} title="Latest updates" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={panel(T)}>
          <div style={sectionHead(T)}><span>Next action</span></div>
          <input value={na.text} onChange={e => setNa(x => ({ ...x, text: e.target.value }))} disabled={!canEdit} placeholder="e.g. Approve kitchen layout" aria-label="Next action"
            onBlur={() => { const v = na.text.trim() || null; if (v !== (project.next_action || null)) ops.updateProject({ next_action: v }) }} style={inputStyle(T)} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>Due</span>
            <input type="date" value={na.due} disabled={!canEdit} aria-label="Next action due" onChange={e => setNa(x => ({ ...x, due: e.target.value }))}
              onBlur={() => { const v = na.due || null; if (v !== (project.next_action_due || null)) ops.updateProject({ next_action_due: v }) }} style={{ ...inputStyle(T), width: 'auto' }} />
          </div>
        </div>
        <div style={panel(T)} id="refurb-attention">
          <div style={sectionHead(T)}><span>Needs attention</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{attention.length}</span></div>
          {attention.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No overdue tasks, blocked or delayed stages.</div>}
          {attention.map(a => <button key={a.key} onClick={a.onClick || undefined} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderLeft: `3px solid ${a.color}`, padding: '6px 10px', marginBottom: 6, cursor: a.onClick ? 'pointer' : 'default', color: T.text }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.text}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{a.sub}</div>
          </button>)}
        </div>
        <ProjectDetails ws={ws} />
        <div style={panel(T)}>
          <div style={sectionHead(T)}><span>Money at a glance</span><button onClick={() => onSection('costs')} style={btn(T)}>Costs</button></div>
          <MoneyRows rows={[['Agreed budget', t.agreed], ['Invoiced', invoiced], ['Paid', t.paid], ['Forecast final cost', ffc.value]]} T={T} />
          <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 6 }}>Paid {t.pct}% of agreed. Works progress {wp.hasJourney ? `${wp.pct}%` : 'not tracked yet'}. The two are measured separately.</div>
        </div>
      </div>
    </div>
  </div>
}

function MoneyRows({ rows, T }) {
  return rows.map(([l, v, col]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px dashed ${T.border}` }}>
    <span style={{ color: T.muted }}>{l}</span><b style={{ fontVariantNumeric: 'tabular-nums', color: col || T.text }}>{fmt(v)}</b>
  </div>)
}

function ProjectDetails({ ws }) {
  const { project, ops, canEdit, contractors, people, T } = ws
  const [f, setF] = useState(() => formOf(project))
  useEffect(() => { setF(formOf(project)) }, [project.id, project.updated_at])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = (k, raw = f[k]) => {
    let v = raw
    if (['expected_rent_after', 'expected_value_after'].includes(k)) v = raw === '' || raw == null ? null : Number(raw)
    else if (typeof v === 'string') v = v.trim() || null
    if (k === 'title' && !v) v = 'Refurbishment'
    if ((project[k] ?? null) === v) return
    ops.updateProject({ [k]: v })
  }
  const dis = !canEdit
  return <div style={panel(T)}>
    <div style={sectionHead(T)}><span>Project details</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div style={{ gridColumn: '1 / -1' }}><Field label="Project name" T={T}><input value={f.title} onChange={e => set('title', e.target.value)} onBlur={() => save('title')} disabled={dis} style={inputStyle(T)} /></Field></div>
      <Field label="Type" T={T}>
        <select value={f.project_type} disabled={dis} onChange={e => { set('project_type', e.target.value); save('project_type', e.target.value) }} style={inputStyle(T)}>
          {PROJECT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Planned start" T={T}><input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} onBlur={() => save('start_date')} disabled={dis} style={inputStyle(T)} /></Field>
      <Field label="Project manager" T={T}><input list="refurb-people" value={f.project_manager_name} onChange={e => set('project_manager_name', e.target.value)} onBlur={() => save('project_manager_name')} disabled={dis} placeholder="Name" style={inputStyle(T)} /></Field>
      <Field label="Main contractor" T={T}>
        <ContractorSelect value={project.contractor_name} contractors={contractors} disabled={dis} T={T} companyId={project.company_id} onAdd={ops.addContractor}
          onChange={name => ops.updateProject({ contractor_name: name || null })} />
      </Field>
      <Field label="Expected rent after (pcm)" T={T}><MoneyInput prefix="£" value={f.expected_rent_after} onChange={v => set('expected_rent_after', v == null ? '' : v)} onBlur={() => save('expected_rent_after')} disabled={dis} style={inputStyle(T)} /></Field>
      <Field label="Expected value after" T={T}><MoneyInput prefix="£" value={f.expected_value_after} onChange={v => set('expected_value_after', v == null ? '' : v)} onBlur={() => save('expected_value_after')} disabled={dis} style={inputStyle(T)} /></Field>
      <div style={{ gridColumn: '1 / -1' }}><Field label="Notes" T={T}><textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} onBlur={() => save('notes')} disabled={dis} style={{ ...inputStyle(T), fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }} /></Field></div>
    </div>
    <datalist id="refurb-people">{people.map(p => <option key={p} value={p} />)}</datalist>
  </div>
}

function formOf(p) {
  return {
    title: p.title || 'Refurbishment', project_type: p.project_type || 'residential', start_date: p.start_date || '',
    project_manager_name: p.project_manager_name || '', expected_rent_after: p.expected_rent_after ?? '',
    expected_value_after: p.expected_value_after ?? '', notes: p.notes || '',
  }
}

// ── Costs ─────────────────────────────────────────────────────────────────
function CostsTab({ ws, t, ffc, invoiced, children }) {
  const { project, ops, canEdit, T, isMobile } = ws
  const confirm = useConfirm()
  const [ov, setOv] = useState(project.forecast_cost_override ?? '')
  useEffect(() => { setOv(project.forecast_cost_override ?? '') }, [project.forecast_cost_override])
  async function saveOverride(value = ov) {
    const next = value === '' || value == null ? null : Number(value)
    if ((project.forecast_cost_override ?? null) === next) return
    const reason = await confirm({ title: next == null ? 'Go back to the calculated forecast?' : `Set the forecast final cost to ${fmt(next)}?`, body: `Calculated forecast: ${fmt(ffc.calculated)}. The reason is kept in history.`, prompt: true, placeholder: 'Reason (required)', confirmLabel: 'Save' })
    if (!reason || !reason.trim()) { setOv(project.forecast_cost_override ?? ''); return }
    await ops.updateProject({ forecast_cost_override: next, forecast_cost_reason: next == null ? null : reason.trim() }, { reason: reason.trim() })
  }
  return <div>
    <div style={{ ...panel(T), display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
      <div>
        <div style={sectionHead(T)}><span>Budget and forecast</span></div>
        <MoneyRows T={T} rows={[
          ['Original agreed budget', t.original],
          ['Approved variations (extras)', t.extras],
          ['Revised approved budget', t.agreed],
          ['Invoiced', invoiced],
          ['Paid', t.paid],
          ['Remaining budget (revised minus paid)', t.remaining],
          ['Forecast final cost', ffc.value, ffc.variance > 0 ? T.red : undefined],
          ['Budget variance (forecast minus revised)', ffc.value - t.agreed, ffc.value - t.agreed > 0 ? T.red : T.green],
        ]} />
      </div>
      <div>
        <div style={sectionHead(T)}><span>Forecast final cost</span>{ffc.overridden && <Pill color={T.amber} T={T}>Set by PM</Pill>}</div>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.6 }}>
          Calculated as the larger of the revised approved budget ({fmt(t.agreed)}) and invoiced plus committed-not-yet-invoiced ({fmt(invoiced)} + {fmt(0)}): <b style={{ color: T.text }}>{fmt(ffc.calculated)}</b>. Committed orders come from procurement records once they exist. Pending variations never change it until approved.
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <MoneyInput prefix="£" value={ov} onChange={v => setOv(v == null ? '' : v)} onBlur={() => saveOverride()} disabled={!canEdit} placeholder="Use calculated" style={inputStyle(T)} aria-label="Forecast override" />
          {ffc.overridden && canEdit && <button onClick={() => { setOv(''); saveOverride('') }} style={btn(T)}>Clear</button>}
        </div>
        {project.forecast_cost_reason && <div style={{ fontSize: 12, color: T.amber, marginTop: 6 }}>Reason: {project.forecast_cost_reason}</div>}
      </div>
    </div>
    {children}
  </div>
}

// ── History ───────────────────────────────────────────────────────────────
function HistoryTab({ ws }) {
  const { data, T, stageName } = ws
  const [filter, setFilter] = useState('all')
  const rows = data.events.filter(e => filter === 'all' || (filter === 'project' ? !e.stage_id : e.stage_id === filter))
  const stagesWithHistory = [...new Set(data.events.map(e => e.stage_id).filter(Boolean))]
  return <div style={panel(T)}>
    <div style={sectionHead(T)}>
      <span>History</span>
      <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle(T), width: 'auto', textTransform: 'none', letterSpacing: 0 }} aria-label="Filter history">
        <option value="all">Everything</option><option value="project">Project only</option>
        {stagesWithHistory.map(id => <option key={id} value={id}>{stageName(id) || 'Removed stage'}</option>)}
      </select>
    </div>
    {rows.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>Nothing recorded yet. Changes to dates, stages, budgets and sign-offs appear here, with who made them and why.</div>}
    {rows.map(e => <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
      {e.stage_id && <div style={{ fontFamily: mono, fontSize: 9.5, color: T.gold, marginTop: 6 }}>{stageName(e.stage_id) || 'Removed stage'}</div>}
      <HistoryRow e={e} T={T} />
    </div>)}
    <div style={{ marginTop: 10 }}><ProgressExplainer stages={data.stages} tasks={data.tasks} T={T} /></div>
  </div>
}

