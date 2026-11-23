/**
 * Layer B — Claim 5: under its conditions, max load − min load ≤ w_max at all times.
 * Conditions: every soldier qualifies for every role, nobody absent, no tired (tier-1)
 * soldier ever chosen. Tier 1 ⇔ rest < R ⇔ restDebt > 0, so "no tier-1 choice" is
 * guaranteed by R = 0 and otherwise read off the output.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SolverInput, SolverOutput } from '../../src/solver/types'
import { weightOf } from '../helpers/shifts'
import { runAndVerify } from '../helpers/solve'
import { claim5Arb } from './arbitraries'

function assertBalanced(input: SolverInput, out: SolverOutput): void {
  const alpha = input.params.nightWeight
  const byId = new Map(input.shifts.map((s) => [s.id, s]))
  const wMax = Math.max(0, ...input.shifts.map((s) => weightOf(s, alpha)))
  const times = [...new Set(input.shifts.map((s) => s.start))].sort((a, b) => a - b)
  // "At all times": after every group of shifts that start together.
  for (const t of times) {
    const loads = new Map(input.soldiers.map((s) => [s.id, 0]))
    for (const a of out.assignments) {
      const sh = byId.get(a.shiftId)!
      if (sh.start <= t) loads.set(a.soldierId, loads.get(a.soldierId)! + weightOf(sh, alpha))
    }
    const v = [...loads.values()]
    expect(Math.max(...v) - Math.min(...v), `spread after time ${t}`).toBeLessThanOrEqual(wMax + 1e-9)
  }
}

describe('Claim 5 — hours balance in any shape of schedule', () => {
  it('R = 0 (never tired): spread ≤ w_max after every shift group', () => {
    fc.assert(
      fc.property(claim5Arb('zero'), (input) => {
        const out = runAndVerify(input)
        expect(out.shortages).toEqual([])
        assertBalanced(input, out)
      }),
      { seed: 5001, numRuns: 150 },
    )
  })

  it('any R, whenever no assignment carries rest debt: spread ≤ w_max', () => {
    fc.assert(
      fc.property(claim5Arb('random'), (input) => {
        const out = runAndVerify(input)
        if (out.assignments.some((a) => a.restDebtMinutes > 0)) return // a tier-1 choice was made: claim does not apply
        assertBalanced(input, out)
      }),
      { seed: 5002, numRuns: 150 },
    )
  })
})
