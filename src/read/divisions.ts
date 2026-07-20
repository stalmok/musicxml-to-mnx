// Reading a <duration>, which MusicXML counts in the <divisions> in force.
//
// <divisions> says how many units make a quarter note, is stated in an
// <attributes> block, and stays in force until restated, which is why this
// needs the part's running state rather than the element alone.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { ElementReader } from './element.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'

/** How long the element lasts, as a fraction of a whole note. */
export function readDuration(
  element: ElementReader,
  state: PartState,
  path: DocumentPath,
): Fraction | undefined {
  const durationElement = element.child('duration')
  if (!durationElement) return undefined

  if (state.divisions === undefined) {
    throw new MusicXMLError('A <duration> appears before any <divisions> said how long one is.', {
      path,
      line: durationElement.line,
    })
  }

  // <divisions> counts per quarter note, and a whole note is four of those.
  const count = readIntegerInRange(durationElement, path, 0, 1_000_000_000)
  return fraction(count, state.divisions * 4)
}

/** The duration of a <backup> or <forward>, which must state one. */
export function requireDuration(
  element: ElementReader,
  state: PartState,
  path: DocumentPath,
): Fraction {
  const duration = readDuration(element, state, path)
  if (!duration) {
    throw new MusicXMLError(`A <${element.name}> states no <duration>.`, {
      path,
      line: element.line,
    })
  }
  return duration
}
