// Reading a <wedge>: one edge of a hairpin.

import type { Fraction } from '../fraction.js'
import type { WedgeType } from '../model/score.js'
import { writtenAt } from './collector.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import { nienteOutOfPlace } from './spanners.js'
import type { OpenHairpin, WedgeStop } from './spanners.js'
import type { PartState } from './state.js'
import { entriesOf } from './tables.js'

// MusicXML's wedge types, in MNX's. A hairpin opening to the right gets
// louder; one closing gets softer.
const MUSICXML_WEDGES: Record<WedgeType, string> = {
  increasing: 'crescendo',
  decreasing: 'diminuendo',
}

// The same table the way it is read: MusicXML's word to the model's.
const WEDGE_TYPES = new Map<string, WedgeType>(
  entriesOf(MUSICXML_WEDGES).map(([shape, spelling]) => [spelling, shape]),
)

/**
 * Which edge of a hairpin a <wedge> marked. Wording written beside a start
 * goes on the hairpin. Wording beside a stop waits on the stop until the
 * pairing names the hairpin.
 */
export type WedgeReading =
  { edge: 'start'; hairpin: OpenHairpin } | { edge: 'stop'; stop: WedgeStop }

/**
 * A hairpin: a dynamic that grows or fades from here to somewhere later,
 * often several measures away. MusicXML marks both ends and numbers them so
 * they can be matched, as it does a slur, and MNX states the pair
 * once, on the end where it begins. A stop hands back the stop itself, which
 * wording written there can qualify. A wedge that converts to nothing reads
 * as nothing.
 */
export function readWedge(
  found: XmlElement,
  position: Fraction,
  overGrace: number,
  measure: number,
  slot: number,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): WedgeReading | undefined {
  const type = attribute(found, 'type')
  const number = attribute(found, 'number') ?? '1'
  // A hairpin is reported long after this, when the part is whole and the
  // pairing finds an edge with nothing to join it to, so the <wedge> is
  // recorded with the edge.
  const where = writtenAt(found, context, warnings)

  if (type === 'stop') {
    // Grace notes written before the stop are drawn under the hairpin. Which
    // of them it ends on is settled once the measure is whole, because the
    // ones read after it decide how MNX numbers the ones read before it.
    const stop = state.spanners.stopWedge(number, measure, position, overGrace, staff, where)
    // What a niente here means depends on the hairpin it closes, which the
    // pairing settles.
    if (readNiente(found, warnings, context)) stop.niente = true
    return { edge: 'stop', stop }
  }

  const wedge = type === undefined ? undefined : WEDGE_TYPES.get(type)
  if (!wedge) {
    // "continue" marks a point partway along a hairpin, which MNX has no need
    // of, since it states only where one begins and ends.
    if (type === 'continue') {
      if (readNiente(found, warnings, context)) {
        warnings.add(
          'unresolved:attribute-value',
          nienteOutOfPlace('partway along a hairpin'),
          context,
          found,
          'niente',
        )
      }
    } else {
      // Not carried over with the rest of the hairpin, which is reported whole.
      attribute(found, 'niente')
      warnings.addUndefinedAttribute(
        found,
        'type',
        'so the whole hairpin is not carried over.',
        context,
      )
      // The stop the source wrote for this hairpin goes with it, unreported: a
      // stop states its type as the word "stop", handled above, so an unknown
      // type can only be meant as a start.
      state.spanners.dropWedgeStart(number, measure, position, staff, where)
    }
    return undefined
  }

  // A hairpin states no value of its own: what it grows from and to is said
  // by the plain marks around it. A crescendo from niente is the exception.
  const niente = readNiente(found, warnings, context)
  const hairpin: OpenHairpin = {
    measure,
    position,
    wedge,
    ...(niente && wedge === 'increasing' ? { value: 'n' } : {}),
    ...(niente && wedge === 'decreasing' ? { nienteAt: where } : {}),
    staff,
    ...(placement !== undefined ? { placement } : {}),
    slot,
  }
  state.spanners.startWedge(hairpin, number, where)
  return { edge: 'start', hairpin }
}

/**
 * Whether a <wedge> draws the circle of niente at its point. A crescendo's
 * point is where it starts, and a diminuendo's is where it ends.
 */
function readNiente(
  found: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): boolean {
  const niente = attribute(found, 'niente')
  if (niente === undefined || niente === 'no') return false
  if (niente === 'yes') return true
  warnings.addUndefinedAttribute(
    found,
    'niente',
    'so the hairpin is drawn without the circle.',
    context,
  )
  return false
}
