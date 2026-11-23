import { describe, expect, it } from 'vitest'
import { compareCandidateKeys, shiftWeight, solve } from './solve'
import type { LockedAssignment, Role, Shift, Soldier, SolverInput, SolverOutput } from './types'

const soldier = (id: string, roles: Role[] = ['soldier'], absences: Soldier['absences'] = []): Soldier => ({
  id,
  roles,
  absences,
})

/** `count` back-to-back shifts of `length` minutes at one post. */
function uniformShifts(
  count: number,
  length: number,
  requirements: Shift['requirements'] = { soldier: 1 },
  postIndex = 0,
  offset = 0,
): Shift[] {
  return Array.from({ length: count }, (_, k) => ({
    id: `p${postIndex}-${String(k).padStart(3, '0')}`,
    postIndex,
    start: offset + k * length,
    end: offset + (k + 1) * length,
    nightMinutes: 0,
    requirements,
  }))
}

function input(
  soldiers: Soldier[],
  shifts: Shift[],
  opts: { R?: number; alpha?: number; locked?: LockedAssignment[] } = {},
): SolverInput {
  return {
    soldiers,
    shifts,
    params: { minRestMinutes: opts.R ?? 0, nightWeight: opts.alpha ?? 1 },
    locked: opts.locked ?? [],
  }
}

/** soldier ids per shift, in output order */
function byShift(out: SolverOutput): Record<string, string[]> {
  const r: Record<string, string[]> = {}
  for (const a of out.assignments) (r[a.shiftId] ??= []).push(a.soldierId)
  return r
}

function sequence(out: SolverOutput, shifts: Shift[]): string[] {
  const m = byShift(out)
  return shifts.map((s) => (m[s.id] ?? []).join('+'))
}

describe('worked example (SESSIONS.md 1A)', () => {
  // א ב ג ד, one post, 1 per shift, 2 h shifts from 20:00 (to 06:00), R = 4 h, nightWeight = 1.
  const soldiers = ['א', 'ב', 'ג', 'ד'].map((id) => soldier(id))
  const night = [0, 0, 120, 120, 120]
  const shifts = uniformShifts(5, 120).map((s, k) => ({ ...s, nightMinutes: night[k] }))
  const out = solve(input(soldiers, shifts, { R: 240, alpha: 1 }))

  it('assigns א, ב, ג, ד, א', () => {
    expect(sequence(out, shifts)).toEqual(['א', 'ב', 'ג', 'ד', 'א'])
  })

  it('has no debt or shortages and is proven optimal', () => {
    expect(out.shortages).toEqual([])
    expect(out.assignments.every((a) => a.restDebtMinutes === 0 && !a.locked)).toBe(true)
    expect(out.warnings).toEqual([])
    expect(out.certificate).toEqual({
      achievedMinRestMinutes: 360,
      upperBoundMinRestMinutes: 360,
      provenOptimal: true,
    })
  })

  it('reports per-soldier stats', () => {
    const alef = out.stats.find((s) => s.soldierId === 'א')!
    expect(alef).toEqual({
      soldierId: 'א',
      load: 240,
      fairShare: 150,
      deviation: 90,
      shiftCount: 2,
      nightMinutes: 120,
      minRestMinutes: 360,
      totalRestDebtMinutes: 0,
    })
    const dalet = out.stats.find((s) => s.soldierId === 'ד')!
    expect(dalet.minRestMinutes).toBeNull()
    expect(dalet.shiftCount).toBe(1)
  })
})

describe('ranking (§4.4 b)', () => {
  it('tier 0 orders by deviation first, tier 1 by rest first', () => {
    const base = { nextAbsenceStart: Infinity, id: 'x' }
    expect(compareCandidateKeys({ ...base, tier: 0, deviation: 1, rest: 999 }, { ...base, tier: 0, deviation: 2, rest: 0 })).toBeLessThan(0)
    expect(compareCandidateKeys({ ...base, tier: 1, deviation: 9, rest: 100 }, { ...base, tier: 1, deviation: 0, rest: 50 })).toBeLessThan(0)
    expect(compareCandidateKeys({ ...base, tier: 0, deviation: 99, rest: 0 }, { ...base, tier: 1, deviation: -99, rest: 0 })).toBeLessThan(0)
  })

  it('prefers a rested soldier over a tired one regardless of load (D3)', () => {
    const shifts: Shift[] = [
      { id: 's1', postIndex: 0, start: 0, end: 480, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 's2', postIndex: 0, start: 700, end: 760, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 's3', postIndex: 0, start: 760, end: 820, nightMinutes: 0, requirements: { soldier: 1 } },
    ]
    const out = solve(
      input([soldier('a'), soldier('b')], shifts, {
        R: 240,
        locked: [
          { shiftId: 's1', soldierId: 'a', role: 'soldier' },
          { shiftId: 's2', soldierId: 'b', role: 'soldier' },
        ],
      }),
    )
    expect(byShift(out).s3).toEqual(['a'])
  })

  it('among equals, uses the soldier who leaves soon first', () => {
    const out = solve(input([soldier('a'), soldier('b', ['soldier'], [{ start: 500, end: 900 }])], uniformShifts(1, 60)))
    expect(sequence(out, uniformShifts(1, 60))).toEqual(['b'])
  })

  it('computes weight with the night multiplier', () => {
    expect(shiftWeight({ id: 'x', postIndex: 0, start: 0, end: 120, nightMinutes: 60, requirements: {} }, 1.5)).toBe(150)
  })
})

describe('joint matching (§4.4 c)', () => {
  it('fills both seats instead of wasting the commander (§4.5)', () => {
    const shifts = uniformShifts(1, 120, { commander: 1, soldier: 1 })
    const out = solve(input([soldier('dani', ['commander', 'soldier']), soldier('yossi')], shifts))
    expect(out.shortages).toEqual([])
    expect(out.assignments.map((a) => [a.soldierId, a.role])).toEqual([
      ['dani', 'commander'],
      ['yossi', 'soldier'],
    ])
  })

  it('breaks equal-cost ties: best-ranked soldier takes the earliest seat', () => {
    const shifts = uniformShifts(1, 120, { commander: 1, soldier: 1 })
    const both: Role[] = ['commander', 'soldier']
    const out = solve(input([soldier('b', both), soldier('a', both)], shifts))
    expect(out.assignments.map((a) => [a.soldierId, a.role])).toEqual([
      ['a', 'commander'],
      ['b', 'soldier'],
    ])
  })

  it('lookahead keeps the commander free for an overlapping post that starts later', () => {
    const shifts: Shift[] = [
      { id: 'p0', postIndex: 0, start: 0, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'p1', postIndex: 1, start: 60, end: 180, nightMinutes: 0, requirements: { commander: 1 } },
    ]
    const out = solve(input([soldier('a', ['commander', 'soldier']), soldier('b')], shifts))
    expect(out.shortages).toEqual([])
    expect(byShift(out)).toEqual({ p0: ['b'], p1: ['a'] })
  })

  it('never leaves a seat of the current group empty for a lookahead seat', () => {
    const shifts: Shift[] = [
      { id: 'p0', postIndex: 0, start: 0, end: 120, nightMinutes: 0, requirements: { commander: 1 } },
      { id: 'p1', postIndex: 1, start: 60, end: 180, nightMinutes: 0, requirements: { commander: 1 } },
    ]
    const out = solve(input([soldier('c', ['commander'])], shifts))
    expect(byShift(out)).toEqual({ p0: ['c'] })
    expect(out.shortages).toEqual([{ shiftId: 'p1', role: 'commander', missing: 1 }])
  })

  it('does not put one soldier in two overlapping shifts of the same group', () => {
    const shifts = [...uniformShifts(1, 120, { soldier: 1 }, 0), ...uniformShifts(1, 120, { soldier: 1 }, 1)]
    const out = solve(input([soldier('a')], shifts))
    expect(out.assignments).toHaveLength(1)
    expect(out.shortages).toEqual([{ shiftId: 'p1-000', role: 'soldier', missing: 1 }])
  })
})

describe('locks (§4.4, interleaved)', () => {
  it('keeps locked assignments that violate rest and reports their debt', () => {
    const shifts = uniformShifts(2, 60)
    const out = solve(
      input([soldier('a'), soldier('b')], shifts, {
        R: 240,
        locked: shifts.map((s) => ({ shiftId: s.id, soldierId: 'a', role: 'soldier' as const })),
      }),
    )
    expect(out.assignments).toEqual([
      { shiftId: 'p0-000', soldierId: 'a', role: 'soldier', restDebtMinutes: 0, locked: true },
      { shiftId: 'p0-001', soldierId: 'a', role: 'soldier', restDebtMinutes: 240, locked: true },
    ])
    expect(out.warnings).toEqual([
      { code: 'REST_DEBT', details: { assignments: 1, totalMinutes: 240, maxMinutes: 240 } },
    ])
  })

  it('a future pin does not block the soldier from earlier shifts', () => {
    const shifts = uniformShifts(4, 60)
    const out = solve(
      input([soldier('a'), soldier('b'), soldier('c')], shifts, {
        locked: [{ shiftId: 'p0-003', soldierId: 'a', role: 'soldier' }],
      }),
    )
    expect(sequence(out, shifts)).toEqual(['a', 'b', 'c', 'a'])
    expect(out.assignments.find((x) => x.shiftId === 'p0-003')!.locked).toBe(true)
  })

  it('a future pin keeps the soldier out of overlapping shifts', () => {
    const shifts: Shift[] = [
      { id: 'x', postIndex: 0, start: 0, end: 90, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'y', postIndex: 1, start: 60, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
    ]
    const out = solve(input([soldier('a'), soldier('b')], shifts, { locked: [{ shiftId: 'y', soldierId: 'a', role: 'soldier' }] }))
    expect(byShift(out)).toEqual({ x: ['b'], y: ['a'] })
  })

  it('fills the open seats of a partially locked shift', () => {
    const shifts = uniformShifts(1, 60, { soldier: 2 })
    const out = solve(
      input([soldier('a'), soldier('b'), soldier('c')], shifts, {
        locked: [{ shiftId: 'p0-000', soldierId: 'c', role: 'soldier' }],
      }),
    )
    expect(out.shortages).toEqual([])
    expect(out.assignments.map((x) => [x.soldierId, x.locked])).toEqual([
      ['a', false],
      ['c', true],
    ])
  })

  it('ignores locks that reference unknown shifts or soldiers', () => {
    const shifts = uniformShifts(1, 60)
    const out = solve(
      input([soldier('a')], shifts, {
        locked: [
          { shiftId: 'nope', soldierId: 'a', role: 'soldier' },
          { shiftId: 'p0-000', soldierId: 'ghost', role: 'soldier' },
        ],
      }),
    )
    expect(sequence(out, shifts)).toEqual(['a'])
  })
})

describe('fair share relative to presence (§4.3, D1)', () => {
  it('a returning soldier does not catch up on missed hours', () => {
    const shifts = uniformShifts(10, 60)
    const out = solve(input([soldier('a'), soldier('b'), soldier('c', ['soldier'], [{ start: 0, end: 240 }])], shifts))
    const seq = sequence(out, shifts)
    expect(seq.slice(0, 4)).toEqual(['a', 'b', 'a', 'b'])
    expect(seq.slice(4).filter((x) => x === 'c')).toHaveLength(2)
    const c = out.stats.find((s) => s.soldierId === 'c')!
    expect(c.fairShare).toBe(120)
    expect(c.deviation).toBe(0)
  })
})

describe('shortages and degenerate input', () => {
  it('reports all shortages when the whole platoon is absent', () => {
    const shifts = uniformShifts(2, 60, { commander: 1, soldier: 2 })
    const out = solve(input([soldier('a', ['soldier'], [{ start: 0, end: 1000 }])], shifts))
    expect(out.assignments).toEqual([])
    expect(out.shortages).toEqual([
      { shiftId: 'p0-000', role: 'commander', missing: 1 },
      { shiftId: 'p0-000', role: 'soldier', missing: 2 },
      { shiftId: 'p0-001', role: 'commander', missing: 1 },
      { shiftId: 'p0-001', role: 'soldier', missing: 2 },
    ])
    expect(out.certificate).toEqual({ achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false })
  })

  it('handles zero soldiers, zero shifts and zero requirements', () => {
    expect(solve(input([], []))).toEqual({
      assignments: [],
      shortages: [],
      stats: [],
      certificate: { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false },
      warnings: [],
    })
    const out = solve(input([soldier('a')], uniformShifts(3, 60, { soldier: 0 })))
    expect(out.assignments).toEqual([])
    expect(out.shortages).toEqual([])
    expect(out.stats[0].fairShare).toBe(0)
  })

  it('does not assign a soldier who returns mid-shift', () => {
    const shifts = uniformShifts(2, 60)
    const out = solve(input([soldier('a', ['soldier'], [{ start: 0, end: 30 }])], shifts))
    expect(sequence(out, shifts)).toEqual(['', 'a'])
  })
})

describe('uniform setting (Claim 4)', () => {
  for (const [N, K] of [
    [5, 2],
    [7, 2],
    [6, 3],
    [4, 1],
  ] as const) {
    it(`N=${N}, K=${K}: min rest is (⌊N/K⌋−1)·L and proven optimal; counts differ by ≤ 1`, () => {
      const L = 60
      const soldiers = Array.from({ length: N }, (_, i) => soldier(`s${i}`))
      const out = solve(input(soldiers, uniformShifts(24, L, { soldier: K }), { R: 120 }))
      const expected = (Math.floor(N / K) - 1) * L
      expect(out.certificate).toEqual({
        achievedMinRestMinutes: expected,
        upperBoundMinRestMinutes: expected,
        provenOptimal: true,
      })
      const counts = out.stats.map((s) => s.shiftCount)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    })
  }
})

describe('determinism', () => {
  const soldiers = [
    soldier('d', ['commander', 'soldier']),
    soldier('a', ['soldier', 'medic'], [{ start: 300, end: 600 }]),
    soldier('c', ['soldier']),
    soldier('b', ['commander']),
    soldier('e', ['soldier', 'driver']),
  ]
  const shifts = [
    ...uniformShifts(8, 120, { commander: 1, soldier: 1 }, 0),
    ...uniformShifts(6, 180, { soldier: 1 }, 1, 60),
  ]
  const base = input(soldiers, shifts, { R: 240, alpha: 1.5 })

  it('same input ⇒ identical output', () => {
    expect(JSON.stringify(solve(base))).toBe(JSON.stringify(solve(structuredClone(base))))
  })

  it('soldier and shift order in the input do not matter', () => {
    const a = solve(base)
    const b = solve({ ...base, soldiers: [...soldiers].reverse(), shifts: [...shifts].reverse() })
    expect(b.assignments).toEqual(a.assignments)
    expect(b.shortages).toEqual(a.shortages)
    const sortStats = (o: SolverOutput) => [...o.stats].sort((x, y) => (x.soldierId < y.soldierId ? -1 : 1))
    expect(sortStats(b)).toEqual(sortStats(a))
  })
})
