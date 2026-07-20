// What the readers of one part share: the running state a measure cannot be
// read without, and the loss reporting they all use.

import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { IdGenerator, SpannerResolver } from './spanners.js'

/**
 * What a part carries from one measure to the next. `<divisions>` is stated
 * once and stays in force until restated, so a measure is not readable on its
 * own.
 */
export interface PartState {
  divisions: number | undefined
  /** Shared across the score: true once any accidental is drawn. */
  usesAccidentalDisplay: { value: boolean }
  /** How many staves the part is written on, once it says. */
  staves: number
  /** Shared across the score, so every id in the document is distinct. */
  ids: IdGenerator
  /** Per part: a tie or slur may span measures, but not parts. */
  spanners: SpannerResolver
}

export function newPartState(
  ids: IdGenerator,
  usesAccidentalDisplay: { value: boolean },
): PartState {
  return {
    divisions: undefined,
    usesAccidentalDisplay,
    staves: 1,
    ids,
    spanners: new SpannerResolver(),
  }
}

export function reportUnhandled(
  element: XmlElement,
  handled: ReadonlySet<string>,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  for (const found of element.children) {
    if (handled.has(found.name)) continue
    warnings.add('unsupported:element', `<${found.name}> is not converted yet.`, {
      ...context,
      line: found.line,
    })
  }
}
