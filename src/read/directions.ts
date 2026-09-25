// Reading a <direction>: the dynamics, tempo marks and other instructions
// that sit between the notes rather than on them.
//
// A <direction> holds one or more <direction-type>s and appears at wherever
// the cursor has reached in the measure. A dynamic belongs to the part's
// measure at that position; a metronome mark belongs to the score's measure,
// since a tempo is the whole score's. Much of what a direction can carry has
// no home in MNX, and is reported.

import type { DocumentPath } from '../errors.js'
import { addFractions, compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  AccentPrefix,
  AccentSuffix,
  Dynamic,
  DynamicValue,
  Fine,
  Jump,
  OttavaAmount,
  Segno,
  Tempo,
  WedgeType,
} from '../model/score.js'
import type { WarningCollector, WarningContext, WarningPlace } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { readColor } from './color.js'
import { divisionsInForce } from './divisions.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseDecimal, parseWholeNumber, readIntegerInRange } from './numbers.js'
import type { GraceNotesAt } from './voices.js'
import type { StopWording, WedgeStop } from './spanners.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import { entriesOf, recogniser } from './tables.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'

/** What one <direction> was found to carry. */
export interface DirectionReading {
  dynamics: Dynamic[]
  tempos: Tempo[]
  segnos: Segno[]
  fines: Fine[]
  jumps: Jump[]
  /** Each <sound tempo> the direction states. */
  soundTempos: SoundTempo[]
}

/** The navigation a single <sound> element carries a home for. */
export interface SoundReading {
  fine: Fine | undefined
  jump: Jump | undefined
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
  line: number
  /**
   * The place kept in the report for the decision. The verdict is settled
   * once every part is read, and reporting it there would put it after every
   * loss read since; this holds its spot where the <sound> is written.
   */
  place: WarningPlace
}

// The plain dynamic marks MNX states as a value. A recogniser rather than a
// bare set, so this list and the model's own union are held to each other and
// the mark it accepts reaches the writer without a cast.
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
interface AccentDynamic {
  glyph: string
  value: DynamicValue | undefined
  residualValue: DynamicValue | undefined
  prefix: AccentPrefix | undefined
  suffix: AccentSuffix | undefined
}
const ACCENT_DYNAMICS = new Map<string, AccentDynamic>([
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
  // pf (poco forte / piano-forte) has no settled reading of its two letters,
  // and the accent prefixes MNX names stop at s and r, so its glyph alone is
  // carried rather than a fabricated spelling.
  [
    'pf',
    {
      glyph: 'dynamicPF',
      value: undefined,
      residualValue: undefined,
      prefix: undefined,
      suffix: undefined,
    },
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
    soundTempos: [],
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

  // How many grace notes stand at the cursor and were written before this
  // direction. A span stopping there is drawn over them, so its end names the
  // last of them rather than the place they all share. An octave shift reads
  // its end from the cursor whatever an <offset> says, so it counts them
  // either way. A hairpin is drawn where the offset puts it, and grace notes
  // are counted only where that is the cursor: the source says nothing about
  // which grace note an offset lands beside, so none is named.
  const graceAtCursor = graceNotesAt(position, staff)
  const overGrace = compareFractions(at, position) === 0 ? graceAtCursor : 0

  for (const directionType of element.blocks('direction-type')) {
    // The wording is held for the whole <direction-type>: MusicXML allows
    // the words and the mark they qualify in sibling <dynamics> blocks, and
    // "cresc." beside a <wedge> is the hairpin's own wording.
    const wording = new PendingWording()
    let lastMark: SuffixTarget | undefined
    for (const found of directionType.element.children) {
      // Each arm accounts for the child it handles, so that the sweep at the
      // top says what became of every one of them. A type read plainly has
      // its attributes swept with the other read children; a <metronome> is
      // read through a reader of its own, so the sweep reports the children
      // that reader passed over; an unhandled type is reported whole below,
      // which accounts for it in place of reading it.
      switch (found.name) {
        case 'dynamics': {
          // Read plainly: readDynamics reports every child of a <dynamics>
          // it does not know, so the sweep has nothing left to say.
          directionType.children('dynamics')
          const marks = readDynamics(found, at, staff, orient, wording, warnings, context)
          reading.dynamics.push(...marks)
          const last = marks[marks.length - 1]
          if (last) lastMark = { kind: 'mark', mark: last }
          break
        }
        case 'metronome':
          reading.tempos.push(...readMetronome(directionType.block(found), at, warnings, context))
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
            orient,
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
            staff,
            orient,
            state,
            warnings,
            context,
          )
          if (wedge?.edge === 'start') {
            const prefix = wording.take()
            if (prefix !== undefined) wedge.hairpin.prefix = prefix.text
            reading.dynamics.push(wedge.hairpin)
            lastMark = { kind: 'mark', mark: wedge.hairpin }
          } else if (wedge) {
            // Wording at a closing edge trails the mark. Words pending at the
            // stop wait on it until the pairing names the hairpin. Wording
            // after the stop closes the same stop.
            const suffix = wording.take()
            if (suffix !== undefined) {
              wedge.stop.wording = stopWording(suffix.text, at, staff, orient)
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
            location: at,
            glyph: attribute(found, 'smufl'),
            color: readColor(found, warnings, context),
          })
          break
        default: {
          // Accounted for by the warning below, which names the whole of it.
          directionType.skip(found.name)
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

    // Wording left over closes the mark before it. With no mark to close, it
    // stands alone: MNX requires only a position and a type of a dynamic
    // group, so the words are carried on a group with no level rather than
    // qualifying a level the source never wrote.
    const trailing = wording.take()
    if (trailing !== undefined) {
      const group = suffixOrStandalone(lastMark, trailing.text, at, staff, orient)
      if (group) reading.dynamics.push(group)
    }
  }

  // Read after the direction types, so that a <metronome> beside it has
  // already had its say about the tempo. Whether a <sound tempo> echoes a
  // mark waits for the end of the score, because the mark can be drawn by a
  // later <direction> at the same point, or by another part.
  for (const sound of element.blocks('sound')) {
    const soundReading = readSound(sound, at, warnings, context)
    if (soundReading.fine) reading.fines.push(soundReading.fine)
    if (soundReading.jump) reading.jumps.push(soundReading.jump)
    if (soundReading.tempo) reading.soundTempos.push(soundReading.tempo)
    // The <sound> naming the sign sits in the same <direction> as the <segno>
    // it names, so the name is put on the signs this direction just read.
    if (soundReading.segnoName !== undefined) {
      const name = soundReading.segnoName
      reading.segnos = reading.segnos.map((segno) => ({ ...segno, name }))
    }
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
  const count = parseWholeNumber(written)
  if (count === undefined) {
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
  const moved = addFractions(position, fraction(count, divisions * 4))

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
  const measure = measureLength(state)
  return measure !== undefined && compareFractions(position, measure) > 0
}

// How far MusicXML's octave-shift sizes move the music, in octaves, each way
// the shift can go. The numbers are the ones written on the page: 8va is one
// octave, 15ma two. MNX states the other direction as a negative amount, so
// both are written out here, keyed by the type MusicXML wrote, rather than
// negated at the call site where the result would leave the model's union.
const SHIFT_SIZES = new Map<string, Record<'up' | 'down', OttavaAmount>>([
  ['8', { down: 1, up: -1 }],
  ['15', { down: 2, up: -2 }],
  ['22', { down: 3, up: -3 }],
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
  cursor: Fraction,
  graceAtCursor: number,
  measure: number,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // Read before the edges split, because a stop or continue restates the
  // start's size and the shift's octaves come from the start alone.
  const size = attribute(found, 'size') ?? '8'
  // Recorded with the edge for the same reason a hairpin's is: the shift is
  // reported once the part is whole, when the element is gone.
  const where = { ...context, line: found.line }

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

  const shift = SHIFT_SIZES.get(size)
  if ((type !== 'up' && type !== 'down') || !shift) {
    warnings.add(
      'unsupported:element',
      `An <octave-shift> of type "${type ?? ''}" and size "${size}" is not converted yet, ` +
        'so the whole shift is not carried over.',
      where,
      'octave-shift',
    )
    // The stop the source wrote for this shift goes with it, unreported: only
    // "stop" and "continue" are handled above, so an unknown type can only be
    // meant as a start.
    state.spanners.dropOttavaStart(number, measure, position, staff, where)
    return
  }

  const value = shift[type]
  state.spanners.startOttava(
    { measure, position, value, staff, ...(orient !== undefined ? { orient } : {}) },
    number,
    measure,
    position,
    where,
  )
}

// MusicXML's wedge types, in MNX's. A hairpin opening to the right gets
// louder; one closing gets softer. Keyed by the model's own word, so a hairpin
// shape the model gains and this table lacks does not compile.
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
type WedgeReading = { edge: 'start'; hairpin: Dynamic } | { edge: 'stop'; stop: WedgeStop }

/**
 * A hairpin: a dynamic that grows or fades from here to somewhere later,
 * often several measures away. MusicXML marks both ends and numbers them so
 * they can be matched, exactly as it does a slur, and MNX states the pair
 * once, on the end where it begins. A stop hands back the stop itself, which
 * wording written there can qualify. A wedge that converts to nothing reads
 * as nothing.
 */
function readWedge(
  found: XmlElement,
  position: Fraction,
  overGrace: number,
  measure: number,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): WedgeReading | undefined {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // A hairpin is reported long after this, when the part is whole and the
  // pairing finds an edge with nothing to join it to. The <wedge> itself is
  // gone by then, so its line is recorded with the edge.
  const where = { ...context, line: found.line }

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
      warnings.add(
        'unsupported:element',
        `A <wedge> of type "${type ?? ''}" is not converted yet, ` +
          'so the whole hairpin is not carried over.',
        where,
        'wedge',
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
  const hairpin: Dynamic = {
    position,
    value: undefined,
    wedge,
    end: undefined,
    staff,
    ...(orient !== undefined ? { orient } : {}),
  }
  state.spanners.startWedge(hairpin, number, measure, position, where)
  return { edge: 'start', hairpin }
}

/**
 * What wording trailing a mark can be put on. A hairpin's stop is not a mark
 * yet, so it holds the words until the pairing names the hairpin.
 */
type SuffixTarget = { kind: 'mark'; mark: Dynamic } | { kind: 'stop'; stop: WedgeStop }

/**
 * Puts wording on the mark it trails, as that mark's suffix. Hands back the
 * group to draw where nothing takes the words.
 *
 * The mark cannot have a suffix yet. This runs once for each
 * <direction-type>, on a mark read in it. A stop already worded on the other
 * side keeps the first wording, because the source wrote both.
 */
function suffixOrStandalone(
  target: SuffixTarget | undefined,
  text: string,
  position: Fraction,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
): Dynamic | undefined {
  if (target?.kind === 'mark') {
    target.mark.suffix = text
    return undefined
  }
  if (target?.kind === 'stop' && target.stop.wording === undefined) {
    target.stop.wording = stopWording(text, position, staff, orient)
    return undefined
  }
  return standaloneWording(text, position, staff, orient)
}

/**
 * Wording written at a hairpin's closing edge: the text the hairpin takes as
 * its suffix, and the group it is drawn as where no hairpin takes it.
 */
function stopWording(
  text: string,
  position: Fraction,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
): StopWording {
  return { text, standalone: standaloneWording(text, position, staff, orient) }
}

/**
 * Wording with no mark to qualify, carried as a dynamic group of its own:
 * MNX requires only a position and a type of one, so the words are drawn
 * where the source drew them and no level the source never wrote is stated.
 */
function standaloneWording(
  text: string,
  position: Fraction,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
): Dynamic {
  return {
    position,
    value: undefined,
    wedge: undefined,
    end: undefined,
    staff,
    prefix: text,
    ...(orient !== undefined ? { orient } : {}),
  }
}

/**
 * A <sound> is mostly a playback element, and most of what it carries reaches
 * nothing in the output. Its tempo is playback rather than notation: MNX's
 * tempo object is always drawn, so emitting one from a <sound> would fabricate
 * a metronome the source never displayed. A <metronome> beside it is the drawn
 * mark, and the <sound tempo> only echoes it for playback, so that echo is
 * passed over without a word. A bare <sound tempo> with no metronome is
 * reported as a converter gap rather than a format limit: the schema does hold
 * a tempo, and what stops this one being written is the decision above, not the
 * absence of anywhere to put it. Which of the two it is comes back as the
 * tempo for the caller to settle, because the mark it echoes can be written
 * after the <sound> and can be drawn by another part. A velocity or a pan
 * position has no such home, and says so.
 *
 * Two attributes are notation MNX does hold: <sound fine> is a Fine, and
 * <sound dalsegno> a dal-segno jump. Both go on the score's measure at the
 * point the <sound> is written, and the rest is reported as before.
 */
// How long the final note of a movement sounds, in divisions. MusicXML writes
// it as a decimal, and XML's decimal allows every one of "8", "8.5", "8." and
// ".5", with a leading plus. A duration is never negative, so no minus.
const FINAL_NOTE_DURATION = /^\+?(\d+(\.\d*)?|\.\d+)$/

export function readSound(
  sound: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): SoundReading {
  let fine: Fine | undefined
  let jump: Jump | undefined
  let segnoName: string | undefined
  let tempo: SoundTempo | undefined
  for (const name of Object.keys(sound.element.attributes)) {
    // Every attribute is either handled or reported below, so each is
    // accounted for the moment the loop reaches it.
    attribute(sound.element, name)
    if (name === 'tempo') {
      tempo = {
        position,
        bpm: parseDecimal((attribute(sound.element, 'tempo') ?? '').trim()),
        line: sound.line,
        place: warnings.reserve(),
      }
      continue
    }
    if (name === 'fine') {
      // MusicXML writes the fine as "yes", or as the divisions the final note
      // sounds for. The number is playback and the Fine it marks is the
      // notation, so both mark the Fine and the number is passed over. The
      // presence of the attribute is not the mark on its own: a value the
      // format does not define says nothing about where the piece ends, and
      // writing a Fine from it would end the piece where the source did not.
      const written = (attribute(sound.element, 'fine') ?? '').trim()
      if (written === 'yes' || FINAL_NOTE_DURATION.test(written)) {
        fine = { location: position }
        continue
      }
      warnings.add(
        'unresolved:attribute-value',
        `The "fine" of a <sound> is "${written}", which is neither "yes" nor a duration.`,
        { ...context, line: sound.line },
        'sound',
        'fine',
      )
      continue
    }
    if (name === 'dalsegno') {
      // The attribute names the segno to jump to. MNX's jump has no target, so
      // the name is not written; it is kept to find the sign the jump returns
      // to, which is what decides whether a Fine stops it.
      const target = attribute(sound.element, 'dalsegno')
      jump = { location: position, type: 'segno', ...(target ? { target } : {}) }
      continue
    }
    if (name === 'segno') {
      // Names the sign drawn beside it. MNX has no label for a segno, so this
      // is still a loss and still reported; it is read only to tell one sign
      // from another when matching a jump to the one it goes back to.
      segnoName = attribute(sound.element, 'segno')
    }
    // Classified as the attribute it is. Classifying it by element name gave a
    // <sound dynamics> the verdict of the <dynamics> element, which does have
    // a home, so a playback velocity read as a converter gap.
    const loss = attributeLoss('sound', name)
    warnings.add(
      loss.code,
      `The "${name}" of a <sound> ${loss.ending}`,
      { ...context, line: sound.line },
      'sound',
      name,
    )
  }
  return { fine, jump, segnoName, tempo }
}

// The side a direction is drawn on, from its placement. MusicXML's above and
// below are the words MNX states, so a known one passes straight through.
// The <direction-type> children a reader takes something from. Their
// attributes are swept after the reader has run; anything else is reported
// as a whole element, its attributes covered by that report.
function orientOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

/**
 * The wording seen so far with no mark yet to qualify. A source writes "più
 * f" as the text and the mark side by side, sometimes in sibling <dynamics>
 * blocks or beside the <wedge> the words qualify, so the text is held for
 * the whole <direction-type> until the mark it opens arrives and becomes
 * that mark's prefix. Anything still held once the marks run out closes the
 * last one instead, as its suffix, or is carried standing alone. The line of
 * each piece is held with it, so a report points at the wording rather than
 * at the block around it.
 *
 * Pieces are held as written and trimmed only once joined, so that the
 * source's own spacing decides where the words run together: "sempre " and
 * "più " make "sempre più", while "s" and "morz." make "smorz.".
 */
class PendingWording {
  #pieces: { text: string; line: number }[] = []

  push(text: string, line: number): void {
    this.#pieces.push({ text, line })
  }

  take(): { text: string; line: number } | undefined {
    const first = this.#pieces[0]
    if (first === undefined) return undefined
    const held = {
      text: this.#pieces
        .map((piece) => piece.text)
        .join('')
        .trim(),
      line: first.line,
    }
    this.#pieces = []
    return held
  }
}

function readDynamics(
  element: XmlElement,
  position: Fraction,
  staff: number | undefined,
  orient: 'above' | 'below' | undefined,
  wording: PendingWording,
  warnings: WarningCollector,
  context: WarningContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []

  for (const mark of element.children) {
    const accent = ACCENT_DYNAMICS.get(mark.name)
    if (mark.name === 'other-dynamics') {
      // The glyph is reported before the text is weighed: an element naming a
      // glyph and holding no text still says something the output cannot.
      reportWordingGlyph(mark, trimmedText(mark), warnings, context)
      if (trimmedText(mark) === '') continue
      wording.push(mark.text, mark.line)
    } else if (isDynamicValue(mark.name)) {
      const prefix = wording.take()
      dynamics.push({
        position,
        value: mark.name,
        wedge: undefined,
        end: undefined,
        staff,
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(orient !== undefined ? { orient } : {}),
      })
    } else if (accent) {
      const prefix = wording.take()
      dynamics.push({
        position,
        value: accent.value,
        wedge: undefined,
        end: undefined,
        staff,
        accent: {
          residualValue: accent.residualValue,
          prefix: accent.prefix,
          suffix: accent.suffix,
          glyphs: [accent.glyph],
        },
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(orient !== undefined ? { orient } : {}),
      })
    } else {
      warnings.add(
        'unsupported:element',
        `A dynamic of "${mark.name}" is not converted yet.`,
        { ...context, line: mark.line },
        mark.name,
      )
      // The wording opened this mark, so it goes with it. Passing it on to
      // the next mark would draw the words against something the source never
      // stood them in front of.
      const orphaned = wording.take()
      if (orphaned)
        warnings.add(
          'unsupported:element',
          `A dynamic wording of "${orphaned.text}" is not converted yet, because the ` +
            `"${mark.name}" it qualifies is not.`,
          { ...context, line: orphaned.line },
          'other-dynamics',
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
 * dynamic mark itself, so putting one there would redraw the mark rather than
 * the words; the wording goes over as text and the glyph is said out loud.
 *
 * The two cases are different kinds of loss. A glyph with no text is the
 * mark itself, and a group with no level can state glyphs, so a later
 * release may carry it: a converter gap. A glyph named for words that also
 * convert has no home at all, because the schema nowhere states how the
 * wording is drawn: a format limit.
 */
function reportWordingGlyph(
  element: XmlElement,
  wording: string,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const glyph = attribute(element, 'smufl')
  if (glyph === undefined) return
  if (wording === '') {
    warnings.add(
      'unsupported:element',
      `A dynamic drawn only as the glyph "${glyph}" is not converted yet, because MNX ` +
        'states a glyph for the dynamic mark, not for its wording.',
      { ...context, line: element.line },
      'other-dynamics',
      'smufl',
    )
  } else {
    warnings.add(
      'unrepresentable:wording-glyph',
      `The glyph named for the dynamic wording "${wording}" is drawn as text instead, ` +
        'because MNX states a glyph for the dynamic mark, not for its wording.',
      { ...context, line: element.line },
      'other-dynamics',
      'smufl',
    )
  }
}

function readMetronome(
  reader: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): Tempo[] {
  const element = reader.element
  // MusicXML allows several <beat-unit> children: a second one states the
  // tempo as one note value equalling another. Both are read, so the sweep
  // does not report a child this reader did weigh. Every part of the mark is
  // read here rather than where it is used, because a mark that is dropped is
  // dropped whole, and a part of it left unread would be reported a second
  // time, as a converter gap, by the sweep.
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
    reader.skip('metronome-note', 'metronome-relation', 'metronome-arrows')
    return []
  }

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
    return dropWholeMark()
  }

  // A beat unit that is not a note value is written by real exporters, which
  // leave the element empty where the mark carries no note glyph. The tempo is
  // all such a mark states, and nothing reads it but the mark itself, so it is
  // a reported drop rather than a refusal, as every other part of a metronome
  // the converter cannot read already is.
  const base = noteValueBaseOf(beatUnit)
  if (!base) {
    warnings.add(
      'unrepresentable:tempo',
      `A <metronome> states a beat unit of "${trimmedText(beatUnit)}", which is not a note ` +
        'value, so the mark cannot be expressed in MNX.',
      { ...context, line: beatUnit.line },
      'metronome',
    )
    return dropWholeMark()
  }

  // A beat unit tied to another states a compound beat, such as a quarter
  // tied to an eighth. MNX states a tempo's beat as one note value with dots,
  // which cannot spell every tie, and reading the first unit alone would put
  // a tempo in the output a third away from the one the source wrote.
  if (tied.length > 0) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> whose beat unit is tied to another cannot be expressed in MNX, ' +
        'which states a tempo as one note value and a count of them per minute.',
      { ...context, line: element.line },
      'metronome',
    )
    return dropWholeMark()
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
    return dropWholeMark()
  }

  // MusicXML's per-minute is a string, so it can be a descriptive word such as
  // "fast" rather than a number. MNX states a tempo as a positive number of
  // beats per minute, so a non-numeric one, and zero itself, are reported
  // drops rather than refusals.
  //
  // Read as a plain decimal number, which is what a score states a tempo in.
  // Number() would take spellings the source cannot mean as a tempo and hand
  // back a number for them: "0x10" would be sixteen beats per minute and
  // "0b101" five, when both are words this converter has no reading for.
  const bpm = parseDecimal(written)
  if (bpm === undefined || bpm <= 0) {
    warnings.add(
      'unrepresentable:tempo',
      `A <metronome> states its tempo as "${written}", which cannot be expressed in MNX, ` +
        'which states a tempo as a positive number of beats per minute.',
      { ...context, line: perMinute.line },
      'metronome',
    )
    return dropWholeMark()
  }

  return [{ position, value: { base, dots }, bpm }]
}
