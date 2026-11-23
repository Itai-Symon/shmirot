/**
 * Claim 5ᴰᴺ — 'separate' balance (D8): with aligned shifts that are entirely day or entirely
 * night, every soldier qualified for everything, nobody absent and R = 0, night loads stay within
 * one night seat of each other and day loads within one day seat — independently.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Shift, SolverInput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'

const DAY = 1440
const arb = fc
  .record({
    len: fc.constantFrom(60, 120, 180, 360), // divides 6 h, so no shift is part day / part night
    days: fc.integer({ min: 1, max: 4 }),
    posts: fc.array(fc.record({ k: fc.integer({ min: 1, max: 2 }), factor: fc.constantFrom(0.8, 1, 1.3) }), { minLength: 1, maxLength: 3 }),
    extra: fc.integer({ min: 0, max: 6 }),
  })
  .map(({ len, days, posts, extra }): SolverInput => {
    const shifts: Shift[] = []
    posts.forEach((p, post) => {
      for (let start = 0; start < days * DAY; start += len) {
        const night = start % DAY < 360 ? len : 0 // minute 0 is 00:00, night is 00:00–06:00
        shifts.push({ id: `p${post}-${start}`, postIndex: post, start, end: start + len, nightMinutes: night, weightFactor: p.factor, requirements: { soldier: p.k } })
      }
    })
    const n = posts.reduce((a, p) => a + p.k, 0) * 2 + extra
    return {
      soldiers: Array.from({ length: n }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, roles: ['soldier'], absences: [] })),
      shifts,
      params: { minRestMinutes: 0, nightWeight: 1.5, balance: 'separate' },
      locked: [],
    }
  })

describe("'separate' balance", () => {
  it('night and day loads each stay within one seat, at all times', () => {
    fc.assert(
      fc.property(arb, (input) => {
        const out = runAndVerify(input)
        const byId = new Map(input.shifts.map((s) => [s.id, s]))
        const f = (s: Shift) => s.weightFactor ?? 1
        const maxNight = Math.max(0, ...input.shifts.map((s) => s.nightMinutes * f(s)))
        const maxDay = Math.max(0, ...input.shifts.map((s) => (s.end - s.start - s.nightMinutes) * f(s)))
        for (const t of [...new Set(input.shifts.map((s) => s.start))]) {
          const night = new Map(input.soldiers.map((s) => [s.id, 0]))
          const day = new Map(input.soldiers.map((s) => [s.id, 0]))
          for (const a of out.assignments) {
            const sh = byId.get(a.shiftId)!
            if (sh.start > t) continue
            night.set(a.soldierId, night.get(a.soldierId)! + sh.nightMinutes * f(sh))
            day.set(a.soldierId, day.get(a.soldierId)! + (sh.end - sh.start - sh.nightMinutes) * f(sh))
          }
          const spread = (m: Map<string, number>) => Math.max(...m.values()) - Math.min(...m.values())
          expect(spread(night), `night spread after ${t}`).toBeLessThanOrEqual(maxNight + 1e-9)
          expect(spread(day), `day spread after ${t}`).toBeLessThanOrEqual(maxDay + 1e-9)
        }
      }),
      { seed: 10001, numRuns: 150 },
    )
  })
})
