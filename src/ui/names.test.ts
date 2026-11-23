import { describe, expect, it } from 'vitest'
import { parseNames } from './names'

describe('parseNames', () => {
  it('splits lines, trims, strips numbering and drops duplicates', () => {
    expect(parseNames('1. אבי לוי\n2) בני\n\n  גדי   כהן \n- דודי\nבני\n')).toEqual(['אבי לוי', 'בני', 'גדי כהן', 'דודי'])
  })
  it('accepts commas too', () => {
    expect(parseNames('אבי, בני,גדי')).toEqual(['אבי', 'בני', 'גדי'])
  })
})
