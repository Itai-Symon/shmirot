/**
 * Solver speed on realistic platoons: `npm run bench`.
 * Real shift generator (Asia/Jerusalem), real solver, same code the phone runs in its worker.
 */
import { describe, it } from 'vitest'
import { solve } from '../src/solver'
import type { Soldier, SolverInput } from '../src/solver/types'
import { generateShifts, type PostConfig } from '../src/storage/shiftGenerator'

function platoon(n: number, commanders: number): Soldier[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${String(i).padStart(3, '0')}`,
    roles: i < commanders ? ['commander', 'soldier'] : i % 7 === 0 ? ['soldier', 'medic'] : ['soldier'],
    absences: i % 10 === 3 ? [{ start: 24 * 60 * 2, end: 24 * 60 * 4 }] : [],
  }))
}

function input(soldiers: number, days: number, posts: PostConfig[], split = false): SolverInput {
  const g = generateShifts({
    start: '2026-12-01T20:00',
    end: `2026-12-${String(1 + days).padStart(2, '0')}T20:00`,
    timeZone: 'Asia/Jerusalem',
    shiftMinutes: 240,
    split: split ? { fromHour: 22, toHour: 6, nightShiftMinutes: 120 } : null,
    posts,
  })
  return { soldiers: platoon(soldiers, 4), shifts: g.shifts, params: { minRestMinutes: 240, nightWeight: 1.5 }, locked: [] }
}

const threePosts: PostConfig[] = [
  { requirements: { commander: 1, soldier: 1 }, activeWindow: null },
  { requirements: { soldier: 2 }, activeWindow: null },
  { requirements: { soldier: 1 }, activeWindow: { fromHour: 20, toHour: 6 } },
]
const fivePosts: PostConfig[] = [...threePosts, { requirements: { soldier: 2 }, activeWindow: null }, { requirements: { medic: 1 }, activeWindow: null }]

const week = input(30, 7, threePosts, true)
const twoWeeks = input(60, 14, fivePosts, true)

// Re-plan from the middle: first half locked, as after "went home".
const firstRun = solve(week)
const mid = 24 * 60 * 3
const startedIds = new Set(week.shifts.filter((s) => s.start < mid).map((s) => s.id))
const replanInput: SolverInput = {
  ...week,
  shifts: week.shifts.map((s) => {
    if (!startedIds.has(s.id)) return s
    const req: Record<string, number> = {}
    for (const a of firstRun.assignments) if (a.shiftId === s.id) req[a.role] = (req[a.role] ?? 0) + 1
    return { ...s, requirements: req }
  }),
  locked: firstRun.assignments.filter((a) => startedIds.has(a.shiftId)).map(({ shiftId, soldierId, role }) => ({ shiftId, soldierId, role })),
}

function time(label: string, fn: () => unknown, runs: number): void {
  fn() // warm-up
  const ms: number[] = []
  for (let k = 0; k < runs; k++) {
    const t0 = performance.now()
    fn()
    ms.push(performance.now() - t0)
  }
  ms.sort((a, b) => a - b)
  const median = ms[Math.floor(ms.length / 2)]
  process.stdout.write(`${label.padEnd(58)} median ${median.toFixed(1).padStart(7)} ms   max ${ms[ms.length - 1].toFixed(1).padStart(7)} ms   (${runs} runs)\n`)
}

describe('solver speed', () => {
  it('prints timings', () => {
    process.stdout.write(`week: ${week.shifts.length} shifts, two weeks: ${twoWeeks.shifts.length} shifts\n`)
    time('30 soldiers · 3 posts · 7 days · day/night split', () => solve(week), 20)
    time('re-plan mid-week after "went home" (half locked)', () => solve(replanInput), 20)
    time('60 soldiers · 5 posts · 14 days · day/night split', () => solve(twoWeeks), 5)
  })
})
