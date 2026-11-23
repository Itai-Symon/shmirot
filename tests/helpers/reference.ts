/**
 * Builds a complete, correct SolverOutput from a hand-written list of assignments, so the
 * verifier can be tested without a solver. Deliberately written as plain loops, separately
 * from the verifier's own recomputation; the certificate's UB is passed in or taken from the
 * verifier's §6 implementation (which has its own tests against the oracle).
 */
import { roleOrder } from '../../src/solver/types'
import type { Assignment, Role, Shortage, SoldierStats, SolverInput, SolverOutput } from '../../src/solver/types'
import { upperBoundMinRest } from '../../src/verifier/index'
import { weightOf } from './shifts'

export interface Pick {
  shiftId: string
  soldierId: string
  role: Role
  locked?: boolean
}

export function buildOutput(input: SolverInput, picks: Pick[], opts: { upperBound?: number | null } = {}): SolverOutput {
  const shift = (id: string) => {
    const s = input.shifts.find((x) => x.id === id)
    if (!s) throw new Error(`unknown shift ${id}`)
    return s
  }
  const R = input.params.minRestMinutes
  const alpha = input.params.nightWeight

  // Rest debts: walk each soldier's picks in time order.
  const debt = new Map<Pick, number>()
  const rests = new Map<string, number[]>()
  for (const s of input.soldiers) {
    const mine = picks.filter((p) => p.soldierId === s.id).sort((a, b) => shift(a.shiftId).start - shift(b.shiftId).start)
    let prevEnd: number | undefined
    const r: number[] = []
    for (const p of mine) {
      const sh = shift(p.shiftId)
      if (prevEnd === undefined) debt.set(p, 0)
      else {
        r.push(sh.start - prevEnd)
        debt.set(p, Math.max(0, R - (sh.start - prevEnd)))
      }
      prevEnd = sh.end
    }
    rests.set(s.id, r)
  }

  const assignments: Assignment[] = picks.map((p) => ({
    shiftId: p.shiftId,
    soldierId: p.soldierId,
    role: p.role,
    restDebtMinutes: debt.get(p) ?? 0,
    locked: p.locked ?? false,
  }))

  const shortages: Shortage[] = []
  for (const sh of input.shifts) {
    for (const role of roleOrder(input)) {
      const need = sh.requirements[role] ?? 0
      const got = picks.filter((p) => p.shiftId === sh.id && p.role === role).length
      if (need > got) shortages.push({ shiftId: sh.id, role, missing: need - got })
    }
  }

  const stats: SoldierStats[] = input.soldiers.map((s) => {
    const mine = picks.filter((p) => p.soldierId === s.id)
    let fairShare = 0
    for (const sh of input.shifts) {
      const present = input.soldiers.filter((x) => !x.absences.some((a) => a.start < sh.end && sh.start < a.end))
      if (!present.some((x) => x.id === s.id)) continue
      const F = picks.filter((p) => p.shiftId === sh.id).length
      fairShare += (weightOf(sh, alpha) * F) / present.length
    }
    const load = mine.reduce((sum, p) => sum + weightOf(shift(p.shiftId), alpha), 0)
    const r = rests.get(s.id)!
    return {
      soldierId: s.id,
      load,
      fairShare,
      deviation: load - fairShare,
      shiftCount: mine.length,
      nightMinutes: mine.reduce((sum, p) => sum + shift(p.shiftId).nightMinutes, 0),
      minRestMinutes: r.length ? Math.min(...r) : null,
      totalRestDebtMinutes: mine.reduce((sum, p) => sum + (debt.get(p) ?? 0), 0),
    }
  })

  const allRests = [...rests.values()].flat()
  const achieved = allRests.length ? Math.min(...allRests) : null
  let ub: number | null = null
  if (shortages.length === 0 && achieved !== null) {
    if (opts.upperBound !== undefined) ub = opts.upperBound
    else {
      const own = upperBoundMinRest(input)
      ub = own.kind === 'bounded' ? own.value : null
    }
  }

  return {
    assignments,
    shortages,
    stats,
    certificate: {
      achievedMinRestMinutes: achieved,
      upperBoundMinRestMinutes: ub,
      provenOptimal: ub !== null && achieved === ub,
    },
    warnings: [],
  }
}
