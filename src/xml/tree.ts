// Accessors for the parsed element tree. The `require*` variants turn an
// absent element or attribute into a MusicXMLError naming what was missing,
// where it was expected, and the line, so a reader can state what it needs
// and let the failure explain itself.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { XmlElement } from './parse.js'

export function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((c) => c.name === name)
}

/**
 * An element's text with surrounding whitespace removed, which is what a
 * reader wants for a number or a keyword, where the source's indentation is
 * not part of the value. Text whose spacing matters (lyrics) should read
 * `element.text`.
 */
export function trimmedText(element: XmlElement): string {
  return element.text.trim()
}

export function children(element: XmlElement, name: string): readonly XmlElement[] {
  return element.children.filter((c) => c.name === name)
}

export function requireChild(element: XmlElement, name: string, path: DocumentPath): XmlElement {
  const found = child(element, name)
  if (!found) {
    throw new MusicXMLError(`<${element.name}> is missing a <${name}> child.`, {
      path: [...path, element.name],
      line: element.line,
    })
  }
  return found
}

// Which attributes have been read off each element. The read is the record,
// exactly as ElementReader records children: a reader that takes an attribute
// accounts for it by the act of taking it, and the sweep in read/element.ts
// reports the notation-bearing ones nothing took.
const attributesRead = new WeakMap<XmlElement, Set<string>>()

export function attribute(element: XmlElement, name: string): string | undefined {
  let read = attributesRead.get(element)
  if (!read) {
    read = new Set()
    attributesRead.set(element, read)
  }
  read.add(name)
  return element.attributes[name]
}

/** The attribute names something has read off this element, if any. */
export function readAttributeNames(element: XmlElement): ReadonlySet<string> | undefined {
  return attributesRead.get(element)
}

export function requireAttribute(element: XmlElement, name: string, path: DocumentPath): string {
  const value = attribute(element, name)
  if (value === undefined) {
    throw new MusicXMLError(`<${element.name}> is missing a "${name}" attribute.`, {
      path: [...path, element.name],
      line: element.line,
    })
  }
  return value
}
