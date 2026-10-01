// An element, plus a record of which of its children were read.
//
// The loss report comes from what was read, not from a hand-kept list, so a
// path that skips a child reports it. The only hand-kept entries are skip()
// calls, for a child accounted for elsewhere, and each one says why.

import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, readAttributeNames } from '../xml/tree.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'

// Attributes that state where or how something is drawn rather than what it
// is: positions, curve geometry, fonts, spacing, identity, and the format
// version. The sweep does not report them.
const PRESENTATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'default-x',
  'default-y',
  'relative-x',
  'relative-y',
  'bezier-x',
  'bezier-y',
  'bezier-x2',
  'bezier-y2',
  'bezier-offset',
  'bezier-offset2',
  'font-family',
  'font-style',
  'font-size',
  'font-weight',
  'width',
  // The vertical size of a hairpin's open end, in tenths.
  'spread',
  'id',
  'version',
  'xml:space',
])

/**
 * Whether an attribute states only where or how something is drawn, or is
 * XML plumbing such as a namespace declaration, rather than notation.
 */
/**
 * A value read from the source, with the element that states it, for a
 * warning about the value that waits until the whole measure is read.
 */
export interface Stated<T> {
  readonly value: T
  readonly element: XmlElement
}

export function isPresentationAttribute(name: string): boolean {
  return PRESENTATION_ATTRIBUTES.has(name) || name.startsWith('xmlns')
}

/**
 * Report the notation-bearing attributes nothing read off this element.
 * Reading one through the tree accessor accounts for it. An attribute is a
 * converter gap unless NO_HOME_ATTRIBUTES lists it.
 */
export function reportUnreadAttributes(
  element: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const read = readAttributeNames(element)
  for (const name of Object.keys(element.attributes)) {
    if (read?.has(name) || isPresentationAttribute(name)) continue
    const loss = attributeLoss(element.name, name)
    warnings.add(
      loss.code,
      `The "${name}" attribute of a <${element.name}> ${loss.ending}`,
      context,
      element,
      name,
    )
  }
}

export class ElementReader {
  readonly element: XmlElement
  // Which children were read, held by identity rather than by name: child()
  // takes the first of a name, so tracking the name would report none of that
  // name's siblings even though only one was read. The rest are a loss.
  readonly #read = new Set<XmlElement>()
  // Children accounted for by skip(), whose attributes the account covers.
  readonly #skipped = new Set<XmlElement>()
  // Readers over child elements that are themselves read into, so one report
  // at the top covers the whole tree this reader walked. Held by identity,
  // for the same reason the read children are.
  readonly #blocks = new Map<XmlElement, ElementReader>()

  constructor(element: XmlElement) {
    this.element = element
  }

  get name(): string {
    return this.element.name
  }

  get line(): number {
    return this.element.line
  }

  // Attributes are tracked too, by the tree accessor itself: a reader
  // wanting one reads it off `element` directly, and the read is the record.
  child(name: string): XmlElement | undefined {
    const found = child(this.element, name)
    if (found) this.#read.add(found)
    return found
  }

  children(name: string): readonly XmlElement[] {
    const found = children(this.element, name)
    for (const one of found) this.#read.add(one)
    return found
  }

  /** Accounts for one child, found on `element` directly and read there. */
  read(found: XmlElement): void {
    this.#read.add(found)
  }

  /**
   * Accounts for one child whole, attributes included, for a child whose
   * content another element states.
   */
  readWhole(found: XmlElement): void {
    this.#read.add(found)
    this.#skipped.add(found)
  }

  /**
   * Readers over every child of this name, for elements that hold notation of
   * their own. Their unread children are reported along with this one's.
   */
  blocks(name: string): readonly ElementReader[] {
    return children(this.element, name).map((found) => this.block(found))
  }

  /**
   * A reader over one child, for a level that walks its children in document
   * order and reads some of them as blocks. The same child asked for twice
   * gives the same reader, so what the first call read stays accounted for.
   */
  block(found: XmlElement): ElementReader {
    const existing = this.#blocks.get(found)
    if (existing) return existing

    this.#read.add(found)
    const made = new ElementReader(found)
    this.#blocks.set(found, made)
    return made
  }

  /**
   * Accounts for a child without reading one, for the few places where it is
   * settled elsewhere: carried over by some other means, or reported by hand
   * where it stands. Every call needs a comment saying which. The account
   * covers the child whole, attributes included.
   */
  skip(...names: readonly string[]): void {
    for (const found of this.element.children) {
      if (names.includes(found.name)) {
        this.#read.add(found)
        this.#skipped.add(found)
      }
    }
  }

  /** Everything this reader never looked at, reported as a loss. */
  reportUnread(warnings: WarningCollector, context: ReportContext): void {
    reportUnreadAttributes(this.element, warnings, context)

    // A block wraps its own reader, which sweeps its attributes below; a
    // plain-read child has no reader of its own, so its attributes are
    // swept here. An unread child is reported wholesale, and naming its
    // attributes on top would report the same loss twice.
    for (const found of this.element.children) {
      if (this.#read.has(found)) {
        if (!this.#blocks.has(found) && !this.#skipped.has(found)) {
          reportUnreadAttributes(found, warnings, context)
        }
        continue
      }
      const loss = elementLoss(found.name)
      warnings.add(loss.code, `<${found.name}> ${loss.ending}`, context, found)
    }
    for (const block of this.#blocks.values()) block.reportUnread(warnings, context)
  }
}

/**
 * The drawn text of a named child element, or undefined where the source
 * gives none. An empty element states no name, and one hidden with
 * print-object="no" is not drawn. The MNX properties these feed are optional,
 * so either is omitted.
 *
 * Takes the first child of the name; callers use it for elements MusicXML
 * allows at most once (<part-name>, <group-name>).
 */
export function drawnName(reader: ElementReader, tag: string): string | undefined {
  const element = reader.child(tag)
  const text = element?.text.trim()
  const hidden = element !== undefined && attribute(element, 'print-object') === 'no'
  return text && !hidden ? text : undefined
}
