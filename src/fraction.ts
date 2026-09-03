// Exact rational arithmetic for durations. MusicXML measures time in its own
// <divisions> units and MNX in note values, so converting between them means
// dividing, and the results do not stay binary: a triplet eighth is 1/12 of a
// whole note. Accumulating those as floats would make "does this measure add
// up" and "where does this voice start" unreliable, so nothing here uses one.
//
// A value past the safe-integer range cannot be held exactly, and this refuses
// rather than round. That is a fact about the input's own numbers, reached
// only on pathological divisions or durations, so it is a MusicXMLError like
// any other input the converter cannot carry faithfully, not a bare crash.

import { MusicXMLError } from './errors.js'

declare const normalised: unique symbol

export interface Fraction {
  readonly num: number
  readonly den: number
  /**
   * Type-only, and never present at runtime. A Fraction is in lowest terms
   * with the sign on the numerator, which is what lets two equal values be
   * compared field by field, and only this module normalises. The brand is
   * how the compiler says so: a hand-built { num: 2, den: 4 } is not one.
   */
  readonly [normalised]: true
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

/**
 * Builds a normalised fraction: lowest terms, with the sign on the numerator.
 * All arithmetic goes through here, so two equal values always have equal
 * parts and can be compared field by field.
 *
 * The two casts are the only places the brand is claimed, and this is where
 * the claim is earned: the value returned is in lowest terms, and a zero or
 * unsafe denominator has already been refused.
 */
export function fraction(num: number, den = 1): Fraction {
  if (den === 0 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    throw new MusicXMLError(`Invalid fraction: ${String(num)}/${String(den)}`, { path: [] })
  }
  if (den < 0) {
    num = -num
    den = -den
  }
  const divisor = greatestCommonDivisor(Math.abs(num), den)
  return divisor > 1
    ? ({ num: num / divisor, den: den / divisor } as Fraction)
    : ({ num, den } as Fraction)
}

// Each of these reduces before it multiplies. Doing it the other way round
// builds products that overflow the safe-integer range on values the result
// itself sits well inside: two <divisions> values in one measure is legal
// MusicXML, and each contributes a denominator.

export function addFractions(a: Fraction, b: Fraction): Fraction {
  const common = greatestCommonDivisor(a.den, b.den)
  const aScale = b.den / common
  const bScale = a.den / common
  const left = a.num * aScale
  const right = b.num * bScale
  requireExactNumerators(left, right, a, b, 'add')
  return fraction(left + right, a.den * aScale)
}

export function subtractFractions(a: Fraction, b: Fraction): Fraction {
  const common = greatestCommonDivisor(a.den, b.den)
  const aScale = b.den / common
  const bScale = a.den / common
  const left = a.num * aScale
  const right = b.num * bScale
  requireExactNumerators(left, right, a, b, 'subtract')
  return fraction(left - right, a.den * aScale)
}

/**
 * Refuses a pair whose scaled numerators cannot be held exactly. Checked
 * before the two are combined, not after: two that each run past the safe
 * integer range can all but cancel, leaving a small result that fraction()
 * takes for an exact one. compareFractions checks its two sides for the same
 * reason.
 */
function requireExactNumerators(
  left: number,
  right: number,
  a: Fraction,
  b: Fraction,
  operation: 'add' | 'subtract',
): void {
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return
  throw new MusicXMLError(
    `Cannot ${operation} ${String(a.num)}/${String(a.den)} and ` +
      `${String(b.num)}/${String(b.den)} exactly.`,
    { path: [] },
  )
}

export function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  // Cross-reduce: each numerator against the other's denominator.
  const left = greatestCommonDivisor(Math.abs(a.num), b.den)
  const right = greatestCommonDivisor(Math.abs(b.num), a.den)
  return fraction((a.num / left) * (b.num / right), (a.den / right) * (b.den / left))
}

export function divideFractions(a: Fraction, b: Fraction): Fraction {
  // Cross-reduce: numerator against numerator, denominator against
  // denominator, because dividing inverts b. Division by zero puts the zero
  // in the denominator, which fraction() rejects.
  const nums = greatestCommonDivisor(Math.abs(a.num), Math.abs(b.num))
  const dens = greatestCommonDivisor(a.den, b.den)
  return fraction((a.num / nums) * (b.den / dens), (a.den / dens) * (b.num / nums))
}

export function negate(value: Fraction): Fraction {
  return fraction(-value.num, value.den)
}

/**
 * Negative when a is the smaller, zero when they are equal, else positive.
 *
 * Reduces before it multiplies, like the arithmetic above, and for the same
 * reason: two <divisions> values in one measure give denominators whose plain
 * product runs past the safe-integer range on values the comparison itself
 * sits nowhere near. It also compares the two sides rather than subtracting
 * them, because the difference can overflow where neither side does, and a
 * silently wrong sign here is worse than a wrong number anywhere else: it is
 * what decides whether a measure is full and whether a voice runs backwards.
 */
export function compareFractions(a: Fraction, b: Fraction): number {
  const common = greatestCommonDivisor(a.den, b.den)
  const left = a.num * (b.den / common)
  const right = b.num * (a.den / common)

  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new MusicXMLError(
      `Cannot compare ${String(a.num)}/${String(a.den)} with ` +
        `${String(b.num)}/${String(b.den)} exactly.`,
      { path: [] },
    )
  }

  return left < right ? -1 : left > right ? 1 : 0
}

export function isZero(value: Fraction): boolean {
  return value.num === 0
}
