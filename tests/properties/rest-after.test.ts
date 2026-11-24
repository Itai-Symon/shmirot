/**
 * D9 — rest after a task: the rest a soldier needs is set by the task he just finished.
 * Random inputs with per-task rest targets must pass the independent verifier (which
 * recomputes every rest debt with the same rule), and a worked example shows the effect.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SolverInput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'
import { generalArb } from './arbitraries'

describe('rest after task (D9)', () => {
  it('random per-task rest targets: verifier agrees with every rest debt', () => {
    fc.assert(
      fc.property(generalArb({ withLocks: true }), fc.array(fc.integer({ min: 0, max: 16 }).map((x) => x * 30), { minLength: 4, maxLength: 4 }), (input, rests) => {
        runAndVerify({ ...input, shifts: input.shifts.map((s) => ({ ...s, restAfterMinutes: rests[s.postIndex % rests.length] })) })
      }),
      { seed: 11001, numRuns: 150 },
    )
  })

  it('after a long patrol the soldier rests longer than after a post', () => {
    // Post 0 (rest 2 h) and post 1 = patrol (rest 8 h), 2 h shifts, one seat each. A patrol ties a
    // soldier up for 5 slots, a post for 2, so 7 soldiers are needed; 8 leaves slack.
    const shifts = []
    for (let k = 0; k < 6; k++) {
      for (const post of [0, 1]) {
        shifts.push({ id: `p${post}-${k}`, postIndex: post, start: k * 120, end: k * 120 + 120, nightMinutes: 0, restAfterMinutes: post === 1 ? 480 : 120, requirements: { soldier: 1 } })
      }
    }
    const input: SolverInput = {
      soldiers: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, roles: ['soldier'], absences: [] })),
      shifts,
      params: { minRestMinutes: 120, nightWeight: 1 },
      locked: [],
    }
    const out = runAndVerify(input)
    const byId = new Map(shifts.map((s) => [s.id, s]))
    for (const sol of input.soldiers) {
      const mine = out.assignments.filter((a) => a.soldierId === sol.id).map((a) => byId.get(a.shiftId)!).sort((a, b) => a.start - b.start)
      for (let k = 1; k < mine.length; k++) {
        if (mine[k - 1].postIndex === 1) expect(mine[k].start - mine[k - 1].end, `${sol.id} after patrol`).toBeGreaterThanOrEqual(480)
      }
    }
    expect(out.assignments.every((a) => a.restDebtMinutes === 0)).toBe(true)
  })
})
