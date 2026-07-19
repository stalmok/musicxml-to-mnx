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
  Key,
  Measure,
  Note,
  NoteValue,
  NoteValueBase,
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
const HANDLED_IN_ATTRIBUTES: ReadonlySet<string> = new Set(['divisions', 'key', 'time', 'clef'])
const HANDLED_IN_NOTE: ReadonlySet<string> = new Set([
  'pitch',
  'rest',
  'duration',
  'type',
  'dot',
  'chord',
  'voice',
  'grace',
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
  const readings = children(root, 'part').map((element) => readPart(element, names, warnings, path))

  const globalMeasures: GlobalMeasure[] = []
  for (const reading of readings) {
    mergeGlobalMeasures(globalMeasures, reading.globals)
  }

  return { globalMeasures, parts: readings.map((reading) => reading.part) }
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

  const state: PartState = { divisions: undefined }
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(measureElement, index, id, state, warnings, partPath),
  )

  return {
    part: { id, name: names.get(id), measures: readings.map((reading) => reading.measure) },
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

        const keyElement = child(found, 'key')
        if (keyElement) key ??= readKey(keyElement, measurePath)

        const timeElement = child(found, 'time')
        if (timeElement) time ??= readTime(timeElement, measurePath)

        for (const clefElement of children(found, 'clef')) {
          clefs.push(readClef(clefElement, measurePath))
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

  return {
    measure: { clefs, sequences: builder.sequences() },
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

function readClef(element: XmlElement, path: DocumentPath): Clef {
  const sign = trimmedText(requireChild(element, 'sign', path))
  if (!isClefSign(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = child(element, 'line')
  const line = lineElement ? readIntegerInRange(lineElement, path, 1, 5) : DEFAULT_CLEF_LINES[sign]

  // MusicXML counts staff lines from 1 at the bottom; MNX counts staff steps
  // from 0 at the middle line. On a five-line staff they differ by this.
  return { sign, staffPosition: 2 * line - 6 }
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

  const voice = child(element, 'voice')?.text.trim()
  const duration = readDuration(element, state, path)
  const written = readWrittenValue(element, path)

  // A grace note is squeezed in before the beat and takes none of the
  // measure's time, which is why it carries no <duration>. Until grace groups
  // are converted it has to be left out; what it must not do in the meantime
  // is stand in as an ordinary note, which would give it a length it does not
  // have and shift everything after it.
  // A tuplet's written value is deliberately longer than it sounds, so
  // converting the note on its own would emit a measure that does not add up.
  // The same music without a <type> is already rejected below; this makes the
  // ordinary case behave the same rather than quietly handing back a wrong
  // rhythm.
  if (child(element, 'time-modification')) {
    throw new MusicXMLError('A note inside a tuplet is not converted yet.', {
      path,
      line: element.line,
    })
  }

  if (child(element, 'grace')) {
    warnings.add('unsupported:element', 'A grace note is not converted yet, and is left out.', {
      ...context,
      line: element.line,
    })
    return
  }

  // A note carrying <chord> sounds with the one before it, so it joins that
  // event rather than starting another.
  if (child(element, 'chord')) {
    if (!pitchElement) {
      throw new MusicXMLError('A rest cannot be part of a chord.', { path, line: element.line })
    }
    builder.addChordNote(
      voice,
      { pitch: readPitch(pitchElement, path) },
      duration,
      path,
      element.line,
    )
    return
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
  const notes: Note[] = pitchElement ? [{ pitch: readPitch(pitchElement, path) }] : []
  const event: Event = { kind: 'event', value, notes, isRest: restElement !== undefined }

  // Where the source states no <duration>, the written value is how long the
  // note lasts.
  builder.addEvent(voice, event, duration ?? lengthOf(value), path, element.line)
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
