// Dynamic wording: text such as "cresc." or "poco" written beside a dynamic
// mark. MNX states it only as the prefix or suffix of a mark.

import type { XmlElement } from '../xml/parse.js'
import { text } from '../xml/tree.js'
import { reportAt } from './collector.js'
import type { WarningCollector, WrittenAt } from './collector.js'

/** Dynamic wording, and where it is written so a report can point at it. */
export interface Wording {
  text: string
  where: WrittenAt
}

/**
 * Reports wording that qualifies no mark. MNX states wording only as the
 * prefix or suffix of a dynamic mark, and each kind of mark requires more
 * than its wording.
 */
export function reportLoneWording(wording: Wording, warnings: WarningCollector): void {
  reportAt(
    wording.where,
    'unrepresentable:dynamic-wording',
    `The dynamic wording "${wording.text}" qualifies no mark, and MNX states wording ` +
      'only on a mark, so it is not converted.',
    warnings,
  )
}

/**
 * The wording seen so far with no mark yet to qualify. A source writes "più
 * f" as the text and the mark side by side, sometimes in sibling <dynamics>
 * blocks or beside the <wedge> the words qualify, so the text is held for
 * the whole <direction-type> until the mark it opens arrives and becomes
 * that mark's prefix. Anything still held once the marks run out closes the
 * last one instead, as its suffix, or is reported where no mark takes it.
 * The element of each piece is held with it, so a report points at the
 * wording.
 *
 * Pieces are held as written and trimmed only once joined, so that the
 * source's own spacing decides where the words run together: "sempre " and
 * "più " make "sempre più", while "s" and "morz." make "smorz.".
 */
export class PendingWording {
  #pieces: XmlElement[] = []

  push(piece: XmlElement): void {
    this.#pieces.push(piece)
  }

  take(): { text: string; element: XmlElement } | undefined {
    const first = this.#pieces[0]
    if (first === undefined) return undefined
    const held = {
      text: this.#pieces
        .map((piece) => text(piece))
        .join('')
        .trim(),
      element: first,
    }
    this.#pieces = []
    return held
  }
}
