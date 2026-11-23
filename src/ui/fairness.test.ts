import { describe, expect, it } from 'vitest'
import { solve as solveSync } from '../solver'
import type { SolverOutput } from '../solver/types'
import type { ActivitySettings, SoldierRecord } from '../storage/db'
import { certificateNotice, loadSpreadHours, presetOf, warningNotices } from './fairness'
import { buildSolverInput, createPlan } from './planner'

const empty: SolverOutput = {
  assignments: [],
  shortages: [],
  stats: [],
  certificate: { achievedMinRestMinutes: null, upperBoundMinRestMinutes: null, provenOptimal: false },
  warnings: [],
}

describe('fairness texts', () => {
  it('certificate: proven optimal, below bound, none', () => {
    expect(certificateNotice({ achievedMinRestMinutes: 240, upperBoundMinRestMinutes: 240, provenOptimal: true }, 240)).toMatchObject({ level: 'ok' })
    expect(certificateNotice({ achievedMinRestMinutes: 240, upperBoundMinRestMinutes: 240, provenOptimal: true }, 240)!.text).toContain('4')
    const below = certificateNotice({ achievedMinRestMinutes: 120, upperBoundMinRestMinutes: 210, provenOptimal: false }, 240)!
    expect(below.level).toBe('info')
    expect(below.text).toContain('3.5')
    expect(certificateNotice(empty.certificate, 240)).toBeNull()
    const short = certificateNotice({ achievedMinRestMinutes: 0, upperBoundMinRestMinutes: 0, provenOptimal: true }, 240)!
    expect(short.level).toBe('info')
    expect(short.text).toContain('פחות מהיעד')
  })

  it('warnings use role names, not ids, and shortages come first', () => {
    const out: SolverOutput = {
      ...empty,
      shortages: [{ shiftId: 'x', role: 'r1', missing: 2 }],
      warnings: [
        { code: 'ROLE_BOTTLENECK', role: 'r1', details: { qualified: 1, needed: 3, at: 0 } },
        { code: 'NIGHT_TRAP', details: { periodMinutes: 1440, nightSpreadMinutes: 0 } },
        { code: 'REST_DEBT', details: { assignments: 2, totalMinutes: 240, maxMinutes: 120 } },
      ],
    }
    const n = warningNotices(out, [{ id: 'r1', name: 'קצין תורן' }], 240)
    expect(n).toHaveLength(4)
    expect(n[0].level).toBe('warn') // shortages first
    expect(n[1].text).toContain('קצין תורן') // then the root cause
    expect(n[3].text).toBe(warningNotices({ ...empty, warnings: [out.warnings[1]] }, [], 240)[0].text) // night trap last
    expect(n.map((x) => x.text).join(' ')).not.toContain('r1')
  })

  it('presets map to night weights', () => {
    expect(presetOf(1.5)).toBe('balanced')
    expect(presetOf(2)).toBe('sleep')
    expect(presetOf(1)).toBe('equal')
    expect(presetOf(2.25)).toBeNull()
  })

  it('spread ignores soldiers with no share at all', () => {
    expect(loadSpreadHours(empty)).toBe(0)
  })
})

describe('night weight reaches the solver', () => {
  const soldiers: SoldierRecord[] = ['א', 'ב', 'ג', 'ד', 'ה'].map((name, i) => ({ id: `s${i}`, name, roles: ['soldier'], order: i }))
  const settings: ActivitySettings = {
    start: '2026-11-23T20:00',
    end: '2026-11-25T20:00',
    timeZone: 'Asia/Jerusalem',
    shiftMinutes: 120,
    split: null,
    restMinutes: 240,
    durationHours: 48,
    posts: [{ requirements: { soldier: 1 }, activeWindow: null }],
  }
  it('default 1.5, custom value passed through', async () => {
    const solve = async (i: Parameters<typeof solveSync>[0]) => solveSync(i)
    const p = await createPlan(settings, soldiers, solve)
    if (typeof p === 'string') throw new Error(p)
    expect(buildSolverInput(p, soldiers, [], null).params.nightWeight).toBe(1.5)
    const q = await createPlan({ ...settings, nightWeight: 2.5 }, soldiers, solve)
    if (typeof q === 'string') throw new Error(q)
    expect(buildSolverInput(q, soldiers, [], null).params.nightWeight).toBe(2.5)
    expect(buildSolverInput(q, soldiers, [], null).params.balance).toBeUndefined()
    const r = await createPlan({ ...settings, balance: 'separate' }, soldiers, solve)
    if (typeof r === 'string') throw new Error(r)
    expect(buildSolverInput(r, soldiers, [], null).params.balance).toBe('separate')
  })
})
