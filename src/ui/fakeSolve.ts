/**
 * Placeholder for the real solver (session 1A), used only by the UI in session 1C.
 * Session 2 replaces the import with the real `solve()` from src/solver.
 *
 * It returns a plausible, deterministic schedule honouring the physical rules
 * (absences, no double booking, roles) and locked assignments, using a simple
 * "least load, longest rested, then id" greedy. It makes no optimality claims.
 */
import type {
  Assignment,
  Role,
  Shortage,
  Solve,
  SoldierId,
  SoldierStats,
} from '../solver/types'
import { ROLES } from '../solver/types'

export const fakeSolve: Solve = (input) => {
  const { soldiers, params } = input
  const shifts = [...input.shifts].sort(
    (a, b) => a.start - b.start || a.postIndex - b.postIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const shiftById = new Map(shifts.map((s) => [s.id, s]))
  const weight = (id: string) => {
    const s = shiftById.get(id)!
    return s.end - s.start - s.nightMinutes + params.nightWeight * s.nightMinutes
  }

  const load = new Map<SoldierId, number>()
  const taken = new Map<SoldierId, { start: number; end: number }[]>()
  const restDebt = new Map<string, number>()
  for (const s of soldiers) {
    load.set(s.id, 0)
    taken.set(s.id, [])
  }

  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.start < b.end && b.start < a.end
  const lastEndBefore = (id: SoldierId, t: number) => {
    let best = -Infinity
    for (const iv of taken.get(id) ?? []) if (iv.end <= t && iv.end > best) best = iv.end
    return best
  }

  const assignments: Assignment[] = []
  const shortages: Shortage[] = []
  const lockedByShift = new Map<string, typeof input.locked>()
  for (const l of input.locked) {
    if (!shiftById.has(l.shiftId) || !load.has(l.soldierId)) continue
    const arr = lockedByShift.get(l.shiftId) ?? []
    arr.push(l)
    lockedByShift.set(l.shiftId, arr)
  }

  for (const shift of shifts) {
    const need = new Map<Role, number>()
    for (const r of ROLES) need.set(r, shift.requirements[r] ?? 0)
    const used = new Set<SoldierId>()

    const commit = (id: SoldierId, role: Role, locked: boolean) => {
      const prev = lastEndBefore(id, shift.start)
      const debt = prev === -Infinity ? 0 : Math.max(0, params.minRestMinutes - (shift.start - prev))
      assignments.push({ shiftId: shift.id, soldierId: id, role, restDebtMinutes: debt, locked })
      restDebt.set(`${shift.id}|${id}`, debt)
      load.set(id, (load.get(id) ?? 0) + weight(shift.id))
      taken.get(id)!.push({ start: shift.start, end: shift.end })
      used.add(id)
      need.set(role, Math.max(0, (need.get(role) ?? 0) - 1))
    }

    for (const l of lockedByShift.get(shift.id) ?? []) commit(l.soldierId, l.role, true)

    // Scarce roles first so that a multi-role soldier is not wasted on "soldier".
    const roleOrder = [...ROLES].sort(
      (a, b) =>
        soldiers.filter((s) => s.roles.includes(a)).length - soldiers.filter((s) => s.roles.includes(b)).length ||
        ROLES.indexOf(a) - ROLES.indexOf(b),
    )
    for (const role of roleOrder) {
      let missing = need.get(role) ?? 0
      while (missing > 0) {
        const candidates = soldiers.filter(
          (s) =>
            !used.has(s.id) &&
            s.roles.includes(role) &&
            !s.absences.some((a) => overlaps(a, shift)) &&
            !(taken.get(s.id) ?? []).some((iv) => overlaps(iv, shift)),
        )
        if (candidates.length === 0) break
        candidates.sort((a, b) => {
          const ra = shift.start - lastEndBefore(a.id, shift.start)
          const rb = shift.start - lastEndBefore(b.id, shift.start)
          const tierA = ra >= params.minRestMinutes ? 0 : 1
          const tierB = rb >= params.minRestMinutes ? 0 : 1
          return (
            tierA - tierB ||
            load.get(a.id)! - load.get(b.id)! ||
            rb - ra ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          )
        })
        commit(candidates[0].id, role, false)
        missing--
      }
      if (missing > 0) shortages.push({ shiftId: shift.id, role, missing })
    }
  }

  const stats: SoldierStats[] = soldiers.map((s) => {
    const mine = assignments.filter((a) => a.soldierId === s.id)
    const ivs = [...(taken.get(s.id) ?? [])].sort((a, b) => a.start - b.start)
    let minRest: number | null = null
    for (let i = 1; i < ivs.length; i++) {
      const r = ivs[i].start - ivs[i - 1].end
      minRest = minRest === null ? r : Math.min(minRest, r)
    }
    return {
      soldierId: s.id,
      load: load.get(s.id) ?? 0,
      fairShare: 0,
      deviation: load.get(s.id) ?? 0,
      shiftCount: mine.length,
      nightMinutes: mine.reduce((acc, a) => acc + shiftById.get(a.shiftId)!.nightMinutes, 0),
      minRestMinutes: minRest,
      totalRestDebtMinutes: mine.reduce((acc, a) => acc + a.restDebtMinutes, 0),
    }
  })

  return {
    assignments,
    shortages,
    stats,
    certificate: { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false },
    warnings: [],
  }
}
