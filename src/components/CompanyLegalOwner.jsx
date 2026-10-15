// "Legal owner" control for a company: are its properties owned personally
// (included in personal Making Tax Digital figures) or by the limited
// company itself (corporation tax — left out of MTD ITSA)? Stored as
// companies.legal_owner ('personal' | 'limited_company' | NULL = not set,
// treated as personal). See fetchMtdPropertyScope in src/lib/api/mtd.js.

import { useState } from 'react'
import { MONO, FS } from '../lib/styles'
import * as api from '../lib/api'
import {
  LEGAL_OWNER_PERSONAL, LEGAL_OWNER_LIMITED, isMissingLegalOwnerColumnError,
} from '../lib/mtdItsa'

export const LEGAL_OWNER_HELP = 'Used for Making Tax Digital: properties in a limited company are taxed under corporation tax and left out of your personal MTD figures.'

const OPTIONS = [
  [LEGAL_OWNER_PERSONAL, 'Personal', 'I/we own these properties personally'],
  [LEGAL_OWNER_LIMITED, 'Limited company', 'Owned by the company'],
]

// Presentational radio group. value null/undefined = not set (nothing ticked).
export function LegalOwnerChoice({ value, onChange, disabled = false, idPrefix = 'legal-owner', T }) {
  const helpId = `${idPrefix}-help`
  return (
    <fieldset aria-describedby={helpId} style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ padding: 0, marginBottom: 6, fontFamily: MONO, fontSize: FS.xs, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>Legal owner</legend>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OPTIONS.map(([v, label, desc]) => {
          const checked = value === v
          const id = `${idPrefix}-${v}`
          return (
            <label key={v} htmlFor={id}
              style={{ flex: '1 1 180px', display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: MONO, fontSize: 11,
                padding: '9px 10px', margin: 0, borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', textTransform: 'none', letterSpacing: 'normal',
                border: `1px solid ${checked ? T.gold : T.border}`,
                background: checked ? T.gold + '18' : 'transparent',
                color: checked ? T.goldText : T.muted, opacity: disabled ? 0.6 : 1 }}>
              <input type="radio" id={id} name={`${idPrefix}-choice`} value={v} checked={checked} disabled={disabled}
                onChange={() => onChange(v)} style={{ marginTop: 2, accentColor: T.gold, width: 'auto' }}/>
              <span>
                <span style={{ fontWeight: 700, display: 'block' }}>{label}</span>
                <span style={{ fontSize: FS.xs, lineHeight: 1.4, color: T.muted }}>{desc}</span>
              </span>
            </label>
          )
        })}
      </div>
      <p id={helpId} style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted, lineHeight: 1.5, margin: '6px 0 0' }}>
        {LEGAL_OWNER_HELP}
      </p>
    </fieldset>
  )
}

// Saves straight to the company (Portfolio → Companies). Read-only without
// edit rights.
export default function CompanyLegalOwnerSetting({ company, canEdit, onUpdateCompany, showToast, T }) {
  const [saving, setSaving] = useState(false)

  async function save(next) {
    if (next === company.legal_owner) return
    setSaving(true)
    try {
      const row = await api.updateCompany(company.id, { legal_owner: next })
      onUpdateCompany?.(row)
      showToast?.(next === LEGAL_OWNER_LIMITED
        ? `${company.name} marked as a limited company — its properties are left out of personal MTD figures`
        : `${company.name} marked as personally owned — its properties count towards personal MTD figures`)
    } catch (e) {
      showToast?.(isMissingLegalOwnerColumnError(e)
        ? 'The legal owner setting isn’t available yet — please try again later'
        : (e.message || 'Could not save the legal owner'), 'error')
    }
    setSaving(false)
  }

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 22 }}>
      <LegalOwnerChoice T={T} value={company.legal_owner ?? null} onChange={save}
        disabled={!canEdit || saving} idPrefix={`co-legal-owner-${company.id}`}/>
      {company.legal_owner == null && (
        <div style={{ fontFamily: MONO, fontSize: FS.xs, color: T.amber, marginTop: 6 }}>
          Not set yet — treated as personal until you choose.
        </div>
      )}
    </div>
  )
}
