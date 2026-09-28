// Exact rational arithmetic for durations. MusicXML measures time in
// <divisions> units and MNX in note values, so converting between them means
// dividing, and the results do not stay binary: a triplet eighth is 1/12 of a
// whole note. Floats would make measure-fill and voice-start checks
// unreliable, so nothing here uses one.
//
// A value past the safe-integer range cannot be held exactly. This throws an
// InexactFractionError rather than round, and the conversion restates it as a
// MusicXMLError.

declare const normalised: unique symbol

export class InexactFractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InexactFractionError'
  }
}

export interface Fraction {
  readonly num: number
  readonly den: number
  /**
   * Type-only, never present at runtime. A Fraction is in lowest terms with
   * the sign on the numerator, so equal values compare field by field. Only
   * this module builds one; a hand-built { num: 2, den: 4 } does not
   * type-check.
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
 * All arithmetic goes through here, so equal values have equal parts.
 *
 * The two casts are the only places that claim the brand. The value is in
 * lowest terms, and a zero denominator or an unsafe part is already refused.
 */
export function fraction(num: number, den = 1): Fraction {
  if (den === 0 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    throw new InexactFractionError(`Invalid fraction: ${String(num)}/${String(den)}`)
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

// Each of these reduces before it multiplies. Multiplying first can overflow
// the safe-integer range when the result itself is small: two <divisions>
// values in one measure is legal MusicXML, and each gives a denominator.

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
 * Refuses a pair whose scaled numerators cannot be held exactly. The check
 * comes before they are combined: two that each run past the safe-integer
 * range can almost cancel, and fraction() would take the small result as
 * exact. compareFractions checks its two sides for the same reason.
 */
function requireExactNumerators(
  left: number,
  right: number,
  a: Fraction,
  b: Fraction,
  operation: 'add' | 'subtract',
): void {
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return
  throw new InexactFractionError(
    `Cannot ${operation} ${String(a.num)}/${String(a.den)} and ` +
      `${String(b.num)}/${String(b.den)} exactly.`,
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

/**
 * The largest value that counts both a and b a whole number of times: the
 * greatest common divisor of the numerators over the least common multiple of
 * the denominators. Zero where either side is zero, since no nonzero value
 * counts zero a whole number of times.
 */
export function commonMeasure(a: Fraction, b: Fraction): Fraction {
  if (a.num === 0 || b.num === 0) return fraction(0)
  const common = greatestCommonDivisor(a.den, b.den)
  return fraction(greatestCommonDivisor(Math.abs(a.num), Math.abs(b.num)), (a.den / common) * b.den)
}

export function negate(value: Fraction): Fraction {
  return fraction(-value.num, value.den)
}

/**
 * Negative when a is the smaller, zero when they are equal, else positive.
 *
 * Reduces before it multiplies, like the arithmetic above. It compares the
 * two sides rather than subtracting them, because the difference can overflow
 * where neither side does.
 */
export function compareFractions(a: Fraction, b: Fraction): number {
  const common = greatestCommonDivisor(a.den, b.den)
  const left = a.num * (b.den / common)
  const right = b.num * (a.den / common)

  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new InexactFractionError(
      `Cannot compare ${String(a.num)}/${String(a.den)} with ` +
        `${String(b.num)}/${String(b.den)} exactly.`,
    )
  }

  return left < right ? -1 : left > right ? 1 : 0
}

export function isZero(value: Fraction): boolean {
  return value.num === 0
}
