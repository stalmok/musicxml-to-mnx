// Reading a <barline>: the line drawn at the edge of a measure, the repeat
// signs on it, and the bracket over a first or second time ending.
//
// MusicXML hangs all of these off one element, placed at the left or right
// edge of the measure it belongs to. MNX states them on the score's measure
// rather than the part's, because a barline is the whole score's: every part
// is cut at the same place.
//
// An ending is the awkward one. MusicXML marks where it starts and where it
// stops, several measures apart; MNX states it once, on the measure where it
// starts, as how many measures it runs for. Joining those two up is the same
// shape of problem as a tie, and is done a part at a time in score.ts.

import type { Fraction } from '../fraction.js'
import type { BarlineType, Ending, Fermata, RepeatEnd, Segno } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { readColor } from './color.js'
import type { ElementReader } from './element.js'
import { reportHidden } from './unrepresentable.js'
import { readFermataAt } from './notes.js'

// MusicXML's bar styles, in MNX's spelling. The two describe the same lines;
// only the names differ, MusicXML naming the two strokes and MNX the result.
const BAR_STYLES = new Map<string, BarlineType>([
  ['regular', 'regular'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['heavy', 'heavy'],
  ['light-light', 'double'],
  ['light-heavy', 'final'],
  ['heavy-light', 'heavyLight'],
  ['heavy-heavy', 'heavyHeavy'],
  ['tick', 'tick'],
  ['short', 'short'],
  ['none', 'noBarline'],
])

/** What one <barline> was found to carry. */
export interface BarlineReading {
  barline: BarlineType | undefined
  repeatStart: boolean
  repeatEnd: RepeatEnd | undefined
  /** An ending beginning here, with the numbers written over it. */
  endingStart: { numbers: readonly number[] } | undefined
  /** An ending finishing here, and whether it is drawn with a closing hook. */
  endingStop: { open: boolean } | undefined
  fermata: Fermata | undefined
  /** A segno drawn on the barline, the same sign a direction can carry. */
  segno: Segno | undefined
}

const NOTHING: BarlineReading = {
  barline: undefined,
  repeatStart: false,
  repeatEnd: undefined,
  endingStart: undefined,
  endingStop: undefined,
  fermata: undefined,
  segno: undefined,
}

export function readBarline(
  element: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): BarlineReading {
  // Where on the measure it sits. MusicXML's default is the right edge, and
  // it also allows one partway through, which is neither edge.
  const location = attribute(element.element, 'location') ?? 'right'
  const atStart = location === 'left'

  if (location !== 'left' && location !== 'right') {
    warnings.add(
      'unrepresentable:barline',
      `A <barline> at "${location}" is drawn partway through the measure, and MNX ` +
        'states the barline that closes one.',
      { ...context, line: element.line },
      'barline',
    )
    // The one warning accounts for the whole element, so what it holds is not
    // reported a second time.
    element.skip('bar-style', 'repeat', 'ending', 'fermata', 'segno')
    return NOTHING
  }

  // The repeat is read first, because a bar style at the opening edge is
  // usually just how a repeat start is drawn.
  const repeat = readRepeat(element, warnings, context)

  return {
    ...NOTHING,
    ...repeat,
    barline: readBarStyle(element, atStart, repeat.repeatStart, warnings, context),
    ...readEnding(element, warnings, context),
    fermata: atStart
      ? reportOpeningFermata(element, warnings, context)
      : readFermataAt(element.children('fermata'), warnings, context),
    segno: readSegno(element, position, warnings, context),
  }
}

/**
 * A segno drawn on the barline rather than between the notes as a direction.
 * It is the same sign, at the measure edge the barline sits on, so it takes
 * the cursor's position there: the start of the measure at the opening edge,
 * the end at the closing one. MusicXML allows at most one <segno> per
 * <barline>, so child() takes the only one there can be.
 *
 * The segno attribute on <barline> names the sign for playback, the same way
 * <sound segno> names one written as a direction, so it is carried the same
 * way: never written, only matching a jump to the sign it returns to.
 */
function readSegno(
  element: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): Segno | undefined {
  const segno = element.child('segno')
  if (!segno) return undefined

  const name = attribute(element.element, 'segno')
  return {
    location: position,
    glyph: attribute(segno, 'smufl'),
    color: readColor(segno, warnings, context),
    ...(name !== undefined ? { name } : {}),
  }
}

/**
 * A fermata written at the opening edge of a measure is held over the barline
 * that closes the measure before, which is where MNX would state it. Moving it
 * there is a guess about which measure the source meant, so it is reported.
 */
function reportOpeningFermata(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): undefined {
  for (const found of element.children('fermata')) {
    warnings.add(
      'unrepresentable:barline',
      'A fermata is written at the start of a measure, and MNX states one over the ' +
        'barline that closes a measure.',
      { ...context, line: found.line },
      'fermata',
    )
  }
  return undefined
}

function readBarStyle(
  element: ElementReader,
  atStart: boolean,
  repeatStart: boolean,
  warnings: WarningCollector,
  context: WarningContext,
): BarlineType | undefined {
  const style = element.child('bar-style')
  if (!style) return undefined

  const written = trimmedText(style)
  const type = BAR_STYLES.get(written)
  if (!type) {
    warnings.add(
      'unsupported:element',
      `A <bar-style> of "${written}" is not converted yet.`,
      { ...context, line: style.line },
      'bar-style',
    )
    return undefined
  }

  // MNX states one barline per measure, which is the one closing it. A line
  // drawn at the opening edge has nowhere to go, and is not the same thing as
  // the previous measure's closing line.
  //
  // Except that a heavy-light there is how a repeat start is drawn, and MNX's
  // repeatStart already says to draw one, so nothing is lost. Every one of
  // the corpus's thirty-seven is of that kind.
  if (atStart && repeatStart) return undefined

  if (atStart) {
    warnings.add(
      'unrepresentable:barline',
      `A <bar-style> of "${written}" is drawn at the start of the measure, and MNX ` +
        'states the barline that closes one.',
      { ...context, line: style.line },
      'bar-style',
    )
    return undefined
  }
  return type
}

function readRepeat(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): { repeatStart: boolean; repeatEnd: RepeatEnd | undefined } {
  const repeat = element.child('repeat')
  if (!repeat) return { repeatStart: false, repeatEnd: undefined }

  const direction = attribute(repeat, 'direction')
  if (direction === 'forward') return { repeatStart: true, repeatEnd: undefined }

  if (direction === 'backward') {
    return { repeatStart: false, repeatEnd: { times: readTimes(repeat, warnings, context) } }
  }

  warnings.add(
    'unsupported:element',
    `A <repeat> in direction "${direction ?? ''}" is not converted yet.`,
    { ...context, line: repeat.line },
    'repeat',
  )
  return { repeatStart: false, repeatEnd: undefined }
}

/**
 * How many times the passage is played, where the source counts them. Both
 * formats allow any whole number, so an odd one is reported rather than
 * refused: a playback count that reads strangely is not worth rejecting a
 * whole score over.
 */
function readTimes(
  repeat: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): number | undefined {
  const written = attribute(repeat, 'times')
  if (written === undefined) return undefined

  const times = Number(written)
  if (!/^\d+$/.test(written) || !Number.isSafeInteger(times) || times < 2) {
    warnings.add(
      'unsupported:element',
      `A <repeat> is played "${written}" times, which is not a count of two or more, ` +
        'and is not carried over.',
      { ...context, line: repeat.line },
      'repeat',
    )
    return undefined
  }
  return times
}

function readEnding(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): {
  endingStart: { numbers: readonly number[] } | undefined
  endingStop: { open: boolean } | undefined
} {
  const ending = element.child('ending')
  if (!ending) return { endingStart: undefined, endingStop: undefined }

  reportHidden(ending, 'ending', warnings, context)

  const type = attribute(ending, 'type')
  if (type === 'start') {
    return {
      endingStart: { numbers: endingNumbers(ending, warnings, context) },
      endingStop: undefined,
    }
  }
  // "stop" closes the bracket with a hook; "discontinue" leaves it open,
  // which is how a final ending that runs to the end of the piece is drawn.
  if (type === 'stop' || type === 'discontinue') {
    return { endingStart: undefined, endingStop: { open: type === 'discontinue' } }
  }

  warnings.add(
    'unsupported:element',
    `An <ending> of type "${type ?? ''}" is not converted yet.`,
    { ...context, line: ending.line },
    'ending',
  )
  return { endingStart: undefined, endingStop: undefined }
}

/**
 * The times an ending covers, which MusicXML writes as a comma-separated list
 * on the element and MNX states as a list of integers.
 */
function endingNumbers(
  ending: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): readonly number[] {
  const written = attribute(ending, 'number') ?? ''
  const numbers: number[] = []

  for (const part of written.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
      warnings.add(
        'unsupported:element',
        `An <ending> is numbered "${written}", which is not a list of numbers.`,
        { ...context, line: ending.line },
        'ending',
      )
      return []
    }
    numbers.push(Number(trimmed))
  }
  return numbers
}

/**
 * Joins each ending's two ends across a part's measures, in place. MNX states
 * an ending on the measure where it begins, as the number of measures it
 * covers, so how far it runs is only known once its stop has been met.
 */
export function resolveEndings(
  measures: readonly {
    global: { ending: Ending | undefined }
    endingStart: { numbers: readonly number[] } | undefined
    endingStop: { open: boolean } | undefined
  }[],
  warnings: WarningCollector,
  partId: string,
): void {
  let open: { at: number; numbers: readonly number[] } | undefined

  measures.forEach((measure, index) => {
    if (measure.endingStart) {
      if (open) {
        warnings.add(
          'unclosed:ending',
          'An ending starts where one is already open, and the first is not carried over.',
          { part: partId, measure: open.at + 1 },
          'ending',
        )
      }
      open = { at: index, numbers: measure.endingStart.numbers }
    }

    if (!measure.endingStop) return
    if (!open) {
      warnings.add(
        'unclosed:ending',
        'An ending stops where none had started, and is not carried over.',
        { part: partId, measure: index + 1 },
        'ending',
      )
      return
    }

    // Counted inclusively: an ending opening and closing in one measure
    // covers that one measure.
    const start = measures[open.at]
    /* v8 ignore next -- `open.at` is an index this same loop has been past. */
    if (!start) throw new Error('An ending opened on a measure that is not there.')

    start.global.ending = {
      duration: index - open.at + 1,
      numbers: open.numbers,
      open: measure.endingStop.open,
    }
    open = undefined
  })

  if (open) {
    warnings.add(
      'unclosed:ending',
      'An ending starts where nothing ends it, and is not carried over.',
      { part: partId, measure: open.at + 1 },
      'ending',
    )
  }
}
