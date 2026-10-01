// The notations a note writes that MNX states on the event rather than on
// the note: its marks, its fermata, a two-note tremolo and a tuplet bracket.
// Every note of a chord writes its own, and the chord's own note is the one
// converted.

import type { BowDirectionMarking, MarkingKind } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { entriesOf } from './tables.js'

/** One notation a note writes on its event, with the block that accounts for it. */
export type EventNotation = {
  readonly found: XmlElement
  readonly block: ElementReader
} & (
  | {
      readonly slot:
        Exclude<MarkingKind, 'bowDirection'> | 'fermata' | 'multiNoteTremolo' | 'tuplet'
    }
  | { readonly slot: 'bowDirection'; readonly direction: BowDirectionMarking['direction'] }
)

// MusicXML's <articulations> children, in MNX's spelling. A caesura is read
// apart, because it states no side. Everything else MusicXML allows there,
// from a doit to a falloff, has no home in event-markings and stays unread,
// which is what reports it. A tremolo is not one of them: it is written
// among the ornaments, and read with the beam count it needs. Keyed by the
// mark, so the compiler demands an entry for every kind the model holds.
const ARTICULATIONS: Record<
  Exclude<MarkingKind, 'tremolo' | 'bowDirection' | 'caesura'>,
  string
> = {
  accent: 'accent',
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  tenuto: 'tenuto',
  spiccato: 'spiccato',
  stress: 'stress',
  unstress: 'unstress',
  softAccent: 'soft-accent',
  strongAccent: 'strong-accent',
  // MusicXML files a breath mark among the articulations; MNX states it
  // beside them, under its own name.
  breath: 'breath-mark',
}

// MusicXML's bow marks, keyed by the way the bow travels, which is what MNX
// states. Keyed by the model's own direction, so a direction the model gains
// with no element here does not compile.
const BOW_DIRECTIONS: Record<BowDirectionMarking['direction'], string> = {
  up: 'up-bow',
  down: 'down-bow',
}

/**
 * The event notations a note writes, block by block. The marks come in a
 * fixed order rather than the source's, because MNX keys them by name, so a
 * note carries at most one of each and the order they were written in is not
 * part of what it says. The bow marks are the exception, below. Nothing is
 * read here: each reader of a notation accounts for what it takes.
 */
export function readEventNotations(notations: readonly ElementReader[]): readonly EventNotation[] {
  const written: EventNotation[] = []
  for (const block of notations) {
    for (const articulations of block.blocks('articulations')) {
      for (const [slot, name] of entriesOf(ARTICULATIONS)) {
        for (const found of children(articulations.element, name)) {
          written.push({ slot, found, block: articulations })
        }
      }
      for (const found of children(articulations.element, 'caesura')) {
        written.push({ slot: 'caesura', found, block: articulations })
      }
    }

    // MusicXML files the bow marks under <technical>, away from the
    // articulations; MNX states them beside the rest of the marks. The other
    // playing instructions there stay unread, which is what reports them.
    // Two elements share the one MNX key, unlike the articulations above, so
    // they are read in the order the source wrote them, which is what says
    // which mark is kept.
    for (const technical of block.blocks('technical')) {
      for (const found of technical.element.children) {
        for (const [direction, name] of entriesOf(BOW_DIRECTIONS)) {
          if (found.name === name) {
            written.push({ slot: 'bowDirection', direction, found, block: technical })
          }
        }
      }
    }

    // A tremolo on one note is drawn as beams across its stem, and MNX
    // states it with the other marks. One written across two notes is a
    // pair of events rather than a mark, and its start and stop markers say
    // which end of the pair the note is.
    for (const ornaments of block.blocks('ornaments')) {
      for (const found of children(ornaments.element, 'tremolo')) {
        const type = attribute(found, 'type')
        const slot = type === 'start' || type === 'stop' ? 'multiNoteTremolo' : 'tremolo'
        written.push({ slot, found, block: ornaments })
      }
    }

    // MusicXML allows a <notations> to carry several fermatas, one per staff
    // of a part, and several tuplet markers, as when two nested tuplets
    // start on the same note.
    for (const found of children(block.element, 'fermata')) {
      written.push({ slot: 'fermata', found, block })
    }
    for (const found of children(block.element, 'tuplet')) {
      written.push({ slot: 'tuplet', found, block })
    }
  }
  return written
}

/** The elements written for one slot of the event, in order. */
export function writtenFor(
  written: readonly EventNotation[],
  slot: EventNotation['slot'],
): readonly EventNotation[] {
  return written.filter((notation) => notation.slot === slot)
}
