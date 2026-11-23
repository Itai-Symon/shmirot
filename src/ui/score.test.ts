import { describe, expect, it } from 'vitest'
import type { SolverOutput } from '../solver/types'
import { boardScore } from './fairness'

const stat = (soldierId: string, load: number, deviation: number) => ({
  soldierId, load, fairShare: load - deviation, deviation, shiftCount: 1, nightMinutes: 0, minRestMinutes: null, totalRestDebtMinutes: 0,
})

describe('board score', () => {
  it('before = history deviation, after = before + this board', () => {
    const output: SolverOutput = {
      assignments: [], shortages: [], warnings: [],
      certificate: { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false },
      stats: [stat('a', 120, -60), stat('b', 360, 60)],
    }
    const s = boardScore({
      soldierIds: ['a', 'b'],
      output,
      history: [
        { soldierId: 'a', load: 600, fairShare: 400, lastEnd: null, busyUntil: null },
        { soldierId: 'b', load: 300, fairShare: 400, lastEnd: null, busyUntil: null },
      ],
    })
    expect(s.rows.find((r) => r.soldierId === 'a')).toMatchObject({ before: 200, onBoard: 120, after: 140 })
    expect(s.rows.find((r) => r.soldierId === 'b')).toMatchObject({ before: -100, onBoard: 360, after: -40 })
    expect(s.spreadBefore).toBe(300)
    expect(s.spreadAfter).toBe(180)
  })
})
