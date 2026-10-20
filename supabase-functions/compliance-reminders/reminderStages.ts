// Staged reminder schedule for compliance items.
//
// The cron runs daily, but an item should only email at milestones, not
// every day of its window. Marketing / onboarding / trial emails promise
// alerts "at 90, 60, 30 and 7 days"; previously the function emailed
// every 24h from reminder_days out until 30 days past expiry (up to ~60
// emails per certificate).
//
// Stages, most distant first:
//   reminder_days (the item's own "remind me N days before")
//   then each of 90 / 60 / 30 / 7 / 0 that falls inside that window
//   then weekly after expiry: -7, -14, -21, -28
// Past -30 days we stop nagging altogether.
//
// Pure — no Deno APIs — so the vitest suite can import it directly.

const PRE_EXPIRY = [90, 60, 30, 7, 0]
const POST_EXPIRY = [-7, -14, -21, -28]
export const OVERDUE_CUTOFF = -30
const DAY_MS = 24 * 60 * 60 * 1000

export function reminderStages(reminderDays: number | null | undefined): number[] {
  const start = Number.isFinite(reminderDays) && (reminderDays as number) >= 0 ? (reminderDays as number) : 30
  const set = new Set([start, ...PRE_EXPIRY.filter(m => m < start), ...POST_EXPIRY])
  return [...set].sort((a, b) => b - a)
}

// Index of the deepest stage crossed when `days` remain until expiry, or
// -1 if the item is still outside its reminder window.
export function stageIndex(days: number, stages: number[]): number {
  let idx = -1
  for (let i = 0; i < stages.length; i++) if (days <= stages[i]) idx = i
  return idx
}

// Whole days between two dates' local midnights (b - a).
function dayDiff(a: Date, b: Date): number {
  const x = new Date(a); x.setHours(0, 0, 0, 0)
  const y = new Date(b); y.setHours(0, 0, 0, 0)
  return Math.round((y.getTime() - x.getTime()) / DAY_MS)
}

// Should this item email today? `days` is days until expiry as of `now`.
// We send when the item has entered a new stage since the last reminder.
// Days-until-expiry at the last send is reconstructed from the send date,
// so a missed cron day still fires on the next run, and a renewed
// certificate (expiry pushed out, then back into the window) starts over.
export function shouldRemind(opts: {
  days: number
  reminderDays: number | null | undefined
  lastSentAt: string | null | undefined
  now?: Date
}): boolean {
  const { days, reminderDays, lastSentAt } = opts
  const now = opts.now ?? new Date()
  if (days < OVERDUE_CUTOFF) return false
  const stages = reminderStages(reminderDays)
  const current = stageIndex(days, stages)
  if (current < 0) return false
  if (!lastSentAt) return true
  const last = new Date(lastSentAt)
  if (Number.isNaN(last.getTime())) return true
  // At most one email per item per daily run. 20h rather than 24h so cron
  // start-time jitter can't push a milestone email back a day.
  if (now.getTime() - last.getTime() < 20 * 60 * 60 * 1000) return false
  const daysAtLastSend = days + dayDiff(last, now)
  return stageIndex(daysAtLastSend, stages) !== current
}
