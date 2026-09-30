// Collects the loss report while the reader walks the source.
//
// A warning about an element takes its name and its line from the element
// itself, so the two cannot disagree. The context says only which part and
// measure the warning is in.

import type { ConversionWarning, WarningCode, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute as readAttribute } from '../xml/tree.js'

/** Where a warning is, apart from its line, which comes from an element. */
export type ReportContext = Omit<WarningContext, 'line'>

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
    context: ReportContext,
    found?: XmlElement,
    attribute?: string,
  ): void {
    this.addAt(this.reserve(), code, message, context, found, attribute)
  }

  /**
   * Reports found as not converted at all. Every attribute on it counts as
   * read, so the sweep does not report them a second time.
   */
  addWhole(code: WarningCode, message: string, context: ReportContext, found: XmlElement): void {
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
    context: ReportContext,
    at: XmlElement,
    missing: string,
  ): void {
    this.#push(this.reserve(), {
      code,
      message,
      element: missing,
      attribute: undefined,
      context: { ...context, line: at.line },
    })
  }

  /**
   * Reports a loss about what a measure states as a whole, such as two parts
   * stating different barlines for it. No one element holds the loss, so the
   * warning names the kind of element and gives no line.
   */
  addForMeasure(
    code: WarningCode,
    message: string,
    context: ReportContext,
    element: string,
    attribute?: string,
  ): void {
    this.#push(this.reserve(), { code, message, element, attribute, context })
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
    context: ReportContext,
    found?: XmlElement,
    attribute?: string,
  ): void {
    if (!found) {
      this.#push(place, { code, message, element: undefined, attribute, context })
      return
    }
    if (attribute !== undefined) readAttribute(found, attribute)
    const at = { ...context, line: found.line }
    this.#push(place, { code, message, element: found.name, attribute, context: at })
  }

  #push(place: WarningPlace, warning: ConversionWarning): void {
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
