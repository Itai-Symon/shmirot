/**
 * Random small instances for the oracle (≤ 6 soldiers, ≤ 10 shifts). Mixed roles,
 * absences, misaligned posts and night shifts — i.e. outside the conditions of Claims 4–5,
 * where only the oracle can say how good the solver is.
 */
import fc from 'fast-check'
import type { Role, Shift, Soldier, SolverInput } from '../../src/solver/types'
import { hours, makeInput, soldierId, uniformShifts } from '../helpers/shifts'

const roleSets: Role[][] = [['soldier'], ['soldier'], ['commander', 'soldier'], ['commander']]
const requirementSets: Partial<Record<Role, number>>[] = [{ soldier: 1 }, { soldier: 1 }, { commander: 1 }, { commander: 1, soldier: 1 }, { soldier: 2 }]

export interface SmallInstanceOptions {
  maxSoldiers?: number
  maxShifts?: number
  maxSeats?: number
}

export function smallInstanceArb(opts: SmallInstanceOptions = {}): fc.Arbitrary<SolverInput> {
  const maxSoldiers = opts.maxSoldiers ?? 6
  const maxShifts = opts.maxShifts ?? 10
  const maxSeats = opts.maxSeats ?? 10

  const soldierArb = fc.record({
    roles: fc.constantFrom(...roleSets),
    absence: fc.option(fc.record({ start: fc.integer({ min: 0, max: 16 }), len: fc.integer({ min: 1, max: 12 }) }), { freq: 3 }),
  })
  const postArb = fc.record({
    len: fc.constantFrom(60, 120, 180, 240),
    offset: fc.constantFrom(0, 0, 30, 60, 90),
    count: fc.integer({ min: 2, max: 7 }),
    req: fc.constantFrom(...requirementSets),
  })

  return fc
    .record({
      soldiers: fc.array(soldierArb, { minLength: 1, maxLength: maxSoldiers }),
      posts: fc.array(postArb, { minLength: 1, maxLength: 2 }),
      rest: fc.constantFrom(0, 120, 240, 360, 480),
      alpha: fc.constantFrom(1, 1.5),
      clock: fc.constantFrom(0, hours(20), hours(22)),
    })
    .map(({ soldiers, posts, rest, alpha, clock }) => {
      const soldierList: Soldier[] = soldiers.map((s, i) => ({
        id: soldierId(i),
        roles: [...s.roles],
        absences: s.absence ? [{ start: s.absence.start * 60, end: (s.absence.start + s.absence.len) * 60 }] : [],
      }))
      const shiftList: Shift[] = posts.flatMap((p, post) =>
        uniformShifts({ count: p.count, lengthMinutes: p.len, firstStart: p.offset, postIndex: post, requirements: p.req, clockOffset: clock }),
      )
      return makeInput(soldierList, shiftList, { minRestMinutes: rest, nightWeight: alpha })
    })
    .filter((input) => {
      const seats = input.shifts.reduce((n, s) => n + Object.values(s.requirements).reduce((a, b) => a + (b ?? 0), 0), 0)
      return input.shifts.length <= maxShifts && seats <= maxSeats
    })
}
