/**
 * Small, independent re-statements of ALGORITHM.md definitions (§2, §4.3, §4.4).
 * Nothing here is shared with the solver.
 */
import { ROLES } from '../solver/types'
import type { Interval, Role, Shift, Soldier } from '../solver/types'

/** Half-open intervals [a.start, a.end) and [b.start, b.end) share at least one minute. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/** §2 / §4.4: weight(j) = dayMinutes + α × nightMinutes. */
export function shiftWeight(shift: Shift, nightWeight: number): number {
  const length = shift.end - shift.start
  return length - shift.nightMinutes + nightWeight * shift.nightMinutes
}

/** §4.3: present for j ⇔ not absent at any moment of [start_j, end_j). */
export function isPresent(soldier: Soldier, shift: Interval): boolean {
  return !soldier.absences.some((a) => overlaps(a, shift))
}

/** Required count of a role in a shift (missing role = 0, §3). */
export function required(shift: Shift, role: Role): number {
  return shift.requirements[role] ?? 0
}

/** One entry per seat: the role of every slot of the shift, in ROLES order. */
export function slotsOf(shift: Shift): Role[] {
  const slots: Role[] = []
  for (const role of ROLES) {
    const n = required(shift, role)
    for (let i = 0; i < n; i++) slots.push(role)
  }
  return slots
}
