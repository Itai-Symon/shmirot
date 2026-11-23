/**
 * Certificate of optimality for minimum rest — ALGORITHM.md §6.
 *
 * feasible(X) ⇔ for every point t, the slots of all shifts whose extended interval
 * [start, end + X) contains t can be filled by distinct eligible soldiers.
 * UB = max X with feasible(X). feasible is monotone (larger X ⇒ larger active sets),
 * so UB is found by binary search over integer minutes.
 */

import type { Certificate, Minutes } from './types'

export interface CertificateShift {
  start: Minutes
  end: Minutes
  /**
   * For every slot of the shift, the soldiers (indices) allowed to fill it.
   * Slots with identical eligibility may share the same array.
   */
  slots: readonly (readonly number[])[]
}

/** Is there a matching of distinct soldiers for all slots of all shifts active at each point? */
export function feasibleAt(shifts: readonly CertificateShift[], nSoldiers: number, x: Minutes): boolean {
  const withSlots = shifts.filter((s) => s.slots.length > 0)
  // Maximal cliques of an interval family occur at left endpoints, so the shift starts suffice.
  const points = [...new Set(withSlots.map((s) => s.start))].sort((a, b) => a - b)
  for (const t of points) {
    const active: (readonly number[])[] = []
    for (const s of withSlots) {
      if (s.start <= t && t < s.end + x) active.push(...s.slots)
    }
    if (active.length > nSoldiers) return false
    if (!allSlotsMatchable(active, nSoldiers)) return false
  }
  return true
}

/** Kuhn's augmenting-path bipartite matching: can every slot get its own soldier? */
function allSlotsMatchable(slots: readonly (readonly number[])[], nSoldiers: number): boolean {
  const slotOfSoldier = new Int32Array(nSoldiers).fill(-1)
  const visited = new Uint8Array(nSoldiers)
  const tryAssign = (slot: number): boolean => {
    for (const s of slots[slot]) {
      if (visited[s]) continue
      visited[s] = 1
      if (slotOfSoldier[s] === -1 || tryAssign(slotOfSoldier[s])) {
        slotOfSoldier[s] = slot
        return true
      }
    }
    return false
  }
  for (let k = 0; k < slots.length; k++) {
    visited.fill(0)
    if (!tryAssign(k)) return false
  }
  return true
}

/**
 * Largest X with feasibleAt(X), searching from `achieved` (which the produced schedule
 * itself witnesses). Returns null when the bound cannot be stated: the witness check
 * fails (only possible with contradictory locked input) or feasibility never fails,
 * i.e. a schedule in which nobody guards twice exists, so minimum rest is unbounded.
 */
export function restUpperBound(
  shifts: readonly CertificateShift[],
  nSoldiers: number,
  achieved: Minutes,
): Minutes | null {
  const withSlots = shifts.filter((s) => s.slots.length > 0)
  if (withSlots.length === 0) return null
  if (!feasibleAt(withSlots, nSoldiers, achieved)) return null
  const maxStart = Math.max(...withSlots.map((s) => s.start))
  const minEnd = Math.min(...withSlots.map((s) => s.end))
  // At X = hi every extended interval contains maxStart, so all slots conflict pairwise.
  const hi = Math.max(achieved + 1, maxStart - minEnd + 1)
  if (feasibleAt(withSlots, nSoldiers, hi)) return null
  let lo = achieved // feasible
  let bad = hi // infeasible
  while (bad - lo > 1) {
    const mid = lo + Math.floor((bad - lo) / 2)
    if (feasibleAt(withSlots, nSoldiers, mid)) lo = mid
    else bad = mid
  }
  return lo
}

export function buildCertificate(
  shifts: readonly CertificateShift[],
  nSoldiers: number,
  achieved: Minutes | null,
  hasShortages: boolean,
): Certificate {
  if (achieved === null || hasShortages) {
    return { achievedMinRestMinutes: achieved, upperBoundMinRestMinutes: null, provenOptimal: false }
  }
  const ub = restUpperBound(shifts, nSoldiers, achieved)
  return {
    achievedMinRestMinutes: achieved,
    upperBoundMinRestMinutes: ub,
    provenOptimal: ub !== null && ub === achieved,
  }
}
