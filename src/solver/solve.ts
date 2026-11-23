/**
 * The scheduler — ALGORITHM.md §4. Pure and deterministic: no randomness, no clock,
 * no dependence on object/set iteration order or on the order of soldiers in the input.
 */

import { buildCertificate, type CertificateShift } from './certificate'
import { minCostMaxMatching, type MatchingEdge } from './matching'
import {
  ROLES,
  type Assignment,
  type Role,
  type Shift,
  type Shortage,
  type Soldier,
  type SoldierStats,
  type SolverInput,
  type SolverOutput,
  type Warning,
} from './types'

const ROLE_INDEX: ReadonlyMap<Role, number> = new Map(ROLES.map((r, i) => [r, i]))

/** Ids are compared by UTF-16 code units (never locale-dependent). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** (start, postIndex, id) — ALGORITHM.md §4.4 step 1. */
export function compareShifts(a: Shift, b: Shift): number {
  return compareNumbers(a.start, b.start) || compareNumbers(a.postIndex, b.postIndex) || compareIds(a.id, b.id)
}

/** weight(j) = dayMinutes + α × nightMinutes. */
export function shiftWeight(shift: Shift, nightWeight: number): number {
  return shift.end - shift.start - shift.nightMinutes + nightWeight * shift.nightMinutes
}

function isAbsent(soldier: Soldier, start: number, end: number): boolean {
  return soldier.absences.some((a) => a.start < end && start < a.end)
}

function overlaps(a: Shift, b: Shift): boolean {
  return a.start < b.end && b.start < a.end
}

function requiredCount(shift: Shift, role: Role): number {
  const n = shift.requirements[role] ?? 0
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

/** Ranking key of a candidate — ALGORITHM.md §4.4 b. */
export interface CandidateKey {
  tier: 0 | 1
  deviation: number
  rest: number
  nextAbsenceStart: number
  id: string
}

export function compareCandidateKeys(a: CandidateKey, b: CandidateKey): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  const byRest = compareNumbers(-a.rest, -b.rest)
  const byDeviation = compareNumbers(a.deviation, b.deviation)
  const first = a.tier === 0 ? byDeviation || byRest : byRest || byDeviation
  return first || compareNumbers(a.nextAbsenceStart, b.nextAbsenceStart) || compareIds(a.id, b.id)
}

interface Slot {
  /** Position of the shift in sorted order. */
  pos: number
  role: Role
  inGroup: boolean
}

interface Placed {
  pos: number
  soldier: number
  role: Role
  restDebt: number
  locked: boolean
}

export function solve(input: SolverInput): SolverOutput {
  const { soldiers, params } = input
  const R = params.minRestMinutes
  const alpha = params.nightWeight
  const nSoldiers = soldiers.length

  // ---- Step 1: sort shifts. -------------------------------------------------------------
  const shifts = [...input.shifts].sort(compareShifts)
  const posOfShift = new Map<string, number>()
  shifts.forEach((s, p) => {
    if (!posOfShift.has(s.id)) posOfShift.set(s.id, p)
  })
  const soldierOfId = new Map<string, number>()
  soldiers.forEach((s, i) => {
    if (!soldierOfId.has(s.id)) soldierOfId.set(s.id, i)
  })
  const weight = shifts.map((s) => shiftWeight(s, alpha))
  const qualified = soldiers.map((s) => new Set<Role>(s.roles))

  // ---- Locks: validated, de-duplicated, grouped by shift (applied interleaved, §4.4 step 2).
  const locksByPos: { soldier: number; role: Role }[][] = shifts.map(() => [])
  const lockedPairs = new Set<string>()
  const pinnedPositions: number[][] = soldiers.map(() => [])
  {
    const seen = new Set<string>()
    for (const lock of input.locked) {
      const pos = posOfShift.get(lock.shiftId)
      const soldier = soldierOfId.get(lock.soldierId)
      if (pos === undefined || soldier === undefined || !ROLE_INDEX.has(lock.role)) continue
      const key = `${pos}|${soldier}`
      if (seen.has(key)) continue // a soldier holds at most one seat per shift
      seen.add(key)
      locksByPos[pos].push({ soldier, role: lock.role })
      lockedPairs.add(`${pos}|${soldier}|${lock.role}`)
      pinnedPositions[soldier].push(pos)
    }
    for (const list of locksByPos) {
      list.sort(
        (a, b) =>
          ROLE_INDEX.get(a.role)! - ROLE_INDEX.get(b.role)! || compareIds(soldiers[a.soldier].id, soldiers[b.soldier].id),
      )
    }
    for (const list of pinnedPositions) list.sort((a, b) => a - b)
  }
  const lockedOfRole = (pos: number, role: Role) => locksByPos[pos].filter((l) => l.role === role).length

  // ---- State (§4.2). ---------------------------------------------------------------------
  const load = new Array<number>(nSoldiers).fill(0)
  const fairShare = new Array<number>(nSoldiers).fill(0)
  const lastEnd = new Array<number>(nSoldiers).fill(-Infinity)
  const busyUntil = new Array<number>(nSoldiers).fill(-Infinity)
  const processed = new Array<boolean>(shifts.length).fill(false)

  const placed: Placed[] = []
  const shortages: Shortage[] = []

  const commit = (pos: number, soldier: number, role: Role, locked: boolean) => {
    const shift = shifts[pos]
    const restDebt = lastEnd[soldier] === -Infinity ? 0 : Math.max(0, R - (shift.start - lastEnd[soldier]))
    load[soldier] += weight[pos]
    lastEnd[soldier] = shift.end
    busyUntil[soldier] = shift.end
    placed.push({ pos, soldier, role, restDebt, locked })
  }

  /** A soldier pinned to a not-yet-processed shift is kept free for it. */
  const pinConflict = (soldier: number, pos: number) =>
    pinnedPositions[soldier].some((q) => !processed[q] && (q === pos || overlaps(shifts[q], shifts[pos])))

  const available = (soldier: number, pos: number) => {
    const shift = shifts[pos]
    return (
      !isAbsent(soldiers[soldier], shift.start, shift.end) &&
      busyUntil[soldier] <= shift.start &&
      !pinConflict(soldier, pos)
    )
  }

  const nextAbsenceStart = (soldier: number, t: number) => {
    let best = Infinity
    for (const a of soldiers[soldier].absences) if (a.start >= t && a.start < best) best = a.start
    return best
  }

  // ---- Step 3: groups of identical start time. -----------------------------------------
  let a = 0
  while (a < shifts.length) {
    const t = shifts[a].start
    let b = a
    while (b < shifts.length && shifts[b].start === t) b++
    const group: number[] = []
    for (let p = a; p < b; p++) group.push(p)

    // Locked seats of this group first, in shift order.
    for (const p of group) for (const l of locksByPos[p]) commit(p, l.soldier, l.role, true)
    for (const p of group) processed[p] = true

    // Slots: open seats of G, then lookahead seats of later shifts overlapping G.
    const slots: Slot[] = []
    for (const p of group) {
      for (const role of ROLES) {
        const open = requiredCount(shifts[p], role) - lockedOfRole(p, role)
        for (let k = 0; k < open; k++) slots.push({ pos: p, role, inGroup: true })
      }
    }
    const nGroupSlots = slots.length
    const maxEnd = Math.max(...group.map((p) => shifts[p].end))
    for (let q = b; q < shifts.length && shifts[q].start < maxEnd; q++) {
      for (const role of ROLES) {
        const open = requiredCount(shifts[q], role) - lockedOfRole(q, role)
        for (let k = 0; k < open; k++) slots.push({ pos: q, role, inGroup: false })
      }
    }

    const chosen: (number | null)[] = new Array<number | null>(nGroupSlots).fill(null)
    if (nGroupSlots > 0) {
      const eligible = (soldier: number, slot: Slot) =>
        qualified[soldier].has(slot.role) && available(soldier, slot.pos)

      // Rank candidates of G (§4.4 b). All shifts of G start at t, so the key is per soldier.
      const candidates: { soldier: number; key: CandidateKey }[] = []
      for (let i = 0; i < nSoldiers; i++) {
        if (!slots.some((s, k) => k < nGroupSlots && eligible(i, s))) continue
        const rest = t - lastEnd[i]
        candidates.push({
          soldier: i,
          key: {
            tier: rest >= R ? 0 : 1,
            deviation: load[i] - fairShare[i],
            rest,
            nextAbsenceStart: nextAbsenceStart(i, t),
            id: soldiers[i].id,
          },
        })
      }
      candidates.sort((x, y) => compareCandidateKeys(x.key, y.key))
      const rank = new Array<number>(nSoldiers).fill(-1)
      candidates.forEach((c, r) => (rank[c.soldier] = r))

      // Lookahead seats cost BIG: among maximum matchings, fill as many seats of G as possible,
      // then minimise the rank sum of G (lexicographic objective, §4.4 c).
      const BIG = nGroupSlots * candidates.length + 1
      const allEdges: MatchingEdge[] = []
      slots.forEach((slot, k) => {
        for (let i = 0; i < nSoldiers; i++) {
          if (!eligible(i, slot)) continue
          allEdges.push({ left: k, right: i, cost: slot.inGroup ? rank[i] : BIG })
        }
      })

      const removedSlot = new Array<boolean>(slots.length).fill(false)
      const removedSoldier = new Array<boolean>(nSoldiers).fill(false)
      const barredFromGroup = new Array<boolean>(nSoldiers).fill(false)
      const residual = () =>
        minCostMaxMatching(
          slots.length,
          nSoldiers,
          allEdges.filter(
            (e) =>
              !removedSlot[e.left] &&
              !removedSoldier[e.right] &&
              !(e.left < nGroupSlots && barredFromGroup[e.right]),
          ),
        )

      const best = residual()
      let groupFilled = 0
      for (let k = 0; k < nGroupSlots; k++) if (best.matchOfLeft[k] !== -1) groupFilled++

      // Tie-break among optimal matchings (§4.4 c): soldiers in rank order; each takes the
      // earliest seat of G (shift order, then ROLES order) that keeps the optimum reachable.
      let fixedSize = 0
      let fixedCost = 0
      for (const { soldier } of candidates) {
        if (fixedSize === groupFilled) break
        const tried = new Set<string>()
        let placedHere = false
        for (let k = 0; k < nGroupSlots; k++) {
          const slot = slots[k]
          if (removedSlot[k] || !eligible(soldier, slot)) continue
          const cls = `${slot.pos}|${slot.role}`
          if (tried.has(cls)) continue
          tried.add(cls)
          removedSlot[k] = true
          removedSoldier[soldier] = true
          const r = residual()
          if (r.size + fixedSize + 1 === best.size && r.cost + fixedCost + rank[soldier] === best.cost) {
            chosen[k] = soldier
            fixedSize++
            fixedCost += rank[soldier]
            placedHere = true
            break
          }
          removedSlot[k] = false
          removedSoldier[soldier] = false
        }
        if (!placedHere) barredFromGroup[soldier] = true
      }
    }

    // Shortages (step d) and commits (step e).
    for (const p of group) {
      for (const role of ROLES) {
        const filled = lockedOfRole(p, role) + slots.filter((s, k) => k < nGroupSlots && s.pos === p && s.role === role && chosen[k] !== null).length
        const missing = requiredCount(shifts[p], role) - filled
        if (missing > 0) shortages.push({ shiftId: shifts[p].id, role, missing })
      }
    }
    for (let k = 0; k < nGroupSlots; k++) {
      const soldier = chosen[k]
      if (soldier !== null) commit(slots[k].pos, soldier, slots[k].role, false)
    }

    // Fair share (§4.3), relative to presence.
    for (const p of group) {
      const filled = placed.filter((x) => x.pos === p).length
      if (filled === 0) continue
      const shift = shifts[p]
      const present: number[] = []
      for (let i = 0; i < nSoldiers; i++) if (!isAbsent(soldiers[i], shift.start, shift.end)) present.push(i)
      if (present.length === 0) continue
      const inc = (weight[p] * filled) / present.length
      for (const i of present) fairShare[i] += inc
    }

    a = b
  }

  // ---- Step 4: output, stats, certificate, warnings. -----------------------------------
  placed.sort(
    (x, y) =>
      x.pos - y.pos ||
      ROLE_INDEX.get(x.role)! - ROLE_INDEX.get(y.role)! ||
      compareIds(soldiers[x.soldier].id, soldiers[y.soldier].id),
  )
  const assignments: Assignment[] = placed.map((x) => ({
    shiftId: shifts[x.pos].id,
    soldierId: soldiers[x.soldier].id,
    role: x.role,
    restDebtMinutes: x.restDebt,
    locked: x.locked,
  }))

  const stats: SoldierStats[] = soldiers.map((s, i) => {
    const mine = placed.filter((x) => x.soldier === i) // already in shift order
    let minRest: number | null = null
    for (let k = 1; k < mine.length; k++) {
      const rest = shifts[mine[k].pos].start - shifts[mine[k - 1].pos].end
      if (minRest === null || rest < minRest) minRest = rest
    }
    return {
      soldierId: s.id,
      load: load[i],
      fairShare: fairShare[i],
      deviation: load[i] - fairShare[i],
      shiftCount: mine.length,
      nightMinutes: mine.reduce((sum, x) => sum + shifts[x.pos].nightMinutes, 0),
      minRestMinutes: minRest,
      totalRestDebtMinutes: mine.reduce((sum, x) => sum + x.restDebt, 0),
    }
  })

  let achieved: number | null = null
  for (const st of stats) {
    if (st.minRestMinutes !== null && (achieved === null || st.minRestMinutes < achieved)) {
      achieved = st.minRestMinutes
    }
  }

  const certShifts: CertificateShift[] = shifts.map((shift, pos) => {
    const slotsOfShift: number[][] = []
    for (const role of ROLES) {
      const n = requiredCount(shift, role)
      if (n === 0) continue
      const allowed: number[] = []
      for (let i = 0; i < nSoldiers; i++) {
        const natural = qualified[i].has(role) && !isAbsent(soldiers[i], shift.start, shift.end)
        if (natural || lockedPairs.has(`${pos}|${i}|${role}`)) allowed.push(i)
      }
      for (let k = 0; k < n; k++) slotsOfShift.push(allowed)
    }
    return { start: shift.start, end: shift.end, slots: slotsOfShift }
  })
  const certificate = buildCertificate(certShifts, nSoldiers, achieved, shortages.length > 0)

  const warnings: Warning[] = []
  const debts = placed.filter((x) => x.restDebt > 0).map((x) => x.restDebt)
  if (debts.length > 0) {
    warnings.push({
      code: 'REST_DEBT',
      details: {
        assignments: debts.length,
        totalMinutes: debts.reduce((s, d) => s + d, 0),
        maxMinutes: Math.max(...debts),
      },
    })
  }

  return { assignments, shortages, stats, certificate, warnings }
}
