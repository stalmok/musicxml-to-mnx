// The score's measure as the reader holds it while the parts are merged, and
// the merge itself.

import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  Coda,
  Ending,
  Fermata,
  Fine,
  GlobalMeasure,
  Key,
  RepeatEnd,
  Segno,
  Tempo,
} from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { Stated } from './element.js'

/**
 * A segno or a coda a <sound segno> or <sound coda> names. In a score that
 * draws no sign of the kind, it marks a destination for playback only, and a
 * jump that goes to one cannot be converted.
 */
export interface UndrawnSign {
  readonly kind: 'segno' | 'coda'
}

/**
 * A jump, named by the <sound> attribute that states it. Whether a D.C. or a
 * D.S. is al Fine or al Coda waits until the whole score is known.
 */
export interface ReadJump {
  readonly sound: 'dacapo' | 'dalsegno' | 'tocoda'
  /** Where in the measure it is taken, counting from the start. */
  readonly location: Fraction
}

/** The marks one part states on the score's measure. */
interface ReadMarks {
  readonly number: NonNullable<GlobalMeasure['number']>
  readonly barline: NonNullable<GlobalMeasure['barline']>
  readonly repeatEnd: NonNullable<GlobalMeasure['repeatEnd']>
  // Filled in once the part has met the ending's stop.
  ending: NonNullable<GlobalMeasure['ending']>
  readonly fermata: NonNullable<GlobalMeasure['fermata']>
  readonly segno: Segno
  readonly coda: Coda
  readonly fine: NonNullable<GlobalMeasure['fine']>
  readonly jump: ReadJump
  readonly multimeasureRest: NonNullable<GlobalMeasure['multimeasureRest']>
}

/**
 * A score measure while the parts are merged, before jumps are settled. Each
 * mark keeps the element that states it, for the warnings about parts that
 * disagree.
 */
export type ReadGlobalMeasure = Omit<GlobalMeasure, keyof ReadMarks | 'tempos'> & {
  [K in keyof ReadMarks]: Stated<ReadMarks[K]> | undefined
} & { readonly tempos: readonly Stated<Tempo>[] }

/** A part's keys settled against the score's. */
export interface KeysAcrossParts {
  /** Where the part flips to the enharmonic signature, if it does. */
  flipAt: number | undefined
  /** Whether the part is in a different key from the score at a measure. */
  keyDisagreesAt: (index: number) => boolean
}

/** A part's signatures settled against the score's. */
export interface AcrossParts extends KeysAcrossParts {
  /** The key the score is in at each measure, settled over every part. */
  keys: readonly (Key | undefined)[]
  /** Whether the part is in a different meter from the score at a measure. */
  timeDisagreesAt: (index: number) => boolean
}

// Parts restate the same time; the first to declare one wins, so a later
// part repeating it is not treated as a change. A part declaring a different
// one cannot be carried, because MNX states one key and one time signature
// for the whole score, so the disagreement is reported. The keys are settled
// over every part before the merge. `target` grows as long as the longest
// part, because that list is the score's measure list.
export function mergeGlobalMeasures(
  target: ReadGlobalMeasure[],
  found: readonly ReadGlobalMeasure[],
  part: string,
  { keys, keyDisagreesAt, timeDisagreesAt }: AcrossParts,
  warnings: WarningCollector,
): void {
  // The barline's rule below holds for every mark MNX states once on the
  // score's measure: parts stating different ones disagree about the one
  // mark, so that is reported. Each is compared by content where two parts
  // both state one; a part restating an equal one says nothing new.
  // `attribute` states the mark, where the element itself does not.
  const reportDifferingMark = <T>(
    name: string,
    attribute: string | undefined,
    inScore: Stated<T> | undefined,
    inPart: Stated<T> | undefined,
    same: (a: T, b: T) => boolean,
    context: ReportContext,
  ): void => {
    if (inScore === undefined || inPart === undefined || same(inScore.value, inPart.value)) return
    warnings.add(
      'unrepresentable:cross-part-mark',
      `The parts of this score state different ${name}s on this measure, and MNX ` +
        'states one there. The first stated is the one converted.',
      context,
      inPart.element,
      attribute,
    )
  }
  found.forEach((measure, index) => {
    const existing = target[index]
    // The measure's position, as every other report names it, not the
    // source's label.
    const context = { part, measure: index + 1 }
    if (keyDisagreesAt(index)) {
      warnings.addForMeasure(
        'unrepresentable:cross-part-key',
        'The parts of this score are in different keys, and MNX states one key for ' +
          'the score, so a part is drawn in a key its source does not state.',
        context,
        'key',
      )
    }
    if (timeDisagreesAt(index)) {
      warnings.addForMeasure(
        'unrepresentable:cross-part-time',
        'The parts of this score are in different time signatures, and MNX states one ' +
          'for the score. The first stated is the one converted.',
        context,
        'time',
      )
    }
    // A multi-measure rest is the whole score's, like the barline: parts
    // usually restate the same span. Parts stating different spans over the
    // same measure disagree about the one MNX can state, so that is reported.
    if (
      existing?.multimeasureRest !== undefined &&
      measure.multimeasureRest !== undefined &&
      existing.multimeasureRest.value !== measure.multimeasureRest.value
    ) {
      warnings.add(
        'unrepresentable:cross-part-multimeasure-rest',
        'The parts of this score state multi-measure rests of different spans over ' +
          'this measure, and MNX states one for the score. The first stated is the ' +
          'one converted.',
        context,
        measure.multimeasureRest.element,
      )
    }
    // A barline is the whole score's: every part is cut at the same place,
    // and each usually writes the same thing. Parts writing different ones
    // disagree about the one line MNX can state, so that is reported.
    if (existing?.barline && measure.barline && existing.barline.value !== measure.barline.value) {
      warnings.add(
        'unrepresentable:cross-part-barline',
        'The parts of this score close this measure with different barlines, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        measure.barline.element,
      )
    }
    // A segno is restated in each part the same way a barline is. Parts
    // stating different signs, at different points or drawn differently,
    // disagree about the one segno MNX can state, so that is reported.
    if (existing?.segno && measure.segno && !sameSign(existing.segno.value, measure.segno.value)) {
      warnings.add(
        'unrepresentable:cross-part-segno',
        'The parts of this score state different segnos on this measure, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        measure.segno.element,
      )
    }
    // The number is the label the score writes over the measure, so parts
    // labelling the same measure differently is the source disagreeing with
    // itself. The comparison runs only where both carry one, which is only
    // where the label differs from the measure's position.
    if (
      existing?.number !== undefined &&
      measure.number !== undefined &&
      existing.number.value !== measure.number.value
    ) {
      warnings.add(
        'inconsistent:measure-number',
        `This measure is numbered ${String(existing.number.value)} by an earlier part and ` +
          `${String(measure.number.value)} by this one. The first is the one converted.`,
        context,
        measure.number.element,
        'number',
      )
    }
    reportDifferingMark(
      'repeat',
      undefined,
      existing?.repeatEnd,
      measure.repeatEnd,
      sameRepeatEnd,
      context,
    )
    reportDifferingMark('ending', undefined, existing?.ending, measure.ending, sameEnding, context)
    reportDifferingMark(
      'fermata',
      undefined,
      existing?.fermata,
      measure.fermata,
      sameFermata,
      context,
    )
    reportDifferingMark('coda', undefined, existing?.coda, measure.coda, sameSign, context)
    reportDifferingMark('fine', 'fine', existing?.fine, measure.fine, sameFine, context)
    reportDifferingMark(
      'jump',
      measure.jump?.value.sound,
      existing?.jump,
      measure.jump,
      sameJump,
      context,
    )
    target[index] = {
      key: keys[index],
      time: existing?.time ?? measure.time,
      tempos: mergeTempos(existing?.tempos ?? [], measure.tempos, warnings, context),
      number: existing?.number ?? measure.number,
      barline: existing?.barline ?? measure.barline,
      // The three marks a part states as a plain yes follow a different rule
      // from the objects around them: a mark any part states is kept, and a
      // part not stating one is not disagreeing. A boolean cannot tell "no"
      // from "nothing said", so there is no disagreement to report.
      repeatStart: (existing?.repeatStart ?? false) || measure.repeatStart,
      repeatEnd: existing?.repeatEnd ?? measure.repeatEnd,
      ending: existing?.ending ?? measure.ending,
      fermata: existing?.fermata ?? measure.fermata,
      // A segno, a coda, a Fine and a jump are the score's navigation marks,
      // restated in each part like the barline, so the first part to state
      // one wins.
      segno: existing?.segno ?? measure.segno,
      coda: existing?.coda ?? measure.coda,
      fine: existing?.fine ?? measure.fine,
      jump: existing?.jump ?? measure.jump,
      multimeasureRest: existing?.multimeasureRest ?? measure.multimeasureRest,
      // A break is one of those three, and is usually written into one part
      // only: the part not stating it leaves the layout to the parts that do.
      systemBreak: (existing?.systemBreak ?? false) || measure.systemBreak,
      pageBreak: (existing?.pageBreak ?? false) || measure.pageBreak,
    }
  })
}

// The written sign: where it sits, its glyph and its color.
function sameSign(a: Segno, b: Segno): boolean {
  return (
    compareFractions(a.location, b.location) === 0 && a.glyph === b.glyph && a.color === b.color
  )
}

// Content equality for the marks two parts or two barlines state, one per shape.
export function sameRepeatEnd(a: RepeatEnd, b: RepeatEnd): boolean {
  return a.times === b.times
}

function sameEnding(a: Ending, b: Ending): boolean {
  return a.duration === b.duration && a.open === b.open && sameNumbers(a.numbers, b.numbers)
}

export function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((number, index) => number === b[index])
}

export function sameFermata(a: Fermata, b: Fermata): boolean {
  return a.symbol === b.symbol && a.pointing === b.pointing && a.placement === b.placement
}

function sameFine(a: Fine, b: Fine): boolean {
  return compareFractions(a.location, b.location) === 0
}

function sameJump(a: ReadJump, b: ReadJump): boolean {
  return compareFractions(a.location, b.location) === 0 && a.sound === b.sound
}

/**
 * A tempo belongs to the score, but MusicXML writes it inside a part, and
 * exporters often write the same mark into every part. Each mark is kept
 * once, whichever part states it.
 *
 * MNX holds a list, so two different tempos at one point would both be drawn
 * over the same beat. The first is kept and the disagreement reported, as for
 * every other mark the parts share.
 */
function mergeTempos(
  existing: readonly Stated<Tempo>[],
  found: readonly Stated<Tempo>[],
  warnings: WarningCollector,
  context: ReportContext,
): Stated<Tempo>[] {
  const merged = [...existing]
  for (const tempo of found) {
    if (merged.some((other) => sameTempo(other.value, tempo.value))) continue
    const at = merged.findIndex(
      (other) => compareFractions(other.value.position, tempo.value.position) === 0,
    )
    if (at >= 0) {
      // A mark below existing.length is an earlier part's, and one at or past
      // it is this part's own. Only the wording of the report differs.
      const acrossParts = at < existing.length
      warnings.add(
        'inconsistent:tempo',
        acrossParts
          ? 'The parts of this score state different tempos at the same point in this ' +
              'measure. The first stated is the one converted.'
          : 'This part states two different tempos at the same point in this measure. ' +
              'The first is the one converted.',
        context,
        tempo.element,
      )
      continue
    }
    merged.push(tempo)
  }
  return merged
}

function sameTempo(a: Tempo, b: Tempo): boolean {
  return (
    a.bpm === b.bpm &&
    a.value.base === b.value.base &&
    a.value.dots === b.value.dots &&
    compareFractions(a.position, b.position) === 0
  )
}
