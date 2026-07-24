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
import { child, requireChild, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { readAttributeInRange, readInteger, readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'

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
  }

  const stavesElement = element.child('staves')
  if (stavesElement) {
    state.staves = readIntegerInRange(stavesElement, path, 1, 16)
  }

  // MusicXML allows one key and one time signature per staff. MNX states them
  // for the whole score, so staves that disagree cannot both be carried.
  const keys = element
    .children('key')
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

  const times = element.children('time').map((found) => readTime(found, warnings, context, path))
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
    key: keys[0],
    time: metered[0],
    clefs: element.children('clef').map((found) => readClef(found, state, position, path)),
  }
}

function readKey(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Key | undefined {
  // A key without <fifths> is non-traditional, spelled as individual altered
  // steps, which MNX has no way to state. The notes still sound right,
  // because each carries its own <alter>.
  const fifths = child(element, 'fifths')
  if (!fifths) {
    warnings.add(
      'unrepresentable:non-traditional-key',
      'A key signature written as individual altered steps cannot be stated in MNX, ' +
        'which counts fifths. The signature is not converted; the notes still sound right.',
      { ...context, line: element.line },
      'key',
    )
    return undefined
  }

  // Seven accidentals is the practical limit; beyond eleven a key signature
  // cannot be written at all, so anything larger is a corrupt file.
  return { fifths: readIntegerInRange(fifths, path, -11, 11) }
}

function readTime(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): TimeSignature | undefined {
  // <senza-misura> writes unmetered music, which MNX has no way to state.
  if (child(element, 'senza-misura')) {
    warnings.add(
      'unrepresentable:senza-misura',
      'This music is written senza misura, and MNX states meter as a time signature ' +
        'or nothing. The measure is converted with no time signature.',
      { ...context, line: element.line },
      'senza-misura',
    )
    return undefined
  }

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

function readClef(
  element: XmlElement,
  state: PartState,
  position: Fraction,
  path: DocumentPath,
): Clef {
  const sign = trimmedText(requireChild(element, 'sign', path))
  if (!isClefSign(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = child(element, 'line')
  const line = lineElement ? readIntegerInRange(lineElement, path, 1, 5) : DEFAULT_CLEF_LINES[sign]

  // A clef says which staff it belongs to. Read and bounded whatever the part
  // has, because a clef naming a staff the part does not have would place it
  // nowhere, and a bare Number() here once let "oops" through as a NaN staff.
  // It is only worth stating where the part has more than one staff.
  const named = readAttributeInRange(element, 'number', path, 1, state.staves)
  const staff = state.staves > 1 ? named : undefined

  // MusicXML counts staff lines from 1 at the bottom; MNX counts staff steps
  // from 0 at the middle line. On a five-line staff they differ by this.
  return { sign, staffPosition: 2 * line - 6, staff, position }
}
