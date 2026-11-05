// Settling a part's multi-measure rests once the whole part is read.

import type { WarningCollector } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'

/**
 * The multi-measure rests of a part. A <multiple-rest> counts measures from
 * the one it starts in, and MNX states where the rest starts and how many
 * measures it spans, so a count past the last measure is cut to the measures
 * that are there.
 */
export class MultimeasureRests implements PartCollector {
  readonly #partId: string

  constructor(partId: string) {
    this.#partId = partId
  }

  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void {
    measures.forEach(({ global }, index) => {
      const rest = global.multimeasureRest
      if (rest === undefined) return
      const left = measures.length - index
      if (rest.value <= left) return
      warnings.add(
        'inconsistent:multimeasure-rest',
        `This multi-measure rest spans ${String(rest.value)} measures, and the part has ` +
          `${String(left)} from here. It is cut to those.`,
        { part: this.#partId, measure: index + 1 },
        rest.element,
      )
      global.multimeasureRest = { value: left, element: rest.element }
    })
  }
}
