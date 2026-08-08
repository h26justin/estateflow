// Register-synced EPC band chip + MEES messaging.
// Bands F/G on a let property are a LIVE breach (band E has been the legal
// minimum to let since April 2020) — red, "cannot legally let". Bands D/E
// get the amber countdown to the proposed 2030 band-C deadline. Rating comes
// from properties.epc_rating (written by the epc-sync edge function).
// Shared by the Compliance surfaces — lives in its own file so the lazy
// CompliancePage chunk and the main-bundle FeatureComponents don't drag
// each other in.
import { MONO } from '../lib/styles'
import { EPC_BAND_COLOR, MEES_DEADLINE_ISO, epcBand, epcNeedsUpgrade, epcBelowLegalMinimum, isLetProperty } from '../lib/complianceCatalogue'
import { daysUntilDate } from '../lib/complianceStatus'

export default function EpcBadge({ property, T }) {
  const band = epcBand(property)
  if (!band) return null
  const days = daysUntilDate(MEES_DEADLINE_ISO)
  const breach = epcBelowLegalMinimum(band)
  const needsWork = epcNeedsUpgrade(band)
  return (
    <span title={breach ? `EPC band ${band} — below the current legal minimum of E (MEES)` : needsWork ? `EPC band ${band} — below the 2030 MEES target of C` : `EPC band ${band}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: EPC_BAND_COLOR[band], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>{band}</span>
      {breach ? (
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.red }}>
          {isLetProperty(property) ? 'below min E — cannot legally let' : 'below legal minimum E'}
        </span>
      ) : needsWork && days !== null && days > 0 ? (
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.amber }}>{days.toLocaleString('en-GB')}d to C</span>
      ) : needsWork ? (
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.red }}>below band C</span>
      ) : null}
    </span>
  )
}
