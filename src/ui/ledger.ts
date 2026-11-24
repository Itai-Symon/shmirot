/**
 * Per-soldier ledger: everything a soldier did before the current board, kept until the user
 * presses "reset load". It is carried into every new board (SolverInput.history, §4.2).
 *
 * Load index = weighted guard minutes ÷ minutes in the field (decision: home time does not count).
 */
import { DEFAULT_PARAMS, type SoldierHistory, type SoldierId } from '../solver/types'
import type { Plan } from '../storage/db'
import { activityTotals, fromMinute, untilMinute } from './history'

export interface Ledger {
  dayGuardMinutes: number
  nightGuardMinutes: number
  homeMinutes: number
  /** Minutes present in the field (home excluded). */
  fieldMinutes: number
  /** Guard minutes weighted with the weights in force at the time. */
  weightedLoad: number
  /** Weighted minutes the soldier should have guarded, proportional to field time. */
  fairShare: number
  /** Day / night minutes × post weight, guarded and fair share (for 'separate' balance). */
  dayLoad?: number
  dayFairShare?: number
  nightLoad?: number
  nightFairShare?: number
  /** End of the last shift (epoch ms), for rest continuity. */
  lastEndMs: number | null
  /** Still in a shift until this instant (epoch ms). */
  busyUntilMs: number | null
}

export const emptyLedger = (): Ledger => ({
  dayGuardMinutes: 0,
  nightGuardMinutes: 0,
  homeMinutes: 0,
  fieldMinutes: 0,
  weightedLoad: 0,
  fairShare: 0,
  lastEndMs: null,
  busyUntilMs: null,
})

const MIN_MS = 60_000

/**
 * Fold what happened on `plan` (from its counting start up to now) into the ledgers.
 * A shift in progress is folded whole: the soldier will finish it, and the next board keeps
 * him busy until it ends.
 */
export function foldPlan(ledgers: ReadonlyMap<SoldierId, Ledger>, plan: Plan, nowMs: number): Map<SoldierId, Ledger> {
  const out = new Map<SoldierId, Ledger>()
  for (const [id, l] of ledgers) out.set(id, { ...l })
  const from = fromMinute(plan)
  const until = untilMinute({ plan, closedAtMinute: null }, nowMs)
  if (until <= from) return out
  const alpha = plan.settings.nightWeight ?? DEFAULT_PARAMS.nightWeight
  const startMs = plan.generated.startEpochMs
  const byId = new Map(plan.generated.shifts.map((s) => [s.id, s]))
  const totals = activityTotals({ plan, closedAtMinute: null }, nowMs)

  // Guard of every shift that started inside [from, until), counted whole.
  const guard = new Map<SoldierId, { day: number; night: number; weighted: number; dayW: number; nightW: number; lastEnd: number; busyUntil: number | null }>()
  for (const a of plan.output.assignments) {
    const s = byId.get(a.shiftId)
    if (!s || s.start < from || s.start >= until) continue
    const g = guard.get(a.soldierId) ?? { day: 0, night: 0, weighted: 0, dayW: 0, nightW: 0, lastEnd: -Infinity, busyUntil: null }
    g.dayW += (s.end - s.start - s.nightMinutes) * (s.weightFactor ?? 1)
    g.nightW += s.nightMinutes * (s.weightFactor ?? 1)
    g.night += s.nightMinutes
    g.day += s.end - s.start - s.nightMinutes
    g.weighted += (s.end - s.start - s.nightMinutes + alpha * s.nightMinutes) * (s.weightFactor ?? 1)
    g.lastEnd = Math.max(g.lastEnd, s.end)
    if (s.end > until) g.busyUntil = Math.max(g.busyUntil ?? -Infinity, s.end)
    guard.set(a.soldierId, g)
  }

  // Fair share of this stretch: proportional to field time (load index definition).
  let weightedSum = 0
  let daySum = 0
  let nightSum = 0
  let fieldSum = 0
  const field = new Map<SoldierId, number>()
  for (const t of totals) {
    const f = Math.max(0, until - from - t.homeMinutes)
    field.set(t.soldierId, f)
    fieldSum += f
    const g = guard.get(t.soldierId)
    if (g) {
      weightedSum += g.weighted
      daySum += g.dayW
      nightSum += g.nightW
    }
  }
  const rate = fieldSum > 0 ? weightedSum / fieldSum : 0
  const dayRate = fieldSum > 0 ? daySum / fieldSum : 0
  const nightRate = fieldSum > 0 ? nightSum / fieldSum : 0

  for (const t of totals) {
    const l = out.get(t.soldierId) ?? emptyLedger()
    const g = guard.get(t.soldierId)
    const f = field.get(t.soldierId) ?? 0
    if (g) {
      l.dayGuardMinutes += g.day
      l.nightGuardMinutes += g.night
      l.weightedLoad += g.weighted
      l.dayLoad = (l.dayLoad ?? 0) + g.dayW
      l.nightLoad = (l.nightLoad ?? 0) + g.nightW
      l.lastEndMs = startMs + g.lastEnd * MIN_MS
      l.busyUntilMs = g.busyUntil === null ? null : startMs + g.busyUntil * MIN_MS
    }
    l.homeMinutes += t.homeMinutes
    l.fieldMinutes += f
    l.fairShare += rate * f
    l.dayFairShare = (l.dayFairShare ?? 0) + dayRate * f
    l.nightFairShare = (l.nightFairShare ?? 0) + nightRate * f
    out.set(t.soldierId, l)
  }
  return out
}

/** The ledgers as solver history, in minutes of a board starting at `startEpochMs`. */
export function toHistory(ledgers: ReadonlyMap<SoldierId, Ledger>, startEpochMs: number): SoldierHistory[] {
  const rel = (ms: number | null) => (ms === null ? null : Math.round((ms - startEpochMs) / MIN_MS))
  return [...ledgers].map(([soldierId, l]) => ({
    soldierId,
    load: l.weightedLoad,
    fairShare: l.fairShare,
    dayLoad: l.dayLoad ?? 0,
    dayFairShare: l.dayFairShare ?? 0,
    nightLoad: l.nightLoad ?? 0,
    nightFairShare: l.nightFairShare ?? 0,
    lastEnd: rel(l.lastEndMs),
    busyUntil: rel(l.busyUntilMs),
  }))
}

/** What to show for a soldier right now: ledger + the elapsed part of the current board. */
export interface SoldierNow {
  dayGuardMinutes: number
  nightGuardMinutes: number
  restMinutes: number
  homeMinutes: number
  /** Weighted guard ÷ field time, 0..1; null before any field time. */
  loadIndex: number | null
}

export function soldierNow(id: SoldierId, ledger: Ledger | undefined, plan: Plan | undefined, nowMs: number): SoldierNow {
  const l = ledger ?? emptyLedger()
  let day = l.dayGuardMinutes
  let night = l.nightGuardMinutes
  let home = l.homeMinutes
  let field = l.fieldMinutes
  let weighted = l.weightedLoad
  if (plan && plan.soldierIds.includes(id)) {
    const t = activityTotals({ plan, closedAtMinute: null }, nowMs).find((x) => x.soldierId === id)
    if (t) {
      day += t.dayGuardMinutes
      night += t.nightGuardMinutes
      home += t.homeMinutes
      field += t.dayGuardMinutes + t.nightGuardMinutes + t.restMinutes
      weighted += t.weightedGuardMinutes
    }
  }
  const guard = day + night
  return {
    dayGuardMinutes: day,
    nightGuardMinutes: night,
    homeMinutes: home,
    restMinutes: Math.max(0, field - guard),
    loadIndex: field > 0 ? weighted / field : null,
  }
}

/**
 * Manual correction of what a soldier actually guarded (swaps, someone stayed longer...).
 * Adds the difference between the corrected totals and what is shown now to his ledger.
 * Rest absorbs the difference; if he guarded more than his shown rest allows, the extra was
 * time in the field too, so field time grows by the excess. Fair share is unchanged.
 */
export function correctLedger(
  ledger: Ledger | undefined,
  shown: { day: number; night: number; rest?: number; home?: number },
  actual: { day: number; night: number; home?: number },
  nightWeight: number,
): Ledger {
  const l = { ...(ledger ?? emptyLedger()) }
  const dDay = actual.day - shown.day
  const dNight = actual.night - shown.night
  l.dayGuardMinutes += dDay
  l.nightGuardMinutes += dNight
  l.weightedLoad += dDay + nightWeight * dNight
  l.dayLoad = (l.dayLoad ?? 0) + dDay
  l.nightLoad = (l.nightLoad ?? 0) + dNight
  l.fieldMinutes += Math.max(0, dDay + dNight - (shown.rest ?? 0))
  // Home time: more home means less time in the field, and a smaller fair share for it.
  const dHome = (actual.home ?? shown.home ?? 0) - (shown.home ?? 0)
  if (dHome !== 0) {
    const field = l.fieldMinutes
    const moved = Math.min(dHome, Math.max(0, field - l.dayGuardMinutes - l.nightGuardMinutes)) // never below his guard time
    const rate = (x: number | undefined) => (field > 0 ? (x ?? 0) / field : 0)
    const r = rate(l.fairShare)
    const rd = rate(l.dayFairShare)
    const rn = rate(l.nightFairShare)
    l.homeMinutes = Math.max(0, l.homeMinutes + dHome)
    l.fieldMinutes = field - moved
    l.fairShare -= r * moved
    l.dayFairShare = (l.dayFairShare ?? 0) - rd * moved
    l.nightFairShare = (l.nightFairShare ?? 0) - rn * moved
  }
  return l
}

/** The same correction applied to a board's carried-in history, so re-planning reacts at once. */
export function correctHistory(
  h: SoldierHistory[] | undefined,
  id: SoldierId,
  dDay: number,
  dNight: number,
  nightWeight: number,
  dFair: { all: number; day: number; night: number } = { all: 0, day: 0, night: 0 },
): SoldierHistory[] {
  const list = [...(h ?? [])]
  const i = list.findIndex((x) => x.soldierId === id)
  const cur = i >= 0 ? list[i] : { soldierId: id, load: 0, fairShare: 0, lastEnd: null, busyUntil: null }
  const next = {
    ...cur,
    load: cur.load + dDay + nightWeight * dNight,
    dayLoad: (cur.dayLoad ?? 0) + dDay,
    nightLoad: (cur.nightLoad ?? 0) + dNight,
    fairShare: cur.fairShare + dFair.all,
    dayFairShare: (cur.dayFairShare ?? 0) + dFair.day,
    nightFairShare: (cur.nightFairShare ?? 0) + dFair.night,
  }
  if (i >= 0) list[i] = next
  else list.push(next)
  return list
}
