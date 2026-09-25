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
  NoteValue,
  NoteValueQuantity,
  SequenceItem,
  Space,
  Tuplet,
  TupletDisplay,
} from '../model/score.js'
import type { Draft } from './draft.js'

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
   * The ratio the source stated for this level: its own marker gave it, or
   * one level opened and the note's <time-modification> is all of it. Unset
   * where the converter worked it out instead, by reading it off the first
   * note or by dividing a cumulative ratio between levels, which leaves a
   * level with whatever the others did not take. Such a ratio says nothing
   * about what the source drew over the bracket.
   */
  stated: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined
  /** Where this voice's content ran to when the bracket opened. */
  openEnd: Fraction
  /**
   * True where the source stated the ratio and drew no bracket, so what the
   * ratio counts is what says where the tuplet ends.
   */
  unbracketed: boolean
  /** The list this bracket sits in, for dropping it from where it stands. */
  within: SequenceItem[]
  /** The brackets that closed inside this one, for its claim to carry. */
  children: TupletClaim[]
  /** The skips filled directly inside this one, waiting for its frame. */
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

/** How long a count of one note value lasts, for example three eighths. */
export function quantityLength(quantity: NoteValueQuantity): Fraction {
  return multiplyFractions(fraction(quantity.multiple), lengthOf(quantity.value))
}

/**
 * A bracket the read has closed, and what the read saw of it.
 *
 * What the bracket writes is not decided here. It turns on what the bracket
 * holds once the brackets inside it are written, on the frame the brackets
 * around it end up writing in, and on the silence after it, and none of the
 * three is known while the bracket is being read. So every field is a fact
 * the read observed, and nothing derived is stored.
 */
export interface TupletClaim {
  tuplet: Draft<Tuplet>
  /** The list it stands in, for taking it out where it cannot be drawn. */
  within: SequenceItem[]
  /** The ratio the source stated for it, where it stated one. */
  stated: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined
  /** True where the ratio was read off the bracket's first note. */
  derived: boolean
  /** True where the source stated the ratio and drew no bracket. */
  unbracketed: boolean
  /** True where the barline closed it rather than a stop the source wrote. */
  cut: boolean
  /** Where this voice's content ran to when the bracket opened. */
  openEnd: Fraction
  /** The measure time it took. */
  spent: Fraction
  /**
   * How much of its written value a note beside it lasts, at its close: the
   * ratios of the brackets still open around it, multiplied. It says what the
   * bracket's own outer comes to where those brackets keep their ratios.
   */
  frame: Fraction
  /** The brackets that closed inside it. */
  children: TupletClaim[]
  /** The skips filled directly inside it. */
  skips: OpenSkip[]
  /**
   * The place the report keeps for it. A bracket settles once the measure is
   * whole, when the element it came from is gone, and the report reads in
   * document order, so the place is taken at the stop the source wrote.
   */
  place: WarningPlace
  line: number
}

/** The shape of the measure a bracket is settled against. */
export interface MeasureExtent {
  /**
   * Where the beats line up: at the barline the measure begins on, or, in a
   * pickup, at the barline it ends on.
   */
  anchor: 'start' | 'end'
  /**
   * How far the measure runs, which bounds the silence a bracket may take:
   * the time signature, or the part's cursor where that runs further. A
   * pickup runs to its cursor alone, having no silence past its own end.
   */
  length: Fraction
  /** The time signature alone, unset where the part states none. */
  signature: Fraction | undefined
}

/**
 * What stands straight after a bracket that the bracket can take in: the
 * notes of a run the ratio alone opened, or a rest the source drew as one of
 * the tuplet's own notes and left outside the bracket.
 */
interface Adoptable {
  /** The run the notes come from, unset where the rest is the voice's own. */
  run: TupletClaim | undefined
  notes: { item: SequenceItem; time: Fraction }[]
}

/** No silence at all, for a bracket something of the voice's stands after. */
const NO_SILENCE = { time: fraction(0), span: 0 }

/** A voice's own item list and where it runs to, for a claim to reach into. */
export interface VoiceTail {
  content: SequenceItem[]
  end: Fraction
  measure: MeasureExtent
  /** How much of the measure each event this voice holds takes. */
  spent: ReadonlyMap<SequenceItem, Fraction>
}

/**
 * Settles every bracket of one voice, the measure being whole, and hands
 * back where the voice runs to: a bracket completed by the measure's tail
 * carries the voice that much further.
 *
 * A bracket standing directly in the voice's own list is the one the silence
 * around it can complete. Anything deeper is bounded by the bracket around
 * it, which has already gathered what silence there is into its own skips.
 */
export function settleClaims(
  claims: readonly TupletClaim[],
  voice: VoiceTail,
  warnings: WarningCollector,
  context: WarningContext,
): Fraction {
  for (const [index, claim] of claims.entries()) {
    // A bracket an earlier one took in whole is no longer there to settle.
    if (!claim.within.includes(claim.tuplet as SequenceItem)) continue
    settleClaim(claim, undefined, voice, claims[index + 1], warnings, context)
  }
  return voice.end
}

/**
 * Writes one bracket, outermost first.
 *
 * A bracket's written statement needs its children's written outers, and a
 * child's outer needs the frame the bracket ends up writing in. That frame is
 * fixed by the content that does not wait, so one descent does both: fix the
 * frame, hand it down, then measure what the bracket holds.
 *
 * `rate` is the frame the bracket around it writes in, unset for a bracket
 * standing in the voice's own list or one whose parent's frame says nothing.
 */
function settleClaim(
  claim: TupletClaim,
  rate: Fraction | undefined,
  voice: VoiceTail | undefined,
  next: TupletClaim | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const inside = frameOf(claim)
  for (const child of claim.children) {
    settleClaim(child, inside, undefined, undefined, warnings, context)
  }
  // A skip stands for the measure time the cursor passed over, whatever the
  // frame. Written at the settled rate, it goes on standing for that time.
  if (inside) {
    for (const skip of claim.skips) skip.space.duration = multiplyFractions(skip.spent, inside)
  }

  // Measured now that what the bracket holds is final: a bracket dropped
  // inside it leaves what it held where it stood.
  const held = writtenLengthOf(claim.tuplet.content)
  const sounded = rate
    ? multiplyFractions(claim.spent, rate)
    : divideFractions(claim.spent, claim.frame)
  // A ratio states two things, and both have to hold for it to stand: it
  // counts what the bracket holds, and it gives the notes the time they take.
  const misfits = compareFractions(held, quantityLength(claim.tuplet.inner))
  const mistimed = compareFractions(sounded, quantityLength(claim.tuplet.outer))
  if (!claim.derived && misfits === 0 && mistimed === 0) return

  if (voice && complete(claim, held, sounded, voice, next, warnings, context)) return
  rewrite(claim, held, misfits, mistimed, sounded, warnings, context)
}

/**
 * How much written length a bracket spends for each unit of measure time,
 * read off the content that does not wait for it.
 *
 * Everything a bracket holds but a bracket of its own and a skip is already
 * written at a length the source gave it, and the time those took is the rest
 * of the bracket's own, which together give the rate. Undefined where it
 * holds nothing else, or where what it holds took no time, and the rate says
 * nothing.
 *
 * A skip is none of them. Its written length came from the ratios open when
 * it was filled rather than from the source, so it witnesses the frame the
 * bracket opened with and not the one it ends up with.
 */
function frameOf(claim: TupletClaim): Fraction | undefined {
  const waiting = new Set<SequenceItem>()
  let waitingSpent = fraction(0)
  for (const child of claim.children) {
    waiting.add(child.tuplet as SequenceItem)
    waitingSpent = addFractions(waitingSpent, child.spent)
  }
  for (const skip of claim.skips) {
    waiting.add(skip.space as SequenceItem)
    waitingSpent = addFractions(waitingSpent, skip.spent)
  }
  const restWritten = writtenLengthOf(claim.tuplet.content.filter((item) => !waiting.has(item)))
  const restSpent = subtractFractions(claim.spent, waitingSpent)
  if (restSpent.num <= 0 || restWritten.num <= 0) return undefined
  return divideFractions(restWritten, restSpent)
}

/** Takes a bracket out of the list it stands in, leaving what it held. */
export function unwrapTuplet(within: SequenceItem[], tuplet: Draft<Tuplet>): void {
  const left = within.flatMap((item) =>
    item === (tuplet as SequenceItem) ? tuplet.content : [item],
  )
  within.splice(0, within.length, ...left)
}

/**
 * States a bracket over what it holds against the time it took, and reports
 * where the ratio that leaves it is not one MNX can carry or is not the one
 * the source drew.
 */
function rewrite(
  claim: TupletClaim,
  held: Fraction,
  misfits: number,
  mistimed: number,
  sounded: Fraction,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const { tuplet, place, line } = claim
  const drawn = tuplet.inner.value
  // The length the ratio the source drew gives it, which is what it takes
  // where no pair of note values states the time its notes do.
  const drawnOuter = quantityLength(tuplet.outer)
  // How the bracket parts from the ratio the source stated: its content does
  // not come to what the ratio counts, or its notes do not take the time the
  // ratio gives them.
  const parts =
    misfits !== 0
      ? `its written content ${misfits < 0 ? 'falls short of' : 'overruns'} the ratio`
      : `its notes take ${mistimed < 0 ? 'less' : 'more'} time than the ratio gives them`
  scaleToContent(tuplet, drawn, held, sounded)

  if (compareFractions(held, quantityLength(tuplet.inner)) !== 0) {
    // MNX counts both sides of a ratio in note values, and a note value
    // lasts a power of two of a whole note, dots included. A quarter
    // sounding a sixth of a whole note is one quarter in the time of two
    // thirds of a quarter, which no pair of them states. MNX also requires a
    // tuplet's content to come to its inner, so the bracket cannot stand over
    // the time its notes take. It takes the time its own ratio gives it
    // instead, and states that over what it holds.
    scaleToContent(tuplet, drawn, held, drawnOuter)
    const counts = compareFractions(held, quantityLength(tuplet.inner)) === 0
    // A bracket no pair of note values counts at all cannot be drawn: what it
    // holds takes its place, written as it stands.
    if (!counts) unwrapTuplet(claim.within, tuplet)
    warnings.addAt(
      place,
      'unrepresentable:tuplet-ratio',
      `A tuplet parts from the ratio the source states for it: ${parts}. No pair of ` +
        'note values states the ratio between the notes written and the time they take. ' +
        (counts
          ? 'The tuplet counts what it holds and takes the time its stated ratio gives ' +
            'it, which is not the time the source gives its notes.'
          : 'No pair of them counts what it holds against that ratio either, so the ' +
            'tuplet is not converted and its notes are written as they stand.'),
      { ...context, line },
      'tuplet',
    )
  } else if (claim.stated && !claim.cut) {
    // The source drew a bracket the notes under it do not bear out, so the
    // ratio is rewritten to state what they do. Reported only where the
    // source stated that ratio for this bracket: one read from its first note
    // is reported where it is read, one the converter divided out of a
    // cumulative ratio says nothing about what the source drew, and one the
    // barline cut holds less because the converter cut it.
    warnings.addAt(
      place,
      'inconsistent:tuplet',
      `A tuplet parts from the ratio the source states for it: ${parts}. The ratio is ` +
        'rewritten over the notes the bracket holds and the time they take.',
      { ...context, line },
      'tuplet',
    )
  }
}

/**
 * Completes a bracket holding less than the ratio the source stated counts,
 * from the silence around it, and keeps that ratio. True where it did.
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
 *
 * What the ratio counts is tried in the value the source stated and then in
 * narrower ones, so that a bracket wider than the silence around it is still
 * completed where the same counts a value narrower fit.
 */
function complete(
  claim: TupletClaim,
  held: Fraction,
  sounded: Fraction,
  voice: VoiceTail,
  next: TupletClaim | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): boolean {
  const { stated, tuplet } = claim
  if (!stated || claim.derived || claim.cut) return false
  const ratio = ratioOf(stated.inner, stated.outer)
  if (compareFractions(claim.spent, multiplyFractions(held, ratio)) !== 0) return false
  if (statesRatio(tuplet.inner.value, held, sounded)) return false

  const at = voice.content.indexOf(tuplet as SequenceItem)
  const before = skipBefore(voice.content, at)
  const adopted = adoptable(claim, ratio, voice, next)
  const run = adopted?.notes ?? []
  const taken = countings(stated).flatMap((counted, narrower) => {
    const missing = subtractFractions(quantityLength(counted.inner), held)
    // A narrower value counts less, so once the bracket holds what the ratio
    // counts, no narrower one leaves anything for the silence to complete.
    if (missing.num <= 0) return []
    const silence = multiplyFractions(missing, ratio)
    const lead = leadOf(claim, silence, before?.space, voice.measure, counted.outer)
    // The notes of the run after the bracket come next, whole notes at a
    // time, and only while what is left of the bracket has room for one.
    let left = subtractFractions(silence, lead)
    let moved = 0
    for (const note of run) {
      if (compareFractions(note.time, left) > 0) break
      left = subtractFractions(left, note.time)
      moved += 1
    }
    // The run stands between the bracket and the silence beyond it, so that
    // silence is the bracket's only once the whole run has moved in.
    const silent =
      adopted && moved < run.length ? NO_SILENCE : silenceAfter(voice, adopted ? at + 1 : at)
    return compareFractions(silent.time, left) < 0
      ? []
      : [{ counted, narrower, lead, moved, left, silent }]
  })[0]
  if (!taken) return false

  tuplet.inner = taken.counted.inner
  tuplet.outer = taken.counted.outer
  const reached = voice.end
  adopt(claim, voice, adopted, taken.moved)
  // Whatever the bracket takes in was drawn outside it, so the bracket ends
  // up drawn over more than the source draws it over.
  if (adopted && taken.moved > 0) {
    warnings.addAt(
      claim.place,
      'inconsistent:tuplet',
      'A tuplet holds less than its ratio counts, and what stands after it sounds at that ' +
        `ratio. ${adopted.run ? 'Those notes are' : 'That rest is'} drawn inside the ` +
        'bracket, where the source draws ' +
        `${adopted.run ? 'them' : 'it'} outside.`,
      { ...context, line: claim.line },
      'tuplet',
    )
  }
  // The counts the source states are kept, against a note value narrower than
  // the one it counts them in. The first counting is the one the source
  // states, so anything past it is narrower.
  if (taken.narrower > 0) {
    warnings.addAt(
      claim.place,
      'inconsistent:tuplet',
      'A tuplet holds less than its ratio counts, and the silence around it is less than ' +
        'that ratio needs in the note value it counts. The same counts are stated in a ' +
        'narrower note value, which is as wide as the bracket can be here.',
      { ...context, line: claim.line },
      'tuplet',
    )
  }
  takeSilence(claim, voice, taken.lead, taken.left, taken.silent.span, ratio)
  // The cursor can run past the time signature without the voice sounding
  // there: over a trailing <forward> written to hang a direction after the
  // last note, or a <backup> reaching before the measure start. A bracket
  // completed on that silence carries the voice out there.
  const { signature } = voice.measure
  const past = (end: Fraction) => signature !== undefined && compareFractions(end, signature) > 0
  if (past(voice.end) && !past(reached)) {
    warnings.addAt(
      claim.place,
      'inconsistent:measure-length',
      'A tuplet takes in the silence after it to keep the ratio the source states for it, ' +
        'and the voice then sounds past the end of the time signature in force.',
      { ...context, line: claim.line },
      'tuplet',
    )
  }
  return true
}

/**
 * The notes of a run the ratio alone opened standing straight after a
 * bracket, in the order the source wrote them.
 *
 * Such a run states the ratio the bracket states and no bracket of its own,
 * so its notes already sound at that ratio and a bracket stopped before them
 * can take them in without changing a time. Empty where no such run stands
 * there.
 */
function adoptable(
  claim: TupletClaim,
  ratio: Fraction,
  voice: VoiceTail,
  next: TupletClaim | undefined,
): Adoptable | undefined {
  const after = voice.content[voice.content.indexOf(claim.tuplet as SequenceItem) + 1]
  if (after === undefined) return undefined
  // A rest the source drew as one of the tuplet's own notes and left outside
  // the bracket: its written value lasts what it lasts only at the bracket's
  // ratio. A rest that lasts what it is written as is silence beside the
  // bracket, not a note of it.
  if (after.kind === 'event' && after.isRest) {
    const time = voice.spent.get(after)
    const drawn = multiplyFractions(writtenLengthOf([after]), ratio)
    if (!time || compareFractions(time, drawn) !== 0) return undefined
    return { run: undefined, notes: [{ item: after, time }] }
  }
  // A run the ratio alone opened. Its notes have to have sounded at the
  // bracket's ratio, as the bracket's own do, which is what lets them move
  // inside without changing a time. It says nothing about the value the run
  // counts its own ratio in: that only sets how wide each of its notes is,
  // which the fit tests below.
  if (!next?.unbracketed || after !== (next.tuplet as SequenceItem)) return undefined
  const held = writtenLengthOf(next.tuplet.content)
  if (compareFractions(next.spent, multiplyFractions(held, ratio)) !== 0) return undefined
  return {
    run: next,
    notes: next.tuplet.content.map((item) => ({
      item,
      time: multiplyFractions(writtenLengthOf([item]), ratio),
    })),
  }
}

/**
 * Moves the first `moved` items standing after a bracket inside it. A run the
 * whole of which moves in is left holding nothing, so it goes with them.
 */
function adopt(
  claim: TupletClaim,
  voice: VoiceTail,
  adopted: Adoptable | undefined,
  moved: number,
): void {
  if (!adopted || moved === 0) return
  const moving = adopted.notes.slice(0, moved)
  const taken = moving.map((one) => one.item)
  const { run } = adopted
  claim.tuplet.content.push(...taken)
  if (!run) {
    voice.content.splice(voice.content.indexOf(taken[0] as SequenceItem), 1)
    return
  }
  run.tuplet.content = run.tuplet.content.filter((item) => !taken.includes(item))
  if (run.tuplet.content.length === 0) {
    voice.content.splice(voice.content.indexOf(run.tuplet as SequenceItem), 1)
    return
  }
  // What is left of the run begins where the bracket now ends, and takes the
  // time of what it still holds. Settled against the time it took before,
  // what it holds would be stated over the time of the notes it gave up.
  const time = moving.reduce((total, one) => addFractions(total, one.time), fraction(0))
  run.spent = subtractFractions(run.spent, time)
  run.openEnd = addFractions(run.openEnd, time)
  // A skip that moved is written in the bracket's frame now, not the run's.
  run.skips = run.skips.filter((skip) => !taken.includes(skip.space as SequenceItem))
}

/**
 * The ratio the source stated, and then the same counts against narrower
 * values: three halves in the time of two are three quarters in the time of
 * two, a quarter narrower.
 *
 * Widest first, so the value the source counts in is the one taken wherever
 * the silence fits it. A narrower one is a reading of the source's counts
 * over a bracket the source did not draw that wide, which the caller reports.
 * It is the reading a source that leaves <normal-type> off asks for, since
 * the value its ratio then counts is the bracket's first note's rather than
 * anything the source said about the bracket.
 */
function countings(stated: { inner: NoteValueQuantity; outer: NoteValueQuantity }): {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
}[] {
  const counted = []
  let inner = lengthOf(stated.inner.value)
  let outer = lengthOf(stated.outer.value)
  // Halving ends where a side is no longer a value a note is written with,
  // which is below a 1024th, dots kept.
  let innerValue = noteValueOf(inner)
  let outerValue = noteValueOf(outer)
  while (innerValue && outerValue) {
    counted.push({
      inner: { value: innerValue, multiple: stated.inner.multiple },
      outer: { value: outerValue, multiple: stated.outer.multiple },
    })
    inner = multiplyFractions(inner, fraction(1, 2))
    outer = multiplyFractions(outer, fraction(1, 2))
    innerValue = noteValueOf(inner)
    outerValue = noteValueOf(outer)
  }
  return counted
}

/**
 * The skip standing straight before a bracket, and where it stands. A grace
 * group takes none of the measure's time, so one written between the two
 * leaves the skip standing straight before the bracket still.
 */
function skipBefore(
  content: readonly SequenceItem[],
  at: number,
): { at: number; space: Draft<Space> } | undefined {
  let index = at - 1
  while (content[index]?.kind === 'grace') index -= 1
  const item = content[index]
  return item?.kind === 'space' ? { at: index, space: item } : undefined
}

/**
 * How much of the silence a short bracket is missing stands before its notes.
 * The bracket starts where a multiple of its outer from the barline puts it,
 * which is where the beat it divides begins, provided the skip before it
 * holds that much and the bracket is missing that much. Otherwise all of it
 * stands after.
 */
function leadOf(
  claim: TupletClaim,
  silence: Fraction,
  before: Space | undefined,
  measure: MeasureExtent,
  outer: NoteValueQuantity,
): Fraction {
  const none = fraction(0)
  if (!before) return none
  const beat = quantityLength(outer)
  // The barline the beats are counted from: the one the measure begins on,
  // or, in a pickup, the one it ends on.
  const from = measure.anchor === 'end' ? measure.length : fraction(0)
  const over = subtractFractions(claim.openEnd, from)
  const beats = divideFractions(over, beat)
  const lead = subtractFractions(
    over,
    multiplyFractions(beat, fraction(Math.floor(beats.num / beats.den))),
  )
  if (compareFractions(lead, silence) > 0) return none
  if (compareFractions(lead, before.duration) > 0) return none
  return lead
}

/**
 * The measure time the voice passes over in silence straight after a bracket,
 * and how many of the voice's items that silence runs over: the skips written
 * there, and the measure's tail where nothing sounds after them at all. A
 * grace group takes none of the measure's time, so it neither gives silence
 * nor ends it, and the bracket may reach over one.
 */
function silenceAfter(voice: VoiceTail, at: number): { time: Fraction; span: number } {
  let time = fraction(0)
  let span = 0
  for (const item of voice.content.slice(at + 1)) {
    if (item.kind !== 'space' && item.kind !== 'grace') return { time, span }
    if (item.kind === 'space') time = addFractions(time, item.duration)
    span += 1
  }
  return { time: addFractions(time, subtractFractions(voice.measure.length, voice.end)), span }
}

/**
 * Draws the silence a short bracket needs inside it: `lead` off the skip
 * before it, then `after` off the skips and the measure's tail beyond it.
 * Everything taken in is written in the bracket's own frame, which the ratio
 * the source stated gives it.
 *
 * A grace group standing in the span the bracket takes in moves inside with
 * it, having been drawn where the bracket now runs.
 */
function takeSilence(
  claim: TupletClaim,
  voice: VoiceTail,
  lead: Fraction,
  after: Fraction,
  span: number,
  ratio: Fraction,
): void {
  const written = (time: Fraction): Draft<Space> => ({
    kind: 'space',
    duration: divideFractions(time, ratio),
  })
  const { content } = claim.tuplet
  const at = voice.content.indexOf(claim.tuplet as SequenceItem)
  const before = skipBefore(voice.content, at)
  if (!isZero(lead) && before) {
    // The grace groups between the skip and the bracket stand in the span the
    // lead covers, so they move inside the bracket with it.
    content.unshift(...voice.content.splice(before.at + 1, at - before.at - 1))
    content.unshift(written(lead))
    const left = subtractFractions(before.space.duration, lead)
    if (isZero(left)) voice.content.splice(before.at, 1)
    else before.space.duration = left
  }

  // The silence after runs over `span` items, every one of them a skip or a
  // grace group. Each is taken in while the bracket is still short, and what
  // the bracket does not need is put back where it stood.
  const from = voice.content.indexOf(claim.tuplet as SequenceItem) + 1
  const kept: SequenceItem[] = []
  let taken = fraction(0)
  for (const item of voice.content.splice(from, span)) {
    if (compareFractions(taken, after) >= 0) {
      kept.push(item)
      continue
    }
    if (item.kind !== 'space') {
      content.push(item)
      continue
    }
    const left = subtractFractions(after, taken)
    if (compareFractions(item.duration, left) > 0) {
      kept.push({ kind: 'space', duration: subtractFractions(item.duration, left) })
      content.push(written(left))
      taken = after
      continue
    }
    taken = addFractions(taken, item.duration)
    content.push(written(item.duration))
  }
  voice.content.splice(from, 0, ...kept)

  // What the skips did not give comes from the measure's tail, which carries
  // the voice that much further.
  const tail = subtractFractions(after, taken)
  if (!isZero(tail)) {
    content.push(written(tail))
    voice.end = addFractions(voice.end, tail)
  }
}

/** Whether the tuplet holds at least what its ratio counts. */
export function tupletFilled(open: OpenTuplet): boolean {
  return compareFractions(writtenLengthOf(open.tuplet.content), countedLengthOf(open)) >= 0
}

/** The written length a tuplet's ratio counts, for example three eighths. */
export function countedLengthOf(open: OpenTuplet): Fraction {
  return quantityLength(open.tuplet.inner)
}
