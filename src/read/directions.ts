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
import type { Dynamic, DynamicValue, NoteValueBase, Tempo } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { children, trimmedText } from '../xml/tree.js'

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

const BEAT_UNIT_BASES: ReadonlySet<string> = new Set([
  'maxima',
  'long',
  'breve',
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
  '64th',
  '128th',
  '256th',
  '512th',
  '1024th',
])

// MusicXML's beat-unit spellings, in MNX's.
const BEAT_UNIT_TO_BASE = new Map<string, NoteValueBase>([
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

export function readDirection(
  element: XmlElement,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = { dynamics: [], tempos: [] }

  for (const directionType of children(element, 'direction-type')) {
    for (const found of directionType.children) {
      switch (found.name) {
        case 'dynamics':
          reading.dynamics.push(...readDynamics(found, position, warnings, context))
          break
        case 'metronome':
          reading.tempos.push(...readMetronome(found, position, warnings, context, path))
          break
        default:
          warnings.add('unsupported:element', `A <${found.name}> direction is not converted yet.`, {
            ...context,
            line: found.line,
          })
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
      warnings.add('unsupported:element', `A dynamic of "${mark.name}" is not converted yet.`, {
        ...context,
        line: mark.line,
      })
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
  // which is a different shape MNX does not carry; only the beats-per-minute
  // form is converted.
  if (!perMinute || !beatUnit) {
    warnings.add('unsupported:element', 'A <metronome> of this kind is not converted yet.', {
      ...context,
      line: element.line,
    })
    return []
  }

  const spelling = trimmedText(beatUnit)
  const base = BEAT_UNIT_BASES.has(spelling) ? BEAT_UNIT_TO_BASE.get(spelling) : undefined
  if (!base) {
    throw new MusicXMLError(`A metronome's beat unit "${spelling}" is not a note value.`, {
      path,
      line: beatUnit.line,
    })
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
