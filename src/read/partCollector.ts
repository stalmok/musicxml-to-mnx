// What a part gathers as its measures are read and settles once all of them
// are in: the two ends of a span, a signature held past the last barline, an
// ending's start and stop, a measure repeat sign's edges.

import type { Measure } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { ReadGlobalMeasure } from './jumps.js'

/** One measure of the part as read, and the score's measure it stands in. */
export interface PartMeasure {
  readonly measure: Measure
  readonly global: ReadGlobalMeasure
}

/**
 * Something read across a part's measures that cannot be settled until the
 * whole part is in. `finish` settles it into the measures and reports what
 * stays unsettled.
 */
export interface PartCollector {
  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void
}
