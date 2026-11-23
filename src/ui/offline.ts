/**
 * Offline readiness: registers the service worker as early as possible and reports whether
 * this app (in this browser / home-screen container) can open without network.
 */
import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export type OfflineStatus = 'ready' | 'preparing' | 'unsupported'

let status: OfflineStatus = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? 'preparing' : 'unsupported'
const listeners = new Set<(s: OfflineStatus) => void>()
const set = (s: OfflineStatus) => {
  status = s
  listeners.forEach((l) => l(s))
}

export function startOffline(): void {
  if (status === 'unsupported') return
  if (navigator.serviceWorker.controller) set('ready')
  navigator.serviceWorker.addEventListener('controllerchange', () => set('ready'))
  registerSW({
    immediate: true,
    onOfflineReady: () => set('ready'),
    onRegisteredSW: (_url, reg) => {
      if (reg?.active && navigator.serviceWorker.controller) set('ready')
    },
  })
}

export function useOfflineStatus(): OfflineStatus {
  const [s, setS] = useState(status)
  useEffect(() => {
    listeners.add(setS)
    setS(status)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}
