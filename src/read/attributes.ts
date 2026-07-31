// Reading an <attributes> block: what is in force from here on, and the clefs
// drawn at this point.
//
// A measure may carry more than one of these, because a clef can change
// partway through, so what they declare is folded into the measure in the
// order they are met.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { Fraction } from '../fraction.js'
import type { Clef, ClefSign, Key, TimeSignature, TimeUnit } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, requireChild, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { readAttributeInRange, readInteger, readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { reportHidden } from './unrepresentable.js'

// Recognisers rather than bare sets: each one narrows the value it accepts to
// the model's type, so a validated value reaches the writer without a cast
// and an unvalidated one cannot.
const CLEF_SIGNS: ReadonlySet<string> = new Set(['C', 'F', 'G'])
const TIME_UNITS: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 32, 64, 128])

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

/** What one <attributes> block declared. */
export interface AttributesReading {
  /**
   * Whether the block stated a key or a time at all. Held apart from the
   * values: a statement MNX cannot carry, such as senza misura or a
   * non-traditional key, is a statement with no value, which is not the same
   * as the block saying nothing.
   */
  keyStated: boolean
  timeStated: boolean
  key: Key | undefined
  time: TimeSignature | undefined
  clefs: Clef[]
}

export function readAttributes(
  element: ElementReader,
  state: PartState,
  // Where the measure's cursor has reached, which is where a clef declared
  // here is drawn: a clef can change partway through a measure.
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): AttributesReading {
  const divisionsElement = element.child('divisions')
  if (divisionsElement) {
    state.divisions = readIntegerInRange(divisionsElement, path, 1, 1_000_000)
    state.divisionsAssumed = false
  }

  const stavesElement = element.child('staves')
  if (stavesElement) {
    state.staves = readIntegerInRange(stavesElement, path, 1, 16)
  }

  // MusicXML allows one key and one time signature per staff. MNX states them
  // for the whole score, so staves that disagree cannot both be carried.
  //
  // Read as blocks, not raw children, so that whatever these readers pass over
  // inside a <key>, <time> or <clef> is reported along with the rest of the
  // measure rather than vanishing a level down.
  const keyBlocks = element.blocks('key')
  const keys = keyBlocks
    .map((found) => readKey(found, warnings, context, path))
    .filter((key): key is Key => key !== undefined)
  if (keys.some((other) => other.fifths !== keys[0]?.fifths)) {
    warnings.add(
      'unrepresentable:per-staff-key',
      'The staves of this part are in different keys, and MNX states one key for ' +
        'the score. The first is the one converted.',
      { ...context, line: element.line },
      'key',
    )
  }

  const times = element.blocks('time').map((found) => readTime(found, warnings, context, path))
  const metered = times.filter((time): time is TimeSignature => time !== undefined)
  if (
    metered.some((other) => other.count !== metered[0]?.count || other.unit !== metered[0]?.unit)
  ) {
    warnings.add(
      'unrepresentable:per-staff-time',
      'The staves of this part are in different time signatures, and MNX states one ' +
        'for the score. The first is the one converted.',
      { ...context, line: element.line },
      'time',
    )
  }

  // Held on the part so a later measure that restates neither still knows
  // how long it runs. A senza-misura statement clears it: the music is
  // unmetered from here on, whatever was in force before.
  if (times.length > 0) state.time = metered[0]

  return {
    keyStated: keyBlocks.length > 0,
    timeStated: times.length > 0,
    key: keys[0],
    time: metered[0],
    clefs: element
      .blocks('clef')
      .map((found) => readClef(found, state, position, warnings, context, path)),
  }
}

function readKey(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Key | undefined {
  reportHidden(element.element, 'key', warnings, context)

  // A key without <fifths> is non-traditional, spelled as individual altered
  // steps, which MNX has no way to state. The notes still sound right,
  // because each carries its own <alter>.
  const fifths = element.child('fifths')
  if (!fifths) {
    // The spelling elements are what the one warning below is about, so they
    // are accounted for here rather than reported one by one on top of it.
    element.skip('key-step', 'key-alter', 'key-accidental')
    warnings.add(
      'unrepresentable:non-traditional-key',
      'A key signature written as individual altered steps cannot be stated in MNX, ' +
        'which counts fifths. The signature is not converted; the notes still sound right.',
      { ...context, line: element.line },
      'key',
    )
    return undefined
  }

  // Anything else a key carries (a <mode>, the <cancel> of a courtesy
  // signature, a per-accidental <key-octave>) has no home in MNX's
  // fifths-only key, and is reported by the unread-child sweep.

  // Seven accidentals is the practical limit; beyond eleven a key signature
  // cannot be written at all, so anything larger is a corrupt file.
  return { fifths: readIntegerInRange(fifths, path, -11, 11) }
}

function readTime(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): TimeSignature | undefined {
  reportHidden(element.element, 'time', warnings, context)

  // <senza-misura> writes unmetered music, which MNX has no way to state.
  if (element.child('senza-misura')) {
    warnings.add(
      'unrepresentable:senza-misura',
      'This music is written senza misura, and MNX states meter as a time signature ' +
        'or nothing. The measure is converted with no time signature.',
      { ...context, line: element.line },
      'senza-misura',
    )
    return undefined
  }

  // A composite meter such as 3+2/8 is written as several beats-and-beat-type
  // pairs. MNX states one count and unit; keeping the first pair would say the
  // measure is shorter than it sounds, so it is refused rather than converted
  // to a meter it does not have.
  const beatsElements = element.children('beats')
  if (beatsElements.length > 1) {
    throw new MusicXMLError(
      'A composite time signature, written as several beats-and-beat-type pairs, ' +
        'cannot be stated in MNX, which states one count and unit.',
      { path, line: element.line },
    )
  }

  const beatsElement = beatsElements[0] ?? requireChild(element.element, 'beats', path)
  const count = readInteger(beatsElement, path)
  if (count <= 0) {
    throw new MusicXMLError(`A time signature has ${String(count)} beats.`, {
      path,
      line: element.line,
    })
  }

  const unitElement = element.child('beat-type') ?? requireChild(element.element, 'beat-type', path)
  const unit = readInteger(unitElement, path)
  if (!isTimeUnit(unit)) {
    throw new MusicXMLError(
      `A time signature's unit of ${String(unit)} cannot be written as a note value.`,
      { path, line: unitElement.line },
    )
  }

  // An interchangeable meter offers a second reading of the same measures.
  // MNX states one, so the primary is converted and the alternative reported.
  if (element.child('interchangeable')) {
    warnings.add(
      'unrepresentable:interchangeable-time',
      'A time signature states a second, interchangeable meter, and MNX states one ' +
        'count and unit. The primary meter is converted; the alternative is not.',
      { ...context, line: element.line },
      'time',
    )
  }

  return { count, unit, display: readTimeDisplay(element.element, warnings, context) }
}

// The glyph a time signature is drawn with, where it is not drawn as numbers.
// MNX draws a C, a cut C, or the numbers; the other MusicXML symbols draw the
// meter a way it has no equivalent for, so each is reported.
function readTimeDisplay(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): 'common' | 'cut' | undefined {
  const symbol = attribute(element, 'symbol')
  if (symbol === undefined) return undefined
  if (symbol === 'common') return 'common'
  if (symbol === 'cut') return 'cut'
  // "normal" is the numbers, which is MNX's default: stating it loses nothing.
  if (symbol === 'normal') return undefined
  warnings.add(
    'unrepresentable:time-symbol',
    `A <time> is drawn with the "${symbol}" symbol, and MNX draws a time signature ` +
      'as a common or cut sign or its numbers. The numbers are the ones drawn.',
    { ...context, line: element.line },
    'time',
  )
  return undefined
}

function readClef(
  element: ElementReader,
  state: PartState,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Clef {
  reportHidden(element.element, 'clef', warnings, context)

  const sign = trimmedText(element.child('sign') ?? requireChild(element.element, 'sign', path))
  if (!isClefSign(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = element.child('line')
  const line = lineElement ? readIntegerInRange(lineElement, path, 1, 5) : DEFAULT_CLEF_LINES[sign]

  // A clef says which staff it belongs to. Read and bounded whatever the part
  // has, because a clef naming a staff the part does not have would place it
  // nowhere, and a bare Number() here once let "oops" through as a NaN staff.
  // It is only worth stating where the part has more than one staff.
  const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
  const staff = state.staves > 1 ? named : undefined

  // A clef may be transposed for drawing, as a treble-8 sits an octave lower.
  // MNX carries the amount as an ottava, which reaches three octaves either
  // way; a change of zero is no transposition. A larger change is valid
  // MusicXML with no home in MNX, so the clef is drawn at pitch and the loss
  // is reported rather than the file refused.
  const octaveElement = element.child('clef-octave-change')
  const change = octaveElement ? readInteger(octaveElement, path) : 0
  let octave: number | undefined
  if (change !== 0 && change >= -3 && change <= 3) {
    octave = change
  } else if (change !== 0) {
    warnings.add(
      'unrepresentable:clef-octave',
      `A clef is transposed by ${String(change)} octaves, and MNX states an ottava of ` +
        'at most three. The clef is converted at pitch, without the transposition.',
      { ...context, line: element.line },
      'clef',
    )
  }

  // MusicXML counts staff lines from 1 at the bottom; MNX counts staff steps
  // from 0 at the middle line. On a five-line staff they differ by this.
  return { sign, staffPosition: 2 * line - 6, staff, position, octave }
}
