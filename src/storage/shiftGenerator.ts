/**
 * Shift generator: the only place that knows about wall clocks, dates and DST.
 *
 * It turns an activity described in wall-clock terms (local date/time strings and an
 * IANA time zone) into solver `Shift`s whose times are integer minutes of real elapsed
 * time since the activity start, and precomputes `nightMinutes` (00:00–06:00 wall clock).
 *
 * Wall-clock arithmetic is done on "naive minutes": minutes since 1970-01-01 00:00 of a
 * clock that never changes offset. Naive times are converted to real instants per zone:
 *  - a time that does not exist (spring-forward gap) maps to the transition instant,
 *  - an ambiguous time (fall-back overlap) maps to its earlier occurrence.
 * Both rules keep the mapping monotone, so consecutive shifts stay contiguous: no hour
 * is ever missing or covered twice, and zero-length shifts are dropped.
 */
import type { Minutes, Role, Shift } from '../solver/types'

const MIN_MS = 60_000
const DAY_MIN = 24 * 60

/** Wall-clock hours of the night window used for `nightMinutes` (ALGORITHM.md D2). */
export const NIGHT_START_HOUR = 0
export const NIGHT_END_HOUR = 6

export interface HourWindow {
  /** 0–23. If fromHour > toHour the window wraps midnight. Equal ⇒ all day. */
  fromHour: number
  toHour: number
}

export interface PostConfig {
  /** Optional user-given name (UI only; the solver sees postIndex). */
  name?: string
  /** Difficulty multiplier (default 1). Becomes Shift.weightFactor. */
  weight?: number
  requirements: Partial<Record<Role, number>>
  /** Post staffed only inside this wall-clock window; null ⇒ around the clock. */
  activeWindow: HourWindow | null
}

export interface SplitConfig extends HourWindow {
  /** Shift length used while inside the night window [fromHour, toHour). */
  nightShiftMinutes: Minutes
}

export interface ActivityConfig {
  /** Local wall-clock 'YYYY-MM-DDTHH:mm'. */
  start: string
  end: string
  timeZone: string
  shiftMinutes: Minutes
  /** Optional different shift length at night. */
  split: SplitConfig | null
  posts: PostConfig[]
}

export interface GeneratedActivity {
  /** Real instant of minute 0. */
  startEpochMs: number
  /** Real length of the activity in minutes. */
  endMinute: Minutes
  shifts: Shift[]
}

// ---------------------------------------------------------------------------
// Time-zone primitives
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Naive (wall-clock) minutes of a real instant in a zone. */
export function epochToNaive(epochMs: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(epochMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const hour = get('hour') % 24
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute')) / MIN_MS
}

/** UTC offset in minutes at a real instant (instant truncated to the minute). */
function offsetAt(epochMs: number, timeZone: string): number {
  const ms = Math.floor(epochMs / MIN_MS) * MIN_MS
  return epochToNaive(ms, timeZone) - ms / MIN_MS
}

/** Real instant of a naive wall-clock minute (see module doc for gap/overlap rules). */
export function naiveToEpoch(naive: number, timeZone: string): number {
  const before = offsetAt((naive - DAY_MIN) * MIN_MS, timeZone)
  const after = offsetAt((naive + DAY_MIN) * MIN_MS, timeZone)
  const valid = [...new Set([before, after])]
    .map((off) => naive - off)
    .filter((m) => offsetAt(m * MIN_MS, timeZone) === naive - m)
  if (valid.length > 0) return Math.min(...valid) * MIN_MS

  // Gap: find the transition instant, the first minute whose offset is `after`.
  let lo = naive - Math.max(before, after) // offset `before` still applies here or earlier
  let hi = naive - Math.min(before, after)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (offsetAt(mid * MIN_MS, timeZone) === before) lo = mid
    else hi = mid
  }
  return hi * MIN_MS
}

/** 'YYYY-MM-DDTHH:mm' → naive minutes. Throws on malformed input. */
export function parseWall(wall: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall)
  if (!m) throw new Error(`bad wall-clock time: ${wall}`)
  const [, y, mo, d, h, mi] = m.map(Number)
  return Date.UTC(y, mo - 1, d, h, mi) / MIN_MS
}

/** naive minutes → 'YYYY-MM-DDTHH:mm'. */
export function formatWall(naive: number): string {
  return new Date(naive * MIN_MS).toISOString().slice(0, 16)
}

export function wallToEpoch(wall: string, timeZone: string): number {
  return naiveToEpoch(parseWall(wall), timeZone)
}

export function epochToWall(epochMs: number, timeZone: string): string {
  return formatWall(epochToNaive(epochMs, timeZone))
}

/** Add whole hours of wall-clock time to a 'YYYY-MM-DDTHH:mm' string. */
export function addWallHours(wall: string, hours: number): string {
  return formatWall(parseWall(wall) + hours * 60)
}

// ---------------------------------------------------------------------------
// Night minutes
// ---------------------------------------------------------------------------

/** Real minutes of [startMs, endMs) that fall inside 00:00–06:00 wall clock. */
export function nightMinutes(startMs: number, endMs: number, timeZone: string): Minutes {
  if (endMs <= startMs) return 0
  const firstDay = Math.floor(epochToNaive(startMs, timeZone) / DAY_MIN) - 1
  const lastDay = Math.floor(epochToNaive(endMs, timeZone) / DAY_MIN) + 1
  let total = 0
  for (let day = firstDay; day <= lastDay; day++) {
    const ws = naiveToEpoch(day * DAY_MIN + NIGHT_START_HOUR * 60, timeZone)
    const we = naiveToEpoch(day * DAY_MIN + NIGHT_END_HOUR * 60, timeZone)
    const overlap = Math.min(endMs, we) - Math.max(startMs, ws)
    if (overlap > 0) total += overlap
  }
  return Math.round(total / MIN_MS)
}

// ---------------------------------------------------------------------------
// Shift generation
// ---------------------------------------------------------------------------

function inWindow(minuteOfDay: number, w: HourWindow): boolean {
  const from = w.fromHour * 60
  const to = w.toHour * 60
  if (from === to) return true
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to
}

/** Next naive minute strictly after t whose minute-of-day is one of the window edges. */
function nextEdge(t: number, w: HourWindow): number {
  const dayStart = Math.floor(t / DAY_MIN) * DAY_MIN
  let best = Infinity
  for (const h of [w.fromHour, w.toHour]) {
    let c = dayStart + h * 60
    if (c <= t) c += DAY_MIN
    best = Math.min(best, c)
  }
  return best
}

const mod = (a: number, n: number) => ((a % n) + n) % n

export function generateShifts(cfg: ActivityConfig): GeneratedActivity {
  const tz = cfg.timeZone
  const startN = parseWall(cfg.start)
  const endN = parseWall(cfg.end)
  const startEpochMs = naiveToEpoch(startN, tz)
  const toMinute = (ms: number) => Math.round((ms - startEpochMs) / MIN_MS)
  if (endN <= startN) return { startEpochMs, endMinute: 0, shifts: [] }
  const endEpochMs = naiveToEpoch(endN, tz)

  const shifts: Shift[] = []
  cfg.posts.forEach((post, postIndex) => {
    let t = startN
    while (t < endN) {
      const mday = mod(t, DAY_MIN)
      const night = cfg.split !== null && inWindow(mday, cfg.split)
      const len = Math.max(1, night ? cfg.split!.nightShiftMinutes : cfg.shiftMinutes)
      let next = Math.min(t + len, endN)
      if (cfg.split && cfg.split.fromHour !== cfg.split.toHour) next = Math.min(next, nextEdge(t, cfg.split))
      const w = post.activeWindow
      if (w && w.fromHour !== w.toHour) next = Math.min(next, nextEdge(t, w))

      if (!w || inWindow(mday, w)) {
        const sMs = naiveToEpoch(t, tz)
        const eMs = naiveToEpoch(next, tz)
        if (eMs > sMs) {
          const start = toMinute(sMs)
          shifts.push({
            id: `p${postIndex}-${start}`,
            postIndex,
            start,
            end: toMinute(eMs),
            nightMinutes: nightMinutes(sMs, eMs, tz),
            ...(post.weight !== undefined && post.weight !== 1 && post.weight > 0 && { weightFactor: post.weight }),
            requirements: { ...post.requirements },
          })
        }
      }
      t = next
    }
  })

  shifts.sort((a, b) => a.start - b.start || a.postIndex - b.postIndex)
  return { startEpochMs, endMinute: toMinute(endEpochMs), shifts }
}

/** Wall-clock label pieces for minute `m` of an activity. */
export function wallAt(startEpochMs: number, m: Minutes, timeZone: string) {
  const naive = epochToNaive(startEpochMs + m * MIN_MS, timeZone)
  const d = new Date(naive * MIN_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    date: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
    weekday: d.getUTCDay(),
    dayKey: Math.floor(naive / DAY_MIN),
  }
}
