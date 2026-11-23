import { describe, expect, it } from 'vitest'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { solve as solveSync } from '../solver'
import { buildSolverInput, createPlan, isAbsentAt, markBack, markHome, minuteAt, toggleHome, whatsappText } from './planner'

// Invented names only.
const soldiers: SoldierRecord[] = [
  { id: 'a', name: 'אבי', roles: ['commander', 'soldier'], order: 0 },
  { id: 'b', name: 'בני', roles: ['soldier'], order: 1 },
  { id: 'c', name: 'גדי', roles: ['soldier', 'medic'], order: 2 },
  { id: 'd', name: 'דודי', roles: ['soldier'], order: 3 },
  { id: 'e', name: 'הדי', roles: ['soldier'], order: 4 },
]

const settings: ActivitySettings = {
  start: '2026-11-23T20:00',
  end: '2026-11-24T20:00',
  timeZone: 'Asia/Jerusalem',
  shiftMinutes: 120,
  split: null,
  restMinutes: 240,
  durationHours: 24,
  posts: [
    { requirements: { soldier: 1 }, activeWindow: null },
    { requirements: { commander: 1, soldier: 1 }, activeWindow: { fromHour: 22, toHour: 6 } },
  ],
}

const solve = async (input: Parameters<typeof solveSync>[0]) => solveSync(input)

async function plan(): Promise<Plan> {
  const p = await createPlan(settings, soldiers, solve)
  if (typeof p === 'string') throw new Error(p)
  return p
}

function expectPhysicallyValid(p: Plan) {
  const byId = new Map(p.generated.shifts.map((s) => [s.id, s]))
  const roster = new Map(soldiers.map((s) => [s.id, s]))
  const bySoldier = new Map<string, { start: number; end: number }[]>()
  for (const a of p.output.assignments) {
    const s = byId.get(a.shiftId)!
    expect(roster.get(a.soldierId)!.roles).toContain(a.role)
    if (!a.locked) for (const abs of p.absences[a.soldierId] ?? []) expect(abs.start < s.end && s.start < abs.end).toBe(false)
    const list = bySoldier.get(a.soldierId) ?? []
    for (const o of list) expect(o.start < s.end && s.start < o.end).toBe(false)
    list.push(s)
    bySoldier.set(a.soldierId, list)
  }
}

describe('planner', () => {
  it('rejects bad settings', async () => {
    expect(await createPlan(settings, [], solve)).toBe('errNoSoldiers')
    expect(await createPlan({ ...settings, end: settings.start }, soldiers, solve)).toBe('errEndBeforeStart')
    expect(await createPlan({ ...settings, posts: [{ requirements: {}, activeWindow: null }] }, soldiers, solve)).toBe('errNoNeeds')
  })

  it('creates a full, physically valid plan', async () => {
    const p = await plan()
    expect(p.output.shortages).toEqual([])
    expectPhysicallyValid(p)
    expect(p.output.assignments.every((a) => !a.locked)).toBe(true)
  })

  it('is deterministic', async () => {
    expect(JSON.stringify((await plan()).output)).toBe(JSON.stringify((await plan()).output))
  })

  it('re-plan input: started shifts require exactly their locks (ALGORITHM.md §3)', async () => {
    const p = await plan()
    const now = 5 * 60 + 30
    const started = p.generated.shifts.filter((s) => s.start < now)
    const locked = p.output.assignments
      .filter((a) => started.some((s) => s.id === a.shiftId))
      .map(({ shiftId, soldierId, role }) => ({ shiftId, soldierId, role }))
    const input = buildSolverInput(p, soldiers, locked.slice(1), now) // drop one lock: its seat must disappear
    for (const shift of input.shifts) {
      const original = p.generated.shifts.find((s) => s.id === shift.id)!
      if (shift.start >= now) {
        expect(shift.requirements).toEqual(original.requirements)
        continue
      }
      const seats = Object.values(shift.requirements).reduce((n, k) => n + (k ?? 0), 0)
      expect(seats).toBe(locked.slice(1).filter((l) => l.shiftId === shift.id).length)
    }
  })

  it('went home → re-plan from now: past locked, soldier not used later', async () => {
    const p0 = await plan()
    const now = 5 * 60 + 30 // 01:30, inside a running shift
    const p1 = await toggleHome(p0, soldiers, 'b', now, solve)
    expect(isAbsentAt(p1.absences.b, now)).toBe(true)
    const byId = new Map(p1.generated.shifts.map((s) => [s.id, s]))
    // Every assignment of a started shift is unchanged and locked
    const pastBefore = p0.output.assignments.filter((a) => byId.get(a.shiftId)!.start < now)
    const pastAfter = p1.output.assignments.filter((a) => byId.get(a.shiftId)!.start < now)
    expect(pastAfter.map((a) => [a.shiftId, a.soldierId, a.role])).toEqual(
      pastBefore.map((a) => [a.shiftId, a.soldierId, a.role]),
    )
    expect(pastAfter.every((a) => a.locked)).toBe(true)
    // b guards nothing that starts from now on
    expect(p1.output.assignments.some((a) => a.soldierId === 'b' && byId.get(a.shiftId)!.start >= now)).toBe(false)
    expectPhysicallyValid(p1)

    // Back two hours later
    const later = now + 120
    const p2 = await toggleHome(p1, soldiers, 'b', later, solve)
    expect(isAbsentAt(p2.absences.b, later)).toBe(false)
    expect(p2.absences.b).toEqual([{ start: now, end: later }])
    expect(p2.output.assignments.some((a) => a.soldierId === 'b' && byId.get(a.shiftId)!.start >= later)).toBe(true)
    expectPhysicallyValid(p2)
  })

  it('markHome / markBack edit absences', async () => {
    expect(markHome(undefined, 10, 100)).toEqual([{ start: 10, end: 100 }])
    expect(markHome([{ start: 10, end: 100 }], 20, 100)).toEqual([{ start: 10, end: 100 }])
    expect(markBack([{ start: 10, end: 100 }], 40)).toEqual([{ start: 10, end: 40 }])
    expect(markBack([{ start: 10, end: 100 }], 10)).toEqual([])
  })

  it('minuteAt converts real time', async () => {
    const p = await plan()
    expect(minuteAt(p, p.generated.startEpochMs + 90 * 60_000)).toBe(90)
  })

  it('formats WhatsApp text by post and time, upcoming shifts only', async () => {
    const p = await plan()
    const text = whatsappText(p, soldiers, 0)
    const lines = text.split('\n')
    expect(lines[0]).toBe('*שמירות* יום ב׳ 23/11')
    expect(lines).toContain('*עמדה 1*')
    expect(lines).toContain('*עמדה 2*')
    expect(lines).toContain('_יום ג׳ 24/11_')
    expect(lines.find((l) => l.startsWith('20:00–22:00'))).toMatch(/^20:00–22:00 \S+/)
    // Later: shifts that already ended are dropped
    const later = whatsappText(p, soldiers, 600)
    expect(later.split('\n').some((l) => l.startsWith('20:00–22:00'))).toBe(false)
  })
})
