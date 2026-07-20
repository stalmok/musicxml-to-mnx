// Reading numbers out of the document.
//
// Deliberately stricter than Number(), which reads "0x10" as 16, "1e3" as
// 1000 and " 12 " as 12. Reinterpreting a score's digits is the kind of
// guessing this converter exists to avoid, so anything that is not plainly a
// whole number is a rejected document rather than a value to be salvaged.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { XmlElement } from '../xml/parse.js'
import { trimmedText } from '../xml/tree.js'

const WHOLE_NUMBER = /^[+-]?\d+$/

export function readInteger(element: XmlElement, path: DocumentPath): number {
  const text = trimmedText(element)
  const value = Number(text)
  if (!WHOLE_NUMBER.test(text) || !Number.isSafeInteger(value)) {
    throw new MusicXMLError(`<${element.name}> is not a whole number: "${text}".`, {
      path,
      line: element.line,
    })
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
