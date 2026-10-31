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
//
// A melisma line starts at a syllable that states <extend>. MNX states it on
// that syllable, with the last event it runs under as its target. MusicXML
// states that event with a later <lyric> that holds only an <extend>: a stop,
// or a continue, or one with no type. A line reaches the next syllable of its
// verse in its voice at most.

import type { Lyric, LyricExtender, Part, SequenceItem } from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { Draft } from './draft.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, text, trimmedText } from '../xml/tree.js'
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

/**
 * The melisma lines open in a part, keyed by voice and verse line, which a
 * lyric on a later note of that voice can reach. A line stays here once a
 * lyric stops it, so another note of the same chord can stop it again.
 */
export type OpenExtenders = Map<string, { line: Draft<LyricExtender>; stopped: boolean }>

const EXTEND_TYPES: ReadonlySet<string> = new Set(['start', 'stop', 'continue'])

/**
 * The syllables under a note, by the verse line each is sung on, and whether
 * a melisma line ends at the note's event. `event` is the id of that event,
 * and `voice` the voice it is in. A note of a chord adds its syllables to
 * those the chord's notes before it sing.
 */
export function readLyrics(
  element: ElementReader,
  voice: string,
  event: string,
  open: OpenExtenders,
  warnings: WarningCollector,
  context: ReportContext,
  chord?: ReadonlyMap<string, Lyric>,
): { lyrics: Map<string, Lyric>; endsLine: boolean } {
  const lyrics = new Map(chord)
  let endsLine = false
  for (const lyric of element.blocks('lyric')) {
    const line = attribute(lyric.element, 'number') ?? '1'
    const key = JSON.stringify([voice, line])
    // A <lyric> holds one <extend> at most, so child() is correct.
    const extend = lyric.child('extend')
    const extendType = extend && readExtendType(extend, warnings, context)
    const verse = readVerse(lyric, line, warnings, context)

    if (!verse) {
      if (!extend) continue
      const reached = open.get(key)
      if (!reached || (reached.stopped && reached.line.target !== event)) {
        warnings.add(
          'unclosed:spanner',
          `A lyric extends a melisma line of line ${line} under this note, and no syllable ` +
            'before it in its voice starts one. The line is not converted.',
          context,
          extend,
        )
        continue
      }
      reached.line.target = event
      endsLine = true
      if (extendType === 'stop') reached.stopped = true
      continue
    }

    // MNX keys an event's lyrics by line, and the model does the same. A verse
    // stated twice the same way is read once, with a melisma line where
    // either copy starts one. Where the two differ, the first is converted
    // and the second is reported, and only the first starts or ends a line.
    const starts = extend !== undefined && extendType !== 'stop'
    const stated = lyrics.get(verse.line)
    if (!stated) {
      // A syllable ends the line before it in its verse.
      open.delete(key)
      lyrics.set(verse.line, starts ? withLine(verse.lyric, key, open) : verse.lyric)
      continue
    }
    if (stated.text === verse.lyric.text && stated.type === verse.lyric.type) {
      if (starts && !stated.extender) lyrics.set(verse.line, withLine(stated, key, open))
      continue
    }
    warnings.add(
      'unrepresentable:lyric-line',
      `${chord ? 'A chord' : 'A note'} sings line ${verse.line} twice, as "${stated.text}" and as "${verse.lyric.text}", ` +
        'and MNX states one lyric per line on an event. The first is the one converted.',
      context,
      lyric.element,
    )
  }
  return { lyrics, endsLine }
}

/**
 * Every verse line the parts sing, sorted by the source's verse number rather
 * than by first appearance, because a later verse can start earlier in the
 * score.
 */
export function lyricLineOrder(parts: readonly Part[]): string[] {
  const lines = new Set<string>()
  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.kind === 'tuplet' || item.kind === 'grace' || item.kind === 'multiNoteTremolo') {
        walk(item.content)
      } else if (item.kind === 'event') {
        for (const line of item.lyrics.keys()) lines.add(line)
      }
    }
  }
  for (const part of parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) walk(sequence.content)
    }
  }
  return [...lines].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** A verse as written: the line it is sung on, and what is sung there. */
interface Verse {
  line: string
  lyric: Lyric
}

/** The syllable with a melisma line starting at it, open under `key`. */
function withLine(lyric: Lyric, key: string, open: OpenExtenders): Lyric {
  const extender: Draft<LyricExtender> = { target: undefined }
  open.set(key, { line: extender, stopped: false })
  return { ...lyric, extender }
}

/**
 * The type of an <extend>, or nothing where it states none. A type MusicXML
 * does not define is reported, and read as none.
 */
function readExtendType(
  extend: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): string | undefined {
  const type = attribute(extend, 'type')
  if (type === undefined || EXTEND_TYPES.has(type)) return type
  warnings.add(
    'unresolved:attribute-value',
    `An <extend> of type "${type}" is not one MusicXML defines, so it is read as stating ` +
      'no type.',
    context,
    extend,
    'type',
  )
  return undefined
}

function readVerse(
  lyric: ElementReader,
  line: string,
  warnings: WarningCollector,
  context: ReportContext,
): Verse | undefined {
  const text = joinSyllables(lyric)

  // A <lyric> can carry no words: one holding only an <extend> continues a
  // melisma under a later note, and a <text> holding one space draws nothing.
  // There is no syllable to write. Hiding such a lyric hides nothing the
  // output draws, so its print-object is read with no warning.
  if (text === undefined) {
    attribute(lyric.element, 'print-object')
    // A <syllabic> over no words joins a syllable that is not there. Nothing
    // is lost, so it is read and not reported.
    for (const found of lyric.children('syllabic')) lyric.readWhole(found)
    return undefined
  }

  // MNX's event lyric states a text and a type, and nothing about
  // visibility, so a hidden lyric is drawn and the hiding reported.
  reportHidden(lyric.element, warnings, context)

  const [first, ...rest] = lyric.children('syllabic')
  const [extra] = rest
  if (extra) {
    // Each <syllabic> belongs to the <text> after it, so an elided verse can
    // carry several. MNX states one type per event. Only the first survives,
    // because it says how the syllable joins the one before it. One warning
    // covers the rest.
    for (const found of rest) lyric.readWhole(found)
    warnings.add(
      'unrepresentable:lyric-syllabic',
      'A lyric states how each of its elided syllables joins its word, and MNX states ' +
        'one for the event. The first is the one converted.',
      context,
      extra,
    )
  }

  // No <syllabic> means the syllable stands on its own, as "single" does.
  if (!first) return { line, lyric: { text, type: undefined } }

  const spelling = trimmedText(first)
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
    if (part.name === 'text' || part.name === 'elision') joined += text(part)
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
