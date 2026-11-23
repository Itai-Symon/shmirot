/// <reference lib="webworker" />
/**
 * Runs the solver off the main thread. Message in: { id, input }. Message out:
 * { id, output } or { id, error }.
 */
import { solve } from './solve'
import type { SolverInput, SolverOutput } from './types'

export interface SolveRequest {
  id: number
  input: SolverInput
}
export type SolveResponse = { id: number; output: SolverOutput } | { id: number; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, input } = e.data
  try {
    ctx.postMessage({ id, output: solve(input) } satisfies SolveResponse)
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies SolveResponse)
  }
}
