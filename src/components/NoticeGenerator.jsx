import { useState, useMemo, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'
import FocusTrap from '../lib/FocusTrap'
import { Button } from './ui'
import { isFormDirty, safeOverlayClose } from '../lib/modalUtils'
import { useConfirm } from '../lib/ConfirmContext'
import {
  GROUNDS, groundById, groundLabel, periodLabel, JURISDICTION_NOTE,
  validateSection8, validateSection13, currentTenancyStart, ground8Threshold,
} from '../lib/possessionRules'

// ── NOTICE GENERATOR: SECTION 8 (FORM 3A) + SECTION 13 (FORM 4A) ─────────
//
// LEGAL: a drafting aid, not legal advice. From 1 May 2026 private landlords
// in England seek possession only under section 8 (Form 3A) and raise rent
// only under section 13 (Form 4A); section 21 is gone. The rules (grounds,
// notice periods, first-year and 52-week limits) live in possessionRules.js.
//
// Output is the content of the prescribed form, laid out to copy onto the
// current GOV.UK form, opened in a new tab for print / save as PDF. A draft
// row is logged in legal_notices so the tracker has a record.

const TYPES = {
  s8:  { label: 'Section 8 possession', form: 'Form 3A', sub: 'Grounds for possession' },
  s13: { label: 'Section 13 rent increase', form: 'Form 4A', sub: 'Once a year, 2 months’ notice' },
}

const PREFLIGHT_ITEMS = [
  { id: 'england', appliesTo: ['s8', 's13'],
    label: 'The property is in England and let on a private assured tenancy. (Wales, Scotland, Northern Ireland and social tenancies use different rules.)' },
  { id: 'form', appliesTo: ['s8', 's13'],
    label: 'I will copy this content onto the current prescribed form downloaded from GOV.UK and serve that form.' },
  { id: 'particulars', appliesTo: ['s8'],
    label: 'I have detailed particulars for each ground: dates, amounts and specific events.' },
  { id: 'evidence', appliesTo: ['s8'],
    label: 'I hold evidence for each ground (rent statement for arrears grounds, court order or conviction for Ground 7A, Home Office notice for Ground 7B, and so on).' },
  { id: 'registration', appliesTo: ['s8'],
    label: 'I have checked my Private Rented Sector Database and landlord ombudsman obligations, which can stop a possession claim if not met.' },
  { id: 'solicitor', appliesTo: ['s8'],
    label: 'I will have this notice reviewed by a housing solicitor or landlord-association adviser before serving.' },
  { id: 's13only', appliesTo: ['s13'],
    label: 'I am raising the rent with a section 13 notice. Rent review clauses in tenancy agreements no longer apply from 1 May 2026.' },
  { id: 'market', appliesTo: ['s13'],
    label: 'The new rent is no more than the open-market rent for a similar property. The tenant can ask the First-tier Tribunal to decide.' },
]

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDateLong(iso) {
  if (!iso) return '________________'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const money = (n) => (Number(n) > 0 ? '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '£________')

function activeTenancy(property) {
  const ts = Array.isArray(property?.tenancies) ? property.tenancies : []
  return ts.find(t => !t.status || t.status === 'active') || null
}

export default function NoticeGenerator({ property, userId, onClose, showToast, initialType = 's8', lastIncreaseDate = '' }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const mono = MONO
  // Drafts are per property and type, restored on reopen, cleared once the
  // notice is logged. v2: section 21 drafts from before the reform are dropped.
  const draftKey = `ownproperly_notice_draft_v2_${property?.id || 'unknown'}_${initialType}`
  const draft = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(draftKey) || 'null') } catch { return null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const type = TYPES[initialType] ? initialType : 's8'
  const meta = TYPES[type]
  const [step, setStep] = useState(draft?.step || 'disclaimer')
  const [checklist, setChecklist] = useState(draft?.checklist || {})  // { itemId: 'yes' | 'na' }

  const tenancy = activeTenancy(property)
  const [form, setForm] = useState(draft?.form || {
    landlord_name:    '',
    landlord_address: '',
    tenant_names:     tenancy?.tenant_name || property?.tenant_name || '',
    property_address: property?.address || '',
    date_served:      todayISO(),
    tenancy_start:    currentTenancyStart(property),
    // Section 8
    expiry_manual:    false,
    expiry_date:      '',
    grounds:          [],
    grounds_details:  '',
    arrears:          '',
    // Shared rent facts
    rent_amount:      tenancy?.rent_amount ?? property?.rent_pcm ?? '',
    rent_frequency:   tenancy?.rent_frequency || 'monthly',
    rent_due_day:     tenancy?.rent_due_day ?? property?.rent_due_day ?? '',
    // Section 13
    last_increase_date: lastIncreaseDate || '',
    proposed_rent:    '',
    start_manual:     false,
    start_date:       '',
  })

  useEffect(() => {
    if (step === 'disclaimer' && Object.keys(checklist).length === 0) return
    try { localStorage.setItem(draftKey, JSON.stringify({ step, checklist, form })) } catch { /* storage full/blocked — draft is best-effort */ }
  }, [step, checklist, form, draftKey])
  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }

  const [initialForm] = useState(form)
  const isDirty = step !== 'disclaimer' && (Object.keys(checklist).length > 0 || isFormDirty(initialForm, form))
  const overlayClose = safeOverlayClose(isDirty, onClose, confirmDiscard)
  const escapeClose  = () => overlayClose({ target: null, currentTarget: null })

  function update(patch) { setForm(f => ({ ...f, ...patch })) }
  function toggleGround(id) {
    setForm(f => ({ ...f, grounds: f.grounds.includes(id) ? f.grounds.filter(g => g !== id) : [...f.grounds, id] }))
  }

  const s8 = useMemo(() => {
    const base = validateSection8({
      dateServed: form.date_served, groundIds: form.grounds, tenancyStart: form.tenancy_start,
      arrears: form.arrears, rentAmount: form.rent_amount, frequency: form.rent_frequency,
    })
    const possessionDate = form.expiry_manual ? form.expiry_date : base.earliest
    const full = validateSection8({
      dateServed: form.date_served, possessionDate, groundIds: form.grounds, tenancyStart: form.tenancy_start,
      arrears: form.arrears, rentAmount: form.rent_amount, frequency: form.rent_frequency,
    })
    return { ...full, possessionDate }
  }, [form])

  const s13 = useMemo(() => {
    const base = validateSection13({
      dateServed: form.date_served, tenancyStart: form.tenancy_start, lastIncreaseDate: form.last_increase_date,
      currentRent: form.rent_amount, proposedRent: form.proposed_rent, rentDueDay: form.rent_due_day,
    })
    const startDate = form.start_manual ? form.start_date : base.earliest
    const full = validateSection13({
      dateServed: form.date_served, startDate, tenancyStart: form.tenancy_start, lastIncreaseDate: form.last_increase_date,
      currentRent: form.rent_amount, proposedRent: form.proposed_rent, rentDueDay: form.rent_due_day,
    })
    return { ...full, startDate }
  }, [form])

  const check = type === 's8' ? s8 : s13
  const partiesOk = form.landlord_name.trim() && form.tenant_names.trim() && form.property_address.trim()
  const isValid = !!partiesOk && check.errors.length === 0

  async function printAndLog() {
    const w = window.open('', '_blank', 'width=820,height=1100')
    if (!w) {
      showAppToast('Browser blocked the print window. Allow pop-ups and try again.', 'error')
      return
    }
    w.document.write(type === 's8'
      ? buildSection8HTML({ form, possessionDate: s8.possessionDate })
      : buildSection13HTML({ form, startDate: s13.startDate }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 250)

    try {
      await api.saveNotice(type === 's8' ? {
        property_id: property.id, user_id: userId, notice_type: 's8', status: 'draft',
        served_date: form.date_served, expiry_date: s8.possessionDate,
        grounds: form.grounds.map(g => `Ground ${g}`).join(', '),
        notes: 'Form 3A content prepared in the notice generator. Verify with a solicitor before serving.',
      } : {
        property_id: property.id, user_id: userId, notice_type: 's13', status: 'draft',
        served_date: form.date_served, expiry_date: s13.startDate, grounds: null,
        notes: `Form 4A: rent ${money(form.rent_amount)} to ${money(form.proposed_rent)} (${form.rent_frequency}) from ${s13.startDate}.`,
      })
      if (showToast) showToast('Draft notice logged')
      clearDraft()
    } catch {
      // Non-fatal — the printed document is the important part.
    }
  }

  const btnPrimary = (enabled) => ({ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '10px 18px', borderRadius: 8, border: 'none', background: enabled ? T.gold : T.border, color: enabled ? '#1A2530' : T.muted, cursor: enabled ? 'pointer' : 'not-allowed' })

  // ─── DISCLAIMER STEP ─────────────────────────────────────────────────
  if (step === 'disclaimer') {
    return (
      <div className="overlay" onClick={overlayClose}>
        <FocusTrap onEscape={escapeClose}>
        <div className="modal" style={{ maxWidth: 580 }} role="dialog" aria-modal="true" aria-labelledby="notice-disclaimer-title">
          <div style={{ padding: '24px 28px 0' }}>
            <h2 id="notice-disclaimer-title" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8, color: T.text }}>
              {meta.label} ({meta.form}): read before continuing
            </h2>
          </div>
          <div style={{ padding: '0 28px 24px' }}>
            <div style={{ background: T.amber + '11', border: `1px solid ${T.amber}55`, borderRadius: 10, padding: '16px 18px', marginBottom: 18, fontSize: 13, color: T.text, lineHeight: 1.65 }}>
              <strong>This is a drafting tool, not legal advice.</strong>{' '}
              {type === 's8' ? (
                <>
                  Since 1 May 2026, landlords in England can no longer serve section 21 &ldquo;no-fault&rdquo; notices. Possession is sought on
                  Form 3A using the grounds in Schedule 2 to the Housing Act 1988, as amended by the Renters&rsquo; Rights Act 2025. Common reasons a notice fails:
                  <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                    <li>Date in the notice earlier than the notice period for a ground allows</li>
                    <li>Ground 1 or 1A relied on in the first 12 months of the tenancy</li>
                    <li>Ground 8 arrears below 3 months&rsquo; rent at service or at the hearing</li>
                    <li>Missing or vague particulars of the grounds</li>
                    <li>Out-of-date form instead of the current Form 3A</li>
                  </ul>
                </>
              ) : (
                <>
                  From 1 May 2026 rent can only be increased with a section 13 notice on Form 4A: at least two months&rsquo; notice, not within the
                  first year of the tenancy, and no more than once every 52 weeks. The tenant can ask the First-tier Tribunal to decide the rent,
                  which will not be set above the open-market rent.
                </>
              )}
              <div style={{ marginTop: 12 }}>
                <strong>Have it reviewed by a housing solicitor or accredited landlord-association adviser before serving.</strong>
              </div>
            </div>
            <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 18 }}>
              {JURISDICTION_NOTE} We prepare the content of {meta.form} for you to copy onto the latest version published on GOV.UK.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <button type="button" onClick={() => setStep('checklist')} style={{ ...btnPrimary(true), background: T.amber }}>
                I understand, continue
              </button>
            </div>
          </div>
        </div>
        </FocusTrap>
      </div>
    )
  }

  // ─── CHECKLIST STEP ──────────────────────────────────────────────────
  if (step === 'checklist') {
    const items = PREFLIGHT_ITEMS.filter(it => it.appliesTo.includes(type))
    const allAnswered = items.every(it => checklist[it.id] === 'yes' || checklist[it.id] === 'na')
    const hasNotApplicable = items.some(it => checklist[it.id] === 'na')

    return (
      <div className="overlay" onClick={overlayClose}>
        <FocusTrap onEscape={escapeClose}>
        <div className="modal" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-labelledby="notice-checklist-title">
          <div style={{ padding: '22px 26px 0' }}>
            <h2 id="notice-checklist-title" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6, color: T.text }}>
              Pre-flight checklist
            </h2>
            <p style={{ fontSize: 12, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
              Confirm each item. Anything left unticked is a likely reason the {meta.form} would fail.
            </p>
          </div>

          <div style={{ padding: '0 26px 20px', maxHeight: '55vh', overflowY: 'auto' }}>
            {items.map(it => {
              const answer = checklist[it.id]
              return (
                <div key={it.id} role="group" aria-label={it.label} style={{
                  border: `1px solid ${answer ? T.gold + '55' : T.border}`,
                  background: answer === 'yes' ? T.green + '0A' : answer === 'na' ? T.bg : 'transparent',
                  borderRadius: 10, padding: '12px 14px', marginBottom: 8,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.55 }}>{it.label}</div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {[
                      { v: 'yes', label: 'Yes', activeFg: T.green, activeBg: T.green + '22', activeBd: T.green + '66' },
                      { v: 'na',  label: 'N/A', activeFg: T.muted, activeBg: T.bg,           activeBd: T.border },
                    ].map(opt => {
                      const active = answer === opt.v
                      return (
                        <button key={opt.v} type="button" aria-pressed={active}
                          onClick={() => setChecklist(c => ({ ...c, [it.id]: opt.v }))}
                          style={{
                            fontFamily: mono, fontSize: 11, fontWeight: 700, minWidth: 44, minHeight: 32,
                            padding: '4px 10px', borderRadius: 6,
                            border: `1px solid ${active ? opt.activeBd : T.border}`,
                            background: active ? opt.activeBg : 'transparent',
                            color: active ? opt.activeFg : T.muted, cursor: 'pointer',
                          }}>{opt.label}</button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {hasNotApplicable && (
              <div style={{ background: T.amber + '11', border: `1px solid ${T.amber}55`, borderRadius: 8, padding: '10px 14px', marginTop: 10, fontSize: 12, color: T.text, lineHeight: 1.6 }}>
                You marked at least one item &ldquo;N/A&rdquo;. Be sure it genuinely doesn&rsquo;t apply. If unsure, get advice <em>before</em> serving.
              </div>
            )}
          </div>

          <div style={{ padding: '0 26px 22px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setStep('disclaimer')}>Back</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep('form')} disabled={!allAnswered}>
                Continue to form
              </Button>
            </div>
          </div>
        </div>
        </FocusTrap>
      </div>
    )
  }

  // ─── FORM STEP ───────────────────────────────────────────────────────
  const inp = {
    fontFamily: mono, fontSize: 13,
    background: T.bg, border: `1px solid ${T.border}`, color: T.text,
    borderRadius: 8, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const lbl = { fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }
  const hint = { fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.5 }
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
  const g8 = ground8Threshold({ rentAmount: form.rent_amount, frequency: form.rent_frequency })

  return (
    <div className="overlay" onClick={overlayClose}>
      <FocusTrap onEscape={escapeClose}>
      <div className="modal" style={{ maxWidth: 680 }} role="dialog" aria-modal="true" aria-labelledby="notice-form-title">
        <div style={{ padding: '20px 26px 0' }}>
          <h2 id="notice-form-title" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
            {meta.label}: {meta.form} content
          </h2>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4, marginBottom: 0 }}>
            Draft only. Copy onto the current {meta.form} from GOV.UK and verify before serving. {JURISDICTION_NOTE}
          </p>
        </div>

        <div style={{ padding: '18px 26px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={grid2}>
            <div>
              <label style={lbl} htmlFor="ng-landlord">Landlord name</label>
              <input id="ng-landlord" style={inp} value={form.landlord_name} onChange={e => update({ landlord_name: e.target.value })} placeholder="Full legal name"/>
            </div>
            <div>
              <label style={lbl} htmlFor="ng-tenants">Tenant name(s)</label>
              <input id="ng-tenants" style={inp} value={form.tenant_names} onChange={e => update({ tenant_names: e.target.value })} placeholder="Comma-separated if several"/>
            </div>
          </div>
          <div>
            <label style={lbl} htmlFor="ng-landlord-address">Landlord address (for service)</label>
            <input id="ng-landlord-address" style={inp} value={form.landlord_address} onChange={e => update({ landlord_address: e.target.value })} placeholder="Address where the tenant can contact you"/>
          </div>
          <div>
            <label style={lbl} htmlFor="ng-property-address">Property address</label>
            <input id="ng-property-address" style={inp} value={form.property_address} onChange={e => update({ property_address: e.target.value })}/>
          </div>
          <div style={grid2}>
            <div>
              <label style={lbl} htmlFor="ng-served">Date notice will be served</label>
              <input id="ng-served" type="date" style={inp} value={form.date_served} onChange={e => update({ date_served: e.target.value })}/>
            </div>
            <div>
              <label style={lbl} htmlFor="ng-tenancy-start">Tenancy start date</label>
              <input id="ng-tenancy-start" type="date" style={inp} value={form.tenancy_start} onChange={e => update({ tenancy_start: e.target.value })}/>
            </div>
          </div>
          <div style={grid2}>
            <div>
              <label style={lbl} htmlFor="ng-rent">Current rent</label>
              <input id="ng-rent" type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={form.rent_amount} onChange={e => update({ rent_amount: e.target.value })}/>
            </div>
            <div>
              <label style={lbl} htmlFor="ng-frequency">Rent is paid</label>
              <select id="ng-frequency" style={inp} value={form.rent_frequency} onChange={e => update({ rent_frequency: e.target.value })}>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>

          {type === 's8' ? (
            <>
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={lbl}>Grounds (tick all that apply)</legend>
                <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto', padding: '6px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  {GROUNDS.map(g => (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: T.text, cursor: 'pointer', lineHeight: 1.45, padding: '6px 0' }}>
                      <input type="checkbox" checked={form.grounds.includes(g.id)} onChange={() => toggleGround(g.id)} style={{ marginTop: 3, width: 16, height: 16 }}/>
                      <span>
                        <span style={{ fontWeight: 600 }}>{groundLabel(g)}</span>
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: g.mandatory ? T.red : T.muted }}>
                          {g.mandatory ? 'MANDATORY' : 'DISCRETIONARY'}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: T.muted }}>
                          Notice: {periodLabel(g.period)}. {g.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {form.grounds.some(id => ['8', '10', '11'].includes(id)) && (
                <div>
                  <label style={lbl} htmlFor="ng-arrears">Rent arrears today</label>
                  <input id="ng-arrears" type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={form.arrears} onChange={e => update({ arrears: e.target.value })}/>
                  {form.grounds.includes('8') && Number(form.rent_amount) > 0 && (
                    <div style={hint}>Ground 8 threshold: {g8.label} = {money(g8.amount)}, owed both at service and at the hearing.</div>
                  )}
                </div>
              )}

              <div>
                <label style={lbl} htmlFor="ng-expiry">Earliest date proceedings can begin</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input id="ng-expiry" type="date" style={{ ...inp, maxWidth: 220 }}
                    value={s8.possessionDate || ''} min={s8.earliest || undefined}
                    onChange={e => update({ expiry_date: e.target.value, expiry_manual: true })}/>
                  {form.expiry_manual && (
                    <Button variant="secondary" size="sm" onClick={() => update({ expiry_manual: false, expiry_date: '' })}>
                      Use earliest ({s8.earliest || 'n/a'})
                    </Button>
                  )}
                </div>
                <div style={hint}>Worked out from the longest notice period for the grounds chosen. The notice is normally valid for 12 months from service.</div>
              </div>

              <div>
                <label style={lbl} htmlFor="ng-particulars">Particulars of each ground</label>
                <textarea id="ng-particulars" style={{ ...inp, height: 96, resize: 'vertical' }}
                  value={form.grounds_details} onChange={e => update({ grounds_details: e.target.value })}
                  placeholder="e.g. Rent of £3,150 unpaid for the periods 1 August to 31 October 2026. Last payment £1,050 on 1 July 2026."/>
                <div style={hint}>The court can reject a notice that lacks specific particulars.</div>
              </div>
            </>
          ) : (
            <>
              <div style={grid2}>
                <div>
                  <label style={lbl} htmlFor="ng-proposed">Proposed new rent</label>
                  <input id="ng-proposed" type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={form.proposed_rent} onChange={e => update({ proposed_rent: e.target.value })}/>
                </div>
                <div>
                  <label style={lbl} htmlFor="ng-last-increase">Last section 13 increase took effect</label>
                  <input id="ng-last-increase" type="date" style={inp} value={form.last_increase_date} onChange={e => update({ last_increase_date: e.target.value })}/>
                  <div style={hint}>Leave blank if the rent has not been raised under section 13.</div>
                </div>
              </div>
              <div>
                <label style={lbl} htmlFor="ng-start">New rent starts</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input id="ng-start" type="date" style={{ ...inp, maxWidth: 220 }}
                    value={s13.startDate || ''} min={s13.earliest || undefined}
                    onChange={e => update({ start_date: e.target.value, start_manual: true })}/>
                  {form.start_manual && (
                    <Button variant="secondary" size="sm" onClick={() => update({ start_manual: false, start_date: '' })}>
                      Use earliest ({s13.earliest || 'n/a'})
                    </Button>
                  )}
                </div>
                <div style={hint}>Earliest is two months after service, and at least 52 weeks after the tenancy began and after the last section 13 increase. Pick the first day of a rental period.</div>
              </div>
            </>
          )}

          {(check.errors.length > 0 || check.warnings.length > 0) && (
            <div role="status" aria-live="polite" style={{ display: 'grid', gap: 6 }}>
              {check.errors.map(m => (
                <div key={m} style={{ fontSize: 12, color: T.red, background: T.red + '10', border: `1px solid ${T.red}44`, borderRadius: 8, padding: '8px 12px' }}>{m}</div>
              ))}
              {check.warnings.map(m => (
                <div key={m} style={{ fontSize: 12, color: T.text, background: T.amber + '14', border: `1px solid ${T.amber}55`, borderRadius: 8, padding: '8px 12px' }}>{m}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setStep('checklist')}>Back</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={printAndLog} disabled={!isValid}>
                Print / save as PDF
              </Button>
            </div>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}

// ── PRINTABLE HTML ──────────────────────────────────────────────────────
const PRINT_CSS = `
  @media print {
    .disclaimer { background: #fef3c7 !important; border: 2px solid #d97706 !important; color: #78350f !important; }
    body { padding: 20mm !important; }
    .no-print { display: none !important; }
  }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; padding: 40px 60px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 6px; letter-spacing: -0.01em; }
  .subtitle { text-align: center; font-size: 14px; color: #444; margin-bottom: 28px; font-style: italic; }
  .disclaimer { background: #fef3c7; border: 1px solid #f2d17a; color: #78350f; padding: 12px 16px; border-radius: 4px; margin-bottom: 28px; font-size: 13px; }
  .field-row { margin-bottom: 14px; }
  .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .field-value { font-size: 14px; margin-top: 2px; }
  ol, ul { padding-left: 24px; }
  li { margin-bottom: 8px; }
  .body-text { font-size: 14px; }
  .notes { margin-top: 18px; font-size: 12px; color: #444; }
  .signature { margin-top: 36px; display: flex; gap: 36px; }
  .signature > div { flex: 1; border-top: 1px solid #222; padding-top: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }`

function partiesHTML(form) {
  return `
  <div class="field-row"><div class="field-label">To (tenant(s)):</div><div class="field-value">${escapeHtml(form.tenant_names) || '________________________'}</div></div>
  <div class="field-row"><div class="field-label">From (landlord):</div>
    <div class="field-value">${escapeHtml(form.landlord_name) || '________________________'}</div>
    <div class="field-value" style="margin-top:4px">${escapeHtml(form.landlord_address) || '________________________'}</div></div>
  <div class="field-row"><div class="field-label">Property:</div><div class="field-value">${escapeHtml(form.property_address) || '________________________'}</div></div>`
}

function signatureHTML(form) {
  return `
  <div class="field-row" style="margin-top:32px"><div class="field-label">Date of service:</div><div class="field-value">${formatDateLong(form.date_served)}</div></div>
  <div class="signature"><div>Signature of landlord / agent</div><div>Date</div></div>`
}

function buildSection8HTML({ form, possessionDate }) {
  const grounds = (form.grounds || []).map(groundById).filter(Boolean)
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><title>Form 3A content (section 8), draft</title><style>${PRINT_CSS}</style></head>
<body>
  <div class="disclaimer"><strong>DRAFT, NOT LEGAL ADVICE.</strong> Copy this content onto the current Form 3A from GOV.UK and have it checked by a housing solicitor before serving. ${escapeHtml(JURISDICTION_NOTE)}</div>
  <h1>Notice seeking possession of a property let on an assured tenancy</h1>
  <div class="subtitle">Section 8 of the Housing Act 1988, as amended by the Renters&rsquo; Rights Act 2025: content for Form 3A</div>
  ${partiesHTML(form)}
  <p class="body-text"><strong>1.</strong> Your landlord intends to apply to the court for an order requiring you to give up possession of the property above, on the grounds below in Schedule 2 to the Housing Act 1988.</p>
  <ul>
    ${grounds.map(g => `<li><strong>${escapeHtml(groundLabel(g))}</strong> (${g.mandatory ? 'mandatory' : 'discretionary'} ground; notice period ${escapeHtml(periodLabel(g.period))})</li>`).join('')}
  </ul>
  <p class="body-text"><strong>2. Particulars of each ground:</strong></p>
  <p class="body-text" style="white-space:pre-wrap">${escapeHtml(form.grounds_details || '(particulars to be added before serving)')}</p>
  <p class="body-text"><strong>3.</strong> Court proceedings will not begin before ${formatDateLong(possessionDate)}.</p>
  <p class="body-text"><strong>4.</strong> This notice is normally valid for 12 months from the date it is served.</p>
  <p class="notes"><em>Notes for the tenant:</em> You do not have to leave on the date above. Your landlord must get a possession order from the court. Get advice straight away from Shelter, Citizens Advice, a housing adviser or a solicitor.</p>
  ${signatureHTML(form)}
</body></html>`
}

function buildSection13HTML({ form, startDate }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><title>Form 4A content (section 13), draft</title><style>${PRINT_CSS}</style></head>
<body>
  <div class="disclaimer"><strong>DRAFT, NOT LEGAL ADVICE.</strong> Copy this content onto the current Form 4A from GOV.UK before serving. ${escapeHtml(JURISDICTION_NOTE)}</div>
  <h1>Landlord&rsquo;s notice proposing a new rent under an assured periodic tenancy</h1>
  <div class="subtitle">Section 13(2) of the Housing Act 1988, as amended by the Renters&rsquo; Rights Act 2025: content for Form 4A</div>
  ${partiesHTML(form)}
  <p class="body-text"><strong>1.</strong> The current rent is ${money(form.rent_amount)} per ${escapeHtml(frequencyNoun(form.rent_frequency))}.</p>
  <p class="body-text"><strong>2.</strong> The proposed new rent is ${money(form.proposed_rent)} per ${escapeHtml(frequencyNoun(form.rent_frequency))}, starting on ${formatDateLong(startDate)}.</p>
  <p class="body-text"><strong>3.</strong> This notice is served at least two months before the new rent starts.</p>
  <p class="notes"><em>Notes for the tenant:</em> If you do not agree with the proposed rent you can apply to the First-tier Tribunal (Property Chamber) before the date the new rent starts. The tribunal will decide the rent, which will not be more than the open-market rent or the rent proposed. Get advice from Shelter, Citizens Advice or a housing adviser.</p>
  ${signatureHTML(form)}
</body></html>`
}

function frequencyNoun(f) {
  return { weekly: 'week', fortnightly: 'fortnight', monthly: 'month', quarterly: 'quarter', annually: 'year' }[f] || 'month'
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
