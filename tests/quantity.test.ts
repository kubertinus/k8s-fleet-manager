import { describe, expect, it } from 'vitest'
import { parseQuantity } from '@/lib/quantity'

describe('parseQuantity', () => {
  it('parses CPU quantities into cores', () => {
    expect(parseQuantity('250m')).toBeCloseTo(0.25)
    expect(parseQuantity('24081u')).toBeCloseTo(0.024081)
    expect(parseQuantity('123456789n')).toBeCloseTo(0.123456789)
    expect(parseQuantity('2')).toBe(2)
  })
  it('parses memory quantities into bytes', () => {
    expect(parseQuantity('512Mi')).toBe(512 * 2 ** 20)
    expect(parseQuantity('1.5Gi')).toBe(1.5 * 2 ** 30)
    expect(parseQuantity('1G')).toBe(1e9)
    expect(parseQuantity('1e3')).toBe(1000)
  })
  it('passes numbers through and rejects garbage', () => {
    expect(parseQuantity(3)).toBe(3)
    expect(parseQuantity('abc')).toBeNaN()
    expect(parseQuantity('')).toBeNaN()
    expect(parseQuantity(undefined)).toBeNaN()
  })
})
