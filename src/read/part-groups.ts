// Reads the <part-group> edges of a part list into the score's instrument
// grouping: a tree of groups drawn with brackets or braces around parts, in
// document order. Two edges pair by number, like other paired markers, and
// groups nest by where their edges fall between the score-parts.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { GroupingItem, PartGroup } from '../model/score.js'
import type { WarningCollector } from '../warnings.js'
import { attribute, requireAttribute, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { drawnName } from './element.js'

/** A part group whose stop has not arrived yet. */
interface OpenPartGroup {
  number: string
  symbol: PartGroup['symbol']
  label: string | undefined
  barlineStyle: PartGroup['barlineStyle']
  content: GroupingItem[]
  /** Where the start edge is written, for reporting a stop that never comes. */
  line: number
  /** Set once a crossing stop was reported, so the close is not reported twice. */
  crossed?: boolean
}

/**
 * Builds the grouping while the part list is walked: score-parts and group
 * edges arrive in document order, and a group's members are whatever falls
 * between its two edges.
 */
export class GroupingBuilder {
  readonly #top: GroupingItem[] = []
  readonly #open: OpenPartGroup[] = []
  #groups = 0

  // Into the innermost group whose stop has not arrived, like the source's
  // own nesting.
  #place(item: GroupingItem): void {
    ;(this.#open.at(-1)?.content ?? this.#top).push(item)
  }

  /** A <score-part>, in document order. */
  part(id: string): void {
    this.#place({ kind: 'part', part: id })
  }

  /** A <part-group> edge, in document order. */
  edge(group: ElementReader, warnings: WarningCollector, path: DocumentPath): void {
    const element = group.element
    // The type pairs the edges, so an edge without one, or with one that
    // names neither edge, is structurally broken.
    const type = requireAttribute(element, 'type', path)
    const number = attribute(element, 'number') ?? '1'
    if (type === 'start') {
      this.#open.push({
        number,
        symbol: groupSymbolOf(group, warnings),
        label: drawnName(group, 'group-name'),
        barlineStyle: groupBarlineOf(group, warnings),
        content: [],
        line: element.line,
      })
    } else if (type === 'stop') {
      this.#stop(number, element.line, warnings)
    } else {
      throw new MusicXMLError(`A <part-group> type must be "start" or "stop", found "${type}".`, {
        path: [...path, 'part-group'],
        line: element.line,
      })
    }
  }

  #stop(number: string, line: number, warnings: WarningCollector): void {
    if (this.#open.at(-1)?.number === number) {
      const closed = this.#open.pop()
      if (closed) {
        this.#place(closedGroup(closed))
        this.#groups += 1
      }
      return
    }
    const crossed = [...this.#open].reverse().find((entry) => entry.number === number)
    if (crossed) {
      // The stop arrives while a group started after this one is still open,
      // so their edges cross. MusicXML allows that; MNX's layout tree cannot
      // hold it, so this group runs to the end of the part list instead.
      crossed.crossed = true
      warnings.add(
        'unrepresentable:part-group-overlap',
        'The edges of two part groups cross, which an MNX layout cannot hold. The ' +
          'one stopping here runs to the end of the part list instead.',
        { line },
        'part-group',
      )
    } else {
      warnings.add(
        'unclosed:part-group',
        'A part group stops where none had started, and draws nothing.',
        { line },
        'part-group',
      )
    }
  }

  /**
   * Closes what is still open and hands the grouping over. A grouping without
   * a single group says nothing a plain part list does not, so none is kept.
   */
  finish(warnings: WarningCollector): readonly GroupingItem[] {
    // A group whose stop never arrives runs to the end of the list. Innermost
    // first, so nesting survives the close.
    for (let closed = this.#open.pop(); closed; closed = this.#open.pop()) {
      if (!closed.crossed) {
        warnings.add(
          'unclosed:part-group',
          'A part group starts where nothing stops it, and runs to the end of the part list.',
          { line: closed.line },
          'part-group',
        )
      }
      this.#place(closedGroup(closed))
      this.#groups += 1
    }
    return this.#groups > 0 ? this.#top : []
  }
}

/**
 * The grouping with only parts the score wrote, so no staff of a layout
 * points at a part that does not exist, and without groups left empty, which
 * would draw a bracket around nothing. With no group left at all, the whole
 * grouping goes: a layout of bare staves states nothing the part list does
 * not.
 */
export function pruneGrouping(
  items: readonly GroupingItem[],
  written: ReadonlySet<string>,
  lines: ReadonlyMap<string, number>,
  warnings: WarningCollector,
): readonly GroupingItem[] {
  const pruned = prunedItems(items, written, lines, warnings)
  return pruned.some((item) => item.kind === 'group') ? pruned : []
}

function prunedItems(
  items: readonly GroupingItem[],
  written: ReadonlySet<string>,
  lines: ReadonlyMap<string, number>,
  warnings: WarningCollector,
): GroupingItem[] {
  return items.flatMap((item): GroupingItem[] => {
    if (item.kind === 'part') {
      if (written.has(item.part)) return [item]
      const line = lines.get(item.part)
      warnings.add(
        'unresolved:part-id',
        `The part list names part ${item.part}, but the score never writes it, ` +
          'so no staff of it is drawn.',
        { part: item.part, ...(line !== undefined ? { line } : {}) },
        'score-part',
      )
      return []
    }
    const content = prunedItems(item.content, written, lines, warnings)
    // A group around nothing draws nothing, so leaving it out loses nothing.
    if (content.length === 0) return []
    return [{ ...item, content }]
  })
}

/** The group as the model holds it, without the number that paired its edges. */
function closedGroup(open: OpenPartGroup): GroupingItem {
  return {
    kind: 'group',
    symbol: open.symbol,
    label: open.label,
    barlineStyle: open.barlineStyle,
    content: open.content,
  }
}

/**
 * The symbol a group is drawn with. MusicXML's default is "none", which MNX
 * spells "noSymbol". A <part-group> holds at most one <group-symbol>, so
 * child() is correct.
 */
function groupSymbolOf(group: ElementReader, warnings: WarningCollector): PartGroup['symbol'] {
  const element = group.child('group-symbol')
  const text = element ? trimmedText(element) : 'none'
  if (text === 'bracket' || text === 'brace') return text
  if (text === 'none' || text === '') return 'noSymbol'
  if (text === 'line' || text === 'square') {
    // Real symbols with no MNX spelling: the group is kept, with no symbol
    // stated rather than one the source did not draw.
    warnings.add(
      'unrepresentable:group-symbol',
      `A part group is drawn with a "${text}" symbol, which MNX cannot state. ` +
        'The group is kept with no symbol.',
      { line: element?.line ?? group.element.line },
      'group-symbol',
    )
    return undefined
  }
  // Anything else is not a symbol MusicXML names, so it is invalid input
  // rather than a format limit.
  warnings.add(
    'unsupported:element',
    `A <group-symbol> of "${text}" is not converted yet.`,
    { line: element?.line ?? group.element.line },
    'group-symbol',
  )
  return undefined
}

/**
 * How barlines run through the group. A <part-group> holds at most one
 * <group-barline>, so child() is correct.
 */
function groupBarlineOf(
  group: ElementReader,
  warnings: WarningCollector,
): PartGroup['barlineStyle'] {
  const element = group.child('group-barline')
  if (!element) return undefined
  const text = trimmedText(element)
  if (text === 'yes') return 'unified'
  if (text === 'no') return 'individual'
  if (text === 'Mensurstrich') return 'mensurstrich'
  warnings.add(
    'unsupported:element',
    `A <group-barline> of "${text}" is not converted yet.`,
    { line: element.line },
    'group-barline',
  )
  return undefined
}
