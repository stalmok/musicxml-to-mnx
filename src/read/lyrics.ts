// Reading the words under a note.
//
// A note carries one <lyric> per verse it sings, and MNX keys the verses by
// the number the source gives them. The text is meaningful down to the space,
// so it is never trimmed.
//
// A verse is not always one <text>. Where two syllables are sung on one note,
// which French sets constantly, MusicXML writes each as its own <text> with
// the elision character between them as an <elision>. Every piece is read, in
// the order written.

import type { Lyric } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { reportHidden } from './unrepresentable.js'

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
): Lyric[] {
  const lyrics: Lyric[] = []
  for (const lyric of element.blocks('lyric')) {
    const verse = readVerse(lyric, warnings, context)
    if (!verse) continue

    // MNX keys an event's lyrics by line, so two on one line are one lyric
    // there whatever the source wrote. A note stating the same verse twice
    // says the same thing twice and loses nothing by being read once. Two
    // that differ are two things where MNX holds one: the first is the one
    // converted, and the second is reported.
    const stated = lyrics.find((one) => one.line === verse.line)
    if (!stated) {
      lyrics.push(verse)
      continue
    }
    if (stated.text === verse.text && stated.type === verse.type) continue
    warnings.add(
      'unrepresentable:lyric-line',
      `A note sings line ${verse.line} twice, as "${stated.text}" and as "${verse.text}", ` +
        'and MNX states one lyric per line on an event. The first is the one converted.',
      { ...context, line: lyric.line },
      'lyric',
    )
  }
  return lyrics
}

function readVerse(
  lyric: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): Lyric | undefined {
  const line = attribute(lyric.element, 'number') ?? '1'
  const text = joinSyllables(lyric)

  // A <lyric> can carry no words at all: one holding only an <extend> is how
  // MusicXML continues a melisma under a later note. There is no syllable in
  // it to write, and the <extend> is reported like anything else unread.
  // Hiding such a lyric hides nothing the output draws, so its print-object
  // is read with the rest of the element and nothing is said.
  if (text === undefined) {
    attribute(lyric.element, 'print-object')
    return undefined
  }

  // MNX's event lyric states a text and a type, and nothing about
  // visibility, so a hidden lyric is drawn and the hiding reported.
  reportHidden(lyric.element, 'lyric', warnings, context)

  const syllabics = lyric.children('syllabic')
  if (syllabics.length > 1) {
    // Each <syllabic> belongs to the <text> after it, so an elided verse can
    // carry several. MNX states one type for the whole event, so only the
    // first, which is what says how the syllable joins what came before it,
    // survives.
    warnings.add(
      'unrepresentable:lyric-syllabic',
      'A lyric states how each of its elided syllables joins its word, and MNX states ' +
        'one for the event. The first is the one converted.',
      { ...context, line: lyric.line },
      'syllabic',
    )
  }

  const first = syllabics[0]
  // No <syllabic> means the syllable stands on its own, as "single" does.
  if (!first) return { line, text, type: undefined }

  const spelling = first.text.trim()
  if (!LYRIC_TYPES.has(spelling)) {
    warnings.add(
      'unsupported:element',
      `A <syllabic> of "${spelling}" is not converted yet.`,
      { ...context, line: first.line },
      'syllabic',
    )
  }
  return { line, text, type: LYRIC_TYPES.get(spelling) }
}

/**
 * The whole syllable under this note, or nothing where the verse states no
 * words. The pieces are joined exactly as written, in document order, with
 * whatever the source put between them: the separator is the source's to
 * state, and inventing one would put a character into the words that nobody
 * sang. Some exporters write the pieces with no <elision> at all, and the
 * corpus contains fourteen of those.
 */
function joinSyllables(lyric: ElementReader): string | undefined {
  const texts = lyric.children('text')
  lyric.children('elision')
  if (texts.length === 0) return undefined

  let joined = ''
  for (const part of lyric.element.children) {
    if (part.name === 'text' || part.name === 'elision') joined += part.text
  }
  return joined
}
