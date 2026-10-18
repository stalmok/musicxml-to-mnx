// The key and time signatures a part carries from one measure to the next.
// Also how a key and a time signature are compared, and the report of one
// stated after a measure's start, which signatures.ts uses as well.
// signatures.ts settles each measure against this state.

import type { Key, TimeSignature } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'

/** What reports and compares a key or a time signature stated late. */
export interface SignatureKind<T> {
  element: 'key' | 'time'
  /** What to call one of these in a report, where "key" alone is too short. */
  name: 'key' | 'time signature'
  /** Whether a statement says what another says, down to how it is drawn. */
  same: (a: T, b: T | undefined) => boolean
  /**
   * Whether two staves are in the same signature. Looser than `same` for a
   * time signature: 4/4 as a C and 4/4 as numbers are one meter drawn two
   * ways, which is not the staves disagreeing about the meter.
   */
  agrees: (a: T, b: T | undefined) => boolean
}

export function sameMeter(a: TimeSignature, b: TimeSignature): boolean {
  return a.count === b.count && a.unit === b.unit
}

function sameTime(a: TimeSignature, b: TimeSignature | undefined): boolean {
  return b !== undefined && sameMeter(a, b) && a.display === b.display
}

const sameFifths = (a: Key, b: Key | undefined): boolean => b !== undefined && a.fifths === b.fifths

export const KEY: SignatureKind<Key> = {
  element: 'key',
  name: 'key',
  same: sameFifths,
  agrees: sameFifths,
}

export const TIME: SignatureKind<TimeSignature> = {
  element: 'time',
  name: 'time signature',
  same: sameTime,
  agrees: (a, b) => b !== undefined && sameMeter(a, b),
}

/**
 * A key or time signature a measure stated after its start, held for the next
 * one.
 */
export interface HeldSignature<T> {
  value: T
  partway: boolean
  context: ReportContext
  /** The <key> or <time> stating it. */
  element: XmlElement
}

/**
 * The key and time signature state a part carries from one measure to the
 * next. MNX states a signature only where a measure begins, so one stated
 * after a measure's start is held, and the next measure takes it unless it
 * states its own. Where it was stated partway through the measure rather than
 * after its notes, the move is a loss.
 */
export class PartSignatures implements PartCollector {
  /**
   * The key and time signature MNX has in force after the measures read so
   * far. A statement after a measure's start is compared with these rather
   * than with what the source last stated, because the source can state one
   * that is not converted, such as a second one at the measure start.
   */
  convertedKey: Key | undefined
  convertedTime: TimeSignature | undefined
  /**
   * The key and time signature each staff of the part has in force, as the
   * source states them, keyed by staff number. MusicXML states one per staff
   * and MNX states one for the score, so only a staff given one of its own is
   * reported as a loss. A key is held as it sounds, so a part that changes its
   * transposition still compares sounding keys.
   */
  readonly staffKeys = new Map<number, Key | undefined>()
  readonly staffTimes = new Map<number, TimeSignature | undefined>()
  /** The key and time signature the measure last read stated after its start. */
  heldKey: HeldSignature<Key> | undefined
  heldTime: HeldSignature<TimeSignature> | undefined

  /**
   * Reports a signature the part's last measure stated after its start,
   * which no measure is left to take.
   */
  finish(_measures: readonly PartMeasure[], warnings: WarningCollector): void {
    const outcome = 'This is the last measure of the part, so it is not converted.'
    if (this.heldKey) reportLate(KEY, this.heldKey, outcome, warnings)
    if (this.heldTime) reportLate(TIME, this.heldTime, outcome, warnings)
  }
}

export function reportLate<T>(
  kind: SignatureKind<T>,
  late: HeldSignature<T>,
  outcome: string,
  warnings: WarningCollector,
): void {
  warnings.add(
    `unrepresentable:mid-measure-${kind.element}`,
    `A ${kind.element} signature is stated ${late.partway ? 'partway through' : 'at the end of'} this ` +
      `measure, and MNX states one only where a measure begins. ${outcome}`,
    late.context,
    late.element,
  )
}
