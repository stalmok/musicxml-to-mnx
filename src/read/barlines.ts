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

import type { DocumentPath } from '../errors.js'
import type { BarlineType, Ending, Fermata, RepeatEnd } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { readFermataAt } from './notes.js'
import { readAttributeInRange } from './numbers.js'

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
}

const NOTHING: BarlineReading = {
  barline: undefined,
  repeatStart: false,
  repeatEnd: undefined,
  endingStart: undefined,
  endingStop: undefined,
  fermata: undefined,
}

export function readBarline(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): BarlineReading {
  // Where on the measure it sits. MusicXML's default is the right edge.
  const atStart = attribute(element.element, 'location') === 'left'

  // The repeat is read first, because a bar style at the opening edge is
  // usually just how a repeat start is drawn.
  const repeat = readRepeat(element, warnings, context, path)

  return {
    ...NOTHING,
    ...repeat,
    barline: readBarStyle(element, atStart, repeat.repeatStart, warnings, context),
    ...readEnding(element, warnings, context),
    fermata: readFermataAt(element.children('fermata'), warnings, context),
  }
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
  path: DocumentPath,
): { repeatStart: boolean; repeatEnd: RepeatEnd | undefined } {
  const repeat = element.child('repeat')
  if (!repeat) return { repeatStart: false, repeatEnd: undefined }

  const direction = attribute(repeat, 'direction')
  if (direction === 'forward') return { repeatStart: true, repeatEnd: undefined }

  if (direction === 'backward') {
    // How many times the passage is played, where the source counts them.
    // Two is what a plain repeat means, so anything below that is not one.
    return {
      repeatStart: false,
      repeatEnd: { times: readAttributeInRange(repeat, 'times', path, 2, 1_000) },
    }
  }

  warnings.add(
    'unsupported:element',
    `A <repeat> in direction "${direction ?? ''}" is not converted yet.`,
    { ...context, line: repeat.line },
    'repeat',
  )
  return { repeatStart: false, repeatEnd: undefined }
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
