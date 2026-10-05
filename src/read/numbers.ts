// Reading numbers out of the document.
//
// Stricter than Number(), which reads "0x10" as 16, "1e3" as 1000 and " 12 "
// as 12. Text that is not a plain number is not read as one.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
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

/**
 * The exact value of the decimal number `text` states: its digits over a power
 * of ten. Nothing where it states none, or where the value cannot be held
 * exactly.
 */
export function parseExactDecimal(text: string): Fraction | undefined {
  if (!DECIMAL_NUMBER.test(text)) return undefined
  const [whole = '', fractional = ''] = text.split('.')
  const places = fractional.replace(/0+$/, '')
  const num = Number(/\d/.test(whole + places) ? whole + places : 0)
  const den = 10 ** places.length
  return Number.isSafeInteger(num) && Number.isSafeInteger(den) ? fraction(num, den) : undefined
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

/** A decimal range: from `min` with the bound included, or `above` it with the bound left out. */
type DecimalRange = { min: number; max: number } | { above: number; max: number }

/** The exact value of an element written as a decimal number in `range`. */
export function readDecimalInRange(
  element: XmlElement,
  path: DocumentPath,
  range: DecimalRange,
): Fraction {
  const text = trimmedText(element)
  const value = parseExactDecimal(text)
  if (value === undefined) {
    const why = DECIMAL_NUMBER.test(text)
      ? 'has too many digits to read exactly'
      : 'is not a number'
    throw new MusicXMLError(`<${element.name}> ${why}: "${text}".`, {
      path,
      line: element.line,
    })
  }
  const tooLow =
    'min' in range
      ? compareFractions(value, fraction(range.min)) < 0
      : compareFractions(value, fraction(range.above)) <= 0
  if (tooLow || compareFractions(value, fraction(range.max)) > 0) {
    const from = 'min' in range ? String(range.min) : `above ${String(range.above)}`
    throw new MusicXMLError(
      `<${element.name}> is ${text}, outside the range ${from} to ${String(range.max)}.`,
      { path, line: element.line },
    )
  }
  return value
}
