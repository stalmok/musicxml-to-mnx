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
import type { Fraction } from '../fraction.js'
import type { Dynamic, DynamicValue, Tempo } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { children, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
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
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = { dynamics: [], tempos: [] }

  for (const directionType of element.children('direction-type')) {
    for (const found of directionType.children) {
      switch (found.name) {
        case 'dynamics':
          reading.dynamics.push(...readDynamics(found, position, warnings, context))
          break
        case 'metronome':
          reading.tempos.push(...readMetronome(found, position, warnings, context, path))
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
  return reading
}

function readDynamics(
  element: XmlElement,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []
  for (const mark of element.children) {
    if (DYNAMIC_VALUES.has(mark.name)) {
      dynamics.push({ position, value: mark.name as DynamicValue })
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
