// MusicXML's note-type spellings, in the model's.
//
// The two agree everywhere except MusicXML's "long", which MNX calls "longa".
// Kept in one place because the same vocabulary is read from three different
// elements: a note's <type>, a tuplet's <normal-type>, and a metronome's
// <beat-unit>.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { NoteValueBase } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import { trimmedText } from '../xml/tree.js'

const NOTE_VALUE_BASES = new Map<string, NoteValueBase>([
  ['maxima', 'maxima'],
  ['long', 'longa'],
  ['breve', 'breve'],
  ['whole', 'whole'],
  ['half', 'half'],
  ['quarter', 'quarter'],
  ['eighth', 'eighth'],
  ['16th', '16th'],
  ['32nd', '32nd'],
  ['64th', '64th'],
  ['128th', '128th'],
  ['256th', '256th'],
  ['512th', '512th'],
  ['1024th', '1024th'],
])

/** The note value an element's text names, or nothing when it names none. */
export function noteValueBaseOf(element: XmlElement): NoteValueBase | undefined {
  return NOTE_VALUE_BASES.get(trimmedText(element))
}

/** The same, for the places where anything else is a broken document. */
export function requireNoteValueBase(element: XmlElement, path: DocumentPath): NoteValueBase {
  const base = noteValueBaseOf(element)
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(element)}".`, {
      path,
      line: element.line,
    })
  }
  return base
}
