/**
 * Carried-in history (ALGORITHM.md §4.2, Claim 5'): a new board continues where the old one
 * stopped, and fairness keeps working from an uneven start.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SoldierHistory, SolverInput, SolverOutput } from '../../src/solver/types'
import { weightOf } from '../helpers/shifts'
import { runAndVerify } from '../helpers/solve'
import { claim5Arb } from './arbitraries'

/** History after running `out` on `input`, as seen from minute `split`. */
function historyAt(input: SolverInput, out: SolverOutput, split: number, prev: SoldierHistory[] = []): SoldierHistory[] {
  const byId = new Map(input.shifts.map((s) => [s.id, s]))
  return input.soldiers.map((s) => {
    const st = out.stats.find((x) => x.soldierId === s.id)!
    const p = prev.find((x) => x.soldierId === s.id)
    const mine = out.assignments.filter((a) => a.soldierId === s.id).map((a) => byId.get(a.shiftId)!)
    const lastEnd = mine.length ? Math.max(...mine.map((x) => x.end)) : (p?.lastEnd ?? null)
    const running = mine.filter((x) => x.start < split && x.end > split)
    return {
      soldierId: s.id,
      load: (p?.load ?? 0) + st.load,
      fairShare: (p?.fairShare ?? 0) + st.fairShare,
      lastEnd,
      busyUntil: running.length ? Math.max(...running.map((x) => x.end)) : null,
    }
  })
}

describe('carried-in history', () => {
  it('aligned schedules: solving in two parts with history = solving at once', () => {
    fc.assert(
      fc.property(claim5Arb('random'), fc.integer({ min: 1, max: 30 }), (input, cut) => {
        const starts = [...new Set(input.shifts.map((s) => s.start))].sort((a, b) => a - b)
        if (starts.length < 2) return
        const split = starts[Math.min(cut, starts.length - 1)]
        const whole = runAndVerify(input)
        const first: SolverInput = { ...input, shifts: input.shifts.filter((s) => s.start < split) }
        const second: SolverInput = { ...input, shifts: input.shifts.filter((s) => s.start >= split) }
        const a = runAndVerify(first)
        const b = runAndVerify({ ...second, history: historyAt(first, a, split) })
        expect([...a.assignments, ...b.assignments]).toEqual(whole.assignments)
      }),
      { seed: 8001, numRuns: 150 },
    )
  })

  it("Claim 5': from an uneven start, spread of total deviation never exceeds max(initial spread, w_max)", () => {
    fc.assert(
      fc.property(claim5Arb('zero'), fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 1, maxLength: 40 }), (input, offsets) => {
        const history: SoldierHistory[] = input.soldiers.map((s, i) => ({
          soldierId: s.id,
          load: offsets[i % offsets.length],
          fairShare: 0,
          lastEnd: null,
          busyUntil: null,
        }))
        const out = runAndVerify({ ...input, history })
        const alpha = input.params.nightWeight
        const wMax = Math.max(0, ...input.shifts.map((s) => weightOf(s, alpha)))
        const d0 = Math.max(...history.map((h) => h.load)) - Math.min(...history.map((h) => h.load))
        const bound = Math.max(d0, wMax)
        const byId = new Map(input.shifts.map((s) => [s.id, s]))
        const times = [...new Set(input.shifts.map((s) => s.start))].sort((a, b) => a - b)
        for (const t of times) {
          const total = new Map(history.map((h) => [h.soldierId, h.load]))
          for (const a of out.assignments) {
            const sh = byId.get(a.shiftId)!
            if (sh.start <= t) total.set(a.soldierId, total.get(a.soldierId)! + weightOf(sh, alpha))
          }
          const v = [...total.values()]
          expect(Math.max(...v) - Math.min(...v), `spread after ${t}`).toBeLessThanOrEqual(bound + 1e-9)
        }
      }),
      { seed: 8002, numRuns: 150 },
    )
  })

  it('a soldier still in an old shift is not booked; rest is measured from the old shift', () => {
    const shifts = [0, 120, 240].map((start, i) => ({
      id: `p0-${i}`, postIndex: 0, start, end: start + 120, nightMinutes: 0, requirements: { soldier: 1 },
    }))
    const soldiers = ['a', 'b'].map((id) => ({ id, roles: ['soldier'], absences: [] }))
    const out = runAndVerify({
      soldiers, shifts, params: { minRestMinutes: 240, nightWeight: 1 }, locked: [],
      history: [
        { soldierId: 'a', load: 0, fairShare: 0, lastEnd: 60, busyUntil: 60 }, // finishing an old shift at 01:00
        { soldierId: 'b', load: 0, fairShare: 0, lastEnd: null, busyUntil: null },
      ],
    })
    expect(out.assignments[0].soldierId).toBe('b')
    const aFirst = out.assignments.find((x) => x.soldierId === 'a')!
    expect(aFirst.shiftId).toBe('p0-1')
    expect(aFirst.restDebtMinutes).toBe(240 - (120 - 60))
  })
})
