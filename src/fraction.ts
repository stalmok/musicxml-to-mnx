// Exact rational arithmetic for durations. MusicXML measures time in its own
// <divisions> units and MNX in note values, so converting between them means
// dividing, and the results do not stay binary: a triplet eighth is 1/12 of a
// whole note. Accumulating those as floats would make "does this measure add
// up" and "where does this voice start" unreliable, so nothing here uses one.

export interface Fraction {
  num: number
  den: number
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
 */
export function fraction(num: number, den = 1): Fraction {
  if (den === 0 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    throw new Error(`Invalid fraction: ${String(num)}/${String(den)}`)
  }
  if (den < 0) {
    num = -num
    den = -den
  }
  const divisor = greatestCommonDivisor(Math.abs(num), den)
  return divisor > 1 ? { num: num / divisor, den: den / divisor } : { num, den }
}

// Each of these reduces before it multiplies. Doing it the other way round
// builds products that overflow the safe-integer range on values the result
// itself sits well inside: two <divisions> values in one measure is legal
// MusicXML, and each contributes a denominator.

export function addFractions(a: Fraction, b: Fraction): Fraction {
  const common = greatestCommonDivisor(a.den, b.den)
  const aScale = b.den / common
  const bScale = a.den / common
  return fraction(a.num * aScale + b.num * bScale, a.den * aScale)
}

export function subtractFractions(a: Fraction, b: Fraction): Fraction {
  const common = greatestCommonDivisor(a.den, b.den)
  const aScale = b.den / common
  const bScale = a.den / common
  return fraction(a.num * aScale - b.num * bScale, a.den * aScale)
}

export function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  // Cross-reduce: each numerator against the other's denominator.
  const left = greatestCommonDivisor(Math.abs(a.num), b.den)
  const right = greatestCommonDivisor(Math.abs(b.num), a.den)
  return fraction((a.num / left) * (b.num / right), (a.den / right) * (b.den / left))
}

export function negate(value: Fraction): Fraction {
  return fraction(-value.num, value.den)
}

/** Negative when a is the smaller, zero when they are equal, else positive. */
export function compareFractions(a: Fraction, b: Fraction): number {
  return a.num * b.den - b.num * a.den
}

export function isZero(value: Fraction): boolean {
  return value.num === 0
}
