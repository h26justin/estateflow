// Stable React keys for client-side editable rows that have no database id
// yet (allocation splits, checklist lines, ...). Index keys make React
// reuse the wrong row's DOM / input state when a middle row is removed,
// so a half-typed amount can jump to the neighbouring line. Persist an
// explicit field list (or strip `_key`) rather than the row object as-is.
let seq = 0
export const rowKey = () => `row-${++seq}`

