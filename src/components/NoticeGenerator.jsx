import { useState, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'

// ── S21 / S8 NOTICE GENERATOR ───────────────────────────────────────────
//
// ⚠ LEGAL: This generator produces a draft notice based on the user's
// inputs. It is NOT legal advice. The Section 21 prescribed Form 6A and
// Section 8 wording are governed by the Housing Act 1988 (England) and
// can be invalidated by many things — outstanding deposit protection,
// failure to provide an EPC/Gas/HtR booklet, an active "no fault eviction"
// freeze, recent renovations, retaliatory eviction rules, etc. The UI
// makes this clear at multiple stages.
//
// What we actually generate:
//   - A formatted document containing the legally-required elements
//     (parties, address, expiry date, grounds for S8)
//   - A "Print / Save as PDF" button using window.print() with a print
//     stylesheet that hides app chrome
//   - On success, log a draft entry into legal_notices so the tracker has
//     a row (the user can update the served_date once they actually serve)

const S8_GROUNDS = [
  { id: 1,  mandatory: true,  label: 'Ground 1 — Landlord requires possession to live in property (prior notice required)' },
  { id: 2,  mandatory: true,  label: 'Ground 2 — Mortgagee repossession' },
  { id: 7,  mandatory: true,  label: 'Ground 7 — Death of tenant; succession not applicable' },
  { id: 8,  mandatory: true,  label: 'Ground 8 — At least 2 months\' rent arrears (mandatory)' },
  { id: 10, mandatory: false, label: 'Ground 10 — Some rent arrears (discretionary)' },
  { id: 11, mandatory: false, label: 'Ground 11 — Persistent late payment (discretionary)' },
  { id: 12, mandatory: false, label: 'Ground 12 — Breach of tenancy agreement' },
  { id: 13, mandatory: false, label: 'Ground 13 — Deterioration of property due to tenant\'s acts' },
  { id: 14, mandatory: false, label: 'Ground 14 — Nuisance, annoyance, illegal use' },
  { id: 15, mandatory: false, label: 'Ground 15 — Deterioration of furniture due to tenant\'s acts' },
  { id: 17, mandatory: false, label: 'Ground 17 — False statement induced grant of tenancy' },
]

function todayISO()  { return new Date().toISOString().slice(0, 10) }
function plusDaysISO(iso, days) {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10)
}
function formatDateLong(iso) {
  if (!iso) return '________________'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return iso }
}

// Pre-flight checklist items. The user must tick all applicable ones (or
// confirm "not applicable") before being allowed onto the form. Each item
// maps to a specific invalidation reason from housing case law — getting
// any of these wrong is the most common way a possession claim fails.
const PREFLIGHT_ITEMS = [
  { id: 'deposit', label: 'Deposit protected in a government scheme (DPS/TDS/mydeposits) within 30 days of receipt, AND prescribed information served on the tenant.', appliesTo: ['s21'] },
  { id: 'epc',     label: 'A valid Energy Performance Certificate (EPC) has been served on the tenant.', appliesTo: ['s21'] },
  { id: 'gas',     label: 'A current Gas Safety Certificate (CP12) has been served on the tenant.', appliesTo: ['s21'] },
  { id: 'htr',     label: 'The current "How to Rent" booklet has been served on the tenant.', appliesTo: ['s21'] },
  { id: '4month',  label: 'Today is at least 4 months after the start of the original tenancy.', appliesTo: ['s21'] },
  { id: 'noimprov',label: 'The local council has NOT served an improvement notice or emergency remedial action in the last 6 months (retaliatory eviction protection).', appliesTo: ['s21'] },
  { id: 'fixedterm',label: 'If the tenancy is in its fixed term, the tenancy agreement contains a Section 21 break clause permitting this.', appliesTo: ['s21'] },
  { id: 'particulars',label: 'I have detailed particulars for each ground I am claiming (dates, amounts, specific events).', appliesTo: ['s8'] },
  { id: 'noticeperiod',label: 'The notice period I am about to set is long enough for the strictest ground claimed (varies 2 weeks – 2 months).', appliesTo: ['s8'] },
  { id: 'solicitor',label: 'I will have this notice reviewed by a housing solicitor or landlord-association advisor before serving.', appliesTo: ['s21','s8'] },
]

export default function NoticeGenerator({ property, userId, onClose, showToast }) {
  const { T } = useTheme()
  const mono = MONO
  const [step, setStep] = useState('disclaimer')
  const [type, setType] = useState('s21')
  const [checklist, setChecklist] = useState({})  // { itemId: 'yes' | 'na' }

  const [form, setForm] = useState({
    landlord_name:    '',
    landlord_address: '',
    tenant_names:     '',
    property_address: property?.address || '',
    date_served:      todayISO(),
    // S21: 2 months minimum. S8 varies by ground; conservative default 14 days
    // for arrears-based, 2 weeks for breach. UI surfaces this clearly.
    expiry_date:      plusDaysISO(todayISO(), 60),
    grounds:          [],
    grounds_details:  '',
  })

  function update(patch) { setForm(f => ({ ...f, ...patch })) }
  function toggleGround(id) {
    setForm(f => ({
      ...f,
      grounds: f.grounds.includes(id) ? f.grounds.filter(g => g !== id) : [...f.grounds, id],
    }))
  }

  const isValid = useMemo(() => {
    if (!form.landlord_name.trim() || !form.tenant_names.trim() || !form.property_address.trim()) return false
    if (!form.expiry_date) return false
    if (type === 's8' && form.grounds.length === 0) return false
    return true
  }, [form, type])

  async function printAndLog() {
    // Open a new tab with the printable document; let the user trigger
    // print or save-as-PDF themselves. Doing this in a new tab avoids
    // print styles fighting the rest of the app.
    const w = window.open('', '_blank', 'width=820,height=1100')
    if (!w) {
      showAppToast('Browser blocked the print window. Allow pop-ups and try again.', 'error')
      return
    }
    w.document.write(buildPrintHTML({ type, form }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 250)

    // Log a draft entry into legal_notices so the tracker has a record.
    try {
      await api.saveNotice({
        property_id: property.id,
        user_id: userId,
        notice_type: type,
        status: 'draft',
        served_date: form.date_served,
        expiry_date: form.expiry_date,
        grounds: type === 's8'
          ? form.grounds.map(g => `Ground ${g}`).join(', ')
          : null,
        notes: 'Generated via Notice Generator. Verify with solicitor before serving.',
      })
      if (showToast) showToast('Draft notice logged')
    } catch (e) {
      // Non-fatal — the printed document is the important part.
    }
  }

  // ─── DISCLAIMER STEP ─────────────────────────────────────────────────
  if (step === 'disclaimer') {
    return (
      <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal" style={{ maxWidth: 580 }}>
          <div style={{ padding: '24px 28px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }} aria-hidden="true">⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8, color: T.text }}>
              Important — read before continuing
            </h2>
          </div>
          <div style={{ padding: '0 28px 24px' }}>
            <div style={{
              background: T.amber + '11', border: `1px solid ${T.amber}55`,
              borderRadius: 10, padding: '16px 18px', marginBottom: 18,
              fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7,
            }}>
              <strong>This is a drafting tool, not legal advice.</strong> An invalid
              S21 or S8 notice loses the case before it starts. Common reasons
              notices fail:
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                <li>Deposit not protected, or no prescribed information served</li>
                <li>No valid EPC, gas safety certificate, or How-to-Rent booklet given to tenant</li>
                <li>Notice served within the first 4 months of the tenancy (S21)</li>
                <li>Local council served an improvement notice in the last 6 months (S21 retaliation rules)</li>
                <li>Notice period too short for the grounds claimed (S8)</li>
                <li>Tenant is on a fixed term and section 21 isn't in the contract</li>
              </ul>
              <div style={{ marginTop: 12 }}>
                <strong>Have this notice reviewed by a housing solicitor or
                accredited landlord-association advisor before serving it.</strong>
                It's almost always cheaper than a failed possession claim.
              </div>
            </div>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 18 }}>
              This generator produces a draft document containing the legally-
              required elements (parties, address, expiry date, grounds for S8).
              The Section 21 prescribed Form 6A is updated by the Ministry of
              Housing periodically — if your form differs from the latest
              version published on GOV.UK, use the GOV.UK version instead.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose}
                style={{ fontFamily: mono, fontSize: 12, padding: '10px 18px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => setStep('checklist')}
                style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '10px 18px', borderRadius: 8, border: 'none', background: T.amber, color: '#1A2530', cursor: 'pointer' }}>
                I understand — continue
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── CHECKLIST STEP ──────────────────────────────────────────────────
  if (step === 'checklist') {
    const items = PREFLIGHT_ITEMS.filter(it => it.appliesTo.includes(type))
    const allAnswered = items.every(it => checklist[it.id] === 'yes' || checklist[it.id] === 'na')
    const hasNotApplicable = items.some(it => checklist[it.id] === 'na')

    return (
      <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal" style={{ maxWidth: 640 }}>
          <div style={{ padding: '22px 26px 0' }}>
            <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6, color: T.text }}>
              Pre-flight checklist
            </h2>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
              Confirm each item below applies to your situation. Any item left unticked is a likely reason your notice will be struck out.
            </p>
            {/* Type switch — also visible here so user can flip between S21
                and S8 and see the relevant checklist */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {[
                { key: 's21', label: 'Section 21' },
                { key: 's8',  label: 'Section 8'  },
              ].map(opt => (
                <button key={opt.key} onClick={() => setType(opt.key)}
                  style={{
                    flex: 1, fontFamily: mono, fontSize: 12,
                    padding: '8px 10px', borderRadius: 8,
                    border: `1.5px solid ${type === opt.key ? T.gold : T.border}`,
                    background: type === opt.key ? T.gold + '14' : 'transparent',
                    color: type === opt.key ? T.gold : T.text,
                    cursor: 'pointer', fontWeight: 700,
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <div style={{ padding: '0 26px 20px', maxHeight: '55vh', overflowY: 'auto' }}>
            {items.map(it => {
              const answer = checklist[it.id]
              return (
                <div key={it.id} style={{
                  border: `1px solid ${answer ? T.gold + '55' : T.border}`,
                  background: answer === 'yes' ? T.green + '0A' : answer === 'na' ? T.bg : 'transparent',
                  borderRadius: 10, padding: '12px 14px', marginBottom: 8,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <div style={{ flex: 1, fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.55 }}>
                    {it.label}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {[
                      { v: 'yes', label: '✓ Yes', activeFg: T.green, activeBg: T.green + '22', activeBd: T.green + '66' },
                      { v: 'na',  label: 'N/A',   activeFg: T.muted, activeBg: T.bg,           activeBd: T.border },
                    ].map(opt => {
                      const active = answer === opt.v
                      return (
                        <button key={opt.v}
                          onClick={() => setChecklist(c => ({ ...c, [it.id]: opt.v }))}
                          style={{
                            fontFamily: mono, fontSize: 10, fontWeight: 700,
                            padding: '4px 9px', borderRadius: 6,
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
              <div style={{
                background: T.amber + '11', border: `1px solid ${T.amber}55`,
                borderRadius: 8, padding: '10px 14px', marginTop: 10,
                fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.6,
              }}>
                ⚠ You marked at least one item as "N/A". Be sure you understand which items genuinely don't apply to your tenancy. If unsure, get advice <em>before</em> serving this notice.
              </div>
            )}
          </div>

          <div style={{ padding: '0 26px 22px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <button onClick={() => setStep('disclaimer')}
              style={{ fontFamily: mono, fontSize: 11, padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
              ← Back
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}
                style={{ fontFamily: mono, fontSize: 12, padding: '10px 18px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => setStep('form')} disabled={!allAnswered}
                style={{
                  fontFamily: mono, fontSize: 12, fontWeight: 700,
                  padding: '10px 18px', borderRadius: 8, border: 'none',
                  background: allAnswered ? T.gold : T.border,
                  color: allAnswered ? '#1A2530' : T.muted,
                  cursor: allAnswered ? 'pointer' : 'not-allowed',
                }}>
                Continue to form
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── FORM STEP ───────────────────────────────────────────────────────
  const inp = {
    fontFamily: mono, fontSize: 13,
    background: T.bg, border: `1px solid ${T.border}`, color: T.text,
    borderRadius: 8, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div style={{ padding: '20px 26px 0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
            Generate possession notice
          </h2>
          <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4, marginBottom: 0 }}>
            Draft only — verify with a solicitor before serving.
          </p>
        </div>

        <div style={{ padding: '18px 26px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Type switch */}
          <div>
            <span style={lbl}>Notice type</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 's21', label: 'Section 21', sub: 'No-fault' },
                { key: 's8',  label: 'Section 8',  sub: 'Fault-based' },
              ].map(opt => (
                <button key={opt.key} onClick={() => setType(opt.key)}
                  style={{
                    flex: 1, fontFamily: mono, fontSize: 12,
                    padding: '12px 10px', borderRadius: 10,
                    border: `1.5px solid ${type === opt.key ? T.gold : T.border}`,
                    background: type === opt.key ? T.gold + '14' : 'transparent',
                    color: type === opt.key ? T.gold : T.text,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  <div style={{ fontWeight: 700 }}>{opt.label}</div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Landlord name</label>
              <input style={inp} value={form.landlord_name} onChange={e => update({ landlord_name: e.target.value })} placeholder="Full legal name"/>
            </div>
            <div>
              <label style={lbl}>Tenant name(s)</label>
              <input style={inp} value={form.tenant_names} onChange={e => update({ tenant_names: e.target.value })} placeholder="Comma-separated if multiple"/>
            </div>
          </div>

          <div>
            <label style={lbl}>Landlord address (for service)</label>
            <input style={inp} value={form.landlord_address} onChange={e => update({ landlord_address: e.target.value })} placeholder="Address where tenant should send replies"/>
          </div>

          <div>
            <label style={lbl}>Property address</label>
            <input style={inp} value={form.property_address} onChange={e => update({ property_address: e.target.value })}/>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Date of notice</label>
              <input type="date" style={inp} value={form.date_served} onChange={e => update({ date_served: e.target.value })}/>
            </div>
            <div>
              <label style={lbl}>Earliest possession / expiry date</label>
              <input type="date" style={inp} value={form.expiry_date} onChange={e => update({ expiry_date: e.target.value })}/>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>
                {type === 's21'
                  ? 'S21: must be at least 2 months after the date of notice.'
                  : 'S8: notice period depends on grounds (2 weeks – 2 months).'}
              </div>
            </div>
          </div>

          {type === 's8' && (
            <div>
              <label style={lbl}>Grounds (tick all that apply)</label>
              <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                {S8_GROUNDS.map(g => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontFamily: mono, fontSize: 11, color: T.text, cursor: 'pointer', lineHeight: 1.5 }}>
                    <input type="checkbox" checked={form.grounds.includes(g.id)} onChange={() => toggleGround(g.id)} style={{ marginTop: 3 }}/>
                    <span>
                      {g.label}
                      {g.mandatory && <span style={{ marginLeft: 6, color: T.red, fontWeight: 700, fontSize: 10 }}>MANDATORY</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Particulars of each ground</label>
                <textarea style={{ ...inp, height: 80, resize: 'vertical' }}
                  value={form.grounds_details}
                  onChange={e => update({ grounds_details: e.target.value })}
                  placeholder="e.g. Rent arrears of £2,400 outstanding since 1 January 2026. Last payment £600 on 1 December 2025…"/>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>
                  The court will throw out an S8 notice that lacks specific particulars.
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 6 }}>
            <button onClick={() => setStep('checklist')}
              style={{ fontFamily: mono, fontSize: 11, padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
              ← Back
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}
                style={{ fontFamily: mono, fontSize: 12, padding: '10px 18px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={printAndLog} disabled={!isValid}
                style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '10px 18px', borderRadius: 8, border: 'none', background: isValid ? T.gold : T.border, color: isValid ? '#1A2530' : T.muted, cursor: isValid ? 'pointer' : 'not-allowed' }}>
                Print / Save as PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── PRINTABLE HTML ──────────────────────────────────────────────────────
// Standalone document opened in a new tab. Includes a print stylesheet so
// the page prints cleanly without app chrome. The "DRAFT — verify with
// solicitor" watermark appears in screen view; print view shows it as a
// header banner so anyone reading the printed copy sees it.
function buildPrintHTML({ type, form }) {
  const isS21 = type === 's21'
  const groundsList = (form.grounds || []).map(id => S8_GROUNDS.find(g => g.id === id)).filter(Boolean)
  const groundsHtml = groundsList.length === 0 ? '' : `
    <p><strong>Grounds for possession:</strong></p>
    <ul>
      ${groundsList.map(g => `<li>${escapeHtml(g.label)}${g.mandatory ? ' (mandatory ground)' : ' (discretionary ground)'}</li>`).join('')}
    </ul>
    <p><strong>Particulars of each ground:</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(form.grounds_details || '(particulars to be added before serving — required by Housing Act 1988 s.8(3)(c))')}</p>
  `

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${isS21 ? 'Section 21 Notice' : 'Section 8 Notice'} — Draft</title>
<style>
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
  ol li, ul li { margin-bottom: 8px; }
  .body-text { font-size: 14px; }
  .signature { margin-top: 36px; display: flex; gap: 36px; }
  .signature > div { flex: 1; border-top: 1px solid #222; padding-top: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .print-btn { background: #1a2530; color: white; border: none; padding: 10px 22px; font-size: 13px; border-radius: 6px; cursor: pointer; margin-top: 20px; }
</style>
</head>
<body>
  <div class="disclaimer">
    <strong>DRAFT — NOT YET LEGAL ADVICE.</strong> Verify the validity of this notice with a housing solicitor before serving it on a tenant. An invalid notice will be struck out by the court.
  </div>

  <h1>${isS21
    ? 'Notice seeking possession of a property let on an Assured Shorthold Tenancy'
    : 'Notice seeking possession of a property let on an Assured Tenancy or an Assured Agricultural Occupancy'}</h1>
  <div class="subtitle">${isS21
    ? 'Section 21 of the Housing Act 1988 (as amended) — equivalent to Form 6A'
    : 'Section 8 of the Housing Act 1988 (as amended) — equivalent to Form 3'}</div>

  <div class="field-row">
    <div class="field-label">To (tenant(s)):</div>
    <div class="field-value">${escapeHtml(form.tenant_names) || '________________________'}</div>
  </div>

  <div class="field-row">
    <div class="field-label">From (landlord):</div>
    <div class="field-value">${escapeHtml(form.landlord_name) || '________________________'}</div>
    <div class="field-value" style="margin-top:4px">${escapeHtml(form.landlord_address) || '________________________'}</div>
  </div>

  <div class="field-row">
    <div class="field-label">Concerning the property at:</div>
    <div class="field-value">${escapeHtml(form.property_address) || '________________________'}</div>
  </div>

  ${isS21 ? `
    <p class="body-text"><strong>1.</strong> I/We give you notice that I/we require possession of the property referred to above.</p>
    <p class="body-text"><strong>2.</strong> After ${formatDateLong(form.expiry_date)} possession of the property is required by virtue of section 21 of the Housing Act 1988.</p>
    <p class="body-text"><strong>3.</strong> A claim for possession will not be started before this date or any later date stipulated in your tenancy agreement.</p>
    <p class="body-text" style="margin-top:18px; font-size:12px; color:#444">
      <em>Notes for the tenant:</em> This notice is only valid for 6 months from the date it is given.
      You do not have to leave the property when this notice expires. If you remain in the property
      after the date given, your landlord will need to apply to the court for a possession order.
      You may wish to take advice from Shelter, Citizens Advice, or a housing solicitor.
    </p>
  ` : `
    <p class="body-text"><strong>1.</strong> Your landlord intends to apply to the court for an order requiring you to give up possession of:</p>
    <p class="body-text" style="margin-left:24px">${escapeHtml(form.property_address)}</p>

    <p class="body-text"><strong>2.</strong> Your landlord intends to seek possession on grounds in Schedule 2 to the Housing Act 1988, as set out below.</p>

    ${groundsHtml}

    <p class="body-text"><strong>3.</strong> The court proceedings will not begin until after ${formatDateLong(form.expiry_date)}.</p>
    <p class="body-text"><strong>4.</strong> After this date court proceedings may be begun at once, but not later than 12 months from the date on which this notice is served.</p>
    <p class="body-text" style="margin-top:18px; font-size:12px; color:#444">
      <em>Notes for the tenant:</em> If you need advice about this notice, take it immediately to
      a Citizens Advice Bureau, a housing advice centre, a solicitor or a law centre.
    </p>
  `}

  <div class="field-row" style="margin-top:32px">
    <div class="field-label">Date of notice:</div>
    <div class="field-value">${formatDateLong(form.date_served)}</div>
  </div>

  <div class="signature">
    <div>Signature of landlord / agent</div>
    <div>Date</div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">Print this notice</button>
</body>
</html>`
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
