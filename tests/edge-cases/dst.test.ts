/**
 * Layer D — "DST transition day: shift generator yields no missing / duplicate hour".
 *
 * This row is about the real shift generator (wall clock → minutes), which belongs to
 * session 1C (src/storage/shiftGenerator.ts). It did not exist when 1B was written, so the
 * test is skipped until the file appears, and then fails loudly until session 2 wires it to
 * the generator's API. The solver side of DST is covered by the contract itself: solver
 * times are real elapsed minutes, so a 23 h or 25 h day is just 1380 or 1500 minutes.
 */
import { describe, expect, it } from 'vitest'
import { runAndVerify } from '../helpers/solve'
import { makeInput, soldiers } from '../helpers/shifts'
import type { Shift } from '../../src/solver/types'

const generator = import.meta.glob('../../src/storage/shiftGenerator.ts')
const hasGenerator = Object.keys(generator).length > 0

describe.skipIf(!hasGenerator)('DST transition day — real shift generator', () => {
  it('wire this test to src/storage/shiftGenerator.ts (session 2)', () => {
    // Expected once wired, for Asia/Jerusalem spring-forward and fall-back days:
    //  - consecutive shifts are contiguous in minutes (no gap, no overlap);
    //  - the day sums to 1380 / 1500 real minutes;
    //  - nightMinutes counts real minutes inside 00:00–06:00 wall clock.
    throw new Error('shiftGenerator exists: implement the DST assertions against its API')
  })
})

describe('DST transition day — solver side', () => {
  it('a 23-hour day (spring forward) in real minutes: 2 h shifts stay contiguous, rest counted in real time', () => {
    // 20:00 → 20:00 next day across a spring-forward night is 23 h = 1380 real minutes.
    // A generator emits 2 h shifts in real time; the last one is cut to 1 h at 19:00–20:00.
    const shifts: Shift[] = []
    for (let start = 0, i = 0; start < 1380; start += 120, i++) {
      shifts.push({ id: `p0-${String(i).padStart(3, '0')}`, postIndex: 0, start, end: Math.min(start + 120, 1380), nightMinutes: 0, requirements: { soldier: 1 } })
    }
    const out = runAndVerify(makeInput(soldiers(4), shifts, { minRestMinutes: 240 }))
    expect(out.shortages).toEqual([])
    const total = out.stats.reduce((sum, s) => sum + s.load, 0)
    expect(total).toBe(1380)
  })
})
