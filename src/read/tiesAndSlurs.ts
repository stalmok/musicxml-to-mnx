// Reading the tie and slur starts and stops a note carries. Each goes to the
// part's spanner resolver, which pairs them once the whole part is read.

import type { Fraction } from '../fraction.js'
import type { CurveSide, KitNote, LineType, Note, TieTarget } from '../model/score.js'
import { writtenAt } from './collector.js'
import type { ReportContext, WarningCollector, WrittenAt } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import type { PartState } from './state.js'
import { recogniser } from './tables.js'
import { tieKey } from './spanners.js'
import type { PlacedEvent } from './voices.js'

/**
 * What a tie on this note pairs by: the pitch of a pitched note, and the kit
 * component struck for a note with no pitch to compare.
 */
export function tiePairing(note: Note | KitNote): string {
  return 'pitch' in note ? tieKey(note.pitch) : note.component
}

/**
 * A <tie> says a tie begins or ends on this note. A note in the middle of a
 * chain carries both, which is why every one of them is read.
 */
export function readTies(
  element: ElementReader,
  note: TieTarget,
  pairedBy: string,
  voice: string | undefined,
  measureIndex: number,
  at: Fraction,
  grace: boolean,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  tieds: readonly XmlElement[],
): void {
  state.spanners.sounding(pairedBy, voice, measureIndex, at, grace)
  const ties = element.children('tie')
  const side = startTiedSide(tieds)

  // A tie is reported once the part is whole, so the element each edge is
  // written with is recorded with the edge.
  for (const edge of tieEdges(ties, tieds, warnings, context)) {
    const where = edge.where
    if (edge.kind === 'stop') {
      state.spanners.stopTie(note, pairedBy, voice, edge.drawn, measureIndex, at, grace, where)
    } else {
      state.spanners.startTie(
        note,
        pairedBy,
        voice,
        side,
        edge.drawn,
        measureIndex,
        at,
        grace,
        where,
      )
    }
  }

  // A let-ring (l.v.) tie rings out with no ending note. MusicXML 4.0 states
  // it as type "let-ring" on <tied>. A <tie> of that type is read the same
  // way, though MusicXML allows only start and stop there. MNX states it as a
  // tie's `lv`, with no target.
  const letRing =
    ties.some((tie) => attribute(tie, 'type') === 'let-ring') ||
    tieds.some((tied) => attribute(tied, 'type') === 'let-ring')
  if (letRing) note.ties = [...note.ties, { kind: 'letRing' }]
}

/**
 * The tie edges a note carries, in the order they apply: a note in the middle
 * of a chain ends the tie before it and then starts the next.
 *
 * <tie> is the sounded tie and <tied> the drawn one, so a document stating
 * both is read from <tie>. A note that is not sounded, such as a cue, states
 * the tie in <tied> alone and is read from that instead. An edge is drawn
 * where the note states it in <tied>.
 */
function tieEdges(
  ties: readonly XmlElement[],
  tieds: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
): { kind: 'start' | 'stop'; where: WrittenAt; drawn: boolean }[] {
  // Each edge takes its place in the report as it is read, in document order.
  const starts: WrittenAt[] = []
  const stops: WrittenAt[] = []
  for (const tie of ties) {
    const type = attribute(tie, 'type')
    if (type === 'stop') stops.push(writtenAt(tie, context, warnings))
    else if (type === 'start') starts.push(writtenAt(tie, context, warnings))
    else if (type !== 'let-ring') {
      warnings.addUndefinedAttribute(tie, 'type', 'and is not carried over.', context)
    }
  }

  const tiedTypes = tieds.map((tied) => attribute(tied, 'type'))
  const drawnStart = tiedTypes.includes('start') || tiedTypes.includes('continue')
  const drawnStop = tiedTypes.includes('stop') || tiedTypes.includes('continue')

  // Read from <tied> only where no <tie> stated an edge. A note whose only
  // <tie> is a let-ring still states its drawn tie in <tied>.
  if (starts.length === 0 && stops.length === 0) {
    for (const tied of tieds) {
      const type = attribute(tied, 'type')
      // A "continue" is the middle of a chain, which <tie> writes as a stop
      // and a start on the one note.
      if (type === 'continue') {
        const where = writtenAt(tied, context, warnings)
        starts.push(where)
        stops.push(where)
      } else if (type === 'stop') stops.push(writtenAt(tied, context, warnings))
      else if (type === 'start') starts.push(writtenAt(tied, context, warnings))
      else if (type !== 'let-ring') {
        warnings.addUndefinedAttribute(tied, 'type', 'and is not carried over.', context)
      }
    }
  }

  // Every stop before every start, whichever order the document writes them
  // in. A note is the middle of a chain only one way round: it ends the tie
  // before it and then starts the next. Taken as written, a note stating its
  // start first would close that tie and be tied to itself.
  return [
    ...stops.map((where) => ({ kind: 'stop' as const, where, drawn: drawnStop })),
    ...starts.map((where) => ({ kind: 'start' as const, where, drawn: drawnStart })),
  ]
}

// The side a tie is drawn on, from its <tied> edges. MNX's tie states one
// side, on the note it starts from, so the start's statement is the tie's:
// a side stated on a stop is read and dropped, with the read accounting for
// the attributes. A "continue" starts the next tie of a chain, so its side is
// that tie's, as a start's is.
function startTiedSide(tieds: readonly XmlElement[]): CurveSide | undefined {
  let side: CurveSide | undefined
  for (const tied of tieds) {
    const stated = curveSide(tied)
    const type = attribute(tied, 'type')
    if (side === undefined && (type === 'start' || type === 'continue')) side = stated
  }
  return side
}

/**
 * Slurs are matched by the number the source gives them, across the part.
 *
 * Each end records where it stands, because the pairing runs once the whole
 * part is read rather than as the ends are met: a <backup> can write a stop
 * before the start the music puts first.
 */
export function readSlurs(
  notations: readonly ElementReader[],
  { event, start: at }: PlacedEvent,
  voice: string | undefined,
  measureIndex: number,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  grace: boolean,
): void {
  const slurs = notations.flatMap((block) => block.children('slur'))
  if (slurs.length === 0) return
  // Each <slur> takes its place in the report in document order, before the
  // stops are put first.
  const placed = slurs.map((slur) => writtenAt(slur, context, warnings))
  for (const where of stopsFirst(placed, (edge) => edge.element)) {
    const slur = where.element
    const type = attribute(slur, 'type')
    const number = attribute(slur, 'number') ?? '1'
    // Every edge is read for its side, so the attributes are accounted for
    // wherever the source writes them. Only the start's and the stop's go
    // anywhere: a "continue" edge's side has no home in MNX and is dropped.
    const side = curveSide(slur)
    if (type === 'stop') {
      state.spanners.stopSlur(event, number, side, voice, measureIndex, at, grace, where)
    } else if (type === 'start') {
      state.spanners.startSlur(
        event,
        number,
        side,
        slurLineType(slur),
        voice,
        measureIndex,
        at,
        grace,
        where,
      )
    } else if (type !== 'continue') {
      // "continue" marks a note partway along a slur. MNX states only where a
      // slur begins and ends, so there is nothing for it to carry, and
      // nothing is lost by passing over it.
      warnings.addUndefinedAttribute(slur, 'type', 'and is not carried over.', context)
    }
  }
}

/**
 * A note's slur edges with every stop before every start, whichever order the
 * document writes them in. A slur cannot start and end on one note, so a stop
 * closes a slur opened before the note, as a tie's does.
 */
export function stopsFirst<E>(edges: readonly E[], slurOf: (edge: E) => XmlElement): E[] {
  const isStop = (edge: E) => attribute(slurOf(edge), 'type') === 'stop'
  return [...edges.filter(isStop), ...edges.filter((edge) => !isStop(edge))]
}

// The side a slur or tie is drawn on. MusicXML states it two ways at once:
// orientation (over/under) is the curve itself, placement (above/below) only
// where the notation sits, so the orientation wins where they disagree and
// the placement stands in where the source states no orientation. Both are
// read off every edge either way.
function curveSide(element: XmlElement): CurveSide | undefined {
  const orientation = attribute(element, 'orientation')
  const placement = attribute(element, 'placement')
  if (orientation === 'over') return 'up'
  if (orientation === 'under') return 'down'
  if (placement === 'above') return 'up'
  if (placement === 'below') return 'down'
  return undefined
}

// MusicXML's line-type values are the same words MNX states, so a known one
// passes straight through; anything else leaves the slur drawn solid.
const isLineType = recogniser<LineType>({ dashed: true, dotted: true, solid: true, wavy: true })

function slurLineType(slur: XmlElement): LineType | undefined {
  const lineType = attribute(slur, 'line-type')
  return lineType !== undefined && isLineType(lineType) ? lineType : undefined
}
