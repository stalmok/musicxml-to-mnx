// Reads a MusicXML document into the neutral score model. Everything this
// converter knows about MusicXML's encoding lives at or below this file.
//
// Two rules shape it: input that is structurally broken, or that we cannot
// convert faithfully, raises a MusicXMLError rather than being guessed at;
// and any element carrying notation we do not convert is reported as a
// warning rather than passed over in silence.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  Clef,
  ClefSign,
  Event,
  GlobalMeasure,
  AccidentalDisplay,
  Key,
  Lyric,
  Measure,
  Note,
  NoteValue,
  NoteValueBase,
  NoteValueQuantity,
  Part,
  Pitch,
  Score,
  Step,
  TimeSignature,
  TimeUnit,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import {
  attribute,
  child,
  children,
  requireAttribute,
  requireChild,
  trimmedText,
} from '../xml/tree.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'
import { buildBeams } from './beams.js'
import { IdGenerator, SpannerResolver } from './spanners.js'
import { MeasureBuilder } from './voices.js'

// MusicXML's note types, in MNX's spelling. The two agree everywhere except
// MusicXML's "long", which MNX calls "longa".
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

// Recognisers rather than bare sets: each one narrows the value it accepts to
// the model's type, so a validated value reaches the writer without a cast
// and an unvalidated one cannot.
const STEPS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
const CLEF_SIGNS: ReadonlySet<string> = new Set(['C', 'F', 'G'])
const TIME_UNITS: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 32, 64, 128])

function isStep(value: string): value is Step {
  return STEPS.has(value)
}

function isClefSign(value: string): value is ClefSign {
  return CLEF_SIGNS.has(value)
}

function isTimeUnit(value: number): value is TimeUnit {
  return TIME_UNITS.has(value)
}

// The line a clef sits on when it doesn't say, per MusicXML's defaults. A
// record keyed by the sign type, not a Map, so every sign is required to have
// one and the lookup cannot come back empty.
const DEFAULT_CLEF_LINES: Record<ClefSign, number> = { G: 2, F: 4, C: 3 }

// Elements consumed at each level. Anything else found there carries notation
// we don't convert yet, and is reported.
const HANDLED_IN_SCORE: ReadonlySet<string> = new Set(['part-list', 'part'])
// <backup> and <forward> only state how far to move. A <voice> or <staff> on
// one says which voice the skipped time belongs to, which the model cannot
// yet express.
const HANDLED_IN_CURSOR_MOVE: ReadonlySet<string> = new Set(['duration'])
const HANDLED_IN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'divisions',
  'key',
  'time',
  'clef',
  'staves',
])
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

interface PartReading {
  part: Part
  /** What this part declared for each of its measures, by position. */
  globals: readonly GlobalMeasure[]
}

/**
 * What a part carries from one measure to the next. `<divisions>` is stated
 * once and stays in force until restated, so a measure is not readable on its
 * own.
 */
interface PartState {
  divisions: number | undefined
  /** Shared across the score: true once any accidental is drawn. */
  usesAccidentalDisplay: { value: boolean }
  /** How many staves the part is written on, once it says. */
  staves: number
  /** Shared across the score, so every id in the document is distinct. */
  ids: IdGenerator
  /** Per part: a tie or slur may span measures, but not parts. */
  spanners: SpannerResolver
}

interface MeasureReading {
  measure: Measure
  global: GlobalMeasure
}

export function readScore(root: XmlElement, warnings: WarningCollector): Score {
  if (root.name !== 'score-partwise') {
    throw new MusicXMLError(
      root.name === 'score-timewise'
        ? 'Timewise MusicXML is not supported; convert it to partwise first.'
        : `Expected a <score-partwise> document, found <${root.name}>.`,
      { line: root.line },
    )
  }

  const path: DocumentPath = ['score-partwise']
  reportUnhandled(root, HANDLED_IN_SCORE, warnings, {})

  const names = readPartNames(root)
  const ids = new IdGenerator()
  const usesAccidentalDisplay = { value: false }
  const readings = children(root, 'part').map((element) =>
    readPart(element, names, ids, usesAccidentalDisplay, warnings, path),
  )

  const globalMeasures: GlobalMeasure[] = []
  for (const reading of readings) {
    mergeGlobalMeasures(globalMeasures, reading.globals)
  }

  return {
    globalMeasures,
    parts: readings.map((reading) => reading.part),
    usesAccidentalDisplay: usesAccidentalDisplay.value,
  }
}

// Parts restate the same key and time; the first to declare one wins, so a
// later part repeating it is not treated as a change. The result is as long
// as the longest part, because that list is the score's measure list.
function mergeGlobalMeasures(target: GlobalMeasure[], found: readonly GlobalMeasure[]): void {
  found.forEach((measure, index) => {
    const existing = target[index]
    target[index] = {
      key: existing?.key ?? measure.key,
      time: existing?.time ?? measure.time,
      number: existing?.number ?? measure.number,
    }
  })
}

function readPartNames(root: XmlElement): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const list = child(root, 'part-list')
  if (!list) return names

  for (const scorePart of children(list, 'score-part')) {
    const id = attribute(scorePart, 'id')
    const name = child(scorePart, 'part-name')?.text.trim()
    // An empty <part-name> states no name, so it is not one.
    if (id !== undefined && name) names.set(id, name)
  }
  return names
}

function readPart(
  element: XmlElement,
  names: ReadonlyMap<string, string>,
  ids: IdGenerator,
  usesAccidentalDisplay: { value: boolean },
  warnings: WarningCollector,
  path: DocumentPath,
): PartReading {
  // Required by MusicXML, and what ties a part to its name and to every
  // warning reported against it.
  const id = requireAttribute(element, 'id', path)
  const partPath: DocumentPath = [...path, `part ${id}`]

  if (names.size > 0 && !names.has(id)) {
    warnings.add('unresolved:part-id', `The part list has no entry for part ${id}.`, {
      part: id,
      line: element.line,
    })
  }

  const state: PartState = {
    divisions: undefined,
    staves: 1,
    ids,
    usesAccidentalDisplay,
    spanners: new SpannerResolver(),
  }
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(measureElement, index, id, state, warnings, partPath),
  )
  // Whatever is still open once the part ends is never going to close.
  state.spanners.reportUnclosed(warnings, partPath)

  return {
    part: {
      id,
      name: names.get(id),
      staves: state.staves,
      measures: readings.map((reading) => reading.measure),
    },
    globals: readings.map((reading) => reading.global),
  }
}

function readMeasure(
  element: XmlElement,
  index: number,
  partId: string,
  state: PartState,
  warnings: WarningCollector,
  path: DocumentPath,
): MeasureReading {
  const position = index + 1
  const context: WarningContext = { part: partId, measure: position }
  const stated = readMeasureLabel(element, warnings, context)
  const measurePath: DocumentPath = [...path, `measure ${String(stated ?? position)}`]

  const clefs: Clef[] = []
  let key: Key | undefined
  let time: TimeSignature | undefined

  const builder = new MeasureBuilder()

  // Walked in document order, because MusicXML states a measure as one stream
  // with a cursor running through it: what a <note> means depends on the
  // <backup> before it, and on the <divisions> in force by the time it is
  // reached. A measure may carry more than one <attributes> for that reason.
  for (const found of element.children) {
    switch (found.name) {
      case 'attributes': {
        reportUnhandled(found, HANDLED_IN_ATTRIBUTES, warnings, context)

        const divisionsElement = child(found, 'divisions')
        if (divisionsElement) {
          state.divisions = readIntegerInRange(divisionsElement, measurePath, 1, 1_000_000)
        }

        const stavesElement = child(found, 'staves')
        if (stavesElement) {
          state.staves = readIntegerInRange(stavesElement, measurePath, 1, 16)
        }

        // MusicXML allows one key and one time signature per staff. MNX
        // states them for the whole score, so staves that disagree cannot
        // both be carried.
        const keys = children(found, 'key').map((element) => readKey(element, measurePath))
        if (keys.length > 0) key ??= keys[0]
        if (keys.some((other) => other.fifths !== keys[0]?.fifths)) {
          warnings.add(
            'unsupported:per-staff-key',
            'The staves of this part are in different keys, and MNX states one key for ' +
              'the score. The first is the one converted.',
            { ...context, line: found.line },
          )
        }

        const times = children(found, 'time').map((element) => readTime(element, measurePath))
        if (times.length > 0) time ??= times[0]
        if (
          times.some((other) => other.count !== times[0]?.count || other.unit !== times[0]?.unit)
        ) {
          warnings.add(
            'unsupported:per-staff-time',
            'The staves of this part are in different time signatures, and MNX states one ' +
              'for the score. The first is the one converted.',
            { ...context, line: found.line },
          )
        }

        for (const clefElement of children(found, 'clef')) {
          clefs.push(readClef(clefElement, state, measurePath))
        }
        break
      }

      case 'note':
        readNote(found, state, builder, warnings, context, measurePath)
        break

      // Both only move the cursor: <backup> against the flow of the measure,
      // <forward> with it.
      case 'backup':
      case 'forward': {
        reportUnhandled(found, HANDLED_IN_CURSOR_MOVE, warnings, context)
        const by = requireDuration(found, state, measurePath)
        builder.shift(found.name === 'backup' ? negate(by) : by, measurePath, found.line)
        break
      }

      default:
        warnings.add('unsupported:element', `<${found.name}> is not converted yet.`, {
          ...context,
          line: found.line,
        })
    }
  }

  builder.checkAllClosed(measurePath, element.line)

  // Beams are stated over the measure in MNX rather than on the notes, and
  // each voice is beamed on its own.
  const beams = builder.beamedEvents().flatMap((events) => buildBeams(events))

  return {
    measure: { clefs, beams, sequences: builder.sequences() },
    // Only worth carrying when it differs from where the measure sits;
    // otherwise MNX's implicit numbering already says it.
    global: { key, time, number: stated !== position ? stated : undefined },
  }
}

/**
 * The number the score gives the measure, when it is one. Scores label split
 * measures "3a" and pickups "0"; the former has nowhere to go in MNX.
 */
function readMeasureLabel(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): number | undefined {
  const written = attribute(element, 'number')
  if (written === undefined) return undefined

  const value = Number(written)
  if (!/^-?\d+$/.test(written) || !Number.isSafeInteger(value)) {
    warnings.add(
      'unsupported:measure-label',
      `The measure label "${written}" is not a number, and is not carried over.`,
      { ...context, line: element.line },
    )
    return undefined
  }
  return value
}

function readKey(element: XmlElement, path: DocumentPath): Key {
  // Seven accidentals is the practical limit; beyond eleven a key signature
  // cannot be written at all, so anything larger is a corrupt file.
  return { fifths: readIntegerInRange(requireChild(element, 'fifths', path), path, -11, 11) }
}

function readTime(element: XmlElement, path: DocumentPath): TimeSignature {
  const count = readInteger(requireChild(element, 'beats', path), path)
  if (count <= 0) {
    throw new MusicXMLError(`A time signature has ${String(count)} beats.`, {
      path,
      line: element.line,
    })
  }

  const unitElement = requireChild(element, 'beat-type', path)
  const unit = readInteger(unitElement, path)
  if (!isTimeUnit(unit)) {
    throw new MusicXMLError(
      `A time signature's unit of ${String(unit)} cannot be written as a note value.`,
      { path, line: unitElement.line },
    )
  }

  return { count, unit }
}

function readClef(element: XmlElement, state: PartState, path: DocumentPath): Clef {
  const sign = trimmedText(requireChild(element, 'sign', path))
  if (!isClefSign(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = child(element, 'line')
  const line = lineElement ? readIntegerInRange(lineElement, path, 1, 5) : DEFAULT_CLEF_LINES[sign]

  // A clef says which staff it belongs to, which only matters where the part
  // has more than one.
  const stated = attribute(element, 'number')
  const staff = state.staves > 1 && stated !== undefined ? Number(stated) : undefined

  // MusicXML counts staff lines from 1 at the bottom; MNX counts staff steps
  // from 0 at the middle line. On a five-line staff they differ by this.
  return { sign, staffPosition: 2 * line - 6, staff }
}

function readNote(
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

// MusicXML's syllabic values, in MNX's spelling. A syllable standing on its
// own carries no type in MNX, so "single", and no syllabic at all, map to
// nothing. Anything outside these is not a syllabic value.
const LYRIC_TYPES = new Map<string, 'start' | 'middle' | 'end' | undefined>([
  ['single', undefined],
  ['begin', 'start'],
  ['middle', 'middle'],
  ['end', 'end'],
])

/** The syllables under a note, one per verse. A note carries one <lyric> each. */
function readLyrics(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Lyric[] {
  return children(element, 'lyric').map((lyric) => {
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
      const placement = attribute(slur, 'placement')
      const side = placement === 'above' ? 'up' : placement === 'below' ? 'down' : undefined
      state.spanners.startSlur(event, number, side, context)
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

function requireNoteValueBase(element: XmlElement, path: DocumentPath): NoteValueBase {
  const base = NOTE_VALUE_BASES.get(trimmedText(element))
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(element)}".`, {
      path,
      line: element.line,
    })
  }
  return base
}

/** The duration of a <backup> or <forward>, which must state one. */
function requireDuration(element: XmlElement, state: PartState, path: DocumentPath): Fraction {
  const duration = readDuration(element, state, path)
  if (!duration) {
    throw new MusicXMLError(`A <${element.name}> states no <duration>.`, {
      path,
      line: element.line,
    })
  }
  return duration
}

function negate(value: Fraction): Fraction {
  return fraction(-value.num, value.den)
}

/** The value as written: `<type>` plus however many `<dot>`s follow it. */
function readWrittenValue(element: XmlElement, path: DocumentPath): NoteValue | undefined {
  const typeElement = child(element, 'type')
  if (!typeElement) return undefined

  const base = NOTE_VALUE_BASES.get(trimmedText(typeElement))
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(typeElement)}".`, {
      path,
      line: typeElement.line,
    })
  }
  return { base, dots: children(element, 'dot').length }
}

/** How long the note lasts, as a fraction of a whole note. */
function readDuration(
  element: XmlElement,
  state: PartState,
  path: DocumentPath,
): Fraction | undefined {
  const durationElement = child(element, 'duration')
  if (!durationElement) return undefined

  if (state.divisions === undefined) {
    throw new MusicXMLError('A <duration> appears before any <divisions> said how long one is.', {
      path,
      line: durationElement.line,
    })
  }

  // <divisions> counts per quarter note, and a whole note is four of those.
  const count = readIntegerInRange(durationElement, path, 0, 1_000_000_000)
  return fraction(count, state.divisions * 4)
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

function readInteger(element: XmlElement, path: DocumentPath): number {
  // Deliberately stricter than Number(), which reads "0x10" as 16 and "1e3"
  // as 1000. Reinterpreting a score's digits is the kind of guessing this
  // converter exists to avoid.
  const text = trimmedText(element)
  const value = Number(text)
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value)) {
    throw new MusicXMLError(`<${element.name}> is not a whole number: "${text}".`, {
      path,
      line: element.line,
    })
  }
  return value
}

function readIntegerInRange(
  element: XmlElement,
  path: DocumentPath,
  min: number,
  max: number,
): number {
  const value = readInteger(element, path)
  if (value < min || value > max) {
    throw new MusicXMLError(
      `<${element.name}> is ${String(value)}, outside the range ${String(min)} to ${String(max)}.`,
      { path, line: element.line },
    )
  }
  return value
}

function reportUnhandled(
  element: XmlElement,
  handled: ReadonlySet<string>,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const found of element.children) {
    if (handled.has(found.name)) continue
    warnings.add('unsupported:element', `<${found.name}> is not converted yet.`, {
      ...context,
      line: found.line,
    })
  }
}
