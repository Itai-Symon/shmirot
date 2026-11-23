/**
 * Local persistence (IndexedDB via Dexie). Nothing ever leaves the device (D6).
 */
import Dexie, { type Table } from 'dexie'
import type { Interval, Minutes, Role, SoldierId, SolverOutput } from '../solver/types'
import type { ActivityConfig, GeneratedActivity } from './shiftGenerator'
import type { RoleRecord } from '../ui/labels'

export interface SoldierRecord {
  id: SoldierId
  /** Free text (D6). Role and post names are free text too. */
  name: string
  roles: Role[]
  /** Display order. */
  order: number
}

/** What the "התחל פעילות" screen edits. */
export interface ActivitySettings extends ActivityConfig {
  restMinutes: Minutes
  /** Chosen duration chip in hours, or null when the end was set by hand. */
  durationHours: number | null
}

/** The current schedule shown on the board. */
export interface Plan {
  settings: ActivitySettings
  generated: GeneratedActivity
  /** Soldier ids that were part of the platoon when the plan was made. */
  soldierIds: SoldierId[]
  absences: Record<SoldierId, Interval[]>
  /** Roles (ids, names, order) when the plan was made. Missing in plans saved before custom roles. */
  roles?: RoleRecord[]
  output: SolverOutput
}

interface KvRow {
  key: string
  value: unknown
}

class ShmirotDB extends Dexie {
  soldiers!: Table<SoldierRecord, SoldierId>
  kv!: Table<KvRow, string>

  constructor() {
    super('shmirot')
    this.version(1).stores({
      soldiers: 'id, order',
      kv: 'key',
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

async function getKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

async function putKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export const loadSettings = () => getKv<ActivitySettings>('settings')
export const saveSettings = (s: ActivitySettings) => putKv('settings', s)
export const loadPlan = () => getKv<Plan>('plan')
/** Ordered list of the platoon's roles; undefined until the user first changes them. */
export const loadRoles = () => getKv<RoleRecord[]>('roles')
export const saveRoles = (r: RoleRecord[]) => putKv('roles', r)
export const savePlan = (p: Plan) => putKv('plan', p)

/** Ask the browser not to evict our data under storage pressure (local API, no network). */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => undefined)
}
