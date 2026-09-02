// Reading the words under a note.
//
// A note carries one <lyric> per verse it sings, and MNX keys the verses by
// the number the source gives them. Whatever the source puts between the
// pieces of a syllable is meaningful down to the space, so the join is never
// trimmed in the middle; the whitespace around the whole syllable is layout,
// which a pretty-printed file writes and nobody sings.
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

/** The syllables under a note, by the verse line each is sung on. */
export function readLyrics(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): Map<string, Lyric> {
  const lyrics = new Map<string, Lyric>()
  for (const lyric of element.blocks('lyric')) {
    const verse = readVerse(lyric, warnings, context)
    if (!verse) continue

    // MNX keys an event's lyrics by line, so two on one line are one lyric
    // there whatever the source wrote, and the model is keyed the same way so
    // that the second cannot quietly replace the first. A note stating the
    // same verse twice says the same thing twice and loses nothing by being
    // read once. Two that differ are two things where MNX holds one: the
    // first is the one converted, and the second is reported.
    const stated = lyrics.get(verse.line)
    if (!stated) {
      lyrics.set(verse.line, verse.lyric)
      continue
    }
    if (stated.text === verse.lyric.text && stated.type === verse.lyric.type) continue
    warnings.add(
      'unrepresentable:lyric-line',
      `A note sings line ${verse.line} twice, as "${stated.text}" and as "${verse.lyric.text}", ` +
        'and MNX states one lyric per line on an event. The first is the one converted.',
      { ...context, line: lyric.line },
      'lyric',
    )
  }
  return lyrics
}

/** A verse as written: the line it is sung on, and what is sung there. */
interface Verse {
  line: string
  lyric: Lyric
}

function readVerse(
  lyric: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): Verse | undefined {
  const line = attribute(lyric.element, 'number') ?? '1'
  const text = joinSyllables(lyric)

  // A <lyric> can carry no words at all: one holding only an <extend> is how
  // MusicXML continues a melisma under a later note, and a <text> holding one
  // space draws nothing either. There is no syllable in either to write, and
  // the <extend> is reported like anything else unread.
  // Hiding such a lyric hides nothing the output draws, so its print-object
  // is read with the rest of the element and nothing is said.
  if (text === undefined) {
    attribute(lyric.element, 'print-object')
    // A <syllabic> over no words says how a syllable that is not there joins
    // its neighbour. Nothing is lost by passing over it, so it is read rather
    // than reported. An <extend> is a melisma line, which is a real loss, and
    // is left to report itself.
    lyric.children('syllabic')
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
  if (!first) return { line, lyric: { text, type: undefined } }

  const spelling = first.text.trim()
  if (!LYRIC_TYPES.has(spelling)) {
    warnings.add(
      'unsupported:element',
      `A <syllabic> of "${spelling}" is not converted yet.`,
      { ...context, line: first.line },
      'syllabic',
    )
  }
  return { line, lyric: { text, type: LYRIC_TYPES.get(spelling) } }
}

/**
 * The whole syllable under this note, or nothing where the verse states no
 * words. The pieces are joined exactly as written, in document order, with
 * whatever the source put between them: the separator is the source's to
 * state, and inventing one would put a character into the words that nobody
 * sang. Some exporters write the pieces with no <elision> at all, and the
 * corpus contains fourteen of those.
 *
 * The joined syllable is trimmed at its two ends. A pretty-printer writes an
 * element's text on its own indented line, and 664 syllables in the vendored
 * corpus carry a trailing space; neither is sung. A syllable that is nothing
 * but whitespace draws nothing, so it states no words at all.
 */
function joinSyllables(lyric: ElementReader): string | undefined {
  const texts = lyric.children('text')
  lyric.children('elision')
  if (texts.length === 0) return undefined

  let joined = ''
  for (const part of lyric.element.children) {
    if (part.name === 'text' || part.name === 'elision') joined += part.text
  }
  const sung = joined.trim()
  return sung === '' ? undefined : sung
}
