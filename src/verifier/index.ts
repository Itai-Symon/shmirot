/**
 * Independent verifier — ALGORITHM.md §8 Layer A.
 *
 * Written only from ALGORITHM.md and types.ts. Must NOT import anything from src/solver
 * except types.ts, so it checks the contract rather than mirroring the implementation.
 *
 * Checks:
 *  - Claim 2: no one assigned while absent, no double booking, roles only by qualified
 *    soldiers, no slot overfilled, references valid, locks kept.
 *  - Claim 3: every reported shortage is unavoidable (own maximum matching).
 *  - Shortage report matches the assignments.
 *  - Rest debt per assignment and all per-soldier stats recomputed from the assignments.
 *  - Certificate: achieved min rest recomputed, upper bound recomputed (§6), achieved ≤ UB.
 *
 * Determinism is checked by the test harness (it needs to run the solver twice).
 */
import { ROLES } from '../solver/types'
import type {
  Assignment,
  Role,
  Shift,
  SoldierStats,
  SolverInput,
  SolverOutput,
  Verify,
  Violation,
} from '../solver/types'
import { maxBipartiteMatching } from './matching'
import { isPresent, overlaps, required, shiftWeight } from './model'
import { upperBoundMinRest } from './upperBound'

export { maxBipartiteMatching } from './matching'
export { canStaffDistinct, feasibleRest, upperBoundMinRest } from './upperBound'
export type { UpperBound } from './upperBound'

/** Relative tolerance for the (floating-point) weighted loads and fair shares. */
const EPS = 1e-6

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b))
}

function key(...parts: (string | number)[]): string {
  return parts.join('\u0000')
}

/** Per-soldier figures recomputed from scratch (§3 Output 3, §4.3). */
export interface RecomputedStats extends Omit<SoldierStats, 'soldierId'> {
  soldierId: string
}

interface Placed {
  a: Assignment
  shift: Shift
}

export const verify: Verify = (input, output) => {
  const violations: Violation[] = []
  const add = (kind: Violation['kind'], message: string, shiftId?: string, soldierId?: string) =>
    violations.push({ kind, message, ...(shiftId !== undefined && { shiftId }), ...(soldierId !== undefined && { soldierId }) })

  const shiftById = new Map(input.shifts.map((s) => [s.id, s]))
  const soldierById = new Map(input.soldiers.map((s) => [s.id, s]))

  // ---- References, qualification, presence (Claim 2) --------------------------------------
  const placed: Placed[] = []
  for (const a of output.assignments) {
    const shift = shiftById.get(a.shiftId)
    const soldier = soldierById.get(a.soldierId)
    if (!shift || !soldier || !(ROLES as readonly string[]).includes(a.role)) {
      add('UNKNOWN_SHIFT_OR_SOLDIER', `assignment references unknown shift/soldier/role (${a.shiftId}, ${a.soldierId}, ${a.role})`, a.shiftId, a.soldierId)
      continue
    }
    placed.push({ a, shift })
    // Locked assignments are input, not decisions; they are kept as given (§3, §4.4 step 2).
    if (a.locked) continue
    if (!soldier.roles.includes(a.role)) {
      add('UNQUALIFIED', `soldier ${a.soldierId} is not qualified as ${a.role}`, a.shiftId, a.soldierId)
    }
    if (!isPresent(soldier, shift)) {
      add('ASSIGNED_WHILE_ABSENT', `soldier ${a.soldierId} is absent during shift ${a.shiftId}`, a.shiftId, a.soldierId)
    }
  }
  for (const s of output.shortages) {
    if (!shiftById.has(s.shiftId) || !(ROLES as readonly string[]).includes(s.role)) {
      add('UNKNOWN_SHIFT_OR_SOLDIER', `shortage references unknown shift/role (${s.shiftId}, ${s.role})`, s.shiftId)
    }
  }

  // ---- Locks ------------------------------------------------------------------------------
  const lockCount = new Map<string, number>()
  for (const l of input.locked) {
    const k = key(l.shiftId, l.soldierId, l.role)
    lockCount.set(k, (lockCount.get(k) ?? 0) + 1)
  }
  const outLockCount = new Map<string, number>()
  for (const a of output.assignments) {
    if (!a.locked) continue
    const k = key(a.shiftId, a.soldierId, a.role)
    outLockCount.set(k, (outLockCount.get(k) ?? 0) + 1)
  }
  for (const l of input.locked) {
    const k = key(l.shiftId, l.soldierId, l.role)
    if ((outLockCount.get(k) ?? 0) < (lockCount.get(k) ?? 0)) {
      add('LOCK_NOT_RESPECTED', `locked assignment (${l.shiftId}, ${l.soldierId}, ${l.role}) missing from output`, l.shiftId, l.soldierId)
      outLockCount.set(k, lockCount.get(k) ?? 0) // report once
    }
  }
  for (const a of output.assignments) {
    if (!a.locked) continue
    const k = key(a.shiftId, a.soldierId, a.role)
    if ((outLockCount.get(k) ?? 0) > (lockCount.get(k) ?? 0)) {
      add('LOCK_NOT_RESPECTED', `assignment (${a.shiftId}, ${a.soldierId}, ${a.role}) marked locked but not locked in input`, a.shiftId, a.soldierId)
      outLockCount.set(k, lockCount.get(k) ?? 0)
    }
  }

  // ---- Double booking (Claim 2) ------------------------------------------------------------
  const bySoldier = new Map<string, Placed[]>()
  for (const p of placed) {
    const list = bySoldier.get(p.a.soldierId) ?? []
    list.push(p)
    bySoldier.set(p.a.soldierId, list)
  }
  for (const [soldierId, list] of bySoldier) {
    list.sort((x, y) => x.shift.start - y.shift.start || x.shift.end - y.shift.end || cmp(x.shift.id, y.shift.id))
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i]
        const q = list[j]
        if (q.shift.start >= p.shift.end && p.shift.id !== q.shift.id) break
        if (p.a.locked && q.a.locked) continue
        if (p.shift.id === q.shift.id || overlaps(p.shift, q.shift)) {
          add('DOUBLE_BOOKED', `soldier ${soldierId} is in ${p.shift.id} and ${q.shift.id} at the same time`, q.shift.id, soldierId)
        }
      }
    }
  }

  // ---- Fill counts and the shortage report ---------------------------------------------------
  const filled = new Map<string, number>()
  for (const p of placed) {
    const k = key(p.a.shiftId, p.a.role)
    filled.set(k, (filled.get(k) ?? 0) + 1)
  }
  const reported = new Map<string, number>()
  for (const s of output.shortages) {
    if (!Number.isInteger(s.missing) || s.missing <= 0) {
      add('WRONG_STATS', `shortage (${s.shiftId}, ${s.role}) has invalid missing=${s.missing}`, s.shiftId)
    }
    const k = key(s.shiftId, s.role)
    reported.set(k, (reported.get(k) ?? 0) + s.missing)
  }
  /** Unfilled seats per shift id (recomputed). */
  const unfilled = new Map<string, number>()
  for (const shift of input.shifts) {
    for (const role of ROLES) {
      const req = required(shift, role)
      const f = filled.get(key(shift.id, role)) ?? 0
      if (f > req) {
        add('OVERFILLED', `shift ${shift.id} has ${f} × ${role}, needs ${req}`, shift.id)
      }
      const missing = Math.max(0, req - f)
      if (missing > 0) unfilled.set(shift.id, (unfilled.get(shift.id) ?? 0) + missing)
      const rep = reported.get(key(shift.id, role)) ?? 0
      if (rep !== missing) {
        add('WRONG_STATS', `shortage report for (${shift.id}, ${role}) says ${rep}, actual missing ${missing}`, shift.id)
      }
    }
  }

  // ---- Rest debt and stats ----------------------------------------------------------------
  const stats = recomputeStats(input, output.assignments)
  const debtByAssignment = expectedRestDebts(input, output.assignments)
  output.assignments.forEach((a, i) => {
    const expected = debtByAssignment[i]
    if (expected !== null && a.restDebtMinutes !== expected) {
      add('WRONG_REST_DEBT', `assignment (${a.shiftId}, ${a.soldierId}) reports debt ${a.restDebtMinutes}, expected ${expected}`, a.shiftId, a.soldierId)
    }
  })

  const reportedStats = new Map<string, SoldierStats>()
  for (const st of output.stats) {
    if (!soldierById.has(st.soldierId)) {
      add('WRONG_STATS', `stats for unknown soldier ${st.soldierId}`, undefined, st.soldierId)
    } else if (reportedStats.has(st.soldierId)) {
      add('WRONG_STATS', `duplicate stats for soldier ${st.soldierId}`, undefined, st.soldierId)
    } else {
      reportedStats.set(st.soldierId, st)
    }
  }
  for (const exp of stats) {
    const got = reportedStats.get(exp.soldierId)
    if (!got) {
      add('WRONG_STATS', `no stats for soldier ${exp.soldierId}`, undefined, exp.soldierId)
      continue
    }
    const wrong: string[] = []
    if (!close(got.load, exp.load)) wrong.push(`load ${got.load} ≠ ${exp.load}`)
    if (!close(got.fairShare, exp.fairShare)) wrong.push(`fairShare ${got.fairShare} ≠ ${exp.fairShare}`)
    if (!close(got.deviation, got.load - got.fairShare)) wrong.push(`deviation ${got.deviation} ≠ load − fairShare`)
    if (got.shiftCount !== exp.shiftCount) wrong.push(`shiftCount ${got.shiftCount} ≠ ${exp.shiftCount}`)
    if (got.nightMinutes !== exp.nightMinutes) wrong.push(`nightMinutes ${got.nightMinutes} ≠ ${exp.nightMinutes}`)
    if (got.minRestMinutes !== exp.minRestMinutes) wrong.push(`minRest ${got.minRestMinutes} ≠ ${exp.minRestMinutes}`)
    if (got.totalRestDebtMinutes !== exp.totalRestDebtMinutes) {
      wrong.push(`totalRestDebt ${got.totalRestDebtMinutes} ≠ ${exp.totalRestDebtMinutes}`)
    }
    if (wrong.length > 0) add('WRONG_STATS', `soldier ${exp.soldierId}: ${wrong.join('; ')}`, undefined, exp.soldierId)
  }

  // ---- Certificate (§6) ---------------------------------------------------------------------
  checkCertificate(input, output, stats, unfilled.size > 0 || output.shortages.length > 0, add)

  // ---- Claim 3: every shortage unavoidable --------------------------------------------------
  checkShortagesUnavoidable(input, placed, unfilled, add)

  return violations
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Expected restDebt for each assignment (same index), or null when it cannot be defined
 * (unknown shift/soldier). Rest = start(next) − end(prev) over the soldier's assignments in
 * time order; first assignment has debt 0 (§3, types.ts).
 */
export function expectedRestDebts(input: SolverInput, assignments: readonly Assignment[]): (number | null)[] {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]))
  const soldierIds = new Set(input.soldiers.map((s) => s.id))
  const R = input.params.minRestMinutes
  const result: (number | null)[] = assignments.map(() => null)
  const bySoldier = new Map<string, number[]>()
  assignments.forEach((a, i) => {
    if (!shiftById.has(a.shiftId) || !soldierIds.has(a.soldierId)) return
    const list = bySoldier.get(a.soldierId) ?? []
    list.push(i)
    bySoldier.set(a.soldierId, list)
  })
  for (const list of bySoldier.values()) {
    const ordered = timeOrder(list, assignments, shiftById)
    let prevEnd: number | null = null
    for (const i of ordered) {
      const shift = shiftById.get(assignments[i].shiftId)!
      result[i] = prevEnd === null ? 0 : Math.max(0, R - (shift.start - prevEnd))
      prevEnd = shift.end
    }
  }
  return result
}

function timeOrder(indices: number[], assignments: readonly Assignment[], shiftById: Map<string, Shift>): number[] {
  return [...indices].sort((i, j) => {
    const a = shiftById.get(assignments[i].shiftId)!
    const b = shiftById.get(assignments[j].shiftId)!
    return a.start - b.start || a.end - b.end || cmp(a.id, b.id)
  })
}

/** Per-soldier stats recomputed from the assignments alone (§3 Output 3, §4.3). */
export function recomputeStats(input: SolverInput, assignments: readonly Assignment[]): RecomputedStats[] {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]))
  const alpha = input.params.nightWeight
  const debts = expectedRestDebts(input, assignments)

  const stats = new Map<string, RecomputedStats>()
  for (const s of input.soldiers) {
    stats.set(s.id, {
      soldierId: s.id,
      load: 0,
      fairShare: 0,
      deviation: 0,
      shiftCount: 0,
      nightMinutes: 0,
      minRestMinutes: null,
      totalRestDebtMinutes: 0,
    })
  }

  const filledPerShift = new Map<string, number>()
  const perSoldier = new Map<string, number[]>()
  assignments.forEach((a, i) => {
    const shift = shiftById.get(a.shiftId)
    const st = stats.get(a.soldierId)
    if (!shift || !st) return
    st.load += shiftWeight(shift, alpha)
    st.shiftCount += 1
    st.nightMinutes += shift.nightMinutes
    st.totalRestDebtMinutes += debts[i] ?? 0
    filledPerShift.set(shift.id, (filledPerShift.get(shift.id) ?? 0) + 1)
    const list = perSoldier.get(a.soldierId) ?? []
    list.push(i)
    perSoldier.set(a.soldierId, list)
  })

  for (const [soldierId, list] of perSoldier) {
    const ordered = timeOrder(list, assignments, shiftById)
    const st = stats.get(soldierId)!
    for (let k = 1; k < ordered.length; k++) {
      const prev = shiftById.get(assignments[ordered[k - 1]].shiftId)!
      const next = shiftById.get(assignments[ordered[k]].shiftId)!
      const rest = next.start - prev.end
      st.minRestMinutes = st.minRestMinutes === null ? rest : Math.min(st.minRestMinutes, rest)
    }
  }

  // §4.3: fairShare[s] += weight(j) × F_j / |present(j)| for every s present for j.
  for (const shift of input.shifts) {
    const F = filledPerShift.get(shift.id) ?? 0
    if (F === 0) continue
    const present = input.soldiers.filter((s) => isPresent(s, shift))
    if (present.length === 0) continue
    const share = (shiftWeight(shift, alpha) * F) / present.length
    for (const s of present) stats.get(s.id)!.fairShare += share
  }

  for (const st of stats.values()) st.deviation = st.load - st.fairShare
  return [...stats.values()]
}

function checkCertificate(
  input: SolverInput,
  output: SolverOutput,
  stats: readonly RecomputedStats[],
  hasShortages: boolean,
  add: (kind: Violation['kind'], message: string) => void,
): void {
  const cert = output.certificate
  const rests = stats.map((s) => s.minRestMinutes).filter((r): r is number => r !== null)
  const achieved = rests.length === 0 ? null : Math.min(...rests)

  if (cert.achievedMinRestMinutes !== achieved) {
    add('WRONG_STATS', `certificate achieved=${cert.achievedMinRestMinutes}, recomputed ${achieved}`)
  }
  const ub = cert.upperBoundMinRestMinutes

  if (hasShortages || achieved === null) {
    if (ub !== null) add('WRONG_STATS', `certificate must be n/a (shortages or no rest pairs) but UB=${ub}`)
    // ALGORITHM.md §6: provenOptimal is false whenever the certificate is n/a.
    if (cert.provenOptimal) add('WRONG_STATS', 'certificate claims proven optimal although it is n/a')
    return
  }

  const own = upperBoundMinRest(input)
  if (ub === null) {
    // Only acceptable when no finite bound exists.
    if (own.kind !== 'unbounded') add('WRONG_STATS', 'certificate UB missing although there are no shortages')
  } else {
    if (ub < achieved) add('WRONG_STATS', `certificate UB=${ub} is below achieved=${achieved}`)
    // Without locks UB is exactly defined by §6; with locks a solver may tighten it.
    if (input.locked.length === 0 && own.kind === 'bounded' && ub !== own.value) {
      add('WRONG_STATS', `certificate UB=${ub}, recomputed ${own.value}`)
    }
  }
  const expectedOptimal = ub !== null && achieved === ub
  if (cert.provenOptimal !== expectedOptimal) {
    add('WRONG_STATS', `certificate provenOptimal=${cert.provenOptimal}, expected ${expectedOptimal}`)
  }
}

/**
 * Claim 3. For each start time t that has a shortage, take the group G of shifts starting at
 * t. Fixed ("committed past"): every output assignment in a shift that started before t, and
 * every locked assignment. If, given that, *all* open slots of G could be filled by distinct
 * qualified present soldiers, then the shortage was avoidable.
 *
 * Deliberately lenient where ALGORITHM.md leaves room: a soldier holding a lock in a shift
 * that starts at or after t is treated as unavailable (lock replay may have made them busy).
 */
function checkShortagesUnavoidable(
  input: SolverInput,
  placed: readonly Placed[],
  unfilled: ReadonlyMap<string, number>,
  add: (kind: Violation['kind'], message: string, shiftId?: string) => void,
): void {
  if (unfilled.size === 0) return
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]))
  const shortStarts = [...new Set([...unfilled.keys()].map((id) => shiftById.get(id)!.start))].sort((a, b) => a - b)

  for (const t of shortStarts) {
    const group = input.shifts.filter((s) => s.start === t && s.end > s.start)
    const fixed = placed.filter((p) => p.shift.start < t)

    const lockedInGroup = new Map<string, number>()
    const lockedLater = new Set<string>()
    for (const l of input.locked) {
      const ls = shiftById.get(l.shiftId)
      if (!ls) continue
      if (ls.start >= t) lockedLater.add(l.soldierId)
      if (ls.start === t) {
        const k = key(l.shiftId, l.role)
        lockedInGroup.set(k, (lockedInGroup.get(k) ?? 0) + 1)
      }
    }

    const adj: number[][] = []
    for (const shift of group) {
      for (const role of ROLES) {
        const open = Math.max(0, required(shift, role) - (lockedInGroup.get(key(shift.id, role)) ?? 0))
        for (let n = 0; n < open; n++) adj.push(eligible(input, shift, role, fixed, lockedLater))
      }
    }
    const maxFill = maxBipartiteMatching(adj, input.soldiers.length).size
    if (maxFill < adj.length) continue // G cannot be fully staffed: shortages are unavoidable.

    for (const shift of group) {
      const missing = unfilled.get(shift.id)
      if (missing) {
        add('AVOIDABLE_SHORTAGE', `shift ${shift.id} left ${missing} slot(s) empty, but all shifts starting at ${t} could be fully staffed`, shift.id)
      }
    }
  }
}

function eligible(input: SolverInput, shift: Shift, role: Role, fixed: readonly Placed[], lockedLater: ReadonlySet<string>): number[] {
  const result: number[] = []
  input.soldiers.forEach((soldier, i) => {
    if (!soldier.roles.includes(role)) return
    if (!isPresent(soldier, shift)) return
    if (lockedLater.has(soldier.id)) return
    if (fixed.some((p) => p.a.soldierId === soldier.id && overlaps(p.shift, shift))) return
    result.push(i)
  })
  return result
}
