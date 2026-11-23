import { describe, expect, it } from 'vitest'
import { minCostMaxMatching, type MatchingEdge } from './matching'

/** Seeded PRNG for test-data generation only (the solver itself never uses randomness). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Exhaustive search: best (size desc, cost asc) over all matchings. */
function bruteForce(nLeft: number, edges: MatchingEdge[]): { size: number; cost: number } {
  const byLeft: MatchingEdge[][] = Array.from({ length: nLeft }, () => [])
  for (const e of edges) byLeft[e.left].push(e)
  let best = { size: 0, cost: 0 }
  const usedRight = new Set<number>()
  const rec = (l: number, size: number, cost: number) => {
    if (l === nLeft) {
      if (size > best.size || (size === best.size && cost < best.cost)) best = { size, cost }
      return
    }
    rec(l + 1, size, cost)
    for (const e of byLeft[l]) {
      if (usedRight.has(e.right)) continue
      usedRight.add(e.right)
      rec(l + 1, size + 1, cost + e.cost)
      usedRight.delete(e.right)
    }
  }
  rec(0, 0, 0)
  return best
}

function checkValid(nLeft: number, edges: MatchingEdge[], matchOfLeft: number[]) {
  const seen = new Set<number>()
  for (let l = 0; l < nLeft; l++) {
    const r = matchOfLeft[l]
    if (r === -1) continue
    expect(edges.some((e) => e.left === l && e.right === r)).toBe(true)
    expect(seen.has(r)).toBe(false)
    seen.add(r)
  }
}

describe('minCostMaxMatching', () => {
  it('handles empty graphs', () => {
    expect(minCostMaxMatching(0, 0, [])).toEqual({ size: 0, cost: 0, matchOfLeft: [] })
    expect(minCostMaxMatching(2, 3, [])).toEqual({ size: 0, cost: 0, matchOfLeft: [-1, -1] })
  })

  it('prefers maximum size over lower cost', () => {
    // Left 0 can use right 0 (cost 0) or right 1 (cost 100); left 1 can only use right 0.
    const edges = [
      { left: 0, right: 0, cost: 0 },
      { left: 0, right: 1, cost: 100 },
      { left: 1, right: 0, cost: 0 },
    ]
    const r = minCostMaxMatching(2, 2, edges)
    expect(r.size).toBe(2)
    expect(r.cost).toBe(100)
    expect(r.matchOfLeft).toEqual([1, 0])
  })

  it('finds the minimum-cost perfect matching (needs re-routing)', () => {
    const edges = [
      { left: 0, right: 0, cost: 1 },
      { left: 0, right: 1, cost: 2 },
      { left: 1, right: 0, cost: 1 },
      { left: 1, right: 1, cost: 10 },
    ]
    const r = minCostMaxMatching(2, 2, edges)
    expect(r.size).toBe(2)
    expect(r.cost).toBe(3)
    expect(r.matchOfLeft).toEqual([1, 0])
  })

  it('rejects negative or fractional costs', () => {
    expect(() => minCostMaxMatching(1, 1, [{ left: 0, right: 0, cost: -1 }])).toThrow()
    expect(() => minCostMaxMatching(1, 1, [{ left: 0, right: 0, cost: 0.5 }])).toThrow()
  })

  it('matches brute force on random small graphs', () => {
    const rand = mulberry32(12345)
    for (let trial = 0; trial < 400; trial++) {
      const nLeft = 1 + Math.floor(rand() * 6)
      const nRight = 1 + Math.floor(rand() * 6)
      const edges: MatchingEdge[] = []
      for (let l = 0; l < nLeft; l++) {
        for (let r = 0; r < nRight; r++) {
          if (rand() < 0.5) edges.push({ left: l, right: r, cost: Math.floor(rand() * 20) })
        }
      }
      const got = minCostMaxMatching(nLeft, nRight, edges)
      const want = bruteForce(nLeft, edges)
      expect({ size: got.size, cost: got.cost }).toEqual(want)
      checkValid(nLeft, edges, got.matchOfLeft)
    }
  })

  it('is deterministic', () => {
    const rand = mulberry32(7)
    const edges: MatchingEdge[] = []
    for (let l = 0; l < 8; l++) {
      for (let r = 0; r < 8; r++) edges.push({ left: l, right: r, cost: Math.floor(rand() * 3) })
    }
    const a = minCostMaxMatching(8, 8, edges)
    const b = minCostMaxMatching(8, 8, edges)
    expect(a).toEqual(b)
  })
})
