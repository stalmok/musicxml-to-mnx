// Reading the beam count of a tremolo, and a tremolo written across two notes.

import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { writtenFor } from './eventNotations.js'
import type { EventNotation } from './eventNotations.js'
import { parseWholeNumber } from './numbers.js'

/**
 * The beam count a `<tremolo>` states in its text: three where it states none,
 * which is how the mark is usually drawn, or nothing where the text is not a
 * whole number in MusicXML's zero-to-eight range. MNX draws one to eight, so
 * zero is the one count MusicXML defines that MNX cannot draw. The single-note
 * and two-note kinds part ways on what to do with a count they cannot draw,
 * so each reports its own loss; only the reading of the count is shared.
 */
export function tremoloBeamCount(text: string): number | undefined {
  const marks = text === '' ? 3 : parseWholeNumber(text)
  return marks !== undefined &&
    marks >= MUSICXML_TREMOLO_MARKS.fewest &&
    marks <= MUSICXML_TREMOLO_MARKS.most
    ? marks
    : undefined
}

/** The beam counts MusicXML defines for a tremolo. */
const MUSICXML_TREMOLO_MARKS = { fewest: 0, most: 8 } as const

/** The beam counts MNX draws a tremolo with. */
export const TREMOLO_MARKS = { fewest: 1, most: 8 } as const

/** One end of a tremolo written across two notes, as its <tremolo> marks it. */
export interface TremoloMarker {
  type: 'start' | 'stop'
  marks: number
  /** The <tremolo> marker. */
  element: XmlElement
}

export function multiNoteTremoloOf(
  written: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): TremoloMarker | undefined {
  // A note is one end of one pair, so a second marker stays unread.
  const [first] = writtenFor(written, 'multiNoteTremolo')
  if (!first) return undefined
  const { found: tremolo, block } = first
  block.read(tremolo)
  const type = attribute(tremolo, 'type') === 'start' ? 'start' : 'stop'

  // MNX has nowhere on a two-note tremolo to say which side it is drawn on;
  // the single-note kind carries that, this kind does not.
  if (attribute(tremolo, 'placement') !== undefined) {
    warnings.add(
      'unrepresentable:element',
      'A tremolo written across two notes says which side it is drawn on, and MNX ' +
        'has nowhere to put that.',
      context,
      tremolo,
    )
  }

  // Unlike the single-note kind, the pair still converts, drawn the usual way
  // with three beams.
  const text = trimmedText(tremolo)
  let marks = tremoloBeamCount(text)
  if (marks === undefined) {
    warnings.addUndefinedText(tremolo, 'and the tremolo is drawn with three beams.', context)
    marks = 3
  } else if (marks < TREMOLO_MARKS.fewest) {
    warnings.add(
      'unrepresentable:element',
      `A tremolo drawn with ${text} beams cannot be stated in MNX, which counts ` +
        'from one to eight. Three beams are drawn instead.',
      context,
      tremolo,
    )
    marks = 3
  }
  return { type, marks, element: tremolo }
}
