import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration, snap } from './duration'

describe('duration input', () => {
  it('parses the ways people type a length', () => {
    expect(parseDuration('2:30')).toBe(150)
    expect(parseDuration('2.5')).toBe(150)
    expect(parseDuration('2,5')).toBe(150)
    expect(parseDuration('3')).toBe(180)
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration(' 1:05 ')).toBe(65)
    expect(parseDuration('1:75')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
  it('formats and snaps', () => {
    expect(formatDuration(150)).toBe('2:30')
    expect(formatDuration(45)).toBe('0:45')
    expect(snap(152, 15, 15, 720)).toBe(150)
    expect(snap(0, 15, 15, 720)).toBe(15)
    expect(snap(10_000, 15, 15, 720)).toBe(720)
  })
})
