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

/** Fixed role list (decision D6: no free-text roles). */
export const ROLES = ['commander', 'soldier', 'medic', 'signaler', 'driver'] as const
export type Role = (typeof ROLES)[number]

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

export interface SolverInput {
  soldiers: Soldier[]
  shifts: Shift[]
  params: SolverParams
  /** Fixed assignments (the past, or manual pins). Kept even if they violate rest. */
  locked: LockedAssignment[]
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
