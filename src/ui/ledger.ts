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
  const guard = new Map<SoldierId, { day: number; night: number; lastEnd: number; busyUntil: number | null }>()
  for (const a of plan.output.assignments) {
    const s = byId.get(a.shiftId)
    if (!s || s.start < from || s.start >= until) continue
    const g = guard.get(a.soldierId) ?? { day: 0, night: 0, lastEnd: -Infinity, busyUntil: null }
    g.night += s.nightMinutes
    g.day += s.end - s.start - s.nightMinutes
    g.lastEnd = Math.max(g.lastEnd, s.end)
    if (s.end > until) g.busyUntil = Math.max(g.busyUntil ?? -Infinity, s.end)
    guard.set(a.soldierId, g)
  }

  // Fair share of this stretch: proportional to field time (load index definition).
  let weightedSum = 0
  let fieldSum = 0
  const field = new Map<SoldierId, number>()
  for (const t of totals) {
    const f = Math.max(0, until - from - t.homeMinutes)
    field.set(t.soldierId, f)
    fieldSum += f
    const g = guard.get(t.soldierId)
    if (g) weightedSum += g.day + alpha * g.night
  }
  const rate = fieldSum > 0 ? weightedSum / fieldSum : 0

  for (const t of totals) {
    const l = out.get(t.soldierId) ?? emptyLedger()
    const g = guard.get(t.soldierId)
    const f = field.get(t.soldierId) ?? 0
    if (g) {
      l.dayGuardMinutes += g.day
      l.nightGuardMinutes += g.night
      l.weightedLoad += g.day + alpha * g.night
      l.lastEndMs = startMs + g.lastEnd * MIN_MS
      l.busyUntilMs = g.busyUntil === null ? null : startMs + g.busyUntil * MIN_MS
    }
    l.homeMinutes += t.homeMinutes
    l.fieldMinutes += f
    l.fairShare += rate * f
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
      const alpha = plan.settings.nightWeight ?? DEFAULT_PARAMS.nightWeight
      day += t.dayGuardMinutes
      night += t.nightGuardMinutes
      home += t.homeMinutes
      field += t.dayGuardMinutes + t.nightGuardMinutes + t.restMinutes
      weighted += t.dayGuardMinutes + alpha * t.nightGuardMinutes
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
