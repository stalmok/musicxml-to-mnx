// Reading an <attributes> block: what is in force from here on, and the clefs
// drawn at this point.
//
// A measure may carry more than one of these, because a clef can change
// partway through, so what they declare is folded into the measure in the
// order they are met.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { Fraction } from '../fraction.js'
import type {
  Clef,
  ClefSign,
  Key,
  StaffConfig,
  TimeSignature,
  TimeUnit,
  Transposition,
} from '../model/score.js'
import { WarningCollector } from '../warnings.js'
import type { WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, requireChild, trimmedText } from '../xml/tree.js'
import { ElementReader } from './element.js'
import { readAttributeInRange, readInteger, readIntegerInRange } from './numbers.js'
import { staffLinesOf, staffPositionOfLine } from './state.js'
import type { PartState } from './state.js'
import { recogniser } from './tables.js'
import { concertFifths } from './transposition.js'
import { elementLoss, reportHidden } from './unrepresentable.js'

// Recognisers rather than bare sets: each one narrows the value it accepts to
// the model's type, so a validated value reaches the writer without a cast
// and an unvalidated one cannot. Each list and the model's own union are held
// to each other in both directions.
const isClefSign = recogniser<ClefSign>({ C: true, F: true, G: true })

// The signs MusicXML states beyond the three MNX does. The staff each heads
// has heights on it: a rest or an unpitched note placed by <display-step>
// reads against the clef in force. Each is held as the plain treble clef,
// which is how a percussion staff is written and read: the drumset positions,
// bass drum on the bottom space and snare on the third, are the treble-clef
// positions of the steps the source writes.
//
// The <line> such a clef states is where its glyph is drawn, not a reference
// pitch: MusicXML states a line to place pitches by for the G, F and C signs
// only. So it is not read as a G clef's line would be, and a percussion clef
// drawn on line 3 places its notes exactly where one drawn on line 2 does.
//
// A percussion clef is written out through the glyph below. The other three
// are not: a TAB staff's lines are strings and its notes are pitched, jianpu
// is numbers rather than a staff, and "none" asks for no clef at all. None of
// the three is the treble staff this reads them as, so nothing is written for
// one and the sign is reported.
const UNSTATED_CLEF_SIGNS: ReadonlySet<string> = new Set(['percussion', 'TAB', 'jianpu', 'none'])

// The percussion clef, drawn as the two bars SMuFL names
// unpitchedPercussionClef1. MNX signs the C, F and G clefs only, and its clef
// carries a glyph to draw in place of the sign's own; a staff headed this way
// holds kit notes, each placed by its own staff position, so the sign the
// glyph covers places nothing. The sign written under the glyph is the treble
// clef the reader reads the staff's heights against.
const PERCUSSION_GLYPH = 'unpitchedPercussionClef1'
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
  /** The staves this block starts drawing with a line count of their own. */
  staffConfigs: StaffConfig[]
  /**
   * Every multi-measure rest span this block stated, as a count of measures
   * starting at this one. A list rather than one value, because a block may
   * state it once per staff and the measure has to see them all to know
   * whether they agree.
   */
  multimeasureRests: number[]
  /**
   * Every measure repeat edge this block stated: the pattern length of a
   * sign starting here, or a stop naming this the first measure without one.
   * A list for the same reason the rests are.
   */
  measureRepeats: MeasureRepeatReading[]
}

/**
 * A measure repeat sign starting at this measure, or stopping before it,
 * scoped to one staff. An edge written without a <measure-style> "number"
 * speaks for every staff of the part, and is read as one edge per staff.
 */
export type MeasureRepeatReading =
  | { edge: 'start'; measures: number; staff: number }
  | { edge: 'stop'; staff: number }

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

  // <staff-details> carries statements with different verdicts, so each is
  // read on its own and the sweep reports the rest by name. Hiding a staff
  // with print-object="no" is score structure with a home in MNX's layouts,
  // not built yet, so it reports as a gap; its print-spacing rides on the
  // hiding. The line count is converted into the measure's staffConfigs. The
  // size has no home, except where it states the default; the tablature
  // tuning and the rest have no home and keep saying so. The number
  // attribute names the staff a statement is about, and an element stating
  // nothing loses nothing. MusicXML allows one <staff-details> per staff,
  // which is why every one is read, and one <staff-lines> in each.
  const staffConfigs: StaffConfig[] = []
  for (const details of element.blocks('staff-details')) {
    // Read as the staff number it is, not bounded to the staves this part
    // states: MusicXML numbers a staff with any positive integer, and a
    // number naming a staff the part does not have still says something
    // about a staff.
    const named = readAttributeInRange(details.element, 'number', path, 1, Number.MAX_SAFE_INTEGER)
    if (attribute(details.element, 'print-object') === 'no') {
      attribute(details.element, 'print-spacing')
      warnings.add(
        'unsupported:element',
        'Hiding a staff with <staff-details print-object="no"> is not converted yet.',
        { ...context, line: details.line },
        'staff-details',
      )
    }
    // Read as the count it is, so that "05" states the same five lines "5"
    // does. MusicXML states it as a non-negative number and MNX draws a staff
    // on none, so only a negative count is no count at all. MNX holds a
    // config in force until another replaces it, so a count is carried only
    // where it changes what the staff is already drawn with.
    const lines = details.child('staff-lines')
    if (lines) {
      const count = readIntegerInRange(lines, path, 0, Number.MAX_SAFE_INTEGER)
      const staff = named ?? 1
      if (staff > state.staves) {
        // There is no staff to draw that way. Reported rather than refused,
        // and rather than drawn on a staff the count does not name: a count
        // for staff 7 of a one-staff part, carried with no staff stated,
        // would redraw the one staff the part has.
        warnings.add(
          'inconsistent:staff',
          `A staff line count is stated for staff ${String(staff)}, and this part is ` +
            `written on ${String(state.staves)}. It is not carried over.`,
          { ...context, line: lines.line },
          'staff-lines',
        )
      } else if (staffLinesOf(state, staff) !== count) {
        // A height is measured from the middle of the staff, and the middle
        // moves with the count, so a staff that changes it redraws everything
        // on it. The clef in force holds the position it was written at and
        // the heights read against it follow, so the notes stay where they
        // were drawn. Restating the clef where the count changes would move
        // them, and is not built.
        if (state.clefs.has(staff)) {
          warnings.add(
            'unsupported:element',
            'A staff changes how many lines it is drawn with, and no clef is restated ' +
              'on it. The notes on it keep the heights the clef in force gives them.',
            { ...context, line: lines.line },
            'staff-lines',
          )
        }
        state.staffLines.set(staff, count)
        staffConfigs.push({
          lines: count,
          // Only worth stating where the part has more than one staff, as a
          // clef is.
          staff: state.staves > 1 ? named : undefined,
          position,
        })
      }
    }
    // <staff-size> is a percentage of the work's default scaling, so 100
    // states that default and loses nothing. It is a decimal, so "100.0"
    // states the same size "100" does, and anything else is reported rather
    // than reinterpreted. MusicXML allows one per <staff-details>; its
    // scaling attribute is a separate loss the sweep reports.
    const size = details.child('staff-size')
    if (size && !DEFAULT_STAFF_SIZE.test(trimmedText(size))) {
      const loss = elementLoss('staff-size')
      warnings.add(
        loss.code,
        `<staff-size> ${loss.ending}`,
        { ...context, line: size.line },
        'staff-size',
      )
    }
  }

  // Read before the key, because a transposing part writes the key it reads
  // and MNX states the key the music sounds in.
  readTransposition(element, state, warnings, context, path)

  // MusicXML allows one key and one time signature per staff. MNX states them
  // for the whole score, so staves that disagree cannot both be carried.
  //
  // Read as blocks, not raw children, so that whatever these readers pass over
  // inside a <key>, <time> or <clef> is reported along with the rest of the
  // measure rather than vanishing a level down.
  const keyBlocks = element.blocks('key')
  reportPartialSignature(keyBlocks, 'key', state, warnings, context, path)
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

  const timeBlocks = element.blocks('time')
  reportPartialSignature(timeBlocks, 'time', state, warnings, context, path)
  const times = timeBlocks.map((found) => readTime(found, warnings, context, path))
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

  // MNX states the key the music sounds in. A transposing part writes the key
  // its player reads, which stands a fixed number of fifths from it.
  const written = keys[0]
  const key =
    written && state.transposition
      ? { ...written, fifths: concertFifths(written.fifths, state.transposition) }
      : written

  return {
    keyStated: keyBlocks.length > 0,
    timeStated: times.length > 0,
    key,
    time: metered[0],
    clefs: element
      .blocks('clef')
      .map((found) => readClef(found, state, position, warnings, context, path))
      .filter((clef) => clef !== undefined),
    staffConfigs,
    // MusicXML allows one <measure-style> per staff, told apart by a
    // "number" attribute, so every block is read. Which staff states the
    // rest or repeat does not matter here: the measure only has to see them
    // all to know whether they agree.
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
  multimeasureRests: number[]
  measureRepeats: MeasureRepeatReading[]
}

/**
 * Report a key or time signature stated for some staves and not others. The
 * blocks are compared by content where each staff writes one, but a numbered
 * block with no counterpart for the other staves is a per-staff statement
 * that comparison cannot see, and MNX applies the one signature to the whole
 * score.
 */
function reportPartialSignature(
  blocks: readonly ElementReader[],
  name: 'key' | 'time',
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): void {
  if (blocks.length === 0) return
  const numbers = blocks.map((block) =>
    readAttributeInRange(block.element, 'number', path, 1, state.staves),
  )

  // Every staff the blocks between them state. A block with no number states
  // them all, so a part whose blocks are all unnumbered covers every staff
  // and warns about none.
  const covered = new Set(numbers.flatMap((number) => (number === undefined ? ALL : [number])))
  for (let staff = 1; staff <= state.staves; staff += 1) {
    if (!covered.has(ALL) && !covered.has(staff)) {
      warnings.add(
        name === 'key' ? 'unrepresentable:per-staff-key' : 'unrepresentable:per-staff-time',
        `A ${name} signature is stated for one staff and not the others, and MNX ` +
          'states one for the whole score. The stated one is the one converted.',
        { ...context, line: blocks[0]?.line ?? 0 },
        name,
      )
      return
    }
  }
}

// A signature block without a number speaks for every staff.
const ALL = 0

// The longest pattern MNX states for a measure repeat. MusicXML sets no
// upper bound, so a longer one has nowhere to go.
const LONGEST_MNX_REPEAT = 4

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
  context: WarningContext,
  path: DocumentPath,
): MeasureStyleReading {
  const reading: MeasureStyleReading = { multimeasureRests: [], measureRepeats: [] }

  // The staff this block speaks for, or every staff of the part without a
  // number. Bounded like a clef's, because a style naming a staff the part
  // does not have belongs nowhere.
  const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
  const staves =
    named !== undefined ? [named] : Array.from({ length: state.staves }, (_, i) => i + 1)

  // A <measure-style> holds one choice of child, so taking the first of each
  // with child() is right.
  const rest = element.child('multiple-rest')
  if (rest) {
    // use-symbols="yes" asks for the stacked rest symbols rather than the
    // single bar. MNX has no way to state the drawing, so the choice is lost.
    if (attribute(rest, 'use-symbols') === 'yes') {
      warnings.add(
        'unrepresentable:multiple-rest-symbols',
        'A multi-measure rest is drawn with the stacked rest symbols, which MNX cannot ' +
          'ask for. The rest is converted and drawn the default way.',
        { ...context, line: rest.line },
        'multiple-rest',
      )
    }

    // MusicXML says a positive integer. The upper bound only rules out a
    // corrupt file: no score rests for a hundred thousand measures.
    reading.multimeasureRests.push(readIntegerInRange(rest, path, 1, 100_000))
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
      for (const staff of staves) reading.measureRepeats.push({ edge: 'stop', staff })
    } else {
      // The content is a positive integer or empty, and a sign saying
      // nothing is the everyday one-measure sign. The upper bound only
      // rules out a corrupt file: no pattern repeats a thousand measures.
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
          { ...context, line: repeat.line },
          'measure-repeat',
        )
        // The source drew a new sign on these staves, so whatever they were
        // drawing stopped. Staves the sign does not name are left running.
        for (const staff of staves) reading.measureRepeats.push({ edge: 'stop', staff })
        return reading
      }

      if (slashes !== undefined && slashes !== '1') {
        warnings.add(
          'unrepresentable:measure-repeat-slashes',
          `A measure repeat sign is drawn with ${slashes} slashes, which MNX cannot ` +
            'ask for. The repeat is converted and drawn the default way.',
          { ...context, line: repeat.line },
          'measure-repeat',
        )
      }

      for (const staff of staves) reading.measureRepeats.push({ edge: 'start', measures, staff })
    }
  }

  return reading
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

/**
 * The time signature each measure of a part opens with, read ahead of the
 * part itself: a part that states none of its own runs to the barline the
 * other parts state, and those may be read after it. One stated after the
 * measure's first note or <forward> opens the next measure. Whatever a time
 * signature says that is lost or broken is reported, or refused, where the
 * part itself is read, so nothing here reports anything.
 */
export function timesInForce(part: XmlElement): (TimeSignature | undefined)[] {
  const unreported = new WarningCollector()
  let inForce: TimeSignature | undefined
  return children(part, 'measure').map((measure) => {
    let opens = inForce
    let started = false
    // MusicXML allows several <attributes> in a measure and one <time> per
    // staff in each. As where the part is read, the first metered one in a
    // block is the one in force.
    for (const found of measure.children) {
      if (found.name === 'forward' || (found.name === 'note' && !child(found, 'grace'))) {
        started = true
      }
      if (found.name !== 'attributes') continue
      const times = children(found, 'time')
      if (times.length === 0) continue
      try {
        inForce = times
          .map((time) => readTime(new ElementReader(time), unreported, {}, []))
          .find((time) => time !== undefined)
      } catch {
        inForce = undefined
      }
      if (!started) opens = inForce
    }
    return opens
  })
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

/**
 * The part's instrument transposition, from <transpose>. MusicXML states the
 * interval from the written pitch to the sounding one and MNX states it the
 * other way round, so both numbers are negated.
 *
 * MusicXML writes one <transpose> per staff, told apart by a "number"
 * attribute, and MNX states one for the part. A part whose staves disagree,
 * or which changes instrument partway, keeps the first and reports the rest;
 * the pitches themselves follow whatever is in force, because a pitch stated
 * at the wrong instrument is a wrong note rather than a lost detail.
 */
function readTransposition(
  element: ElementReader,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
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

    return {
      staffDistance: opposite(diatonic + 7 * octaves),
      halfSteps: opposite(chromatic + 12 * octaves),
      // Settled once the whole score is in: whether the part flips its
      // signature shows only against the key the rest of the score is in.
      keyFifthsFlipAt: undefined,
    }
  })

  const first = stated[0]
  if (!first) return

  if (stated.some((other) => !sameTransposition(other, first))) {
    warnings.add(
      'unrepresentable:per-staff-transposition',
      'The staves of this part are transposed by different intervals, and MNX states one ' +
        'for the part. The first is the one converted.',
      { ...context, line: element.line },
      'transpose',
    )
  }

  state.transposition = first
  if (state.statedTransposition === undefined) {
    state.statedTransposition = first
    return
  }
  if (!sameTransposition(state.statedTransposition, first)) {
    warnings.add(
      'unrepresentable:transposition-change',
      'A part changes instrument partway, and MNX states one transposition for the part. ' +
        'The first is the one written out; the notes sound as each instrument plays them.',
      { ...context, line: element.line },
      'transpose',
    )
  }
}

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

function readClef(
  element: ElementReader,
  state: PartState,
  position: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): Clef | undefined {
  reportHidden(element.element, 'clef', warnings, context)

  const sign = trimmedText(element.child('sign') ?? requireChild(element.element, 'sign', path))
  const stated = isClefSign(sign)
  if (!stated && !UNSTATED_CLEF_SIGNS.has(sign)) {
    throw new MusicXMLError(`The "${sign}" clef cannot be represented in MNX.`, {
      path,
      line: element.line,
    })
  }

  const lineElement = element.child('line')

  if (!stated) {
    // Held in force so that whatever the staff places by <display-step> is
    // still placed, at the height the treble clef gives it. MusicXML reads a
    // height on a percussion staff as if in treble clef with G4 on the second
    // line, whatever line the glyph below is drawn on.
    const named = readAttributeInRange(element.element, 'number', path, 1, state.staves)
    state.clefs.set(named ?? 1, {
      sign: 'G',
      staffPosition: staffPositionOfLine(DEFAULT_CLEF_LINES.G, staffLinesOf(state, named)),
    })

    if (sign === 'percussion') {
      // MNX's staffPosition is the position the clef is drawn at, and the
      // glyph drawn here names no note, so the line the source states is
      // carried straight through. The heights on the staff do not move with
      // it: a kit note carries its own, and a rest placed by <display-step>
      // is read against the treble clef held in force above, because
      // MusicXML states a line to place pitches by for the G, F and C signs
      // only.
      //
      // Read with no range: a percussion staff may be drawn on more or fewer
      // than five lines, and MusicXML draws a clef outside the staff by the
      // same value.
      const drawnOn = lineElement ? readInteger(lineElement, path) : DEFAULT_CLEF_LINES.G
      return {
        sign: 'G',
        staffPosition: staffPositionOfLine(drawnOn, staffLinesOf(state, named)),
        staff: state.staves > 1 ? named : undefined,
        position,
        octave: undefined,
        glyph: PERCUSSION_GLYPH,
      }
    }

    warnings.add(
      'unrepresentable:clef-sign',
      `A "${sign}" clef heads a staff, and MNX states the C, F and G clefs only. The staff ` +
        'is converted without a clef.',
      { ...context, line: element.line },
      'clef',
    )
    return undefined
  }

  // Read with no range: MusicXML draws a clef outside the lines of its staff
  // by the same value, such as a C clef in the middle of a grand staff, and a
  // staff may be drawn on other than five lines.
  const line = lineElement ? readInteger(lineElement, path) : DEFAULT_CLEF_LINES[sign]

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
    glyph: undefined,
  }
}
