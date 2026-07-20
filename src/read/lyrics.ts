// Reading the words under a note.
//
// A note carries one <lyric> per verse it sings, and MNX keys the verses by
// the number the source gives them. The text is meaningful down to the space,
// so it is never trimmed.

import type { DocumentPath } from '../errors.js'
import type { Lyric } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import { attribute, child, requireChild } from '../xml/tree.js'
import type { ElementReader } from './element.js'

// MusicXML's syllabic values, in MNX's spelling. A syllable standing on its
// own carries no type in MNX, so "single", and no syllabic at all, map to
// nothing. Anything outside these is not a syllabic value.
const LYRIC_TYPES = new Map<string, 'start' | 'middle' | 'end' | undefined>([
  ['single', undefined],
  ['begin', 'start'],
  ['middle', 'middle'],
  ['end', 'end'],
])

/** The syllables under a note, one per verse. */
export function readLyrics(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Lyric[] {
  return element.children('lyric').map((lyric) => {
    const line = attribute(lyric, 'number') ?? '1'
    // The text is meaningful down to the space, so it is not trimmed.
    const text = requireChild(lyric, 'text', path).text

    const syllabic = child(lyric, 'syllabic')
    // No <syllabic> means the syllable stands on its own, as "single" does.
    if (!syllabic) return { line, text, type: undefined }

    const spelling = syllabic.text.trim()
    if (!LYRIC_TYPES.has(spelling)) {
      warnings.add('unsupported:element', `A <syllabic> of "${spelling}" is not converted yet.`, {
        ...context,
        line: syllabic.line,
      })
    }
    return { line, text, type: LYRIC_TYPES.get(spelling) }
  })
}
