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
import { child, children } from '../xml/tree.js'
import { elementLoss } from './unrepresentable.js'

export class ElementReader {
  readonly element: XmlElement
  readonly #read = new Set<string>()
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
    this.#read.add(name)
    return child(this.element, name)
  }

  children(name: string): readonly XmlElement[] {
    this.#read.add(name)
    return children(this.element, name)
  }

  /**
   * Readers over every child of this name, for elements that hold notation of
   * their own. Their unread children are reported along with this one's.
   */
  blocks(name: string): readonly ElementReader[] {
    const existing = this.#blocks.get(name)
    if (existing) return existing

    this.#read.add(name)
    const made = children(this.element, name).map((found) => new ElementReader(found))
    this.#blocks.set(name, made)
    return made
  }

  /**
   * Accounts for a child without reading one, for the few places where it is
   * carried over by some other means. Every call needs a comment saying which.
   */
  skip(...names: readonly string[]): void {
    for (const name of names) this.#read.add(name)
  }

  /** Everything this reader never looked at, reported as a loss. */
  reportUnread(warnings: WarningCollector, context: WarningContext): void {
    for (const found of this.element.children) {
      if (this.#read.has(found.name)) continue
      const loss = elementLoss(found.name)
      warnings.add(loss.code, `<${found.name}> ${loss.ending}`, {
        ...context,
        line: found.line,
      })
    }
    for (const blocks of this.#blocks.values()) {
      for (const block of blocks) block.reportUnread(warnings, context)
    }
  }
}
