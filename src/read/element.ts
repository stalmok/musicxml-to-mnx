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
import { attribute, child, children } from '../xml/tree.js'
import { elementLoss } from './unrepresentable.js'

export class ElementReader {
  readonly element: XmlElement
  // Which children were read, held by identity rather than by name: child()
  // takes the first of a name, so tracking the name would report none of that
  // name's siblings even though only one was read. The rest are a loss.
  readonly #read = new Set<XmlElement>()
  // Readers over child elements that are themselves read into, so one report
  // at the top covers the whole tree this reader walked.
  readonly #blocks = new Map<string, ElementReader[]>()

  constructor(element: XmlElement) {
    this.element = element
  }

  get name(): string {
    return this.element.name
  }

  get line(): number {
    return this.element.line
  }

  // Only children are tracked. Attributes carry no notation of their own, so
  // a reader wanting one reads it off `element` directly.
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

  /**
   * Readers over every child of this name, for elements that hold notation of
   * their own. Their unread children are reported along with this one's.
   */
  blocks(name: string): readonly ElementReader[] {
    const existing = this.#blocks.get(name)
    if (existing) return existing

    const made = children(this.element, name).map((found) => {
      this.#read.add(found)
      return new ElementReader(found)
    })
    this.#blocks.set(name, made)
    return made
  }

  /**
   * Accounts for a child without reading one, for the few places where it is
   * carried over by some other means. Every call needs a comment saying which.
   */
  skip(...names: readonly string[]): void {
    for (const found of this.element.children) {
      if (names.includes(found.name)) this.#read.add(found)
    }
  }

  /** Everything this reader never looked at, reported as a loss. */
  reportUnread(warnings: WarningCollector, context: WarningContext): void {
    for (const found of this.element.children) {
      if (this.#read.has(found)) continue
      const loss = elementLoss(found.name)
      warnings.add(
        loss.code,
        `<${found.name}> ${loss.ending}`,
        { ...context, line: found.line },
        found.name,
      )
    }
    for (const blocks of this.#blocks.values()) {
      for (const block of blocks) block.reportUnread(warnings, context)
    }
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
