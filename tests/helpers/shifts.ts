/**
 * Tiny test-only shift generator (SESSIONS.md 1B). Works purely in minutes since activity
 * start; `clockOffset` is the wall-clock minute-of-day at activity start (e.g. 20:00 → 1200),
 * used only to precompute nightMinutes (00:00–06:00, ALGORITHM.md D2). No DST handling —
 * that is the real shift generator's job (src/storage/shiftGenerator.ts, session 1C).
 */
import type { Interval, LockedAssignment, Role, Shift, Soldier, SolverInput, SolverParams } from '../../src/solver/types'

export const DAY = 24 * 60
export const NIGHT_END = 6 * 60
export const hours = (h: number): number => h * 60

/** Minutes of [start, end) that fall inside 00:00–06:00 wall clock. */
export function nightMinutes(start: number, end: number, clockOffset = 0): number {
  const a = start + clockOffset
  const b = end + clockOffset
  let total = 0
  for (let d = Math.floor(a / DAY); d * DAY < b; d++) {
    const ns = d * DAY
    total += Math.max(0, Math.min(b, ns + NIGHT_END) - Math.max(a, ns))
  }
  return total
}

export interface UniformShiftOptions {
  /** Number of back-to-back shifts. */
  count: number
  lengthMinutes: number
  requirements: Partial<Record<Role, number>>
  postIndex?: number
  /** Start of the first shift, minutes since activity start. Default 0. */
  firstStart?: number
  /** Wall-clock minute-of-day at activity start (minute 0). Default 0 (midnight). */
  clockOffset?: number
  /** Set nightMinutes to 0 regardless of the clock (pure "uniform setting"). */
  noNight?: boolean
}

export function shiftId(postIndex: number, i: number): string {
  return `p${postIndex}-${String(i).padStart(3, '0')}`
}

/** Back-to-back shifts of equal length at one post. */
export function uniformShifts(o: UniformShiftOptions): Shift[] {
  const post = o.postIndex ?? 0
  const first = o.firstStart ?? 0
  const shifts: Shift[] = []
  for (let i = 0; i < o.count; i++) {
    const start = first + i * o.lengthMinutes
    const end = start + o.lengthMinutes
    shifts.push({
      id: shiftId(post, i),
      postIndex: post,
      start,
      end,
      nightMinutes: o.noNight ? 0 : nightMinutes(start, end, o.clockOffset ?? 0),
      requirements: { ...o.requirements },
    })
  }
  return shifts
}

export function soldierId(i: number): string {
  return `s${String(i).padStart(2, '0')}`
}

/** `count` soldiers with the same roles and no absences, ids s00, s01, … */
export function soldiers(count: number, roles: Role[] = ['soldier']): Soldier[] {
  return Array.from({ length: count }, (_, i) => ({ id: soldierId(i), roles: [...roles], absences: [] }))
}

export function soldier(id: string, roles: Role[], absences: Interval[] = []): Soldier {
  return { id, roles, absences }
}

export function makeInput(
  soldierList: Soldier[],
  shiftList: Shift[],
  params: Partial<SolverParams> = {},
  locked: LockedAssignment[] = [],
): SolverInput {
  return {
    soldiers: soldierList,
    shifts: shiftList,
    params: { minRestMinutes: hours(4), nightWeight: 1.5, ...params },
    locked,
  }
}

/** weight(j) = dayMinutes + α × nightMinutes (ALGORITHM.md §4.4). */
export function weightOf(shift: Shift, nightWeight: number): number {
  return (shift.end - shift.start - shift.nightMinutes + nightWeight * shift.nightMinutes) * (shift.weightFactor ?? 1)
}
