import { reminderStages, stageIndex, shouldRemind } from '../../../supabase-functions/compliance-reminders/reminderStages.ts'

const NOW = new Date('2026-10-19T07:00:00Z')
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString()

// Simulate the daily cron across an item's life and return the
// days-until-expiry on which an email went out.
function simulate(reminderDays, from = 120) {
  const sent = []
  let last = null
  for (let days = from; days >= -40; days--) {
    const offset = from - days
    const now = new Date(NOW.getTime() + offset * 86400000)
    if (shouldRemind({ days, reminderDays, lastSentAt: last, now })) {
      sent.push(days)
      last = now.toISOString()
    }
  }
  return sent
}

describe('compliance reminder stages', () => {
  it('builds stages from the item window down', () => {
    expect(reminderStages(90)).toEqual([90, 60, 30, 7, 0, -7, -14, -21, -28])
    expect(reminderStages(30)).toEqual([30, 7, 0, -7, -14, -21, -28])
    expect(reminderStages(45)).toEqual([45, 30, 7, 0, -7, -14, -21, -28])
    expect(reminderStages(null)).toEqual(reminderStages(30))
  })

  it('stageIndex is -1 outside the window', () => {
    const s = reminderStages(30)
    expect(stageIndex(31, s)).toBe(-1)
    expect(stageIndex(30, s)).toBe(0)
    expect(stageIndex(8, s)).toBe(0)
    expect(stageIndex(7, s)).toBe(1)
  })

  it('emails only at milestones, not daily', () => {
    expect(simulate(90)).toEqual([90, 60, 30, 7, 0, -7, -14, -21, -28])
    expect(simulate(30)).toEqual([30, 7, 0, -7, -14, -21, -28])
  })

  it('first run inside the window sends once, then waits for the next stage', () => {
    expect(shouldRemind({ days: 20, reminderDays: 30, lastSentAt: null, now: NOW })).toBe(true)
    expect(shouldRemind({ days: 19, reminderDays: 30, lastSentAt: daysAgo(1), now: NOW })).toBe(false)
  })

  it('catches up a milestone missed by a skipped cron day', () => {
    // Last sent at 30 days out; cron didn't run on day 7; today is day 6.
    expect(shouldRemind({ days: 6, reminderDays: 30, lastSentAt: daysAgo(24), now: NOW })).toBe(true)
  })

  it('restarts after renewal pushes expiry back out', () => {
    // Reminded 5 days ago at 7 days out; cert renewed, now 30 days out again.
    expect(shouldRemind({ days: 30, reminderDays: 30, lastSentAt: daysAgo(5), now: NOW })).toBe(true)
  })

  it('stops after 30 days overdue and never sends twice in a day', () => {
    expect(shouldRemind({ days: -31, reminderDays: 30, lastSentAt: null, now: NOW })).toBe(false)
    expect(shouldRemind({ days: 7, reminderDays: 30, lastSentAt: new Date(NOW.getTime() - 3600000).toISOString(), now: NOW })).toBe(false)
  })
})
