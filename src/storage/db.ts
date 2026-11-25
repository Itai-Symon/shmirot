/**
 * Local persistence (IndexedDB via Dexie). Nothing ever leaves the device (D6).
 */
import Dexie, { type Table } from 'dexie'
import type { BalanceMode, Interval, Minutes, Role, SoldierHistory, SoldierId, SolverInput, SolverOutput } from '../solver/types'
import type { Ledger } from '../ui/ledger'
import type { ActivityConfig, GeneratedActivity } from './shiftGenerator'
import type { RoleRecord } from '../ui/labels'
import type { ActivityRecord } from '../ui/history'

export interface SoldierRecord {
  id: SoldierId
  /** Free text (D6). Role and post names are free text too. */
  name: string
  roles: Role[]
  /** Display order. */
  order: number
  /** Everything before the current board, until "reset load" (carried into new boards). */
  ledger?: Ledger
}

/** What the "התחל תעסוקה" screen edits. */
export interface ActivitySettings extends ActivityConfig {
  restMinutes: Minutes
  /** Night weight α (ALGORITHM.md D2). Missing in older saved settings ⇒ default. */
  nightWeight?: number
  /** Balance mode (D8). Missing ⇒ 'weighted'. */
  balance?: BalanceMode
  /** Brotherhood factor β (D9). 0=rotation, 1=load. Missing ⇒ 1. */
  brotherhoodFactor?: number
  /** Chosen duration chip in hours, or null when the end was set by hand. */
  durationHours: number | null
  /** Task types offered for tasks (user-defined labels). Missing ⇒ the defaults. */
  taskKinds?: string[]
}

/** The current schedule shown on the board. */
export interface Plan {
  /** Activity id (missing in plans saved before history existed). */
  id?: string
  /**
   * History counts this activity only from this instant. Set when it replaced an activity
   * that was still running, so the overlapping time is not counted twice.
   */
  countFromMs?: number
  settings: ActivitySettings
  generated: GeneratedActivity
  /** Soldier ids that were part of the platoon when the plan was made. */
  soldierIds: SoldierId[]
  absences: Record<SoldierId, Interval[]>
  /** Carried-in history given to the solver when the board was made (reused on re-plan). */
  history?: SoldierHistory[]
  /** Roles (ids, names, order) when the plan was made. Missing in plans saved before custom roles. */
  roles?: RoleRecord[]
  output: SolverOutput
  /** The exact solver input that produced `output` (for "why him?" replays). */
  input?: SolverInput
}

interface KvRow {
  key: string
  value: unknown
}

class ShmirotDB extends Dexie {
  soldiers!: Table<SoldierRecord, SoldierId>
  kv!: Table<KvRow, string>
  activities!: Table<ActivityRecord, string>

  constructor() {
    super('shmirot')
    this.version(1).stores({
      soldiers: 'id, order',
      kv: 'key',
    })
    // v2: history of past activities (per-soldier stats survive new activities).
    this.version(2).stores({
      soldiers: 'id, order',
      kv: 'key',
      activities: 'id',
    })
  }
}

export const db = new ShmirotDB()

export async function loadSoldiers(): Promise<SoldierRecord[]> {
  return db.soldiers.orderBy('order').toArray()
}

export async function saveSoldiers(list: SoldierRecord[]): Promise<void> {
  await db.transaction('rw', db.soldiers, async () => {
    await db.soldiers.clear()
    await db.soldiers.bulkPut(list)
  })
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function putKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export const loadSettings = () => getKv<ActivitySettings>('settings')
export const saveSettings = (s: ActivitySettings) => putKv('settings', s)
export const loadPlan = () => getKv<Plan>('plan')
/** Past activities, oldest first. */
export async function loadHistory(): Promise<ActivityRecord[]> {
  const all = await db.activities.toArray()
  return all.sort((a, b) => a.plan.generated.startEpochMs - b.plan.generated.startEpochMs)
}
export const archiveActivity = (rec: ActivityRecord) => db.activities.put(rec)
export const deleteActivity = (id: string) => db.activities.delete(id)

export const loadLastBackup = () => getKv<number>('lastBackupAt')
export const saveLastBackup = (ms: number) => putKv('lastBackupAt', ms)
export async function clearPlan(): Promise<void> {
  await db.kv.delete('plan')
}

/** Ordered list of the platoon's roles; undefined until the user first changes them. */
export const loadRoles = () => getKv<RoleRecord[]>('roles')
export const saveRoles = (r: RoleRecord[]) => putKv('roles', r)
export const savePlan = (p: Plan) => putKv('plan', p)

/** Ask the browser not to evict our data under storage pressure (local API, no network). */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => undefined)
}
