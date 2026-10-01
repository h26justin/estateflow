// Stage details: everything about one journey stage in one place.
// Every field saves on its own (blur or change). Date changes run through
// the workspace's dependency check, which asks before moving later work.
import { useState, useEffect, useMemo } from 'react'
import Modal from '../../lib/Modal'
import { useConfirm } from '../../lib/ConfirmContext'
import {
  statusOptions, statusValue, parseStatusValue, stageCompletion, stageDelay, flatStages,
  wouldCreateCycle, isTaskOverdue, TASK_PRIORITIES, isoDate,
} from '../../lib/refurbWorkspace'
import { mono, btn, inputStyle, panel, sectionHead, Field, StatusChip, Pill, fmtDate, fmtWhen, todayISO } from './ui'

const TEXT_FIELDS = ['name', 'scope', 'next_action', 'blockers', 'decisions', 'notes', 'responsible_name']
const DATE_FIELDS = ['planned_start', 'planned_end', 'forecast_start', 'forecast_end', 'actual_start', 'actual_end']

export default function StageDrawer({ ws, stageId, onClose }) {
  const { data, ops, project, canEdit, contractors, people, T, isMobile } = ws
  const confirm = useConfirm()
  const stage = data.stages.find(s => s.id === stageId)
  const [form, setForm] = useState(() => formOf(stage))
  useEffect(() => { setForm(formOf(stage)) }, [stageId, stage?.updated_at])
  const children = useMemo(() => data.stages.filter(s => s.parent_id === stageId && !s.deleted_at && !s.archived_at).sort((a, b) => a.sort_order - b.sort_order), [data.stages, stageId])
  const tasks = data.tasks.filter(t => t.stage_id === stageId)
  const checklist = tasks.filter(t => t.kind === 'checklist')
  const work = tasks.filter(t => t.kind !== 'checklist')
  const preds = data.deps.filter(d => d.stage_id === stageId)
  const succs = data.deps.filter(d => d.depends_on_id === stageId)
  const updates = data.updates.filter(u => u.stage_id === stageId)
  const history = data.events.filter(e => e.stage_id === stageId)
  const others = flatStages(data.stages).filter(s => s.id !== stageId)
  const nameOf = id => data.stages.find(s => s.id === id)?.name || 'Removed stage'
  if (!stage) return null

  const completion = stageCompletion(stage, children, data.tasks)
  const delay = stageDelay(stage)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const projectStarted = project.stage !== 'planned' || data.stages.some(s => s.actual_start)

  async function save(k, v = form[k]) {
    if (!canEdit) return
    let value = v
    if (TEXT_FIELDS.includes(k)) value = String(v || '').trim() || null
    if (DATE_FIELDS.includes(k)) value = v || null
    if (k === 'progress_pct') value = v === '' || v == null ? null : Math.max(0, Math.min(100, Math.round(Number(v))))
    if (k === 'weight') value = Math.max(0, Number(v) || 0)
    if (k === 'name' && !value) { set('name', stage.name); return }
    if ((stage[k] ?? null) === value) return
    let reason = null
    // The original programme is kept: once work has started, changing a
    // planned date needs a reason and is logged with old and new values.
    if ((k === 'planned_start' || k === 'planned_end') && projectStarted && stage[k]) {
      reason = await confirm({ title: 'Change the original programme?', body: `Planned dates are the baseline. Changing ${k === 'planned_start' ? 'the planned start' : 'the planned finish'} from ${fmtDate(stage[k])} to ${fmtDate(value)} is recorded in history. Usually it is the forecast that should move. Why is the baseline changing?`, prompt: true, placeholder: 'Reason (required)', confirmLabel: 'Change baseline' })
      if (!reason || !reason.trim()) { set(k, stage[k] || ''); return }
    }
    await ops.updateStage(stage, { [k]: value }, { reason })
  }

  async function changeStatus(value) {
    const { status, status_label } = parseStatusValue(value)
    const fields = { status, status_label }
    if (status === 'in_progress' && !stage.actual_start) fields.actual_start = todayISO()
    if (status === 'complete' && !stage.actual_end) fields.actual_end = todayISO()
    if (status === 'complete' && !stage.actual_start) fields.actual_start = fields.actual_end || todayISO()
    await ops.updateStage(stage, fields)
  }

  async function signOff() {
    const ok = await confirm({ title: `Sign off ${stage.name}?`, body: `Records that you signed this stage off now and marks it complete${stage.actual_end ? '' : ', with today as its actual finish'}.`, confirmLabel: 'Sign off' })
    if (!ok) return
    const fields = { signed_off_by: ws.actor?.name || 'Unknown', signed_off_at: new Date().toISOString(), status: 'complete', status_label: null }
    if (!stage.actual_end) fields.actual_end = todayISO()
    if (!stage.actual_start) fields.actual_start = fields.actual_end || stage.actual_end
    await ops.updateStage(stage, fields, { action: 'signed_off' })
  }
  async function undoSignOff() {
    const reason = await confirm({ title: 'Withdraw sign-off?', body: 'The stage returns to In progress. The original sign-off stays in history.', prompt: true, placeholder: 'Reason (required)', confirmLabel: 'Withdraw' })
    if (!reason || !reason.trim()) return
    await ops.updateStage(stage, { signed_off_by: null, signed_off_at: null, status: 'in_progress', status_label: null, actual_end: null }, { reason, action: 'sign_off_withdrawn' })
  }

  const grid = cols => ({ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : `repeat(${cols}, 1fr)`, gap: 10 })
  const ta = { ...inputStyle(T), fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }
  const dis = !canEdit

  return <Modal onClose={onClose} size="xl" ariaLabel={`Stage ${stage.name}`} style={{ maxHeight: '92vh' }}>
    <div style={{ padding: isMobile ? '16px 14px' : '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            {stage.parent_id ? `Substage of ${nameOf(stage.parent_id)}` : 'Journey stage'}
          </div>
          <input value={form.name} onChange={e => set('name', e.target.value)} onBlur={() => save('name')} disabled={dis} aria-label="Stage name"
            style={{ ...inputStyle(T), fontFamily: 'inherit', fontSize: 20, fontWeight: 800, background: 'transparent', border: `1px solid ${dis ? 'transparent' : T.border}`, padding: '4px 8px' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <StatusChip stage={stage} T={T} />
            {delay.overdue && <Pill color={T.red} T={T}>{delay.overdueDays} days overdue</Pill>}
            {delay.slippedDays > 0 && <Pill color={T.red} T={T}>{delay.slippedDays} days behind plan</Pill>}
            {stage.signed_off_at && <Pill color={T.green} T={T}>Signed off by {stage.signed_off_by} · {fmtWhen(stage.signed_off_at)}</Pill>}
          </div>
        </div>
        <button onClick={onClose} style={btn(T)} aria-label="Close">Close</button>
      </div>

      {/* Status + progress */}
      <div style={panel(T)}>
        <div style={grid(4)}>
          <Field label="Status" T={T}>
            <select value={statusValue(stage)} onChange={e => changeStatus(e.target.value)} disabled={dis} style={inputStyle(T)}>
              {statusOptions(project.custom_statuses).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Progress %" T={T} hint={children.length ? 'From substages' : completion.source === 'checklist' ? 'From checklist (leave blank)' : completion.source === 'missing' ? 'No progress recorded yet' : null}>
            <input type="number" min="0" max="100" value={form.progress_pct} onChange={e => set('progress_pct', e.target.value)} onBlur={() => save('progress_pct')}
              disabled={dis || children.length > 0 || ['complete', 'not_started', 'skipped'].includes(stage.status)} placeholder={`${Math.round(completion.value * 100)}`} style={inputStyle(T)} />
          </Field>
          <Field label="Weight in works progress" T={T} hint="1 = normal">
            <input type="number" min="0" step="0.5" value={form.weight} onChange={e => set('weight', e.target.value)} onBlur={() => save('weight')} disabled={dis} style={inputStyle(T)} />
          </Field>
          <Field label="Sign-off" T={T}>
            {stage.signed_off_at
              ? <button onClick={undoSignOff} disabled={dis} style={{ ...btn(T), width: '100%' }}>Withdraw sign-off</button>
              : <button onClick={signOff} disabled={dis} style={{ ...btn(T, 'gold'), width: '100%' }}>Sign off stage</button>}
          </Field>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {/* Scope */}
          <div style={panel(T)}>
            <div style={sectionHead(T)}><span>Scope and description</span></div>
            <textarea rows={3} value={form.scope} onChange={e => set('scope', e.target.value)} onBlur={() => save('scope')} disabled={dis} placeholder="What this stage covers" style={ta} />
          </div>

          {/* Dates */}
          <div style={panel(T)}>
            <div style={sectionHead(T)}><span>Dates</span><span style={{ textTransform: 'none', letterSpacing: 0, color: T.faint }}>Planned = baseline · Forecast = expected now · Actual = what happened</span></div>
            {[['Planned', 'planned'], ['Forecast', 'forecast'], ['Actual', 'actual']].map(([lbl, k]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: k === 'forecast' ? T.gold : k === 'actual' ? T.text : T.muted, fontWeight: 700 }}>{lbl}</span>
                <input type="date" aria-label={`${lbl} start`} value={form[`${k}_start`]} onChange={e => set(`${k}_start`, e.target.value)} onBlur={() => save(`${k}_start`)} disabled={dis} style={inputStyle(T)} />
                <input type="date" aria-label={`${lbl} finish`} value={form[`${k}_end`]} onChange={e => set(`${k}_end`, e.target.value)} onBlur={() => save(`${k}_end`)} disabled={dis} style={inputStyle(T)} />
              </div>
            ))}
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 4 }}>Leave Forecast blank to follow the plan. Moving a forecast or actual finish checks the stages that depend on this one.</div>
          </div>

          {/* Next action / blockers / decisions */}
          <div style={panel(T)}>
            <div style={grid(1)}>
              <Field label="Next action" T={T}><input value={form.next_action} onChange={e => set('next_action', e.target.value)} onBlur={() => save('next_action')} disabled={dis} placeholder="What happens next" style={inputStyle(T)} /></Field>
              <Field label="Blockers" T={T}><textarea rows={2} value={form.blockers} onChange={e => set('blockers', e.target.value)} onBlur={() => save('blockers')} disabled={dis} placeholder="Anything stopping this stage" style={ta} /></Field>
              <Field label="Decisions" T={T}><textarea rows={2} value={form.decisions} onChange={e => set('decisions', e.target.value)} onBlur={() => save('decisions')} disabled={dis} placeholder="Decisions made or needed" style={ta} /></Field>
            </div>
          </div>

          <Checklist ws={ws} stage={stage} items={checklist} />
          <TaskList ws={ws} stage={stage} items={work} />
          <Updates ws={ws} stage={stage} items={updates} />
        </div>

        <div style={{ minWidth: 0 }}>
          {/* People */}
          <div style={panel(T)}>
            <div style={sectionHead(T)}><span>People</span></div>
            <div style={grid(1)}>
              <Field label="Responsible person" T={T}>
                <input list="refurb-people" value={form.responsible_name} onChange={e => set('responsible_name', e.target.value)} onBlur={() => save('responsible_name')} disabled={dis} placeholder="Name" style={inputStyle(T)} />
              </Field>
              <Field label="Contractor" T={T}>
                <ContractorSelect value={stage.contractor_name} contractors={contractors} disabled={dis} T={T} companyId={project.company_id}
                  onAdd={ops.addContractor}
                  onChange={(name, id) => ops.updateStage(stage, { contractor_name: name || null, contractor_id: id || null })} />
              </Field>
            </div>
            <datalist id="refurb-people">{people.map(p => <option key={p} value={p} />)}</datalist>
          </div>

          {/* Dependencies */}
          <div style={panel(T)}>
            <div style={sectionHead(T)}><span>Depends on</span></div>
            {preds.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginBottom: 8 }}>Can start any time.</div>}
            {preds.map(d => <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr 86px auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>{nameOf(d.depends_on_id)}</span>
              <input type="number" defaultValue={d.lag_days} disabled={dis} title="Days to wait after it finishes" aria-label="Lag days"
                onBlur={e => { const v = Math.round(Number(e.target.value) || 0); if (v !== d.lag_days) ops.updateDependency(d, v) }} style={{ ...inputStyle(T), padding: '4px 6px' }} />
              {canEdit ? <button onClick={() => ops.removeDependency(d)} style={btn(T)} aria-label="Remove dependency">✕</button> : <span />}
            </div>)}
            {preds.length > 0 && <div style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, marginBottom: 8 }}>Number = days to wait after that stage finishes.</div>}
            {canEdit && <AddDependency stage={stage} others={others} deps={data.deps} onAdd={ops.addDependency} T={T} />}
            {succs.length > 0 && <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 10 }}>Waiting on this: {succs.map(d => nameOf(d.stage_id)).join(', ')}</div>}
          </div>

          {/* Substages */}
          {!stage.parent_id && <div style={panel(T)}>
            <div style={sectionHead(T)}><span>Substages</span></div>
            {children.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginBottom: 8 }}>None. Add substages to break this stage down; its progress then comes from them.</div>}
            {children.map(c => <button key={c.id} onClick={() => ws.openStage(c.id)} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${T.border}`, padding: '7px 0', cursor: 'pointer', color: T.text, fontSize: 13, gap: 8 }}>
              <span style={{ textAlign: 'left' }}>{c.name}</span><StatusChip stage={c} T={T} />
            </button>)}
            {canEdit && <QuickText placeholder="New substage name" button="Add substage" T={T} onAdd={name => ops.addStage({ name, parent_id: stage.id })} />}
          </div>}

          {/* Stage history */}
          <div style={panel(T)}>
            <div style={sectionHead(T)}><span>History</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{history.length}</span></div>
            {history.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No changes recorded yet.</div>}
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {history.map(e => <HistoryRow key={e.id} e={e} T={T} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Modal>
}

function formOf(s) {
  const o = {}
  if (!s) return o
  for (const k of TEXT_FIELDS) o[k] = s[k] || ''
  for (const k of DATE_FIELDS) o[k] = isoDate(s[k]) || ''
  o.progress_pct = s.progress_pct ?? ''
  o.weight = s.weight ?? 1
  return o
}

export function ContractorSelect({ value, contractors, onChange, onAdd, disabled, T, companyId }) {
  const known = contractors.some(c => c.name.toLowerCase() === String(value || '').toLowerCase())
  return <select value={value || ''} disabled={disabled} style={inputStyle(T)}
    onChange={async e => {
      const v = e.target.value
      if (v === '__new') {
        const added = await onAdd?.(companyId)
        if (added) onChange(added.name, added.id)
        return
      }
      const c = contractors.find(x => x.name === v)
      onChange(v, c?.id)
    }}>
    <option value="">Not assigned</option>
    {value && !known && <option value={value}>{value}</option>}
    {contractors.map(c => <option key={c.id} value={c.name}>{c.name}{c.trade ? ` · ${c.trade}` : ''}</option>)}
    {onAdd && <option value="__new">+ Add a contractor…</option>}
  </select>
}

function AddDependency({ stage, others, deps, onAdd, T }) {
  const [pick, setPick] = useState('')
  const [err, setErr] = useState(null)
  const taken = new Set(deps.filter(d => d.stage_id === stage.id).map(d => d.depends_on_id))
  const options = others.filter(s => !taken.has(s.id))
  return <div>
    <div style={{ display: 'flex', gap: 6 }}>
      <select value={pick} onChange={e => { setPick(e.target.value); setErr(null) }} style={inputStyle(T)} aria-label="Stage this depends on">
        <option value="">Choose a stage it waits for</option>
        {options.map(s => <option key={s.id} value={s.id}>{s.parent_id ? '  ↳ ' : ''}{s.name}</option>)}
      </select>
      <button disabled={!pick} style={{ ...btn(T, 'gold'), opacity: pick ? 1 : 0.5 }} onClick={async () => {
        if (wouldCreateCycle(deps, stage.id, pick)) { setErr('That would make a loop: the other stage already waits for this one.'); return }
        await onAdd(stage, pick); setPick('')
      }}>Add</button>
    </div>
    {err && <div role="alert" style={{ fontFamily: mono, fontSize: 10.5, color: T.red, marginTop: 4 }}>{err}</div>}
  </div>
}

export function QuickText({ placeholder, button, onAdd, T }) {
  const [v, setV] = useState('')
  const go = async () => { const t = v.trim(); if (!t) return; await onAdd(t); setV('') }
  return <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
    <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} placeholder={placeholder} style={inputStyle(T)} />
    <button onClick={go} disabled={!v.trim()} style={{ ...btn(T, 'gold'), opacity: v.trim() ? 1 : 0.5 }}>{button}</button>
  </div>
}

function Checklist({ ws, stage, items }) {
  const { ops, canEdit, T } = ws
  const live = items.filter(t => t.status !== 'cancelled')
  return <div style={panel(T)}>
    <div style={sectionHead(T)}><span>Completion checklist</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{live.filter(t => t.status === 'done').length}/{live.length}</span></div>
    {live.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No checklist yet. Items ticked here count toward this stage's progress.</div>}
    {live.map(t => <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <input type="checkbox" checked={t.status === 'done'} disabled={!canEdit} onChange={() => ops.toggleTask(t)} style={{ width: 18, height: 18, margin: 0 }} aria-label={t.title} />
      <span style={{ flex: 1, fontSize: 13, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? T.muted : T.text }}>{t.title}</span>
      {t.status === 'done' && t.completed_by && <span style={{ fontFamily: mono, fontSize: 9.5, color: T.faint }}>{t.completed_by}</span>}
      {canEdit && <button onClick={() => ops.removeTask(t)} style={{ ...btn(T), padding: '2px 7px', minHeight: 0 }} aria-label={`Remove ${t.title}`}>✕</button>}
    </div>)}
    {canEdit && <QuickText placeholder="Add a checklist item" button="Add" T={T} onAdd={title => ops.addTask({ stage_id: stage.id, kind: 'checklist', title })} />}
  </div>
}

export function TaskList({ ws, stage, items, title = 'Tasks and milestones' }) {
  const { ops, canEdit, T, isMobile, people } = ws
  const [draft, setDraft] = useState({ title: '', kind: 'task', owner_name: '', due_date: '', priority: 'normal' })
  const open = items.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const done = items.filter(t => t.status === 'done')
  const [showDone, setShowDone] = useState(false)
  async function add() {
    if (!draft.title.trim()) return
    await ops.addTask({ stage_id: stage?.id || null, kind: draft.kind, title: draft.title.trim(), owner_name: draft.owner_name.trim() || null, due_date: draft.due_date || null, priority: draft.priority })
    setDraft(d => ({ ...d, title: '', due_date: '' }))
  }
  const row = t => {
    const overdue = isTaskOverdue(t)
    return <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
      <input type="checkbox" checked={t.status === 'done'} disabled={!canEdit} onChange={() => ops.toggleTask(t)} style={{ width: 18, height: 18, margin: 0 }} aria-label={t.title} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {t.kind === 'milestone' && <span title="Milestone" style={{ color: T.gold }}>◆</span>}
          <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
          {t.priority === 'urgent' && <Pill color={T.red} T={T}>Urgent</Pill>}
          {t.priority === 'high' && <Pill color={T.amber} T={T}>High</Pill>}
          {overdue && <Pill color={T.red} T={T}>Overdue</Pill>}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: overdue ? T.red : T.muted }}>
          {[t.owner_name, t.contractor_name, t.due_date ? `due ${fmtDate(t.due_date)}` : null, ws.stageName && t.stage_id && !stage ? ws.stageName(t.stage_id) : null].filter(Boolean).join(' · ') || 'No owner or due date'}
        </div>
      </div>
      {canEdit ? <button onClick={() => ops.removeTask(t)} style={{ ...btn(T), padding: '2px 7px', minHeight: 0 }} aria-label={`Remove ${t.title}`}>✕</button> : <span />}
    </div>
  }
  return <div style={panel(T)}>
    <div style={sectionHead(T)}><span>{title}</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{open.length} open</span></div>
    {open.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>Nothing open.</div>}
    {open.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).map(row)}
    {done.length > 0 && <button onClick={() => setShowDone(v => !v)} style={{ ...btn(T), marginTop: 8 }}>{showDone ? 'Hide' : 'Show'} done ({done.length})</button>}
    {showDone && done.map(row)}
    {canEdit && <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr 1fr 1fr auto', gap: 6, marginTop: 10, alignItems: 'end' }}>
      <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="New task or milestone" style={{ ...inputStyle(T), gridColumn: isMobile ? '1 / -1' : undefined }} aria-label="Task title" />
      <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={inputStyle(T)} aria-label="Type"><option value="task">Task</option><option value="milestone">Milestone</option></select>
      <input list="refurb-people" value={draft.owner_name} onChange={e => setDraft(d => ({ ...d, owner_name: e.target.value }))} placeholder="Owner" style={inputStyle(T)} aria-label="Owner" />
      <input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} style={inputStyle(T)} aria-label="Due date" />
      <select value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} style={inputStyle(T)} aria-label="Priority">{TASK_PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select>
      <button onClick={add} disabled={!draft.title.trim()} style={{ ...btn(T, 'gold'), opacity: draft.title.trim() ? 1 : 0.5 }}>Add</button>
    </div>}
    <datalist id="refurb-people">{people.map(p => <option key={p} value={p} />)}</datalist>
  </div>
}

const UPDATE_KINDS = { note: 'Note', site_visit: 'Site visit', meeting: 'Meeting', contractor: 'Contractor update', sign_off: 'Sign-off' }

export function Updates({ ws, stage, items, title = 'Notes and updates' }) {
  const { ops, canEdit, T, isMobile } = ws
  const [draft, setDraft] = useState({ body: '', kind: 'note', update_date: todayISO(), next_action: '' })
  async function add() {
    if (!draft.body.trim()) return
    const ok = await ops.addUpdate({ stage_id: stage?.id || null, kind: draft.kind, body: draft.body.trim(), update_date: draft.update_date || todayISO(), next_action: draft.next_action.trim() || null })
    if (ok) setDraft(d => ({ ...d, body: '', next_action: '' }))
  }
  return <div style={panel(T)}>
    <div style={sectionHead(T)}><span>{title}</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>{items.length}</span></div>
    {canEdit && <div style={{ marginBottom: 10 }}>
      <textarea rows={2} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="What happened, what was agreed" style={{ ...inputStyle(T), fontFamily: 'inherit', fontSize: 13 }} aria-label="Update" />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 2fr auto', gap: 6, marginTop: 6 }}>
        <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={inputStyle(T)} aria-label="Update type">{Object.entries(UPDATE_KINDS).filter(([k]) => k !== 'sign_off').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" value={draft.update_date} onChange={e => setDraft(d => ({ ...d, update_date: e.target.value }))} style={inputStyle(T)} aria-label="Date" />
        <input value={draft.next_action} onChange={e => setDraft(d => ({ ...d, next_action: e.target.value }))} placeholder="Next action (optional)" style={inputStyle(T)} aria-label="Next action" />
        <button onClick={add} disabled={!draft.body.trim()} style={{ ...btn(T, 'gold'), opacity: draft.body.trim() ? 1 : 0.5 }}>Post</button>
      </div>
    </div>}
    {items.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>No updates yet.</div>}
    {items.map(u => <div key={u.id} style={{ padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{fmtDate(u.update_date)} · {UPDATE_KINDS[u.kind] || 'Note'}{u.author_name ? ` · ${u.author_name}` : ''}{!stage && u.stage_id && ws.stageName ? ` · ${ws.stageName(u.stage_id)}` : ''}</span>
        {canEdit && <button onClick={() => ops.removeUpdate(u)} style={{ background: 'none', border: 'none', color: T.faint, cursor: 'pointer', fontSize: 11 }} aria-label="Delete update">✕</button>}
      </div>
      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 3 }}>{u.body}</div>
      {u.next_action && <div style={{ fontFamily: mono, fontSize: 10.5, color: T.gold, marginTop: 3 }}>Next: {u.next_action}</div>}
    </div>)}
  </div>
}

const FIELD_LABELS = {
  name: 'name', status: 'status', status_label: 'status label', progress_pct: 'progress', weight: 'weight', scope: 'scope',
  planned_start: 'planned start', planned_end: 'planned finish', forecast_start: 'forecast start', forecast_end: 'forecast finish',
  actual_start: 'actual start', actual_end: 'actual finish', responsible_name: 'responsible person', contractor_name: 'contractor',
  next_action: 'next action', blockers: 'blockers', decisions: 'decisions', notes: 'notes', sort_order: 'position', archived_at: 'archived',
  target_end_date: 'forecast completion', original_end_date: 'original planned completion', stage: 'overall status', agreed_price: 'agreed budget',
  forecast_cost_override: 'forecast final cost override', project_type: 'project type', project_manager_name: 'project manager',
  completed_date: 'actual completion', start_date: 'planned start', archived: 'archive',
}

export function HistoryRow({ e, T }) {
  const what = e.field ? FIELD_LABELS[e.field] || e.field.replace(/_/g, ' ') : null
  const fmtV = v => v == null || v === '' ? 'blank' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : v.length > 60 ? v.slice(0, 57) + '…' : v
  const text = {
    created: `Added ${e.entity === 'stage' ? 'stage' : e.entity}${e.new_value ? ` "${e.new_value}"` : ''}`,
    updated: what ? `Changed ${what} from ${fmtV(e.old_value)} to ${fmtV(e.new_value)}` : 'Updated',
    archived: `Archived ${e.entity}${e.old_value ? ` "${e.old_value}"` : ''}`,
    restored: `Restored ${e.entity}${e.new_value ? ` "${e.new_value}"` : ''}`,
    removed: `Removed ${e.entity}${e.old_value ? ` "${e.old_value}"` : ''}`,
    signed_off: 'Signed off',
    sign_off_withdrawn: 'Sign-off withdrawn',
    template_applied: `Journey started from the ${e.new_value} template`,
    dates_cascaded: `Moved by a dependency: ${what || 'dates'} ${fmtV(e.old_value)} → ${fmtV(e.new_value)}`,
    reordered: 'Moved in the journey',
  }[e.action] || `${e.action.replace(/_/g, ' ')}${what ? ` ${what}` : ''}`
  return <div style={{ padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
    <div style={{ fontSize: 12.5 }}>{text}</div>
    {e.reason && <div style={{ fontSize: 12, color: T.amber, marginTop: 2 }}>Reason: {e.reason}</div>}
    <div style={{ fontFamily: mono, fontSize: 9.5, color: T.faint }}>{fmtWhen(e.created_at)}{e.actor_name ? ` · ${e.actor_name}` : ''}</div>
  </div>
}

