// Reading an <attributes> block: what is in force from here on, and the clefs
// drawn at this point.
//
// A measure may carry more than one of these, because a clef can change
// partway through, so what they declare is folded into the measure in the
// order they are met.

import type { ReportContext } from './collector.js'
import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { Fraction } from '../fraction.js'
import type {
  Clef,
  PitchedClefSign,
  Key,
  OttavaAmount,
  StaffConfig,
  TimeSignature,
  TimeUnit,
  Transposition,
} from '../model/score.js'
import { WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, requireChild, trimmedText } from '../xml/tree.js'
import { ElementReader } from './element.js'
import type { Stated } from './element.js'
import {
  readAttributeInRange,
  readDecimalInRange,
  readInteger,
  readIntegerInRange,
} from './numbers.js'
import { staffLinesOf, staffPositionOfLine } from './state.js'
import type { PartState } from './state.js'
import { recogniser } from './tables.js'
import { elementLoss, reportHidden } from './unrepresentable.js'

// A recogniser narrows the value it accepts to the model's type, so a
// validated value reaches the writer without a cast. Each list and the model's
// union are checked against each other in both directions.
const isPitchedClefSign = recogniser<PitchedClefSign>({ C: true, F: true, G: true })

// The clef signs that place no pitch. A rest or an unpitched note placed by
// <display-step> reads against the clef in force, so each is held in force as
// the treble clef. That is how a percussion staff is read: bass drum on the
// bottom space and snare on the third are treble-clef positions.
//
// The <line> such a clef states is where the clef is drawn. MusicXML places
// pitches by the line for the G, F and C signs only.
//
// A percussion clef is written with MNX's percussion sign. A TAB staff's lines
// are strings and its notes are pitched, and jianpu uses numbers in place of a
// staff. Neither is written, and the sign is reported.
const UNPITCHED_CLEF_SIGNS: ReadonlySet<string> = new Set(['percussion', 'TAB', 'jianpu'])
const isTimeUnit = recogniser<TimeUnit>({
  1: true,
  2: true,
  4: true,
  8: true,
  16: true,
  32: true,
  64: true,
  128: true,
})

// The line a clef sits on when it states none, per MusicXML's defaults.
const DEFAULT_CLEF_LINES: Record<PitchedClefSign, number> = { G: 2, F: 4, C: 3 }

/** What one <attributes> block declared. */
export interface AttributesReading {
  /**
   * Every key and time signature the block states. A statement MNX cannot
   * carry, such as senza misura or a non-traditional key, has no value, which
   * differs from no statement. The measure settles what the staves state.
   *
   * A key is the one the player reads. The measure moves it to the key the
   * music sounds in, once it knows the transposition the notes are read in.
   */
  keys: readonly StaffSignature<Key>[]
  times: readonly StaffSignature<TimeSignature>[]
  /** The first time signature the block states that MNX can hold. */
  time: TimeSignature | undefined
  clefs: Stated<Clef>[]
  /** The staves this block starts drawing with a line count of their own. */
  staffConfigs: Stated<StaffConfig>[]
  /**
   * Every multi-measure rest span this block states, as a count of measures
   * starting at this one. A block may state one per staff, and the measure
   * checks whether they agree.
   */
  multimeasureRests: Stated<number>[]
  /**
   * Every measure repeat edge this block states: the pattern length of a sign
   * starting here, or a stop naming this the first measure without one.
   */
  measureRepeats: MeasureRepeatReading[]
}

/**
 * A key or time signature one block states, and the staff it states it for.
 * MusicXML allows one per staff, told apart by a "number" attribute, and a
 * block written without one speaks for every staff.
 */
export interface StaffSignature<T> {
  /** The staff it is stated for, or nothing where it speaks for every one. */
  staff: number | undefined
  /** What it states, or nothing where MNX cannot hold what it states. */
  value: T | undefined
  /**
   * How many staves the part had where this was read. A block later in the
   * measure can raise the count, and a statement speaks only for the staves
   * that stood when it was made.
   */
  staves: number
  /** The <key> or <time> stating it. */
  element: XmlElement
}

/**
 * A measure repeat sign starting at this measure, or stopping before it,
 * scoped to one staff. An edge written without a <measure-style> "number"
 * speaks for every staff of the part, and is read as one edge per staff.
 */
export type MeasureRepeatReading = (
  { edge: 'start'; measures: number; staff: number } | { edge: 'stop'; staff: number }
) & {
  /** The <measure-repeat> stating the edge. */
  element: XmlElement
}

// The one <staff-size> that states the default: a hundred percent of the
// work's scaling, written with or without a fraction. Matched as text rather
// than through Number(), which also reads "1e2" as a hundred.
const DEFAULT_STAFF_SIZE = /^\+?0*100(?:\.0*)?$/

export function readAttributes(
  element: ElementReader,
  state: PartState,
  // Where the measure's cursor has reached, which is where a clef declared
  // here is drawn: a clef can change partway through a measure.
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): AttributesReading {
  const divisionsElement = element.child('divisions')
  if (divisionsElement) {
    state.divisions = readDecimalInRange(divisionsElement, path, { above: 0, max: 1_000_000 })
    state.divisionsAssumed = false
  }

  const stavesElement = element.child('staves')
  if (stavesElement) {
    state.staves = readIntegerInRange(stavesElement, path, 1, 16)
    // A staff the part drops loses the transposition it was given. Added
    // back, it takes the one every staff has.
    const given = state.staffTranspositions.staves
    for (const staff of given.keys()) if (staff > state.staves) given.delete(staff)
  }

  // Each statement in <staff-details> is read on its own, and the sweep
  // reports the rest by name. A staff hidden with print-object="no" has a home
  // in MNX's layouts that is not built yet; its print-spacing goes with it.
  // The line count goes into the measure's staffConfigs. The size has no home
  // unless it states the default. MusicXML allows one <staff-details> per
  // staff, and one <staff-lines> in each.
  const staffConfigs: Stated<StaffConfig>[] = []
  for (const details of element.blocks('staff-details')) {
    // Not bounded to the part's staves: MusicXML numbers a staff with any
    // positive integer. A line count for a staff past the part's staves is
    // reported below.
    const named = readAttributeInRange(details.element, 'number', path, 1, Number.MAX_SAFE_INTEGER)
    if (attribute(details.element, 'print-object') === 'no') {
      attribute(details.element, 'print-spacing')
      warnings.add(
        'unsupported:element',
        'Hiding a staff with <staff-details print-object="no"> is not converted yet.',
        context,
        details.element,
      )
    }
    // MusicXML states a non-negative count, and MNX can draw a staff with no
    // lines. MNX holds a config in force until another replaces it, so a
    // count is carried only where it changes.
    const lines = details.child('staff-lines')
    if (lines) {
      const count = readIntegerInRange(lines, path, 0, Number.MAX_SAFE_INTEGER)
      const staff = named ?? 1
      if (staff > state.staves) {
        // Reported, not refused. If it were carried over with no staff
        // number, a count for staff 7 of a one-staff part would redraw its
        // only staff.
        warnings.add(
          'inconsistent:staff',
          `A staff line count is stated for staff ${String(staff)}, and this part is ` +
            `written on ${String(state.staves)}. It is not carried over.`,
          context,
          lines,
        )
      } else if (staffLinesOf(state, staff) !== count) {
        // A height is measured from the middle of the staff, which moves with
        // the count. The clef in force keeps the position it was written at,
        // so the notes keep their heights. Restating the clef here would move
        // them, and is not built.
        if (state.clefs.has(staff)) {
          warnings.add(
            'unsupported:element',
            'A staff changes how many lines it is drawn with, and no clef is restated ' +
              'on it. The notes on it keep the heights the clef in force gives them.',
            context,
            lines,
          )
        }
        state.staffLines.set(staff, count)
        staffConfigs.push({
          value: {
            lines: count,
            // Stated only where the part has more than one staff, as for a clef.
            staff: state.staves > 1 ? named : undefined,
            position,
          },
          element: lines,
        })
      }
    }
    // <staff-size> is a percentage of the default scaling, so 100 loses
    // nothing. MusicXML allows one per <staff-details>. The sweep reports its
    // scaling attribute.
    const size = details.child('staff-size')
    if (size && !DEFAULT_STAFF_SIZE.test(trimmedText(size))) {
      const loss = elementLoss('staff-size')
      warnings.add(loss.code, `<staff-size> ${loss.ending}`, context, size)
    }
  }

  readTransposition(element, state, warnings, context, path)

  // MusicXML allows one key and one time signature per staff, and MNX states
  // them for the whole score. The measure settles what the staves state,
  // because it sees the other blocks.
  //
  // Read as blocks, so the sweep reports what these readers skip inside a
  // <key>, <time> or <clef>.
  const keys = statedPerStaff(element.blocks('key'), state, path, (found) =>
    readKey(found, warnings, context, path),
  )
  const times = statedPerStaff(element.blocks('time'), state, path, (found) =>
    readTime(found, warnings, context, path),
  )
  const metered = times
    .map((stated) => stated.value)
    .filter((time): time is TimeSignature => time !== undefined)

  return {
    keys,
    times,
    time: metered[0],
    clefs: element
      .blocks('clef')
      .map((found) => {
        const clef = readClef(found, state, position, warnings, context, path)
        return clef && { value: clef, element: found.element }
      })
      .filter((clef) => clef !== undefined),
    staffConfigs,
    // MusicXML allows one <measure-style> per staff, so every block is read.
    ...element
      .blocks('measure-style')
      .map((found) => readMeasureStyle(found, state, warnings, context, path))
      .reduce(
        (all, reading) => ({
          multimeasureRests: [...all.multimeasureRests, ...reading.multimeasureRests],
          measureRepeats: [...all.measureRepeats, ...reading.measureRepeats],
        }),
        { multimeasureRests: [], measureRepeats: [] } as MeasureStyleReading,
      ),
  }
}

interface MeasureStyleReading {
  multimeasureRests: Stated<number>[]
  measureRepeats: MeasureRepeatReading[]
}

/**
 * What each block of a key or time signature states, and the staff it states
 * it for. The numbers are read before the values, so a block naming a staff
 * the part does not have is refused before anything is read out of one.
 */
function statedPerStaff<T>(
  blocks: readonly ElementReader[],
  state: PartState,
  path: DocumentPath,
  read: (block: ElementReader) => T | undefined,
): StaffSignature<T>[] {
  const numbers = blocks.map((block) =>
    readAttributeInRange(block.element, 'number', path, 1, state.staves),
  )
  return blocks.map((block, index) => ({
    // On a one-staff part, a number states the signature of the whole part.
    // A clef number works the same way. A later block can add a second
    // staff. The earlier signature then applies to that staff too. A second
    // signature stated beside it contradicts the part.
    staff: state.staves > 1 ? numbers[index] : undefined,
    value: read(block),
    staves: state.staves,
    element: block.element,
  }))
}

// The longest pattern MNX states for a measure repeat. MusicXML sets no
// upper bound, so a longer one has no home in MNX.
export const LONGEST_MNX_REPEAT = 4

/**
 * The measure-style children converted are <multiple-rest>, a multi-measure
 * rest spanning this many measures counting the one carrying it, and
 * <measure-repeat>, the simile sign. The others (beat-repeat, slash) are
 * left unread here and reported by the unread-child sweep.
 */
function readMeasureStyle(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): MeasureStyleReading {
  const reading: MeasureStyleReading = { multimeasureRests: [], measureRepeats: [] }

  // The staff this block speaks for, or every staff of the part without a
  // number. Bounded like a clef's.
  const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
  const staves =
    named !== undefined ? [named] : Array.from({ length: state.staves }, (_, i) => i + 1)

  // MusicXML allows one child in a <measure-style>, so child() is correct.
  const rest = element.child('multiple-rest')
  if (rest) {
    // use-symbols="yes" asks for the stacked rest symbols rather than the
    // single bar. MNX has no way to state the drawing, so the choice is lost.
    if (attribute(rest, 'use-symbols') === 'yes') {
      warnings.add(
        'unrepresentable:multiple-rest-symbols',
        'A multi-measure rest is drawn with the stacked rest symbols, which MNX cannot ' +
          'ask for. The rest is converted and drawn the default way.',
        context,
        rest,
      )
    }

    // MusicXML states a positive integer. The upper bound rejects a corrupt
    // file.
    reading.multimeasureRests.push({
      value: readIntegerInRange(rest, path, 1, 100_000),
      element: rest,
    })
  }

  const repeat = element.child('measure-repeat')
  if (repeat) {
    const edge = attribute(repeat, 'type')
    if (edge !== 'start' && edge !== 'stop') {
      throw new MusicXMLError('A <measure-repeat> must say whether it starts or stops the sign.', {
        path,
        line: repeat.line,
      })
    }
    if (edge === 'stop') {
      for (const staff of staves) {
        reading.measureRepeats.push({ edge: 'stop', staff, element: repeat })
      }
    } else {
      // The content is a positive integer or empty, and an empty sign is the
      // one-measure sign. The upper bound rejects a corrupt file.
      const measures = trimmedText(repeat) === '' ? 1 : readIntegerInRange(repeat, path, 1, 1000)

      // The slash count changes the glyph, which MNX has no way to ask for.
      // Read before the pattern is judged, so a sign dropped whole takes the
      // slashes with it rather than leaving them to be reported alone.
      const slashes = attribute(repeat, 'slashes')

      if (measures > LONGEST_MNX_REPEAT) {
        warnings.add(
          'unrepresentable:measure-repeat',
          `A measure repeat sign repeats ${String(measures)} measures, and MNX states a ` +
            'pattern of at most four. The sign is not carried over.',
          context,
          repeat,
        )
        // The source drew a new sign on these staves, so whatever they were
        // drawing stopped. Staves the sign does not name are left running.
        for (const staff of staves) {
          reading.measureRepeats.push({ edge: 'stop', staff, element: repeat })
        }
        return reading
      }

      if (slashes !== undefined && slashes !== '1') {
        warnings.add(
          'unrepresentable:measure-repeat-slashes',
          `A measure repeat sign is drawn with ${slashes} slashes, which MNX cannot ` +
            'ask for. The repeat is converted and drawn the default way.',
          context,
          repeat,
        )
      }

      for (const staff of staves) {
        reading.measureRepeats.push({ edge: 'start', measures, staff, element: repeat })
      }
    }
  }

  return reading
}

function readKey(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): Key | undefined {
  reportHidden(element.element, warnings, context)

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
      context,
      element.element,
    )
    return undefined
  }

  // Anything else a key carries (a <mode>, the <cancel> of a courtesy
  // signature, a per-accidental <key-octave>) has no home in MNX's
  // fifths-only key, and is reported by the unread-child sweep.

  // Beyond eleven fifths a key signature cannot be written, so a larger
  // value is a corrupt file.
  return { fifths: readIntegerInRange(fifths, path, -11, 11) }
}

/**
 * The first metered time signature an <attributes> block states, read with
 * nothing reported. MusicXML allows one <time> per staff in a block, and the
 * first metered one is the one in force, as where the part is read.
 */
export function firstTimeStated(block: XmlElement): TimeSignature | undefined {
  const unreported = new WarningCollector()
  return children(block, 'time')
    .map((time) => readTime(new ElementReader(time), unreported, {}, []))
    .find((read) => read !== undefined)
}

function readTime(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): TimeSignature | undefined {
  reportHidden(element.element, warnings, context)

  // <senza-misura> writes unmetered music, which MNX cannot state, so it
  // reads as a statement with no value. The measure reports it, because the
  // result depends on what else the measure states.
  if (element.child('senza-misura')) return undefined

  // A composite meter such as 3+2/8 is written as several beats-and-beat-type
  // pairs. MNX states one count and unit, and the first pair alone would make
  // the measure too short, so it is refused.
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
  const interchangeable = element.child('interchangeable')
  if (interchangeable) {
    element.readWhole(interchangeable)
    warnings.add(
      'unrepresentable:interchangeable-time',
      'A time signature states a second, interchangeable meter, and MNX states one ' +
        'count and unit. The primary meter is converted; the alternative is not.',
      context,
      element.element,
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
  context: ReportContext,
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
    context,
    element,
  )
  return undefined
}

/**
 * The part's instrument transposition, from <transpose>. MusicXML states the
 * interval from the written pitch to the sounding one and MNX states it the
 * other way round, so both numbers are negated.
 *
 * MusicXML writes one <transpose> per staff, told apart by a "number"
 * attribute, and MNX states one for the part. Each staff keeps the last one
 * given to it, and a staff given none sounds as written. Staves that disagree
 * are reported once the measure is read; see settleTranspositions. A part
 * that changes instrument partway keeps the first transposition in force at
 * a note, and reports the change. Together, the <transpose> statements before
 * that note state where the part starts, however many <attributes> they take.
 * The pitches follow the first staff that is given a transposition.
 */
function readTransposition(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const stated = element.blocks('transpose').map((found) => {
    // <chromatic> is the only one MusicXML requires; the others default to no
    // change. <double> sounds a further octave away, which MNX's one interval
    // cannot hold beside the transposition itself, so it is reported.
    const diatonicElement = found.child('diatonic')
    const octaveElement = found.child('octave-change')
    const octaves = octaveElement ? readInteger(octaveElement, path) : 0
    const diatonic = diatonicElement ? readInteger(diatonicElement, path) : 0
    const chromaticElement =
      found.child('chromatic') ?? requireChild(found.element, 'chromatic', path)
    const chromatic = readInteger(chromaticElement, path)

    const transposition: Transposition = {
      staffDistance: opposite(diatonic + 7 * octaves),
      halfSteps: opposite(chromatic + 12 * octaves),
      // Settled once the whole score is in: whether the part flips its
      // signature shows only against the key the rest of the score is in.
      keyFifthsFlipAt: undefined,
    }
    // Bounded like a clef's.
    const staff = readAttributeInRange(found.element, 'number', path, 1, state.staves)
    return { transposition, staff, element: found.element }
  })

  const [opening] = stated
  if (!opening) return

  const given = state.staffTranspositions
  for (const { transposition, staff, element: found } of stated) {
    const value = { value: transposition, element: found }
    if (staff === undefined) {
      given.every = value
      given.staves.clear()
    } else {
      given.staves.set(staff, value)
    }
  }
  const check = (state.transpositionCheck ??= {
    place: warnings.reserve(),
    context,
    element: opening.element,
    stated: new Set(),
    change: undefined,
  })
  for (const { element: found } of stated) check.stated.add(found)

  const before = state.transposition
  const inForce = staffTranspositions(state).find((one) => one !== undefined)
  state.transposition = inForce?.value
  const first = state.statedTransposition
  if (inForce === undefined || first === undefined || before === undefined) return
  const changed = !sameTransposition(before, inForce.value)
  if (changed && !sameTransposition(first, inForce.value)) check.change ??= inForce.element
}

/** What each staff of the part was last given, by staff number from one. */
function staffTranspositions(state: PartState): (Stated<Transposition> | undefined)[] {
  const { every, staves } = state.staffTranspositions
  return Array.from({ length: state.staves }, (_, i) => staves.get(i + 1) ?? every)
}

/**
 * Reports what the <transpose> statements of a measure leave unconvertible,
 * once the measure is read: a source can give each staff its own in separate
 * <attributes>. Staves transposed by different intervals are reported at the
 * <transpose> of this measure given to the first staff that differs, or at the
 * measure's first <transpose> where that staff was given none here. A
 * <transpose> that puts the part in a transposition other than the one it is
 * written out in changes instrument. The first such <transpose> of the measure
 * is reported, even where a later one changes back.
 */
export function settleTranspositions(state: PartState, warnings: WarningCollector): void {
  // A measure with no note converts its keys with the transposition in force
  // at its end, so the part is fixed there too.
  state.statedTransposition ??= state.transposition
  const check = state.transpositionCheck
  if (check === undefined) return
  state.transpositionCheck = undefined

  const given = staffTranspositions(state)
  const first = given[0]?.value ?? CONCERT_PITCH
  const differing = given.findIndex((one) => !sameTransposition(one?.value ?? CONCERT_PITCH, first))
  if (differing !== -1) {
    const named = given[differing]?.element
    warnings.addAt(
      check.place,
      'unrepresentable:per-staff-transposition',
      'The staves of this part are transposed by different intervals, and MNX states one ' +
        'for the part. The notes follow the first staff that is given one.',
      check.context,
      named !== undefined && check.stated.has(named) ? named : check.element,
    )
  }

  if (check.change !== undefined) {
    warnings.addAt(
      check.place,
      'unrepresentable:transposition-change',
      'A part changes instrument partway, and MNX states one transposition for the part. ' +
        'The first is the one written out; the notes sound as each instrument plays them.',
      check.context,
      check.change,
    )
  }
}

const CONCERT_PITCH: Transposition = { staffDistance: 0, halfSteps: 0, keyFifthsFlipAt: undefined }

/**
 * The same distance the other way. Zero is written without a sign, because a
 * part at concert pitch states no direction to be the opposite of.
 */
function opposite(distance: number): number {
  return distance === 0 ? 0 : -distance
}

function sameTransposition(one: Transposition, other: Transposition): boolean {
  return one.staffDistance === other.staffDistance && one.halfSteps === other.halfSteps
}

/**
 * The octave amounts an MNX clef states. MNX also allows 0, which the model
 * leaves undefined.
 */
export const CLEF_OCTAVES = [1, 2, 3, -1, -2, -3] as const satisfies readonly OttavaAmount[]

function readClef(
  element: ElementReader,
  state: PartState,
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): Clef | undefined {
  const hidden = attribute(element.element, 'print-object') === 'no'
  const written = trimmedText(element.child('sign') ?? requireChild(element.element, 'sign', path))
  // MusicXML 4.0 deprecates "none" for print-object="no", and reads the staff
  // as treble, so it is a hidden treble clef on the treble line whatever line
  // it names.
  const none = written === 'none'
  const sign = none ? 'G' : written
  const hide = hidden || none
  const pitched = isPitchedClefSign(sign)
  if (!pitched && !UNPITCHED_CLEF_SIGNS.has(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = element.child('line')

  if (!pitched) {
    // Held in force so that whatever the staff places by <display-step> is
    // still placed, at the height the treble clef gives it. MusicXML reads a
    // height on a percussion staff as if in treble clef with G4 on the second
    // line, whatever line the clef below is drawn on.
    const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
    state.clefs.set(named ?? 1, {
      sign: 'G',
      staffPosition: staffPositionOfLine(DEFAULT_CLEF_LINES.G, staffLinesOf(state, named)),
    })

    if (sign === 'percussion') {
      // MNX's staffPosition is where the clef is drawn, and a percussion clef
      // names no note, so the source's line is carried through. The heights
      // on the staff do not move with it: a kit note carries its own, and a
      // rest placed by <display-step> reads against the treble clef held in force
      // above.
      //
      // Read with no range: a percussion staff may have more or fewer than
      // five lines, and a clef may sit outside the staff. A clef with no line
      // is drawn on the middle of the staff.
      return {
        sign: 'P',
        staffPosition: lineElement
          ? staffPositionOfLine(readInteger(lineElement, path), staffLinesOf(state, named))
          : 0,
        staff: state.staves > 1 ? named : undefined,
        position,
        octave: undefined,
        hide,
      }
    }

    warnings.add(
      'unrepresentable:clef-sign',
      `A "${sign}" clef heads a staff, and MNX has no such clef. The staff ` +
        'is converted without a clef.',
      context,
      element.element,
    )
    return undefined
  }

  // Read with no range: MusicXML draws a clef outside the lines of its staff
  // by the same value, such as a C clef in the middle of a grand staff, and a
  // staff may be drawn on other than five lines.
  const stated = lineElement ? readInteger(lineElement, path) : undefined
  const line = stated !== undefined && !none ? stated : DEFAULT_CLEF_LINES[sign]

  // Bounded to the part's staves, because a clef on a staff the part does not
  // have belongs nowhere. The staff is stated only where the part has more
  // than one.
  const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
  const staff = state.staves > 1 ? named : undefined

  // A clef may be transposed for drawing, as a treble-8 sits an octave lower.
  // MNX carries the amount as an ottava of at most three octaves either way.
  // A larger change is valid MusicXML with no home in MNX, so the clef is
  // drawn at pitch and the loss is reported.
  const octaveElement = element.child('clef-octave-change')
  const change = octaveElement ? readInteger(octaveElement, path) : 0
  const octave = CLEF_OCTAVES.find((amount) => amount === change)
  if (octave === undefined && change !== 0) {
    warnings.add(
      'unrepresentable:clef-octave',
      `A clef is transposed by ${String(change)} octaves, and MNX states an ottava of ` +
        'at most three. The clef is converted at pitch, without the transposition.',
      context,
      element.element,
    )
  }

  // MusicXML counts staff lines from 1 at the bottom; MNX counts staff steps
  // from 0 at the middle of the staff, which moves with the line count.
  const staffPosition = staffPositionOfLine(line, staffLinesOf(state, named))

  // Kept in force on its staff so a later rest placed by <display-step> reads
  // its height against the right clef. A single-staff part names no staff, so
  // its one clef is held under staff 1.
  state.clefs.set(staff ?? 1, { sign, staffPosition })

  return {
    sign,
    staffPosition,
    staff,
    position,
    octave,
    hide,
  }
}
