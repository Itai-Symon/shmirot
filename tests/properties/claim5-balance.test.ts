/**
 * Layer B — Claim 5: under its conditions, max load − min load ≤ w_max at all times.
 * Conditions (ALGORITHM.md §5): aligned shifts, every soldier qualifies for every role,
 * nobody absent, and rest never excludes a candidate — guaranteed by R = 0.
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

describe('Claim 5 — hours balance in aligned schedules', () => {
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

  // R > 0 is deliberately not asserted: with rest first (D3) a lowest-load soldier who is
  // still resting is skipped, which can exceed w_max. ALGORITHM.md §5 Claim 5 therefore only
  // claims the bound when rest never excludes a candidate (R = 0). R > 0 balance is measured
  // against the oracle in Layer C instead.
})

