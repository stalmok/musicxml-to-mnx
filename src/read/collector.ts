// Collects the loss report while the reader walks the source.

import type { ConversionWarning, WarningCode, WarningContext } from '../warnings.js'

/**
 * A place kept in the report, taken where an element is read and reported
 * through once the decision about it can be made. See reserve.
 */
export type WarningPlace = number

export class WarningCollector {
  readonly #warnings: { place: WarningPlace; warning: ConversionWarning }[] = []
  #next = 0

  add(
    code: WarningCode,
    message: string,
    context: WarningContext,
    element?: string,
    attribute?: string,
  ): void {
    this.addAt(this.reserve(), code, message, context, element, attribute)
  }

  /**
   * Keeps this point in the report for a decision that cannot be made yet,
   * such as one that depends on what a later part writes. Take a place where
   * the element is read and report through it later with addAt, so the report
   * stays in document order.
   */
  reserve(): WarningPlace {
    return this.#next++
  }

  /** Reports at a place taken earlier. Otherwise the same as add. */
  addAt(
    place: WarningPlace,
    code: WarningCode,
    message: string,
    context: WarningContext,
    element?: string,
    attribute?: string,
  ): void {
    this.#warnings.push({ place, warning: { code, message, element, attribute, context } })
  }

  /**
   * A copy of the report, in document order. The sort is stable, so two
   * warnings reported through one place keep the order they were added in.
   */
  list(): readonly ConversionWarning[] {
    return [...this.#warnings].sort((a, b) => a.place - b.place).map((entry) => entry.warning)
  }
}
