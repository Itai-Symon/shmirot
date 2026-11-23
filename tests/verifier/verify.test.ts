/**
 * Tests of the verifier itself (Layer A). No solver involved: outputs are written by hand
 * or built with tests/helpers/reference.ts, then mutated to trigger every violation kind.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Shift, SolverInput, SolverOutput, Violation } from '../../src/solver/types'
import { maxBipartiteMatching, upperBoundMinRest, verify } from '../../src/verifier/index'
import { buildOutput, type Pick } from '../helpers/reference'
import { hours, makeInput, soldier, soldiers, uniformShifts } from '../helpers/shifts'

const kinds = (v: Violation[]) => v.map((x) => x.kind)

/** 2 soldiers, 3 × 2 h shifts from 22:00, R = 4 h, α = 1.5. */
function smallInput(): SolverInput {
  return makeInput(
    soldiers(2),
    uniformShifts({ count: 3, lengthMinutes: 120, requirements: { soldier: 1 }, clockOffset: hours(22) }),
    { minRestMinutes: 240, nightWeight: 1.5 },
  )
}
const smallPicks: Pick[] = [
  { shiftId: 'p0-000', soldierId: 's00', role: 'soldier' },
  { shiftId: 'p0-001', soldierId: 's01', role: 'soldier' },
  { shiftId: 'p0-002', soldierId: 's00', role: 'soldier' },
]

/** Computed by hand from ALGORITHM.md. */
const smallExpected: SolverOutput = {
  assignments: [
    { shiftId: 'p0-000', soldierId: 's00', role: 'soldier', restDebtMinutes: 0, locked: false },
    { shiftId: 'p0-001', soldierId: 's01', role: 'soldier', restDebtMinutes: 0, locked: false },
    // rest = 240 − 120 = 120 < R = 240 ⇒ debt 120
    { shiftId: 'p0-002', soldierId: 's00', role: 'soldier', restDebtMinutes: 120, locked: false },
  ],
  shortages: [],
  stats: [
    // weights: 22–00 → 120; 00–02 → 1.5·120 = 180; 02–04 → 180. Fair share (120+180+180)/2 = 240.
    { soldierId: 's00', load: 300, fairShare: 240, deviation: 60, shiftCount: 2, nightMinutes: 120, minRestMinutes: 120, totalRestDebtMinutes: 120 },
    { soldierId: 's01', load: 180, fairShare: 240, deviation: -60, shiftCount: 1, nightMinutes: 120, minRestMinutes: null, totalRestDebtMinutes: 0 },
  ],
  // UB for N = 2, K = 1, L = 120: (⌊2/1⌋ − 1)·120 = 120.
  certificate: { achievedMinRestMinutes: 120, upperBoundMinRestMinutes: 120, provenOptimal: true },
  warnings: [],
}

function mutate(fn: (o: SolverOutput) => void, base: SolverOutput = smallExpected): SolverOutput {
  const o = structuredClone(base)
  fn(o)
  return o
}

describe('verify — correct outputs', () => {
  it('accepts the hand-computed example', () => {
    expect(verify(smallInput(), smallExpected)).toEqual([])
  })

  it('reference builder reproduces the hand-computed example', () => {
    expect(buildOutput(smallInput(), smallPicks)).toEqual(smallExpected)
  })

  it('accepts locked assignments that violate rest, with their debt reported', () => {
    const input = makeInput(soldiers(1), uniformShifts({ count: 2, lengthMinutes: 120, requirements: { soldier: 1 } }), { minRestMinutes: 240 }, [
      { shiftId: 'p0-000', soldierId: 's00', role: 'soldier' },
      { shiftId: 'p0-001', soldierId: 's00', role: 'soldier' },
    ])
    const out = buildOutput(input, [
      { shiftId: 'p0-000', soldierId: 's00', role: 'soldier', locked: true },
      { shiftId: 'p0-001', soldierId: 's00', role: 'soldier', locked: true },
    ])
    expect(out.assignments[1].restDebtMinutes).toBe(240)
    expect(verify(input, out)).toEqual([])
  })

  it('does not second-guess locked assignments (unqualified / absent in input)', () => {
    const input = makeInput([soldier('a', ['soldier'], [{ start: 0, end: 60 }])], uniformShifts({ count: 1, lengthMinutes: 120, requirements: { commander: 1 } }), {}, [
      { shiftId: 'p0-000', soldierId: 'a', role: 'commander' },
    ])
    const out = buildOutput(input, [{ shiftId: 'p0-000', soldierId: 'a', role: 'commander', locked: true }])
    expect(verify(input, out)).toEqual([])
  })

  it('accepts an unavoidable shortage (only soldier already busy)', () => {
    const shifts: Shift[] = [
      { id: 'g', postIndex: 0, start: 0, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'h', postIndex: 1, start: 60, end: 180, nightMinutes: 0, requirements: { soldier: 1 } },
    ]
    const input = makeInput(soldiers(1), shifts)
    const out = buildOutput(input, [{ shiftId: 'g', soldierId: 's00', role: 'soldier' }])
    expect(out.shortages).toEqual([{ shiftId: 'h', role: 'soldier', missing: 1 }])
    expect(verify(input, out)).toEqual([])
  })

  it('accepts an unavoidable shortage in a group (two posts, same start, one soldier)', () => {
    const shifts: Shift[] = [
      { id: 'a', postIndex: 0, start: 0, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'b', postIndex: 1, start: 0, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
    ]
    const input = makeInput(soldiers(1), shifts)
    const out = buildOutput(input, [{ shiftId: 'a', soldierId: 's00', role: 'soldier' }])
    expect(verify(input, out)).toEqual([])
  })

  it('accepts an empty instance', () => {
    const input = makeInput([], [])
    const out: SolverOutput = {
      assignments: [],
      shortages: [],
      stats: [],
      certificate: { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false },
      warnings: [],
    }
    expect(verify(input, out)).toEqual([])
  })

  it('accepts random first-fit schedules on roomy instances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 2 }),
        fc.array(fc.record({ len: fc.constantFrom(60, 120, 180), offset: fc.integer({ min: 0, max: 90 }) }), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 600 }),
        (extra, k, posts, rest) => {
          const shifts = posts.flatMap((p, post) =>
            uniformShifts({ count: 6, lengthMinutes: p.len, firstStart: p.offset, postIndex: post, requirements: { soldier: k }, clockOffset: hours(20) }),
          )
          const n = posts.length * k * 2 + extra
          const input = makeInput(soldiers(n), shifts, { minRestMinutes: rest })
          const picks = firstFit(input)
          expect(verify(input, buildOutput(input, picks))).toEqual([])
        },
      ),
      { seed: 1001, numRuns: 100 },
    )
  })
})

/** Time-ordered first-fit; complete when soldiers outnumber concurrent seats. */
function firstFit(input: SolverInput): Pick[] {
  const busy = new Map<string, number>()
  const picks: Pick[] = []
  const ordered = [...input.shifts].sort((a, b) => a.start - b.start || a.postIndex - b.postIndex)
  for (const sh of ordered) {
    let need = sh.requirements.soldier ?? 0
    for (const s of input.soldiers) {
      if (need === 0) break
      if ((busy.get(s.id) ?? -Infinity) > sh.start) continue
      busy.set(s.id, sh.end)
      picks.push({ shiftId: sh.id, soldierId: s.id, role: 'soldier' })
      need--
    }
  }
  return picks
}

describe('verify — detects every violation kind', () => {
  it('UNKNOWN_SHIFT_OR_SOLDIER', () => {
    const out = mutate((o) => (o.assignments[1].soldierId = 'ghost'))
    expect(kinds(verify(smallInput(), out))).toContain('UNKNOWN_SHIFT_OR_SOLDIER')
    const out2 = mutate((o) => o.shortages.push({ shiftId: 'nope', role: 'soldier', missing: 1 }))
    expect(kinds(verify(smallInput(), out2))).toContain('UNKNOWN_SHIFT_OR_SOLDIER')
  })

  it('UNQUALIFIED', () => {
    const input = smallInput()
    input.shifts[1].requirements = { commander: 1 }
    const out = mutate((o) => (o.assignments[1].role = 'commander'))
    expect(kinds(verify(input, out))).toEqual(['UNQUALIFIED'])
  })

  it('ASSIGNED_WHILE_ABSENT (absence touching one minute of the shift)', () => {
    const input = smallInput()
    input.soldiers[1].absences = [{ start: 239, end: 400 }]
    const v = verify(input, smallExpected)
    expect(kinds(v)).toContain('ASSIGNED_WHILE_ABSENT')
    // the absence also changes presence ⇒ fair shares differ
    expect(kinds(v)).toContain('WRONG_STATS')
  })

  it('half-open intervals: absence ending exactly at shift start is fine', () => {
    const input = smallInput()
    input.soldiers[1].absences = [{ start: 0, end: 120 }]
    const out = buildOutput(input, smallPicks)
    expect(verify(input, out)).toEqual([])
  })

  it('DOUBLE_BOOKED', () => {
    const input = smallInput()
    input.shifts.push({ id: 'q', postIndex: 1, start: 60, end: 180, nightMinutes: 0, requirements: { soldier: 1 } })
    input.soldiers.push(soldier('s02', ['soldier']))
    const out = buildOutput(input, [...smallPicks, { shiftId: 'q', soldierId: 's00', role: 'soldier' }])
    expect(kinds(verify(input, out))).toContain('DOUBLE_BOOKED')
  })

  it('DOUBLE_BOOKED: same soldier twice in one shift', () => {
    const input = smallInput()
    input.shifts[0].requirements = { soldier: 2 }
    const out = buildOutput(input, [...smallPicks, { shiftId: 'p0-000', soldierId: 's00', role: 'soldier' }])
    expect(kinds(verify(input, out))).toContain('DOUBLE_BOOKED')
  })

  it('OVERFILLED', () => {
    const out = mutate((o) => o.assignments.push({ shiftId: 'p0-000', soldierId: 's01', role: 'soldier', restDebtMinutes: 0, locked: false }))
    expect(kinds(verify(smallInput(), out))).toContain('OVERFILLED')
  })

  it('LOCK_NOT_RESPECTED: lock missing', () => {
    const input = smallInput()
    input.locked = [{ shiftId: 'p0-000', soldierId: 's01', role: 'soldier' }]
    expect(kinds(verify(input, smallExpected))).toContain('LOCK_NOT_RESPECTED')
  })

  it('LOCK_NOT_RESPECTED: assignment marked locked without a lock', () => {
    const out = mutate((o) => (o.assignments[0].locked = true))
    expect(kinds(verify(smallInput(), out))).toEqual(['LOCK_NOT_RESPECTED'])
  })

  it('AVOIDABLE_SHORTAGE: a free qualified soldier was left unused', () => {
    const input = smallInput()
    const out = buildOutput(input, [smallPicks[0], smallPicks[2]])
    expect(out.shortages).toEqual([{ shiftId: 'p0-001', role: 'soldier', missing: 1 }])
    expect(kinds(verify(input, out))).toEqual(['AVOIDABLE_SHORTAGE'])
  })

  it('AVOIDABLE_SHORTAGE: greedy wastes the only commander (ALGORITHM.md §4.5)', () => {
    const input = makeInput(
      [soldier('dani', ['commander', 'soldier']), soldier('yossi', ['soldier'])],
      uniformShifts({ count: 1, lengthMinutes: 120, requirements: { commander: 1, soldier: 1 } }),
    )
    const greedy = buildOutput(input, [{ shiftId: 'p0-000', soldierId: 'dani', role: 'soldier' }])
    expect(kinds(verify(input, greedy))).toEqual(['AVOIDABLE_SHORTAGE'])
    const matched = buildOutput(input, [
      { shiftId: 'p0-000', soldierId: 'dani', role: 'commander' },
      { shiftId: 'p0-000', soldierId: 'yossi', role: 'soldier' },
    ])
    expect(verify(input, matched)).toEqual([])
  })

  it('AVOIDABLE_SHORTAGE: an earlier shift sacrificed for a later overlapping one', () => {
    const shifts: Shift[] = [
      { id: 'g', postIndex: 0, start: 0, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'h', postIndex: 1, start: 60, end: 180, nightMinutes: 0, requirements: { soldier: 1 } },
    ]
    const input = makeInput(soldiers(1), shifts)
    const out = buildOutput(input, [{ shiftId: 'h', soldierId: 's00', role: 'soldier' }])
    expect(kinds(verify(input, out))).toEqual(['AVOIDABLE_SHORTAGE'])
  })

  it('WRONG_REST_DEBT', () => {
    const out = mutate((o) => (o.assignments[2].restDebtMinutes = 0))
    expect(kinds(verify(smallInput(), out))).toContain('WRONG_REST_DEBT')
  })

  it.each([
    ['load', (o: SolverOutput) => (o.stats[0].load = 299)],
    ['fairShare', (o: SolverOutput) => (o.stats[0].fairShare = 250)],
    ['deviation', (o: SolverOutput) => (o.stats[0].deviation = 0)],
    ['shiftCount', (o: SolverOutput) => (o.stats[1].shiftCount = 2)],
    ['nightMinutes', (o: SolverOutput) => (o.stats[1].nightMinutes = 0)],
    ['minRest', (o: SolverOutput) => (o.stats[1].minRestMinutes = 0)],
    ['totalRestDebt', (o: SolverOutput) => (o.stats[0].totalRestDebtMinutes = 0)],
    ['missing stats', (o: SolverOutput) => o.stats.pop()],
    ['duplicate stats', (o: SolverOutput) => o.stats.push({ ...o.stats[0] })],
    ['unknown stats', (o: SolverOutput) => o.stats.push({ ...o.stats[0], soldierId: 'ghost' })],
    ['phantom shortage', (o: SolverOutput) => o.shortages.push({ shiftId: 'p0-000', role: 'soldier', missing: 1 })],
    ['zero shortage', (o: SolverOutput) => o.shortages.push({ shiftId: 'p0-000', role: 'medic', missing: 0 })],
    ['achieved', (o: SolverOutput) => (o.certificate.achievedMinRestMinutes = 240)],
    ['UB below achieved', (o: SolverOutput) => (o.certificate.upperBoundMinRestMinutes = 60)],
    ['UB wrong', (o: SolverOutput) => ((o.certificate.upperBoundMinRestMinutes = 360), (o.certificate.provenOptimal = false))],
    ['UB missing', (o: SolverOutput) => ((o.certificate.upperBoundMinRestMinutes = null), (o.certificate.provenOptimal = false))],
    ['provenOptimal', (o: SolverOutput) => (o.certificate.provenOptimal = false)],
  ])('WRONG_STATS: %s', (_name, fn) => {
    expect(kinds(verify(smallInput(), mutate(fn)))).toContain('WRONG_STATS')
  })

  it('WRONG_STATS: unreported shortage', () => {
    const input = makeInput(soldiers(1), [
      { id: 'a', postIndex: 0, start: 0, end: 60, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'b', postIndex: 1, start: 0, end: 60, nightMinutes: 0, requirements: { soldier: 1 } },
    ])
    const out = buildOutput(input, [{ shiftId: 'a', soldierId: 's00', role: 'soldier' }])
    out.shortages = []
    expect(kinds(verify(input, out))).toContain('WRONG_STATS')
  })

  it('WRONG_STATS: certificate must be n/a when there are shortages', () => {
    const input = makeInput(soldiers(1), [
      { id: 'a', postIndex: 0, start: 0, end: 60, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'b', postIndex: 1, start: 0, end: 60, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'c', postIndex: 0, start: 60, end: 120, nightMinutes: 0, requirements: { soldier: 1 } },
    ])
    const out = buildOutput(input, [
      { shiftId: 'a', soldierId: 's00', role: 'soldier' },
      { shiftId: 'c', soldierId: 's00', role: 'soldier' },
    ])
    expect(verify(input, out)).toEqual([])
    out.certificate.upperBoundMinRestMinutes = 0
    out.certificate.provenOptimal = true
    expect(kinds(verify(input, out))).toContain('WRONG_STATS')
  })
})

describe('own maximum matching', () => {
  it('equals brute force on random small bipartite graphs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }).chain((r) => fc.array(fc.subarray(Array.from({ length: r }, (_, i) => i)), { maxLength: 6 }).map((adj) => ({ r, adj }))),
        ({ r, adj }) => {
          expect(maxBipartiteMatching(adj, r).size).toBe(bruteMatching(adj, 0, new Set()))
        },
      ),
      { seed: 1002, numRuns: 300 },
    )
  })

  it('returns a consistent matching', () => {
    const adj = [[0, 1], [0], [1, 2]]
    const { size, matchOfLeft } = maxBipartiteMatching(adj, 3)
    expect(size).toBe(3)
    matchOfLeft.forEach((r, l) => expect(adj[l]).toContain(r))
    expect(new Set(matchOfLeft).size).toBe(3)
  })
})

function bruteMatching(adj: number[][], l: number, used: Set<number>): number {
  if (l === adj.length) return 0
  let best = bruteMatching(adj, l + 1, used)
  for (const r of adj[l]) {
    if (used.has(r)) continue
    used.add(r)
    best = Math.max(best, 1 + bruteMatching(adj, l + 1, used))
    used.delete(r)
  }
  return best
}

describe('own certificate upper bound (§6)', () => {
  it('uniform setting: UB = (⌊N/K⌋ − 1)·L', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 3 }), fc.constantFrom(60, 120, 180, 240), fc.integer({ min: 0, max: 20 }), (n, k, len, extra) => {
        fc.pre(k <= n)
        const g = Math.floor(n / k) + 1
        const input = makeInput(soldiers(n), uniformShifts({ count: g + extra, lengthMinutes: len, requirements: { soldier: k }, noNight: true }))
        expect(upperBoundMinRest(input)).toEqual({ kind: 'bounded', value: (Math.floor(n / k) - 1) * len })
      }),
      { seed: 1003, numRuns: 200 },
    )
  })

  it('unbounded when nobody ever has to guard twice', () => {
    const input = makeInput(soldiers(4), uniformShifts({ count: 2, lengthMinutes: 120, requirements: { soldier: 2 } }))
    expect(upperBoundMinRest(input)).toEqual({ kind: 'unbounded' })
  })

  it('infeasible when a moment cannot be staffed', () => {
    const input = makeInput(soldiers(1), uniformShifts({ count: 2, lengthMinutes: 120, requirements: { soldier: 2 } }))
    expect(upperBoundMinRest(input)).toEqual({ kind: 'infeasible' })
  })

  it('accounts for roles and absences', () => {
    // One commander needed every 2 h; two commanders, one absent for the first 4 h.
    const input = makeInput(
      [soldier('c1', ['commander']), soldier('c2', ['commander'], [{ start: 0, end: 240 }]), soldier('x', ['soldier'])],
      uniformShifts({ count: 6, lengthMinutes: 120, requirements: { commander: 1 } }),
    )
    // c1 must take shifts 0 and 1 back to back ⇒ UB = 0.
    expect(upperBoundMinRest(input)).toEqual({ kind: 'bounded', value: 0 })
  })
})
