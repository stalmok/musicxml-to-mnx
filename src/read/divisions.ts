// Reading a <duration>, which MusicXML counts in the <divisions> in force.
//
// <divisions> says how many units make a quarter note, is stated in an
// <attributes> block, and stays in force until restated, which is why this
// needs the part's running state rather than the element alone.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { ElementReader } from './element.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'

/**
 * The divisions in force. A file may state durations without ever saying how
 * many divisions make a quarter note; the spec names no default, but every
 * such file reads correctly at the customary one per quarter, so that is
 * assumed and reported. If the assumption is wrong, the written values
 * disagree with the measured ones and the inconsistent:duration warnings say
 * so. Held on the state, so the assumption is made and reported once per part.
 */
export function divisionsInForce(
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  line: number,
): number {
  if (state.divisions === undefined) {
    warnings.add(
      'missing:divisions',
      'A duration appears before any <divisions> said how long one is. ' +
        'One division per quarter note is assumed.',
      { ...context, line },
      'divisions',
    )
    state.divisions = 1
  }
  return state.divisions
}

/** How long the element lasts, as a fraction of a whole note. */
export function readDuration(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Fraction | undefined {
  const durationElement = element.child('duration')
  if (!durationElement) return undefined

  const divisions = divisionsInForce(state, warnings, context, durationElement.line)

  // <divisions> counts per quarter note, and a whole note is four of those.
  const count = readIntegerInRange(durationElement, path, 0, 1_000_000_000)
  return fraction(count, divisions * 4)
}

/** The duration of a <backup> or <forward>, which must state one. */
export function requireDuration(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Fraction {
  const duration = readDuration(element, state, warnings, context, path)
  if (!duration) {
    throw new MusicXMLError(`A <${element.name}> states no <duration>.`, {
      path,
      line: element.line,
    })
  }
  return duration
}
