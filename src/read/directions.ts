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
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, trimmedText } from '../xml/tree.js'
import { readColor } from './color.js'
import { divisionsInForce } from './divisions.js'
import { reportUnreadAttributes } from './element.js'
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
  /**
   * What the source calls the segno drawn in this direction. Not written: it
   * names the sign so a jump can be matched to the one it returns to.
   */
  segnoName: string | undefined
}

// The plain dynamic marks MNX states as a value.
const DYNAMIC_VALUES: ReadonlySet<string> = new Set([
  'pppppp',
  'ppppp',
  'pppp',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'ffff',
  'fffff',
  'ffffff',
  'n',
])

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
    // The wording is held for the whole <direction-type>: MusicXML allows
    // the words and the mark they qualify in sibling <dynamics> blocks, and
    // "cresc." beside a <wedge> is the hairpin's own wording.
    const wording = new PendingWording()
    let lastMark: Dynamic | undefined
    for (const found of directionType.children) {
      // A handled child is walked raw rather than through a reader of its
      // own, so its attributes are swept here once its reader has taken
      // what it converts. An unhandled child is reported whole below.
      const handled = HANDLED_DIRECTION_TYPES.has(found.name)
      switch (found.name) {
        case 'dynamics': {
          const marks = readDynamics(found, at, staff, orient, wording, warnings, context)
          reading.dynamics.push(...marks)
          lastMark = marks[marks.length - 1] ?? lastMark
          break
        }
        case 'metronome':
          reading.tempos.push(...readMetronome(found, at, warnings, context, path))
          break
        case 'octave-shift':
          readOctaveShift(found, at, lastEvent, measure, staff, orient, state, warnings, context)
          break
        case 'wedge': {
          const wedge = readWedge(found, at, measure, staff, orient, state, warnings, context)
          if (wedge?.edge === 'start') {
            const prefix = wording.take()
            if (prefix !== undefined) wedge.hairpin.prefix = prefix.text
            reading.dynamics.push(wedge.hairpin)
            lastMark = wedge.hairpin
          } else if (wedge) {
            // Wording at a hairpin's closing edge trails the mark, so words
            // pending when the stop is read become the hairpin's suffix, and
            // the stopped hairpin is what any wording after the stop closes.
            // A stop that matched no start leaves the wording where it is,
            // to stand alone below.
            const suffix = wording.take()
            if (suffix !== undefined) {
              if (wedge.hairpin.suffix === undefined) wedge.hairpin.suffix = suffix.text
              // The hairpin already carries wording from its starting edge,
              // and the source wrote both, so the closing words stand alone
              // rather than overwrite what the start said.
              else reading.dynamics.push(standaloneWording(suffix.text, at, staff, orient))
            }
            lastMark = wedge.hairpin
          }
          break
        }
        case 'segno':
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
          const loss = elementLoss(found.name)
          warnings.add(
            loss.code,
            `A <${found.name}> direction ${loss.ending}`,
            { ...context, line: found.line },
            found.name,
          )
        }
      }
      if (handled) reportUnreadAttributes(found, warnings, context)
    }

    // Wording left over closes the mark before it. With no mark at all, or a
    // mark whose suffix its own edges already wrote, it stands alone: MNX
    // requires only a position and a type of a dynamic group, so the words
    // are carried on a group with no level rather than qualifying a level the
    // source never wrote.
    const trailing = wording.take()
    if (trailing !== undefined) {
      if (lastMark && lastMark.suffix === undefined) lastMark.suffix = trailing.text
      else reading.dynamics.push(standaloneWording(trailing.text, at, staff, orient))
    }
  }

  // Read after the direction types, so that a <metronome> beside it has
  // already had its say about the tempo and a <sound> restating it is seen as
  // the echo it is.
  for (const sound of element.blocks('sound')) {
    const soundReading = readSound(sound, at, reading.tempos.length > 0, warnings, context)
    if (soundReading.fine) reading.fines.push(soundReading.fine)
    if (soundReading.jump) reading.jumps.push(soundReading.jump)
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
  // Read before the edges split, because a stop or continue restates the
  // start's size and the shift's octaves come from the start alone.
  const size = attribute(found, 'size') ?? '8'

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

  const octaves = SHIFT_SIZES.get(size)
  if ((type !== 'up' && type !== 'down') || !octaves) {
    warnings.add(
      'unsupported:element',
      `An <octave-shift> of type "${type ?? ''}" and size "${size}" is not converted yet, ` +
        'so the whole shift is not carried over.',
      { ...context, line: found.line },
      'octave-shift',
    )
    // The stop the source wrote for this shift goes with it, unreported: only
    // "stop" and "continue" are handled above, so an unknown type can only be
    // meant as a start.
    state.spanners.dropOttavaStart(number, measure, position, context)
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

/** Which edge of a hairpin a <wedge> marked, and the hairpin it belongs to. */
interface WedgeReading {
  edge: 'start' | 'stop'
  hairpin: Dynamic
}

/**
 * A hairpin: a dynamic that grows or fades from here to somewhere later,
 * often several measures away. MusicXML marks both ends and numbers them so
 * they can be matched, exactly as it does a slur, and MNX states the pair
 * once, on the end where it begins. A stop hands back the hairpin it closes,
 * so wording at the closing edge can qualify it; a stop that closes nothing,
 * or a wedge that converts to nothing, reads as nothing.
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
): WedgeReading | undefined {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'

  if (type === 'stop') {
    const closed = state.spanners.stopWedge(number, measure, position, context)
    return closed ? { edge: 'stop', hairpin: closed } : undefined
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
        { ...context, line: found.line },
        'wedge',
      )
      // The stop the source wrote for this hairpin goes with it, unreported: a
      // stop states its type as the word "stop", handled above, so an unknown
      // type can only be meant as a start.
      state.spanners.dropWedgeStart(number, measure, position, context)
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
  return { edge: 'start', hairpin }
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
  let segnoName: string | undefined
  for (const name of Object.keys(sound.element.attributes)) {
    // Every attribute is either handled or reported below, so each is
    // accounted for the moment the loop reaches it.
    attribute(sound.element, name)
    if (name === 'tempo' && tempoAlreadyStated) continue
    if (name === 'fine') {
      fine = { location: position }
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
    // Classified by attribute name: the D.C. and coda navigation has no
    // jump-type to become in any release, while the rest is playback this
    // converter may yet find a home for.
    const loss = elementLoss(name)
    warnings.add(
      loss.code,
      `The "${name}" of a <sound> ${loss.ending}`,
      { ...context, line: sound.line },
      'sound',
      name,
    )
  }
  return { fine, jump, segnoName }
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
// The <direction-type> children a reader takes something from. Their
// attributes are swept after the reader has run; anything else is reported
// as a whole element, its attributes covered by that report.
const HANDLED_DIRECTION_TYPES: ReadonlySet<string> = new Set([
  'dynamics',
  'metronome',
  'octave-shift',
  'wedge',
  'segno',
])

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
    } else if (DYNAMIC_VALUES.has(mark.name)) {
      const prefix = wording.take()
      dynamics.push({
        position,
        value: mark.name as DynamicValue,
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
