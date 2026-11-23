/**
 * Independent implementation of the certificate upper bound, ALGORITHM.md §6.
 *
 * feasible(X) ⇔ for every point t, the slots of all shifts whose extended interval
 * [start, end + X) contains t can be filled by distinct qualified soldiers who are present
 * for their shift. It is enough to test t = every shift start: the set of intervals that
 * contain any point t also contains the latest start among them.
 */
import type { Shift, SolverInput } from '../solver/types'
import { maxBipartiteMatching } from './matching'
import { isPresent, slotsOf } from './model'

export type UpperBound =
  /** UB = value (minutes). */
  | { kind: 'bounded'; value: number }
  /** feasible(X) for every X: distinct soldiers could cover every slot, no rest pair is forced. */
  | { kind: 'unbounded' }
  /** feasible(0) fails: some point in time cannot be fully staffed, so shortages are unavoidable. */
  | { kind: 'infeasible' }

export function feasibleRest(input: SolverInput, x: number): boolean {
  const shifts = input.shifts.filter((s) => slotsOf(s).length > 0)
  const starts = [...new Set(shifts.map((s) => s.start))]
  for (const t of starts) {
    const active = shifts.filter((s) => s.start <= t && t < s.end + x)
    if (!canStaffDistinct(input, active)) return false
  }
  return true
}

/** All slots of `shifts` can be filled with pairwise distinct, qualified, present soldiers. */
export function canStaffDistinct(input: SolverInput, shifts: readonly Shift[]): boolean {
  const adj: number[][] = []
  for (const shift of shifts) {
    const present = input.soldiers.map((s) => isPresent(s, shift))
    for (const role of slotsOf(shift)) {
      const edges: number[] = []
      input.soldiers.forEach((soldier, i) => {
        if (present[i] && soldier.roles.includes(role)) edges.push(i)
      })
      adj.push(edges)
    }
  }
  return maxBipartiteMatching(adj, input.soldiers.length).size === adj.length
}

export function upperBoundMinRest(input: SolverInput): UpperBound {
  const shifts = input.shifts.filter((s) => slotsOf(s).length > 0)
  if (shifts.length === 0) return { kind: 'unbounded' }

  const maxStart = Math.max(...shifts.map((s) => s.start))
  const minEnd = Math.min(...shifts.map((s) => s.end))
  // With X ≥ allOverlap every extended interval contains maxStart; larger X changes nothing.
  const allOverlap = Math.max(0, maxStart - minEnd + 1)

  if (feasibleRest(input, allOverlap)) return { kind: 'unbounded' }
  if (!feasibleRest(input, 0)) return { kind: 'infeasible' }

  // feasible is monotone (non-increasing in X): find the largest feasible X in [0, allOverlap).
  let lo = 0
  let hi = allOverlap - 1
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2)
    if (feasibleRest(input, mid)) lo = mid
    else hi = mid - 1
  }
  return { kind: 'bounded', value: lo }
}
