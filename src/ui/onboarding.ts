/**
 * First-use explanations: a welcome tour on the very first open, and a short tip the first
 * time each screen is shown. What was seen is kept on the device (kv 'seenTips').
 */
import { useEffect, useState } from 'react'
import { getKv, putKv } from '../storage/db'

export type TipId = 'welcome' | 'platoon' | 'activity' | 'board'

const KEY = 'seenTips'
let seen: Set<TipId> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

async function load(): Promise<Set<TipId>> {
  if (seen) return seen
  try {
    seen = new Set((await getKv<TipId[]>(KEY)) ?? [])
  } catch {
    seen = new Set()
  }
  notify()
  return seen
}

export async function markSeen(id: TipId): Promise<void> {
  const s = await load()
  if (s.has(id)) return
  s.add(id)
  notify()
  await putKv(KEY, [...s])
}

/** Show every explanation again (from the help button). */
export async function resetTips(): Promise<void> {
  seen = new Set()
  notify()
  await putKv(KEY, [])
}

/** True when the tip should show; false while loading, so nothing flashes on returning users. */
export function useTip(id: TipId): boolean {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    void load()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return seen !== null && !seen.has(id)
}

/** iPhone/iPad Safari that is not running as an installed app. */
export function needsIosInstall(): boolean {
  if (typeof navigator === 'undefined') return false
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  return ios && !standalone
}
