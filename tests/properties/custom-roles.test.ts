/**
 * Custom roles (D6): roles are opaque ids. Renaming every role id consistently must not
 * change the schedule, and the role order comes from input.roles (ALGORITHM.md §3).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLES, roleOrder, type Role, type SolverInput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'
import { generalArb } from './arbitraries'

function renameRoles(input: SolverInput, map: (r: Role) => Role): SolverInput {
  return {
    ...input,
    roles: roleOrder(input).map(map),
    soldiers: input.soldiers.map((s) => ({ ...s, roles: s.roles.map(map) })),
    shifts: input.shifts.map((sh) => ({
      ...sh,
      requirements: Object.fromEntries(Object.entries(sh.requirements).map(([r, n]) => [map(r), n])),
    })),
    locked: input.locked.map((l) => ({ ...l, role: map(l.role) })),
  }
}

describe('custom roles', () => {
  it('roleOrder: input.roles first (deduplicated), then unknown ids sorted', () => {
    const input = {
      roles: ['שג', 'סיור', 'שג'],
      soldiers: [{ id: 'a', roles: ['zz', 'סיור'], absences: [] }],
      shifts: [{ id: 'x', postIndex: 0, start: 0, end: 60, nightMinutes: 0, requirements: { aa: 1 } }],
      locked: [],
    }
    expect(roleOrder(input)).toEqual(['שג', 'סיור', 'aa', 'zz'])
    expect(roleOrder({ ...input, roles: undefined }).slice(0, DEFAULT_ROLES.length)).toEqual([...DEFAULT_ROLES])
  })

  it('renaming every role id (keeping the order) gives the same schedule', () => {
    fc.assert(
      fc.property(generalArb({ withLocks: true }), (input) => {
        const map = (r: Role) => `custom-${r.length}-${[...r].reverse().join('')}`
        const a = runAndVerify({ ...input, roles: roleOrder(input) })
        const b = runAndVerify(renameRoles(input, map))
        expect(b.assignments).toEqual(a.assignments.map((x) => ({ ...x, role: map(x.role) })))
        expect(b.shortages).toEqual(a.shortages.map((x) => ({ ...x, role: map(x.role) })))
        expect(b.stats).toEqual(a.stats)
        expect(b.certificate).toEqual(a.certificate)
      }),
      { seed: 7001, numRuns: 150 },
    )
  })

  it('a platoon with only custom roles is scheduled and verified', () => {
    const roles = ['קצין', 'שומר']
    const soldiers = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, roles: i < 3 ? ['קצין', 'שומר'] : ['שומר'], absences: [] }))
    const shifts = Array.from({ length: 12 }, (_, i) => ({
      id: `p0-${String(i).padStart(3, '0')}`,
      postIndex: 0,
      start: i * 120,
      end: (i + 1) * 120,
      nightMinutes: 0,
      requirements: { קצין: 1, שומר: 1 },
    }))
    const out = runAndVerify({ roles, soldiers, shifts, params: { minRestMinutes: 240, nightWeight: 1.5 }, locked: [] })
    expect(out.shortages).toEqual([])
    expect(out.assignments.filter((a) => a.role === 'קצין').every((a) => ['s0', 's1', 's2'].includes(a.soldierId))).toBe(true)
  })
})
