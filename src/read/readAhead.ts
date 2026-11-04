// Reads that look ahead of the reader: what a measure or a part holds,
// asked before the reader reaches it. Each records nothing it reads, so the
// sweep still reports what the reader itself leaves unread.

import type { XmlElement } from '../xml/parse.js'
import { child, children, peeking } from '../xml/tree.js'
import { voiceNamed } from './noteStatement.js'

/**
 * The voices of a measure that sound a note, rather than only rest. A grace
 * note counts: a rest beside one in a line laid over the measure rest is
 * part of that line's music. A chord member sounds in its chord's voice,
 * whatever voice it names, so the note it joins already counts for it.
 */
export function soundingVoices(measure: XmlElement): (string | undefined)[] {
  return peeking(() =>
    children(measure, 'note')
      .filter((note) => !child(note, 'rest') && !child(note, 'chord'))
      .map((note) => voiceNamed(child(note, 'voice'))),
  )
}

/**
 * Whether a <multiple-rest> in the measure opens a multi-measure rest there.
 * An <attributes> can hold more than one <measure-style>, and a measure more
 * than one <attributes>.
 */
export function opensMultimeasureRest(measure: XmlElement): boolean {
  return peeking(() =>
    children(measure, 'attributes').some((attributes) =>
      children(attributes, 'measure-style').some(
        (style) => child(style, 'multiple-rest') !== undefined,
      ),
    ),
  )
}

/** Every voice name the notes of a part state, in any measure. */
export function voiceNames(part: XmlElement): Set<string> {
  return peeking(
    () =>
      new Set(
        children(part, 'measure').flatMap((measure) =>
          children(measure, 'note').flatMap((note) => voiceNamed(child(note, 'voice')) ?? []),
        ),
      ),
  )
}
