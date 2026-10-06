// Reading the words under a note.
//
// A note carries one <lyric> per verse, and MNX keys the verses by the number
// the source gives them. The join keeps whatever the source puts between the
// pieces of a syllable, spaces included. It drops only layout: the whitespace
// around the whole syllable and any line break inside it.
//
// A verse is not always one <text>. Where two syllables are sung on one note,
// as often in French, MusicXML writes each as its own <text> with the elision
// character between them as an <elision>. Every piece is read, in the order
// written.

import type { Lyric } from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { reportHidden } from './unrepresentable.js'

// MusicXML's syllabic values, in MNX's spelling. A syllable standing on its
// own carries no type in MNX, so "single", and no syllabic, map to
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
  context: ReportContext,
): Map<string, Lyric> {
  const lyrics = new Map<string, Lyric>()
  for (const lyric of element.blocks('lyric')) {
    const verse = readVerse(lyric, warnings, context)
    if (!verse) continue

    // MNX keys an event's lyrics by line, and the model does the same. A verse
    // stated twice the same way is read once. Where the two differ, the first
    // is converted and the second is reported.
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
      context,
      lyric.element,
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
  context: ReportContext,
): Verse | undefined {
  const line = attribute(lyric.element, 'number') ?? '1'
  const text = joinSyllables(lyric)

  // A <lyric> can carry no words: one holding only an <extend> continues a
  // melisma under a later note, and a <text> holding one space draws nothing.
  // There is no syllable to write. An <extend> is a melisma line, which is a
  // real loss, and is reported like anything else unread. Hiding such a
  // lyric hides nothing the output draws, so its print-object is read with no
  // warning.
  if (text === undefined) {
    attribute(lyric.element, 'print-object')
    // A <syllabic> over no words joins a syllable that is not there. Nothing
    // is lost, so it is read and not reported.
    lyric.children('syllabic')
    return undefined
  }

  // MNX's event lyric states a text and a type, and nothing about
  // visibility, so a hidden lyric is drawn and the hiding reported.
  reportHidden(lyric.element, warnings, context)

  const syllabics = lyric.children('syllabic')
  const extra = syllabics[1]
  if (extra) {
    // Each <syllabic> belongs to the <text> after it, so an elided verse can
    // carry several. MNX states one type per event. Only the first survives,
    // because it says how the syllable joins the one before it.
    warnings.add(
      'unrepresentable:lyric-syllabic',
      'A lyric states how each of its elided syllables joins its word, and MNX states ' +
        'one for the event. The first is the one converted.',
      context,
      extra,
    )
  }

  const first = syllabics[0]
  // No <syllabic> means the syllable stands on its own, as "single" does.
  if (!first) return { line, lyric: { text, type: undefined } }

  const spelling = first.text.trim()
  if (!LYRIC_TYPES.has(spelling)) {
    warnings.add(
      'unresolved:element-value',
      `A <syllabic> of "${spelling}" is not one MusicXML defines, so the syllable is ` +
        'converted with no type.',
      context,
      first,
    )
  }
  return { line, lyric: { text, type: LYRIC_TYPES.get(spelling) } }
}

/**
 * The whole syllable under this note, or nothing where the verse states no
 * words. The pieces are joined in document order with whatever the source put
 * between them, and no separator is added. Some exporters write the pieces
 * with no <elision> between them.
 *
 * The joined syllable is trimmed at both ends, and any line break inside it
 * is dropped. A pretty-printer writes an element's text on its own indented
 * line, and many sources carry a trailing space. A syllable of only
 * whitespace states no words.
 */
function joinSyllables(lyric: ElementReader): string | undefined {
  const texts = lyric.children('text')
  lyric.children('elision')
  if (texts.length === 0) return undefined

  let joined = ''
  for (const part of lyric.element.children) {
    if (part.name === 'text' || part.name === 'elision') joined += part.text
  }
  const sung = joined.replace(LAYOUT_BREAK, '').trim()
  return sung === '' ? undefined : sung
}

// A run of ASCII whitespace holding a line break: how a pretty-printer lays
// out a <text>. Dropped, not collapsed to a space: hensel-1-sehnsucht writes
// one verse both ways, and the one without the break runs its pieces together.
//
// A no-break space is not in the class. It is the source drawing an indent,
// as that same file does before both its verses, and taking it with the break
// would join "y" and "a" as "ya".
const LAYOUT_BREAK = /[ \t\r\n]*[\r\n][ \t\r\n]*/g
