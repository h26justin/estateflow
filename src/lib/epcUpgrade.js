// EPC upgrade-to-C maths for the "EPC upgrade plan" report (builder pack).
//
// Ground truth is the official EPC register certificate stored in
// epc_certificates.raw by the epc-sync edge function. Each certificate's
// suggested_improvements array lists the assessor's recommended measures in
// order, and every step carries the CUMULATIVE SAP score the property would
// reach after doing that measure and all the ones before it
// (energy_performance_rating). That lets us answer "which measures, and how
// much, to reach band C" directly from register data — no AI estimates.
//
// Measure descriptions: the register only stores a numeric code
// (improvement_details.improvement_number). The code → text lookup below is
// transcribed from Table 33 ("Improvement measures", former Appendix T) of
// the RdSAP 10 specification (BRE, 12 Feb 2024) — the "Rec No" column —
// which is what EPC software uses to print the certificate's own wording.

// ── SAP score → band ─────────────────────────────────────────────────────────
// Standard domestic EPC bands: A 92+, B 81-91, C 69-80, D 55-68, E 39-54,
// F 21-38, G 1-20.
export const SAP_C_THRESHOLD = 69

export function bandFromSap(score) {
  const s = Number(score)
  if (!Number.isFinite(s) || s <= 0) return null
  if (s >= 92) return 'A'
  if (s >= 81) return 'B'
  if (s >= 69) return 'C'
  if (s >= 55) return 'D'
  if (s >= 39) return 'E'
  if (s >= 21) return 'F'
  return 'G'
}

export const BELOW_C = new Set(['D', 'E', 'F', 'G'])

// ── Improvement code lookup (RdSAP 10 Table 33 "Rec No") ─────────────────────
export const IMPROVEMENT_DESCRIPTIONS = {
  1:  'Insulate hot water cylinder with 80 mm jacket',
  2:  'Increase hot water cylinder insulation',
  3:  'Add additional 80 mm jacket to hot water cylinder',
  4:  'Hot water cylinder thermostat',
  5:  'Increase loft insulation to 270 mm',
  6:  'Cavity wall insulation',
  7:  'Internal or external wall insulation',
  8:  'Replace single glazed windows with low-E double glazing',
  10: 'Draught proofing of windows and doors',
  11: 'Heating controls (programmer, room thermostat and TRVs)',
  12: 'Heating controls (room thermostat and TRVs)',
  13: 'Heating controls (thermostatic radiator valves)',
  14: 'Heating controls (room thermostat)',
  15: 'Heating controls (programmer and TRVs)',
  16: 'Time and temperature zone control',
  17: 'Heating controls for warm air system',
  18: 'Heating controls for warm air system',
  19: 'Solar water heating',
  20: 'Replacement condensing boiler',
  22: 'Biomass boiler (wood logs)',
  23: 'Wood pellet stove with boiler',
  26: 'Replacement warm air unit',
  29: 'Change heating to gas condensing boiler',
  34: 'Solar photovoltaic panels, 2.5 kWp',
  35: 'Low energy lighting for all fixed outlets',
  39: 'Wood pellet stove with boiler and radiators',
  42: 'Flue gas heat recovery with replacement boiler',
  45: 'Flat roof or sloping ceiling insulation',
  46: 'Room-in-roof insulation',
  49: 'Waste water heat recovery for showers',
  50: 'Flue gas heat recovery device',
  53: 'Micro-CHP heating',
  54: 'Wood logs boiler',
  55: 'External wall insulation (on cavity walls)',
  57: 'Suspended floor insulation',
  58: 'Solid floor insulation',
  59: 'High heat retention storage heaters and dual immersion cylinder',
  60: 'High heat retention storage heaters',
  61: 'High heat retention storage heaters and off-peak dual immersion',
  62: 'High heat retention storage heaters (off-peak tariff)',
  65: 'External wall insulation',
  70: 'Separate time and temperature control for water heating',
  75: 'Ground source heat pump with radiators',
}

// Fallback when a code is missing from the table: the letter code
// (improvement_type, e.g. "A2", "Q") from the same RdSAP table.
const IMPROVEMENT_TYPE_LABELS = {
  A: 'Loft insulation', A2: 'Flat roof insulation', A3: 'Room-in-roof insulation',
  B: 'Cavity wall insulation', C: 'Hot water cylinder insulation',
  D: 'Draught proofing', E: 'Low energy lighting', F: 'Cylinder thermostat',
  G: 'Heating controls', G2: 'Water heating controls', H: 'Warm air heating controls',
  I: 'Condensing boiler', J: 'Biomass boiler', J2: 'Biomass boiler',
  K: 'Biomass room heater with boiler', L2: 'High heat retention storage heaters',
  M: 'Replacement warm air unit', N: 'Solar water heating',
  O: 'Double glazing', P: 'Secondary glazing',
  Q: 'Solid wall insulation', Q2: 'Wall insulation',
  R: 'Condensing boiler (fuel switch)', S: 'Condensing boiler (oil)',
  T: 'Gas condensing boiler', U: 'Solar photovoltaic panels',
  V: 'Wind turbine', W1: 'Suspended floor insulation', W2: 'Solid floor insulation',
  X: 'Waste water heat recovery', Y: 'Flue gas heat recovery',
  Z1: 'Heat pump with radiators', Z2: 'Heat pump with underfloor heating',
  Z3: 'Micro-CHP',
}

// Human label for one raw suggested_improvements entry.
export function measureLabel(m) {
  const num = Number(m?.improvement_details?.improvement_number)
  if (IMPROVEMENT_DESCRIPTIONS[num]) return IMPROVEMENT_DESCRIPTIONS[num]
  const type = String(m?.improvement_type || '').toUpperCase()
  if (IMPROVEMENT_TYPE_LABELS[type]) return IMPROVEMENT_TYPE_LABELS[type]
  return num ? `Improvement measure ${num}` : 'Improvement measure'
}

// ── Indicative cost parsing ──────────────────────────────────────────────────
// The register stores indicative_cost as a number (450), a bare string
// ("1,500"), or a range string ("£4,000 - £14,000"). Returns {lo, hi} in
// whole pounds, or null when unparseable/missing.
export function parseIndicativeCost(v) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return { lo: v, hi: v }
  const nums = String(v).match(/\d[\d,]*(?:\.\d+)?/g)
  if (!nums || !nums.length) return null
  const vals = nums.map(n => Number(n.replace(/,/g, ''))).filter(Number.isFinite)
  if (!vals.length) return null
  return { lo: Math.min(...vals), hi: Math.max(...vals) }
}

const gbp = n => '£' + Math.round(n).toLocaleString('en-GB')

// "£450", "£4,000 - £14,000", or "—" for unknown.
export function fmtCostRange(range) {
  if (!range) return '—'
  const { lo, hi } = range
  return lo === hi ? gbp(lo) : `${gbp(lo)} - ${gbp(hi)}`
}

// ── Plan to reach C for one certificate ──────────────────────────────────────
// cert: { current_rating, potential_rating, sap_score, improvements }.
// improvements is the raw suggested_improvements array (may be null).
//
// Returns:
//   status      'already_c' | 'plan' | 'not_reachable' | 'no_data'
//   measures    ordered measures needed to reach C (all of them when C is
//               not reachable, so the full works list is still visible)
//   costLo/costHi  summed indicative costs of those measures (pounds)
//   hasUnknownCost true when any needed measure had no parseable cost
//   savingPerYear  summed typical annual saving (£) of those measures, or null
//   sapAfter    cumulative SAP score after the last needed measure, or null
export function planToC(cert) {
  const rating = String(cert?.current_rating || '').toUpperCase()
  // Number(null) is 0, which would read as a (terrible) real score — treat
  // missing as NaN so the no_data path still fires.
  const sap = cert?.sap_score == null || cert?.sap_score === '' ? NaN : Number(cert.sap_score)
  const belowC = BELOW_C.has(rating) || (!rating && Number.isFinite(sap) && sap > 0 && sap < SAP_C_THRESHOLD)

  if (!belowC && (rating || Number.isFinite(sap))) {
    return { status: 'already_c', measures: [], costLo: 0, costHi: 0, hasUnknownCost: false, savingPerYear: null, sapAfter: null }
  }
  if (!rating && !Number.isFinite(sap)) {
    return { status: 'no_data', measures: [], costLo: 0, costHi: 0, hasUnknownCost: false, savingPerYear: null, sapAfter: null }
  }

  const raw = Array.isArray(cert?.improvements) ? cert.improvements : []
  const ordered = [...raw].sort((a, b) => (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0))

  const measures = []
  let reached = false
  let sapAfter = null
  for (const m of ordered) {
    const after = Number(m?.energy_performance_rating)
    measures.push({
      label: measureLabel(m),
      cost: parseIndicativeCost(m?.indicative_cost),
      costText: m?.indicative_cost != null ? String(m.indicative_cost) : null,
      saving: Number(m?.typical_saving?.value) || null,
      sapAfter: Number.isFinite(after) ? after : null,
    })
    if (Number.isFinite(after)) sapAfter = after
    if (Number.isFinite(after) && after >= SAP_C_THRESHOLD) { reached = true; break }
  }

  if (!ordered.length) {
    return { status: 'not_reachable', measures: [], costLo: 0, costHi: 0, hasUnknownCost: true, savingPerYear: null, sapAfter: null }
  }

  let costLo = 0, costHi = 0, hasUnknownCost = false, saving = 0, hasSaving = false
  for (const m of measures) {
    if (m.cost) { costLo += m.cost.lo; costHi += m.cost.hi } else { hasUnknownCost = true }
    if (m.saving != null) { saving += m.saving; hasSaving = true }
  }

  return {
    status: reached ? 'plan' : 'not_reachable',
    measures,
    costLo, costHi, hasUnknownCost,
    savingPerYear: hasSaving ? saving : null,
    sapAfter,
  }
}
