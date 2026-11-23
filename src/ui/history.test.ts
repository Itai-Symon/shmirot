import { describe, expect, it } from 'vitest'
import { solve as solveSync } from '../solver'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { activityTotals, sumTotals, untilMinute } from './history'
import { createPlan, toggleHome } from './planner'

// Invented names only.
const soldiers: SoldierRecord[] = ['א', 'ב', 'ג', 'ד'].map((name, i) => ({ id: `s${i}`, name, roles: ['soldier'], order: i }))
const settings: ActivitySettings = {
  start: '2026-11-23T20:00',
  end: '2026-11-24T20:00',
  timeZone: 'Asia/Jerusalem',
  shiftMinutes: 120,
  split: null,
  restMinutes: 240,
  durationHours: 24,
  posts: [{ requirements: { soldier: 1 }, activeWindow: null }],
}
const solve = async (i: Parameters<typeof solveSync>[0]) => solveSync(i)
const MIN = 60_000

async function plan(): Promise<Plan> {
  const p = await createPlan(settings, soldiers, solve)
  if (typeof p === 'string') throw new Error(p)
  return p
}
const at = (p: Plan, minute: number) => p.generated.startEpochMs + minute * MIN

describe('history', () => {
  it('before the start nothing has happened', async () => {
    const p = await plan()
    const totals = activityTotals({ plan: p, closedAtMinute: null }, at(p, -30))
    expect(totals.every((x) => x.dayGuardMinutes + x.nightGuardMinutes + x.restMinutes + x.homeMinutes === 0)).toBe(true)
  })

  it('whole activity: guard minutes add up to 24 h, night is 6 h, everyone accounted for', async () => {
    const p = await plan()
    const totals = activityTotals({ plan: p, closedAtMinute: null }, at(p, 10_000))
    const guard = totals.reduce((n, x) => n + x.dayGuardMinutes + x.nightGuardMinutes, 0)
    expect(guard).toBe(24 * 60)
    expect(totals.reduce((n, x) => n + x.nightGuardMinutes, 0)).toBe(6 * 60)
    for (const x of totals) expect(x.dayGuardMinutes + x.nightGuardMinutes + x.restMinutes + x.homeMinutes).toBe(24 * 60)
  })

  it('a shift in progress counts only its elapsed part, split into day and night', async () => {
    const p = await plan()
    // 20:00 + 5h30 = 01:30: shifts 20,22 done, 00:00–02:00 in progress for 90 minutes (night).
    const totals = activityTotals({ plan: p, closedAtMinute: null }, at(p, 330))
    expect(totals.reduce((n, x) => n + x.dayGuardMinutes, 0)).toBe(240)
    expect(totals.reduce((n, x) => n + x.nightGuardMinutes, 0)).toBe(90)
  })

  it('home time comes from absences and is not rest', async () => {
    const p0 = await plan()
    const p1 = await toggleHome(p0, soldiers, 's3', 120, solve) // s3 goes home at 22:00
    const totals = activityTotals({ plan: p1, closedAtMinute: null }, at(p1, 600))
    const s3 = totals.find((x) => x.soldierId === 's3')!
    expect(s3.homeMinutes).toBe(480)
    expect(s3.dayGuardMinutes + s3.nightGuardMinutes + s3.restMinutes + s3.homeMinutes).toBe(600)
  })

  it('a replaced activity stops counting where it was closed', async () => {
    const p = await plan()
    expect(untilMinute({ plan: p, closedAtMinute: 200 }, at(p, 900))).toBe(200)
    const closed = activityTotals({ plan: p, closedAtMinute: 200 }, at(p, 900))
    expect(closed.reduce((n, x) => n + x.dayGuardMinutes + x.nightGuardMinutes, 0)).toBe(200)
  })

  it('sumTotals adds activities per soldier', async () => {
    const p = await plan()
    const a = activityTotals({ plan: p, closedAtMinute: null }, at(p, 10_000))
    const sum = sumTotals([a, a])
    for (const x of sum) {
      const one = a.find((y) => y.soldierId === x.soldierId)!
      expect(x.dayGuardMinutes).toBe(2 * one.dayGuardMinutes)
      expect(x.restMinutes).toBe(2 * one.restMinutes)
      expect(x.shifts).toBe(2 * one.shifts)
    }
  })
})

describe('history — replacing a running activity', () => {
  it('the new activity counts only from the replacement moment, so nothing is counted twice', async () => {
    const p = await plan()
    const replacedAt = at(p, 300)
    const old = activityTotals({ plan: p, closedAtMinute: 300 }, at(p, 600))
    const next = { ...p, countFromMs: replacedAt }
    const fresh = activityTotals({ plan: next, closedAtMinute: null }, at(p, 600))
    const total = sumTotals([old, fresh])
    for (const x of total) expect(x.dayGuardMinutes + x.nightGuardMinutes + x.restMinutes + x.homeMinutes).toBe(600)
    expect(total.reduce((n, x) => n + x.dayGuardMinutes + x.nightGuardMinutes, 0)).toBe(600)
  })
})
