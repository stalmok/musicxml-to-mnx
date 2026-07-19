// Turning a measured length of time back into a written note value.
//
// MusicXML states a note's length twice: once as what is drawn (<type> plus
// <dot>s) and once as elapsed time (<duration>, counted in <divisions>).
// Usually only the first is needed, but a whole-measure rest is written with
// no <type> at all, so its value has to be recovered from the second.

import { compareFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { NoteValue, NoteValueBase } from '../model/score.js'

// Every note value, as a fraction of a whole note.
const BASE_VALUES: readonly (readonly [NoteValueBase, Fraction])[] = [
  ['maxima', fraction(8)],
  ['longa', fraction(4)],
  ['breve', fraction(2)],
  ['whole', fraction(1)],
  ['half', fraction(1, 2)],
  ['quarter', fraction(1, 4)],
  ['eighth', fraction(1, 8)],
  ['16th', fraction(1, 16)],
  ['32nd', fraction(1, 32)],
  ['64th', fraction(1, 64)],
  ['128th', fraction(1, 128)],
  ['256th', fraction(1, 256)],
  ['512th', fraction(1, 512)],
  ['1024th', fraction(1, 1024)],
]

// Beyond three, dots stop appearing in real music.
const MAX_DOTS = 3

/**
 * The note value that lasts exactly this long, or undefined when no written
 * value does. A duration of 1/12 of a whole note is a triplet eighth, which
 * needs a tuplet rather than a note value, and guessing one here would invent
 * a rhythm the source never wrote.
 */
export function lengthOf(value: NoteValue): Fraction {
  const base = BASE_VALUES.find(([name]) => name === value.base)
  /* v8 ignore next -- the base is one of the values in the table by type. */
  if (!base) throw new Error(`Unknown note value base: ${value.base}`)
  return multiplyFractions(base[1], fraction(2 ** (value.dots + 1) - 1, 2 ** value.dots))
}

/** How a note value reads in a sentence, for example "a double-dotted half". */
export function describeValue(value: NoteValue): string {
  const prefix = ['', 'dotted ', 'double-dotted ', 'triple-dotted '][value.dots]
  // Past three dots there is no word for it, and nothing writes them anyway,
  // so say the count rather than inventing one.
  if (prefix === undefined) return `a ${value.base} with ${String(value.dots)} dots`

  const name = `${prefix}${value.base}`
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
}

/** How a length reads in a sentence, named as a note value where one fits. */
export function describeLength(duration: Fraction): string {
  const value = noteValueOf(duration)
  if (value) return describeValue(value)
  return `${String(duration.num)}/${String(duration.den)} of a whole note`
}

export function noteValueOf(duration: Fraction): NoteValue | undefined {
  if (compareFractions(duration, fraction(0)) <= 0) return undefined

  for (const [base, value] of BASE_VALUES) {
    for (let dots = 0; dots <= MAX_DOTS; dots++) {
      // Each dot adds half of what came before, so n dots multiply the value
      // by (2^(n+1) - 1) / 2^n.
      const dotted = multiplyFractions(value, fraction(2 ** (dots + 1) - 1, 2 ** dots))
      if (compareFractions(dotted, duration) === 0) return { base, dots }
    }
  }
  return undefined
}
