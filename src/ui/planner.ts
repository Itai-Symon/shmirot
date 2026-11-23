/**
 * Glue between the screens, the shift generator and the solver.
 * Pure functions only (no React, no storage) so they are unit-testable.
 */
import type { Interval, LockedAssignment, Minutes, SoldierId, SolverInput, SolverOutput } from '../solver/types'
import { DEFAULT_PARAMS } from '../solver/types'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { generateShifts, wallAt } from '../storage/shiftGenerator'
import { t } from '../i18n'
// Session 2 swaps this for the real solver (in a Web Worker).
import { fakeSolve as solve } from './fakeSolve'

export type PlanError = 'errNoSoldiers' | 'errEndBeforeStart' | 'errNoNeeds' | 'errNoShifts'

export function validate(settings: ActivitySettings, soldiers: SoldierRecord[]): PlanError | null {
  if (soldiers.length === 0) return 'errNoSoldiers'
  if (settings.end <= settings.start) return 'errEndBeforeStart'
  const needsSomeone = settings.posts.every((p) => Object.values(p.requirements).some((n) => (n ?? 0) > 0))
  if (settings.posts.length === 0 || !needsSomeone) return 'errNoNeeds'
  return null
}

function runSolver(plan: Omit<Plan, 'output'>, soldiers: SoldierRecord[], locked: LockedAssignment[]): SolverOutput {
  const ids = new Set(plan.soldierIds)
  const input: SolverInput = {
    soldiers: soldiers
      .filter((s) => ids.has(s.id))
      .map((s) => ({ id: s.id, roles: [...s.roles], absences: plan.absences[s.id] ?? [] })),
    shifts: plan.generated.shifts,
    params: { ...DEFAULT_PARAMS, minRestMinutes: plan.settings.restMinutes },
    locked,
  }
  return solve(input)
}

export function createPlan(settings: ActivitySettings, soldiers: SoldierRecord[]): Plan | PlanError {
  const err = validate(settings, soldiers)
  if (err) return err
  const generated = generateShifts(settings)
  if (generated.shifts.length === 0) return 'errNoShifts'
  const base = { settings, generated, soldierIds: soldiers.map((s) => s.id), absences: {} }
  return { ...base, output: runSolver(base, soldiers, []) }
}

/** Minutes since activity start for a real instant (may be negative or past the end). */
export function minuteAt(plan: Plan, nowMs: number): Minutes {
  return Math.floor((nowMs - plan.generated.startEpochMs) / 60_000)
}

export function isAbsentAt(absences: Interval[] | undefined, m: Minutes): boolean {
  return (absences ?? []).some((a) => a.start <= m && m < a.end)
}

/** Soldier leaves now until further notice (end of activity). */
export function markHome(abs: Interval[] | undefined, now: Minutes, endMinute: Minutes): Interval[] {
  const list = [...(abs ?? [])]
  if (isAbsentAt(list, now)) return list
  list.push({ start: now, end: Math.max(now + 1, endMinute) })
  return list.sort((a, b) => a.start - b.start)
}

/** Soldier is back now: cut the current absence at `now`. */
export function markBack(abs: Interval[] | undefined, now: Minutes): Interval[] {
  return (abs ?? [])
    .map((a) => (a.start <= now && now < a.end ? { ...a, end: now } : a))
    .filter((a) => a.end > a.start)
}

/**
 * Re-plan from `now`: every assignment of a shift that already started is locked
 * (the past cannot change), everything later is solved again.
 */
export function replan(plan: Plan, soldiers: SoldierRecord[], absences: Plan['absences'], now: Minutes): Plan {
  const started = new Set(plan.generated.shifts.filter((s) => s.start < now).map((s) => s.id))
  const locked: LockedAssignment[] = plan.output.assignments
    .filter((a) => started.has(a.shiftId))
    .map(({ shiftId, soldierId, role }) => ({ shiftId, soldierId, role }))
  const next = { ...plan, absences }
  return { ...next, output: runSolver(next, soldiers, locked) }
}

export function toggleHome(plan: Plan, soldiers: SoldierRecord[], id: SoldierId, now: Minutes): Plan {
  const current = plan.absences[id]
  const updated = isAbsentAt(current, now) ? markBack(current, now) : markHome(current, now, plan.generated.endMinute)
  return replan(plan, soldiers, { ...plan.absences, [id]: updated }, now)
}

// ---------------------------------------------------------------------------
// Board rows and WhatsApp text
// ---------------------------------------------------------------------------

export interface BoardRow {
  shiftId: string
  postIndex: number
  start: Minutes
  end: Minutes
  startLabel: string
  endLabel: string
  dayKey: number
  dayLabel: string
  people: { soldierId: SoldierId; name: string; locked: boolean }[]
  missing: { role: string; n: number }[]
}

export function boardRows(plan: Plan, soldiers: SoldierRecord[]): BoardRow[] {
  const names = new Map(soldiers.map((s) => [s.id, s.name]))
  const { startEpochMs, shifts } = plan.generated
  const tz = plan.settings.timeZone
  return shifts.map((s) => {
    const a = wallAt(startEpochMs, s.start, tz)
    const b = wallAt(startEpochMs, s.end, tz)
    return {
      shiftId: s.id,
      postIndex: s.postIndex,
      start: s.start,
      end: s.end,
      startLabel: a.time,
      endLabel: b.time,
      dayKey: a.dayKey,
      dayLabel: t.dayLabel(t.days[a.weekday], a.date),
      people: plan.output.assignments
        .filter((x) => x.shiftId === s.id)
        .map((x) => ({ soldierId: x.soldierId, name: names.get(x.soldierId) ?? t.board.unknownSoldier, locked: x.locked })),
      missing: plan.output.shortages
        .filter((x) => x.shiftId === s.id)
        .map((x) => ({ role: t.roles[x.role], n: x.missing })),
    }
  })
}

/** Plain text for a WhatsApp group: upcoming shifts only, grouped by post then day. */
export function whatsappText(plan: Plan, soldiers: SoldierRecord[], now: Minutes): string {
  const rows = boardRows(plan, soldiers).filter((r) => r.end > now)
  const first = rows[0] ?? boardRows(plan, soldiers)[0]
  const out: string[] = [t.whatsapp.header(first ? first.dayLabel : '')]
  const posts = [...new Set(rows.map((r) => r.postIndex))].sort((a, b) => a - b)
  for (const p of posts) {
    out.push('', t.whatsapp.post(p))
    let day: number | null = null
    for (const r of rows.filter((x) => x.postIndex === p)) {
      if (r.dayKey !== day) {
        if (day !== null || r.dayKey !== first?.dayKey) out.push(`_${r.dayLabel}_`)
        day = r.dayKey
      }
      const who = [...r.people.map((x) => x.name), ...r.missing.map((m) => t.whatsapp.missing(m.role))]
      out.push(`${r.startLabel}–${r.endLabel} ${who.join(', ')}`)
    }
  }
  return out.join('\n')
}
