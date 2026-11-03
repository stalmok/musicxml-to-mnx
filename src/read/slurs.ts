// Joining up the two ends of a slur.
//
// MusicXML marks both ends and numbers them. MNX states the slur once, on the
// event where it begins, pointing at the id of the event where it ends.

import type { Fraction } from '../fraction.js'
import type { CurveSide, Event, LineType } from '../model/score.js'
import { reportAt } from './collector.js'
import type { WarningCollector, WrittenAt } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'
import { inTimeOrder, pairSpans, voiceKey } from './spanPairing.js'
import type { DroppedStopEnd, SpanEnd, StopEnd } from './spanPairing.js'

/** A slur that has begun, waiting to learn which event ends it. */
interface OpenSlur {
  event: Event
  side: CurveSide | undefined
  lineType: LineType | undefined
}

/** Where a slur ends. */
interface SlurStopAt {
  event: Event
  /** The side the slur bends to at its close, for an S-shaped one. */
  sideEnd: CurveSide | undefined
}

/**
 * One end of a slur: a start carries the slur it opens, and a stop names the
 * event it is written on. An end on a rest no note value writes has no event
 * to name, and is dropped.
 */
export type SlurEnd = SpanEnd<OpenSlur, SlurStopAt> | DroppedStopEnd
type SlurStart = Extract<SlurEnd, { kind: 'start' }>
type SlurStop = Extract<SlurEnd, { kind: 'stop' }>

/**
 * Whether a stream of ends, all of one voice and one slur number, accounts
 * for itself: it opens each slur before closing it and leaves none over. Such
 * a stream is the voice's own, because a measure is written one voice at a
 * time, so within a voice the document's order is the music's.
 *
 * Exported for its own test. A test through a whole score cannot see its
 * answers, because the pass across the part mostly reaches the same joins.
 */
export function accountsForItself(ends: readonly SlurEnd[]): boolean {
  let open = 0
  for (const end of inTimeOrder(ends, 'as-written')) {
    if (end.kind === 'start') {
      open += 1
      // A voice nesting two slurs of one number says nothing about which
      // stop closes which, so it is not accounting for them either.
      if (open > 1) return false
      continue
    }
    if (open === 0) return false
    open -= 1
  }
  return open === 0
}

/**
 * Whether a voice's ends of one slur number, within one measure, leave an
 * end over: an unclosed start, an orphan stop, or one of each. A measure is
 * written one voice at a time, so this is the same reading as
 * accountsForItself, narrowed to what happens inside a single measure.
 *
 * Exported for its own test, as accountsForItself is.
 */
export function measureResidue(ends: readonly SlurEnd[]): 'unclosed' | 'orphan' | 'both' | 'none' {
  let open = 0
  let orphaned = false
  for (const end of inTimeOrder(ends, 'as-written')) {
    if (end.kind === 'start') {
      open += 1
      continue
    }
    if (open === 0) orphaned = true
    else open -= 1
  }
  if (orphaned && open > 0) return 'both'
  if (orphaned) return 'orphan'
  if (open > 0) return 'unclosed'
  return 'none'
}

/**
 * The pairs a stream that accounts for itself joins. Safe only where
 * accountsForItself is true: nesting never goes past one deep, so each start
 * closes on the very next stop.
 */
function ownPairs(ends: readonly SlurEnd[]): { start: SlurStart; stop: SlurStop }[] {
  const pairs: { start: SlurStart; stop: SlurStop }[] = []
  let open: SlurStart | undefined
  for (const end of inTimeOrder(ends, 'as-written')) {
    if (end.kind === 'start') {
      open = end
      continue
    }
    /* v8 ignore next -- accountsForItself already guarantees every stop
       closes an open start. */
    if (open) pairs.push({ start: open, stop: end })
    open = undefined
  }
  return pairs
}

/**
 * The voice-and-number streams that are not treated as a voice's own, even
 * where accountsForItself says they balance. A stream is excluded when another
 * voice's leftover ends of the same number confirm a crossing at both ends of
 * one of its pairs: an orphan stop in the measure of the pair's start or the
 * one after, and an unclosed start in the measure of the pair's stop or the one
 * before.
 *
 * Two separate cross-voice slurs reusing a number can leave a stream with one
 * start and one stop of its own that are not one slur. Such a stream goes to
 * the pass across the part.
 *
 * Both ends are required, because a voice's own slur often runs past a stray
 * end in another voice. One-sided evidence would send it to the pass across
 * the part, where the nearer stray end would win over its real partner.
 */
function crossesVoicesInAMeasure(ends: readonly SlurEnd[]): ReadonlySet<string> {
  const byNumber = new Map<string, SlurEnd[]>()
  for (const end of ends) {
    byNumber.set(end.number, [...(byNumber.get(end.number) ?? []), end])
  }

  const crossing = new Set<string>()
  for (const [number, numberEnds] of byNumber) {
    const byVoice = new Map<string | undefined, SlurEnd[]>()
    for (const end of numberEnds) {
      byVoice.set(end.voice, [...(byVoice.get(end.voice) ?? []), end])
    }

    // Every other voice's leftover ends for this number, at the measure it
    // falls in, so a pair's own boundaries can be checked against it directly.
    const residueAt = new Map<string | undefined, Map<number, 'unclosed' | 'orphan' | 'both'>>()
    for (const [voice, voiceEnds] of byVoice) {
      const byMeasure = new Map<number, SlurEnd[]>()
      for (const end of voiceEnds) {
        byMeasure.set(end.measure, [...(byMeasure.get(end.measure) ?? []), end])
      }
      const perMeasure = new Map<number, 'unclosed' | 'orphan' | 'both'>()
      for (const [measure, atMeasure] of byMeasure) {
        const residue = measureResidue(atMeasure)
        if (residue !== 'none') perMeasure.set(measure, residue)
      }
      residueAt.set(voice, perMeasure)
    }

    const nearbyResidue = (
      exceptVoice: string | undefined,
      measures: readonly number[],
      kinds: readonly ('unclosed' | 'orphan' | 'both')[],
    ): boolean =>
      [...residueAt.entries()].some(
        ([voice, perMeasure]) =>
          voice !== exceptVoice &&
          measures.some((measure) => {
            const found = perMeasure.get(measure)
            return found !== undefined && kinds.includes(found)
          }),
      )

    for (const [voice, voiceEnds] of byVoice) {
      if (!accountsForItself(voiceEnds)) continue
      for (const pair of ownPairs(voiceEnds)) {
        const confirmedAtStart = nearbyResidue(
          voice,
          [pair.start.measure, pair.start.measure + 1],
          ['orphan', 'both'],
        )
        const confirmedAtStop = nearbyResidue(
          voice,
          [pair.stop.measure, pair.stop.measure - 1],
          ['unclosed', 'both'],
        )
        if (confirmedAtStart && confirmedAtStop) crossing.add(voiceKey(voice, number))
      }
    }
  }
  return crossing
}

// Slurs are matched on the number the source gives them, across the whole
// part. In piano writing a slur often runs from one hand to the other, which
// is a different voice and a different staff. Several slurs may share a
// number, and a stop closes the most recently opened one.

export class SlurResolver implements PartCollector {
  // Both ends of every slur in the part, paired once all of them are in.
  readonly #slurEnds: SlurEnd[] = []

  /** Notes the event a slur begins on, to be paired once the part is read. */
  startSlur(
    event: Event,
    number: string,
    side: CurveSide | undefined,
    lineType: LineType | undefined,
    voice: string | undefined,
    measure: number,
    position: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    this.#slurEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: { event, side, lineType },
      where,
    })
  }

  /** The same, for the event a slur ends on. */
  stopSlur(
    event: Event,
    number: string,
    sideEnd: CurveSide | undefined,
    voice: string | undefined,
    measure: number,
    position: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    this.#slurEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      voice,
      grace,
      covers: position,
      where,
      stop: { event, sideEnd },
    })
  }

  /**
   * Notes a slur end the reader dropped and already reported, so it still
   * closes or opens its slur in pairing.
   */
  dropSlurEnd(
    kind: 'start' | 'stop',
    number: string,
    voice: string | undefined,
    measure: number,
    position: Fraction,
    where: WrittenAt,
  ): void {
    this.#slurEnds.push({
      kind,
      number,
      measure,
      position,
      voice,
      covers: position,
      dropped: true,
      where,
    })
  }

  /**
   * Joins every slur in the part, once both ends of all of them are in.
   *
   * Paired in time order, not as the ends are met, because a measure holding
   * two voices is written one voice at a time with a <backup> between them.
   * A slur from the second voice to the first has its stop written before its
   * start.
   *
   * A voice keeps its own slurs of one number only where its ends account for
   * each other: it opens each before closing it, leaves none over, and no
   * other voice confirms a crossing (see crossesVoicesInAMeasure). A measure
   * is written one voice at a time, so such a stream is that voice's own.
   * Exporters reuse one number in every voice.
   *
   * Everything else joins one stream for the whole part. A voice that leaves
   * an end over has a slur that runs into another voice. Paired on its own,
   * it could take a same-voice stop any distance away over the cross-voice
   * stop in the next measure.
   */
  #resolveSlurs(warnings: WarningCollector): void {
    // A slur's two ends mark the very points they are written on, so no stop
    // covers a point before its start; the backwards message is here for the
    // shape of the report, as an octave shift's is.
    const messages = {
      'orphan-stop': 'A slur ends where none had started, and is not carried over.',
      'backwards-stop': 'A slur would end before it starts, and is not carried over.',
      'unclosed-start': 'A slur starts where nothing ends it, and is not carried over.',
    }
    const join = (open: OpenSlur, end: StopEnd<SlurStopAt>): void => {
      const sideEnd = end.stop.sideEnd
      open.event.slurs = [
        ...open.event.slurs,
        {
          target: end.stop.event.id,
          side: open.side,
          // MNX's sideEnd is for an S-shaped slur that ends bending the other
          // way. A stop that restates the start's side adds nothing.
          ...(sideEnd !== undefined && sideEnd !== open.side ? { sideEnd } : {}),
          ...(open.lineType !== undefined ? { lineType: open.lineType } : {}),
        },
      ]
    }

    const streams = new Map<string, SlurEnd[]>()
    for (const end of this.#slurEnds) {
      const key = voiceKey(end.voice, end.number)
      streams.set(key, [...(streams.get(key) ?? []), end])
    }

    // What a stream cannot account for waits for the pass across the part
    // rather than being reported: another voice may well close it. So does a
    // stream that only balances by coincidence, where another voice states
    // the same number crossing into it within one measure.
    const crossing = crossesVoicesInAMeasure(this.#slurEnds)
    const spare = new Set<SlurEnd>()
    const ownEnds: SlurEnd[][] = []
    for (const [key, ends] of streams) {
      if (accountsForItself(ends) && !crossing.has(key)) ownEnds.push(ends)
      else for (const end of ends) spare.add(end)
    }
    // A stream that accounts for itself opens each slur before closing it and
    // leaves none over, so ownPairs reads its pairs straight off it. There is
    // nothing left over for the pass across the part, and nothing to report.
    for (const ends of ownEnds) {
      for (const { start, stop } of ownPairs(ends)) {
        // The drop was reported where the end was read.
        if (!start.dropped && !stop.dropped) join(start.payload, stop)
      }
    }

    // Back in the order the document has, because the streams gave their ends
    // up a stream at a time. A grace note begins where the note it ornaments
    // begins, so a slur between the two has both ends at one point.
    pairSpans<OpenSlur, SlurStopAt>(
      this.#slurEnds.filter((end) => spare.has(end)),
      join,
      (reason, end) => {
        reportAt(end.where, 'unclosed:spanner', messages[reason], warnings)
      },
      'as-written',
    )
    this.#slurEnds.length = 0
  }

  /** Joins every slur in the part, and reports what stays unpaired. */
  finish(_measures: readonly PartMeasure[], warnings: WarningCollector): void {
    this.#resolveSlurs(warnings)
  }
}
