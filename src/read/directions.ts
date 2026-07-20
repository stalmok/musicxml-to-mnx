// Reading a <direction>: the dynamics, tempo marks and other instructions
// that sit between the notes rather than on them.
//
// A <direction> holds one or more <direction-type>s and appears at wherever
// the cursor has reached in the measure. A dynamic belongs to the part's
// measure at that position; a metronome mark belongs to the score's measure,
// since a tempo is the whole score's. Much of what a direction can carry has
// no home in MNX, and is reported.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { addFractions, compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { Dynamic, DynamicValue, Tempo } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { children, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { elementLoss } from './unrepresentable.js'

/** What one <direction> was found to carry. */
export interface DirectionReading {
  dynamics: Dynamic[]
  tempos: Tempo[]
}

// The dynamic marks MNX can state. Others, like sforzando, have no value in
// its vocabulary.
const DYNAMIC_VALUES: ReadonlySet<string> = new Set([
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'n',
])

export function readDirection(
  element: ElementReader,
  position: Fraction,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = { dynamics: [], tempos: [] }

  // A direction says which staff it belongs under. A tempo is the score's, so
  // it has no use for one, but a dynamic sits under a particular hand and MNX
  // states the staff on it. Only worth carrying where there is a choice.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  const at = offsetPosition(element, position, state, warnings, context, path)

  for (const directionType of element.children('direction-type')) {
    for (const found of directionType.children) {
      switch (found.name) {
        case 'dynamics':
          reading.dynamics.push(...readDynamics(found, at, staff, warnings, context))
          break
        case 'metronome':
          reading.tempos.push(...readMetronome(found, at, warnings, context, path))
          break
        default: {
          const loss = elementLoss(found.name)
          warnings.add(
            loss.code,
            `A <${found.name}> direction ${loss.ending}`,
            { ...context, line: found.line },
            found.name,
          )
        }
      }
    }
  }

  // Read after the direction types, so that a <metronome> beside it has
  // already had its say about the tempo.
  const sound = element.child('sound')
  if (sound) {
    reading.tempos.push(...readSound(sound, at, reading.tempos.length > 0, warnings, context))
  }

  return reading
}

/**
 * Where the direction actually belongs, which is where the cursor has reached
 * plus whatever <offset> says. The offset is routinely negative: a mark
 * written after the note it sits under is pulled back on to it, and nine of
 * the corpus's thirteen offsets do exactly that.
 */
function offsetPosition(
  element: ElementReader,
  position: Fraction,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Fraction {
  const offset = element.child('offset')
  if (!offset) return position

  const written = trimmedText(offset)
  if (!/^[+-]?\d+$/.test(written) || !Number.isSafeInteger(Number(written))) {
    // MusicXML measures an offset in divisions and allows a fractional one.
    // Rounding it would put the mark somewhere the source did not, so the
    // offset is reported and the mark stays where it was written.
    warnings.add(
      'unsupported:element',
      `An <offset> of "${written}" is not a whole number of divisions, and is not applied.`,
      { ...context, line: offset.line },
      'offset',
    )
    return position
  }

  if (state.divisions === undefined) {
    throw new MusicXMLError('An <offset> appears before any <divisions> said how long one is.', {
      path,
      line: offset.line,
    })
  }

  const moved = addFractions(position, fraction(Number(written), state.divisions * 4))

  // MNX states a position within its measure, counting from the start, so
  // there is nowhere to put a mark that an offset drags behind the barline.
  // Carrying it over would need it moved into the measure before, which is
  // not something this converter does yet.
  if (compareFractions(moved, fraction(0)) < 0) {
    warnings.add(
      'unsupported:element',
      `An <offset> of ${written} reaches back before the start of the measure, and is ` +
        'not applied.',
      { ...context, line: offset.line },
      'offset',
    )
    return position
  }

  return moved
}

/**
 * What a <sound> carries that is notation rather than playback. Only the
 * tempo is: MNX has nowhere for a playback velocity, a pan position or a
 * pedal instruction, so every other attribute stays in the loss report.
 *
 * MusicXML counts a sound tempo in quarter notes per minute, always, which is
 * why no beat unit is read for it.
 */
export function readSound(
  sound: XmlElement,
  position: Fraction,
  tempoAlreadyStated: boolean,
  warnings: WarningCollector,
  context: WarningContext,
): Tempo[] {
  for (const name of Object.keys(sound.attributes)) {
    if (name === 'tempo') continue
    warnings.add(
      'unsupported:element',
      `The "${name}" of a <sound> is not converted yet.`,
      { ...context, line: sound.line },
      'sound',
    )
  }

  const written = sound.attributes['tempo']
  if (written === undefined) return []

  // A <sound tempo> beside a <metronome> is the same mark restated for
  // playback, so taking it too would state one tempo twice.
  if (tempoAlreadyStated) return []

  const bpm = Number(written)
  if (!Number.isFinite(bpm) || bpm <= 0) {
    // Playback junk is not worth refusing a document over, so it is reported
    // like anything else the output does not carry.
    warnings.add(
      'unsupported:element',
      `A <sound> states "${written}" beats per minute, which is not a tempo.`,
      { ...context, line: sound.line },
      'sound',
    )
    return []
  }

  return [{ position, value: { base: 'quarter', dots: 0 }, bpm: Math.round(bpm) }]
}

function readDynamics(
  element: XmlElement,
  position: Fraction,
  staff: number | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []
  for (const mark of element.children) {
    if (DYNAMIC_VALUES.has(mark.name)) {
      dynamics.push({ position, value: mark.name as DynamicValue, staff })
    } else {
      warnings.add(
        'unsupported:element',
        `A dynamic of "${mark.name}" is not converted yet.`,
        { ...context, line: mark.line },
        mark.name,
      )
    }
  }
  return dynamics
}

function readMetronome(
  element: XmlElement,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Tempo[] {
  const perMinute = children(element, 'per-minute')[0]
  const beatUnit = children(element, 'beat-unit')[0]

  // MusicXML can also state a metronome as one note value equalling another,
  // a metrical modulation. MNX states a tempo as a note value and a count of
  // them per minute, and that form carries no number at all, so there is
  // nothing to put there.
  if (!perMinute || !beatUnit) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> written as one note value equalling another cannot be expressed ' +
        'in MNX, which states a tempo as beats per minute.',
      { ...context, line: element.line },
      'metronome',
    )
    return []
  }

  const base = noteValueBaseOf(beatUnit)
  if (!base) {
    throw new MusicXMLError(
      `A metronome's beat unit "${trimmedText(beatUnit)}" is not a note value.`,
      { path, line: beatUnit.line },
    )
  }

  const bpm = Number(trimmedText(perMinute))
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new MusicXMLError(`A metronome states "${trimmedText(perMinute)}" beats per minute.`, {
      path,
      line: perMinute.line,
    })
  }

  // A beat unit can be dotted; MNX's bpm is a whole number.
  const dots = children(element, 'beat-unit-dot').length
  return [{ position, value: { base, dots }, bpm: Math.round(bpm) }]
}
