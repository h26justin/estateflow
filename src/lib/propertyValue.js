// ── PROPERTY VALUE ────────────────────────────────────────────────────────
// Single source of truth for "what is this property worth right now".
//
// A property carries two value fields:
//   est_value     — the estimate entered on the property form at purchase
//   current_value — set by the portfolio valuation flow (with
//                   value_updated_at) whenever the owner revalues
//
// Every calculation that needs the property's value — portfolio totals,
// equity, LTV, value-basis yields, reports and their exports — must prefer
// the valuation-flow figure and fall back to the original estimate. Reading
// est_value directly is only correct in the property form itself and in
// rows explicitly labelled "Estimated Value".
export const propValue = p => p?.current_value || p?.est_value || 0
