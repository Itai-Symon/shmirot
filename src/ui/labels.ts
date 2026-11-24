/**
 * User-defined labels: role names and post names (decision D6, option "free text").
 * The solver never sees these — only role ids and post indexes.
 */
import { t } from '../i18n'
import { DEFAULT_ROLES, type Role } from '../solver/types'
import type { PostConfig } from '../storage/shiftGenerator'

/** Max length of a role or post name. Short on purpose: a label, not a description. */
export const LABEL_MAX = 16

export interface RoleRecord {
  id: Role
  name: string
}

const builtIn = t.roles as Record<string, string>

export function defaultRoles(): RoleRecord[] {
  return DEFAULT_ROLES.map((id) => ({ id, name: builtIn[id] ?? id }))
}

/** Display name of a role id; falls back to the built-in Hebrew name, then '?'. */
export function roleName(roles: readonly RoleRecord[] | undefined, id: Role): string {
  return roles?.find((r) => r.id === id)?.name || builtIn[id] || '?'
}

/** Task types offered by default. */
export const DEFAULT_TASK_KINDS: readonly string[] = [t.activity.kindPost, t.activity.kindPatrol]

/** A task's type label ("עמדה" if none; old 'post' / 'patrol' values mapped). */
export function kindOf(p: PostConfig | undefined): string {
  const k = p?.kind?.trim()
  if (!k || k === 'post') return t.activity.kindPost
  if (k === 'patrol') return t.activity.kindPatrol
  return k
}

/** Display name of a task: its own name, or "<type> N" (numbered within its type). */
export function postName(posts: readonly PostConfig[] | undefined, index: number): string {
  const own = posts?.[index]?.name?.trim()
  if (own) return own
  if (!posts || !posts[index]) return t.activity.post(index)
  const kind = kindOf(posts[index])
  const n = posts.slice(0, index + 1).filter((p) => kindOf(p) === kind).length
  return `${kind} ${n}`
}

/** Trim, collapse spaces, cut to LABEL_MAX. */
export function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trimStart().slice(0, LABEL_MAX)
}

let roleCounter = 0
export function newRoleId(): Role {
  roleCounter += 1
  return `r${Date.now().toString(36)}${roleCounter.toString(36)}`
}
