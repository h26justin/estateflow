// Register-synced EPC band chip + MEES messaging.
// Bands F/G on a let property are a LIVE breach (band E has been the legal
// minimum to let since April 2020) — red, "cannot legally let". Bands D/E
// get an amber "C needed by 2030" note for the proposed band-C deadline. Rating comes
// from properties.epc_rating (written by the epc-sync edge function).
// Shared by the Compliance surfaces — lives in its own file so the lazy
// CompliancePage chunk and the main-bundle FeatureComponents don't drag
// each other in.
import { MONO, FS } from '../lib/styles'
import { EPC_BAND_COLOR, MEES_DEADLINE_ISO, epcBand, epcNeedsUpgrade, epcBelowLegalMinimum, isLetProperty, meesTargetLabel } from '../lib/complianceCatalogue'
import { fmtDate } from '../lib/format'

export default function EpcBadge({ property, T }) {
  const band = epcBand(property)
  if (!band) return null
  const breach = epcBelowLegalMinimum(band)
  const needsWork = epcNeedsUpgrade(band)
  return (
    <span title={breach ? `EPC band ${band} — below the current legal minimum of E (MEES)` : needsWork ? `EPC band ${band} — must reach band C by ${fmtDate(MEES_DEADLINE_ISO)} (proposed MEES target)` : `EPC band ${band}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: EPC_BAND_COLOR[band], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>{band}</span>
      {breach ? (
        <span style={{ fontFamily: MONO, fontSize: FS.xs, fontWeight: 700, color: T.red }}>
          {isLetProperty(property) ? 'below min E — cannot legally let' : 'below legal minimum E'}
        </span>
      ) : needsWork ? (() => {
        const label = meesTargetLabel()
        const overdue = label.startsWith('below')
        return <span style={{ fontFamily: MONO, fontSize: FS.xs, fontWeight: 700, color: overdue ? T.red : T.amber }}>{label}</span>
      })() : null}
    </span>
  )
}
