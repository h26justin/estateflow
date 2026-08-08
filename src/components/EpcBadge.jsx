// Register-synced EPC band chip + MEES countdown: "[D] 1,604d to C".
// Shown wherever there's a synced rating (properties.epc_rating, written by
// the epc-sync edge function); the countdown only when the band is below
// the 2030 MEES target of C, since that's the clock the landlord is on.
// Shared by the Compliance overview cards and the per-property Compliance
// tab — lives in its own file so the lazy CompliancePage chunk and the
// main-bundle FeatureComponents don't drag each other in.
import { MONO } from '../lib/styles'
import { EPC_BAND_COLOR, MEES_DEADLINE_ISO, epcBand, epcNeedsUpgrade } from '../lib/complianceCatalogue'
import { daysUntilDate } from '../lib/complianceStatus'

export default function EpcBadge({ property, T }) {
  const band = epcBand(property)
  if (!band) return null
  const days = daysUntilDate(MEES_DEADLINE_ISO)
  const needsWork = epcNeedsUpgrade(band)
  return (
    <span title={needsWork ? `EPC band ${band} — below the 2030 MEES target of C` : `EPC band ${band}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: EPC_BAND_COLOR[band], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>{band}</span>
      {needsWork && days !== null && days > 0 && (
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.amber }}>{days.toLocaleString('en-GB')}d to C</span>
      )}
      {needsWork && days !== null && days <= 0 && (
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.red }}>below band C</span>
      )}
    </span>
  )
}
