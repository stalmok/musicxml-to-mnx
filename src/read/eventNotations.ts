// The notations a note writes that MNX states on the event rather than on
// the note: its marks, its fermata, a two-note tremolo and a tuplet bracket.
// Every note of a chord writes its own, and the chord's own note is the one
// converted.

import type { BowDirectionMarking, MarkingKind } from '../model/score.js'
import type { WarningCode } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, peeking, trimmedText } from '../xml/tree.js'
import type { ReportContext, WarningCollector } from './collector.js'
import { isPresentationAttribute } from './element.js'
import type { ElementReader } from './element.js'
import { parseWholeNumber } from './numbers.js'
import { entriesOf } from './tables.js'

/**
 * One notation a note writes on its event. `block` is the reader that
 * accounts for the element, and `notations` is the <notations> block that
 * holds it.
 */
export type EventNotation = {
  readonly found: XmlElement
  readonly block: ElementReader
  readonly notations: ElementReader
} & (
  | {
      readonly kind:
        Exclude<MarkingKind, 'bowDirection'> | 'fermata' | 'multiNoteTremolo' | 'tuplet'
    }
  | { readonly kind: 'bowDirection'; readonly direction: BowDirectionMarking['direction'] }
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
      for (const [kind, name] of entriesOf(ARTICULATIONS)) {
        for (const found of children(articulations.element, name)) {
          written.push({ kind, found, block: articulations, notations: block })
        }
      }
      for (const found of children(articulations.element, 'caesura')) {
        written.push({ kind: 'caesura', found, block: articulations, notations: block })
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
            const kind = 'bowDirection'
            written.push({ kind, direction, found, block: technical, notations: block })
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
        const kind = type === 'start' || type === 'stop' ? 'multiNoteTremolo' : 'tremolo'
        written.push({ kind, found, block: ornaments, notations: block })
      }
    }

    // MusicXML allows a <notations> to carry several fermatas, one per staff
    // of a part, and several tuplet markers, as when two nested tuplets
    // start on the same note.
    for (const found of children(block.element, 'fermata')) {
      written.push({ kind: 'fermata', found, block, notations: block })
    }
    for (const found of children(block.element, 'tuplet')) {
      written.push({ kind: 'tuplet', found, block, notations: block })
    }
  }
  return written
}

/** The elements written for one kind of event notation, in order. */
export function writtenFor(
  written: readonly EventNotation[],
  kind: EventNotation['kind'],
): readonly EventNotation[] {
  return written.filter((notation) => notation.kind === kind)
}

/** MNX keys the marks by name, so a second of one kind on a note has no home. */
export function reportSecondMark(
  kind: MarkingKind,
  found: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  warnings.addWhole(
    'unrepresentable:marking',
    kind === 'bowDirection'
      ? 'An event carries more than one bow mark, and MNX states one direction. ' +
          'The first is the one converted.'
      : `An event carries more than one <${found.name}>, and MNX states one of each ` +
          'kind. The first is the one converted.',
    context,
    found,
  )
}

interface WrittenDefaults {
  readonly attributes?: Readonly<Record<string, string>>
  /** The text an empty element states, given its attributes. */
  readonly text?: (attributes: Readonly<Record<string, string | undefined>>) => string
}

// What MusicXML takes an element to state where the source leaves it out.
const WRITTEN_DEFAULTS: Readonly<Partial<Record<string, WrittenDefaults>>> = {
  // An empty <fermata> is a normal one, and one stating no type is upright.
  fermata: { text: () => 'normal', attributes: { type: 'upright' } },
  // An empty <caesura> is a normal one.
  caesura: { text: () => 'normal' },
  // A strong accent points up unless it states otherwise.
  'strong-accent': { attributes: { type: 'up' } },
  // A tremolo is on one note unless it states otherwise. An empty one draws
  // three beams, and an unmeasured one none.
  tremolo: {
    attributes: { type: 'single' },
    text: ({ type }) => (type === 'unmeasured' ? '0' : '3'),
  },
  // A marker stating no number is tuplet 1, and it shows the played count
  // and no note value.
  tuplet: { attributes: { number: '1', 'show-number': 'actual', 'show-type': 'none' } },
}

/** An attribute of an element, or what MusicXML takes it to be where it is left out. */
function statedAttribute(found: XmlElement, name: string): string | undefined {
  return found.attributes[name] ?? WRITTEN_DEFAULTS[found.name]?.attributes?.[name]
}

/**
 * Everything an element states: its name, its text, its attributes and its
 * children, with the defaults MusicXML gives what is left out. A count is
 * compared as a number. Where each note's element is drawn is its own, so
 * the attributes placing it are left out.
 */
function statedForm(found: XmlElement): unknown[] {
  const defaults = WRITTEN_DEFAULTS[found.name]
  const stated = { ...defaults?.attributes, ...found.attributes }
  const names = Object.keys(stated)
    .filter((name) => !isPresentationAttribute(name))
    .sort()
  // Compared, not read: reconcile accounts for the element.
  const text = peeking(() => trimmedText(found))
  const count = parseWholeNumber(text)
  return [
    found.name,
    count === undefined ? text || defaults?.text?.(stated) : String(count),
    names.map((name) => [name, stated[name]]),
    found.children.map(statedForm),
  ]
}

// Whether the <notations> block holding a notation is drawn.
function printObject(notation: EventNotation): string {
  return notation.notations.element.attributes['print-object'] ?? 'yes'
}

/**
 * Whether one note's notation states what another's does. A tuplet stop
 * names the bracket it closes and states nothing else, since a bracket is
 * drawn as its start says.
 */
function restates(one: EventNotation, other: EventNotation): boolean {
  if (one.kind === 'tuplet' && statedAttribute(one.found, 'type') === 'stop') return true
  return (
    printObject(one) === printObject(other) &&
    JSON.stringify(statedForm(one.found)) === JSON.stringify(statedForm(other.found))
  )
}

/** Whether two tuplet markers name the same bracket: the same type and number. */
function sameBracket(one: XmlElement, other: XmlElement): boolean {
  return (
    statedAttribute(one, 'type') === statedAttribute(other, 'type') &&
    statedAttribute(one, 'number') === statedAttribute(other, 'number')
  )
}

// The report for a note of a chord that writes a notation another way than
// the note it joins, by what MNX states it as.
const DISAGREEMENTS: Record<
  'marking' | 'fermata' | 'multiNoteTremolo' | 'tuplet',
  { code: WarningCode; ending: string }
> = {
  marking: {
    code: 'inconsistent:marking',
    ending: "MNX states the marks on the event, and the chord's own are the ones converted.",
  },
  fermata: {
    code: 'inconsistent:fermata',
    ending: "MNX states the fermata once for the chord, and the chord's own is the one converted.",
  },
  multiNoteTremolo: {
    code: 'inconsistent:tremolo',
    ending: "MNX states the tremolo once for the chord, and the chord's own is the one converted.",
  },
  tuplet: {
    code: 'inconsistent:tuplet',
    ending: "MNX states the tuplet once for the chord, and the chord's own is the one converted.",
  },
}

/**
 * Reads a note of a chord against the note it joins. Exporters write a
 * chord's notations on every note of it. A notation the same as the chord's
 * own is read, and loses nothing more: the chord's own note reported any
 * loss. A notation written another way is reported. The n-th notation of a
 * kind is compared with the chord's n-th. A tuplet marker is compared with
 * the chord's marker of the same type and number, which names the same
 * bracket.
 *
 * Returns the tuplet markers that name no bracket of the chord's.
 */
export function reconcile(
  chord: readonly EventNotation[],
  member: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): readonly XmlElement[] {
  const own: XmlElement[] = []
  const extraFermatas: EventNotation[] = []
  const seen = new Map<EventNotation['kind'], number>()
  for (const notation of member) {
    const { kind, found } = notation
    const position = seen.get(kind) ?? 0
    seen.set(kind, position + 1)

    const written = writtenFor(chord, kind)
    const peer =
      kind === 'tuplet'
        ? written.find((marker) => sameBracket(marker.found, found))
        : written[position]
    if (peer && restates(peer, notation)) {
      notation.block.readWhole(found)
    } else if (kind === 'tuplet' && !peer) {
      notation.block.read(found)
      own.push(found)
    } else if (kind === 'tuplet' || position === 0) {
      notation.block.read(found)
      reportDisagreement(kind, found, peer !== undefined, warnings, context)
    } else if (kind === 'fermata') {
      extraFermatas.push(notation)
    } else if (kind !== 'multiNoteTremolo') {
      notation.block.read(found)
      reportSecondMark(kind, found, warnings, context)
    }
    // A second two-note tremolo marker stays unread, as it does on the
    // chord's own note.
  }

  // MNX states one fermata, so the ones past the first are lost on every
  // note, and one report covers them.
  const [extra] = extraFermatas
  if (extra) {
    for (const { found, block } of extraFermatas) block.readWhole(found)
    warnings.add(
      'unrepresentable:fermata',
      'A note of a chord carries more than one fermata, and MNX states one on the event. ' +
        (writtenFor(chord, 'fermata').length > 0
          ? "The first fermata of the chord's own note is the one converted."
          : "The chord's own note carries no fermata, so none is converted."),
      context,
      extra.found,
    )
  }
  return own
}

function reportDisagreement(
  kind: EventNotation['kind'],
  found: XmlElement,
  chordWritesOne: boolean,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const reported =
    kind === 'fermata' || kind === 'multiNoteTremolo' || kind === 'tuplet' ? kind : 'marking'
  const { code, ending } = DISAGREEMENTS[reported]
  warnings.addWhole(
    code,
    (chordWritesOne
      ? `A note of a chord carries a <${found.name}> another way than the note it joins. `
      : `A note of a chord carries a <${found.name}> the note it joins does not. `) + ending,
    context,
    found,
  )
}
