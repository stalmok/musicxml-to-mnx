// Reading numbers out of the document.
//
// Stricter than Number(), which reads "0x10" as 16, "1e3" as 1000 and " 12 "
// as 12. Text that is not a plain number is not read as one.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'

const WHOLE_NUMBER = /^[+-]?\d+$/

/** A number as a score writes one: digits, an optional sign, no exponent. */
const DECIMAL_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

/** The whole number `text` states, or nothing where it states none. */
export function parseWholeNumber(text: string): number | undefined {
  const value = Number(text)
  return WHOLE_NUMBER.test(text) && Number.isSafeInteger(value) ? value : undefined
}

/** The decimal number `text` states, or nothing where it states none. */
export function parseDecimal(text: string): number | undefined {
  return DECIMAL_NUMBER.test(text) ? Number(text) : undefined
}

export function readInteger(element: XmlElement, path: DocumentPath): number {
  const text = trimmedText(element)
  const value = parseWholeNumber(text)
  if (value === undefined) {
    throw new MusicXMLError(`<${element.name}> is not a whole number: "${text}".`, {
      path,
      line: element.line,
    })
  }
  return value
}

/**
 * The same, for a value written as an attribute rather than as an element's
 * text. An attribute has no line of its own, so the element carrying it is
 * what the failure points at.
 */
export function readAttributeInRange(
  element: XmlElement,
  name: string,
  path: DocumentPath,
  min: number,
  max: number,
): number | undefined {
  const written = attribute(element, name)
  if (written === undefined) return undefined

  const value = parseWholeNumber(written)
  if (value === undefined) {
    throw new MusicXMLError(
      `<${element.name}> has a "${name}" of "${written}", which is not a whole number.`,
      { path, line: element.line },
    )
  }
  if (value < min || value > max) {
    throw new MusicXMLError(
      `<${element.name}> has a "${name}" of ${String(value)}, outside the range ` +
        `${String(min)} to ${String(max)}.`,
      { path, line: element.line },
    )
  }
  return value
}

export function readIntegerInRange(
  element: XmlElement,
  path: DocumentPath,
  min: number,
  max: number,
): number {
  const value = readInteger(element, path)
  if (value < min || value > max) {
    throw new MusicXMLError(
      `<${element.name}> is ${String(value)}, outside the range ${String(min)} to ${String(max)}.`,
      { path, line: element.line },
    )
  }
  return value
}
