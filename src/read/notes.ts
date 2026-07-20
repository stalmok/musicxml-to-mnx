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
  Marking,
  MarkingKind,
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
import type { ElementReader } from './element.js'
import { readLyrics } from './lyrics.js'
import { noteValueBaseOf, requireNoteValueBase } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { MeasureBuilder } from './voices.js'

// A recogniser rather than a bare set: it narrows the value it accepts to the
// model's type, so a validated value reaches the writer without a cast.
const STEPS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

function isStep(value: string): value is Step {
  return STEPS.has(value)
}

export function readNote(
  element: ElementReader,
  state: PartState,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): void {
  const restElement = element.child('rest')
  const pitchElement = element.child('pitch')
  if (restElement && pitchElement) {
    throw new MusicXMLError('A <note> is both a rest and a pitch.', { path, line: element.line })
  }
  if (!restElement && !pitchElement) {
    throw new MusicXMLError('A <note> has neither <pitch> nor <rest>.', {
      path,
      line: element.line,
    })
  }

  const notations = element.blocks('notations')
  // <tied> is the visual counterpart of <tie>, which is what the tie is read
  // from, so a document stating both loses nothing by this reader ignoring it.
  for (const block of notations) block.skip('tied')

  const voice = element.child('voice')?.text.trim()
  const duration = readDuration(element, state, path)
  const written = readWrittenValue(element, path)
  const graceElement = element.child('grace')

  // Which staff the note names. Read and bounded whatever the part has, so
  // that a note naming a staff before <staves> said the part had one is
  // rejected rather than quietly placed on the first. It is only worth
  // stating where the part has more than one staff to choose between.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  // A note carrying <chord> sounds with the one before it, so it joins that
  // event rather than starting another. It is settled first because it is
  // not an event of its own: it opens no tuplet, and the ratio it repeats
  // belongs to the event it joins.
  if (element.child('chord')) {
    if (!pitchElement) {
      throw new MusicXMLError('A rest cannot be part of a chord.', { path, line: element.line })
    }
    // A chord member is drawn with the event it joins, so its stem and its
    // beams are that event's and are read from the note carrying them. The
    // ratio it repeats is likewise the event's.
    element.skip('stem', 'beam', 'time-modification')

    // MNX states the staff on the event, so every note of a chord is on the
    // event's staff. One naming a different staff is reaching across on its
    // own, which is the one thing here that cannot be carried.
    if (staff !== undefined && staff !== builder.staffOfChord(voice)) {
      warnings.add(
        'unrepresentable:chord-staff',
        'A <note> in a chord is on a different staff from the chord, and MNX states ' +
          'the staff for the whole chord.',
        { ...context, line: element.line },
        'staff',
      )
    }

    const chordNote = readNoteAt(element, pitchElement, state, path)
    builder.addChordNote(voice, chordNote, duration, path, element.line)
    readTies(element, chordNote, state, warnings, context)
    closeTuplets(builder, voice, tupletBrackets(notations), path, element.line)
    return
  }

  const brackets = tupletBrackets(notations)

  // A tremolo written across two notes gives each of them the value of the
  // pair while the pair lasts only one of them, so its written values
  // overfill the measure exactly as a tuplet's do. MNX states it as a
  // multi-note tremolo, which is not converted yet, and emitting the written
  // values on their own would hand back a measure that does not add up.
  if (hasMultiNoteTremolo(notations)) {
    throw new MusicXMLError('A tremolo written across two notes is not converted yet.', {
      path,
      line: element.line,
    })
  }

  // A tremolo on a single note carries no <time-modification> and lasts what
  // it is written as, so only the ornament itself is lost, and that is
  // reported where <ornaments> is.
  const ratio = element.child('time-modification')

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
    // A rest is not drawn with a stem, and a beam over one alone is not a
    // beam, so a source stating either says nothing this loses.
    element.skip('stem', 'beam')

    builder.setFullMeasure(voice, { visualDuration: written }, duration, staff, path, element.line)
    if (duration) builder.shift(duration, path, element.line)
    return
  }

  if (written && duration) {
    reportDurationMismatch(element, written, duration, warnings, context)
  }

  const value = written ?? measuredValue(element, duration, path)
  const notes: Note[] = pitchElement ? [readNoteAt(element, pitchElement, state, path)] : []

  const event: Event = {
    kind: 'event',
    id: state.ids.nextEvent(),
    staff: undefined,
    value,
    slurs: [],
    lyrics: readLyrics(element, warnings, context),
    stemDirection: readStemDirection(element, warnings, context),
    markings: readMarkings(notations),
    notes,
    isRest: restElement !== undefined,
  }

  // A grace note is squeezed in before the beat and takes none of the
  // measure's time, which is why it carries no <duration>. It joins a group
  // rather than standing in the cursor's path.
  if (graceElement) {
    builder.addGraceNote(voice, event, attribute(graceElement, 'slash') === 'yes', staff)
    for (const note of notes) readTies(element, note, state, warnings, context)
    readSlurs(notations, event, state, warnings, context)
    builder.addBeamMarkers(voice, event.id, beamMarkers(element, path), true)
    return
  }

  // Where the source states no <duration>, the written value is how long the
  // note lasts.
  builder.addEvent(voice, event, duration ?? lengthOf(value), path, element.line, staff)

  for (const note of notes) readTies(element, note, state, warnings, context)
  readSlurs(notations, event, state, warnings, context)
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

// MusicXML's <articulations> children, in MNX's spelling. Everything else it
// allows there, from a caesura to a falloff, has no home in event-markings and
// stays unread, which is what reports it.
const ARTICULATIONS = new Map<string, MarkingKind>([
  ['accent', 'accent'],
  ['staccato', 'staccato'],
  ['staccatissimo', 'staccatissimo'],
  ['tenuto', 'tenuto'],
  ['spiccato', 'spiccato'],
  ['stress', 'stress'],
  ['unstress', 'unstress'],
  ['soft-accent', 'softAccent'],
  ['strong-accent', 'strongAccent'],
  // MusicXML files a breath mark among the articulations; MNX states it
  // beside them, under its own name.
  ['breath-mark', 'breath'],
])

/**
 * The marks written on this event. Read in a fixed order rather than the
 * source's, because MNX keys them by name, so a note carries at most one of
 * each and the order they were written in is not part of what it says.
 */
function readMarkings(notations: readonly ElementReader[]): Marking[] {
  const markings: Marking[] = []

  for (const block of notations) {
    for (const articulations of block.blocks('articulations')) {
      for (const [written, kind] of ARTICULATIONS) {
        for (const found of articulations.children(written)) {
          markings.push({
            kind,
            orient: placementOf(found),
            // Which way the wedge of a strong accent points.
            pointing: kind === 'strongAccent' ? upOrDown(attribute(found, 'type')) : undefined,
            // A breath mark names its glyph as its text: a comma, a tick.
            symbol: kind === 'breath' ? trimmedText(found) || undefined : undefined,
          })
        }
      }
    }
  }
  return markings
}

function placementOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

function upOrDown(value: string | undefined): 'up' | 'down' | undefined {
  return value === 'up' || value === 'down' ? value : undefined
}

function readStemDirection(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): 'up' | 'down' | undefined {
  const stem = element.child('stem')
  if (!stem) return undefined

  const direction = stem.text.trim()
  if (direction === 'up' || direction === 'down') return direction

  // MNX's stem direction is up or down and nothing else, so "none" and
  // "double" have nowhere to go.
  warnings.add(
    'unrepresentable:stem-direction',
    `A <stem> of "${direction}" cannot be expressed in MNX, which states only up or down.`,
    { ...context, line: stem.line },
    'stem',
  )
  return undefined
}

const ENCLOSURES = new Map<string, 'parentheses' | 'brackets'>([
  ['parentheses', 'parentheses'],
  ['bracket', 'brackets'],
])

function readNoteAt(
  element: ElementReader,
  pitchElement: XmlElement,
  state: PartState,
  path: DocumentPath,
): Note {
  return {
    id: state.ids.nextNote(),
    pitch: readPitch(pitchElement, path),
    ties: [],
    accidentalDisplay: readAccidentalDisplay(element),
  }
}

/**
 * How a note's accidental is drawn, or nothing where the source draws none.
 * MusicXML draws an accidental exactly where it writes an <accidental>, so its
 * presence is what marks the note; a note with an alter but no <accidental> is
 * covered by the key or a note before it.
 */
function readAccidentalDisplay(element: ElementReader): AccidentalDisplay | undefined {
  const accidental = element.child('accidental')
  if (!accidental) return undefined

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
  element: ElementReader,
  note: Note,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const tie of element.children('tie')) {
    const type = attribute(tie, 'type')
    if (type === 'stop') state.spanners.stopTie(note, warnings, context)
    else if (type === 'start') state.spanners.startTie(note, context)
    else {
      // MusicXML 4.0 also has "let-ring", which MNX states as a tie's `lv`.
      warnings.add(
        'unsupported:element',
        `A <tie> of type "${type ?? ''}" is not converted yet.`,
        context,
        'tie',
      )
    }
  }
}

/** Slurs are matched by the number the source gives them, across the part. */
function readSlurs(
  notations: readonly ElementReader[],
  event: Event,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const slur of notations.flatMap((block) => block.children('slur'))) {
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
        'slur',
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
function beamMarkers(element: ElementReader, path: DocumentPath): ReadonlyMap<number, string> {
  const markers = new Map<number, string>()
  for (const beam of element.children('beam')) {
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

function hasMultiNoteTremolo(notations: readonly ElementReader[]): boolean {
  return notations.some((block) =>
    // Left unread on purpose: <ornaments> carries much this converter does
    // not handle, so it stays in the loss report either way.
    children(block.element, 'ornaments').some((ornaments) =>
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
function tupletBrackets(notations: readonly ElementReader[]): readonly string[] {
  return notations
    .flatMap((block) => block.children('tuplet'))
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
  element: ElementReader,
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
function readWrittenValue(element: ElementReader, path: DocumentPath): NoteValue | undefined {
  const typeElement = element.child('type')
  // <dot> is read either way: a note with dots and no <type> has still stated
  // them, and leaving them unread would report them as a loss.
  const dots = element.children('dot').length
  if (!typeElement) return undefined

  const base = noteValueBaseOf(typeElement)
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(typeElement)}".`, {
      path,
      line: typeElement.line,
    })
  }
  return { base, dots }
}

/** The value to use when the note does not say which one is written. */
function measuredValue(
  element: ElementReader,
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
  element: ElementReader,
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
    'note',
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
