/**
 * "Why him?" (ALGORITHM.md §4.6): the explanation must agree with the schedule, and in a
 * single-role shift the chosen soldiers are exactly the best-ranked eligible ones.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { explain } from '../../src/solver'
import { runAndVerify } from '../helpers/solve'
import { claim5Arb, generalArb } from './arbitraries'

describe('explain()', () => {
  it('agrees with the schedule on every shift', () => {
    fc.assert(
      fc.property(generalArb({ withLocks: true }), (input) => {
        const out = runAndVerify(input)
        for (const shift of input.shifts.slice(0, 6)) {
          const ex = explain(input, shift.id)!
          const chosen = ex.candidates.filter((c) => c.status === 'chosen').map((c) => `${c.soldierId}|${c.role}`).sort()
          const actual = out.assignments.filter((a) => a.shiftId === shift.id).map((a) => `${a.soldierId}|${a.role}`).sort()
          expect(chosen).toEqual(actual)
          expect(ex.candidates).toHaveLength(input.soldiers.length)
          for (const c of ex.candidates) {
            const s = input.soldiers.find((x) => x.id === c.soldierId)!
            if (c.status === 'absent') expect(s.absences.some((a) => a.start < shift.end && shift.start < a.end)).toBe(true)
          }
        }
      }),
      { seed: 9001, numRuns: 100 },
    )
  })

  it('single role, aligned: chosen = the best-ranked eligible soldiers', () => {
    fc.assert(
      fc.property(claim5Arb('random'), (input) => {
        const one = { ...input, shifts: input.shifts.filter((s) => s.postIndex === 0) }
        if (Object.keys(one.shifts[0]?.requirements ?? {}).length !== 1) return
        for (const shift of one.shifts.slice(0, 8)) {
          const ex = explain(one, shift.id)!
          const ranked = ex.candidates.filter((c) => c.rank !== undefined).sort((a, b) => a.rank! - b.rank!)
          const k = ex.candidates.filter((c) => c.status === 'chosen').length
          expect(ranked.slice(0, k).every((c) => c.status === 'chosen')).toBe(true)
        }
      }),
      { seed: 9002, numRuns: 100 },
    )
  })

  it('unknown shift ⇒ null', () => {
    expect(explain({ soldiers: [], shifts: [], params: { minRestMinutes: 0, nightWeight: 1 }, locked: [] }, 'x')).toBeNull()
  })
})
