/**
 * Maximum-cardinality bipartite matching (Kuhn's augmenting paths).
 *
 * Written independently of the solver: the verifier only needs the *size* of a maximum
 * matching (Hall / König), never a cost-optimal one, so the simplest correct algorithm is
 * the right choice here. O(V · E), instances are tiny.
 */
export interface MatchingResult {
  size: number
  /** matchOfLeft[l] = right index matched to l, or -1. */
  matchOfLeft: number[]
}

/** @param adj adj[l] = right indices that left node l may be matched to. */
export function maxBipartiteMatching(adj: readonly (readonly number[])[], rightCount: number): MatchingResult {
  const matchOfRight = new Array<number>(rightCount).fill(-1)
  const matchOfLeft = new Array<number>(adj.length).fill(-1)
  let size = 0

  for (let l = 0; l < adj.length; l++) {
    const seen = new Uint8Array(rightCount)
    if (augment(l, adj, matchOfRight, matchOfLeft, seen)) size++
  }
  return { size, matchOfLeft }
}

function augment(
  l: number,
  adj: readonly (readonly number[])[],
  matchOfRight: number[],
  matchOfLeft: number[],
  seen: Uint8Array,
): boolean {
  for (const r of adj[l]) {
    if (seen[r]) continue
    seen[r] = 1
    if (matchOfRight[r] === -1 || augment(matchOfRight[r], adj, matchOfRight, matchOfLeft, seen)) {
      matchOfRight[r] = l
      matchOfLeft[l] = r
      return true
    }
  }
  return false
}
