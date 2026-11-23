import type { ActivitySettings } from '../storage/db'
import { addWallHours, epochToWall, type PostConfig } from '../storage/shiftGenerator'

export const SHIFT_HOURS = [1, 2, 3, 4] as const
export const REST_HOURS = [2, 4, 6, 8] as const
export const DURATION_HOURS = [12, 24, 48, 72, 168] as const

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The next full hour, as wall clock in the given zone. */
export function nextFullHour(nowMs: number, timeZone: string): string {
  return `${epochToWall(nowMs + 59 * 60_000, timeZone).slice(0, 13)}:00`
}

export const defaultPost = (): PostConfig => ({ requirements: { soldier: 1 }, activeWindow: null })

export function defaultSettings(nowMs: number): ActivitySettings {
  const timeZone = deviceTimeZone()
  const start = nextFullHour(nowMs, timeZone)
  return {
    start,
    end: addWallHours(start, 24),
    durationHours: 24,
    timeZone,
    shiftMinutes: 120,
    restMinutes: 240,
    split: null,
    posts: [defaultPost()],
  }
}
