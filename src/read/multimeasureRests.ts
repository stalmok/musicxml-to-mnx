// Settling multi-measure rests: a part's own once the whole part is read, and
// the score's once the parts are merged.

import type { Measure, SequenceItem } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { Stated } from './element.js'
import type { ReadGlobalMeasure } from './globalMeasures.js'
import type { PartCollector, PartMeasure } from './partCollector.js'

/**
 * The multi-measure rests of a part. A <multiple-rest> counts measures from
 * the one it starts in, and MNX states where the rest starts and how many
 * measures it spans, so a count past the last measure is cut to the measures
 * that are there. A rest that starts inside an earlier one, or spans a
 * measure where the part sounds a note, says something the part's own
 * measures contradict, and is not converted.
 */
export class MultimeasureRests implements PartCollector {
  readonly #partId: string

  constructor(partId: string) {
    this.#partId = partId
  }

  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void {
    let open: { start: number; end: number } | undefined
    measures.forEach(({ global }, index) => {
      const rest = global.multimeasureRest
      if (rest === undefined) return
      const report = (message: string) =>
        warnings.add(
          'inconsistent:multimeasure-rest',
          message,
          { part: this.#partId, measure: index + 1 },
          rest.element,
        )
      if (open !== undefined && index < open.end) {
        report(
          'This multi-measure rest starts inside the one from measure ' +
            `${String(open.start + 1)}, and is not converted.`,
        )
        global.multimeasureRest = undefined
        return
      }
      const left = measures.length - index
      const spans = Math.min(rest.value, left)
      if (measures.slice(index, index + spans).some(({ measure }) => sounds(measure))) {
        report(
          'The part sounds a note in the measures this multi-measure rest spans, so the ' +
            'rest is not converted.',
        )
        global.multimeasureRest = undefined
        return
      }
      if (rest.value > left) {
        report(
          `This multi-measure rest spans ${String(rest.value)} measures, and the part has ` +
            `${String(left)} from here. It is cut to those.`,
        )
        global.multimeasureRest = { value: spans, element: rest.element }
      }
      open = { start: index, end: index + spans }
    })
  }
}

/** A part as the score's multi-measure rests are settled against it. */
export interface RestingPart {
  readonly id: string
  /** The rest the part states at each measure, settled against its own. */
  readonly rests: readonly (Stated<number> | undefined)[]
  readonly measures: readonly Measure[]
}

/**
 * Settles the score's multi-measure rests once every part is read. Each part
 * has settled its own, so what is left is parts disagreeing, and MNX states
 * one set of rests for the score. A rest that starts inside the score's rest
 * before it, or spans a measure where another part sounds a note, is not
 * converted. Where parts state different spans over a measure, the first
 * stated that is not dropped is the one converted. `measures` is the score's
 * measure list.
 */
export function settleMultimeasureRests(
  measures: readonly ReadGlobalMeasure[],
  parts: readonly RestingPart[],
  warnings: WarningCollector,
): void {
  let open: { start: number; end: number } | undefined
  measures.forEach((measure, index) => {
    let kept: Stated<number> | undefined
    // Parts usually restate the same span, so each span is settled once.
    const settled = new Set<number>()
    for (const { id, rests } of parts) {
      const rest = rests[index]
      if (rest === undefined || settled.has(rest.value)) continue
      settled.add(rest.value)
      const report = (message: string) =>
        warnings.add(
          'unrepresentable:cross-part-multimeasure-rest',
          message,
          { part: id, measure: index + 1 },
          rest.element,
        )
      if (kept !== undefined) {
        report(
          'The parts of this score state multi-measure rests of different spans over ' +
            'this measure, and MNX states one for the score. This one is not converted.',
        )
      } else if (open !== undefined && index < open.end) {
        report(
          'This multi-measure rest starts inside one another part states from measure ' +
            `${String(open.start + 1)}, and MNX states one set of rests for the score. ` +
            'This one is not converted.',
        )
      } else if (
        parts.some((part) => part.measures.slice(index, index + rest.value).some(sounds))
      ) {
        report(
          'Another part sounds a note in the measures this multi-measure rest spans, and ' +
            'MNX states one set of rests for the score. The rest is not converted.',
        )
      } else {
        kept = rest
      }
    }
    measure.multimeasureRest = kept
    if (kept !== undefined) open = { start: index, end: index + kept.value }
  })
}

function sounds(measure: Measure): boolean {
  return measure.sequences.some((sequence) => soundsIn(sequence.content))
}

function soundsIn(items: readonly SequenceItem[]): boolean {
  return items.some((item) => {
    switch (item.kind) {
      case 'event':
        return item.body.kind === 'notes'
      case 'space':
        return false
      default:
        return soundsIn(item.content)
    }
  })
}
