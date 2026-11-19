// Deals brief §6 screens: the "Costs & funding" tab on a deal, and the
// company funding dashboard on the Deals landing page. All maths is in
// src/lib/dealFinance.js; this file only loads, edits and shows it.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import * as api from '../lib/api'
import MoneyInput from '../lib/MoneyInput'
import CalcExplain from './CalcExplain'
import ActionMenu from './ActionMenu'
import { runDealExport } from '../lib/dealExportRun'
import { Button } from './ui'
import { pressable } from '../lib/pressable'
import { isoToday } from '../lib/rentEngine'
import {
  COST_CATEGORIES, COST_STATES, COST_STATE_LABEL, FUNDING_SOURCES, FUNDING_STATES,
  completionPosition, refurbPosition, dealCashNeed, explainDeal, companyFunding,
  isLiveDeal, gbp, dateGB, addDays,
} from '../lib/dealFinance'

const mono = MONO

function stateColor(T, state) {
  if (state === 'paid' || state === 'actual' || state === 'received') return T.green
  if (state === 'confirmed') return T.blue
  if (state === 'quoted') return T.purple || T.blue
  return T.amber
}

export function StateBadge({ state, T }) {
  if (!state) return null
  const c = stateColor(T, state)
  const label = COST_STATE_LABEL[state] || (state.charAt(0).toUpperCase() + state.slice(1))
  return (
    <span style={{fontFamily:SANS,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:c+'22',color:c,whiteSpace:'nowrap'}}>{label}</span>
  )
}

const eyebrow = T => ({ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' })
const fieldStyle = T => ({ fontFamily:SANS, fontSize:FS.sm, background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'7px 10px', boxSizing:'border-box', minWidth:0 })

// ── COSTS & FUNDING TAB ─────────────────────────────────────────────────────

const COST_COLUMNS = {
  select: [
    { field: 'category', label: 'Category', options: COST_CATEGORIES, flex: '1 1 170px' },
    { field: 'state', label: 'State', options: COST_STATES, flex: '0 1 120px' },
  ],
  text: [
    { field: 'label', label: 'Label', flex: '2 1 160px', max: 200, placeholder: 'e.g. Completion statement' },
    { field: 'source', label: 'Source', flex: '1 1 140px', max: 300, placeholder: 'e.g. Solicitor quote 12 Nov' },
  ],
  date: { field: 'due_date', label: 'Due' },
}
const FUNDING_COLUMNS = {
  select: [
    { field: 'source', label: 'Source', options: FUNDING_SOURCES, flex: '1 1 150px' },
    { field: 'state', label: 'State', options: FUNDING_STATES, flex: '0 1 120px' },
  ],
  text: [
    { field: 'label', label: 'Label', flex: '2 1 160px', max: 200, placeholder: 'e.g. 75% BTL mortgage' },
    { field: 'notes', label: 'Notes', flex: '1 1 140px', max: 1000, placeholder: '' },
  ],
  date: { field: 'expected_date', label: 'Expected' },
}

// One editable row. Text, amount and date save on blur; selects save on change.
function EditableRow({ row, columns, onSave, onDelete, T }) {
  const [draft, setDraft] = useState(row)
  const f = fieldStyle(T)
  const save = (next = draft) => {
    const changed = Object.keys(next).some(k => next[k] !== row[k])
    if (changed) onSave(next)
  }
  const set = (field, value) => setDraft(prev => ({ ...prev, [field]: value }))
  const setAndSave = (field, value) => { const next = { ...draft, [field]: value }; setDraft(next); save(next) }
  const label = text => <span style={{...eyebrow(T),display:'block',marginBottom:3,fontSize:10}}>{text}</span>
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-end',padding:'10px 12px',background:T.bg,borderRadius:8,borderLeft:`3px solid ${stateColor(T, draft.state)}`}}>
      <label style={{flex:columns.select[0].flex,minWidth:0}}>
        {label(columns.select[0].label)}
        <select value={draft[columns.select[0].field] || ''} onChange={e=>setAndSave(columns.select[0].field, e.target.value)} style={{...f,width:'100%'}}>
          {columns.select[0].options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label style={{flex:columns.text[0].flex,minWidth:0}}>
        {label(columns.text[0].label)}
        <input value={draft[columns.text[0].field] || ''} maxLength={columns.text[0].max} placeholder={columns.text[0].placeholder}
          onChange={e=>set(columns.text[0].field, e.target.value)} onBlur={()=>save()} style={{...f,width:'100%'}}/>
      </label>
      <label style={{flex:'1 1 120px',minWidth:0}}>
        {label('Amount')}
        <MoneyInput value={draft.amount} prefix="£" min={0} onChange={v=>set('amount', v)} onBlur={()=>save()}
          aria-label="Amount" style={{...f,width:'100%',fontFamily:mono}}/>
      </label>
      <label style={{flex:columns.select[1].flex,minWidth:0}}>
        {label(columns.select[1].label)}
        <select value={draft.state || ''} onChange={e=>setAndSave('state', e.target.value)} style={{...f,width:'100%'}}>
          {columns.select[1].options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label style={{flex:'0 1 150px',minWidth:0}}>
        {label(columns.date.label)}
        <input type="date" value={draft[columns.date.field] || ''} onChange={e=>set(columns.date.field, e.target.value || null)} onBlur={()=>save()}
          style={{...f,width:'100%'}}/>
      </label>
      <label style={{flex:columns.text[1].flex,minWidth:0}}>
        {label(columns.text[1].label)}
        <input value={draft[columns.text[1].field] || ''} maxLength={columns.text[1].max} placeholder={columns.text[1].placeholder}
          onChange={e=>set(columns.text[1].field, e.target.value)} onBlur={()=>save()} style={{...f,width:'100%'}}/>
      </label>
      <Button variant="ghost" size="sm" destructive icon="trash" aria-label="Delete row" onClick={()=>onDelete(row)}/>
    </div>
  )
}

function SummaryFigure({ label, value, sub, color, T, extra }) {
  return (
    <div style={{minWidth:0}}>
      <div style={{...eyebrow(T),marginBottom:4,display:'flex',alignItems:'center'}}>{label}{extra}</div>
      <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:color||T.text,letterSpacing:'-0.02em'}}>{value}</div>
      {sub && <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginTop:2}}>{sub}</div>}
    </div>
  )
}

/**
 * Costs & funding for one deal. `deal` is the live edit form, so the
 * estimate fallback follows unsaved calculator edits. It never writes the
 * deal itself, so the main form's auto-save is untouched.
 */
export function CostsFundingTab({ deal, showToast, refurbProject = null, group = null, onOpenDeal }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [lines, setLines] = useState(null)
  const [funding, setFunding] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [showExplain, setShowExplain] = useState(false)
  const dealId = deal?.id

  useEffect(() => {
    if (!dealId) return
    let live = true
    Promise.all([api.fetchDealCostLines(dealId), api.fetchDealFunding(dealId)])
      .then(([l, f]) => { if (live) { setLines(l); setFunding(f); setLoadError(null) } })
      .catch(e => { if (live) setLoadError(e.message || 'Could not load costs and funding') })
    return () => { live = false }
  }, [dealId])

  const position = useMemo(() => completionPosition(deal, lines || []), [deal, lines])
  const cash = useMemo(() => dealCashNeed(deal, lines || [], funding || []), [deal, lines, funding])
  const refurb = useMemo(() => refurbPosition(deal, lines || [], refurbProject), [deal, lines, refurbProject])
  const explain = useMemo(() => explainDeal(deal, lines || [], funding || [], refurbProject), [deal, lines, funding, refurbProject])

  async function save(kind, row) {
    const setRows = kind === 'cost' ? setLines : setFunding
    const upsert = kind === 'cost' ? api.upsertDealCostLine : api.upsertDealFunding
    try {
      const saved = await upsert(dealId, { ...row, amount: row.amount == null ? 0 : row.amount })
      setRows(prev => row.id ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved])
    } catch (e) { showToast(e.message || 'Could not save', 'error') }
  }
  async function remove(kind, row) {
    if (!await confirmDialog({ title: kind === 'cost' ? 'Delete this cost line?' : 'Delete this funding row?', body: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) return
    try {
      if (kind === 'cost') { await api.deleteDealCostLine(row.id); setLines(prev => prev.filter(r => r.id !== row.id)) }
      else { await api.deleteDealFunding(row.id); setFunding(prev => prev.filter(r => r.id !== row.id)) }
    } catch (e) { showToast(e.message || 'Could not delete', 'error') }
  }

  const card = { background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 22px' }
  if (loadError) return <div style={{...card,fontFamily:mono,fontSize:12,color:T.red}}>Couldn't load costs and funding: {loadError}</div>
  if (!lines || !funding) return <div style={{...card,fontFamily:SANS,fontSize:FS.sm,color:T.muted}}>Loading costs and funding…</div>

  const isEstimate = position.basis === 'estimate'
  return (
    <div style={{display:'grid',gap:16}}>
      {/* Summary */}
      <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:14}}>
          <div style={{...eyebrow(T),color:T.goldText,fontWeight:700}}>Completion cash</div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <StateBadge state={position.state} T={T}/>
            {isEstimate && <span style={{fontFamily:SANS,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.amber+'22',color:T.amber}}>Estimate from deal fields</span>}
          </div>
        </div>
        {isEstimate && position.missing.length > 0 && (
          <div role="note" style={{fontFamily:SANS,fontSize:FS.sm,color:T.amber,background:T.amber+'14',border:`1px solid ${T.amber}44`,borderRadius:8,padding:'8px 12px',marginBottom:14}}>
            {position.missing.join(' · ')}. Add the completion statement below to replace the estimate.
          </div>
        )}
        {group?.parent && (
          <div role="note" style={{fontFamily:SANS,fontSize:FS.sm,color:T.text,background:T.blue+'14',border:`1px solid ${T.blue}44`,borderRadius:8,padding:'8px 12px',marginBottom:14}}>
            Unit of the group purchase{' '}
            <button type="button" onClick={()=>onOpenDeal && onOpenDeal(group.parent)}
              style={{fontFamily:SANS,fontSize:FS.sm,fontWeight:700,color:T.goldText,background:'none',border:'none',padding:0,cursor:onOpenDeal?'pointer':'default'}}>
              {group.parent.name || group.parent.address || 'Untitled deal'}
            </button>. The parent carries the cash commitment: the figures below are this unit's allocation and are not added again to company cash need, the funding gap or export totals.
          </div>
        )}
        {group?.units?.length > 0 && (
          <div role="note" style={{fontFamily:SANS,fontSize:FS.sm,color:T.text,background:T.blue+'14',border:`1px solid ${T.blue}44`,borderRadius:8,padding:'8px 12px',marginBottom:14}}>
            Group purchase covering {group.units.length} unit{group.units.length === 1 ? '' : 's'}. This deal carries the cash commitment for the whole acquisition; enter the purchase cost lines and funding here.
          </div>
        )}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:16}}>
          <SummaryFigure T={T} label="Completion total" value={gbp(position.total)} sub={isEstimate ? 'Estimate' : `${lines.filter(l=>!['on_account','deposit_paid','refurb','contingency','other'].includes(l.category)).length} lines`}/>
          <SummaryFigure T={T} label="Credits" value={gbp(position.credits)} sub="On account + deposit paid"/>
          <SummaryFigure T={T} label="Balance due" value={gbp(position.balanceDue)} color={T.goldText}
            sub={position.balanceDue == null ? 'Unknown' : (COST_STATE_LABEL[position.state] || position.state)}
            extra={<CalcExplain title="balance due" formula="Completion total − credits"
              inputs={[{ label: 'Completion total', value: gbp(position.total) }, { label: 'Credits', value: gbp(position.credits) }]}
              result={gbp(position.balanceDue)}
              note={isEstimate ? 'No completion statement: estimated from purchase price, SDLT and the fees on the calculator (refurb excluded).' : 'From the cost lines below; refurb, contingency and other lines are excluded.'}/>}/>
          <SummaryFigure T={T} label="Confirmed financing" value={gbp(cash.financingConfirmed)}
            sub={cash.financingExpected > 0 ? `${gbp(cash.financingExpected)} expected, not deducted` : 'Confirmed or received'}/>
          <SummaryFigure T={T} label="Cash from company" value={gbp(cash.need)} color={cash.need > 0 ? T.red : T.text}
            sub={cash.dueDate ? `By ${dateGB(cash.dueDate)}` : 'Unscheduled'}
            extra={<CalcExplain title="cash from company" formula="max(0, balance due − confirmed financing)"
              inputs={[{ label: 'Balance due', value: gbp(position.balanceDue) }, { label: 'Confirmed financing', value: gbp(cash.financingConfirmed) }]}
              result={gbp(cash.need)} note="Expected financing is not deducted until it is confirmed. Company cash rows are not financing."/>}/>
          <SummaryFigure T={T} label="Refurb forecast" value={refurb.amount == null ? 'Not entered' : gbp(refurb.amount)}
            sub={refurb.amount == null ? 'Separate from completion'
              : refurb.basis === 'project' ? `From ${refurb.source} · ${gbp(refurb.paid)} paid · ${gbp(refurb.outstanding)} outstanding`
              : `Separate · ${refurb.basis === 'estimate' ? 'deal estimate' : COST_STATE_LABEL[refurb.state]}`}/>
        </div>
        <div style={{marginTop:14}}>
          <button type="button" onClick={()=>setShowExplain(v=>!v)} aria-expanded={showExplain}
            style={{fontFamily:SANS,fontSize:FS.sm,color:T.goldText,background:'none',border:'none',padding:0,cursor:'pointer',fontWeight:700}}>
            {showExplain ? '▾' : '▸'} How calculated?
          </button>
          {showExplain && (
            <ul style={{margin:'8px 0 0',paddingLeft:18,display:'grid',gap:4}}>
              {explain.map((t, i) => <li key={i} style={{fontFamily:mono,fontSize:11,color:T.text,lineHeight:1.5}}>{t}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* Cost lines */}
      <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div>
            <div style={{...eyebrow(T),color:T.goldText,fontWeight:700}}>Cost lines</div>
            <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginTop:2}}>From the completion statement and quotes. Paid on account and deposit paid are credits.</div>
          </div>
          <Button variant="secondary" size="sm" icon="plus" onClick={()=>save('cost', { category: lines.length ? 'other_purchase' : 'purchase_price', amount: 0, state: 'estimate' })}>Add cost line</Button>
        </div>
        {lines.length === 0
          ? <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,fontStyle:'italic'}}>No cost lines yet. The figures above are estimated from the calculator.</div>
          : <div style={{display:'grid',gap:8}}>
              {lines.map(l => <EditableRow key={l.id} row={l} columns={COST_COLUMNS} T={T} onSave={r=>save('cost', r)} onDelete={r=>remove('cost', r)}/>)}
            </div>}
      </div>

      {/* Funding */}
      <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div>
            <div style={{...eyebrow(T),color:T.goldText,fontWeight:700}}>Funding</div>
            <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,marginTop:2}}>Only confirmed or received financing reduces the cash the company must find.</div>
          </div>
          <Button variant="secondary" size="sm" icon="plus" onClick={()=>save('funding', { source: 'mortgage', amount: 0, state: 'expected' })}>Add funding</Button>
        </div>
        {funding.length === 0
          ? <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,fontStyle:'italic'}}>No funding recorded. All of the balance due is treated as company cash.</div>
          : <div style={{display:'grid',gap:8}}>
              {funding.map(f => <EditableRow key={f.id} row={f} columns={FUNDING_COLUMNS} T={T} onSave={r=>save('funding', r)} onDelete={r=>remove('funding', r)}/>)}
            </div>}
      </div>
    </div>
  )
}

// ── EXPORT MENU ─────────────────────────────────────────────────────────────

/**
 * "Export" menu: PDF, Excel workbook, deals CSV and cost lines CSV for the deals given
 * (Deals brief §10). Lines, funding and cash are fetched once per export,
 * for exactly these deals, and every figure comes from lib/dealFinance.
 */
export function DealExportMenu({ deals = [], companies = [], filters = {}, title, scopeLabel = 'deals', showToast, align = 'right', refurbProjects = null }) {
  const [busy, setBusy] = useState(false)
  async function run(kind) {
    if (busy) return
    if (!deals.length) { showToast && showToast('No deals to export with these filters', 'error'); return }
    setBusy(true)
    try {
      const res = await runDealExport(kind, { deals, companies, filters, title, refurbProjects })
      const what = kind === 'pdf' ? `PDF downloaded (${res.pages} page${res.pages === 1 ? '' : 's'})`
        : kind === 'xlsx' ? `Excel workbook downloaded (${res.sheets} sheets)` : kind === 'lines' ? 'Cost lines CSV downloaded' : 'Deals CSV downloaded'
      showToast && showToast(`${what}: ${res.deals} deal${res.deals === 1 ? '' : 's'}`)
    } catch (e) { showToast && showToast('Could not export: ' + (e.message || 'unknown error'), 'error') }
    setBusy(false)
  }
  return (
    <ActionMenu triggerLabel={busy ? 'Exporting…' : 'Export'} triggerIcon="download" disabled={busy} align={align}
      buttonLabel={`Export ${scopeLabel}`} items={[
        { label: 'PDF: funding summary', icon: 'file-text', onSelect: () => run('pdf') },
        { label: 'Excel (.xlsx): workbook', icon: 'download', onSelect: () => run('xlsx') },
        { label: 'CSV: one row per deal', icon: 'download', onSelect: () => run('csv') },
        { label: 'CSV: itemised cost lines', icon: 'download', onSelect: () => run('lines') },
      ]}/>
  )
}

// ── COMPANY FUNDING DASHBOARD ───────────────────────────────────────────────

/**
 * Company cards above the deals list, and the funding panel for the
 * selected company. Lines, funding and cash are loaded once for the live
 * deals shown; cards never fetch on their own.
 */
export function CompanyFundingDashboard({ deals = [], companies = [], coFilter, setCoFilter, onOpenDeal, user, showToast, refurbProjects = null }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const liveDeals = useMemo(() => deals.filter(isLiveDeal), [deals])
  const dealKey = useMemo(() => liveDeals.map(d => d.id).sort().join(','), [liveDeals])
  const companyKey = useMemo(() => companies.map(c => c.id).sort().join(','), [companies])
  const [data, setData] = useState({ linesByDeal: {}, fundingByDeal: {}, loaded: false })
  const [cashRows, setCashRows] = useState([])
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let live = true
    const ids = dealKey ? dealKey.split(',') : []
    Promise.all([api.fetchCostLinesForDeals(ids), api.fetchFundingForDeals(ids)])
      .then(([linesByDeal, fundingByDeal]) => { if (live) { setData({ linesByDeal, fundingByDeal, loaded: true }); setLoadError(null) } })
      .catch(e => { if (live) { setData(d => ({ ...d, loaded: true })); setLoadError(e.message || 'Could not load deal costs') } })
    return () => { live = false }
  }, [dealKey])

  const loadCash = useCallback(() => {
    const ids = companyKey ? companyKey.split(',') : []
    return api.fetchCompanyCashPositions(ids).then(setCashRows).catch(e => setLoadError(e.message || 'Could not load cash positions'))
  }, [companyKey])
  useEffect(() => { loadCash() }, [loadCash])

  const today = isoToday()
  const in30 = addDays(today, 30)
  // Rows are newest first, so the first per company is the current position.
  const cashByCompany = useMemo(() => {
    const out = {}
    for (const r of cashRows) (out[r.company_id] || (out[r.company_id] = [])).push(r)
    return out
  }, [cashRows])

  const hasUnassigned = deals.some(d => !d.company_id)
  const groups = useMemo(() => {
    const list = companies.map(c => ({ id: c.id, name: c.name, abbr: c.abbr, color: c.color }))
    if (hasUnassigned) list.push({ id: '', name: 'Unassigned', abbr: 'Unassigned', color: null, unassigned: true })
    return list
  }, [companies, hasUnassigned])

  const summaries = useMemo(() => {
    const out = {}
    for (const g of groups) {
      const gDeals = deals.filter(d => g.unassigned ? !d.company_id : d.company_id === g.id)
      const cashPosition = g.unassigned ? null : (cashByCompany[g.id] || [])[0] || null
      const args = { deals: gDeals, linesByDeal: data.linesByDeal, fundingByDeal: data.fundingByDeal, cashPosition, from: today, refurbProjects }
      out[g.id] = { next30: companyFunding({ ...args, to: in30 }), all: companyFunding(args) }
    }
    return out
  }, [groups, deals, data, cashByCompany, today, in30, refurbProjects])

  if (!groups.length || !deals.length) return null
  const selected = coFilter !== 'all' ? groups.find(g => g.id === coFilter) : null

  return (
    <div style={{marginBottom:20}}>
      {loadError && <div style={{fontFamily:mono,fontSize:FS.xs,color:T.red,marginBottom:8}}>{loadError}</div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(100%,220px),1fr))',gap:12}}>
        {groups.map(g => {
          const s = summaries[g.id]
          const f = s.next30
          const isSel = coFilter === g.id
          const accent = g.color || T.gold
          return (
            <div key={g.id || 'unassigned'} className="card" aria-pressed={isSel}
              {...pressable(()=>setCoFilter(isSel ? 'all' : g.id))}
              style={{padding:'14px 16px',cursor:'pointer',minWidth:0,borderTop:`3px solid ${accent}`,
                outline:isSel?`2px solid ${accent}`:'none',background:isSel?accent+'12':undefined}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:10}}>
                <span style={{fontFamily:SANS,fontSize:FS.body,fontWeight:700,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}</span>
                <span style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,whiteSpace:'nowrap'}}>{f.activeDeals} active</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 12px'}}>
                <CardFigure T={T} label="Due ≤30 days" value={data.loaded ? gbp(f.needInWindow) : '…'} note={f.unknownCount ? `+${f.unknownCount} unknown` : f.estimateCount ? 'incl. estimates' : null}/>
                <CardFigure T={T} label="Cash available" value={g.unassigned ? 'n/a' : f.cash ? gbp(f.cash.amount) : 'Not entered'}
                  note={f.cash ? `as of ${dateGB(f.cash.asOf)}` : null} muted={!f.cash}/>
                <CardFigure T={T} label="Gap ≤30 days" value={data.loaded ? gbp(f.fundingGap) : '…'} color={f.fundingGap > 0 ? T.red : T.green}/>
                <CardFigure T={T} label="Refurb forecast" value={data.loaded ? gbp(s.all.refurbForecast) : '…'}/>
              </div>
            </div>
          )
        })}
      </div>
      {selected && data.loaded && (
        <CompanyFundingPanel group={selected} funding={summaries[selected.id].all} companies={companies} refurbProjects={refurbProjects}
          positions={selected.unassigned ? [] : (cashByCompany[selected.id] || [])}
          onOpenDeal={onOpenDeal} user={user} showToast={showToast} confirmDialog={confirmDialog}
          onCashChanged={loadCash} deals={deals} T={T}/>
      )}
    </div>
  )
}

function CardFigure({ label, value, note, color, muted, T }) {
  return (
    <div style={{minWidth:0}}>
      <div style={{...eyebrow(T),fontSize:10}}>{label}</div>
      <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:muted?T.muted:(color||T.text),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{value}</div>
      {note && <div style={{fontFamily:SANS,fontSize:FS.xs,color:T.muted}}>{note}</div>}
    </div>
  )
}

function CompanyFundingPanel({ group, funding, positions, deals, companies, onOpenDeal, user, showToast, confirmDialog, onCashChanged, refurbProjects, T }) {
  const [form, setForm] = useState({ amount: null, as_of: isoToday(), note: '' })
  const [busy, setBusy] = useState(false)
  const rowsById = useMemo(() => Object.fromEntries(funding.rows.map(r => [r.dealId, r])), [funding.rows])
  const dealById = useMemo(() => Object.fromEntries(deals.map(d => [d.id, d])), [deals])
  // Every deal of this company (any stage), for the company exports.
  const companyDeals = useMemo(() => deals.filter(d => group.unassigned ? !d.company_id : d.company_id === group.id), [deals, group])

  async function addPosition(e) {
    e.preventDefault()
    if (form.amount == null || form.amount === '') { showToast('Enter the cash amount', 'error'); return }
    setBusy(true)
    try {
      await api.addCompanyCashPosition({ company_id: group.id, as_of: form.as_of || isoToday(), amount: form.amount, note: form.note.trim() || null }, user?.id)
      setForm({ amount: null, as_of: isoToday(), note: '' })
      await onCashChanged()
      showToast('Cash position recorded')
    } catch (err) { showToast(err.message || 'Could not record the cash position', 'error') }
    setBusy(false)
  }
  async function removePosition(p) {
    if (!await confirmDialog({ title: 'Delete this cash position?', body: `${gbp(p.amount)} as of ${dateGB(p.as_of)}. The previous position becomes current.`, confirmLabel: 'Delete', destructive: true })) return
    try { await api.deleteCompanyCashPosition(p.id, user?.id, group.id); await onCashChanged() }
    catch (err) { showToast(err.message || 'Could not delete', 'error') }
  }

  const card = { background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'18px 20px', marginTop:12 }
  const f = fieldStyle(T)
  const dealLink = id => {
    const r = rowsById[id]
    const d = dealById[id]
    return (
      <button key={id} type="button" onClick={()=>d && onOpenDeal && onOpenDeal(d)}
        title={r?.need == null ? (r?.missing || []).join('; ') : `${gbp(r.need)}${r.basis === 'estimate' ? ' (estimate)' : ''}`}
        style={{fontFamily:SANS,fontSize:FS.sm,color:T.goldText,background:'none',border:'none',padding:0,cursor:'pointer',textAlign:'left'}}>
        {r?.name || 'Deal'}{r?.need == null ? ' (unknown)' : r.basis === 'estimate' ? ' (est.)' : ''}{r?.units?.length ? ` · group of ${r.units.length}` : ''}
      </button>
    )
  }
  const row = { display:'grid', gridTemplateColumns:'minmax(110px,1fr) minmax(0,2fr) auto', gap:10, alignItems:'start', padding:'8px 10px', borderBottom:`1px solid ${T.border}` }

  return (
    <div style={card}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',flexWrap:'wrap',gap:8,marginBottom:12}}>
        <div style={{...eyebrow(T),color:T.goldText,fontWeight:700}}>{group.name}: funding schedule</div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <div style={{fontFamily:mono,fontSize:FS.sm,color:T.muted}}>
            All live deals: need {gbp(funding.needInWindow)} · gap <span style={{color:funding.fundingGap>0?T.red:T.green,fontWeight:700}}>{gbp(funding.fundingGap)}</span>
            {funding.refurbForecast > 0 && <> · with refurb {gbp(funding.combinedGap)}</>}
          </div>
          <DealExportMenu deals={companyDeals} companies={companies} title={group.name} scopeLabel={`${group.name} deals`} refurbProjects={refurbProjects}
            filters={{ companyId: group.unassigned ? '' : group.id, status: 'all' }} showToast={showToast}/>
        </div>
      </div>

      <div role="table" aria-label="Weekly funding schedule">
        <div role="row" style={{...row,...eyebrow(T),fontSize:10}}>
          <span role="columnheader">Week</span><span role="columnheader">Deals</span><span role="columnheader" style={{textAlign:'right'}}>Need</span>
        </div>
        {funding.weeks.length === 0 && funding.unscheduled.deals.length === 0 && (
          <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,padding:'8px 10px',fontStyle:'italic'}}>No live deals.</div>
        )}
        {funding.weeks.map(w => (
          <div role="row" key={w.week} style={{...row,background:w.overdue?T.red+'0d':'transparent'}}>
            <span role="cell" style={{fontFamily:mono,fontSize:11,color:w.overdue?T.red:T.text}}>
              w/c {dateGB(w.week)}{w.overdue && <div style={{fontSize:10}}>overdue</div>}
            </span>
            <span role="cell" style={{display:'flex',flexWrap:'wrap',gap:'2px 10px',minWidth:0}}>{w.deals.map(dealLink)}</span>
            <span role="cell" style={{textAlign:'right',fontFamily:mono,fontSize:12}}>
              <div style={{fontWeight:700,color:T.text}}>{gbp(w.need)}{w.unknownCount ? ` +${w.unknownCount}?` : ''}</div>
              <div style={{fontSize:10,color:w.shortfall>0?T.red:T.muted}}>to date {gbp(w.cumulative)}{w.shortfall > 0 ? ` · short ${gbp(w.shortfall)}` : ''}</div>
            </span>
          </div>
        ))}
        {funding.unscheduled.deals.length > 0 && (
          <div role="row" style={row}>
            <span role="cell" style={{fontFamily:mono,fontSize:11,color:T.amber}}>Unscheduled<div style={{fontSize:10,color:T.muted}}>no completion date</div></span>
            <span role="cell" style={{display:'flex',flexWrap:'wrap',gap:'2px 10px',minWidth:0}}>{funding.unscheduled.deals.map(dealLink)}</span>
            <span role="cell" style={{textAlign:'right',fontFamily:mono,fontSize:12,fontWeight:700,color:T.text}}>{gbp(funding.unscheduled.need)}{funding.unscheduled.unknownCount ? ` +${funding.unscheduled.unknownCount}?` : ''}</span>
          </div>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:16,marginTop:16}}>
        {!group.unassigned && (
          <div>
            <div style={{...eyebrow(T),marginBottom:8}}>Cash position</div>
            <form onSubmit={addPosition} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-end'}}>
              <label style={{flex:'1 1 120px',minWidth:0}}>
                <span style={{...eyebrow(T),fontSize:10,display:'block',marginBottom:3}}>Amount</span>
                <MoneyInput value={form.amount} prefix="£" onChange={v=>setForm(p=>({...p,amount:v}))} aria-label="Cash amount" style={{...f,width:'100%',fontFamily:mono}}/>
              </label>
              <label style={{flex:'0 1 150px',minWidth:0}}>
                <span style={{...eyebrow(T),fontSize:10,display:'block',marginBottom:3}}>As of</span>
                <input type="date" value={form.as_of} onChange={e=>setForm(p=>({...p,as_of:e.target.value}))} style={{...f,width:'100%'}}/>
              </label>
              <label style={{flex:'2 1 160px',minWidth:0}}>
                <span style={{...eyebrow(T),fontSize:10,display:'block',marginBottom:3}}>Note</span>
                <input value={form.note} maxLength={500} placeholder="e.g. Bank balance after VAT return" onChange={e=>setForm(p=>({...p,note:e.target.value}))} style={{...f,width:'100%'}}/>
              </label>
              <Button type="submit" size="sm" loading={busy} disabled={busy}>Record</Button>
            </form>
            <div style={{display:'grid',gap:4,marginTop:10}}>
              {positions.length === 0 && <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted,fontStyle:'italic'}}>No cash position entered. The gap assumes £0.</div>}
              {positions.slice(0, 5).map((p, i) => (
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,fontFamily:mono,fontSize:11,padding:'4px 0',borderBottom:`1px solid ${T.border}`}}>
                  <span style={{color:T.muted,minWidth:86}}>{dateGB(p.as_of)}</span>
                  <span style={{fontWeight:700,color:i===0?T.text:T.muted}}>{gbp(p.amount)}</span>
                  {i === 0 && <span style={{fontFamily:SANS,fontSize:FS.xs,color:T.green}}>current</span>}
                  <span style={{flex:1,minWidth:0,color:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:SANS}}>{p.note || ''}</span>
                  <Button variant="ghost" size="sm" destructive icon="trash" aria-label={`Delete cash position of ${dateGB(p.as_of)}`} onClick={()=>removePosition(p)}/>
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{...eyebrow(T),marginBottom:8}}>How calculated</div>
          <ul style={{margin:0,paddingLeft:18,display:'grid',gap:4}}>
            {funding.explain.map((t, i) => <li key={i} style={{fontFamily:mono,fontSize:11,color:T.text,lineHeight:1.5,overflowWrap:'anywhere'}}>{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
