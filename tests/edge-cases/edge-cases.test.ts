/**
 * Layer D — fixed edge cases, one `describe` per row of the table in ALGORITHM.md §8.
 * Every solve() run goes through runAndVerify (determinism + independent verifier).
 */
import { describe, expect, it } from 'vitest'
import type { Shift, SolverOutput } from '../../src/solver/types'
import { DAY, hours, makeInput, nightMinutes, shiftId, soldier, soldiers, uniformShifts } from '../helpers/shifts'
import { runAndVerify } from '../helpers/solve'

const codes = (out: SolverOutput) => out.warnings.map((w) => w.code)
const ids = (out: SolverOutput, shift: string) => out.assignments.filter((a) => a.shiftId === shift).map((a) => a.soldierId).sort()

describe('N = K(r+1) exactly', () => {
  it('K=1, L=2h, R=4h, N=3: min rest exactly R; period 6 h divides 24 h ⇒ NIGHT_TRAP', () => {
    const input = makeInput(soldiers(3), uniformShifts({ count: 36, lengthMinutes: 120, requirements: { soldier: 1 }, clockOffset: hours(20) }), {
      minRestMinutes: 240,
    })
    const out = runAndVerify(input)
    expect(out.shortages).toEqual([])
    expect(out.certificate.achievedMinRestMinutes).toBe(240)
    expect(out.certificate.provenOptimal).toBe(true)
    expect(out.assignments.every((a) => a.restDebtMinutes === 0)).toBe(true)
    expect(codes(out)).toContain('NIGHT_TRAP')
  })

  it('K=2, L=3h, R=6h, N=6: min rest exactly R; period 9 h does not divide 24 h ⇒ no NIGHT_TRAP', () => {
    const input = makeInput(soldiers(6), uniformShifts({ count: 24, lengthMinutes: 180, requirements: { soldier: 2 }, clockOffset: hours(20) }), {
      minRestMinutes: 360,
    })
    const out = runAndVerify(input)
    expect(out.shortages).toEqual([])
    expect(out.certificate.achievedMinRestMinutes).toBe(360)
    expect(out.certificate.provenOptimal).toBe(true)
    expect(codes(out)).not.toContain('NIGHT_TRAP')
  })
})

describe('N < K(r+1)', () => {
  it('K=1, L=2h, R=8h, N=3: schedule produced, debt minimal and spread evenly', () => {
    const input = makeInput(soldiers(3), uniformShifts({ count: 30, lengthMinutes: 120, requirements: { soldier: 1 }, clockOffset: hours(20) }), {
      minRestMinutes: 480,
    })
    const out = runAndVerify(input)
    expect(out.shortages).toEqual([])
    // Best possible min rest is (⌊3/1⌋ − 1)·120 = 240 (Claim 4); debt is the minimum possible.
    expect(out.certificate.achievedMinRestMinutes).toBe(240)
    expect(out.certificate.provenOptimal).toBe(true)
    const counts = out.stats.map((s) => s.shiftCount)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    const debts = out.stats.map((s) => s.totalRestDebtMinutes)
    const oneShiftOfDebt = Math.max(...out.assignments.map((a) => a.restDebtMinutes))
    expect(oneShiftOfDebt).toBe(240)
    expect(Math.max(...debts) - Math.min(...debts)).toBeLessThanOrEqual(oneShiftOfDebt)
    expect(codes(out)).toContain('REST_DEBT')
  })
})

describe('night trap (period divides 24 h)', () => {
  it('K=2, L=4h, R=8h, N=6: NIGHT_TRAP, and the schedule repeats every r+1 = 3 shifts', () => {
    const input = makeInput(soldiers(6), uniformShifts({ count: 18, lengthMinutes: 240, requirements: { soldier: 2 }, clockOffset: hours(22) }), {
      minRestMinutes: 480,
    })
    const out = runAndVerify(input)
    expect(codes(out)).toContain('NIGHT_TRAP')
    expect(out.certificate.achievedMinRestMinutes).toBe(480)
    for (let i = 3; i < 18; i++) expect(ids(out, shiftId(0, i))).toEqual(ids(out, shiftId(0, i - 3)))
  })
})

describe('single commander, post needs a commander 24/7', () => {
  it('ROLE_BOTTLENECK for commander; schedule still produced, every commander slot filled by him', () => {
    const input = makeInput(
      [soldier('c', ['commander', 'soldier']), ...soldiers(4)],
      uniformShifts({ count: 12, lengthMinutes: 120, requirements: { commander: 1, soldier: 1 }, clockOffset: hours(20) }),
    )
    const out = runAndVerify(input)
    expect(out.shortages).toEqual([])
    expect(out.warnings.some((w) => w.code === 'ROLE_BOTTLENECK' && w.role === 'commander')).toBe(true)
    const commanderSlots = out.assignments.filter((a) => a.role === 'commander')
    expect(commanderSlots).toHaveLength(12)
    expect(commanderSlots.every((a) => a.soldierId === 'c')).toBe(true)
  })
})

describe('commander goes home mid-activity', () => {
  it('precise commander shortage for exactly the shifts he misses; no crash, no other shortage', () => {
    const leaves = 600 // 10 h in; shifts 0–4 end by then
    const input = makeInput(
      [soldier('c', ['commander'], [{ start: leaves, end: 100 * DAY }]), ...soldiers(4)],
      uniformShifts({ count: 12, lengthMinutes: 120, requirements: { commander: 1, soldier: 1 }, clockOffset: hours(8) }),
      { minRestMinutes: 0 },
    )
    const out = runAndVerify(input)
    const expected = Array.from({ length: 7 }, (_, i) => ({ shiftId: shiftId(0, i + 5), role: 'commander', missing: 1 }))
    expect([...out.shortages].sort((a, b) => (a.shiftId < b.shiftId ? -1 : 1))).toEqual(expected)
    for (let i = 0; i < 5; i++) expect(ids(out, shiftId(0, i))).toContain('c')
  })
})

describe('entire platoon absent', () => {
  it('everything is a shortage, nothing assigned, no error', () => {
    const away = [{ start: 0, end: 100 * DAY }]
    const input = makeInput(
      [soldier('a', ['commander', 'soldier'], away), soldier('b', ['soldier'], away), soldier('c', ['soldier'], away)],
      uniformShifts({ count: 6, lengthMinutes: 120, requirements: { commander: 1, soldier: 2 } }),
    )
    const out = runAndVerify(input)
    expect(out.assignments).toEqual([])
    expect(out.shortages).toHaveLength(12)
    for (const s of out.shortages) expect(s.missing).toBe(s.role === 'commander' ? 1 : 2)
    for (const st of out.stats) expect(st).toMatchObject({ load: 0, fairShare: 0, shiftCount: 0, minRestMinutes: null, totalRestDebtMinutes: 0 })
    expect(out.certificate).toEqual({ achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false })
  })
})

describe('shift crossing midnight', () => {
  it('6 h shifts from 20:00: night minutes and rest computed across midnight', () => {
    const shifts = uniformShifts({ count: 8, lengthMinutes: 360, requirements: { soldier: 1 }, clockOffset: hours(20) })
    // 20–02 → 2 h night, 02–08 → 4 h, 08–14 → 0, 14–20 → 0, then repeats.
    expect(shifts.map((s) => s.nightMinutes)).toEqual([120, 240, 0, 0, 120, 240, 0, 0])
    const input = makeInput(soldiers(2), shifts, { minRestMinutes: 480 })
    const out = runAndVerify(input)
    // Only alternation avoids zero rest; rest is 6 h everywhere ⇒ debt 2 h on every repeat shift.
    expect(out.certificate.achievedMinRestMinutes).toBe(360)
    expect(out.certificate.provenOptimal).toBe(true)
    expect(out.assignments.filter((a) => a.restDebtMinutes === 120)).toHaveLength(6)
    expect(out.stats.map((s) => s.nightMinutes).sort((a, b) => a - b)).toEqual([240, 480])
  })

  it('absence ending at midnight: soldier is available for the shift starting at midnight', () => {
    const shifts = uniformShifts({ count: 3, lengthMinutes: 120, requirements: { soldier: 2 }, clockOffset: hours(22) })
    expect(nightMinutes(120, 240, hours(22))).toBe(120)
    const input = makeInput([soldier('a', ['soldier']), soldier('b', ['soldier'], [{ start: 0, end: 120 }])], shifts, { minRestMinutes: 0 })
    const out = runAndVerify(input)
    expect(ids(out, shiftId(0, 1))).toEqual(['a', 'b'])
  })
})

describe('posts with misaligned shift boundaries', () => {
  const posts = (): Shift[] => [
    ...uniformShifts({ count: 12, lengthMinutes: 120, postIndex: 0, requirements: { commander: 1, soldier: 1 }, clockOffset: hours(18) }),
    ...uniformShifts({ count: 8, lengthMinutes: 180, postIndex: 1, firstStart: 60, requirements: { soldier: 1 }, clockOffset: hours(18) }),
    ...uniformShifts({ count: 6, lengthMinutes: 240, postIndex: 2, firstStart: 30, requirements: { soldier: 1, medic: 1 }, clockOffset: hours(18) }),
  ]

  it('roomy platoon: no double booking, no shortage', () => {
    const input = makeInput(
      [soldier('c1', ['commander', 'soldier']), soldier('c2', ['commander']), soldier('m1', ['medic', 'soldier']), soldier('m2', ['medic']), ...soldiers(8)],
      posts(),
    )
    const out = runAndVerify(input)
    expect(out.shortages).toEqual([])
  })

  it('scarce platoon: shortages only where unavoidable (Claim 3, checked by the verifier)', () => {
    const input = makeInput([soldier('c1', ['commander', 'soldier']), soldier('m1', ['medic', 'soldier']), ...soldiers(2)], posts())
    const out = runAndVerify(input)
    expect(out.shortages.length).toBeGreaterThan(0)
  })
})

describe('soldier returns mid-shift', () => {
  it('not assigned to a shift that started before he was back', () => {
    const input = makeInput(
      [soldier('a', ['soldier']), soldier('b', ['soldier']), soldier('x', ['soldier'], [{ start: 0, end: 150 }])],
      uniformShifts({ count: 4, lengthMinutes: 120, requirements: { soldier: 3 } }),
      { minRestMinutes: 0 },
    )
    const out = runAndVerify(input)
    expect(ids(out, shiftId(0, 0))).not.toContain('x')
    expect(ids(out, shiftId(0, 1))).not.toContain('x') // [120, 240) started before 150
    expect([...out.shortages].sort((p, q) => (p.shiftId < q.shiftId ? -1 : 1))).toEqual([
      { shiftId: shiftId(0, 0), role: 'soldier', missing: 1 },
      { shiftId: shiftId(0, 1), role: 'soldier', missing: 1 },
    ])
    expect(ids(out, shiftId(0, 2))).toEqual(['a', 'b', 'x'])
  })
})

describe('locked shifts violating rest', () => {
  it('locks kept as given, their debt reported', () => {
    const input = makeInput(
      soldiers(3),
      uniformShifts({ count: 6, lengthMinutes: 120, requirements: { soldier: 1 }, clockOffset: hours(8) }),
      { minRestMinutes: 240 },
      [
        { shiftId: shiftId(0, 0), soldierId: 's00', role: 'soldier' },
        { shiftId: shiftId(0, 1), soldierId: 's00', role: 'soldier' },
      ],
    )
    const out = runAndVerify(input)
    const locked = out.assignments.filter((a) => a.locked)
    expect(locked.map((a) => [a.shiftId, a.soldierId])).toEqual([
      [shiftId(0, 0), 's00'],
      [shiftId(0, 1), 's00'],
    ])
    expect(locked[1].restDebtMinutes).toBe(240)
    expect(out.stats.find((s) => s.soldierId === 's00')!.totalRestDebtMinutes).toBeGreaterThanOrEqual(240)
    expect(codes(out)).toContain('REST_DEBT')
  })
})

describe('zero soldiers / zero shifts / requirement 0', () => {
  const empty = { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false }

  it('zero soldiers and zero shifts: empty output', () => {
    const out = runAndVerify(makeInput([], []))
    expect(out).toMatchObject({ assignments: [], shortages: [], stats: [], certificate: empty })
  })

  it('zero shifts: no assignments, zero stats for every soldier', () => {
    const out = runAndVerify(makeInput(soldiers(3), []))
    expect(out.assignments).toEqual([])
    expect(out.shortages).toEqual([])
    expect(out.stats).toHaveLength(3)
    expect(out.certificate).toEqual(empty)
  })

  it('zero soldiers: no assignments, every slot reported short, no error', () => {
    const out = runAndVerify(makeInput([], uniformShifts({ count: 3, lengthMinutes: 120, requirements: { soldier: 2 } })))
    expect(out.assignments).toEqual([])
    expect(out.stats).toEqual([])
    expect(out.shortages).toHaveLength(3)
    expect(out.certificate).toEqual(empty)
  })

  it('requirement 0: nothing to fill, nothing short', () => {
    const shifts = [
      ...uniformShifts({ count: 3, lengthMinutes: 120, requirements: {} }),
      ...uniformShifts({ count: 3, lengthMinutes: 120, postIndex: 1, requirements: { soldier: 0, commander: 0 } }),
    ]
    const out = runAndVerify(makeInput(soldiers(2), shifts))
    expect(out.assignments).toEqual([])
    expect(out.shortages).toEqual([])
    expect(out.certificate).toEqual(empty)
  })
})
