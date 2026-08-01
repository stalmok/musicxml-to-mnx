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
import type {
  Dynamic,
  DynamicValue,
  Fine,
  Jump,
  OttavaAmount,
  Segno,
  Tempo,
  WedgeType,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, trimmedText } from '../xml/tree.js'
import { divisionsInForce } from './divisions.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { elementLoss } from './unrepresentable.js'

/** What one <direction> was found to carry. */
export interface DirectionReading {
  dynamics: Dynamic[]
  tempos: Tempo[]
  segnos: Segno[]
  fines: Fine[]
  jumps: Jump[]
}

/** The navigation a single <sound> element carries a home for. */
export interface SoundReading {
  fine: Fine | undefined
  jump: Jump | undefined
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
  lastEvent: Fraction | undefined,
  measure: number,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = {
    dynamics: [],
    tempos: [],
    segnos: [],
    fines: [],
    jumps: [],
  }

  // A direction says which staff it belongs under. A tempo is the score's, so
  // it has no use for one, but a dynamic sits under a particular hand and MNX
  // states the staff on it. Only worth carrying where there is a choice.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  // Which side of the staff the direction is drawn on. MNX states it on the
  // dynamic and the octave shift; without it the renderer has to guess.
  const orient = orientOf(element.element)

  const at = offsetPosition(element, position, state, warnings, context)

  for (const directionType of element.children('direction-type')) {
    for (const found of directionType.children) {
      switch (found.name) {
        case 'dynamics':
          reading.dynamics.push(...readDynamics(found, at, staff, orient, warnings, context))
          break
        case 'metronome':
          reading.tempos.push(...readMetronome(found, at, warnings, context, path))
          break
        case 'octave-shift':
          readOctaveShift(found, at, lastEvent, measure, staff, orient, state, warnings, context)
          break
        case 'wedge': {
          const hairpin = readWedge(found, at, measure, staff, orient, state, warnings, context)
          if (hairpin) reading.dynamics.push(hairpin)
          break
        }
        case 'segno':
          // A segno belongs to the score's measure, like a tempo, not to the
          // part it is written in. The optional smufl attribute names a
          // specific glyph; MNX carries it as the segno's glyph.
          reading.segnos.push({ location: at, glyph: attribute(found, 'smufl') })
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
  // already had its say about the tempo and a <sound> restating it is seen as
  // the echo it is.
  for (const sound of element.blocks('sound')) {
    const soundReading = readSound(sound, at, reading.tempos.length > 0, warnings, context)
    if (soundReading.fine) reading.fines.push(soundReading.fine)
    if (soundReading.jump) reading.jumps.push(soundReading.jump)
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

  const divisions = divisionsInForce(state, warnings, context, offset.line)
  const moved = addFractions(position, fraction(Number(written), divisions * 4))

  // MNX states a position within its measure, counting from the start, so
  // there is nowhere to put a mark an offset carries out of it, in either
  // direction. Carrying one over would need it moved into the neighbouring
  // measure, which is not something this converter does yet.
  if (compareFractions(moved, fraction(0)) < 0 || pastTheEnd(moved, state)) {
    warnings.add(
      'unsupported:element',
      `An <offset> of ${written} carries the mark outside its measure, and is not applied.`,
      { ...context, line: offset.line },
      'offset',
    )
    return position
  }

  return moved
}

/**
 * Whether a position runs past the end of the measure, as far as the time
 * signature in force says. Unknowable before any time signature is stated,
 * and real music does contain measures that do not match the one in force, so
 * this only catches a mark that has plainly left the bar.
 */
function pastTheEnd(position: Fraction, state: PartState): boolean {
  if (!state.time) return false
  return compareFractions(position, fraction(state.time.count, state.time.unit)) > 0
}

// How far MusicXML's octave-shift sizes move the music, in octaves. The
// numbers are the ones written on the page: 8va is one octave, 15ma two.
const SHIFT_SIZES = new Map<string, 1 | 2 | 3>([
  ['8', 1],
  ['15', 2],
  ['22', 3],
])

/**
 * An octave shift: a stretch drawn an octave or more from where it sounds, to
 * keep it off the ledger lines.
 *
 * The sign is the one place this is easy to get backwards, and the two specs
 * say it in opposite terms. MusicXML's type is which way the notes were moved
 * to get them onto the staff, so 8va, where the music sounds higher than it
 * is drawn, is written as a shift "down". MNX's value is how far the written
 * pitch sits below the sounded one, so the same 8va is a positive 1. Both
 * formats put the sounding pitch on the notes themselves, so nothing is
 * transposed either way; this says only how the passage is drawn.
 */
function readOctaveShift(
  found: XmlElement,
  position: Fraction,
  lastEvent: Fraction | undefined,
  measure: number,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'

  if (type === 'stop') {
    // MNX states where a shift ends as the place of the last event it covers.
    // MusicXML writes the stop after that event, so the cursor has already
    // moved past it; where nothing precedes the stop in this measure, the
    // stop's own place is the closest thing to it.
    state.spanners.stopOttava(number, measure, position, lastEvent ?? position, context)
    return
  }
  // "continue" marks a point partway along one, which MNX has no need of.
  if (type === 'continue') return

  const size = attribute(found, 'size') ?? '8'
  const octaves = SHIFT_SIZES.get(size)
  if ((type !== 'up' && type !== 'down') || !octaves) {
    warnings.add(
      'unsupported:element',
      `An <octave-shift> of type "${type ?? ''}" and size "${size}" is not converted yet.`,
      { ...context, line: found.line },
      'octave-shift',
    )
    return
  }

  const value = type === 'down' ? octaves : (-octaves as OttavaAmount)
  state.spanners.startOttava(
    { measure, position, value, staff, ...(orient !== undefined ? { orient } : {}) },
    number,
    measure,
    position,
    context,
  )
}

// MusicXML's wedge types, in MNX's. A hairpin opening to the right gets
// louder; one closing gets softer.
const WEDGE_TYPES = new Map<string, WedgeType>([
  ['crescendo', 'increasing'],
  ['diminuendo', 'decreasing'],
])

/**
 * A hairpin: a dynamic that grows or fades from here to somewhere later,
 * often several measures away. MusicXML marks both ends and numbers them so
 * they can be matched, exactly as it does a slur, and MNX states the pair
 * once, on the end where it begins.
 */
function readWedge(
  found: XmlElement,
  position: Fraction,
  measure: number,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): Dynamic | undefined {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'

  if (type === 'stop') {
    state.spanners.stopWedge(number, measure, position, context)
    return undefined
  }

  const wedge = type === undefined ? undefined : WEDGE_TYPES.get(type)
  if (!wedge) {
    // "continue" marks a point partway along a hairpin, which MNX has no need
    // of, since it states only where one begins and ends.
    if (type !== 'continue') {
      warnings.add(
        'unsupported:element',
        `A <wedge> of type "${type ?? ''}" is not converted yet.`,
        { ...context, line: found.line },
        'wedge',
      )
    }
    return undefined
  }

  // A hairpin states no value of its own: what it grows from and to is said
  // by the plain marks around it.
  const hairpin: Dynamic = {
    position,
    value: undefined,
    wedge,
    end: undefined,
    staff,
    ...(orient !== undefined ? { orient } : {}),
  }
  state.spanners.startWedge(hairpin, number, measure, position, context)
  return hairpin
}

/**
 * A <sound> is mostly a playback element, and most of what it carries reaches
 * nothing in the output. Its tempo is playback rather than notation: MNX's
 * tempo object is always drawn, so emitting one from a <sound> would fabricate
 * a metronome the source never displayed. A <metronome> beside it is the drawn
 * mark, and the <sound tempo> only echoes it for playback, so that echo is
 * passed over without a word. A bare <sound tempo> with no metronome is
 * playback-only and reported like a velocity or a pan position, which MNX also
 * has nowhere for.
 *
 * Two attributes are notation MNX does hold: <sound fine> is a Fine, and
 * <sound dalsegno> a dal-segno jump. Both go on the score's measure at the
 * point the <sound> is written, and the rest is reported as before.
 */
export function readSound(
  sound: ElementReader,
  position: Fraction,
  tempoAlreadyStated: boolean,
  warnings: WarningCollector,
  context: WarningContext,
): SoundReading {
  let fine: Fine | undefined
  let jump: Jump | undefined
  for (const name of Object.keys(sound.element.attributes)) {
    if (name === 'tempo' && tempoAlreadyStated) continue
    if (name === 'fine') {
      fine = { location: position }
      continue
    }
    if (name === 'dalsegno') {
      // The attribute names the segno to jump to; MNX's jump has no target,
      // and one segno per score is the norm, so the name is not carried.
      jump = { location: position, type: 'segno' }
      continue
    }
    warnings.add(
      'unsupported:element',
      `The "${name}" of a <sound> is not converted yet.`,
      { ...context, line: sound.line },
      'sound',
    )
  }
  return { fine, jump }
}

/**
 * MNX states beats per minute as a whole number, so a source that writes a
 * fraction of one has to be rounded, which moves the tempo by a little. Said
 * out loud rather than swallowed.
 */
function roundedBpm(bpm: number, warnings: WarningCollector, context: WarningContext): number {
  const rounded = Math.round(bpm)
  if (rounded !== bpm) {
    warnings.add(
      'unrepresentable:tempo',
      `A tempo of ${String(bpm)} beats per minute is written as ${String(rounded)}, because ` +
        'MNX states beats per minute as a whole number.',
      context,
      'metronome',
    )
  }
  return rounded
}

// The side a direction is drawn on, from its placement. MusicXML's above and
// below are the words MNX states, so a known one passes straight through.
function orientOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

function readDynamics(
  element: XmlElement,
  position: Fraction,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []
  for (const mark of element.children) {
    if (DYNAMIC_VALUES.has(mark.name)) {
      dynamics.push({
        position,
        value: mark.name as DynamicValue,
        wedge: undefined,
        end: undefined,
        staff,
        ...(orient !== undefined ? { orient } : {}),
      })
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

  // An empty <per-minute> is valid: it prints the beat-unit glyph alone, with
  // the number supplied as adjacent text. MNX's tempo needs a bpm, so there is
  // nothing to carry, but it is a reported drop rather than a refusal.
  const written = trimmedText(perMinute)
  if (written === '') {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> with no beats-per-minute number cannot be expressed in MNX, ' +
        'which states a tempo as beats per minute.',
      { ...context, line: perMinute.line },
      'metronome',
    )
    return []
  }

  // MusicXML's per-minute is a string, so it can be a descriptive word such as
  // "fast" rather than a number. MNX states a tempo as a positive number of
  // beats per minute, so a non-numeric one is a reported drop, not a refusal.
  const bpm = Number(written)
  if (!Number.isFinite(bpm) || bpm <= 0) {
    warnings.add(
      'unrepresentable:tempo',
      `A <metronome> states its tempo as "${written}", which cannot be expressed in MNX, ` +
        'which states a tempo as a positive number of beats per minute.',
      { ...context, line: perMinute.line },
      'metronome',
    )
    return []
  }

  // A beat unit can be dotted; MNX's bpm is a whole number.
  const dots = children(element, 'beat-unit-dot').length
  return [{ position, value: { base, dots }, bpm: roundedBpm(bpm, warnings, context) }]
}
