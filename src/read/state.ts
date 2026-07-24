// What the readers of one part share: the running state a measure cannot be
// read without.

import { IdGenerator, SpannerResolver } from './spanners.js'

/**
 * What a part carries from one measure to the next. `<divisions>` is stated
 * once and stays in force until restated, so a measure is not readable on its
 * own.
 */
export interface PartState {
  divisions: number | undefined
  /**
   * Whether the divisions in force are an assumption rather than something
   * the file stated. A written note value can be checked against an assumed
   * duration; a note with no written value cannot, so it is refused rather
   * than guessed at.
   */
  divisionsAssumed: boolean
  /**
   * The time signature in force, which like <divisions> stays until restated.
   * Held only so that a direction moved by an <offset> can be checked against
   * the length of the measure it lands in.
   */
  time: { count: number; unit: number } | undefined
  /** How many staves the part is written on, once it says. */
  staves: number
  /** Shared across the score, so every id in the document is distinct. */
  ids: IdGenerator
  /** Per part: a tie or slur may span measures, but not parts. */
  spanners: SpannerResolver
}

export function newPartState(ids: IdGenerator): PartState {
  return {
    divisions: undefined,
    divisionsAssumed: false,
    time: undefined,
    staves: 1,
    ids,
    spanners: new SpannerResolver(),
  }
}
