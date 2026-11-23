/**
 * Backup file: everything the app keeps, in one JSON file the user saves or sends to himself.
 * Import validates the whole file first and only then replaces the data — never half a file.
 */
import type { RoleRecord } from '../ui/labels'
import type { ActivitySettings, Plan, SoldierRecord } from './db'

export const BACKUP_FORMAT = 'shmirot-backup'
export const BACKUP_VERSION = 1

export interface BackupData {
  soldiers: SoldierRecord[]
  roles: RoleRecord[]
  settings: ActivitySettings | null
  plan: Plan | null
}

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
}

export type BackupError = 'notJson' | 'notBackup' | 'newerVersion' | 'broken'

export function makeBackup(data: BackupData, now: Date): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), ...structuredClone(data) }
}

export function backupFileName(now: Date): string {
  return `shmirot-backup-${now.toISOString().slice(0, 10)}.json`
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

function validSoldier(x: unknown): x is SoldierRecord {
  return isObj(x) && isStr(x.id) && isStr(x.name) && Array.isArray(x.roles) && x.roles.every(isStr) && isNum(x.order)
}
function validRole(x: unknown): x is RoleRecord {
  return isObj(x) && isStr(x.id) && isStr(x.name)
}
function validSettings(x: unknown): x is ActivitySettings {
  return isObj(x) && isStr(x.start) && isStr(x.end) && isStr(x.timeZone) && isNum(x.shiftMinutes) && isNum(x.restMinutes) && Array.isArray(x.posts)
}
function validPlan(x: unknown): x is Plan {
  if (!isObj(x) || !validSettings(x.settings) || !isObj(x.generated) || !isObj(x.output)) return false
  const g = x.generated
  const o = x.output
  return isNum(g.startEpochMs) && isNum(g.endMinute) && Array.isArray(g.shifts) && Array.isArray(o.assignments) && Array.isArray(o.stats) && Array.isArray(x.soldierIds) && isObj(x.absences)
}

export function parseBackup(text: string): { ok: true; data: BackupFile } | { ok: false; error: BackupError } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'notJson' }
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, error: 'notBackup' }
  if (!isNum(raw.version) || raw.version > BACKUP_VERSION) return { ok: false, error: 'newerVersion' }
  const soldiersOk = Array.isArray(raw.soldiers) && raw.soldiers.every(validSoldier)
  const rolesOk = Array.isArray(raw.roles) && raw.roles.every(validRole) && raw.roles.length > 0
  const settingsOk = raw.settings === null || validSettings(raw.settings)
  const planOk = raw.plan === null || validPlan(raw.plan)
  if (!soldiersOk || !rolesOk || !settingsOk || !planOk || !isStr(raw.exportedAt)) return { ok: false, error: 'broken' }
  const ids = new Set((raw.soldiers as SoldierRecord[]).map((s) => s.id))
  if (ids.size !== (raw.soldiers as SoldierRecord[]).length) return { ok: false, error: 'broken' }
  return { ok: true, data: raw as unknown as BackupFile }
}
