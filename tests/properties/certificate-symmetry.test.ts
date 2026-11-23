/**
 * Layer B — certificate soundness, input-order symmetry, and Claims 1–3 on general inputs
 * (every run passes through the verifier).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SoldierStats, SolverInput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'
import { generalArb } from './arbitraries'

describe('certificate', () => {
  it('achieved ≤ UB, always', () => {
    fc.assert(
      fc.property(generalArb({ withLocks: true }), (input) => {
        const { certificate: c } = runAndVerify(input)
        if (c.achievedMinRestMinutes !== null && c.upperBoundMinRestMinutes !== null) {
          expect(c.achievedMinRestMinutes).toBeLessThanOrEqual(c.upperBoundMinRestMinutes)
        }
        if (c.provenOptimal) expect(c.achievedMinRestMinutes).toBe(c.upperBoundMinRestMinutes)
      }),
      { seed: 6001, numRuns: 200 },
    )
  })
})

describe('symmetry', () => {
  const statsKey = (s: SoldierStats) => JSON.stringify([s.load, s.fairShare, s.deviation, s.shiftCount, s.nightMinutes, s.minRestMinutes, s.totalRestDebtMinutes])

  it('permuting soldier order in the input does not change the multiset of per-soldier stats', () => {
    const arb = generalArb({ withLocks: true }).chain((input) =>
      fc.shuffledSubarray(input.soldiers, { minLength: input.soldiers.length, maxLength: input.soldiers.length }).map((perm): [SolverInput, SolverInput] => [
        input,
        { ...input, soldiers: perm },
      ]),
    )
    fc.assert(
      fc.property(arb, ([a, b]) => {
        const sa = runAndVerify(a).stats.map(statsKey).sort()
        const sb = runAndVerify(b).stats.map(statsKey).sort()
        expect(sb).toEqual(sa)
      }),
      { seed: 6002, numRuns: 150 },
    )
  })
})

describe('Claims 1–3 on general inputs', () => {
  it('always returns a schedule that the verifier accepts (with and without past locks)', () => {
    fc.assert(
      fc.property(fc.boolean().chain((withLocks) => generalArb({ withLocks })), (input) => {
        const out = runAndVerify(input)
        expect(out.stats).toHaveLength(input.soldiers.length)
      }),
      { seed: 6003, numRuns: 300 },
    )
  })
})
