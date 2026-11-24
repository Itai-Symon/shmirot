/**
 * First-use explanations: a welcome tour on the very first open, and a short tip the first
 * time each screen is shown. What was seen is kept on the device (kv 'seenTips').
 */
import { useEffect, useState } from 'react'
import { getKv, putKv } from '../storage/db'

export type TipId = 'welcome'

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

/** Running as an installed home-screen app. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}
