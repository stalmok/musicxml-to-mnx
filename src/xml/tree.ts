// Accessors for the parsed element tree. The `require*` variants throw a
// MusicXMLError that names the missing element or attribute, its path and its
// line.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { XmlElement } from './parse.js'

// The elements read through child(), children() and requireChild(). The
// sweep in read/element.ts reports the elements below a plainly read child
// that nothing read. descendants() and a walk over `children` record nothing.
const elementsRead = new WeakSet<XmlElement>()

export function child(element: XmlElement, name: string): XmlElement | undefined {
  const found = element.children.find((c) => c.name === name)
  if (found) elementsRead.add(found)
  return found
}

/** Whether something has read this element through the accessors here. */
export function wasRead(element: XmlElement): boolean {
  return elementsRead.has(element)
}

/**
 * An element's text without surrounding whitespace, for a number or a
 * keyword. Text whose spacing matters (lyrics) reads `element.text`.
 */
export function trimmedText(element: XmlElement): string {
  return element.text.trim()
}

export function children(element: XmlElement, name: string): readonly XmlElement[] {
  const found = element.children.filter((c) => c.name === name)
  for (const one of found) elementsRead.add(one)
  return found
}

/** Every element below this one, in the order the source writes them. */
export function* descendants(element: XmlElement): Generator<XmlElement> {
  for (const found of element.children) {
    yield found
    yield* descendants(found)
  }
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

// The attributes read off each element. Reading an attribute records it, as
// ElementReader records children. The sweep in read/element.ts reports the
// notation-bearing attributes that nothing read.
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

/**
 * The value of an attribute, without recording it as read. For an attribute
 * used for something other than what it states, where the sweep must still
 * report what it states: a pickup measure's implicit="yes" says its beats
 * line up with the barline at the end, and also that the measure is excluded
 * from the numbering, which MNX cannot state.
 */
export function peekAttribute(element: XmlElement, name: string): string | undefined {
  return element.attributes[name]
}

/**
 * Records an element as read whole: every attribute on it and every element
 * below it. For an element a warning names whole, so the sweep does not
 * report its parts a second time.
 */
export function readWholeElement(element: XmlElement): void {
  for (const name of Object.keys(element.attributes)) attribute(element, name)
  for (const found of element.children) {
    elementsRead.add(found)
    readWholeElement(found)
  }
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
