import { describe, expect, test } from 'vitest'
import {
  InexactFractionError,
  addFractions,
  commonMeasure,
  compareFractions,
  divideFractions,
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

  // The brand that stops a hand-built fraction type-checking is a declared
  // symbol key, never a value. A real one would reach the writer's output and
  // every deep comparison in the suite.
  test('carries the two numbers and nothing else at runtime', () => {
    expect(Reflect.ownKeys(fraction(6, 8))).toEqual(['num', 'den'])
  })

  test('keeps the sign on the numerator', () => {
    expect(fraction(1, -2)).toEqual({ num: -1, den: 2 })
  })

  test('normalises zero to the same value however it is written', () => {
    expect(fraction(0, 7)).toEqual({ num: 0, den: 1 })
  })

  test('rejects a denominator of zero', () => {
    expect(() => fraction(1, 0)).toThrow(InexactFractionError)
    expect(() => fraction(1, 0)).toThrow('Invalid fraction')
  })

  // Past 2^53 the arithmetic keeps working on silently rounded values, which
  // is worse than failing.
  test('rejects a value too large to stay exact', () => {
    expect(() => fraction(2 ** 53 + 2, 3)).toThrow(InexactFractionError)
  })

  test('rejects a value that is not a whole number', () => {
    expect(() => fraction(1.5, 2)).toThrow(InexactFractionError)
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

  test('divides fractions', () => {
    expect(divideFractions(fraction(1, 2), fraction(3, 4))).toEqual({ num: 2, den: 3 })
  })

  test('divides zero by any value to zero', () => {
    expect(divideFractions(fraction(0), fraction(3, 4))).toEqual({ num: 0, den: 1 })
  })

  test('keeps the sign on the numerator when dividing by a negative value', () => {
    expect(divideFractions(fraction(1, 2), fraction(-3, 4))).toEqual({ num: -2, den: 3 })
  })

  test('rejects division by zero', () => {
    expect(() => divideFractions(fraction(1, 2), fraction(0))).toThrow(InexactFractionError)
    expect(() => divideFractions(fraction(1, 2), fraction(0))).toThrow('Invalid fraction')
  })

  test('takes the largest value that counts two others whole', () => {
    expect(commonMeasure(fraction(1, 2), fraction(3, 8))).toEqual({ num: 1, den: 8 })
    expect(commonMeasure(fraction(3, 8), fraction(1, 4))).toEqual({ num: 1, den: 8 })
    expect(commonMeasure(fraction(2, 3), fraction(4, 3))).toEqual({ num: 2, den: 3 })
  })

  test('counts nothing where one side is zero', () => {
    expect(commonMeasure(fraction(0), fraction(3, 8))).toEqual({ num: 0, den: 1 })
    expect(commonMeasure(fraction(3, 8), fraction(0))).toEqual({ num: 0, den: 1 })
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

  test('divides a value by itself where the plain cross product would overflow', () => {
    const a = fraction(2 ** 27, 2 ** 26 + 1)

    // Inverting and multiplying without reducing builds this product.
    expect(a.num * a.den).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(divideFractions(a, a)).toEqual({ num: 1, den: 1 })
  })

  // Two numerators that each run past the safe integer range and all but
  // cancel. Checking only the sum leaves a small wrong answer looking exact:
  // this pair gives 2/15 where the exact difference is 1/15.
  test('refuses rather than guess where a numerator cannot be scaled exactly', () => {
    const a = fraction(3002399751580331, 3)
    const b = fraction(5003999585967218, 5)

    expect(() => subtractFractions(a, b)).toThrow(InexactFractionError)
    expect(() => subtractFractions(a, b)).toThrow('Cannot subtract')
    expect(() => addFractions(a, b)).toThrow('Cannot add')
  })

  // Both scaled numerators are checked, not just one: a pair where only one
  // side runs past the range is refused by name rather than reaching the
  // reduction, which would refuse it as an impossible fraction instead.
  test.each([
    ['the first side', () => addFractions(fraction(Number.MAX_SAFE_INTEGER, 3), fraction(1, 2))],
    ['the second side', () => addFractions(fraction(1, 2), fraction(Number.MAX_SAFE_INTEGER, 3))],
  ])('refuses a sum where %s cannot be scaled exactly', (_name, add) => {
    expect(add).toThrow('Cannot add')
  })

  test('divides without building a product it does not need', () => {
    const a = fraction(2 ** 27, 3)
    const b = fraction(2 ** 27, 2 ** 26 + 1)

    // Inverting and multiplying without reducing builds this product.
    expect(a.num * b.den).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(divideFractions(a, b)).toEqual({ num: 2 ** 26 + 1, den: 3 })
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

    expect(() => compareFractions(huge, small)).toThrow(InexactFractionError)
    expect(() => compareFractions(huge, small)).toThrow('Cannot compare')
  })
})
