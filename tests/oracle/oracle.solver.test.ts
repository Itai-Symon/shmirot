/**
 * Layer C — the solver against the brute-force oracle (ALGORITHM.md §8).
 *
 *  - coverage must equal the oracle's maximum, always;
 *  - min-rest gap (oracle best − achieved) and load-spread gap (achieved − oracle best) are
 *    recorded over a fixed, seeded set of instances; the suite fails if the distribution is
 *    worse than the committed baseline tests/oracle/baseline.json.
 *
 * The baseline is created in session 2 from the first real run:
 *   UPDATE_ORACLE_BASELINE=1 npx vitest run tests/oracle
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SolverInput } from '../../src/solver/types'
import { runAndVerify } from '../helpers/solve'
import { smallInstanceArb } from './instances'
import { bruteForce, measure } from './oracle'

const SEED = 3001
const INSTANCES = 100
const BASELINE = fileURLToPath(new URL('./baseline.json', import.meta.url))

export interface GapStats {
  /** Share of instances where the solver matches the oracle exactly. */
  zeroGapShare: number
  meanGap: number
  maxGap: number
}

export interface OracleSummary {
  seed: number
  instances: number
  rest: GapStats
  spread: GapStats
  /** Instances where a pair-free schedule existed but the solver made someone guard twice. */
  restPairsForced: number
}

function gapStats(gaps: number[]): GapStats {
  if (gaps.length === 0) return { zeroGapShare: 1, meanGap: 0, maxGap: 0 }
  const zero = gaps.filter((g) => g <= 1e-9).length
  return {
    zeroGapShare: zero / gaps.length,
    meanGap: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    maxGap: Math.max(...gaps),
  }
}

const instances: SolverInput[] = fc.sample(smallInstanceArb(), { seed: SEED, numRuns: INSTANCES })

describe('Layer C — solver vs. brute-force oracle', () => {
  it('coverage equals the oracle on every instance; gaps no worse than baseline', () => {
    const restGaps: number[] = []
    const spreadGaps: number[] = []
    let restPairsForced = 0

    instances.forEach((input, i) => {
      const oracle = bruteForce(input)
      const out = runAndVerify(input)
      const got = measure(input, out.assignments)

      expect(got.coverage, `instance ${i}: coverage`).toBe(oracle.maxCoverage)

      // The oracle optimises over every max-coverage schedule, so the solver can never beat it.
      if (oracle.bestMinRest === Infinity) {
        if (got.minRest !== Infinity) restPairsForced++
      } else {
        expect(got.minRest, `instance ${i}: solver beat the oracle on rest — oracle bug`).toBeLessThanOrEqual(oracle.bestMinRest)
        restGaps.push(oracle.bestMinRest - got.minRest)
      }
      expect(got.loadSpread, `instance ${i}: solver beat the oracle on spread — oracle bug`).toBeGreaterThanOrEqual(oracle.bestLoadSpread - 1e-9)
      spreadGaps.push(got.loadSpread - oracle.bestLoadSpread)
    })

    const summary: OracleSummary = {
      seed: SEED,
      instances: instances.length,
      rest: gapStats(restGaps),
      spread: gapStats(spreadGaps),
      restPairsForced,
    }

    if (process.env.UPDATE_ORACLE_BASELINE) {
      writeFileSync(BASELINE, JSON.stringify(summary, null, 2) + '\n')
      return
    }
    if (!existsSync(BASELINE)) return // created in session 2
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as OracleSummary
    expect(summary.seed).toBe(base.seed)
    expect(summary.instances).toBe(base.instances)
    for (const k of ['rest', 'spread'] as const) {
      expect(summary[k].zeroGapShare, `${k}: share of exact matches`).toBeGreaterThanOrEqual(base[k].zeroGapShare - 1e-9)
      expect(summary[k].meanGap, `${k}: mean gap`).toBeLessThanOrEqual(base[k].meanGap + 1e-9)
      expect(summary[k].maxGap, `${k}: max gap`).toBeLessThanOrEqual(base[k].maxGap + 1e-9)
    }
    expect(summary.restPairsForced).toBeLessThanOrEqual(base.restPairsForced)
  })
})
