// An element, plus a record of which of its children were actually read.
//
// The loss report used to work from a hand-kept list of the children each
// level handles. A list like that is a claim rather than a fact, and it drifts:
// it went on saying a <lyric> was carried over long after the path that reads
// a chord member stopped reading one, so the words under a chord vanished
// without a word in the report.
//
// This is told what was read by the act of reading it. A path that skips
// something reports it without anyone having to remember, and the only entries
// that have to be maintained by hand are the exceptions, where something is
// genuinely accounted for elsewhere and each one has to say why.

import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, readAttributeNames } from '../xml/tree.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'

// Attributes that state where or how something is drawn rather than what it
// is: positions, curve geometry, fonts, spacing, identity, and the format
// version. The sweep passes these over without a word, because they are
// presentation rather than notation, and reporting them would bury every
// real loss under thousands of coordinates.
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
 * Report the notation-bearing attributes nothing read off this element.
 * Reading one through the tree accessor is what accounts for it, so a path
 * that skips an attribute reports it without anyone having to remember,
 * exactly as with children. Categorized as a converter gap by default; an
 * attribute known to have no MNX home keeps its own targeted warning at the
 * reader that decides that.
 */
export function reportUnreadAttributes(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const read = readAttributeNames(element)
  for (const name of Object.keys(element.attributes)) {
    if (read?.has(name)) continue
    if (PRESENTATION_ATTRIBUTES.has(name)) continue
    // Namespace declarations are XML plumbing, not notation.
    if (name.startsWith('xmlns')) continue
    const loss = attributeLoss(element.name, name)
    warnings.add(
      loss.code,
      `The "${name}" attribute of a <${element.name}> ${loss.ending}`,
      { ...context, line: element.line },
      element.name,
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
  reportUnread(warnings: WarningCollector, context: WarningContext): void {
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
      warnings.add(
        loss.code,
        `<${found.name}> ${loss.ending}`,
        { ...context, line: found.line },
        found.name,
      )
    }
    for (const block of this.#blocks.values()) block.reportUnread(warnings, context)
  }
}

/**
 * The drawn text of a named child element, or undefined where the source
 * gives none. An empty element states no name, and one hidden with
 * print-object="no" is one the source chose not to draw; the MNX homes these
 * feed are optional, so either is omitted rather than drawn.
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
