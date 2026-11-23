/**
 * Turning solver output into plain-language fairness information (session 3).
 * Pure helpers — no React, no storage.
 */
import { t } from '../i18n'
import { DEFAULT_PARAMS, type Certificate, type SolverOutput } from '../solver/types'
import { roleName, type RoleRecord } from './labels'

/** Night-weight presets. Rest is set separately (activity screen chips). */
export const PRESETS = [
  { id: 'balanced', nightWeight: DEFAULT_PARAMS.nightWeight },
  { id: 'sleep', nightWeight: 2 },
  { id: 'equal', nightWeight: 1 },
] as const
export type PresetId = (typeof PRESETS)[number]['id']

export const NIGHT_WEIGHT_MIN = 1
export const NIGHT_WEIGHT_MAX = 3
export const NIGHT_WEIGHT_STEP = 0.25

export function presetOf(nightWeight: number): PresetId | null {
  return PRESETS.find((p) => p.nightWeight === nightWeight)?.id ?? null
}

export type Level = 'ok' | 'info' | 'warn'
export interface Notice {
  level: Level
  text: string
}

const hours = (m: number) => {
  const h = m / 60
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}

/** The certificate as one line, or null when there is nothing to say. */
export function certificateNotice(c: Certificate, restMinutes: number): Notice | null {
  if (c.achievedMinRestMinutes === null) return null
  const achieved = hours(c.achievedMinRestMinutes)
  if (c.provenOptimal && c.achievedMinRestMinutes < restMinutes) {
    // Best possible, but below the target: say so instead of a green check.
    return { level: 'info', text: t.fairness.provenBestBelowTarget(achieved, hours(restMinutes)) }
  }
  if (c.provenOptimal) return { level: 'ok', text: t.fairness.provenOptimal(achieved) }
  if (c.upperBoundMinRestMinutes !== null) {
    return { level: 'info', text: t.fairness.belowBound(achieved, hours(c.upperBoundMinRestMinutes)) }
  }
  return { level: 'info', text: t.fairness.minRest(achieved) }
}

/** Warnings and shortages of a schedule, in plain Hebrew, most important first. */
export function warningNotices(out: SolverOutput, roles: readonly RoleRecord[] | undefined, restMinutes: number): Notice[] {
  const notices: Notice[] = []
  const missing = out.shortages.reduce((n, s) => n + s.missing, 0)
  if (missing > 0) {
    const shifts = new Set(out.shortages.map((s) => s.shiftId)).size
    notices.push({ level: 'warn', text: t.fairness.shortages(missing, shifts) })
  }
  const order = { ROLE_BOTTLENECK: 0, REST_DEBT: 1, NIGHT_TRAP: 2 } as const
  for (const w of [...out.warnings].sort((a, b) => order[a.code] - order[b.code])) {
    const d = w.details ?? {}
    if (w.code === 'ROLE_BOTTLENECK' && w.role !== undefined) {
      notices.push({
        level: 'warn',
        text: t.fairness.roleBottleneck(roleName(roles, w.role), d.qualified ?? 0, d.needed ?? 0, hours(restMinutes)),
      })
    } else if (w.code === 'REST_DEBT') {
      notices.push({ level: 'info', text: t.fairness.restDebt(hours(restMinutes), hours(d.maxMinutes ?? 0)) })
    } else if (w.code === 'NIGHT_TRAP') {
      notices.push({ level: 'warn', text: t.fairness.nightTrap })
    }
  }
  return notices
}

/** Largest difference in weighted guard hours between soldiers who guarded or should have. */
export function loadSpreadHours(out: SolverOutput): number {
  const loads = out.stats.filter((s) => s.fairShare > 0 || s.load > 0).map((s) => s.load)
  if (loads.length < 2) return 0
  return (Math.max(...loads) - Math.min(...loads)) / 60
}
