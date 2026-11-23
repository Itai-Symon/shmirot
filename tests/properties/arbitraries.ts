/** fast-check generators for the property tests (Layer B). */
import fc from 'fast-check'
import { ROLES } from '../../src/solver/types'
import type { LockedAssignment, Role, Shift, Soldier, SolverInput } from '../../src/solver/types'
import { makeInput, soldierId, soldiers, uniformShifts } from '../helpers/shifts'

/** ALGORITHM.md §5 "uniform setting": one role, length L, back-to-back, K per shift, nobody absent, no locks. */
export interface UniformCase {
  n: number
  k: number
  len: number
  count: number
  rest: number
  input: SolverInput
}

export const uniformArb: fc.Arbitrary<UniformCase> = fc
  .record({
    n: fc.integer({ min: 1, max: 14 }),
    k: fc.integer({ min: 1, max: 3 }),
    len: fc.constantFrom(60, 90, 120, 180, 240),
    extra: fc.integer({ min: 0, max: 30 }),
    restSteps: fc.integer({ min: 0, max: 24 }),
    alpha: fc.constantFrom(1, 1.5),
  })
  .filter(({ n, k }) => k <= n)
  .map(({ n, k, len, extra, restSteps, alpha }) => {
    // At least ⌊N/K⌋ + 1 shifts so the pigeonhole window of Claim 4(a) fits.
    const count = Math.floor(n / k) + 1 + extra
    const rest = restSteps * 30
    const input = makeInput(soldiers(n), uniformShifts({ count, lengthMinutes: len, requirements: { soldier: k }, noNight: true }), {
      minRestMinutes: rest,
      nightWeight: alpha,
    })
    return { n, k, len, count, rest, input }
  })

/**
 * Claim 5 conditions: every soldier qualifies for every role, nobody absent, no locks.
 * Any shape: several posts, different lengths and offsets, night shifts.
 * Enough soldiers that every moment can be staffed (N ≥ 2 × seats that can be active at once).
 */
export const claim5Arb = (restMode: 'zero' | 'random'): fc.Arbitrary<SolverInput> =>
  fc
    .record({
      posts: fc.array(
        fc.record({
          len: fc.constantFrom(60, 120, 180, 240, 360),
          offset: fc.integer({ min: 0, max: 8 }).map((x) => x * 30),
          count: fc.integer({ min: 1, max: 20 }),
          req: fc.dictionary(fc.constantFrom(...ROLES), fc.integer({ min: 1, max: 2 }), { minKeys: 1, maxKeys: 2 }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      extra: fc.integer({ min: 0, max: 6 }),
      clock: fc.integer({ min: 0, max: 47 }).map((x) => x * 30),
      alpha: fc.constantFrom(1, 1.5, 2),
      rest: restMode === 'zero' ? fc.constant(0) : fc.integer({ min: 0, max: 16 }).map((x) => x * 30),
    })
    .map(({ posts, extra, clock, alpha, rest }) => {
      const shifts = posts.flatMap((p, post) =>
        uniformShifts({ count: p.count, lengthMinutes: p.len, firstStart: p.offset, postIndex: post, requirements: p.req as Partial<Record<Role, number>>, clockOffset: clock }),
      )
      const concurrent = posts.reduce((n, p) => n + Object.values(p.req).reduce((a, b) => a + b, 0), 0)
      return makeInput(soldiers(2 * concurrent + extra, [...ROLES]), shifts, { minRestMinutes: rest, nightWeight: alpha })
    })

const roleSets: Role[][] = [['soldier'], ['soldier'], ['soldier', 'commander'], ['commander'], ['soldier', 'medic'], ['driver', 'soldier']]
const reqSets: Partial<Record<Role, number>>[] = [{ soldier: 1 }, { soldier: 2 }, { commander: 1, soldier: 1 }, { commander: 1, soldier: 2 }, { medic: 1 }, { driver: 1, soldier: 1 }, {}]

/** General instances: mixed roles, absences, misaligned posts, night shifts, optional past locks. */
export const generalArb = (opts: { withLocks?: boolean; maxSoldiers?: number } = {}): fc.Arbitrary<SolverInput> =>
  fc
    .record({
      soldiers: fc.array(
        fc.record({
          roles: fc.constantFrom(...roleSets),
          absences: fc.array(fc.record({ start: fc.integer({ min: 0, max: 60 }), len: fc.integer({ min: 1, max: 30 }) }), { maxLength: 2 }),
        }),
        { minLength: 0, maxLength: opts.maxSoldiers ?? 16 },
      ),
      posts: fc.array(
        fc.record({
          len: fc.constantFrom(60, 120, 180, 240),
          offset: fc.integer({ min: 0, max: 6 }).map((x) => x * 30),
          count: fc.integer({ min: 0, max: 16 }),
          req: fc.constantFrom(...reqSets),
        }),
        { minLength: 0, maxLength: 3 },
      ),
      clock: fc.integer({ min: 0, max: 23 }).map((x) => x * 60),
      alpha: fc.constantFrom(1, 1.5),
      rest: fc.integer({ min: 0, max: 16 }).map((x) => x * 30),
      lockUntil: fc.integer({ min: 0, max: 12 }).map((x) => x * 60),
      rotation: fc.nat(),
    })
    .map(({ soldiers: ss, posts, clock, alpha, rest, lockUntil, rotation }) => {
      const soldierList: Soldier[] = ss.map((s, i) => ({
        id: soldierId(i),
        roles: [...s.roles],
        absences: s.absences.map((a) => ({ start: a.start * 30, end: (a.start + a.len) * 30 })),
      }))
      const shiftList: Shift[] = posts.flatMap((p, post) =>
        uniformShifts({ count: p.count, lengthMinutes: p.len, firstStart: p.offset, postIndex: post, requirements: p.req, clockOffset: clock }),
      )
      const locked = opts.withLocks ? pastLocks(soldierList, shiftList, lockUntil, rotation) : []
      return makeInput(soldierList, shiftList, { minRestMinutes: rest, nightWeight: alpha }, locked)
    })

/**
 * "Re-plan from now": shifts that started before `until` are already staffed (first-fit from a
 * rotated soldier order, physically valid, rest ignored) and passed in as locks.
 */
export function pastLocks(soldierList: Soldier[], shiftList: Shift[], until: number, rotation: number): LockedAssignment[] {
  const n = soldierList.length
  if (n === 0) return []
  const busy = new Map<string, number>()
  const locks: LockedAssignment[] = []
  const ordered = [...shiftList].filter((s) => s.start < until).sort((a, b) => a.start - b.start || a.postIndex - b.postIndex)
  for (const sh of ordered) {
    const taken = new Set<string>()
    for (const role of ROLES) {
      let need = sh.requirements[role] ?? 0
      for (let j = 0; j < n && need > 0; j++) {
        const s = soldierList[(j + rotation) % n]
        if (taken.has(s.id) || !s.roles.includes(role)) continue
        if ((busy.get(s.id) ?? -Infinity) > sh.start) continue
        if (s.absences.some((a) => a.start < sh.end && sh.start < a.end)) continue
        taken.add(s.id)
        busy.set(s.id, sh.end)
        locks.push({ shiftId: sh.id, soldierId: s.id, role })
        need--
      }
    }
  }
  return locks
}
