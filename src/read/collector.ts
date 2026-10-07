// Collects the loss report while the reader walks the source.
//
// A warning about an element takes its name and its line from the element
// itself, so the two cannot disagree. The context says only which part and
// measure the warning is in.

import type { ConversionWarning, WarningCode, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute as readAttribute, trimmedText } from '../xml/tree.js'

/** Where a warning is, apart from its line, which comes from an element. */
export type ReportContext = Omit<WarningContext, 'line'> & { readonly line?: never }

/**
 * A place kept in the report, taken where an element is read and reported
 * through once the decision about it can be made. See reserve.
 */
export type WarningPlace = number

/** A place kept for a warning about an element, moved by settleHeld. */
export interface HeldPlace {
  place: WarningPlace
}

export class WarningCollector {
  readonly #warnings: { place: WarningPlace; warning: ConversionWarning }[] = []
  readonly #held: { held: HeldPlace; line: number }[] = []
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
    found: XmlElement,
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
   * Reports an attribute of found whose value MusicXML does not define, or a
   * required one the source leaves out. The consequence finishes the
   * sentence, as in "and is not carried over."
   */
  addUndefinedAttribute(
    found: XmlElement,
    name: string,
    consequence: string,
    context: ReportContext,
  ): void {
    const written = readAttribute(found, name)
    const article = articleFor(found)
    if (written === undefined) {
      this.add(
        'missing:attribute',
        `${article} <${found.name}> states no ${name}, ${consequence}`,
        context,
        found,
      )
      return
    }
    this.add(
      'unresolved:attribute-value',
      `${article} <${found.name}> of ${name} "${written}" is not one MusicXML defines, ${consequence}`,
      context,
      found,
      name,
    )
  }

  /**
   * Reports found, whose text is not a value MusicXML defines for it. The
   * consequence finishes the sentence, as in "and is not carried over." A
   * whole report also accounts for every attribute on found, as addWhole does.
   */
  addUndefinedText(
    found: XmlElement,
    consequence: string,
    context: ReportContext,
    { whole = false } = {},
  ): void {
    const message =
      `${articleFor(found)} <${found.name}> of "${trimmedText(found)}" is not one MusicXML ` +
      `defines, ${consequence}`
    if (whole) this.addWhole('unresolved:element-value', message, context, found)
    else this.add('unresolved:element-value', message, context, found)
  }

  /**
   * Reports a <divisions> the source leaves out. at is where it is needed,
   * and gives the warning its line.
   */
  addMissing(
    code: 'missing:divisions',
    message: string,
    context: ReportContext,
    at: XmlElement,
  ): void {
    this.#push(this.reserve(), {
      code,
      message,
      element: 'divisions',
      attribute: undefined,
      context: { ...context, line: at.line },
    })
  }

  /**
   * Reports parts that disagree about the key or time signature in force on a
   * measure. A part may carry it over from an earlier measure, so no element
   * in this measure need state it. The warning names the kind of element and
   * gives no line.
   */
  addForMeasure(
    code: WarningCode,
    message: string,
    context: ReportContext,
    element: 'key' | 'time',
  ): void {
    this.#push(this.reserve(), { code, message, element, attribute: undefined, context })
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

  /**
   * Keeps a place for a warning about found that is decided later. The place
   * moves when settleHeld is next called, so found's warning comes after the
   * ones the element holding it reports as it is read.
   */
  hold(found: XmlElement): HeldPlace {
    const held = { place: this.reserve() }
    this.#held.push({ held, line: found.line })
    return held
  }

  /**
   * Moves the places held since the last call past every place taken so far,
   * in the order of the lines their elements are written on. Called once an
   * element of a measure has been read and swept for what it does not convert.
   */
  settleHeld(): void {
    const byLine = [...this.#held].sort((a, b) => a.line - b.line)
    for (const { held } of byLine) held.place = this.reserve()
    this.#held.length = 0
  }

  /** Reports at a place taken earlier. Otherwise the same as add. */
  addAt(
    place: WarningPlace,
    code: WarningCode,
    message: string,
    context: ReportContext,
    found: XmlElement,
    attribute?: string,
  ): void {
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

function articleFor(found: XmlElement): 'A' | 'An' {
  return /^[aeiou]/.test(found.name) ? 'An' : 'A'
}
