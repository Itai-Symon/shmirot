/**
 * Layer D — per-task shift length and rest (D9) through the real shift generator and the solver.
 */
import { describe, expect, it } from 'vitest'
import { generateShifts } from '../../src/storage/shiftGenerator'
import { runAndVerify } from '../helpers/solve'
import { makeInput, soldiers } from '../helpers/shifts'

describe('per-task length and rest (D9)', () => {
  const g = generateShifts({
    start: '2026-11-24T08:00',
    end: '2026-11-26T08:00',
    timeZone: 'Asia/Jerusalem',
    shiftMinutes: 120,
    split: null,
    posts: [
      { requirements: { soldier: 1 }, activeWindow: null },
      { requirements: { soldier: 2 }, activeWindow: null, shiftMinutes: 240, restMinutes: 480 },
    ],
  })

  it('each task keeps its own length, contiguous, and carries its rest', () => {
    for (const [post, len] of [[0, 120], [1, 240]] as const) {
      const mine = g.shifts.filter((s) => s.postIndex === post).sort((a, b) => a.start - b.start)
      expect(mine[0].start).toBe(0)
      for (let k = 1; k < mine.length; k++) expect(mine[k].start).toBe(mine[k - 1].end)
      expect(mine[mine.length - 1].end).toBe(g.endMinute)
      for (const s of mine) expect(s.end - s.start).toBe(len)
      for (const s of mine) expect(s.restAfterMinutes).toBe(post === 1 ? 480 : undefined)
    }
  })

  it('solver gives 8h after the long task when there are enough people', () => {
    const input = makeInput(soldiers(12), g.shifts, { minRestMinutes: 120 })
    const out = runAndVerify(input)
    const bySoldier = new Map<string, { start: number; end: number; post: number }[]>()
    const byId = new Map(g.shifts.map((s) => [s.id, s]))
    for (const a of out.assignments) {
      const s = byId.get(a.shiftId)!
      const l = bySoldier.get(a.soldierId) ?? []
      l.push({ start: s.start, end: s.end, post: s.postIndex })
      bySoldier.set(a.soldierId, l)
    }
    for (const l of bySoldier.values()) {
      l.sort((a, b) => a.start - b.start)
      for (let k = 1; k < l.length; k++) {
        const need = l[k - 1].post === 1 ? 480 : 120
        expect(l[k].start - l[k - 1].end).toBeGreaterThanOrEqual(need)
      }
    }
  })
})
