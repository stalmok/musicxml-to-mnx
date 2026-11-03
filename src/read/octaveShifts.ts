// Reading an <octave-shift>: a stretch drawn an octave or more from where it
// sounds.

import type { Fraction } from '../fraction.js'
import type { OttavaAmount } from '../model/score.js'
import { writtenAt } from './collector.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import { parseWholeNumber } from './numbers.js'
import type { PartState } from './state.js'

// How far MusicXML's octave-shift sizes move the music, in octaves, each way
// the shift can go. The numbers are the ones written on the page: 8va is one
// octave, 15ma two. MNX states the other direction as a negative amount.
// Both are written out, not negated at the call site, so each value stays in
// the model's union.
const SHIFT_SIZES = new Map<number, Record<'up' | 'down', OttavaAmount>>([
  [8, { down: 1, up: -1 }],
  [15, { down: 2, up: -2 }],
  [22, { down: 3, up: -3 }],
])

/**
 * The amount a starting shift moves the music, or nothing where the type or
 * the size says none MNX can state, which is reported. MusicXML's size is a
 * whole number above zero, 8 where none is written, and allows spaces around
 * it. MNX shifts by one to three octaves.
 */
function startingShift(
  found: XmlElement,
  type: string | undefined,
  size: string | undefined,
  warnings: WarningCollector,
  context: ReportContext,
): OttavaAmount | undefined {
  const ending = 'so the whole shift is not carried over.'
  if (type !== 'up' && type !== 'down') {
    warnings.addUndefinedAttribute(found, 'type', ending, context)
    return undefined
  }
  const stated = size === undefined ? 8 : parseWholeNumber(size.trim())
  if (stated === undefined || stated < 1) {
    warnings.addUndefinedAttribute(found, 'size', ending, context)
    return undefined
  }
  const shift = SHIFT_SIZES.get(stated)
  if (!shift) {
    warnings.add(
      'unrepresentable:octave-shift-size',
      `An <octave-shift> of size ${String(stated)} cannot be expressed in MNX, which ` +
        `shifts by one to three octaves, ${ending}`,
      context,
      found,
      'size',
    )
    return undefined
  }
  return shift[type]
}

/**
 * An octave shift: a stretch drawn an octave or more from where it sounds, to
 * keep it off the ledger lines.
 *
 * The two specs state the sign in opposite terms. MusicXML's type is which
 * way the notes were moved to get them onto the staff, so 8va, where the
 * music sounds higher than it is drawn, is a shift "down". MNX's value is
 * how far the written pitch sits below the sounded one, so the same 8va is a
 * positive 1. Both formats put the sounding pitch on the notes, so nothing is
 * transposed; this says only how the passage is drawn.
 */
export function readOctaveShift(
  found: XmlElement,
  position: Fraction,
  cursor: Fraction,
  graceAtCursor: number,
  measure: number,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // Read before the edges split, because a stop or continue restates the
  // start's size and the shift's octaves come from the start alone.
  const size = attribute(found, 'size')
  // Recorded with the edge for the same reason a hairpin's is: the shift is
  // reported once the part is whole.
  const where = writtenAt(found, context, warnings)

  if (type === 'stop') {
    // Which event the shift ends on is settled once the measure is whole,
    // because a <backup> can write that event after this stop. It is read
    // from where the cursor stood, not from where an <offset> draws the stop:
    // an offset moves the sign on the page, not the music it covers.
    state.spanners.stopOttava(number, measure, position, cursor, graceAtCursor, staff, where)
    return
  }
  // "continue" marks a point partway along one, which MNX has no need of.
  if (type === 'continue') return

  const value = startingShift(found, type, size, warnings, context)
  if (value === undefined) {
    // The stop the source wrote for this shift goes with it, unreported: only
    // "stop" and "continue" are handled above, so an unknown type can only be
    // meant as a start.
    state.spanners.dropOttavaStart(number, measure, position, staff, where)
    return
  }

  state.spanners.startOttava(
    { measure, position, value, staff, ...(placement !== undefined ? { placement } : {}) },
    number,
    where,
  )
}
