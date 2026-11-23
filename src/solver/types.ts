/**
 * Solver contract. See ALGORITHM.md for semantics.
 *
 * All times are integer minutes since activity start (real elapsed time).
 * Intervals are half-open: [start, end).
 * The solver never sees soldier names — only ids.
 */

export type Minutes = number
export type SoldierId = string
export type ShiftId = string

/**
 * A role id. Roles are user-defined (decision D6); the solver only sees ids, never names.
 */
export type Role = string

/** Roles a new platoon starts with, and the order used when an input gives none. */
export const DEFAULT_ROLES: readonly Role[] = ['commander', 'soldier', 'medic', 'signaler', 'driver']

export interface Interval {
  start: Minutes
  end: Minutes
}

export interface Soldier {
  id: SoldierId
  /** Non-empty set of qualifications. */
  roles: Role[]
  /** Times the soldier is not in the field (home leave, etc.). */
  absences: Interval[]
}

export interface Shift {
  id: ShiftId
  /** Posts are numbered only (decision D6). 0-based; UI shows "עמדה {postIndex + 1}". */
  postIndex: number
  start: Minutes
  end: Minutes
  /** Minutes of this shift inside 00:00–06:00 wall-clock. Precomputed by the shift generator. */
  nightMinutes: Minutes
  /**
   * Difficulty of this post (e.g. 1.3 outside, 0.8 at company HQ). Multiplies the shift's
   * weight (§4.4). Missing ⇒ 1. Must be > 0.
   */
  weightFactor?: number
  /** How many soldiers of each role this shift needs. Missing role = 0. */
  requirements: Partial<Record<Role, number>>
}

export interface SolverParams {
  /** Rest target R (a target, not a hard rule — decision D5). */
  minRestMinutes: Minutes
  /** Multiplier for night minutes (decision D2, default 1.5). */
  nightWeight: number
}

export const DEFAULT_PARAMS: SolverParams = {
  minRestMinutes: 4 * 60,
  nightWeight: 1.5,
}

export interface LockedAssignment {
  shiftId: ShiftId
  soldierId: SoldierId
  role: Role
}

/**
 * What a soldier carries in from before this schedule (ALGORITHM.md §4.2): earlier boards of
 * the same activity and earlier activities, until the user resets load. Times are minutes of
 * THIS schedule (usually ≤ 0).
 */
export interface SoldierHistory {
  soldierId: SoldierId
  /** Weighted minutes guarded before this schedule. */
  load: number
  /** Weighted minutes this soldier should have guarded before this schedule (§4.3). */
  fairShare: number
  /** End of the soldier's last shift before this schedule; null if none. */
  lastEnd: Minutes | null
  /** The soldier is still in a shift that started before this schedule, until this minute. */
  busyUntil: Minutes | null
}

export interface SolverInput {
  /**
   * Role ids in priority order. Defines the "role order" used for tie-breaks and output
   * ordering (ALGORITHM.md §3). Defaults to DEFAULT_ROLES. See roleOrder().
   */
  roles?: Role[]
  soldiers: Soldier[]
  shifts: Shift[]
  params: SolverParams
  /** Fixed assignments (the past, or manual pins). Kept even if they violate rest. */
  locked: LockedAssignment[]
  /** Carried-in state per soldier (§4.2). Missing soldier ⇒ starts from zero. */
  history?: SoldierHistory[]
}

export interface Assignment {
  shiftId: ShiftId
  soldierId: SoldierId
  role: Role
  /** max(0, R − rest) for this assignment; 0 if it is the soldier's first shift. */
  restDebtMinutes: Minutes
  locked: boolean
}

export interface Shortage {
  shiftId: ShiftId
  role: Role
  missing: number
}

/** Per-soldier stats of THIS schedule only (history is not included; add it for totals). */
export interface SoldierStats {
  soldierId: SoldierId
  /** Weighted minutes guarded. */
  load: number
  /** Weighted minutes this soldier should have guarded given presence (§4.3). */
  fairShare: number
  /** load − fairShare */
  deviation: number
  shiftCount: number
  nightMinutes: Minutes
  /** Minimum rest between consecutive shifts; null if fewer than 2 shifts. */
  minRestMinutes: Minutes | null
  totalRestDebtMinutes: Minutes
}

export interface Certificate {
  /** Minimum rest over all consecutive shift pairs of all soldiers; null if no pair exists. */
  achievedMinRestMinutes: Minutes | null
  /** Proven upper bound (§6); null when not computable (shortages present or no pairs). */
  upperBoundMinRestMinutes: Minutes | null
  /** achieved !== null && achieved === upperBound. False whenever either is null (certificate n/a). */
  provenOptimal: boolean
}

export type WarningCode =
  /** Zero slack: same soldiers get the same night hours every day (Claim 4 corollary). */
  | 'NIGHT_TRAP'
  /** Not enough qualified soldiers of a role to meet the rest target. */
  | 'ROLE_BOTTLENECK'
  /** Some assignments carry rest debt. */
  | 'REST_DEBT'

export interface Warning {
  code: WarningCode
  role?: Role
  /** Free-form numeric details for the UI to format (no text, for i18n). */
  details?: Record<string, number>
}

export interface SolverOutput {
  assignments: Assignment[]
  shortages: Shortage[]
  stats: SoldierStats[]
  certificate: Certificate
  warnings: Warning[]
}

/**
 * The role order of an input (ALGORITHM.md §3): `input.roles` (or DEFAULT_ROLES) without
 * duplicates, followed by every other role id that appears in soldiers, requirements or
 * locks, sorted by UTF-16 code units. Shared by solver and verifier so both agree.
 */
export function roleOrder(input: Pick<SolverInput, 'roles' | 'soldiers' | 'shifts' | 'locked'>): Role[] {
  const base = [...new Set(input.roles ?? DEFAULT_ROLES)]
  const known = new Set(base)
  const extra = new Set<Role>()
  const see = (r: Role) => {
    if (!known.has(r)) extra.add(r)
  }
  for (const s of input.soldiers) s.roles.forEach(see)
  for (const sh of input.shifts) Object.keys(sh.requirements).forEach(see)
  for (const l of input.locked) see(l.role)
  return [...base, ...[...extra].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))]
}

/** Why each soldier did or did not get a shift (ALGORITHM.md §4.6). */
export type CandidateStatus =
  | 'chosen' //         got a seat in this shift
  | 'other_post' //     got a seat in another shift starting at the same time
  | 'not_chosen' //     eligible, ranked, but others ranked higher (or roles did not fit)
  | 'absent' //         at home during the shift
  | 'busy' //           still guarding another shift, or kept for a pinned one
  | 'unqualified' //    has none of the roles this shift needs

export interface CandidateExplanation {
  soldierId: SoldierId
  status: CandidateStatus
  /** Role taken, for 'chosen'. */
  role?: Role
  /** For ranked soldiers (chosen / other_post / not_chosen): the §4.4 b key and rank (0 = first). */
  rank?: number
  rested?: boolean
  /** Minutes since the soldier's last shift ended; null if he has not guarded yet. */
  restMinutes?: number | null
  /** load − fairShare in weighted minutes, history included. */
  deviation?: number
}

export interface ShiftExplanation {
  shiftId: ShiftId
  /** Soldiers in display order: chosen first, then by rank, then the rest by status. */
  candidates: CandidateExplanation[]
}

/** Must be deterministic: same input ⇒ identical output. */
export type Solve = (input: SolverInput) => SolverOutput

export interface Violation {
  kind:
    | 'ASSIGNED_WHILE_ABSENT'
    | 'DOUBLE_BOOKED'
    | 'UNQUALIFIED'
    | 'OVERFILLED'
    | 'UNKNOWN_SHIFT_OR_SOLDIER'
    | 'LOCK_NOT_RESPECTED'
    | 'AVOIDABLE_SHORTAGE'
    | 'WRONG_STATS'
    | 'WRONG_REST_DEBT'
  shiftId?: ShiftId
  soldierId?: SoldierId
  message: string
}

/** Independent checker (must not import from src/solver except this types file). */
export type Verify = (input: SolverInput, output: SolverOutput) => Violation[]
