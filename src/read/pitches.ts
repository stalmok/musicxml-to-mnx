// Reading what a note sounds: its pitch and how its accidental is drawn, or
// the kit component an unpitched note strikes. Also where on the staff a rest
// or an unpitched note is written.

import { readNoteMarkings, reportSlidesOff } from './marks.js'
import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type {
  AccidentalDisplay,
  KitNote,
  Note,
  Pitch,
  PitchedClefSign,
  Step,
} from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, requireChild, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { parseWholeNumber, readIntegerInRange } from './numbers.js'
import type { ClefInForce, PartState } from './state.js'
import type { PitchHeight } from './arpeggios.js'
import { soundingPitch } from './transposition.js'
import { diatonicIndex } from './steps.js'
import { recogniser } from './tables.js'

// A recogniser narrows the value to the model's Step, so no cast is needed,
// and the list and Step are checked against each other in both directions.
const isStep = recogniser<Step>({ A: true, B: true, C: true, D: true, E: true, F: true, G: true })

// The diatonic index of the pitch each clef sign places on its line: G4 for a
// G clef, F3 for an F clef, C4 for a C clef.
const CLEF_REFERENCE: Record<PitchedClefSign, number> = {
  G: diatonicIndex('G', 4),
  F: diatonicIndex('F', 3),
  C: diatonicIndex('C', 4),
}

/**
 * The height a <display-step>/<display-octave> pair states, in steps from the
 * middle of the staff. Exporters state it as they state a pitch, so a clef's
 * octave change moves it too. Undefined where the pair is incomplete or no
 * clef is in force. The caller decides what follows: a rest without a height
 * is drawn at its default, and an unpitched note without one has nowhere to
 * sit.
 */
function displayStaffPosition(
  element: XmlElement,
  staff: number | undefined,
  state: PartState,
): number | undefined {
  const stepElement = child(element, 'display-step')
  const octaveElement = child(element, 'display-octave')

  const step = stepElement ? trimmedText(stepElement).toUpperCase() : ''
  const octave = parseWholeNumber(octaveElement ? trimmedText(octaveElement) : '')
  const clef = state.clefs.get(staff ?? 1)
  if (!isStep(step) || octave === undefined || octave < 0 || octave > 9 || clef === undefined) {
    return undefined
  }

  return pitchStaffPosition({ step, octave, alter: 0 }, clef)
}

/**
 * Where a pitch is drawn on a staff in this clef, in steps from the middle
 * line. A treble-8 clef draws each pitch an octave above where a plain treble
 * clef would.
 */
export function pitchStaffPosition(pitch: Pitch, clef: ClefInForce): number {
  return (
    clef.staffPosition +
    diatonicIndex(pitch.step, pitch.octave) -
    CLEF_REFERENCE[clef.sign] -
    7 * clef.octave
  )
}

/**
 * Places a pitch on a staff of the part as the part stands now, for a mark
 * read once the measure is whole. MNX states the pitch the part sounds, and
 * the staff draws the one it writes.
 */
export function pitchHeights(state: PartState): PitchHeight {
  const clefs = new Map(state.clefs)
  const distance = state.transposition?.staffDistance ?? 0
  return (pitch, staff) => {
    const clef = clefs.get(staff)
    return clef && pitchStaffPosition(pitch, clef) + distance
  }
}

/** A rest's height, with the loss reported where the source states one it cannot place. */
export function restStaffPosition(
  restElement: XmlElement,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): number | undefined {
  // A rest stating neither is drawn at its default height, which is not a loss.
  const stated = child(restElement, 'display-step') ?? child(restElement, 'display-octave')
  if (!stated) return undefined

  const position = displayStaffPosition(restElement, staff, state)
  if (position === undefined) {
    warnings.add(
      'unsupported:element',
      "A rest's staff position, given by <display-step> and <display-octave>, needs " +
        'both and a clef in force to place, which this measure does not give.',
      context,
      stated,
    )
  }
  return position
}

// Where a kit component sits when the source does not say: the middle line,
// which is the one height every staff has.
const UNPLACED_KIT_COMPONENT = 0

/**
 * The kit component an unpitched note strikes, added to the part's kit the
 * first time a note strikes it.
 *
 * MNX names a component once, on the part, and MusicXML tells one from
 * another by the <instrument> each note names. Where a source names none, the
 * height the note is written at stands in for the instrument.
 */
function kitComponent(
  element: ElementReader,
  unpitchedElement: XmlElement,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): string {
  // MusicXML lets a note name more than one instrument, for a note played on
  // several at once. MNX strikes one component per kit note, so the first is
  // the one converted.
  const instruments = element.children('instrument')
  const [named, extra] = instruments
  if (extra) {
    warnings.add(
      'unrepresentable:element',
      `A note is struck on ${String(instruments.length)} instruments at once, and MNX ` +
        'states one for each note of a kit. The first is the one converted.',
      context,
      extra,
    )
  }

  const position = displayStaffPosition(unpitchedElement, staff, state)
  const id = named ? attribute(named, 'id') : undefined
  // A component is an instrument written at a height. MNX places a component
  // once and every note struck on it sits there, so two notes strike the same
  // one only when they agree on both. A part can name one instrument for the
  // whole drumset, and a source can tell two drums apart by instrument alone.
  // Where a source names no instrument, the height is all it gives.
  const source = `${id ?? ''}@${String(position ?? UNPLACED_KIT_COMPONENT)}`

  const existing = state.kitKeys.get(source)
  if (existing !== undefined) return existing

  if (position === undefined) {
    warnings.add(
      'missing:display-step',
      'An unpitched note gives no usable <display-step> and <display-octave> to place it by, or ' +
        'no clef is in force to read them against. It is written on the middle line.',
      context,
      unpitchedElement,
    )
  }
  // The part list holds the name and the sound; the id a note writes is not
  // always one MNX can state, so what the score holds the sound under is what
  // the component names.
  const resolved = id !== undefined ? state.sounds.get(id) : undefined
  if (named && resolved === undefined) {
    warnings.add(
      'unresolved:instrument-id',
      id === undefined
        ? 'A note names an <instrument> with no id, so it names no <score-instrument>.'
        : `The part list has no <score-instrument> with id ${id}.`,
      context,
      named,
    )
  }

  const key = state.ids.nextKitComponent()
  state.kitKeys.set(source, key)
  state.kit.set(key, {
    name: resolved?.name,
    staffPosition: position ?? UNPLACED_KIT_COMPONENT,
    sound: resolved?.key,
  })
  return key
}

export function readNoteAt(
  element: ElementReader,
  pitchElement: XmlElement,
  notations: readonly ElementReader[],
  state: PartState,
  path: DocumentPath,
  staff: number | undefined,
  warnings: WarningCollector,
  context: ReportContext,
): Note {
  // MusicXML writes the pitch the player reads, MNX the pitch the instrument
  // sounds. They differ only for a transposing part, which states the
  // interval between them.
  const written = readPitch(pitchElement, path, warnings, context)
  const markings = readNoteMarkings(notations, warnings, context)

  return {
    id: state.ids.nextNote(),
    pitch: state.transposition ? soundingPitch(written, state.transposition) : written,
    ties: [],
    accidentalDisplay: readAccidentalDisplay(element, pitchElement, warnings, context),
    staff,
    ...(markings ? { markings } : {}),
  }
}

/** The same, for a note struck on a component of the part's percussion kit. */
export function readKitNoteAt(
  element: ElementReader,
  unpitchedElement: XmlElement,
  notations: readonly ElementReader[],
  onStaff: number | undefined,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): KitNote {
  reportSlidesOff(notations, 'kit note', warnings, context)
  return {
    id: state.ids.nextNote(),
    component: kitComponent(element, unpitchedElement, onStaff, state, warnings, context),
    ties: [],
    staff,
  }
}

function readPitch(
  element: XmlElement,
  path: DocumentPath,
  warnings: WarningCollector,
  context: ReportContext,
): Pitch {
  const step = trimmedText(requireChild(element, 'step', path))
  if (!isStep(step)) {
    throw new MusicXMLError(`Unknown pitch step "${step}".`, { path, line: element.line })
  }

  const octave = readIntegerInRange(requireChild(element, 'octave', path), path, 0, 9)
  const alterElement = child(element, 'alter')

  return {
    step,
    octave,
    alter: alterElement ? readAlter(alterElement, path, warnings, context) : 0,
  }
}

// A decimal as MusicXML writes one, which is what <alter> counts semitones
// in. Stricter than Number(), for the same reason as readInteger in numbers.ts.
const DECIMAL_SEMITONES = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * How many semitones a note is altered by. MNX states this as a plain
 * integer, with no range, so a triple sharp goes over as readily as a sharp.
 *
 * MusicXML writes it as a decimal so that a microtone can state a quarter of
 * a semitone. MNX has no fraction of one, so such a note takes the nearest
 * whole alteration and the microtone is reported. A half-way alteration takes
 * the smaller: a three-quarter flat is drawn as a flat rather than as a
 * double flat.
 */
function readAlter(
  element: XmlElement,
  path: DocumentPath,
  warnings: WarningCollector,
  context: ReportContext,
): number {
  const written = trimmedText(element)
  const value = Number(written)
  if (!DECIMAL_SEMITONES.test(written) || !Number.isFinite(value)) {
    throw new MusicXMLError(`<alter> is not a number of semitones: "${written}".`, {
      path,
      line: element.line,
    })
  }
  if (Number.isInteger(value)) return value

  const nearest = Math.sign(value) * Math.ceil(Math.abs(value) - 0.5)
  warnings.add(
    'unrepresentable:microtone',
    `A note is altered by ${written} semitones, which MNX cannot state: its alter is a ` +
      `whole number of them. The note is converted altered by ${String(nearest)}.`,
    context,
    element,
  )
  return nearest === 0 ? 0 : nearest
}

const ENCLOSURES = new Map<string, 'parentheses' | 'brackets'>([
  ['parentheses', 'parentheses'],
  ['bracket', 'brackets'],
])

// Every glyph MusicXML's <accidental> can name.
const ACCIDENTAL_GLYPHS = [
  'sharp',
  'natural',
  'flat',
  'double-sharp',
  'sharp-sharp',
  'flat-flat',
  'natural-sharp',
  'natural-flat',
  'quarter-flat',
  'quarter-sharp',
  'three-quarters-flat',
  'three-quarters-sharp',
  'sharp-down',
  'sharp-up',
  'natural-down',
  'natural-up',
  'flat-down',
  'flat-up',
  'double-sharp-down',
  'double-sharp-up',
  'flat-flat-down',
  'flat-flat-up',
  'arrow-down',
  'arrow-up',
  'triple-sharp',
  'triple-flat',
  'slash-quarter-sharp',
  'slash-sharp',
  'slash-flat',
  'double-slash-flat',
  'sharp-1',
  'sharp-2',
  'sharp-3',
  'sharp-5',
  'flat-1',
  'flat-2',
  'flat-3',
  'flat-4',
  'sori',
  'koron',
  'other',
] as const

type AccidentalGlyph = (typeof ACCIDENTAL_GLYPHS)[number]

const DEFINED_GLYPHS: ReadonlySet<string> = new Set(ACCIDENTAL_GLYPHS)

// The glyph each whole alter is drawn with. MNX draws the accidental a
// note's alter calls for, and states no glyph of its own.
const GLYPH_OF_ALTER = new Map<number, AccidentalGlyph>([
  [-3, 'triple-flat'],
  [-2, 'flat-flat'],
  [-1, 'flat'],
  [0, 'natural'],
  [1, 'sharp'],
  [2, 'double-sharp'],
  [3, 'triple-sharp'],
])

/**
 * How a note's accidental is drawn, or nothing where the source draws none.
 * MusicXML draws an accidental where it writes an <accidental>, so its
 * presence is what marks the note; a note with an alter but no <accidental> is
 * covered by the key or a note before it.
 */
function readAccidentalDisplay(
  element: ElementReader,
  pitch: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): AccidentalDisplay | undefined {
  const accidental = element.child('accidental')
  if (!accidental) return undefined

  // readPitch has already refused an alter that is not a number. A microtone
  // is reported where its alter is read, and its glyph goes with that loss.
  const alterElement = child(pitch, 'alter')
  const alter = alterElement ? Number(trimmedText(alterElement)) : 0
  const glyph = trimmedText(accidental)
  const drawn = GLYPH_OF_ALTER.get(alter)
  if (!DEFINED_GLYPHS.has(glyph)) {
    warnings.addUndefinedText(
      accidental,
      'and the accidental the alter calls for is drawn instead.',
      context,
    )
  } else if (Number.isInteger(alter) && glyph !== drawn) {
    // A SMuFL name states the glyph more closely, and goes with it.
    const smufl = attribute(accidental, 'smufl')
    const named =
      glyph === 'other' && smufl !== undefined ? `the SMuFL glyph "${smufl}"` : `"${glyph}"`
    warnings.add(
      'unrepresentable:accidental',
      `An accidental drawn as ${named} cannot be expressed in MNX, which draws the one ` +
        `the note's alter of ${String(alter)} calls for` +
        (drawn !== undefined ? `, "${drawn}".` : '.'),
      context,
      accidental,
    )
  }

  let enclosure: 'parentheses' | 'brackets' | undefined
  for (const [source, symbol] of ENCLOSURES) {
    if (attribute(accidental, source) === 'yes') enclosure = symbol
  }

  // A cautionary or editorial accidental is drawn though the key or a note
  // before it would not require it, which is what MNX's `force` states.
  const forced =
    attribute(accidental, 'cautionary') === 'yes' || attribute(accidental, 'editorial') === 'yes'

  return { show: true, enclosure, ...(forced ? { force: true } : {}) }
}
