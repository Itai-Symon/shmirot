import { describe, expect, it } from 'vitest'
import { buildCertificate, feasibleAt, restUpperBound, type CertificateShift } from './certificate'

/** count back-to-back shifts of length L, K slots each, every soldier eligible. */
function uniform(count: number, L: number, K: number, N: number): CertificateShift[] {
  const everyone = Array.from({ length: N }, (_, i) => i)
  return Array.from({ length: count }, (_, k) => ({
    start: k * L,
    end: (k + 1) * L,
    slots: Array.from({ length: K }, () => everyone),
  }))
}

describe('certificate (§6)', () => {
  it('UB equals (⌊N/K⌋ − 1)·L in the uniform setting', () => {
    for (const [N, K] of [
      [4, 1],
      [5, 2],
      [7, 2],
      [9, 3],
    ]) {
      expect(restUpperBound(uniform(20, 60, K, N), N, 0)).toBe((Math.floor(N / K) - 1) * 60)
    }
  })

  it('feasibleAt is monotone in X', () => {
    const shifts = uniform(10, 60, 1, 4)
    expect(feasibleAt(shifts, 4, 180)).toBe(true)
    expect(feasibleAt(shifts, 4, 181)).toBe(false)
    expect(feasibleAt(shifts, 4, 600)).toBe(false)
  })

  it('accounts for role scarcity', () => {
    // Commander seat every hour, only soldier 0 can fill it ⇒ his rest is at most 0.
    const shifts = uniform(5, 60, 1, 1)
    expect(restUpperBound(shifts, 3, 0)).toBe(0)
  })

  it('returns null when nobody needs to guard twice', () => {
    expect(restUpperBound(uniform(3, 60, 1, 10), 10, 0)).toBeNull()
  })

  it('reports n/a with shortages or without consecutive pairs', () => {
    const s = uniform(5, 60, 1, 4)
    expect(buildCertificate(s, 4, 180, true)).toEqual({
      achievedMinRestMinutes: 180,
      upperBoundMinRestMinutes: null,
      provenOptimal: false,
    })
    expect(buildCertificate(s, 4, null, false)).toEqual({
      achievedMinRestMinutes: null,
      upperBoundMinRestMinutes: null,
      provenOptimal: false,
    })
    expect(buildCertificate(s, 4, 120, false)).toEqual({
      achievedMinRestMinutes: 120,
      upperBoundMinRestMinutes: 180,
      provenOptimal: false,
    })
  })
})
