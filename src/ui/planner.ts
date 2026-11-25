/**
 * Glue between the screens, the shift generator and the solver.
 * Pure functions only (no React, no storage) so they are unit-testable.
 */
import type { Interval, LockedAssignment, Minutes, Role, SoldierHistory, SoldierId, SolverInput, SolverOutput } from '../solver/types'
import { DEFAULT_PARAMS } from '../solver/types'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { generateShifts, wallAt } from '../storage/shiftGenerator'
import { defaultRoles, postName, roleName, type RoleRecord } from './labels'
import { t } from '../i18n'

/** The solver as the planner sees it: the app passes a Web Worker client, tests pass solve(). */
export type SolveAsync = (input: SolverInput) => Promise<SolverOutput>

let activityCounter = 0
function newActivityId(startEpochMs: number): string {
  activityCounter += 1
  return `a${startEpochMs.toString(36)}${Date.now().toString(36)}${activityCounter.toString(36)}`
}

export type PlanError = 'errNoSoldiers' | 'errEndBeforeStart' | 'errNoNeeds' | 'errNoShifts'

export function validate(settings: ActivitySettings, soldiers: SoldierRecord[]): PlanError | null {
  if (soldiers.length === 0) return 'errNoSoldiers'
  if (settings.end <= settings.start) return 'errEndBeforeStart'
  const needsSomeone = settings.posts.every((p) => Object.values(p.requirements).some((n) => (n ?? 0) > 0))
  if (settings.posts.length === 0 || !needsSomeone) return 'errNoNeeds'
  return null
}

/**
 * Builds the solver input. Shifts that started before `now` are history (ALGORITHM.md §3):
 * their requirements are set to exactly what was filled (their locks), so the solver never
 * fills seats in the past and does not re-report old shortages.
 */
export function buildSolverInput(
  plan: Omit<Plan, 'output'>,
  soldiers: SoldierRecord[],
  locked: LockedAssignment[],
  now: Minutes | null,
): SolverInput {
  const ids = new Set(plan.soldierIds)
  const shifts = plan.generated.shifts.map((shift) => {
    if (now === null || shift.start >= now) return shift
    const requirements: Partial<Record<Role, number>> = {}
    for (const l of locked) if (l.shiftId === shift.id) requirements[l.role] = (requirements[l.role] ?? 0) + 1
    return { ...shift, requirements }
  })
  return {
    soldiers: soldiers
      .filter((s) => ids.has(s.id))
      .map((s) => ({ id: s.id, roles: [...s.roles], absences: plan.absences[s.id] ?? [] })),
    shifts,
    ...(plan.roles && { roles: plan.roles.map((r) => r.id) }),
    ...(plan.history && { history: plan.history.filter((h) => ids.has(h.soldierId)) }),
    params: {
      ...DEFAULT_PARAMS,
      minRestMinutes: plan.settings.restMinutes,
      nightWeight: plan.settings.nightWeight ?? DEFAULT_PARAMS.nightWeight,
      ...(plan.settings.balance === 'separate' && { balance: 'separate' as const }),
      ...(plan.settings.brotherhoodFactor !== undefined && { brotherhoodFactor: plan.settings.brotherhoodFactor }),
    },
    locked,
  }
}

function runSolver(
  solve: SolveAsync,
  plan: Omit<Plan, 'output'>,
  soldiers: SoldierRecord[],
  locked: LockedAssignment[],
  now: Minutes | null,
): Promise<{ output: SolverOutput; input: SolverInput }> {
  const input = buildSolverInput(plan, soldiers, locked, now)
  return solve(input).then((output) => ({ output, input }))
}

export async function createPlan(
  settings: ActivitySettings,
  soldiers: SoldierRecord[],
  solve: SolveAsync,
  roles: RoleRecord[] = defaultRoles(),
  history?: (startEpochMs: number) => SoldierHistory[],
): Promise<Plan | PlanError> {
  const err = validate(settings, soldiers)
  if (err) return err
  const generated = generateShifts(settings)
  if (generated.shifts.length === 0) return 'errNoShifts'
  const base = {
    id: newActivityId(generated.startEpochMs),
    settings,
    generated,
    soldierIds: soldiers.map((s) => s.id),
    absences: {},
    roles,
    ...(history && { history: history(generated.startEpochMs) }),
  }
  return { ...base, ...(await runSolver(solve, base, soldiers, [], null)) }
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
export async function replan(plan: Plan, soldiers: SoldierRecord[], absences: Plan['absences'], now: Minutes, solve: SolveAsync): Promise<Plan> {
  const started = new Set(plan.generated.shifts.filter((s) => s.start < now).map((s) => s.id))
  const locked: LockedAssignment[] = plan.output.assignments
    .filter((a) => started.has(a.shiftId))
    .map(({ shiftId, soldierId, role }) => ({ shiftId, soldierId, role }))
  const next = { ...plan, absences }
  return { ...next, ...(await runSolver(solve, next, soldiers, locked, now)) }
}

export function toggleHome(plan: Plan, soldiers: SoldierRecord[], id: SoldierId, now: Minutes, solve: SolveAsync): Promise<Plan> {
  const current = plan.absences[id]
  // Home time is recorded on the 15-minute grid; the past is still locked at the real "now".
  const at = Math.round(now / 15) * 15
  const updated = isAbsentAt(current, now) ? markBack(current, at) : markHome(current, at, plan.generated.endMinute)
  return replan(plan, soldiers, { ...plan.absences, [id]: updated }, now, solve)
}

// ---------------------------------------------------------------------------
// Board rows and WhatsApp text
// ---------------------------------------------------------------------------

export interface BoardRow {
  shiftId: string
  postIndex: number
  postLabel: string
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
      postLabel: postName(plan.settings.posts, s.postIndex),
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
        .map((x) => ({ role: roleName(plan.roles, x.role), n: x.missing })),
    }
  })
}

/** Plain text for a WhatsApp group: upcoming shifts only, grouped by post then day. */
export function whatsappText(plan: Plan, soldiers: SoldierRecord[], now: Minutes): string {
  // Always grouped by day (whatever the board view), in time order; the task name is shown
  // only when there is more than one task.
  const rows = boardRows(plan, soldiers)
    .filter((r) => r.end > now)
    .sort((a, b) => a.start - b.start || a.postIndex - b.postIndex)
  const several = plan.settings.posts.length > 1
  const out: string[] = [t.whatsapp.header]
  let day: number | null = null
  for (const r of rows) {
    if (r.dayKey !== day) {
      out.push('', t.whatsapp.day(r.dayLabel))
      day = r.dayKey
    }
    const who = [...r.people.map((x) => x.name), ...r.missing.map((m) => t.whatsapp.missing(m.role))]
    out.push(`${r.startLabel}–${r.endLabel}${several ? ` ${r.postLabel}` : ''} – ${who.join(', ')}`)
  }
  return out.join('\n')
}

export interface Replacement {
  soldierId: SoldierId
  name: string
  /** Minutes since his last shift ended (null: has not guarded on this board). */
  restMinutes: number | null
  rested: boolean
  /** Weighted guard ÷ field time so far (ledger + this board), 0..; null if no field time. */
  loadIndex: number | null
}

/**
 * Who can step in for `oldId` in a running shift: present now and until the shift ends,
 * not guarding anything that overlaps, qualified for the same role. Rested soldiers first,
 * then the lowest load.
 */
export function replacementCandidates(
  plan: Plan,
  soldiers: SoldierRecord[],
  shiftId: string,
  oldId: SoldierId,
  now: Minutes,
  loadIndexOf: (s: SoldierRecord) => number | null,
): Replacement[] {
  const shift = plan.generated.shifts.find((x) => x.id === shiftId)
  const seat = plan.output.assignments.find((a) => a.shiftId === shiftId && a.soldierId === oldId)
  if (!shift || !seat) return []
  const byId = new Map(plan.generated.shifts.map((x) => [x.id, x]))
  const inShift = new Set(plan.output.assignments.filter((a) => a.shiftId === shiftId).map((a) => a.soldierId))
  const from = Math.max(now, shift.start)
  const list: Replacement[] = []
  for (const s of soldiers) {
    if (!plan.soldierIds.includes(s.id) || inShift.has(s.id) || !s.roles.includes(seat.role)) continue
    const away = (plan.absences[s.id] ?? []).some((a) => a.start < shift.end && from < a.end)
    if (away) continue
    const mine = plan.output.assignments.filter((a) => a.soldierId === s.id).map((a) => byId.get(a.shiftId)!)
    if (mine.some((x) => x.start < shift.end && from < x.end)) continue
    const ended = mine.filter((x) => x.end <= from).sort((a, b) => a.end - b.end)
    const last = ended[ended.length - 1]
    const rest = last ? from - last.end : null
    const need = last?.restAfterMinutes ?? plan.settings.restMinutes // D9: set by his last task
    list.push({
      soldierId: s.id,
      name: s.name,
      restMinutes: rest,
      rested: rest === null || rest >= need,
      loadIndex: loadIndexOf(s),
    })
  }
  return list.sort(
    (a, b) =>
      Number(b.rested) - Number(a.rested) ||
      (a.loadIndex ?? 0) - (b.loadIndex ?? 0) ||
      (b.restMinutes ?? Infinity) - (a.restMinutes ?? Infinity) ||
      a.name.localeCompare(b.name, 'he'),
  )
}

/** Put `newId` in `oldId`'s seat of a running shift, then re-plan from now. */
export async function replaceInShift(
  plan: Plan,
  soldiers: SoldierRecord[],
  shiftId: string,
  oldId: SoldierId,
  newId: SoldierId,
  now: Minutes,
  solve: SolveAsync,
): Promise<Plan> {
  const assignments = plan.output.assignments.map((a) =>
    a.shiftId === shiftId && a.soldierId === oldId ? { ...a, soldierId: newId, locked: true } : a,
  )
  const shift = plan.generated.shifts.find((x) => x.id === shiftId)!
  // The shift has started, so replan() locks it (with the replacement) like the rest of the past.
  return replan({ ...plan, output: { ...plan.output, assignments } }, soldiers, plan.absences, Math.max(now, shift.start + 1), solve)
}
