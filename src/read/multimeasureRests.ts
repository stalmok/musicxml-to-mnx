// Settling multi-measure rests: a part's own once the whole part is read, and
// the score's once the parts are merged.

import type { Measure, SequenceItem } from '../model/score.js'
import type { WarningCollector } from './collector.js'
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
      const left = measures.length - index
      const spans = Math.min(rest.value, left)
      if (rest.value > left) {
        report(
          `This multi-measure rest spans ${String(rest.value)} measures, and the part has ` +
            `${String(left)} from here. It is cut to those.`,
        )
        global.multimeasureRest = { value: spans, element: rest.element }
      }
      const spanned = measures.slice(index, index + spans)
      if (open !== undefined && index < open.end) {
        report(
          'This multi-measure rest starts inside the one from measure ' +
            `${String(open.start + 1)}, and is not converted.`,
        )
        global.multimeasureRest = undefined
      } else if (spanned.some(({ measure }) => sounds(measure))) {
        report(
          'The part sounds a note in the measures this multi-measure rest spans, so the ' +
            'rest is not converted.',
        )
        global.multimeasureRest = undefined
      } else {
        open = { start: index, end: index + spans }
      }
    })
  }
}

/**
 * Settles the score's multi-measure rests once the parts are merged. Each part
 * has settled its own, so what is left is parts disagreeing: MNX states one
 * set of rests for the score, and a rest one part states can start inside
 * another part's, or span a measure where another part sounds a note. Either
 * is not converted. `measures` is the score's measure list, and `parts`
 * holds each part's measures.
 */
export function settleMultimeasureRests(
  measures: readonly ReadGlobalMeasure[],
  parts: readonly (readonly Measure[])[],
  warnings: WarningCollector,
): void {
  let open: { start: number; end: number } | undefined
  measures.forEach((measure, index) => {
    const rest = measure.multimeasureRest
    if (rest === undefined) return
    const end = index + rest.value
    const report = (message: string) =>
      warnings.add(
        'unrepresentable:cross-part-multimeasure-rest',
        message,
        { measure: index + 1 },
        rest.element,
      )
    if (open !== undefined && index < open.end) {
      report(
        'This multi-measure rest starts inside one another part states from measure ' +
          `${String(open.start + 1)}, and MNX states one set of rests for the score. ` +
          'The first is the one converted.',
      )
      measure.multimeasureRest = undefined
    } else if (parts.some((part) => part.slice(index, end).some(sounds))) {
      report(
        'Another part sounds a note in the measures this multi-measure rest spans, and ' +
          'MNX states one set of rests for the score. The rest is not converted.',
      )
      measure.multimeasureRest = undefined
    } else {
      open = { start: index, end }
    }
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
