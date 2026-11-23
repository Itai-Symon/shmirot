/**
 * The one place tests touch the solver. Only the public entry point is used, through the
 * `Solve` contract in types.ts — tests never look at solver internals.
 *
 * Every test that runs solve() goes through runAndVerify(): it runs the solver twice
 * (determinism, §3), checks the input was not mutated, and passes the output through the
 * independent verifier (§8 Layer A).
 */
import { expect } from 'vitest'
import * as solverModule from '../../src/solver/index'
import type { Solve, SolverInput, SolverOutput } from '../../src/solver/types'
import { verify } from '../../src/verifier/index'

export const solve: Solve = (input) => {
  const fn = (solverModule as unknown as { solve?: unknown }).solve
  if (typeof fn !== 'function') throw new Error('src/solver/index.ts does not export solve()')
  return (fn as Solve)(input)
}

export function runAndVerify(input: SolverInput): SolverOutput {
  const snapshot = JSON.stringify(input)
  const first = solve(structuredClone(input))
  const own = structuredClone(input)
  const second = solve(own)
  expect(JSON.stringify(own), 'solve() must not mutate its input').toBe(snapshot)
  expect(JSON.stringify(second), 'solve() must be deterministic (byte-identical output)').toBe(JSON.stringify(first))
  expect(verify(input, first)).toEqual([])
  return first
}
