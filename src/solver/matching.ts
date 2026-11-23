/**
 * Min-cost maximum bipartite matching by successive shortest paths
 * (Dijkstra with Johnson potentials). ALGORITHM.md §4.4 c, §7.
 *
 * The result is a matching of maximum size and, among those, minimum total cost.
 * Costs must be non-negative integers so that all arithmetic is exact.
 * Deterministic: no randomness; ties inside Dijkstra are broken by vertex index.
 */

export interface MatchingEdge {
  left: number
  right: number
  cost: number
}

export interface MatchingResult {
  /** Number of matched pairs (maximum possible). */
  size: number
  /** Total cost of the matched edges (minimum among maximum matchings). */
  cost: number
  /** For each left vertex, the matched right vertex, or -1. */
  matchOfLeft: number[]
}

export function minCostMaxMatching(
  nLeft: number,
  nRight: number,
  edges: readonly MatchingEdge[],
): MatchingResult {
  const source = 0
  const sink = nLeft + nRight + 1
  const nVertices = sink + 1

  const to: number[] = []
  const cap: number[] = []
  const arcCost: number[] = []
  const nextArc: number[] = []
  const head: number[] = new Array<number>(nVertices).fill(-1)

  const addArc = (u: number, v: number, c: number): number => {
    const idx = to.length
    to.push(v, u)
    cap.push(1, 0)
    arcCost.push(c, -c)
    nextArc.push(head[u], head[v])
    head[u] = idx
    head[v] = idx + 1
    return idx
  }

  for (let l = 0; l < nLeft; l++) addArc(source, 1 + l, 0)
  const edgeArc: number[] = []
  for (const e of edges) {
    if (e.left < 0 || e.left >= nLeft || e.right < 0 || e.right >= nRight) {
      throw new RangeError(`edge out of range: ${e.left} -> ${e.right}`)
    }
    if (!Number.isInteger(e.cost) || e.cost < 0) {
      throw new RangeError(`edge cost must be a non-negative integer, got ${e.cost}`)
    }
    edgeArc.push(addArc(1 + e.left, 1 + nLeft + e.right, e.cost))
  }
  for (let r = 0; r < nRight; r++) addArc(1 + nLeft + r, sink, 0)

  const potential = new Array<number>(nVertices).fill(0)
  const dist = new Array<number>(nVertices)
  const prevArc = new Array<number>(nVertices)
  const done = new Array<boolean>(nVertices)
  let size = 0

  for (;;) {
    dist.fill(Infinity)
    prevArc.fill(-1)
    done.fill(false)
    dist[source] = 0
    // Dense Dijkstra: the graphs are tiny (tens of vertices).
    for (;;) {
      let u = -1
      for (let v = 0; v < nVertices; v++) {
        if (!done[v] && dist[v] !== Infinity && (u === -1 || dist[v] < dist[u])) u = v
      }
      if (u === -1) break
      done[u] = true
      for (let a = head[u]; a !== -1; a = nextArc[a]) {
        if (cap[a] === 0) continue
        const v = to[a]
        const nd = dist[u] + arcCost[a] + potential[u] - potential[v]
        if (nd < dist[v]) {
          dist[v] = nd
          prevArc[v] = a
        }
      }
    }
    if (dist[sink] === Infinity) break
    for (let v = 0; v < nVertices; v++) if (dist[v] !== Infinity) potential[v] += dist[v]
    for (let v = sink; v !== source; v = to[prevArc[v] ^ 1]) {
      const a = prevArc[v]
      cap[a] -= 1
      cap[a ^ 1] += 1
    }
    size++
  }

  const matchOfLeft = new Array<number>(nLeft).fill(-1)
  let cost = 0
  edges.forEach((e, k) => {
    if (cap[edgeArc[k]] === 0) {
      matchOfLeft[e.left] = e.right
      cost += e.cost
    }
  })
  return { size, cost, matchOfLeft }
}
