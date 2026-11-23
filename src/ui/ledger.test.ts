import { describe, expect, it } from 'vitest'
import { solve as solveSync } from '../solver'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { emptyLedger, foldPlan, soldierNow, toHistory, type Ledger } from './ledger'
import { createPlan } from './planner'

// Invented names only.
const soldiers: SoldierRecord[] = ['א', 'ב', 'ג', 'ד', 'ה'].map((name, i) => ({ id: `s${i}`, name, roles: ['soldier'], order: i }))
const settings: ActivitySettings = {
  start: '2026-11-23T20:00',
  end: '2026-11-24T20:00',
  timeZone: 'Asia/Jerusalem',
  shiftMinutes: 120,
  split: null,
  restMinutes: 240,
  nightWeight: 2,
  durationHours: 24,
  posts: [{ requirements: { soldier: 1 }, activeWindow: null }],
}
const solve = async (i: Parameters<typeof solveSync>[0]) => solveSync(i)
const MIN = 60_000
const empty = () => new Map<string, Ledger>(soldiers.map((s) => [s.id, emptyLedger()]))

async function plan(s = settings, history?: Parameters<typeof createPlan>[4]): Promise<Plan> {
  const p = await createPlan(s, soldiers, solve, undefined, history)
  if (typeof p === 'string') throw new Error(p)
  return p
}

describe('ledger', () => {
  it('folding mid-shift counts the running shift whole and keeps its soldier busy', async () => {
    const p = await plan()
    const now = p.generated.startEpochMs + 330 * MIN // 01:30, inside 00:00–02:00
    const l = foldPlan(empty(), p, now)
    const guard = [...l.values()].reduce((n, x) => n + x.dayGuardMinutes + x.nightGuardMinutes, 0)
    expect(guard).toBe(6 * 60) // 20, 22 and the running 00:00 shift, whole
    const running = [...l.entries()].find(([, x]) => x.busyUntilMs !== null)!
    expect(running[1].busyUntilMs).toBe(p.generated.startEpochMs + 360 * MIN)
    // Fair share of the stretch equals the weighted guard done in it (everyone was present).
    const w = [...l.values()].reduce((n, x) => n + x.weightedLoad, 0)
    const f = [...l.values()].reduce((n, x) => n + x.fairShare, 0)
    expect(f).toBeCloseTo(w, 6)
    expect([...l.values()].every((x) => x.fieldMinutes === 330)).toBe(true)
  })

  it('history is relative to the new board and steers the next board', async () => {
    const p = await plan()
    const now = p.generated.startEpochMs + 330 * MIN
    const ledgers = foldPlan(empty(), p, now)
    const next = await plan({ ...settings, start: '2026-11-24T02:00', end: '2026-11-25T02:00' }, (start) => toHistory(ledgers, start))
    const h = next.history!
    const busy = h.find((x) => x.busyUntil !== null)!
    expect(busy.busyUntil).toBe(0) // the old 00:00–02:00 shift ends exactly when the new board starts
    // Whoever had the most weighted load before is not first on the new board.
    const heaviest = [...ledgers.entries()].sort((a, b) => b[1].weightedLoad - a[1].weightedLoad)[0][0]
    expect(next.output.assignments[0].soldierId).not.toBe(heaviest)
  })

  it('soldierNow = ledger + elapsed part of the current board; load index uses field time only', async () => {
    const p = await plan()
    const now = p.generated.startEpochMs + 600 * MIN
    const n = soldierNow('s0', emptyLedger(), p, now)
    expect(n.dayGuardMinutes + n.nightGuardMinutes + n.restMinutes + n.homeMinutes).toBe(600)
    const withLedger = soldierNow('s0', { ...emptyLedger(), dayGuardMinutes: 60, fieldMinutes: 120, weightedLoad: 60 }, p, now)
    expect(withLedger.dayGuardMinutes).toBe(n.dayGuardMinutes + 60)
    expect(soldierNow('s0', emptyLedger(), undefined, now).loadIndex).toBeNull()
  })
})
