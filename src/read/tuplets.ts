// A tuplet is written in values longer than it sounds: three eighths played
// in the time of two. MusicXML states one twice, as a <time-modification>
// ratio on every note and as a <tuplet> bracket around them; MNX states it
// once, as an item holding the notes and carrying the ratio.
//
// The reader follows the source's ratios as it goes, so a note's played time
// is known while the measure is being read. What a bracket writes is not: it
// depends on what the bracket turns out to hold, on the frame the brackets
// around it end up writing in, and on the silence after it. So a bracket
// records what the read saw and is settled once the measure is whole.

import {
  addFractions,
  compareFractions,
  commonMeasure,
  divideFractions,
  fraction,
  isZero,
  multiplyFractions,
  subtractFractions,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { lengthOf, noteValueOf } from './duration.js'
import type { WarningCollector, WarningContext, WarningPlace } from '../warnings.js'
import type {
  Draft,
  NoteValue,
  NoteValueQuantity,
  SequenceItem,
  Space,
  Tuplet,
  TupletDisplay,
} from '../model/score.js'

/**
 * A tuplet stop the measure that meets it does not close anything with: the
 * bracket it names was closed at the barline of an earlier measure, because
 * MNX states a tuplet inside one measure's sequence.
 */
export interface CarriedTupletStop {
  readonly voice: string
  readonly number: string
}

/** What the source draws of a tuplet, read from its start bracket. */
export interface TupletDisplaySettings {
  bracket?: 'yes' | 'no'
  showNumber?: TupletDisplay
  showValue?: TupletDisplay
  orient?: 'above' | 'below'
}

/** One tuplet start read from a note: how it is drawn, the ratio its start
 * marker states of its own, when it states one, and the number the marker
 * gives it, which its stop restates. */
export interface TupletStart {
  display: TupletDisplaySettings
  stated: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined
  number: string
}

/**
 * A tuplet bracket currently open: the list its notes land in, how much of
 * its written value a note inside really lasts (2/3 inside a triplet), and
 * the number its start marker gave it, for its stop to be checked against.
 */
export interface OpenTuplet {
  opened: 'tuplet'
  list: SequenceItem[]
  /** Still a draft: a bracket stating no ratio of its own states one when it
   * closes, against what it turned out to hold. */
  tuplet: Draft<Tuplet>
  ratio: Fraction
  number: string
  /**
   * True where the ratio was read from the bracket's first note rather than
   * stated, so the bracket states what it holds once it closes.
   */
  derived: boolean
  /**
   * True where the source stated this level's ratio: its own marker gave it,
   * or one level opened and the note's <time-modification> is all of it.
   * False where the converter worked it out instead, by reading it off the
   * first note or by dividing a cumulative ratio between levels, which leaves
   * a level with whatever the others did not take. Such a ratio says nothing
   * about what the source drew over the bracket.
   */
  stated: boolean
  /** Where this voice's content ran to when the bracket opened. */
  openEnd: Fraction
  /** The skip standing straight before a bracket no other bracket holds. */
  before: LeadingSkip | undefined
  /**
   * True where the source stated the ratio and drew no bracket, so what the
   * ratio counts is what says where the tuplet ends.
   */
  unbracketed: boolean
  /** The list this bracket sits in, for dropping it from where it stands. */
  within: SequenceItem[]
  /** The brackets that closed inside this one and are written over what they
   * hold, waiting for the frame this one ends up with. */
  rewritten: RewrittenTuplet[]
  /** The skips filled directly inside this one, waiting for the same frame. */
  skips: OpenSkip[]
}

/**
 * A skip filled inside a bracket. Its written length is the converter's
 * reading of the measure time it stands for, taken at the ratios open when it
 * was filled, so it moves with the frame the bracket ends up with.
 */
export interface OpenSkip {
  space: Draft<Space>
  /** The measure time it stands for, which the frame does not change. */
  spent: Fraction
}

/** A skip written where no bracket is open, with the list it stands in. */
export interface LeadingSkip extends OpenSkip {
  within: SequenceItem[]
}

/** Takes measure time off the front of a bracket from the skip before it. */
export function takeLead(before: LeadingSkip, lead: Fraction): void {
  const left = subtractFractions(before.spent, lead)
  if (isZero(left)) before.within.splice(before.within.indexOf(before.space), 1)
  else before.space.duration = left
}

/**
 * A bracket that closed inside another and states what it holds against the
 * time it took. Its outer is written in the frame of the bracket around it,
 * and that bracket may itself be rewritten when it closes, so the reading is
 * held here until the frame is settled.
 */
export interface RewrittenTuplet {
  tuplet: Draft<Tuplet>
  /** The list it sits in, for dropping it from where it stands. */
  within: SequenceItem[]
  /** The value the source drew the bracket with. */
  drawn: NoteValue
  /** The written length of what it holds, which becomes its inner. */
  held: Fraction
  /** The measure time it took. */
  spent: Fraction
  /** The outer the ratios open at its close gave it, used where the frame
   * around it says nothing. */
  provisional: Fraction
  /** The length the ratio the source drew gives it, which is what it takes
   * where no pair of note values states the time its notes do. */
  drawnOuter: Fraction
  /** How its content compares with the ratio the source stated for it. */
  misfits: number
  /** True where a rewritten ratio is the source's to answer for. */
  reportable: boolean
  /**
   * The place the report keeps for it. A bracket settles after everything it
   * waits on has been read, which can be the end of the measure, and the
   * report reads in document order, so the place is taken at the stop the
   * source wrote.
   */
  place: WarningPlace
  line: number
}

/**
 * A bracket that closed holding less than its stated ratio counts, and whose
 * own reading no pair of note values states. The silence the voice passes
 * over next can stand for what it is missing, so the reading waits until the
 * voice sounds again or the measure ends.
 */
export interface ShortTuplet {
  tuplet: Draft<Tuplet>
  /** The ratio the source stated, which the silence lets the bracket keep. */
  ratio: { inner: NoteValueQuantity; outer: NoteValueQuantity }
  /** How much of its written value a note in the bracket lasts. */
  ratioFactor: Fraction
  /** The measure time taken from the skip before the bracket. */
  lead: Fraction
  /** The skip it is taken from, where it takes any. */
  before: LeadingSkip | undefined
  /** The measure time still missing, which the silence after has to give. */
  silence: Fraction
  /** Where the bracket ends, which the silence after it is measured from. */
  end: Fraction
  /** What to state instead, where no silence completes it. */
  entry: RewrittenTuplet
}

/** The space a tuplet is played in, against what is written in it. */
export function ratioOf(inner: NoteValueQuantity, outer: NoteValueQuantity): Fraction {
  const written = multiplyFractions(fraction(inner.multiple), lengthOf(inner.value))
  const played = multiplyFractions(fraction(outer.multiple), lengthOf(outer.value))
  return divideFractions(played, written)
}

/**
 * States a tuplet as what it turned out to hold against the time it turned
 * out to take: three eighths written where two were played is three in the
 * time of two, and two eighths that played as written are two in the time of
 * two, which is a bracket drawn over what it holds and changing nothing.
 *
 * Both sides are counted in one value, the largest that counts each of them
 * whole. A bracket over a quarter and an eighth is three eighths, not one and
 * a half quarters.
 *
 * Left alone where no note value is that long. A note value lasts a power of
 * two of a whole note, dots included, so a quarter sounding a sixth of one is
 * a ratio no pair of them states, which the caller reports.
 *
 * `drawn` is the value the bracket was written with, which the counting unit
 * keeps where it can.
 */
export function scaleToContent(
  tuplet: Draft<Tuplet>,
  drawn: NoteValue,
  held: Fraction,
  sounded: Fraction,
): void {
  const unit = countingUnit(drawn, held, sounded)
  const value = noteValueOf(unit)
  if (!value) return

  // Both divide exactly: the unit counts each of them whole.
  tuplet.inner = { value, multiple: divideFractions(held, unit).num }
  tuplet.outer = { value, multiple: divideFractions(sounded, unit).num }
}

/**
 * The value both sides are counted in: the one the bracket opened with where
 * that counts them both whole, else the same halved, and failing that the
 * largest value that counts them both at all.
 *
 * The value the bracket opened with comes first so that what the source wrote
 * stands where it can: six in the time of four is not three in the time of
 * two, because the source drew six notes. Halving reaches a 1024th from a
 * quarter in eight steps, which is as far down as a bracket is drawn, and it
 * keeps the dots the opening value has. The largest common value is what
 * catches the rest, a dotted opening value over undotted content among them.
 */
function countingUnit(stated: NoteValue, held: Fraction, sounded: Fraction): Fraction {
  let length = lengthOf(stated)
  for (let halved = 0; halved <= 8; halved += 1) {
    if (noteValueOf(length) && countsBoth(length, held, sounded)) return length
    length = multiplyFractions(length, fraction(1, 2))
  }
  return commonMeasure(held, sounded)
}

/** Whether one value counts each of two lengths a whole number of times. */
function countsBoth(unit: Fraction, held: Fraction, sounded: Fraction): boolean {
  return countsOnce(divideFractions(held, unit)) && countsOnce(divideFractions(sounded, unit))
}

/** Whether a count is one MNX states: a whole number, and at least one. */
function countsOnce(count: Fraction): boolean {
  return count.den === 1 && count.num >= 1
}

/**
 * Whether a pair of note values states what a bracket holds against the time
 * it takes. False where the counting unit is no written value, which is what
 * leaves a bracket unstatable: a quarter sounding a sixth of a whole note is
 * one quarter in the time of two thirds of a quarter, and no note value is
 * two thirds of one.
 */
export function statesRatio(drawn: NoteValue, held: Fraction, sounded: Fraction): boolean {
  return noteValueOf(countingUnit(drawn, held, sounded)) !== undefined
}

/** How long a tuplet's content is written as, before its ratio scales it. */
export function writtenLengthOf(items: readonly SequenceItem[]): Fraction {
  let total = fraction(0)
  for (const item of items) {
    // A grace group takes none of the measure's time, so it adds nothing.
    if (item.kind === 'event') total = addFractions(total, lengthOf(item.value))
    if (item.kind === 'space') total = addFractions(total, item.duration)
    if (item.kind === 'tuplet' || item.kind === 'multiNoteTremolo') {
      // A nested tuplet stands in its parent for the space it is played in,
      // and a tremolo for the time its pair occupies.
      total = addFractions(
        total,
        multiplyFractions(fraction(item.outer.multiple), lengthOf(item.outer.value)),
      )
    }
  }
  return total
}

interface TupletLevel {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
  display: TupletDisplaySettings
  number: string
}

/**
 * The ratio each tuplet level opening on one note states, outermost first.
 *
 * A note's <time-modification> is cumulative: inside nested tuplets it states
 * the combined ratio of every level, not each one's own. Where every share is
 * known - each start marker states its ratio, or all but one do and the last
 * takes what remains - the markers are used, provided they multiply out to
 * what the <time-modification> requires. Otherwise each level is recovered by
 * division: the outermost open level keeps the cumulative ratio exactly as
 * the source writes it, and each further level divides out what is already
 * open. That division cannot split the cumulative ratio between two levels
 * opening on the same note, which is what the markers are for.
 *
 * The notes' durations follow the <time-modification>, so it governs timing.
 * Markers whose stated ratios do not multiply out to it disagree with the
 * notes; the division is kept and the disagreement reported.
 */
export function tupletLevels(
  openRatios: readonly Fraction[],
  inner: NoteValueQuantity,
  outer: NoteValueQuantity,
  starts: readonly TupletStart[],
  warnings: WarningCollector,
  context: WarningContext,
  line: number,
): TupletLevel[] {
  const enclosing = openRatios.reduce(multiplyFractions, fraction(1))
  const cumulative = ratioOf(inner, outer)
  // What the levels opening on this note must multiply to, together.
  const required = divideFractions(cumulative, enclosing)

  const known = starts.flatMap((start) =>
    start.stated ? [{ ...start.stated, display: start.display, number: start.number }] : [],
  )
  if (known.length > 0) {
    const holes = starts.length - known.length
    const product = known
      .map((level) => ratioOf(level.inner, level.outer))
      .reduce(multiplyFractions, fraction(1))

    if (holes === 0 && compareFractions(product, required) === 0) {
      return known
    }
    if (holes === 1) {
      const rest = divideFractions(required, product)
      return starts.map((start) => ({
        ...(start.stated ?? {
          inner: { value: inner.value, multiple: rest.den },
          outer: { value: outer.value, multiple: rest.num },
        }),
        display: start.display,
        number: start.number,
      }))
    }
    warnings.add(
      'inconsistent:tuplet',
      "A tuplet's start marker states a ratio that disagrees with the notes' " +
        '<time-modification>. The ratio the notes state is the one converted.',
      { ...context, line },
      'tuplet',
    )
  }

  const levels: TupletLevel[] = []
  let open = enclosing
  let depth = openRatios.length
  for (const start of starts) {
    let level: TupletLevel = { inner, outer, display: start.display, number: start.number }
    if (depth > 0) {
      const perLevel = divideFractions(cumulative, open)
      level = {
        inner: { value: inner.value, multiple: perLevel.den },
        outer: { value: outer.value, multiple: perLevel.num },
        display: start.display,
        number: start.number,
      }
    }
    levels.push(level)
    open = multiplyFractions(open, ratioOf(level.inner, level.outer))
    depth += 1
  }
  return levels
}

/** Whether two <time-modification> readings state the same counts. */
export function sameCounts(
  a: { inner: NoteValueQuantity; outer: NoteValueQuantity },
  b: { inner: NoteValueQuantity; outer: NoteValueQuantity },
): boolean {
  return a.inner.multiple === b.inner.multiple && a.outer.multiple === b.outer.multiple
}

/** Whether two <time-modification> readings count the same note value. */
export function sameCountedValue(
  a: { inner: NoteValueQuantity },
  b: { inner: NoteValueQuantity },
): boolean {
  return a.inner.value.base === b.inner.value.base && a.inner.value.dots === b.inner.value.dots
}

/** How long a count of one note value lasts, for example three eighths. */
export function quantityLength(quantity: NoteValueQuantity): Fraction {
  return multiplyFractions(fraction(quantity.multiple), lengthOf(quantity.value))
}

/** The written length a tuplet's ratio counts, for example three eighths. */
export function countedLengthOf(open: OpenTuplet): Fraction {
  return quantityLength(open.tuplet.inner)
}

/**
 * How much written length a rewritten bracket spends for each unit of time,
 * read off what else it holds.
 *
 * A bracket rewritten over its content states its own inner against the time
 * it took, so the frame it writes is not the one its opening ratio stated.
 * Everything it holds but a rewritten bracket is already written at a length
 * of its own, and the time those took is the rest of the bracket's own, which
 * together give the rate. Undefined where it holds nothing else, or where
 * what it holds took no time, and the rate says nothing.
 *
 * A skip is not one of them. Its written length came from the ratios open
 * when it was filled rather than from the source, so it witnesses the frame
 * the bracket opened with and not the one it ends up with.
 */
export function frameRate(open: OpenTuplet, spent: Fraction): Fraction | undefined {
  let insideSpent = fraction(0)
  let insideWritten = fraction(0)
  for (const entry of open.rewritten) {
    insideSpent = addFractions(insideSpent, entry.spent)
    insideWritten = addFractions(insideWritten, quantityLength(entry.tuplet.outer))
  }
  for (const skip of open.skips) {
    insideSpent = addFractions(insideSpent, skip.spent)
    insideWritten = addFractions(insideWritten, skip.space.duration)
  }
  const restSpent = subtractFractions(spent, insideSpent)
  const restWritten = subtractFractions(writtenLengthOf(open.tuplet.content), insideWritten)
  if (restSpent.num <= 0 || restWritten.num <= 0) return undefined
  return divideFractions(restWritten, restSpent)
}

/**
 * Writes what `open` holds that waits on the frame it ends up with: the
 * brackets rewritten inside it, and the skips filled in it. `rate` is that
 * frame; where it is undefined each keeps the reading it has, which is the
 * frame the bracket opened with.
 */
export function settleInside(
  open: OpenTuplet,
  rate: Fraction | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const entry of open.rewritten) {
    settleTuplet(
      entry,
      rate ? multiplyFractions(entry.spent, rate) : entry.provisional,
      warnings,
      context,
    )
  }
  open.rewritten.length = 0

  // A skip stands for the measure time the cursor passed over, whatever the
  // frame. Written at the settled rate, it goes on standing for that time.
  if (rate) {
    for (const skip of open.skips) {
      skip.space.duration = multiplyFractions(skip.spent, rate)
    }
  }
  open.skips.length = 0
}

/** Takes a bracket out of the list it stands in, leaving what it held. */
export function unwrapTuplet(within: SequenceItem[], tuplet: Draft<Tuplet>): void {
  const left = within.flatMap((item) =>
    item === (tuplet as SequenceItem) ? tuplet.content : [item],
  )
  within.splice(0, within.length, ...left)
}

/**
 * States a rewritten bracket over its content, and reports where the ratio
 * that leaves it is not one MNX can carry or is not the one the source drew.
 */
export function settleTuplet(
  entry: RewrittenTuplet,
  sounded: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const { tuplet, held, misfits, place, line } = entry
  scaleToContent(tuplet, entry.drawn, held, sounded)

  if (compareFractions(held, quantityLength(tuplet.inner)) !== 0) {
    // MNX counts both sides of a ratio in note values, and a note value
    // lasts a power of two of a whole note, dots included. A quarter
    // sounding a sixth of a whole note is one quarter in the time of two
    // thirds of a quarter, which no pair of them states. MNX also requires a
    // tuplet's content to come to its inner, so the bracket cannot stand over
    // the time its notes take. It takes the time its own ratio gives it
    // instead, which is the time it took before this was read, and states
    // that over what it holds.
    scaleToContent(tuplet, entry.drawn, held, entry.drawnOuter)
    const counts = compareFractions(held, quantityLength(tuplet.inner)) === 0
    // A bracket no pair of note values counts at all cannot be drawn: what it
    // holds takes its place, written as it stands.
    if (!counts) unwrapTuplet(entry.within, tuplet)
    warnings.addAt(
      place,
      'unrepresentable:tuplet-ratio',
      `A tuplet's written content ${misfits < 0 ? 'falls short of' : 'overruns'} its ` +
        'stated ratio, and no pair of note values states the ratio between the notes ' +
        'written and the time they take. ' +
        (counts
          ? 'The tuplet counts what it holds and takes the time its stated ratio gives ' +
            'it, which is not the time the source gives its notes.'
          : 'No pair of them counts what it holds against that ratio either, so the ' +
            'tuplet is not converted and its notes are written as they stand.'),
      { ...context, line },
      'tuplet',
    )
  } else if (misfits !== 0 && entry.reportable) {
    // The source drew a bracket over notes its own ratio does not count, so
    // the ratio is rewritten to count them. Reported only where the source
    // stated that ratio for this bracket: one read from its first note is
    // reported where it is read, one the converter divided out of a
    // cumulative ratio says nothing about what the source drew, and one the
    // barline cut holds less because the converter cut it.
    warnings.addAt(
      place,
      'inconsistent:tuplet',
      `A tuplet's written content ${misfits < 0 ? 'falls short of' : 'overruns'} the ` +
        'ratio the source states for it. The ratio is rewritten to count the notes the ' +
        'bracket holds.',
      { ...context, line },
      'tuplet',
    )
  }
}

/**
 * What a closing bracket would need from the silence after it, where silence
 * is what stands between it and the ratio the source drew.
 *
 * Three things have to hold. The source has to have stated the ratio for this
 * bracket, so that keeping it keeps what the source drew: a run the ratio
 * alone opens is bounded by the skip after it rather than reaching over it,
 * and a ratio read off the bracket's first note speaks for that note alone.
 * The notes it holds have to have sounded at that ratio, so that completing
 * the content completes the time as well. And its own reading has to be one
 * no pair of note values states, because a bracket that states its content
 * against the time it took already says what the source drew.
 *
 * A bracket the barline cut is none of these: the rest of it is in the next
 * measure, not in silence.
 */
export function shortOf(
  closed: OpenTuplet,
  entry: RewrittenTuplet,
  cut: boolean,
): ShortTuplet | undefined {
  const { tuplet, held, spent } = entry
  const missing = subtractFractions(quantityLength(tuplet.inner), held)
  if (cut || !closed.stated || closed.derived || missing.num <= 0) return undefined
  if (compareFractions(spent, multiplyFractions(held, closed.ratio)) !== 0) return undefined
  if (statesRatio(entry.drawn, held, entry.provisional)) return undefined

  const silence = multiplyFractions(missing, closed.ratio)
  const lead = leadOf(closed, silence)
  return {
    tuplet,
    ratio: { inner: tuplet.inner, outer: tuplet.outer },
    ratioFactor: closed.ratio,
    lead,
    before: closed.before,
    silence: subtractFractions(silence, lead),
    end: addFractions(closed.openEnd, spent),
    entry,
  }
}

/**
 * How much of the silence a short bracket is missing stands before its notes.
 * The bracket starts where a multiple of its outer from the barline puts it,
 * which is where the beat it divides begins, provided the skip before it
 * holds that much and the bracket is missing that much. Otherwise all of it
 * stands after.
 */
function leadOf(closed: OpenTuplet, silence: Fraction): Fraction {
  const none = fraction(0)
  if (!closed.before) return none
  const beat = quantityLength(closed.tuplet.outer)
  const beats = divideFractions(closed.openEnd, beat)
  const lead = subtractFractions(
    closed.openEnd,
    multiplyFractions(beat, fraction(Math.floor(beats.num / beats.den))),
  )
  if (compareFractions(lead, silence) > 0) return none
  if (compareFractions(lead, closed.before.spent) > 0) return none
  return lead
}

/** Whether the tuplet holds at least what its ratio counts. */
export function tupletFilled(open: OpenTuplet): boolean {
  return compareFractions(writtenLengthOf(open.tuplet.content), countedLengthOf(open)) >= 0
}
