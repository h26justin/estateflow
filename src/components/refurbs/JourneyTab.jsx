// Refurb Journey & Timeline: the project's own journey (start from a
// template, then add / rename / reorder / skip / archive stages, substages
// and custom statuses), the visual journey and the Gantt programme.
import { useState, useEffect } from 'react'
import * as api from '../../lib/api'
import Modal from '../../lib/Modal'
import { useConfirm } from '../../lib/ConfirmContext'
import {
  BUILT_IN_TEMPLATES, stageTree, archivedStages, worksProgress, stageCompletion, stageDelay,
  STAGE_STATUSES, STAGE_STATUS_CFG, statusOptions, statusValue, parseStatusValue, templateFromStages,
  expectedEnd, programmeEnd,
} from '../../lib/refurbWorkspace'
import Gantt from './Gantt'
import { QuickText } from './StageDrawer'
import { mono, btn, inputStyle, panel, sectionHead, StatusChip, Pill, Empty, fmtShort, fmtDate } from './ui'

export function JourneyStrip({ stages, onOpen, T }) {
  const tree = stageTree(stages).filter(s => s.status !== 'skipped')
  if (tree.length === 0) return null
  return <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: Math.max(420, tree.length * 92) }}>
      {tree.map((s, i) => {
        const c = STAGE_STATUS_CFG[s.status]?.color || T.muted
        const done = s.status === 'complete'
        const live = ['in_progress', 'blocked', 'on_hold'].includes(s.status)
        const delay = stageDelay(s)
        return <div key={s.id} style={{ flex: 1, minWidth: 84, position: 'relative', textAlign: 'center' }}>
          {i > 0 && <span style={{ position: 'absolute', top: 15, right: '50%', width: '100%', height: 2, background: done || live ? T.green : T.border }} />}
          <button onClick={() => onOpen(s)} title={`${s.name}: ${STAGE_STATUS_CFG[s.status]?.label}`}
            style={{ position: 'relative', width: 32, height: 32, borderRadius: 16, border: `2px solid ${done ? T.green : live ? c : T.border}`, background: done ? T.green : live ? c + '33' : T.card, color: done ? '#fff' : T.text, fontFamily: mono, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {done ? '✓' : i + 1}
          </button>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 6, padding: '0 4px', lineHeight: 1.2 }}>{s.name}</div>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: delay.overdue || delay.slippedDays ? T.red : T.muted, marginTop: 2 }}>
            {delay.overdue ? 'Overdue' : delay.slippedDays ? `${delay.slippedDays}d late` : s.status_label || STAGE_STATUS_CFG[s.status]?.label}
          </div>
        </div>
      })}
    </div>
  </div>
}

export function ProgressExplainer({ stages, tasks, T }) {
  const wp = worksProgress(stages, tasks)
  return <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.6 }}>
    <b style={{ color: T.text }}>How works progress is worked out.</b> Each live stage counts once (or by its weight). Complete = 100%, not started = 0%. A stage under way uses its recorded progress %, else the share of its checklist ticked; a stage with substages averages them. Skipped and archived stages are left out. This measures the work, not the money: the % paid is shown separately under Costs.
    {wp.hasJourney && <div style={{ marginTop: 4 }}>Now: {wp.complete} of {wp.counted} stages complete, works progress {wp.pct}%.{wp.missing > 0 && <span style={{ color: T.amber }}> {wp.missing} {wp.missing === 1 ? 'stage is' : 'stages are'} under way with no progress recorded, counted as 0%.</span>}</div>}
  </div>
}

export default function JourneyTab({ ws }) {
  const { data, ops, project, canEdit, T, isMobile } = ws
  const confirm = useConfirm()
  const [showArchived, setShowArchived] = useState(false)
  const [editingStatuses, setEditingStatuses] = useState(false)
  const tree = stageTree(data.stages)
  const archived = archivedStages(data.stages)
  const end = programmeEnd(data.stages)

  if (tree.length === 0 && archived.length === 0) return <TemplatePicker ws={ws} />

  async function move(stage, dir) {
    const siblings = (stage.parent_id ? tree.find(s => s.id === stage.parent_id)?.children : tree) || []
    const i = siblings.findIndex(s => s.id === stage.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= siblings.length) return
    await ops.reorder(siblings, i, j)
  }
  async function archive(stage) {
    const ok = await confirm({ title: `Archive ${stage.name}?`, body: 'It leaves the journey and works progress, but keeps its dates, tasks, notes and history. You can restore it from Archived stages.', confirmLabel: 'Archive' })
    if (ok) await ops.archiveStage(stage)
  }
  async function saveTemplate() {
    const name = await confirm({ title: 'Save this journey as a template', body: 'Saves the stage names, order, substages and weights (not dates or tasks) so new refurbs in this company can start from it.', prompt: true, placeholder: 'Template name', defaultValue: `${project.project_type === 'commercial' ? 'Commercial' : 'Residential'} – ${ws.propertyName}`, confirmLabel: 'Save template' })
    if (!name || !name.trim()) return
    await ops.saveTemplate(name.trim(), templateFromStages(data.stages))
  }

  const rowGrid = isMobile ? '1fr auto' : '28px minmax(160px, 1.6fr) 1.1fr 0.9fr 0.9fr 0.9fr auto'
  const renderRow = (s, idx, depth) => {
    const comp = stageCompletion(s, s.children || [], data.tasks)
    const delay = stageDelay(s)
    const skipped = s.status === 'skipped'
    return <div key={s.id} style={{ display: 'grid', gridTemplateColumns: rowGrid, gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.border}`, opacity: skipped ? 0.55 : 1 }}>
      {!isMobile && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, textAlign: 'right' }}>{depth ? '' : idx + 1}</span>}
      <button onClick={() => ws.openStage(s.id)} style={{ textAlign: 'left', background: 'none', border: 'none', padding: `0 0 0 ${depth ? 18 : 0}px`, cursor: 'pointer', color: T.text, minWidth: 0 }}>
        <div style={{ fontWeight: depth ? 500 : 700, fontSize: depth ? 12.5 : 13.5, textDecoration: skipped ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{depth ? '↳ ' : ''}{s.name}</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: delay.overdue || delay.slippedDays ? T.red : T.muted, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {isMobile && <StatusChip stage={s} T={T} />}
          <span>{s.contractor_name || s.responsible_name || 'Unassigned'}</span>
          {delay.overdue && <span>· {delay.overdueDays}d overdue</span>}
          {!delay.overdue && delay.slippedDays > 0 && <span>· {delay.slippedDays}d behind plan</span>}
          {comp.source === 'missing' && <span style={{ color: T.amber }}>· no progress recorded</span>}
        </div>
      </button>
      {!isMobile && (canEdit
        ? <select value={statusValue(s)} onChange={e => ops.updateStage(s, parseStatusValue(e.target.value))} style={{ ...inputStyle(T), padding: '4px 6px' }} aria-label={`Status of ${s.name}`}>
            {statusOptions(project.custom_statuses).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        : <StatusChip stage={s} T={T} />)}
      {!isMobile && <span style={{ fontFamily: mono, fontSize: 10.5, color: T.muted }} title="Planned">{s.planned_start || s.planned_end ? `${fmtShort(s.planned_start)} – ${fmtShort(s.planned_end)}` : 'No plan'}</span>}
      {!isMobile && <span style={{ fontFamily: mono, fontSize: 10.5, color: s.forecast_end && s.forecast_end !== s.planned_end ? T.gold : T.muted }} title="Forecast finish">{expectedEnd(s) ? `→ ${fmtShort(s.actual_end || expectedEnd(s))}` : ''}</span>}
      {!isMobile && <span style={{ fontFamily: mono, fontSize: 11, color: T.text }}>{Math.round(comp.value * 100)}%</span>}
      <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
        {canEdit && !isMobile && <>
          <button onClick={() => move(s, -1)} style={iconBtn(T)} aria-label={`Move ${s.name} up`} title="Move up">↑</button>
          <button onClick={() => move(s, 1)} style={iconBtn(T)} aria-label={`Move ${s.name} down`} title="Move down">↓</button>
          <button onClick={() => ops.updateStage(s, skipped ? { status: 'not_started', status_label: null } : { status: 'skipped', status_label: null })} style={iconBtn(T)} title={skipped ? 'Un-skip' : 'Skip this stage'}>{skipped ? 'Unskip' : 'Skip'}</button>
          <button onClick={() => archive(s)} style={iconBtn(T)} title="Archive">Archive</button>
        </>}
        <button onClick={() => ws.openStage(s.id)} style={iconBtn(T)} aria-label={`Open ${s.name}`}>Open</button>
      </div>
    </div>
  }

  return <div>
    <div style={panel(T)}>
      <div style={sectionHead(T)}>
        <span>Refurb journey{project.template_name ? ` · from ${project.template_name}` : ''}</span>
        {canEdit && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', textTransform: 'none', letterSpacing: 0 }}>
          <button onClick={() => setEditingStatuses(true)} style={btn(T)}>Custom statuses</button>
          <button onClick={saveTemplate} style={btn(T)}>Save as template</button>
        </div>}
      </div>
      <JourneyStrip stages={data.stages} onOpen={s => ws.openStage(s.id)} T={T} />
    </div>

    <div style={panel(T)}>
      <div style={sectionHead(T)}><span>Stages</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{end ? `Programme ends ${fmtDate(end)}` : 'No dates yet'}</span></div>
      {tree.map((s, i) => [renderRow(s, i, 0), ...(s.children || []).map(c => renderRow(c, 0, 1))])}
      {canEdit && <QuickText placeholder="New stage name, e.g. Roof repairs" button="Add stage" T={T} onAdd={name => ops.addStage({ name })} />}
      {archived.length > 0 && <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowArchived(v => !v)} style={btn(T)}>{showArchived ? 'Hide' : 'Show'} archived stages ({archived.length})</button>
        {showArchived && archived.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${T.border}`, gap: 8 }}>
          <span style={{ fontSize: 13, color: T.muted }}>{s.parent_id ? '↳ ' : ''}{s.name} <span style={{ fontFamily: mono, fontSize: 10 }}>· archived {fmtShort(s.archived_at)}</span></span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => ws.openStage(s.id)} style={btn(T)}>View</button>
            {canEdit && <button onClick={() => ops.restoreStage(s)} style={btn(T)}>Restore</button>}
          </div>
        </div>)}
      </div>}
      <div style={{ marginTop: 12 }}><ProgressExplainer stages={data.stages} tasks={data.tasks} T={T} /></div>
    </div>

    <div style={panel(T)}>
      <div style={sectionHead(T)}><span>Timeline</span></div>
      <Gantt stages={data.stages} onOpen={s => ws.openStage(s.id)} T={T} />
    </div>

    <LegacyChecklist ws={ws} />

    {editingStatuses && <StatusEditor ws={ws} onClose={() => setEditingStatuses(false)} />}
  </div>
}

// The flat checklist from the first refurb tracker (Sep 2026). Shown only
// when something on it was ticked, so that history is not hidden by the
// journey; it no longer drives anything.
function LegacyChecklist({ ws }) {
  const { project, canEdit, T } = ws
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    api.fetchRefurbMilestones(project.id).then(r => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [project.id])
  if (!rows || !rows.some(m => m.completed)) return null
  async function toggle(m) {
    if (!canEdit) return
    const fields = { completed: !m.completed, completed_date: !m.completed ? new Date().toISOString().slice(0, 10) : null }
    setRows(rs => rs.map(x => x.id === m.id ? { ...x, ...fields } : x))
    try { await api.updateRefurbMilestone(m.id, fields) } catch (_) { setRows(rs => rs.map(x => x.id === m.id ? m : x)) }
  }
  return <div style={panel(T)}>
    <div style={sectionHead(T)}><span>Earlier checklist</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{rows.filter(m => m.completed).length}/{rows.length}</span></div>
    <div style={{ fontFamily: mono, fontSize: 10.5, color: T.faint, marginBottom: 8 }}>Ticked on the earlier refurb tracker before the journey existed. Kept for the record; the journey above is what counts now.</div>
    {rows.filter(m => m.is_enabled !== false).map(m => <label key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13, color: m.completed ? T.muted : T.text }}>
      <input type="checkbox" checked={m.completed} disabled={!canEdit} onChange={() => toggle(m)} style={{ width: 16, height: 16, margin: 0 }} />
      <span style={{ flex: 1 }}>{m.label}</span>
      {m.completed_date && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{fmtDate(m.completed_date)}</span>}
    </label>)}
  </div>
}

const iconBtn = T => ({ fontFamily: mono, fontSize: 10.5, padding: '3px 7px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', color: T.muted, minHeight: 26 })

function TemplatePicker({ ws }) {
  const { ops, project, canEdit, templates, T } = ws
  const [busy, setBusy] = useState(false)
  const type = project.project_type || 'residential'
  const builtIns = [BUILT_IN_TEMPLATES[type], BUILT_IN_TEMPLATES[type === 'residential' ? 'commercial' : 'residential']]
  const saved = (templates || []).filter(t => !t.company_id || t.company_id === project.company_id)
  const go = async tpl => { setBusy(true); await ops.applyTemplate(tpl); setBusy(false) }
  if (!canEdit) return <Empty T={T} title="No journey yet" body="Someone with edit access can start this refurb's journey from a template." />
  const card = (tpl, key, sub) => <button key={key} disabled={busy} onClick={() => go(tpl)}
    style={{ textAlign: 'left', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, cursor: 'pointer', color: T.text }}>
    <div style={{ fontWeight: 700, marginBottom: 4 }}>{tpl.name}</div>
    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 8 }}>{sub}</div>
    <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>{(tpl.stages || []).map(s => s.name).join(' → ')}</div>
  </button>
  return <div>
    <div style={{ ...panel(T), marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Start this refurb's journey</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Pick a starting point. The project gets its own copy: rename, reorder, skip or add stages afterwards without changing the template.</div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
      {builtIns.map((t, i) => card(t, t.name, i === 0 ? 'Suggested for this project' : 'Built-in template'))}
      {saved.map(t => card({ name: t.name, stages: t.stages }, t.id, `Saved template · ${t.project_type}`))}
      {card({ name: 'Blank journey', stages: [] }, 'blank', 'Add your own stages')}
    </div>
  </div>
}

function StatusEditor({ ws, onClose }) {
  const { project, ops, T } = ws
  const [rows, setRows] = useState(() => (Array.isArray(project.custom_statuses) ? project.custom_statuses : []).map(r => ({ ...r })))
  const [saving, setSaving] = useState(false)
  const clean = rows.map(r => ({ label: String(r.label || '').trim(), category: r.category })).filter(r => r.label && STAGE_STATUSES.includes(r.category))
  return <Modal onClose={onClose} size="md" ariaLabel="Custom statuses">
    <div style={{ padding: '20px 22px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Custom statuses</h2>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12 }}>Name your own statuses, e.g. "Waiting on building control". Each one behaves like the status it is based on, so progress and delay warnings stay correct.</div>
      {rows.map((r, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr auto', gap: 6, marginBottom: 6 }}>
        <input value={r.label} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Status name" style={inputStyle(T)} aria-label="Status name" />
        <select value={r.category} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} style={inputStyle(T)} aria-label="Behaves like">
          {STAGE_STATUSES.map(s => <option key={s} value={s}>Like {STAGE_STATUS_CFG[s].label}</option>)}
        </select>
        <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} style={btn(T)} aria-label="Remove status">✕</button>
      </div>)}
      <button onClick={() => setRows(rs => [...rs, { label: '', category: 'blocked' }])} style={btn(T)}>+ Add status</button>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 10 }}>Removing a status here does not change stages already using it; they keep the label until changed.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={btn(T)}>Cancel</button>
        <button disabled={saving} onClick={async () => { setSaving(true); const ok = await ops.updateProject({ custom_statuses: clean }); setSaving(false); if (ok) onClose() }} style={btn(T, 'gold')}>{saving ? 'Saving…' : 'Save statuses'}</button>
      </div>
    </div>
  </Modal>
}

/** Confirm the knock-on of a date change through dependencies. */
export function CascadeModal({ moves, projectEnd, newEnd, onApply, onSkip, T }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const moved = newEnd && projectEnd && newEnd > projectEnd
  return <Modal onClose={onSkip} size="lg" ariaLabel="Revised dates">
    <div style={{ padding: '20px 22px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>This change affects later work</h2>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12 }}>These stages wait for the one you changed. Confirm to move their forecast dates. Planned dates (the original programme) do not change.</div>
      {moves.map(m => <div key={m.stage_id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8, padding: '7px 0', borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
        <span><b>{m.name}</b><div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>waits for {m.because}</div></span>
        <span style={{ fontFamily: mono, fontSize: 11 }}>{fmtShort(m.from_start)} – {fmtShort(m.from_end)}</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: T.gold }}>→ {fmtShort(m.to_start)} – {fmtShort(m.to_end)} <Pill color={T.red} T={T}>+{m.days}d</Pill></span>
      </div>)}
      {moved && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: T.amber + '18', border: `1px solid ${T.amber}55`, fontSize: 13 }}>
        The programme would finish <b>{fmtDate(newEnd)}</b>, after the current forecast completion of <b>{fmtDate(projectEnd)}</b>. Applying also moves the forecast completion, so give a reason for the record.
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason, e.g. Asbestos found in strip out" style={{ ...inputStyle(T), marginTop: 8 }} aria-label="Reason for the new completion date" />
      </div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={onSkip} style={btn(T)}>Leave later stages as they are</button>
        <button disabled={busy || (moved && !reason.trim())} onClick={async () => { setBusy(true); await onApply(reason.trim() || null); setBusy(false) }}
          style={{ ...btn(T, 'gold'), opacity: busy || (moved && !reason.trim()) ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Apply revised dates'}</button>
      </div>
    </div>
  </Modal>
}
