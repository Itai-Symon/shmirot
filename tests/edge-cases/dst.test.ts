/**
 * Layer D — "DST transition day: shift generator yields no missing / duplicate hour".
 *
 * The generator side tests the real shift generator (src/storage/shiftGenerator.ts) on the
 * Asia/Jerusalem transition days. The solver side of DST is covered by the contract itself: solver
 * times are real elapsed minutes, so a 23 h or 25 h day is just 1380 or 1500 minutes.
 */
import { describe, expect, it } from 'vitest'
import { runAndVerify } from '../helpers/solve'
import { makeInput, soldiers } from '../helpers/shifts'
import type { Shift } from '../../src/solver/types'

import { generateShifts, type ActivityConfig } from '../../src/storage/shiftGenerator'

// Asia/Jerusalem 2026: spring forward Fri 27 Mar 02:00 → 03:00; fall back Sun 25 Oct 02:00 → 01:00.
const day = (start: string, end: string, split: ActivityConfig['split'] = null): ActivityConfig => ({
  start,
  end,
  timeZone: 'Asia/Jerusalem',
  shiftMinutes: 120,
  split,
  posts: [{ requirements: { soldier: 1 }, activeWindow: null }, { requirements: { soldier: 1 }, activeWindow: null }],
})

function assertContiguous(shifts: Shift[], endMinute: number): void {
  for (const post of [0, 1]) {
    const mine = shifts.filter((s) => s.postIndex === post).sort((a, b) => a.start - b.start)
    expect(mine[0].start).toBe(0)
    for (let k = 1; k < mine.length; k++) expect(mine[k].start, `post ${post} gap/overlap at shift ${k}`).toBe(mine[k - 1].end)
    expect(mine[mine.length - 1].end).toBe(endMinute)
    for (const s of mine) expect(s.end).toBeGreaterThan(s.start)
  }
}

describe('DST transition day — real shift generator', () => {
  it('spring forward: 23 real hours, contiguous shifts, 5 real night hours', () => {
    const g = generateShifts(day('2026-03-26T20:00', '2026-03-27T20:00'))
    expect(g.endMinute).toBe(1380)
    assertContiguous(g.shifts, 1380)
    const night = g.shifts.filter((s) => s.postIndex === 0).reduce((n, s) => n + s.nightMinutes, 0)
    expect(night).toBe(5 * 60)
  })

  it('fall back: 25 real hours, contiguous shifts, 7 real night hours', () => {
    const g = generateShifts(day('2026-10-24T20:00', '2026-10-25T20:00'))
    expect(g.endMinute).toBe(1500)
    assertContiguous(g.shifts, 1500)
    const night = g.shifts.filter((s) => s.postIndex === 0).reduce((n, s) => n + s.nightMinutes, 0)
    expect(night).toBe(7 * 60)
  })

  it('both DST days with a day/night split stay contiguous', () => {
    for (const [a, b, len] of [['2026-03-26T20:00', '2026-03-27T20:00', 1380], ['2026-10-24T20:00', '2026-10-25T20:00', 1500]] as const) {
      const g = generateShifts(day(a, b, { fromHour: 22, toHour: 6, nightShiftMinutes: 60 }))
      assertContiguous(g.shifts, len)
    }
  })

  it('the solver schedules a generated DST day and the verifier accepts it', () => {
    const g = generateShifts(day('2026-03-26T20:00', '2026-03-27T20:00'))
    const out = runAndVerify(makeInput(soldiers(6), g.shifts, { minRestMinutes: 240 }))
    expect(out.shortages).toEqual([])
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
