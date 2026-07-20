import { describe, expect, test } from 'vitest'
import {
  addFractions,
  compareFractions,
  fraction,
  isZero,
  multiplyFractions,
  subtractFractions,
} from './fraction.js'

describe('fraction', () => {
  test('reduces to lowest terms', () => {
    expect(fraction(6, 8)).toEqual({ num: 3, den: 4 })
  })

  test('treats a whole number as a denominator of one', () => {
    expect(fraction(3)).toEqual({ num: 3, den: 1 })
  })

  test('keeps the sign on the numerator', () => {
    expect(fraction(1, -2)).toEqual({ num: -1, den: 2 })
  })

  test('normalises zero to the same value however it is written', () => {
    expect(fraction(0, 7)).toEqual({ num: 0, den: 1 })
  })

  test('rejects a denominator of zero', () => {
    expect(() => fraction(1, 0)).toThrow('Invalid fraction')
  })

  // Past 2^53 the arithmetic keeps working on silently rounded values, which
  // is worse than failing.
  test('rejects a value too large to stay exact', () => {
    expect(() => fraction(2 ** 53 + 2, 3)).toThrow('Invalid fraction')
  })

  test('rejects a value that is not a whole number', () => {
    expect(() => fraction(1.5, 2)).toThrow('Invalid fraction')
  })
})

describe('arithmetic', () => {
  test('adds fractions with unlike denominators', () => {
    expect(addFractions(fraction(1, 4), fraction(1, 8))).toEqual({ num: 3, den: 8 })
  })

  test('subtracts fractions', () => {
    expect(subtractFractions(fraction(1, 2), fraction(1, 3))).toEqual({ num: 1, den: 6 })
  })

  test('subtracts to a negative value', () => {
    expect(subtractFractions(fraction(1, 4), fraction(1, 2))).toEqual({ num: -1, den: 4 })
  })

  test('multiplies fractions', () => {
    expect(multiplyFractions(fraction(2, 3), fraction(3, 4))).toEqual({ num: 1, den: 2 })
  })

  // The reason this module exists: a triplet eighth is 1/12 of a whole note,
  // and three of them have to come to exactly one quarter.
  test('keeps triplets exact where floats would drift', () => {
    const tripletEighth = fraction(1, 12)
    const total = addFractions(addFractions(tripletEighth, tripletEighth), tripletEighth)

    expect(total).toEqual({ num: 1, den: 4 })
  })
})

// Denominators are reduced against each other before multiplying, not after,
// so ordinary music does not run into the safe-integer limit. Two <divisions>
// values in one measure is legal MusicXML, and each one contributes a
// denominator.
describe('staying within exact arithmetic', () => {
  test('adds fractions whose denominators multiply past the safe limit', () => {
    const a = fraction(1, 2 ** 26)
    const b = fraction(1, 2 ** 26)

    expect(addFractions(a, b)).toEqual({ num: 1, den: 2 ** 25 })
  })

  test('multiplies without building a product it does not need', () => {
    const a = fraction(1, 3 * 2 ** 25)
    const b = fraction(3 * 2 ** 25, 7)

    expect(multiplyFractions(a, b)).toEqual({ num: 1, den: 7 })
  })

  test('subtracts to zero rather than overflowing on the way', () => {
    const a = fraction(1, 3 * 2 ** 25)

    expect(subtractFractions(a, a)).toEqual({ num: 0, den: 1 })
  })
})

describe('comparison', () => {
  test('orders two fractions', () => {
    expect(compareFractions(fraction(1, 3), fraction(1, 2))).toBeLessThan(0)
    expect(compareFractions(fraction(1, 2), fraction(1, 3))).toBeGreaterThan(0)
  })

  test('reports equal values as equal however they were written', () => {
    expect(compareFractions(fraction(2, 4), fraction(1, 2))).toBe(0)
  })

  test('recognises zero', () => {
    expect(isZero(fraction(0, 5))).toBe(true)
    expect(isZero(fraction(1, 5))).toBe(false)
  })
})

// Two <divisions> values in one measure is legal MusicXML, and each
// contributes a denominator, so the products a comparison builds run far past
// the values being compared. Getting the sign wrong here would silently
// decide that a full measure is not full.
describe('comparing without overflowing', () => {
  test('gets the sign right where the plain cross product would not', () => {
    const a = fraction(1, 2 ** 26 + 1)
    const b = fraction(1, 2 ** 26 + 3)

    // The plain form multiplies the two denominators, past 2^52.
    expect(a.den * b.den).toBeGreaterThan(Number.MAX_SAFE_INTEGER / 2)
    expect(compareFractions(a, b)).toBeGreaterThan(0)
    expect(compareFractions(b, a)).toBeLessThan(0)
  })

  test('refuses rather than guess where it cannot compare exactly', () => {
    const huge = fraction(Number.MAX_SAFE_INTEGER, 2)
    const small = fraction(1, Number.MAX_SAFE_INTEGER - 1)

    expect(() => compareFractions(huge, small)).toThrow('Cannot compare')
  })
})
