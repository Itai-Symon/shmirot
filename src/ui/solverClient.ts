/**
 * The app's solver: the real solve() in a Web Worker, so the UI never freezes.
 * Falls back to running on the main thread if workers are unavailable.
 */
import { solve } from '../solver'
import type { SolverInput, SolverOutput } from '../solver/types'
import type { SolveRequest, SolveResponse } from '../solver/worker'
import type { SolveAsync } from './planner'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (o: SolverOutput) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if ('error' in e.data) p.reject(new Error(e.data.error))
    else p.resolve(e.data.output)
  }
  worker.onerror = (e) => {
    // A broken worker fails every request in flight; the next call starts a fresh one.
    for (const p of pending.values()) p.reject(new Error(e.message || 'solver worker failed'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export const solveInWorker: SolveAsync = (input: SolverInput) => {
  const w = getWorker()
  if (!w) return Promise.resolve().then(() => solve(input))
  const id = nextId++
  return new Promise<SolverOutput>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, input } satisfies SolveRequest)
  })
}
