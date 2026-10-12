// Reading the value a note is written as, recovering one from its duration
// where it states none, and reporting where the two disagree.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { NoteValue } from '../model/score.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { MOST_BEAM_LEVELS, valueForBeamCount } from './beams.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseWholeNumber } from './numbers.js'
import type { PartState } from './state.js'

/** The value as written: `<type>` plus however many `<dot>`s follow it. */
export function readWrittenValue(
  element: ElementReader,
  path: DocumentPath,
): NoteValue | undefined {
  const typeElement = element.child('type')
  // <dot> is read either way: a note with dots and no <type> has still stated
  // them, and leaving them unread would report them as a loss.
  const dots = element.children('dot').length
  if (!typeElement) return undefined

  const base = noteValueBaseOf(typeElement)
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(typeElement)}".`, {
      path,
      line: typeElement.line,
    })
  }
  return { base, dots }
}

/**
 * How much a note's written value is scaled by what is open around it, and
 * which of the two states it, for a report to name.
 */
export interface NoteScale {
  factor: Fraction
  by: 'tuplet' | 'tremolo' | undefined
}

/**
 * The value a grace note stating no <type> is drawn with. Nothing in the
 * source states its length: a grace note carries no <duration>, and MNX
 * states a value for every event. The beams over it are what draw it, one
 * for an eighth and one more for each halving, and a grace note carrying
 * none is drawn as an eighth.
 */
export function drawnGraceValue(
  element: ElementReader,
  grace: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): NoteValue {
  const levels = element.children('beam').flatMap((beam) => {
    const level = parseWholeNumber(attribute(beam, 'number') ?? '1')
    return level !== undefined && level <= MOST_BEAM_LEVELS ? [level] : []
  })
  // A level below one draws no beam, and the zero here is what says so.
  const beams = Math.max(0, ...levels)
  const base = valueForBeamCount(beams) ?? 'eighth'

  warnings.add(
    'missing:note-type',
    `A grace note states no <type>, and carries no <duration> to measure one from. ` +
      `MNX states a value for every event, so it is converted as ${describeValue({ base, dots: 0 })}` +
      (beams > 0 ? ', which its beams draw.' : ', which is how a grace note is drawn.'),
    context,
    grace,
  )
  return { base, dots: 0 }
}

/**
 * The value to use when the note does not say which one is written. A
 * <duration> is the time the note sounds, which a tuplet or a tremolo around
 * it has already scaled, so `scale` takes that ratio back out.
 */
export function measuredValue(
  element: ElementReader,
  duration: Fraction | undefined,
  scale: NoteScale,
  state: PartState,
  path: DocumentPath,
): NoteValue {
  if (!duration) {
    throw new MusicXMLError('A <note> states neither a <type> nor a <duration>.', {
      path,
      line: element.line,
    })
  }

  // The duration was measured in assumed divisions, and with no written value
  // there is nothing to check the assumption against.
  if (state.divisionsAssumed) {
    throw new MusicXMLError(
      'A <note> has no <type>, and no <divisions> ever said how long its <duration> is.',
      { path, line: element.line },
    )
  }

  const written = divideFractions(duration, scale.factor)
  const value = noteValueOf(written)
  if (!value) {
    // A bracket may state a ratio that scales nothing, and naming the same
    // length twice would read as though it did.
    const scaled = scale.by !== undefined && compareFractions(written, duration) !== 0
    throw new MusicXMLError(
      scaled && scale.by
        ? `A <note> states no <type>. It lasts ${describeLength(duration)}, written as ` +
            `${describeLength(written)} by the ${scale.by} around it, which no note value ` +
            'can write.'
        : `A <note> states no <type>, and lasts ${describeLength(duration)}, which no note ` +
            'value can write.',
      { path, line: element.line },
    )
  }
  return value
}

// A note inside a tuplet is meant to last less than it is written as, by the
// open tuplets' combined ratio, so the written value is scaled by it before
// the two are compared. Only a disagreement beyond that is the source
// disagreeing with itself.
export function reportDurationMismatch(
  element: ElementReader,
  written: NoteValue,
  duration: Fraction,
  scale: NoteScale,
  warnings: WarningCollector,
  context: ReportContext,
  place: WarningPlace,
): void {
  const scaledBy = scale.by
  const wanted = multiplyFractions(lengthOf(written), scale.factor)
  if (compareFractions(wanted, duration) === 0) return

  // The ratio is what the written value is compared with, so inside a
  // tuplet or a tremolo the message names the length that ratio wants, and
  // which of the two states it. Naming the written value alone would give
  // "written as an eighth but lasts an eighth", the same length twice.
  warnings.addAt(
    place,
    'inconsistent:duration',
    scaledBy
      ? `A <note> is written as ${describeValue(written)}, which the ${scaledBy} around ` +
          `it makes ${describeLength(wanted)}, but it lasts ${describeLength(duration)}. ` +
          'The written value is the one converted.'
      : `A <note> is written as ${describeValue(written)} but lasts ` +
          `${describeLength(duration)}. The written value is the one converted.`,
    context,
    element.element,
  )
}
