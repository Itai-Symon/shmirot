/**
 * Scale: a realistic month for a platoon of 30 soldiers and 5 posts.
 *
 * Too big for the brute-force oracle, so it checks what can be checked at this size:
 *  - the verifier passes (physically valid, no avoidable shortage, stats correct, determinism);
 *  - every seat is filled;
 *  - the certificate bound holds (achieved ≤ UB);
 *  - fairness: the gap between the most and least loaded soldier (weighted hours, relative to
 *    each soldier's field time) stays under a committed bound;
 *  - replacing the board mid-month with history carried over keeps the same guarantees;
 *  - it runs in seconds.
 * A summary is printed with `npm test -- tests/scale --silent=false`.
 */
import { describe, expect, it } from 'vitest'
import type { Soldier, SoldierHistory, SolverInput, SolverOutput } from '../../src/solver/types'
import { generateShifts, type PostConfig } from '../../src/storage/shiftGenerator'
import { weightOf } from '../helpers/shifts'
import { runAndVerify } from '../helpers/solve'

const DAY = 24 * 60
const DAYS = 30

// Invented ids only. 4 commanders, 3 medics, 23 soldiers.
function platoon(): Soldier[] {
  return Array.from({ length: 30 }, (_, i) => {
    const roles = i < 4 ? ['commander', 'soldier'] : i < 7 ? ['medic', 'soldier'] : ['soldier']
    // Home leave: three rotations, each soldier home 2 days out of every 10, staggered.
    const group = i % 3
    const absences = []
    for (let d = 2 + group * 3; d < DAYS; d += 10) absences.push({ start: d * DAY, end: (d + 2) * DAY })
    return { id: `s${String(i).padStart(2, '0')}`, roles, absences }
  })
}

const posts: PostConfig[] = [
  { requirements: { commander: 1, soldier: 1 }, activeWindow: null, weight: 1.3 }, // gate, hard
  { requirements: { soldier: 2 }, activeWindow: null }, // perimeter
  { requirements: { soldier: 1 }, activeWindow: { fromHour: 20, toHour: 6 } }, // night only
  { requirements: { soldier: 1 }, activeWindow: null, weight: 0.8 }, // company HQ, easy
  { requirements: { medic: 1 }, activeWindow: { fromHour: 6, toHour: 22 } }, // aid station, daytime
]

function month(): SolverInput {
  const g = generateShifts({
    start: '2026-12-01T20:00',
    end: '2026-12-31T20:00',
    timeZone: 'Asia/Jerusalem',
    shiftMinutes: 240,
    split: { fromHour: 22, toHour: 6, nightShiftMinutes: 120 },
    posts,
  })
  return { soldiers: platoon(), shifts: g.shifts, params: { minRestMinutes: 240, nightWeight: 1.5 }, locked: [] }
}

/** Weighted hours per soldier, minus his share in proportion to time in the field. */
function fairness(input: SolverInput, out: SolverOutput, hist: SoldierHistory[] = []) {
  const end = Math.max(...input.shifts.map((s) => s.end))
  const start = Math.min(...input.shifts.map((s) => s.start))
  const byId = new Map(input.shifts.map((s) => [s.id, s]))
  const load = new Map(input.soldiers.map((s) => [s.id, hist.find((h) => h.soldierId === s.id)?.load ?? 0]))
  for (const a of out.assignments) load.set(a.soldierId, load.get(a.soldierId)! + weightOf(byId.get(a.shiftId)!, input.params.nightWeight))
  const field = new Map(
    input.soldiers.map((s) => [s.id, end - start - s.absences.reduce((n, a) => n + Math.max(0, Math.min(a.end, end) - Math.max(a.start, start)), 0)]),
  )
  const totalLoad = [...load.values()].reduce((a, b) => a + b, 0)
  const totalField = [...field.values()].reduce((a, b) => a + b, 0)
  const dev = new Map(input.soldiers.map((s) => [s.id, (load.get(s.id)! - (totalLoad * field.get(s.id)!) / totalField) / 60]))
  const night = new Map(out.stats.map((s) => [s.soldierId, s.nightMinutes / 60]))
  // Soldiers with the same roles are interchangeable; scarce roles (commanders, medics) carry
  // extra load by necessity, so fairness is judged within each group of identical role sets.
  const groups = new Map<string, string[]>()
  for (const s of input.soldiers) {
    const k = [...s.roles].sort().join('+')
    groups.set(k, [...(groups.get(k) ?? []), s.id])
  }
  const gap = (ids: string[], m: Map<string, number>) => Math.max(...ids.map((i) => m.get(i)!)) - Math.min(...ids.map((i) => m.get(i)!))
  const byGroup = [...groups].map(([roles, ids]) => ({
    roles,
    size: ids.length,
    gapHours: gap(ids, dev),
    nightGapHours: gap(ids, night),
    avgAboveHours: ids.reduce((n, i) => n + dev.get(i)!, 0) / ids.length,
  }))
  return {
    byGroup,
    gapHours: Math.max(...byGroup.map((g) => g.gapHours)),
    nightGapHours: Math.max(...byGroup.map((g) => g.nightGapHours)),
    wMaxHours: Math.max(...input.shifts.map((s) => weightOf(s, input.params.nightWeight))) / 60,
  }
}

function summary(label: string, input: SolverInput, out: SolverOutput, ms: number, f: ReturnType<typeof fairness>) {
  const seats = input.shifts.reduce((n, s) => n + Object.values(s.requirements).reduce<number>((a, b) => a + (b ?? 0), 0), 0)
  const c = out.certificate
  process.stdout.write(
    `\n${label}\n` +
      `  shifts ${input.shifts.length}, seats ${seats}, filled ${out.assignments.length}, shortages ${out.shortages.length}\n` +
      `  solve ${ms.toFixed(0)} ms\n` +
      `  min rest ${(c.achievedMinRestMinutes ?? 0) / 60} h (upper bound ${c.upperBoundMinRestMinutes === null ? 'n/a' : c.upperBoundMinRestMinutes / 60} h, proven optimal: ${c.provenOptimal})\n` +
      `  largest single shift ${f.wMaxHours.toFixed(1)} weighted h\n` +
      f.byGroup
        .map((g) => `  ${g.roles.padEnd(17)} ×${String(g.size).padStart(2)}: gap ${g.gapHours.toFixed(1)} h, night gap ${g.nightGapHours.toFixed(1)} h, avg vs whole platoon ${g.avgAboveHours >= 0 ? '+' : ''}${g.avgAboveHours.toFixed(1)} h\n`)
        .join('') +
      `  warnings: ${out.warnings.map((w) => w.code + (w.role ? `(${w.role})` : '')).join(', ') || 'none'}\n`,
  )
}

/**
 * Committed bounds — tighten when the algorithm improves, never loosen silently.
 * Within a group of interchangeable soldiers the weighted gap must stay within one shift
 * (like Claim 5, though this month has absences and rest pressure). The night-hours gap is a
 * known weakness: weighted load is balanced, nights only through the weight; 18 h is the
 * measured value at the time of writing (ALGORITHM.md §9).
 */
const BOUNDS = { solveMs: 15_000, nightGapHours: 18 }

describe('scale: 30 soldiers · 5 posts · 30 days', () => {
  it('one board for the whole month', () => {
    const input = month()
    const t0 = performance.now()
    const out = runAndVerify(input)
    const ms = (performance.now() - t0) / 3 // runAndVerify solves twice (determinism) and verifies
    const f = fairness(input, out)
    summary('one board, whole month', input, out, ms, f)
    expect(out.shortages).toEqual([])
    const c = out.certificate
    if (c.upperBoundMinRestMinutes !== null && c.achievedMinRestMinutes !== null) {
      expect(c.achievedMinRestMinutes).toBeLessThanOrEqual(c.upperBoundMinRestMinutes)
    }
    expect(ms).toBeLessThan(BOUNDS.solveMs)
    expect(f.gapHours).toBeLessThanOrEqual(f.wMaxHours + 1e-9)
    expect(f.nightGapHours).toBeLessThanOrEqual(BOUNDS.nightGapHours)
  }, 120_000)

  it('board replaced mid-month, history carried over', () => {
    const input = month()
    const split = 15 * DAY
    const first: SolverInput = { ...input, shifts: input.shifts.filter((s) => s.start < split) }
    const a = runAndVerify(first)
    const byId = new Map(first.shifts.map((s) => [s.id, s]))
    const history: SoldierHistory[] = input.soldiers.map((s) => {
      const st = a.stats.find((x) => x.soldierId === s.id)!
      const mine = a.assignments.filter((x) => x.soldierId === s.id).map((x) => byId.get(x.shiftId)!)
      const running = mine.filter((x) => x.end > split)
      return {
        soldierId: s.id,
        load: st.load,
        fairShare: st.fairShare,
        lastEnd: mine.length ? Math.max(...mine.map((x) => x.end)) : null,
        busyUntil: running.length ? Math.max(...running.map((x) => x.end)) : null,
      }
    })
    const second: SolverInput = { ...input, shifts: input.shifts.filter((s) => s.start >= split), history }
    const b = runAndVerify(second)
    const all: SolverOutput = { ...b, assignments: [...a.assignments, ...b.assignments], stats: a.stats.map((x) => {
      const y = b.stats.find((z) => z.soldierId === x.soldierId)!
      return { ...x, nightMinutes: x.nightMinutes + y.nightMinutes }
    }) }
    const f = fairness(input, all)
    summary('two boards (replaced on day 15)', input, all, 0, f)
    expect(a.shortages).toEqual([])
    expect(b.shortages).toEqual([])
    expect(f.gapHours).toBeLessThanOrEqual(f.wMaxHours + 1e-9)
    expect(f.nightGapHours).toBeLessThanOrEqual(BOUNDS.nightGapHours)
  }, 120_000)
})
