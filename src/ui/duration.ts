/** Durations typed by people: "2:30", "2.5", "2,5", "150" (minutes if > 24), "2" (hours). */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (!s) return null
  const hm = /^(\d{1,2}):(\d{1,2})$/.exec(s)
  if (hm) {
    const m = Number(hm[2])
    return m < 60 ? Number(hm[1]) * 60 + m : null
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return n > 24 ? Math.round(n) : Math.round(n * 60)
}

/** Minutes as H:MM. */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Clamp and snap to `step` minutes. */
export function snap(minutes: number, step: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(minutes / step) * step))
}
