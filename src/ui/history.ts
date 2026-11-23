/**
 * Per-soldier history: what actually happened, per activity and in total.
 * Display only — it never feeds back into the solver.
 *
 * For an activity, everything is counted from its start up to `until`
 * (now, the activity's end, or the moment it was replaced — whichever is first):
 *  - guard minutes, split into day and night (00:00–06:00 wall clock, real minutes);
 *  - home minutes: absences inside the window;
 *  - rest minutes: time in the field without guarding = window − home − guard.
 * A shift in progress counts only its elapsed part. If the activity replaced a running one,
 * counting starts at `plan.countFromMs`, so overlapping time is never counted twice.
 */
import type { Interval, Minutes, SoldierId } from '../solver/types'
import type { Plan } from '../storage/db'
import { nightMinutes } from '../storage/shiftGenerator'

export interface SoldierTotals {
  soldierId: SoldierId
  dayGuardMinutes: Minutes
  nightGuardMinutes: Minutes
  restMinutes: Minutes
  homeMinutes: Minutes
  shifts: number
}

/** An activity as kept in history. */
export interface ActivityRecord {
  id: string
  plan: Plan
  /** Names at the time, so history survives removing a soldier from the platoon. */
  names: Record<SoldierId, string>
  /** Minute (since activity start) at which it was replaced; null while it is the current one. */
  closedAtMinute: Minutes | null
}

const MIN_MS = 60_000

function overlap(a: Interval, from: Minutes, to: Minutes): Minutes {
  return Math.max(0, Math.min(a.end, to) - Math.max(a.start, from))
}

/** Minute up to which an activity has happened. */
export function untilMinute(rec: Pick<ActivityRecord, 'plan' | 'closedAtMinute'>, nowMs: number): Minutes {
  const { plan } = rec
  const now = Math.floor((nowMs - plan.generated.startEpochMs) / MIN_MS)
  const limits = [now, plan.generated.endMinute]
  if (rec.closedAtMinute !== null) limits.push(rec.closedAtMinute)
  return Math.max(0, Math.min(...limits))
}

/** Minute from which an activity is counted. */
export function fromMinute(plan: Plan): Minutes {
  if (plan.countFromMs === undefined) return 0
  return Math.max(0, Math.ceil((plan.countFromMs - plan.generated.startEpochMs) / MIN_MS))
}

export function activityTotals(rec: Pick<ActivityRecord, 'plan' | 'closedAtMinute'>, nowMs: number): SoldierTotals[] {
  const { plan } = rec
  const from = fromMinute(plan)
  const until = Math.max(from, untilMinute(rec, nowMs))
  const tz = plan.settings.timeZone
  const startMs = plan.generated.startEpochMs
  const shiftById = new Map(plan.generated.shifts.map((s) => [s.id, s]))

  return plan.soldierIds.map((soldierId) => {
    let day = 0
    let night = 0
    let shifts = 0
    for (const a of plan.output.assignments) {
      if (a.soldierId !== soldierId) continue
      const s = shiftById.get(a.shiftId)
      if (!s || s.start >= until || s.end <= from) continue
      const begin = Math.max(s.start, from)
      const end = Math.min(s.end, until)
      const total = end - begin
      const n = begin === s.start && end === s.end ? s.nightMinutes : nightMinutes(startMs + begin * MIN_MS, startMs + end * MIN_MS, tz)
      night += n
      day += total - n
      // A shift that started before counting began was already counted in the replaced activity.
      if (s.start >= from) shifts++
    }
    const home = (plan.absences[soldierId] ?? []).reduce((sum, a) => sum + overlap(a, from, until), 0)
    return {
      soldierId,
      dayGuardMinutes: day,
      nightGuardMinutes: night,
      homeMinutes: home,
      restMinutes: Math.max(0, until - from - home - day - night),
      shifts,
    }
  })
}

/** Sum of several activities, per soldier (soldiers that appear in any of them). */
export function sumTotals(lists: SoldierTotals[][]): SoldierTotals[] {
  const by = new Map<SoldierId, SoldierTotals>()
  for (const list of lists) {
    for (const t of list) {
      const cur = by.get(t.soldierId)
      by.set(
        t.soldierId,
        cur
          ? {
              soldierId: t.soldierId,
              dayGuardMinutes: cur.dayGuardMinutes + t.dayGuardMinutes,
              nightGuardMinutes: cur.nightGuardMinutes + t.nightGuardMinutes,
              restMinutes: cur.restMinutes + t.restMinutes,
              homeMinutes: cur.homeMinutes + t.homeMinutes,
              shifts: cur.shifts + t.shifts,
            }
          : { ...t },
      )
    }
  }
  return [...by.values()]
}

/** Whether an activity has anything worth keeping (it has started). */
export function hasStarted(plan: Plan, nowMs: number): boolean {
  return nowMs > plan.generated.startEpochMs
}
