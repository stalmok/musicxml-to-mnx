// Reading a <note>: what sounds, for how long, and everything written on it.
//
// This is where most of MusicXML's encoding decisions are met. A <note> is not
// always an event of its own: one carrying <chord> joins the note before it,
// and one carrying <grace> is squeezed in beside the beat. Both are settled
// first, because what follows only applies to a note that stands in the
// cursor's path.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  AccidentalDisplay,
  CurveSide,
  Event,
  Note,
  NoteValue,
  NoteValueQuantity,
  Pitch,
  Step,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, requireChild, trimmedText } from '../xml/tree.js'
import { readDuration } from './divisions.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'
import { readLyrics } from './lyrics.js'
import { noteValueBaseOf, requireNoteValueBase } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { reportUnhandled } from './state.js'
import { MeasureBuilder } from './voices.js'

const HANDLED_IN_NOTE: ReadonlySet<string> = new Set([
  'pitch',
  'rest',
  'duration',
  'type',
  'dot',
  'chord',
  'voice',
  'grace',
  'time-modification',
  'tie',
  'notations',
  'beam',
  'staff',
  'lyric',
  'stem',
  'accidental',
])

// <notations> holds a mixture: some of it is converted, most is not yet. It
// is reported item by item rather than wholesale, so the loss report does not
// claim a slur was dropped when it was carried over.
const HANDLED_IN_NOTATIONS: ReadonlySet<string> = new Set([
  'slur',
  'tuplet',
  // The visual counterpart of <tie>, which is what the tie is read from.
  'tied',
])

// A recogniser rather than a bare set: it narrows the value it accepts to the
// model's type, so a validated value reaches the writer without a cast.
const STEPS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

function isStep(value: string): value is Step {
  return STEPS.has(value)
}

export function readNote(
  element: XmlElement,
  state: PartState,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): void {
  reportUnhandled(element, HANDLED_IN_NOTE, warnings, context)

  const restElement = child(element, 'rest')
  const pitchElement = child(element, 'pitch')
  if (restElement && pitchElement) {
    throw new MusicXMLError('A <note> is both a rest and a pitch.', { path, line: element.line })
  }
  if (!restElement && !pitchElement) {
    throw new MusicXMLError('A <note> has neither <pitch> nor <rest>.', {
      path,
      line: element.line,
    })
  }

  for (const notations of children(element, 'notations')) {
    reportUnhandled(notations, HANDLED_IN_NOTATIONS, warnings, context)
  }

  const voice = child(element, 'voice')?.text.trim()
  const duration = readDuration(element, state, path)
  const written = readWrittenValue(element, path)

  // A note carrying <chord> sounds with the one before it, so it joins that
  // event rather than starting another. It is settled first because it is
  // not an event of its own: it opens no tuplet, and the ratio it repeats
  // belongs to the event it joins.
  if (child(element, 'chord')) {
    if (!pitchElement) {
      throw new MusicXMLError('A rest cannot be part of a chord.', { path, line: element.line })
    }
    const chordNote = readNoteAt(element, pitchElement, state, path)
    builder.addChordNote(voice, chordNote, duration, path, element.line)
    readTies(element, chordNote, state, warnings, context)
    closeTuplets(builder, voice, tupletBrackets(element), path, element.line)
    return
  }

  const brackets = tupletBrackets(element)

  // A tremolo written across two notes gives each of them the value of the
  // pair while the pair lasts only one of them, so its written values
  // overfill the measure exactly as a tuplet's do. MNX states it as a
  // multi-note tremolo, which is not converted yet, and emitting the written
  // values on their own would hand back a measure that does not add up.
  if (hasMultiNoteTremolo(element)) {
    throw new MusicXMLError('A tremolo written across two notes is not converted yet.', {
      path,
      line: element.line,
    })
  }

  // A tremolo on a single note carries no <time-modification> and lasts what
  // it is written as, so only the ornament itself is lost, and that is
  // reported where <ornaments> is.
  const ratio = child(element, 'time-modification')

  // A tuplet is bracketed in the source, and that bracket is what says where
  // one ends and the next begins. Without it there is nothing to group by,
  // and guessing would invent a grouping the source never wrote.
  if (ratio && brackets.length === 0 && !builder.insideTuplet(voice)) {
    throw new MusicXMLError(
      'A note carries a tuplet ratio but no <tuplet> bracket marks where the tuplet runs.',
      { path, line: element.line },
    )
  }

  for (const bracket of brackets) {
    if (bracket === 'start') {
      if (!ratio) {
        throw new MusicXMLError('A tuplet starts on a note with no <time-modification>.', {
          path,
          line: element.line,
        })
      }
      const quantities = readTupletRatio(ratio, element, path)
      builder.openTuplet(voice, quantities.inner, quantities.outer)
    }
  }

  // A rest marked as filling the measure is not an event with a length: MNX
  // states it on the sequence, and how long the measure runs is the time
  // signature's business.
  if (restElement && attribute(restElement, 'measure') === 'yes') {
    builder.setFullMeasure(voice, { visualDuration: written }, duration, path, element.line)
    if (duration) builder.shift(duration, path, element.line)
    return
  }

  if (written && duration) {
    reportDurationMismatch(element, written, duration, warnings, context)
  }

  const value = written ?? measuredValue(element, duration, path)
  const notes: Note[] = pitchElement ? [readNoteAt(element, pitchElement, state, path)] : []
  const staffElement = child(element, 'staff')
  const staff =
    state.staves > 1 && staffElement
      ? readIntegerInRange(staffElement, path, 1, state.staves)
      : undefined

  const event: Event = {
    kind: 'event',
    id: state.ids.nextEvent(),
    staff: undefined,
    value,
    slurs: [],
    lyrics: readLyrics(element, warnings, context, path),
    stemDirection: readStemDirection(element, warnings, context),
    notes,
    isRest: restElement !== undefined,
  }

  // A grace note is squeezed in before the beat and takes none of the
  // measure's time, which is why it carries no <duration>. It joins a group
  // rather than standing in the cursor's path.
  const graceElement = child(element, 'grace')
  if (graceElement) {
    builder.addGraceNote(voice, event, attribute(graceElement, 'slash') === 'yes')
    for (const note of notes) readTies(element, note, state, warnings, context)
    readSlurs(element, event, state, warnings, context)
    return
  }

  // Where the source states no <duration>, the written value is how long the
  // note lasts.
  builder.addEvent(voice, event, duration ?? lengthOf(value), path, element.line, staff)

  for (const note of notes) readTies(element, note, state, warnings, context)
  readSlurs(element, event, state, warnings, context)
  builder.addBeamMarkers(voice, event.id, beamMarkers(element, path))

  closeTuplets(builder, voice, brackets, path, element.line)
}

function closeTuplets(
  builder: MeasureBuilder,
  voice: string | undefined,
  brackets: readonly string[],
  path: DocumentPath,
  line: number,
): void {
  for (const bracket of brackets) {
    if (bracket === 'stop') builder.closeTuplet(voice, path, line)
  }
}

function readStemDirection(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): 'up' | 'down' | undefined {
  const stem = child(element, 'stem')
  if (!stem) return undefined

  const direction = stem.text.trim()
  if (direction === 'up' || direction === 'down') return direction

  // MNX states only up or down; "none" and "double" have nowhere to go.
  warnings.add('unsupported:element', `A <stem> of "${direction}" is not converted yet.`, {
    ...context,
    line: stem.line,
  })
  return undefined
}

const ENCLOSURES = new Map<string, 'parentheses' | 'brackets'>([
  ['parentheses', 'parentheses'],
  ['bracket', 'brackets'],
])

function readNoteAt(
  element: XmlElement,
  pitchElement: XmlElement,
  state: PartState,
  path: DocumentPath,
): Note {
  return {
    id: state.ids.nextNote(),
    pitch: readPitch(pitchElement, path),
    ties: [],
    accidentalDisplay: readAccidentalDisplay(element, state),
  }
}

/**
 * How a note's accidental is drawn, or nothing where the source draws none.
 * MusicXML draws an accidental exactly where it writes an <accidental>, so its
 * presence is what marks the note; a note with an alter but no <accidental> is
 * covered by the key or a note before it.
 */
function readAccidentalDisplay(
  element: XmlElement,
  state: PartState,
): AccidentalDisplay | undefined {
  const accidental = child(element, 'accidental')
  if (!accidental) return undefined

  // The document states its accidentals explicitly, which it declares once.
  state.usesAccidentalDisplay.value = true

  let enclosure: 'parentheses' | 'brackets' | undefined
  for (const [source, symbol] of ENCLOSURES) {
    if (attribute(accidental, source) === 'yes') enclosure = symbol
  }
  return { show: true, enclosure }
}

/**
 * A <tie> says a tie begins or ends on this note. A note in the middle of a
 * chain carries both, which is why every one of them is read.
 */
function readTies(
  element: XmlElement,
  note: Note,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const tie of children(element, 'tie')) {
    const type = attribute(tie, 'type')
    if (type === 'stop') state.spanners.stopTie(note, warnings, context)
    else if (type === 'start') state.spanners.startTie(note, context)
    else {
      // MusicXML 4.0 also has "let-ring", which MNX states as a tie's `lv`.
      warnings.add(
        'unsupported:element',
        `A <tie> of type "${type ?? ''}" is not converted yet.`,
        context,
      )
    }
  }
}

/** Slurs are matched by the number the source gives them, across the part. */
function readSlurs(
  element: XmlElement,
  event: Event,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const slurs = children(element, 'notations').flatMap((notations) => children(notations, 'slur'))

  for (const slur of slurs) {
    const type = attribute(slur, 'type')
    const number = attribute(slur, 'number') ?? '1'
    if (type === 'stop') {
      state.spanners.stopSlur(event, number, warnings, context)
    } else if (type === 'start') {
      state.spanners.startSlur(event, number, slurSide(slur), context)
    } else if (type !== 'continue') {
      // "continue" marks a note partway along a slur. MNX states only where a
      // slur begins and ends, so there is nothing for it to carry, and
      // nothing is lost by passing over it.
      warnings.add(
        'unsupported:element',
        `A <slur> of type "${type ?? ''}" is not converted yet.`,
        context,
      )
    }
  }
}

function slurSide(slur: XmlElement): CurveSide | undefined {
  const placement = attribute(slur, 'placement')
  return placement === 'above' ? 'up' : placement === 'below' ? 'down' : undefined
}

/**
 * What a note says about its beams, by level. A note carries one <beam> per
 * level it is beamed at, so all of them are read: level 1 is the eighth-note
 * beam, level 2 the sixteenth, and so on.
 */
function beamMarkers(element: XmlElement, path: DocumentPath): ReadonlyMap<number, string> {
  const markers = new Map<number, string>()
  for (const beam of children(element, 'beam')) {
    // The level is the attribute; the element's own text says what the beam
    // does there, as "begin" or "end".
    const stated = attribute(beam, 'number')
    if (stated === undefined) {
      markers.set(1, trimmedText(beam))
      continue
    }

    const level = Number(stated)
    if (!/^\d+$/.test(stated) || level < 1 || level > 8) {
      throw new MusicXMLError(`A <beam> is at level "${stated}", which is not a beam level.`, {
        path,
        line: beam.line,
      })
    }
    markers.set(level, trimmedText(beam))
  }
  return markers
}

function hasMultiNoteTremolo(element: XmlElement): boolean {
  return children(element, 'notations').some((notations) =>
    children(notations, 'ornaments').some((ornaments) =>
      children(ornaments, 'tremolo').some((tremolo) => {
        const type = attribute(tremolo, 'type')
        return type === 'start' || type === 'stop'
      }),
    ),
  )
}

/**
 * The tuplet brackets a note carries, in the order they are written. A note
 * may hold several <notations> blocks, and exporters use that: a tie in one,
 * a tuplet marker in another.
 */
function tupletBrackets(element: XmlElement): readonly string[] {
  return children(element, 'notations')
    .flatMap((notations) => children(notations, 'tuplet'))
    .map((tuplet) => attribute(tuplet, 'type'))
    .filter((type): type is string => type !== undefined)
}

/**
 * What a <time-modification> says is played, and the space it is played in.
 * The value counted is <normal-type> where the source gives one, and the
 * note's own written value otherwise.
 */
function readTupletRatio(
  ratio: XmlElement,
  element: XmlElement,
  path: DocumentPath,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } {
  const played = readIntegerInRange(requireChild(ratio, 'actual-notes', path), path, 1, 1_000)
  const space = readIntegerInRange(requireChild(ratio, 'normal-notes', path), path, 1, 1_000)

  const normalType = child(ratio, 'normal-type')
  const value = normalType
    ? { base: requireNoteValueBase(normalType, path), dots: children(ratio, 'normal-dot').length }
    : readWrittenValue(element, path)

  if (!value) {
    throw new MusicXMLError('A tuplet states no note value to count.', {
      path,
      line: ratio.line,
    })
  }

  return { inner: { value, multiple: played }, outer: { value, multiple: space } }
}

/** The value as written: `<type>` plus however many `<dot>`s follow it. */
function readWrittenValue(element: XmlElement, path: DocumentPath): NoteValue | undefined {
  const typeElement = child(element, 'type')
  if (!typeElement) return undefined

  const base = noteValueBaseOf(typeElement)
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(typeElement)}".`, {
      path,
      line: typeElement.line,
    })
  }
  return { base, dots: children(element, 'dot').length }
}

/** The value to use when the note does not say which one is written. */
function measuredValue(
  element: XmlElement,
  duration: Fraction | undefined,
  path: DocumentPath,
): NoteValue {
  if (!duration) {
    throw new MusicXMLError('A <note> states neither a <type> nor a <duration>.', {
      path,
      line: element.line,
    })
  }

  const value = noteValueOf(duration)
  if (!value) {
    throw new MusicXMLError(
      `A <note> lasts ${describeLength(duration)}, which no note value can write. ` +
        'It needs a tuplet, which is not converted yet.',
      { path, line: element.line },
    )
  }
  return value
}

function reportDurationMismatch(
  element: XmlElement,
  written: NoteValue,
  duration: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  if (compareFractions(lengthOf(written), duration) === 0) return

  warnings.add(
    'inconsistent:duration',
    `A <note> is written as ${describeValue(written)} but lasts ` +
      `${describeLength(duration)}. The written value is the one converted.`,
    { ...context, line: element.line },
  )
}

function readPitch(element: XmlElement, path: DocumentPath): Pitch {
  const step = trimmedText(requireChild(element, 'step', path))
  if (!isStep(step)) {
    throw new MusicXMLError(`Unknown pitch step "${step}".`, { path, line: element.line })
  }

  const octave = readIntegerInRange(requireChild(element, 'octave', path), path, 0, 9)
  const alterElement = child(element, 'alter')

  return {
    step,
    octave,
    // MusicXML allows fractional alterations for microtones; MNX's alter is an
    // integer, so anything fractional would have to be rounded, silently
    // retuning the note. Two semitones covers double sharps and flats.
    alter: alterElement ? readIntegerInRange(alterElement, path, -2, 2) : 0,
  }
}
