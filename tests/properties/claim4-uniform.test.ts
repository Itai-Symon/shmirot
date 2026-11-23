/**
 * Layer B — Claim 4 (uniform setting), ALGORITHM.md §5 and §8.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SolverOutput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'
import { uniformArb } from './arbitraries'

const RUNS = { seed: 4001, numRuns: 150 }

/** Shift start per id, to order assignments in time. */
function countsByPrefix(out: SolverOutput, starts: Map<string, number>, soldierIds: string[]): Map<string, number>[] {
  const times = [...new Set(starts.values())].sort((a, b) => a - b)
  return times.map((t) => {
    const counts = new Map(soldierIds.map((id) => [id, 0]))
    for (const a of out.assignments) if (starts.get(a.shiftId)! <= t) counts.set(a.soldierId, counts.get(a.soldierId)! + 1)
    return counts
  })
}

describe('Claim 4 — uniform setting', () => {
  it('achieved min rest equals (⌊N/K⌋ − 1)·L exactly, and the certificate says proven optimal', () => {
    fc.assert(
      fc.property(uniformArb, ({ n, k, len, input }) => {
        const out = runAndVerify(input)
        const optimum = (Math.floor(n / k) - 1) * len
        expect(out.shortages).toEqual([])
        expect(out.certificate.achievedMinRestMinutes).toBe(optimum)
        expect(out.certificate.upperBoundMinRestMinutes).toBe(optimum)
        expect(out.certificate.provenOptimal).toBe(true)
      }),
      RUNS,
    )
  })

  it('shift counts differ by at most 1 — at the end and after every shift (Claim 4c)', () => {
    fc.assert(
      fc.property(uniformArb, ({ input }) => {
        const out = runAndVerify(input)
        const starts = new Map(input.shifts.map((s) => [s.id, s.start]))
        for (const counts of countsByPrefix(out, starts, input.soldiers.map((s) => s.id))) {
          const values = [...counts.values()]
          expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
        }
        const final = out.stats.map((s) => s.shiftCount)
        expect(Math.max(...final) - Math.min(...final)).toBeLessThanOrEqual(1)
      }),
      RUNS,
    )
  })

  it('feasibility corollary: rest target met ⇔ N ≥ K·(r + 1)', () => {
    fc.assert(
      fc.property(uniformArb, ({ n, k, len, rest, input }) => {
        const out = runAndVerify(input)
        const r = Math.ceil(rest / len)
        const totalDebt = out.assignments.reduce((sum, a) => sum + a.restDebtMinutes, 0)
        if (n >= k * (r + 1)) expect(totalDebt).toBe(0)
        else expect(totalDebt).toBeGreaterThan(0)
      }),
      RUNS,
    )
  })
})
