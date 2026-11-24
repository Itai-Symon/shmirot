import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type ActivityConfig,
  addWallHours,
  epochToWall,
  generateShifts,
  nightMinutes,
  wallAt,
  wallToEpoch,
} from './shiftGenerator'

const TZ = 'Asia/Jerusalem'
const onePost = [{ requirements: { soldier: 1 }, activeWindow: null }]

function cfg(over: Partial<ActivityConfig>): ActivityConfig {
  return {
    start: '2026-11-23T20:00',
    end: '2026-11-24T06:00',
    timeZone: TZ,
    shiftMinutes: 120,
    split: null,
    posts: onePost,
    ...over,
  }
}

/** Per post: shifts are contiguous and positive; overall coverage of [0, endMinute). */
function expectContiguous(g: ReturnType<typeof generateShifts>, postIndex = 0) {
  const s = g.shifts.filter((x) => x.postIndex === postIndex)
  expect(s.length).toBeGreaterThan(0)
  expect(s[0].start).toBe(0)
  expect(s[s.length - 1].end).toBe(g.endMinute)
  for (let i = 0; i < s.length; i++) {
    expect(s[i].end).toBeGreaterThan(s[i].start)
    expect(Number.isInteger(s[i].start) && Number.isInteger(s[i].end)).toBe(true)
    if (i > 0) expect(s[i].start).toBe(s[i - 1].end)
  }
}

describe('wall clock ↔ epoch', () => {
  it('round-trips ordinary times', () => {
    const ms = wallToEpoch('2026-11-23T20:00', TZ)
    expect(new Date(ms).toISOString()).toBe('2026-11-23T18:00:00.000Z')
    expect(epochToWall(ms, TZ)).toBe('2026-11-23T20:00')
  })

  it('maps a non-existent spring-forward time to the transition instant', () => {
    // Israel 2026-03-27: 02:00 → 03:00
    const gap = wallToEpoch('2026-03-27T02:30', TZ)
    expect(gap).toBe(wallToEpoch('2026-03-27T03:00', TZ))
    expect(epochToWall(gap, TZ)).toBe('2026-03-27T03:00')
  })

  it('maps an ambiguous fall-back time to its earlier occurrence', () => {
    // Israel 2026-10-25: 02:00 → 01:00, so 01:30 happens twice
    const amb = wallToEpoch('2026-10-25T01:30', TZ)
    expect(new Date(amb).toISOString()).toBe('2026-10-24T22:30:00.000Z')
  })

  it('adds wall hours across months', () => {
    expect(addWallHours('2026-11-30T20:00', 24)).toBe('2026-12-01T20:00')
  })
})

describe('nightMinutes', () => {
  const span = (a: string, b: string) => nightMinutes(wallToEpoch(a, TZ), wallToEpoch(b, TZ), TZ)

  it('counts only 00:00–06:00', () => {
    expect(span('2026-11-23T20:00', '2026-11-23T22:00')).toBe(0)
    expect(span('2026-11-23T23:00', '2026-11-24T01:00')).toBe(60)
    expect(span('2026-11-24T05:00', '2026-11-24T07:00')).toBe(60)
    expect(span('2026-11-23T20:00', '2026-11-25T20:00')).toBe(2 * 360)
  })

  it('counts real minutes on DST days', () => {
    expect(span('2026-03-27T00:00', '2026-03-27T06:00')).toBe(300)
    expect(span('2026-10-25T00:00', '2026-10-25T06:00')).toBe(420)
  })
})

describe('generateShifts', () => {
  it('builds back-to-back 2 h shifts with night minutes', () => {
    const g = generateShifts(cfg({}))
    expect(g.endMinute).toBe(600)
    expect(g.shifts.map((s) => [s.start, s.end, s.nightMinutes])).toEqual([
      [0, 120, 0],
      [120, 240, 0],
      [240, 360, 120],
      [360, 480, 120],
      [480, 600, 120],
    ])
    expect(g.shifts[0]).toMatchObject({ id: 'p0-0', postIndex: 0, requirements: { soldier: 1 } })
  })

  it('returns no shifts when end ≤ start', () => {
    expect(generateShifts(cfg({ end: '2026-11-23T20:00' })).shifts).toEqual([])
    expect(generateShifts(cfg({ end: '2026-11-23T19:00' })).shifts).toEqual([])
  })

  it('cuts the last shift at the activity end', () => {
    const g = generateShifts(cfg({ end: '2026-11-23T23:00' }))
    expect(g.shifts.map((s) => [s.start, s.end])).toEqual([
      [0, 120],
      [120, 180],
    ])
  })

  it('spring-forward day: 23 real hours, no missing or duplicate hour', () => {
    const g = generateShifts(cfg({ start: '2026-03-27T00:00', end: '2026-03-28T00:00', shiftMinutes: 60 }))
    expect(g.endMinute).toBe(23 * 60)
    expect(g.shifts).toHaveLength(23)
    expectContiguous(g)
    expect(g.shifts.reduce((a, s) => a + s.nightMinutes, 0)).toBe(300)
    // Labels: 01:00 is followed directly by 03:00
    const labels = g.shifts.map((s) => wallAt(g.startEpochMs, s.start, TZ).time)
    expect(labels.slice(0, 4)).toEqual(['00:00', '01:00', '03:00', '04:00'])
  })

  it('fall-back day: 25 real hours, no missing or duplicate hour', () => {
    const g = generateShifts(cfg({ start: '2026-10-25T00:00', end: '2026-10-26T00:00', shiftMinutes: 60 }))
    expect(g.endMinute).toBe(25 * 60)
    expectContiguous(g)
    expect(g.shifts.reduce((a, s) => a + s.nightMinutes, 0)).toBe(420)
    // The repeated hour is folded into the 01:00 shift (2 real hours)
    expect(g.shifts[1].end - g.shifts[1].start).toBe(120)
    expect(new Set(g.shifts.map((s) => s.id)).size).toBe(g.shifts.length)
  })

  it('split day/night: different lengths, boundaries snap to the night window', () => {
    const g = generateShifts(
      cfg({
        start: '2026-11-23T18:00',
        end: '2026-11-24T10:00',
        shiftMinutes: 240,
        split: { fromHour: 22, toHour: 6, nightShiftMinutes: 120 },
      }),
    )
    const times = g.shifts.map((s) => wallAt(g.startEpochMs, s.start, TZ).time)
    expect(times).toEqual(['18:00', '22:00', '00:00', '02:00', '04:00', '06:00'])
    expect(g.shifts.map((s) => s.end - s.start)).toEqual([240, 120, 120, 120, 120, 240])
    expectContiguous(g)
  })

  it('split snaps an odd day shift to the night start', () => {
    const g = generateShifts(
      cfg({
        start: '2026-11-23T19:00',
        end: '2026-11-24T00:00',
        shiftMinutes: 240,
        split: { fromHour: 22, toHour: 6, nightShiftMinutes: 60 },
      }),
    )
    expect(g.shifts.map((s) => [s.start, s.end])).toEqual([
      [0, 180],
      [180, 240],
      [240, 300],
    ])
  })

  it('"active only between" limits a post to its window', () => {
    const g = generateShifts(
      cfg({
        start: '2026-11-23T18:00',
        end: '2026-11-24T18:00',
        shiftMinutes: 180,
        posts: [
          { requirements: { soldier: 1 }, activeWindow: null },
          { requirements: { commander: 1, soldier: 1 }, activeWindow: { fromHour: 20, toHour: 6 } },
        ],
      }),
    )
    const p1 = g.shifts.filter((s) => s.postIndex === 1)
    expect(p1.map((s) => wallAt(g.startEpochMs, s.start, TZ).time)).toEqual(['20:00', '23:00', '02:00', '05:00'])
    expect(p1.map((s) => s.end - s.start)).toEqual([180, 180, 180, 60])
    expect(p1[0].requirements).toEqual({ commander: 1, soldier: 1 })
    expectContiguous(g, 0)
    // Sorted by (start, postIndex)
    for (let i = 1; i < g.shifts.length; i++) {
      const a = g.shifts[i - 1]
      const b = g.shifts[i]
      expect(a.start < b.start || (a.start === b.start && a.postIndex < b.postIndex)).toBe(true)
    }
  })

  it('property: any config covers the activity exactly, with sane night minutes', () => {
    const zones = ['Asia/Jerusalem', 'Europe/London', 'America/New_York', 'UTC']
    fc.assert(
      fc.property(
        fc.constantFrom(...zones),
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 1, max: 96 }),
        fc.constantFrom(60, 120, 180, 240),
        fc.option(
          fc.record({
            fromHour: fc.integer({ min: 0, max: 23 }),
            toHour: fc.integer({ min: 0, max: 23 }),
            nightShiftMinutes: fc.constantFrom(60, 120, 180, 240),
          }),
          { nil: null },
        ),
        (tz, dayOfYear, hour, hours, len, split) => {
          const naiveStart = Date.UTC(2026, 0, 1 + dayOfYear, hour) / 60000
          const start = new Date(naiveStart * 60000).toISOString().slice(0, 16)
          const end = addWallHours(start, hours)
          const g = generateShifts({ start, end, timeZone: tz, shiftMinutes: len, split, posts: onePost })
          const realLen = (wallToEpoch(end, tz) - wallToEpoch(start, tz)) / 60000
          expect(g.endMinute).toBe(realLen)
          expectContiguous(g)
          for (const s of g.shifts) {
            expect(s.nightMinutes).toBeGreaterThanOrEqual(0)
            expect(s.nightMinutes).toBeLessThanOrEqual(s.end - s.start)
            // A shift is never longer than the configured lengths plus one DST hour
            expect(s.end - s.start).toBeLessThanOrEqual(Math.max(len, split?.nightShiftMinutes ?? 0) + 60)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('post weight and free shift length', () => {
  it('90-minute shifts and a post weight become shift lengths and weightFactor', () => {
    const g = generateShifts({
      start: '2026-12-01T20:00',
      end: '2026-12-02T02:00',
      timeZone: 'Asia/Jerusalem',
      shiftMinutes: 90,
      split: null,
      posts: [
        { requirements: { soldier: 1 }, activeWindow: null, weight: 1.3 },
        { requirements: { soldier: 1 }, activeWindow: null },
      ],
    })
    const p0 = g.shifts.filter((s) => s.postIndex === 0)
    expect(p0.map((s) => s.end - s.start)).toEqual([90, 90, 90, 90])
    expect(p0.every((s) => s.weightFactor === 1.3)).toBe(true)
    expect(g.shifts.filter((s) => s.postIndex === 1).every((s) => s.weightFactor === undefined)).toBe(true)
  })
})

describe('15-minute grid', () => {
  it('odd start/end minutes and lengths are rounded so every boundary is on the grid', () => {
    const g = generateShifts({
      start: '2026-12-01T17:04',
      end: '2026-12-02T09:52',
      timeZone: 'Asia/Jerusalem',
      shiftMinutes: 133,
      split: { fromHour: 22, toHour: 6, nightShiftMinutes: 97 },
      posts: [{ requirements: { soldier: 1 }, activeWindow: null }],
    })
    for (const s of g.shifts) {
      expect(s.start % 15, s.id).toBe(0) // minute 0 is 17:00 (17:04 rounded)
      expect(s.end % 15, s.id).toBe(0)
    }
    expect(g.endMinute % 15).toBe(0)
  })
})

describe('different staffing at night', () => {
  it('uses night requirements inside the window and cuts shifts at its edges', () => {
    const g = generateShifts({
      start: '2026-12-01T18:00',
      end: '2026-12-02T10:00',
      timeZone: 'Asia/Jerusalem',
      shiftMinutes: 180,
      split: null,
      posts: [{ requirements: { soldier: 1 }, activeWindow: null, night: { fromHour: 22, toHour: 6, requirements: { soldier: 2, commander: 1 } } }],
    })
    const at = (h: number) => g.shifts.find((s) => (s.start / 60 + 18) % 24 === h)!
    expect(at(18).requirements).toEqual({ soldier: 1 })
    expect(at(21).end - at(21).start).toBe(60) // 21:00–22:00, cut at the night edge
    expect(at(22).requirements).toEqual({ soldier: 2, commander: 1 })
    expect(at(4).end - at(4).start).toBe(120) // 04:00–06:00, cut at the morning edge
    expect(at(6).requirements).toEqual({ soldier: 1 })
  })
})
