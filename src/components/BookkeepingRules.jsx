import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { fmt } from '../lib/format'
import { showAppToast } from '../lib/toast'
import { useConfirm } from '../lib/ConfirmContext'
import {
  BOOKKEEPING_CATEGORIES,
  listRules, createRule, updateRule, deleteRule,
  runCategorisation, acceptSuggestion, rejectSuggestion,
} from '../lib/api/bookkeeping'

// AI bookkeeping — manage categorisation rules and review AI category
// suggestions for a company's bank transactions.
//
// Two panels:
//   • Rules — deterministic, user-authored. Applied server-side first.
//   • Review — AI DRAFT suggestions for whatever the rules didn't catch.
//     Accept persists the category; reject discards it. Nothing the AI
//     proposes is written without an explicit accept.

const FIELD_OPTIONS = [
  { value: 'description', label: 'Description' },
  { value: 'counterparty', label: 'Counterparty' },
]

function catLabel(c) {
  return (c || 'other').replace(/_/g, ' ')
}

export default function BookkeepingRules({ companyId, properties = [] }) {
  const { T } = useTheme()
  const confirm = useConfirm()
  const mono = MONO

  const [rules, setRules]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [running, setRunning]     = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [appliedCount, setAppliedCount] = useState(null)
  const [aiAvailable, setAiAvailable] = useState(true)

  // New-rule draft
  const [nField, setNField]     = useState('description')
  const [nPattern, setNPattern] = useState('')
  const [nCat, setNCat]         = useState('maintenance')
  const [nProp, setNProp]       = useState('')
  const [nPriority, setNPriority] = useState(100)
  const [saving, setSaving]     = useState(false)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    try {
      setRules(await listRules(companyId))
    } catch (e) {
      showAppToast(e.message || 'Failed to load rules', 'error')
    }
    setLoading(false)
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [companyId])

  async function addRule(e) {
    e?.preventDefault?.()
    if (!nPattern.trim()) { showAppToast('Enter a pattern to match', 'error'); return }
    setSaving(true)
    try {
      await createRule({
        companyId,
        matchField: nField,
        matchPattern: nPattern.trim(),
        setCategory: nCat,
        setPropertyId: nProp || null,
        priority: Number(nPriority) || 100,
      })
      setNPattern('')
      showAppToast('Rule added')
      reload()
    } catch (e) {
      showAppToast(e.message || 'Could not save rule', 'error')
    }
    setSaving(false)
  }

  async function toggleActive(r) {
    try {
      await updateRule(r.id, { active: !r.active })
      setRules(rs => rs.map(x => x.id === r.id ? { ...x, active: !x.active } : x))
    } catch (e) {
      showAppToast(e.message || 'Could not update rule', 'error')
    }
  }

  async function removeRule(r) {
    const ok = await confirm({
      title: 'Delete rule?',
      body: `Remove the rule matching "${r.match_pattern}"?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteRule(r.id)
      setRules(rs => rs.filter(x => x.id !== r.id))
      showAppToast('Rule deleted')
    } catch (e) {
      showAppToast(e.message || 'Could not delete rule', 'error')
    }
  }

  async function runAI() {
    setRunning(true)
    try {
      const res = await runCategorisation(companyId, { limit: 50 })
      setAppliedCount((res.applied || []).length)
      setSuggestions(res.suggestions || [])
      setAiAvailable(res.ai_available !== false)
      if (res.note) showAppToast(res.note)
      else showAppToast(`${(res.applied || []).length} categorised by rules · ${(res.suggestions || []).length} AI drafts`)
    } catch (e) {
      showAppToast(e.message || 'Categorisation failed', 'error')
    }
    setRunning(false)
  }

  async function accept(s) {
    try {
      await acceptSuggestion(s.id, s.category, s.confidence)
      setSuggestions(list => list.filter(x => x.id !== s.id))
      showAppToast(`Accepted: ${catLabel(s.category)}`)
    } catch (e) {
      showAppToast(e.message || 'Could not accept', 'error')
    }
  }

  async function reject(s) {
    await rejectSuggestion(s.id)
    setSuggestions(list => list.filter(x => x.id !== s.id))
  }

  const propName = useMemo(() => {
    const m = {}
    for (const p of properties) m[p.id] = p.address || p.name || p.id
    return m
  }, [properties])

  const labelStyle = { fontFamily: mono, fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }
  const inputStyle = { fontFamily: mono, fontSize: 13, padding: '8px 10px', background: T.inputBg || T.cardBg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6 }

  return (
    <div style={{ fontFamily: mono, color: T.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: mono }}>AI bookkeeping</h3>
          <p style={{ ...labelStyle, textTransform: 'none', letterSpacing: 0, marginTop: 4 }}>
            Auto-categorise bank transactions with rules, then let AI draft the rest.
          </p>
        </div>
        <button className="btn btn-gold" disabled={running || !companyId} onClick={runAI} style={{ fontSize: 12 }}>
          {running ? 'Categorising…' : 'Run categorisation'}
        </button>
      </div>

      {appliedCount != null && (
        <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 12 }}>
          {appliedCount} transaction{appliedCount === 1 ? '' : 's'} categorised by your rules.
          {!aiAvailable && ' AI suggestions are off until ANTHROPIC_API_KEY is configured.'}
        </div>
      )}

      {/* ── AI suggestions review ─────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>AI suggestions — review before accepting</div>
          <p style={{ ...labelStyle, textTransform: 'none', letterSpacing: 0, color: T.textFaint, margin: '4px 0 12px' }}>
            AI-generated drafts. Categories are not saved until you accept them.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map(s => (
              <div key={s.id} className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{fmt(s.amount)}</strong> · {s.counterparty || s.description || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                    {s.description}
                  </div>
                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>
                    Suggested: <strong style={{ color: T.text }}>{catLabel(s.category)}</strong>
                    {' · '}confidence {Math.round((s.confidence || 0) * 100)}%
                    {s.reason ? ` · ${s.reason}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={() => accept(s)}>Accept</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => reject(s)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── New rule ─────────────────────────────────────────────── */}
      <form onSubmit={addRule} className="card" style={{ padding: 16, marginBottom: 20, display: 'grid', gap: 12 }}>
        <div style={labelStyle}>Add a rule</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>When</span>
            <select value={nField} onChange={e => setNField(e.target.value)} style={inputStyle}>
              {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Contains</span>
            <input value={nPattern} onChange={e => setNPattern(e.target.value)} placeholder="e.g. BRITISH GAS" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Set category</span>
            <select value={nCat} onChange={e => setNCat(e.target.value)} style={inputStyle}>
              {BOOKKEEPING_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Property (optional)</span>
            <select value={nProp} onChange={e => setNProp(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.address || p.name || p.id}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Priority</span>
            <input type="number" value={nPriority} onChange={e => setNPriority(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div>
          <button type="submit" className="btn btn-gold" disabled={saving} style={{ fontSize: 12 }}>
            {saving ? 'Saving…' : 'Add rule'}
          </button>
        </div>
      </form>

      {/* ── Existing rules ───────────────────────────────────────── */}
      <div style={labelStyle}>Rules {rules.length ? `(${rules.length})` : ''}</div>
      {loading ? (
        <p style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>Loading…</p>
      ) : rules.length === 0 ? (
        <p style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>No rules yet. Add one above — lower priority numbers run first.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {rules.map(r => (
            <div key={r.id} className="card" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, opacity: r.active ? 1 : 0.5 }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: T.textMuted }}>#{r.priority}</span>{' '}
                {r.match_field} contains <strong>"{r.match_pattern}"</strong> → <strong>{catLabel(r.set_category)}</strong>
                {r.set_property_id ? <span style={{ color: T.textFaint }}>{' · '}{propName[r.set_property_id] || 'property'}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => toggleActive(r)}>
                  {r.active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => removeRule(r)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
