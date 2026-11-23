/**
 * Brute-force oracle — ALGORITHM.md §8 Layer C. Independent of src/solver (types only).
 *
 * Enumerates every physically valid schedule of a small instance (≤ 6 soldiers, ≤ 10
 * shifts) and returns:
 *   - maxCoverage:     the largest number of filled slots any schedule achieves;
 *   - bestMinRest:     the best minimum rest among schedules with maxCoverage
 *                      (Infinity if one of them has no soldier guarding twice);
 *   - bestLoadSpread:  the smallest (max load − min load) over all soldiers among schedules
 *                      with maxCoverage.
 *
 * Physically valid = the hard rules of D5: only qualified soldiers, never while absent, never
 * in two overlapping shifts; locked assignments are always included. Rest is not a rule.
 *
 * Two exact reductions keep the search small (both can be switched off for self-tests):
 *   - seats of the same role in one shift are interchangeable (choose soldiers in index order);
 *   - soldiers with identical roles and absences and no locks are interchangeable until first
 *     used (always take the lowest-index unused one of the class).
 * Plus branch-and-bound on each objective.
 */
import { roleOrder } from '../../src/solver/types'
import type { Assignment, Role, Shift, SolverInput } from '../../src/solver/types'

export const ORACLE_LIMITS = { soldiers: 6, shifts: 10 } as const

export interface OracleResult {
  maxCoverage: number
  bestMinRest: number
  bestLoadSpread: number
  /** Search nodes visited (all three searches). */
  nodes: number
}

export interface OracleOptions {
  /** Interchangeable-soldier reduction. Default true. */
  symmetry?: boolean
  /** Abort instead of running forever. Default 20 million nodes. */
  nodeLimit?: number
}

interface ShiftInfo {
  shift: Shift
  weight: number
  locked: { soldier: number; role: Role }[]
  /** Roles of the open seats, grouped by role in role order. */
  open: Role[]
  /** ok[p][i]: soldier i is qualified and present for open seat p. */
  ok: boolean[][]
}

const EMPTY = Number.MAX_SAFE_INTEGER

export function sortShifts(shifts: readonly Shift[]): Shift[] {
  return [...shifts].sort((a, b) => a.start - b.start || a.postIndex - b.postIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function bruteForce(input: SolverInput, options: OracleOptions = {}): OracleResult {
  const symmetry = options.symmetry ?? true
  const nodeLimit = options.nodeLimit ?? 20_000_000
  const soldiers = input.soldiers
  const N = soldiers.length
  if (N > ORACLE_LIMITS.soldiers || input.shifts.length > ORACLE_LIMITS.shifts) {
    throw new Error(`oracle limited to ${ORACLE_LIMITS.soldiers} soldiers and ${ORACLE_LIMITS.shifts} shifts`)
  }
  const alpha = input.params.nightWeight
  const index = new Map(soldiers.map((s, i) => [s.id, i]))

  const lockedSoldiers = new Set(input.locked.map((l) => l.soldierId))
  const classOf = soldiers.map((s) =>
    lockedSoldiers.has(s.id) ? `#${s.id}` : JSON.stringify([[...s.roles].sort(), [...s.absences].sort((a, b) => a.start - b.start || a.end - b.end)]),
  )

  const ROLES = roleOrder(input)
  const infos: ShiftInfo[] = sortShifts(input.shifts).map((shift) => {
    const locked = input.locked
      .filter((l) => l.shiftId === shift.id && index.has(l.soldierId))
      .map((l) => ({ soldier: index.get(l.soldierId)!, role: l.role }))
    const open: Role[] = []
    for (const role of ROLES) {
      const need = (shift.requirements[role] ?? 0) - locked.filter((l) => l.role === role).length
      for (let k = 0; k < need; k++) open.push(role)
    }
    const present = soldiers.map((s) => !s.absences.some((a) => a.start < shift.end && shift.start < a.end))
    const ok = open.map((role) => soldiers.map((s, i) => present[i] && s.roles.includes(role)))
    const weight = (shift.end - shift.start - shift.nightMinutes + alpha * shift.nightMinutes) * (shift.weightFactor ?? 1)
    return { shift, weight, locked, open, ok }
  })
  const M = infos.length

  // suffixOpen[si] = open seats in shifts si..M-1; suffixWeight[si] = Σ weight of shifts si..M-1.
  const suffixOpen = new Array<number>(M + 1).fill(0)
  const suffixWeight = new Array<number>(M + 1).fill(0)
  for (let si = M - 1; si >= 0; si--) {
    suffixOpen[si] = suffixOpen[si + 1] + infos[si].open.length
    suffixWeight[si] = suffixWeight[si + 1] + infos[si].weight
  }
  const lockedCovered = infos.reduce((n, inf) => n + Math.min(inf.locked.length, slotCount(inf.shift)), 0)

  // Mutable search state.
  const lastEnd = new Array<number>(N).fill(-Infinity)
  const busyUntil = new Array<number>(N).fill(-Infinity)
  const load = new Array<number>(N).fill(0)
  const used = new Array<number>(N).fill(0)
  let nodes = 0

  type Mode = 'coverage' | 'rest' | 'spread'

  const run = (mode: Mode, targetCoverage: number): number => {
    let best = mode === 'coverage' ? -1 : mode === 'rest' ? -Infinity : Infinity

    const place = (i: number, info: ShiftInfo, minRest: number): { saved: [number, number, number]; minRest: number } => {
      const saved: [number, number, number] = [lastEnd[i], busyUntil[i], load[i]]
      const rest = lastEnd[i] === -Infinity ? Infinity : info.shift.start - lastEnd[i]
      lastEnd[i] = info.shift.end
      busyUntil[i] = Math.max(busyUntil[i], info.shift.end)
      load[i] += info.weight
      used[i]++
      return { saved, minRest: Math.min(minRest, rest) }
    }
    const unplace = (i: number, saved: [number, number, number]) => {
      ;[lastEnd[i], busyUntil[i], load[i]] = saved
      used[i]--
    }

    const pruned = (covered: number, remaining: number, minRest: number): boolean => {
      if (mode === 'coverage') return covered + remaining <= best
      if (covered + remaining < targetCoverage) return true
      if (mode === 'rest') return minRest <= best
      return false
    }

    const go = (si: number, covered: number, minRest: number): void => {
      if (++nodes > nodeLimit) throw new Error(`oracle node limit ${nodeLimit} exceeded`)
      if (si === M) {
        if (mode === 'coverage') best = Math.max(best, covered)
        else if (covered === targetCoverage) {
          if (mode === 'rest') best = Math.max(best, minRest)
          else best = Math.min(best, spread())
        }
        return
      }
      if (mode === 'spread') {
        const lo = Math.min(...load)
        const hi = Math.max(...load)
        if (N > 0 && hi - (lo + suffixWeight[si]) >= best) return
      }
      const info = infos[si]
      const usedMask = new Array<boolean>(N).fill(false)
      const savedLocks: [number, [number, number, number]][] = []
      let mr = minRest
      for (const l of info.locked) {
        const r = place(l.soldier, info, mr)
        mr = r.minRest
        savedLocks.push([l.soldier, r.saved])
        usedMask[l.soldier] = true
      }
      seat(si, 0, covered, mr, usedMask, -1)
      for (let k = savedLocks.length - 1; k >= 0; k--) unplace(savedLocks[k][0], savedLocks[k][1])
    }

    const seat = (si: number, p: number, covered: number, minRest: number, usedMask: boolean[], prevSameRole: number): void => {
      const info = infos[si]
      if (p === info.open.length) return go(si + 1, covered, minRest)
      const remaining = info.open.length - p + suffixOpen[si + 1]
      if (pruned(covered, remaining, minRest)) return
      const role = info.open[p]
      const floor = p > 0 && info.open[p - 1] === role ? prevSameRole : -1

      if (floor !== EMPTY) {
        const candidates: number[] = []
        for (let i = floor + 1; i < N; i++) {
          if (!info.ok[p][i] || usedMask[i] || busyUntil[i] > info.shift.start) continue
          if (symmetry && used[i] === 0 && !firstOfClass(i)) continue
          candidates.push(i)
        }
        if (mode === 'rest') candidates.sort((a, b) => lastEnd[a] - lastEnd[b] || a - b)
        else if (mode === 'spread') candidates.sort((a, b) => load[a] - load[b] || a - b)
        for (const i of candidates) {
          const { saved, minRest: mr } = place(i, info, minRest)
          usedMask[i] = true
          seat(si, p + 1, covered + 1, mr, usedMask, i)
          usedMask[i] = false
          unplace(i, saved)
        }
      }
      // Leave this seat empty (then all later seats of the same role stay empty too).
      seat(si, p + 1, covered, minRest, usedMask, EMPTY)
    }

    const firstOfClass = (i: number): boolean => {
      for (let j = 0; j < i; j++) if (classOf[j] === classOf[i] && used[j] === 0) return false
      return true
    }
    const spread = (): number => (N === 0 ? 0 : Math.max(...load) - Math.min(...load))

    go(0, lockedCovered, Infinity)
    return best
  }

  const maxCoverage = run('coverage', 0)
  const bestMinRest = run('rest', maxCoverage)
  const bestLoadSpread = run('spread', maxCoverage)
  return { maxCoverage, bestMinRest, bestLoadSpread, nodes }
}

function slotCount(shift: Shift): number {
  return Object.values(shift.requirements).reduce<number>((n, k) => n + (k ?? 0), 0)
}

/** The three oracle metrics measured on one concrete schedule (e.g. the solver's). */
export function measure(input: SolverInput, assignments: readonly Assignment[]): { coverage: number; minRest: number; loadSpread: number } {
  const byId = new Map(input.shifts.map((s) => [s.id, s]))
  const alpha = input.params.nightWeight
  const loads = new Map(input.soldiers.map((s) => [s.id, 0]))
  let minRest = Infinity
  for (const s of input.soldiers) {
    const mine = assignments
      .filter((a) => a.soldierId === s.id)
      .map((a) => byId.get(a.shiftId)!)
      .sort((a, b) => a.start - b.start || a.end - b.end)
    for (let k = 0; k < mine.length; k++) {
      const sh = mine[k]
      loads.set(s.id, loads.get(s.id)! + (sh.end - sh.start - sh.nightMinutes + alpha * sh.nightMinutes) * (sh.weightFactor ?? 1))
      if (k > 0) minRest = Math.min(minRest, sh.start - mine[k - 1].end)
    }
  }
  const values = [...loads.values()]
  return {
    coverage: assignments.length,
    minRest,
    loadSpread: values.length ? Math.max(...values) - Math.min(...values) : 0,
  }
}
