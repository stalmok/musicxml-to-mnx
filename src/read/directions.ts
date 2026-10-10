// Reading a <direction>: the dynamics, tempo marks and other instructions
// that sit between the notes rather than on them.
//
// A <direction> holds one or more <direction-type>s and appears at wherever
// the cursor has reached in the measure. A dynamic belongs to the part's
// measure at that position; a metronome mark belongs to the score's measure,
// since a tempo is the whole score's. Much of what a direction can carry has
// no home in MNX, and is reported.

import type { DocumentPath } from '../errors.js'
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  AccentPrefix,
  AccentSuffix,
  Dynamic,
  DynamicValue,
  Fine,
  OttavaAmount,
  Tempo,
  WedgeType,
} from '../model/score.js'
import type { NamedSegno, DalSegno } from './jumps.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { readColor } from './color.js'
import { divisionsInForce } from './divisions.js'
import type { ElementReader, Stated } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseDecimal, parseExactDecimal, parseWholeNumber, readIntegerInRange } from './numbers.js'
import type { GraceNotesAt } from './voices.js'
import { reportLoneWording, writtenAt } from './spanners.js'
import type { OpenHairpin, WedgeStop, Wording } from './spanners.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import { entriesOf, recogniser } from './tables.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'

/** What one <direction> was found to carry. */
export interface DirectionReading {
  dynamics: Dynamic[]
  tempos: Stated<Tempo>[]
  segnos: Stated<NamedSegno>[]
  fines: Stated<Fine>[]
  jumps: Stated<DalSegno>[]
  /** Each <sound tempo> the direction states. */
  soundTempos: SoundTempo[]
}

/** The navigation a single <sound> element carries a home for. */
export interface SoundReading {
  fine: Fine | undefined
  jump: DalSegno | undefined
  /**
   * What the source calls the segno drawn in this direction. Not written: it
   * names the sign so a jump can be matched to the one it returns to.
   */
  segnoName: string | undefined
  /**
   * The <sound tempo> the element states, where it states one. Whether it is
   * a loss depends on the metronome marks the score draws at the same point,
   * which any part can draw and can be written after the <sound>, so the
   * caller decides once the whole score is read.
   */
  tempo: SoundTempo | undefined
}

/** A <sound tempo> waiting on the score to say whether it echoes a mark. */
export interface SoundTempo {
  position: Fraction
  /**
   * Quarter notes per minute, which is what MusicXML's tempo attribute
   * counts. Absent where the attribute states no number. No mark is the echo
   * of an absent, zero or negative tempo, because every mark states a
   * positive one.
   */
  bpm: number | undefined
  element: XmlElement
  /**
   * The place kept in the report for the decision. The decision is made
   * once every part is read, and reporting it there would put it after every
   * loss read since; this holds its spot where the <sound> is written.
   */
  place: WarningPlace
}

// The plain dynamic marks MNX states as a value.
const isDynamicValue = recogniser<DynamicValue>({
  pppppp: true,
  ppppp: true,
  pppp: true,
  ppp: true,
  pp: true,
  p: true,
  mp: true,
  mf: true,
  f: true,
  ff: true,
  fff: true,
  ffff: true,
  fffff: true,
  ffffff: true,
  n: true,
})

// The accent dynamics, such as a sforzando, spelled out the way MNX states
// them: the value is the level of the attack, the letters around it are the
// accent's prefix and suffix, and a two-stage accent (fp is a forte attack
// held at piano) adds the level it settles to as the residual. The glyph
// names are the precomposed combined marks from SMuFL's dynamics range,
// carried besides so the mark is drawn as written.
//
// pf (poco forte / piano-forte) is left out: its two letters have no settled
// reading, and MNX requires an accent to state the level of its attack.
interface AccentSpelling {
  glyph: string
  value: DynamicValue
  residualValue: DynamicValue | undefined
  prefix: AccentPrefix
  suffix: AccentSuffix
}
const ACCENT_DYNAMICS = new Map<string, AccentSpelling>([
  [
    'sf',
    { glyph: 'dynamicSforzando1', value: 'f', residualValue: undefined, prefix: 's', suffix: '' },
  ],
  [
    'sfz',
    { glyph: 'dynamicSforzato', value: 'f', residualValue: undefined, prefix: 's', suffix: 'z' },
  ],
  [
    'fz',
    { glyph: 'dynamicForzando', value: 'f', residualValue: undefined, prefix: '', suffix: 'z' },
  ],
  [
    'rf',
    { glyph: 'dynamicRinforzando1', value: 'f', residualValue: undefined, prefix: 'r', suffix: '' },
  ],
  [
    'rfz',
    {
      glyph: 'dynamicRinforzando2',
      value: 'f',
      residualValue: undefined,
      prefix: 'r',
      suffix: 'z',
    },
  ],
  [
    'sffz',
    { glyph: 'dynamicSforzatoFF', value: 'ff', residualValue: undefined, prefix: 's', suffix: 'z' },
  ],
  ['fp', { glyph: 'dynamicFortePiano', value: 'f', residualValue: 'p', prefix: '', suffix: '' }],
  [
    'sfp',
    { glyph: 'dynamicSforzandoPiano', value: 'f', residualValue: 'p', prefix: 's', suffix: '' },
  ],
  [
    'sfpp',
    {
      glyph: 'dynamicSforzandoPianissimo',
      value: 'f',
      residualValue: 'pp',
      prefix: 's',
      suffix: '',
    },
  ],
  [
    'sfzp',
    { glyph: 'dynamicSforzatoPiano', value: 'f', residualValue: 'p', prefix: 's', suffix: 'z' },
  ],
])

export function readDirection(
  element: ElementReader,
  position: Fraction,
  graceNotesAt: GraceNotesAt,
  measure: number,
  dynamicsBefore: number,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = {
    dynamics: [],
    tempos: [],
    segnos: [],
    fines: [],
    jumps: [],
    soundTempos: [],
  }

  // A direction says which staff it belongs under. A tempo is the score's,
  // but MNX states the staff on a dynamic. Stated only where the part has more
  // than one staff.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  // Which side of the staff the direction is drawn on. MNX states it on the
  // dynamic and the octave shift.
  const placement = placementOf(element.element)

  const at = offsetPosition(element, position, state, warnings, context)

  // How many grace notes stand at the cursor and were written before this
  // direction. A span stopping there is drawn over them, so its end names the
  // last of them rather than the place they all share. An octave shift reads
  // its end from the cursor whatever an <offset> says, so it counts them
  // either way. A hairpin is drawn where the offset puts it, and grace notes
  // are counted only where that is the cursor: the source says nothing about
  // which grace note an offset falls beside, so none is named.
  const graceAtCursor = graceNotesAt(position, staff)
  const overGrace = compareFractions(at, position) === 0 ? graceAtCursor : 0

  for (const directionType of element.blocks('direction-type')) {
    // The wording is held for the whole <direction-type>: MusicXML allows
    // the words and the mark they qualify in sibling <dynamics> blocks, and
    // "cresc." beside a <wedge> is the hairpin's own wording.
    const wording = new PendingWording()
    let lastMark: SuffixTarget | undefined
    for (const found of directionType.element.children) {
      // Each case accounts for the child it handles. A type read plainly is
      // swept with the other read children. A <dynamics> and a <metronome>
      // have a reader of their own, and the sweep reports what that reader
      // leaves unread. An unhandled type is reported whole below.
      switch (found.name) {
        case 'dynamics': {
          const marks = readDynamics(
            directionType.block(found),
            at,
            staff,
            placement,
            wording,
            warnings,
            context,
          )
          reading.dynamics.push(...marks)
          const last = marks[marks.length - 1]
          if (last) lastMark = { kind: 'mark', mark: last }
          break
        }
        case 'metronome':
          for (const tempo of readMetronome(directionType.block(found), at, warnings, context)) {
            reading.tempos.push({ value: tempo, element: found })
          }
          break
        case 'octave-shift':
          // Read plainly, being an empty element.
          directionType.children('octave-shift')
          readOctaveShift(
            found,
            at,
            position,
            graceAtCursor,
            measure,
            staff,
            placement,
            state,
            warnings,
            context,
          )
          break
        case 'wedge': {
          // Read plainly, being an empty element.
          directionType.children('wedge')
          const wedge = readWedge(
            found,
            at,
            overGrace,
            measure,
            dynamicsBefore + reading.dynamics.length,
            staff,
            placement,
            state,
            warnings,
            context,
          )
          if (wedge?.edge === 'start') {
            const prefix = wording.take()
            if (prefix !== undefined) wedge.hairpin.prefix = prefix.text
            lastMark = { kind: 'mark', mark: wedge.hairpin }
          } else if (wedge) {
            // Wording at a closing edge trails the mark. Words pending at the
            // stop wait on it until the pairing names the hairpin. Wording
            // after the stop closes the same stop.
            const suffix = wording.take()
            if (suffix !== undefined) {
              wedge.stop.wording = {
                text: suffix.text,
                where: writtenAt(suffix.element, context, warnings),
              }
            }
            lastMark = { kind: 'stop', stop: wedge.stop }
          }
          break
        }
        case 'segno':
          // Read plainly, being an empty element.
          directionType.children('segno')
          // A segno belongs to the score's measure, like a tempo, not to the
          // part it is written in. The optional smufl attribute names a
          // specific glyph; MNX carries it as the segno's glyph.
          reading.segnos.push({
            value: {
              location: at,
              glyph: attribute(found, 'smufl'),
              color: readColor(found, warnings, context),
            },
            element: found,
          })
          break
        default: {
          // Accounted for by the warning below, which names the whole of it.
          directionType.skip(found.name)
          const loss = elementLoss(found.name)
          warnings.add(loss.code, `A <${found.name}> direction ${loss.ending}`, context, found)
        }
      }
    }

    // Wording left over closes the mark before it.
    const trailing = wording.take()
    if (trailing !== undefined) {
      closeWithWording(
        lastMark,
        { text: trailing.text, where: writtenAt(trailing.element, context, warnings) },
        warnings,
      )
    }
  }

  // A segno and a tempo are drawn above the staff, and MNX states no side
  // for either, so only one placed below loses its side. A dynamic beside it
  // takes the placement and keeps it.
  if (placement === 'below' && reading.segnos.length + reading.tempos.length > 0) {
    warnings.add(
      'unrepresentable:attribute',
      'This <direction> places a segno or a tempo below the staff, and MNX states no ' +
        'side for either. The segno or tempo is converted without its placement.',
      context,
      element.element,
      'placement',
    )
  }

  // Read after the direction types, so that a <metronome> beside it has
  // already had its say about the tempo. Whether a <sound tempo> echoes a
  // mark waits for the end of the score, because the mark can be drawn by a
  // later <direction> at the same point, or by another part.
  for (const sound of element.blocks('sound')) {
    const soundReading = readSound(sound, at, warnings, context)
    if (soundReading.fine) reading.fines.push({ value: soundReading.fine, element: sound.element })
    if (soundReading.jump) reading.jumps.push({ value: soundReading.jump, element: sound.element })
    if (soundReading.tempo) reading.soundTempos.push(soundReading.tempo)
    // The <sound> naming the sign sits in the same <direction> as the <segno>
    // it names, so the name is put on the signs this direction just read.
    if (soundReading.segnoName !== undefined) {
      const name = soundReading.segnoName
      reading.segnos = reading.segnos.map((segno) => ({
        ...segno,
        value: { ...segno.value, name },
      }))
    }
  }

  return reading
}

/**
 * Where the direction belongs: where the cursor has reached, plus whatever
 * <offset> says. The offset is often negative, to pull a mark written after
 * its note back on to it.
 */
function offsetPosition(
  element: ElementReader,
  position: Fraction,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): Fraction {
  const offset = element.child('offset')
  if (!offset) return position

  const written = trimmedText(offset)
  // MusicXML measures an offset in divisions and allows a fractional one. One
  // that is not a number, or cannot be read exactly, is reported, and the mark
  // stays where it was written.
  if (parseDecimal(written) === undefined) {
    warnings.add(
      'unresolved:element-value',
      `An <offset> of "${written}" is not a number of divisions, and is not applied.`,
      context,
      offset,
    )
    return position
  }
  const count = parseExactDecimal(written)
  if (count === undefined) {
    warnings.add(
      'unsupported:element',
      `An <offset> of "${written}" divisions cannot be read exactly, and is not applied.`,
      context,
      offset,
    )
    return position
  }

  const divisions = divisionsInForce(state, warnings, context, offset)
  const moved = addFractions(
    position,
    divideFractions(count, multiplyFractions(divisions, fraction(4))),
  )

  // MNX states a position within its measure, counting from the start, so a
  // mark an offset carries out of it has nowhere to go. Moving it into the
  // next or previous measure is not built yet.
  if (compareFractions(moved, fraction(0)) < 0 || pastTheEnd(moved, state)) {
    warnings.add(
      'unsupported:element',
      `An <offset> of ${written} carries the mark outside its measure, and is not applied.`,
      context,
      offset,
    )
    return position
  }

  return moved
}

/**
 * Whether a position runs past the end of the measure, as far as the time
 * signature in force says. Unknowable before any time signature is stated.
 * A measure does not always match its time signature, so this catches only a
 * mark past the stated length.
 */
function pastTheEnd(position: Fraction, state: PartState): boolean {
  const measure = measureLength(state)
  return measure !== undefined && compareFractions(position, measure) > 0
}

// How far MusicXML's octave-shift sizes move the music, in octaves, each way
// the shift can go. The numbers are the ones written on the page: 8va is one
// octave, 15ma two. MNX states the other direction as a negative amount.
// Both are written out, not negated at the call site, so each value stays in
// the model's union.
const SHIFT_SIZES = new Map<number, Record<'up' | 'down', OttavaAmount>>([
  [8, { down: 1, up: -1 }],
  [15, { down: 2, up: -2 }],
  [22, { down: 3, up: -3 }],
])

/**
 * The amount a starting shift moves the music, or nothing where the type or
 * the size says none MNX can state, which is reported. MusicXML's size is a
 * whole number above zero, 8 where none is written, and allows spaces around
 * it. MNX shifts by one to three octaves.
 */
function startingShift(
  found: XmlElement,
  type: string | undefined,
  size: string | undefined,
  warnings: WarningCollector,
  context: ReportContext,
): OttavaAmount | undefined {
  const ending = 'so the whole shift is not carried over.'
  if (type !== 'up' && type !== 'down') {
    warnings.addUndefinedAttribute(found, 'type', ending, context)
    return undefined
  }
  const stated = size === undefined ? 8 : parseWholeNumber(size.trim())
  if (stated === undefined || stated < 1) {
    warnings.addUndefinedAttribute(found, 'size', ending, context)
    return undefined
  }
  const shift = SHIFT_SIZES.get(stated)
  if (!shift) {
    warnings.add(
      'unrepresentable:octave-shift-size',
      `An <octave-shift> of size ${String(stated)} cannot be expressed in MNX, which ` +
        `shifts by one to three octaves, ${ending}`,
      context,
      found,
      'size',
    )
    return undefined
  }
  return shift[type]
}

/**
 * An octave shift: a stretch drawn an octave or more from where it sounds, to
 * keep it off the ledger lines.
 *
 * The two specs state the sign in opposite terms. MusicXML's type is which
 * way the notes were moved to get them onto the staff, so 8va, where the
 * music sounds higher than it is drawn, is a shift "down". MNX's value is
 * how far the written pitch sits below the sounded one, so the same 8va is a
 * positive 1. Both formats put the sounding pitch on the notes, so nothing is
 * transposed; this says only how the passage is drawn.
 */
function readOctaveShift(
  found: XmlElement,
  position: Fraction,
  cursor: Fraction,
  graceAtCursor: number,
  measure: number,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // Read before the edges split, because a stop or continue restates the
  // start's size and the shift's octaves come from the start alone.
  const size = attribute(found, 'size')
  // Recorded with the edge for the same reason a hairpin's is: the shift is
  // reported once the part is whole.
  const where = writtenAt(found, context, warnings)

  if (type === 'stop') {
    // Which event the shift ends on is settled once the measure is whole,
    // because a <backup> can write that event after this stop. It is read
    // from where the cursor stood, not from where an <offset> draws the stop:
    // an offset moves the sign on the page, not the music it covers.
    state.spanners.stopOttava(number, measure, position, cursor, graceAtCursor, staff, where)
    return
  }
  // "continue" marks a point partway along one, which MNX has no need of.
  if (type === 'continue') return

  const value = startingShift(found, type, size, warnings, context)
  if (value === undefined) {
    // The stop the source wrote for this shift goes with it, unreported: only
    // "stop" and "continue" are handled above, so an unknown type can only be
    // meant as a start.
    state.spanners.dropOttavaStart(number, measure, position, staff, where)
    return
  }

  state.spanners.startOttava(
    { measure, position, value, staff, ...(placement !== undefined ? { placement } : {}) },
    number,
    where,
  )
}

// MusicXML's wedge types, in MNX's. A hairpin opening to the right gets
// louder; one closing gets softer.
const MUSICXML_WEDGES: Record<WedgeType, string> = {
  increasing: 'crescendo',
  decreasing: 'diminuendo',
}

// The same table the way it is read: MusicXML's word to the model's.
const WEDGE_TYPES = new Map<string, WedgeType>(
  entriesOf(MUSICXML_WEDGES).map(([shape, spelling]) => [spelling, shape]),
)

/**
 * Which edge of a hairpin a <wedge> marked. Wording written beside a start
 * goes on the hairpin. Wording beside a stop waits on the stop until the
 * pairing names the hairpin.
 */
type WedgeReading = { edge: 'start'; hairpin: OpenHairpin } | { edge: 'stop'; stop: WedgeStop }

/**
 * A hairpin: a dynamic that grows or fades from here to somewhere later,
 * often several measures away. MusicXML marks both ends and numbers them so
 * they can be matched, as it does a slur, and MNX states the pair
 * once, on the end where it begins. A stop hands back the stop itself, which
 * wording written there can qualify. A wedge that converts to nothing reads
 * as nothing.
 */
function readWedge(
  found: XmlElement,
  position: Fraction,
  overGrace: number,
  measure: number,
  slot: number,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): WedgeReading | undefined {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // A hairpin is reported long after this, when the part is whole and the
  // pairing finds an edge with nothing to join it to, so the <wedge> is
  // recorded with the edge.
  const where = writtenAt(found, context, warnings)

  if (type === 'stop') {
    // Grace notes written before the stop are drawn under the hairpin. Which
    // of them it ends on is settled once the measure is whole, because the
    // ones read after it decide how MNX numbers the ones read before it.
    return {
      edge: 'stop',
      stop: state.spanners.stopWedge(number, measure, position, overGrace, staff, where),
    }
  }

  const wedge = type === undefined ? undefined : WEDGE_TYPES.get(type)
  if (!wedge) {
    // "continue" marks a point partway along a hairpin, which MNX has no need
    // of, since it states only where one begins and ends.
    if (type !== 'continue') {
      warnings.addUndefinedAttribute(
        found,
        'type',
        'so the whole hairpin is not carried over.',
        context,
      )
      // The stop the source wrote for this hairpin goes with it, unreported: a
      // stop states its type as the word "stop", handled above, so an unknown
      // type can only be meant as a start.
      state.spanners.dropWedgeStart(number, measure, position, staff, where)
    }
    return undefined
  }

  // A hairpin states no value of its own: what it grows from and to is said
  // by the plain marks around it.
  const hairpin: OpenHairpin = {
    measure,
    position,
    wedge,
    staff,
    ...(placement !== undefined ? { placement } : {}),
    slot,
  }
  state.spanners.startWedge(hairpin, number, where)
  return { edge: 'start', hairpin }
}

/**
 * What wording trailing a mark can be put on. A hairpin's stop is not a mark
 * yet, so it holds the words until the pairing names the hairpin.
 */
type SuffixTarget =
  { kind: 'mark'; mark: Dynamic | OpenHairpin } | { kind: 'stop'; stop: WedgeStop }

/**
 * Puts wording on the mark it trails, as that mark's suffix, and reports it
 * where nothing takes it.
 *
 * The mark cannot have a suffix yet. This runs once for each
 * <direction-type>, on a mark read in it. A stop already worded on the other
 * side keeps the first wording, because the source wrote both.
 */
function closeWithWording(
  target: SuffixTarget | undefined,
  wording: Wording,
  warnings: WarningCollector,
): void {
  if (target?.kind === 'mark') target.mark.suffix = wording.text
  else if (target?.kind === 'stop' && target.stop.wording === undefined) {
    target.stop.wording = wording
  } else reportLoneWording(wording, warnings)
}

// How long the final note of a movement sounds, in divisions. MusicXML writes
// it as a decimal, and XML's decimal allows every one of "8", "8.5", "8." and
// ".5", with a leading plus. A duration is never negative, so no minus.
const FINAL_NOTE_DURATION = /^\+?(\d+(\.\d*)?|\.\d+)$/

/**
 * A <sound> is mostly playback. Its tempo is playback, not notation: MNX's
 * tempo is always drawn, so a tempo written from a <sound> would draw a mark
 * the source did not. A <sound tempo> at the same point and tempo as a drawn
 * <metronome> echoes the mark and is not reported. Any other is reported as a
 * converter gap, because the schema does hold a tempo. The tempo comes back
 * for the caller to settle, because the mark can be written after the <sound>
 * or by another part. A velocity or a pan position has no home, and is reported as such.
 *
 * <sound fine> is a Fine and <sound dalsegno> a dal-segno jump. Both go on
 * the score's measure where the <sound> is written. The rest is reported.
 */
export function readSound(
  sound: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): SoundReading {
  let fine: Fine | undefined
  let jump: DalSegno | undefined
  let segnoName: string | undefined
  let tempo: SoundTempo | undefined
  for (const name of Object.keys(sound.element.attributes)) {
    if (name === 'tempo') {
      tempo = {
        position,
        bpm: parseDecimal((attribute(sound.element, 'tempo') ?? '').trim()),
        element: sound.element,
        place: warnings.reserve(),
      }
      continue
    }
    if (name === 'fine') {
      // MusicXML writes the fine as "yes", or as the divisions the final note
      // sounds for. Either marks the Fine, and the number is playback. Any
      // other value is reported, not read as a Fine.
      const written = (attribute(sound.element, 'fine') ?? '').trim()
      if (written === 'yes' || FINAL_NOTE_DURATION.test(written)) {
        fine = { location: position }
        continue
      }
      warnings.add(
        'unresolved:attribute-value',
        `The "fine" of a <sound> is "${written}", which is neither "yes" nor a duration.`,
        context,
        sound.element,
        'fine',
      )
      continue
    }
    if (name === 'dalsegno') {
      // The attribute names the segno to jump to. MNX's jump has no target, so
      // the name is not written; it is kept to find the sign the jump returns
      // to, which is what decides whether a Fine stops it.
      const target = attribute(sound.element, 'dalsegno')
      jump = { location: position, ...(target ? { target } : {}) }
      continue
    }
    if (name === 'segno') {
      // Names the sign drawn beside it. MNX has no label for a segno, so this
      // is still a loss and still reported; it is read only to tell one sign
      // from another when matching a jump to the one it goes back to.
      segnoName = attribute(sound.element, 'segno')
    }
    // Classified by attribute name, not element name: <sound dynamics> is a
    // playback velocity with no home, unlike the <dynamics> element.
    const loss = attributeLoss('sound', name)
    warnings.add(
      loss.code,
      `The "${name}" of a <sound> ${loss.ending}`,
      context,
      sound.element,
      name,
    )
  }
  return { fine, jump, segnoName, tempo }
}

// The side a direction is drawn on, from its placement. MusicXML's above and
// below are the words MNX states, so a known one passes straight through.
function placementOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

/**
 * The wording seen so far with no mark yet to qualify. A source writes "più
 * f" as the text and the mark side by side, sometimes in sibling <dynamics>
 * blocks or beside the <wedge> the words qualify, so the text is held for
 * the whole <direction-type> until the mark it opens arrives and becomes
 * that mark's prefix. Anything still held once the marks run out closes the
 * last one instead, as its suffix, or is reported where no mark takes it.
 * The element of each piece is held with it, so a report points at the
 * wording.
 *
 * Pieces are held as written and trimmed only once joined, so that the
 * source's own spacing decides where the words run together: "sempre " and
 * "più " make "sempre più", while "s" and "morz." make "smorz.".
 */
class PendingWording {
  #pieces: XmlElement[] = []

  push(piece: XmlElement): void {
    this.#pieces.push(piece)
  }

  take(): { text: string; element: XmlElement } | undefined {
    const first = this.#pieces[0]
    if (first === undefined) return undefined
    const held = {
      text: this.#pieces
        .map((piece) => piece.text)
        .join('')
        .trim(),
      element: first,
    }
    this.#pieces = []
    return held
  }
}

function readDynamics(
  element: ElementReader,
  position: Fraction,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  wording: PendingWording,
  warnings: WarningCollector,
  context: ReportContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []

  for (const mark of element.element.children) {
    element.read(mark)
    const accent = ACCENT_DYNAMICS.get(mark.name)
    if (mark.name === 'other-dynamics') {
      // The glyph is reported before the text is read: an element naming a
      // glyph and holding no text still says something the output cannot.
      reportWordingGlyph(mark, trimmedText(mark), warnings, context)
      if (trimmedText(mark) === '') continue
      wording.push(mark)
    } else if (isDynamicValue(mark.name)) {
      const prefix = wording.take()
      dynamics.push({
        kind: 'immediate',
        position,
        value: mark.name,
        staff,
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(placement !== undefined ? { placement } : {}),
      })
    } else if (accent) {
      const prefix = wording.take()
      dynamics.push({
        kind: 'accent',
        position,
        value: accent.value,
        residualValue: accent.residualValue,
        accentPrefix: accent.prefix,
        accentSuffix: accent.suffix,
        glyphs: [accent.glyph],
        staff,
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(placement !== undefined ? { placement } : {}),
      })
    } else {
      warnings.addWhole(
        'unsupported:element',
        `A dynamic of "${mark.name}" is not converted yet.`,
        context,
        mark,
      )
      // The wording opened this mark, so it goes with it.
      const orphaned = wording.take()
      if (orphaned)
        warnings.add(
          'unsupported:element',
          `A dynamic wording of "${orphaned.text}" is not converted yet, because the ` +
            `"${mark.name}" it qualifies is not.`,
          context,
          orphaned.element,
        )
    }
  }

  // Wording still pending is left in the holder: the mark it qualifies may
  // sit in a sibling <dynamics> block or be the <wedge> beside this one, and
  // whatever is left once the <direction-type> runs out is settled there.
  return dynamics
}

/**
 * Report the glyph a source names for its wording. MNX states glyphs for the
 * dynamic mark itself, so putting one there would redraw the mark, not the
 * words. The wording goes over as text and the glyph is reported.
 *
 * The two cases are different kinds of loss. A glyph with no text is the
 * mark itself, and a later release may read the level that glyph draws: a
 * converter gap. A glyph named for words that also
 * convert has no home, because the schema nowhere states how the
 * wording is drawn: a format limit.
 */
function reportWordingGlyph(
  element: XmlElement,
  wording: string,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const glyph = attribute(element, 'smufl')
  if (glyph === undefined) return
  if (wording === '') {
    warnings.add(
      'unsupported:element',
      `A dynamic drawn only as the glyph "${glyph}" is not converted yet, because MNX ` +
        'states a glyph for the dynamic mark, not for its wording.',
      context,
      element,
      'smufl',
    )
  } else {
    warnings.add(
      'unrepresentable:wording-glyph',
      `The glyph named for the dynamic wording "${wording}" is drawn as text instead, ` +
        'because MNX states a glyph for the dynamic mark, not for its wording.',
      context,
      element,
      'smufl',
    )
  }
}

function readMetronome(
  reader: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): Tempo[] {
  const element = reader.element
  // MusicXML allows several <beat-unit> children: a second one states the
  // tempo as one note value equalling another. Every part of the mark is read
  // here, because a dropped mark is dropped whole, and the sweep would report
  // an unread part a second time.
  const perMinute = reader.children('per-minute')[0]
  const beatUnit = reader.children('beat-unit')[0]
  const tied = reader.children('beat-unit-tied')
  // A beat unit can be dotted.
  const dots = reader.children('beat-unit-dot').length

  // The mark converts to nothing, and the warning already names the whole of
  // it, so the parts that state it go with it rather than being reported one
  // by one. <metronome-arrows> is among them here, and only here: on a mark
  // that does convert, the arrows are a loss of their own.
  const dropWholeMark = (): Tempo[] => {
    reader.skip('metronome-note', 'metronome-relation', 'metronome-arrows', 'beat-unit-tied')
    return []
  }

  // MusicXML can also state a metronome as one note value equalling another,
  // a metrical modulation. MNX states a tempo as a note value and a count of
  // them per minute, and that form carries no number, so there is
  // nothing to put there.
  if (!perMinute || !beatUnit) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> written as one note value equalling another cannot be expressed ' +
        'in MNX, which states a tempo as beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // A <beat-unit> that is not a note value, such as the empty one some
  // exporters write where the mark has no note glyph, drops the mark. MusicXML
  // defines the beat unit as a note value, so it is the source's problem. It
  // is reported, not refused.
  const base = noteValueBaseOf(beatUnit)
  if (!base) {
    warnings.add(
      'unresolved:element-value',
      `A <metronome> states a beat unit of "${trimmedText(beatUnit)}", which is not a note ` +
        'value, so the mark is not converted.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // A beat unit tied to another states a compound beat, such as a quarter
  // tied to an eighth. MNX states a tempo's beat as one note value with dots,
  // which cannot spell every tie, and the first unit alone would state the
  // wrong tempo.
  if (tied.length > 0) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> whose beat unit is tied to another cannot be expressed in MNX, ' +
        'which states a tempo as one note value and a count of them per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // An empty <per-minute> is valid: it prints the beat-unit glyph alone, with
  // the number supplied as adjacent text. MNX's tempo needs a bpm, so the
  // mark is dropped and reported.
  const written = trimmedText(perMinute)
  if (written === '') {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> with no beats-per-minute number cannot be expressed in MNX, ' +
        'which states a tempo as beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // MusicXML's per-minute is a string, so it can be a word such as "fast",
  // or a number of zero or less. MNX states a tempo as a positive number of
  // beats per minute, so either is dropped and reported.
  //
  // Read as a plain decimal. Number() would read "0x10" as sixteen.
  const bpm = parseDecimal(written)
  if (bpm === undefined || bpm <= 0) {
    warnings.add(
      'unrepresentable:tempo',
      `A <metronome> states its tempo as "${written}", which cannot be expressed in MNX, ` +
        'which states a tempo as a positive number of beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  return [{ position, value: { base, dots }, bpm }]
}
