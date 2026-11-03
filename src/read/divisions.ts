// Reading a <duration>, which MusicXML counts in the <divisions> in force.
//
// <divisions> says how many units make a quarter note, is stated in an
// <attributes> block, and stays in force until restated, so this reads the
// part's running state.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { divideFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import type { ElementReader } from './element.js'
import { readDecimalInRange } from './numbers.js'
import type { PartState } from './state.js'

/**
 * The divisions in force. A file may state durations with no <divisions>. The
 * spec names no default, so the customary one per quarter is assumed and
 * reported. Where a note states a <type>, a wrong assumption shows as
 * inconsistent:duration warnings, and a note without one is refused. Held on
 * the state, so the assumption is reported once per part.
 */
export function divisionsInForce(
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  at: XmlElement,
): Fraction {
  if (state.divisions === undefined) {
    warnings.addMissing(
      'missing:divisions',
      'A duration appears before any <divisions> said how long one is. ' +
        'One division per quarter note is assumed.',
      context,
      at,
    )
    state.divisions = ASSUMED_DIVISIONS
    state.divisionsAssumed = true
  }
  return state.divisions
}

/** The divisions a part counts in before any <divisions> states them. */
export const ASSUMED_DIVISIONS = fraction(1)

/** The divisions a <divisions> states. */
export function readDivisions(divisions: XmlElement, path: DocumentPath): Fraction {
  return readDecimalInRange(divisions, path, { above: 0, max: 1_000_000 })
}

/** How long a <duration> lasts in `divisions`, as a fraction of a whole note. */
export function lengthOfDuration(
  duration: XmlElement,
  divisions: Fraction,
  path: DocumentPath,
): Fraction {
  return wholeNotesOf(readDecimalInRange(duration, path, { min: 0, max: 1_000_000_000 }), divisions)
}

/** A count of `divisions`, as a fraction of a whole note. */
export function wholeNotesOf(count: Fraction, divisions: Fraction): Fraction {
  // <divisions> counts per quarter note, and a whole note is four of those.
  return divideFractions(count, multiplyFractions(divisions, fraction(4)))
}

/** How long the element lasts, as a fraction of a whole note. */
export function readDuration(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): Fraction | undefined {
  const durationElement = element.child('duration')
  if (!durationElement) return undefined

  const divisions = divisionsInForce(state, warnings, context, durationElement)
  return lengthOfDuration(durationElement, divisions, path)
}

/** The duration of a <backup> or <forward>, which must state one. */
export function requireDuration(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
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
