// Collects the loss report while the reader walks the source.

import type { ConversionWarning, WarningCode, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute as readAttribute } from '../xml/tree.js'

/**
 * A place kept in the report, taken where an element is read and reported
 * through once the decision about it can be made. See reserve.
 */
export type WarningPlace = number

export class WarningCollector {
  readonly #warnings: { place: WarningPlace; warning: ConversionWarning }[] = []
  #next = 0

  /**
   * Reports a loss about found, which gives the warning its element and its
   * line. A named attribute is the part of found the loss is about, and
   * counts as read, so the sweep does not report it a second time.
   */
  add(
    code: WarningCode,
    message: string,
    context: WarningContext,
    found?: XmlElement | string,
    attribute?: string,
  ): void {
    this.addAt(this.reserve(), code, message, context, found, attribute)
  }

  /**
   * Reports found as not converted at all. Every attribute on it counts as
   * read, so the sweep does not report them a second time.
   */
  addWhole(code: WarningCode, message: string, context: WarningContext, found: XmlElement): void {
    for (const name of Object.keys(found.attributes)) readAttribute(found, name)
    this.add(code, message, context, found)
  }

  /**
   * Reports an element the source leaves out. at is where it is needed, and
   * gives the warning its line.
   */
  addMissing(
    code: Extract<WarningCode, `missing:${string}`>,
    message: string,
    context: WarningContext,
    at: XmlElement,
    missing: string,
  ): void {
    this.add(code, message, { ...context, line: at.line }, missing)
  }

  /**
   * Reports a loss about what a measure states as a whole, such as two parts
   * stating different barlines for it. No one element holds the loss, so the
   * warning names the kind of element and gives no line.
   */
  addForMeasure(
    code: WarningCode,
    message: string,
    context: WarningContext,
    element: string,
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
    found?: XmlElement | string,
    attribute?: string,
  ): void {
    if (found === undefined || typeof found === 'string') {
      this.#warnings.push({ place, warning: { code, message, element: found, attribute, context } })
      return
    }
    if (attribute !== undefined) readAttribute(found, attribute)
    const warning = {
      code,
      message,
      element: found.name,
      attribute,
      context: { ...context, line: found.line },
    }
    this.#warnings.push({ place, warning })
  }

  /**
   * A copy of the report, in document order. The sort is stable, so two
   * warnings reported through one place keep the order they were added in.
   */
  list(): readonly ConversionWarning[] {
    return [...this.#warnings].sort((a, b) => a.place - b.place).map((entry) => entry.warning)
  }
}
