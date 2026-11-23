/**
 * Tests of the brute-force oracle itself (no solver): known answers, the symmetry
 * reduction against plain enumeration, and agreement with the independent §6 upper bound.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Shift } from '../../src/solver/types'
import { upperBoundMinRest } from '../../src/verifier/index'
import { makeInput, soldier, soldiers, uniformShifts } from '../helpers/shifts'
import { smallInstanceArb } from './instances'
import { bruteForce, measure } from './oracle'

describe('oracle — known answers', () => {
  it('uniform N=4, K=1, L=2h, 6 shifts: full coverage, rest 6 h, spread one shift', () => {
    const input = makeInput(soldiers(4), uniformShifts({ count: 6, lengthMinutes: 120, requirements: { soldier: 1 }, noNight: true }))
    expect(bruteForce(input)).toMatchObject({ maxCoverage: 6, bestMinRest: 360, bestLoadSpread: 120 })
  })

  it('uniform N=5, K=2: best rest (⌊5/2⌋ − 1)·L', () => {
    const input = makeInput(soldiers(5), uniformShifts({ count: 5, lengthMinutes: 120, requirements: { soldier: 2 }, noNight: true }))
    expect(bruteForce(input)).toMatchObject({ maxCoverage: 10, bestMinRest: 120, bestLoadSpread: 0 })
  })

  it('§4.5: commander + soldier both filled', () => {
    const input = makeInput(
      [soldier('dani', ['commander', 'soldier']), soldier('yossi', ['soldier'])],
      uniformShifts({ count: 1, lengthMinutes: 120, requirements: { commander: 1, soldier: 1 } }),
    )
    expect(bruteForce(input).maxCoverage).toBe(2)
  })

  it('entire platoon absent: nothing can be filled', () => {
    const input = makeInput(
      [soldier('a', ['soldier'], [{ start: 0, end: 10_000 }]), soldier('b', ['soldier'], [{ start: 0, end: 10_000 }])],
      uniformShifts({ count: 3, lengthMinutes: 120, requirements: { soldier: 1 } }),
    )
    expect(bruteForce(input)).toMatchObject({ maxCoverage: 0, bestMinRest: Infinity, bestLoadSpread: 0 })
  })

  it('looks globally: a chain of overlapping shifts is fully staffed', () => {
    // g needs a|b, h needs b|c, k needs c; g–h and h–k overlap. Only a→g, b→h, c→k fills all three.
    const shifts: Shift[] = [
      { id: 'g', postIndex: 0, start: 0, end: 240, nightMinutes: 0, requirements: { soldier: 1 } },
      { id: 'h', postIndex: 1, start: 120, end: 360, nightMinutes: 0, requirements: { commander: 1 } },
      { id: 'k', postIndex: 2, start: 300, end: 540, nightMinutes: 0, requirements: { medic: 1 } },
    ]
    const input = makeInput([soldier('a', ['soldier']), soldier('b', ['soldier', 'commander']), soldier('c', ['commander', 'medic'])], shifts)
    expect(bruteForce(input).maxCoverage).toBe(3)
  })

  it('locked assignments are always part of the schedule', () => {
    const input = makeInput(soldiers(2), uniformShifts({ count: 2, lengthMinutes: 120, requirements: { soldier: 1 }, noNight: true }), {}, [
      { shiftId: 'p0-000', soldierId: 's00', role: 'soldier' },
      { shiftId: 'p0-001', soldierId: 's00', role: 'soldier' },
    ])
    expect(bruteForce(input)).toMatchObject({ maxCoverage: 2, bestMinRest: 0, bestLoadSpread: 240 })
  })

  it('refuses instances above its limits', () => {
    expect(() => bruteForce(makeInput(soldiers(7), []))).toThrow(/limited/)
    expect(() => bruteForce(makeInput(soldiers(1), uniformShifts({ count: 11, lengthMinutes: 60, requirements: { soldier: 1 } })))).toThrow(/limited/)
  })

  it('handles the full size limit (6 soldiers, 10 shifts) in reasonable time', () => {
    const input = makeInput(soldiers(6), uniformShifts({ count: 10, lengthMinutes: 120, requirements: { soldier: 1 }, clockOffset: 1200 }))
    const r = bruteForce(input)
    expect(r.maxCoverage).toBe(10)
    expect(r.bestMinRest).toBe(600)
  })

  it('measure() reads coverage, min rest and load spread off a schedule', () => {
    const input = makeInput(soldiers(2), uniformShifts({ count: 3, lengthMinutes: 60, requirements: { soldier: 1 }, noNight: true }))
    const a = (shiftId: string, soldierId: string) => ({ shiftId, soldierId, role: 'soldier' as const, restDebtMinutes: 0, locked: false })
    expect(measure(input, [a('p0-000', 's00'), a('p0-001', 's01'), a('p0-002', 's00')])).toEqual({ coverage: 3, minRest: 60, loadSpread: 60 })
  })
})

describe('oracle — consistency', () => {
  it('symmetry reduction gives the same answers as plain enumeration', () => {
    fc.assert(
      fc.property(smallInstanceArb({ maxSoldiers: 4, maxShifts: 5, maxSeats: 6 }), (input) => {
        const fast = bruteForce(input)
        const plain = bruteForce(input, { symmetry: false })
        expect({ ...fast, nodes: 0 }).toEqual({ ...plain, nodes: 0 })
      }),
      { seed: 2001, numRuns: 80 },
    )
  })

  it('best min rest never exceeds the §6 upper bound when everything can be staffed', () => {
    fc.assert(
      fc.property(smallInstanceArb({ maxShifts: 7, maxSeats: 8 }), (input) => {
        const seats = input.shifts.reduce((n, s) => n + Object.values(s.requirements).reduce<number>((a, b) => a + (b ?? 0), 0), 0)
        const r = bruteForce(input)
        if (r.maxCoverage !== seats || r.bestMinRest === Infinity) return
        const ub = upperBoundMinRest(input)
        expect(ub.kind).toBe('bounded')
        if (ub.kind === 'bounded') expect(r.bestMinRest).toBeLessThanOrEqual(ub.value)
      }),
      { seed: 2002, numRuns: 80 },
    )
  })

  it('uniform setting: oracle best rest equals (⌊N/K⌋ − 1)·L and the §6 bound', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 2 }), fc.constantFrom(60, 120), (n, k, len) => {
        fc.pre(k <= n)
        const count = Math.min(10, Math.floor(10 / k))
        fc.pre(count >= Math.floor(n / k) + 1)
        const input = makeInput(soldiers(n), uniformShifts({ count, lengthMinutes: len, requirements: { soldier: k }, noNight: true }))
        const expected = (Math.floor(n / k) - 1) * len
        expect(bruteForce(input).bestMinRest).toBe(expected)
        expect(upperBoundMinRest(input)).toEqual({ kind: 'bounded', value: expected })
      }),
      { seed: 2003, numRuns: 40 },
    )
  })
})
