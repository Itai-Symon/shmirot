/**
 * Warnings — ALGORITHM.md §4.6. Pure, deterministic, computed from the input and the
 * produced assignments.
 */
import { ROLES, type Assignment, type Role, type Shift, type Soldier, type Warning } from './types'

const DAY = 24 * 60

function requiredCount(shift: Shift, role: Role): number {
  const n = shift.requirements[role] ?? 0
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function presentFor(soldier: Soldier, shift: Shift): boolean {
  return !soldier.absences.some((a) => a.start < shift.end && shift.start < a.end)
}

/**
 * ROLE_BOTTLENECK for role r: the rest target R cannot be met for role r even in the best
 * schedule. Necessary condition (same argument as §6, restricted to one role): for every
 * shift start t, the r-seats of all shifts whose extended interval [start, end + R) contains
 * t must be filled by distinct soldiers qualified for r and present for one of those shifts.
 * If any t violates it, warn with details { qualified, needed, at }.
 */
export function roleBottlenecks(soldiers: readonly Soldier[], shifts: readonly Shift[], minRest: number): Warning[] {
  const out: Warning[] = []
  const starts = [...new Set(shifts.map((s) => s.start))].sort((a, b) => a - b)
  for (const role of ROLES) {
    const roleShifts = shifts.filter((s) => requiredCount(s, role) > 0)
    if (roleShifts.length === 0) continue
    let worst: { qualified: number; needed: number; at: number } | null = null
    for (const t of starts) {
      const window = roleShifts.filter((s) => s.start <= t && t < s.end + minRest)
      if (window.length === 0) continue
      const needed = window.reduce((n, s) => n + requiredCount(s, role), 0)
      const qualified = soldiers.filter((sol) => sol.roles.includes(role) && window.some((s) => presentFor(sol, s))).length
      if (needed > qualified && (worst === null || needed - qualified > worst.needed - worst.qualified)) {
        worst = { qualified, needed, at: t }
      }
    }
    if (worst) out.push({ code: 'ROLE_BOTTLENECK', role, details: worst })
  }
  return out
}

/**
 * NIGHT_TRAP: the produced schedule repeats every 24 h, so the same soldiers guard the same
 * hours every day (e.g. always 02:00–04:00), even if night minutes happen to be equal.
 * Formally: shift starts span at least 24 h, and every assignment (s, j) with
 * start_j + 24 h ≤ last start has s also assigned to some shift starting at start_j + 24 h.
 */
export function nightTrap(shifts: readonly Shift[], assignments: readonly Assignment[]): Warning[] {
  if (shifts.length === 0 || assignments.length === 0) return []
  const firstStart = Math.min(...shifts.map((s) => s.start))
  const lastStart = Math.max(...shifts.map((s) => s.start))
  if (lastStart - firstStart < DAY) return []
  const byId = new Map(shifts.map((s) => [s.id, s]))
  const startsBySoldier = new Map<string, Set<number>>()
  const nightBySoldier = new Map<string, number>()
  for (const a of assignments) {
    const sh = byId.get(a.shiftId)
    if (!sh) continue
    if (!startsBySoldier.has(a.soldierId)) startsBySoldier.set(a.soldierId, new Set())
    startsBySoldier.get(a.soldierId)!.add(sh.start)
    nightBySoldier.set(a.soldierId, (nightBySoldier.get(a.soldierId) ?? 0) + sh.nightMinutes)
  }
  for (const a of assignments) {
    const sh = byId.get(a.shiftId)
    if (!sh || sh.start + DAY > lastStart) continue
    if (!startsBySoldier.get(a.soldierId)!.has(sh.start + DAY)) return []
  }
  const nights = [...nightBySoldier.values()]
  const spread = Math.max(...nights) - Math.min(...nights)
  return [{ code: 'NIGHT_TRAP', details: { periodMinutes: DAY, nightSpreadMinutes: spread } }]
}
