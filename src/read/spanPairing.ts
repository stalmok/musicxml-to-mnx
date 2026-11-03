// Joining the two ends of something that spans a stretch of music, in the
// order the music has them rather than the order the document writes them.

import { compareFractions, isZero } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { WrittenAt } from './collector.js'

/** Where an end of a span is written, and what it marks, whichever end it is. */
export interface EndPlace {
  /** What the source numbers it, so two open at once can be told apart. */
  number: string
  /** Where in the score: a measure's place in the part, and a point in it. */
  measure: number
  /** Where it is written, which is what puts the ends in order. */
  position: Fraction
  /**
   * The place it marks. The two differ for the stop of an octave
   * shift: MNX states the end as the place of the last event covered, and
   * MusicXML writes the stop after that event. Ordering must still use where
   * the stop was written, or it would sort before the start it belongs to.
   */
  covers: Fraction
  /**
   * Which grace note at that place it marks, where grace notes sit there.
   * Counted back from the note they ornament, as MNX counts: that note is 0
   * and the rightmost grace note is 1. Unset where the place has no grace
   * notes, which reads as before all of them.
   */
  coversGraceIndex?: number
  /**
   * The measure of the place it marks, where that is not the measure it is
   * written in. An octave shift stopped before any event of its measure
   * covers the last event before the barline.
   */
  coversMeasure?: number
  /**
   * How many grace notes stood where a stop was written, at the point it was
   * written. The grace notes read after it belong on the far side of it, so
   * the index above cannot be settled until the measure is whole.
   */
  graceWritten?: number
  /**
   * Whether it is written at the end of its measure, the instant the next
   * measure begins. Settled once the measure is whole, and only for a hairpin.
   */
  atBarline?: boolean
  /**
   * The voice it is written in, where the thing has one. A stop takes the
   * open start of its own voice before any other, because exporters number a
   * slur within the voice they write it in and reuse the number in every
   * voice. A hairpin and an octave shift belong to the staff rather than a
   * voice and leave this unset; the staff below is what separates their ends.
   */
  voice?: string | undefined
  /**
   * The staff the source states on it, where it states one. A stop takes the
   * open start of its own staff before any other, the way a slur's stop takes
   * its own voice: an exporter that numbers each hand from 1 has both hands
   * holding a hairpin numbered 1 at once. An octave shift's stop also uses it
   * to read its end from its own staff's events. Left unset where the source
   * states none, which is not read as the first staff.
   */
  staff?: number | undefined
  /**
   * Whether the event it sits on is a grace note. A grace note sounds before
   * the beat, so its end comes first among the ends at one point, whichever
   * order the document writes them in.
   */
  grace?: boolean
  where: WrittenAt
}

/** A start, carrying what it opens, handed back when its stop is found. */
export interface StartEnd<T> extends EndPlace {
  kind: 'start'
  payload: T
  dropped?: undefined
}

/**
 * A start the reader dropped and already reported. It still takes its place
 * in pairing, so the stop the source wrote for it is consumed with it, not
 * reported as an orphan.
 */
export interface DroppedStartEnd extends EndPlace {
  kind: 'start'
  dropped: true
}

/** A stop, carrying what the join needs from the place it is written. */
export interface StopEnd<S> extends EndPlace {
  kind: 'stop'
  stop: S
  dropped?: undefined
}

/**
 * A stop the reader dropped and already reported. It still closes the start
 * it pairs with, so that start takes no later stop.
 */
export interface DroppedStopEnd extends EndPlace {
  kind: 'stop'
  dropped: true
}

/**
 * One end of something that spans a stretch of music: a tie, a slur, a
 * hairpin, an octave shift.
 *
 * These cannot be paired up as they are met, because MusicXML's document
 * order is not time order: a measure holding two voices is written as one
 * pass per voice with a <backup> between them, so a stop belonging to the
 * first voice is written before a start belonging to the second even though
 * the music has it the other way round.
 */
export type SpanEnd<T, S> = StartEnd<T> | DroppedStartEnd | StopEnd<S>

/**
 * How two ends falling at one point are ordered.
 *
 * A direction closes before the next one opens, so its stop goes first. A
 * slur is written on an event, and a grace note begins where the note it
 * ornaments begins, so a slur from the one to the other has both ends at one
 * point. There the document says which end is which.
 */
export type SamePoint = 'stop-first' | 'as-written'

/**
 * Which open start of its number a stop closes, for a span the rules of
 * pairSpans do not fit. A stop takes the most recently opened start it
 * `owns` and `prefers`, then the most recently opened one it owns, and where
 * it owns none, the most recently opened one it `reaches`.
 */
interface Claim<P extends EndPlace> {
  prefers: (start: P, stop: P) => boolean
  owns: (start: P, stop: P) => boolean
  reaches: (start: P, stop: P) => boolean
}

/**
 * Joins each span's two ends, in the order the music has them: by measure,
 * then by where in the measure the cursor had reached. Ends falling at the
 * same point are ordered as `atSamePoint` says, and otherwise keep the order
 * they were read in.
 *
 * Several may carry the same number at once, so each number holds a stack. A
 * stop closes the most recently opened start in the same voice and staff,
 * and where that has none open, the most recently opened of any. The first
 * rule keeps two voices or two hands, each holding a span numbered 1, from
 * closing into each other. The fallback lets a span one voice opens close in
 * another. openedIn below states which rule applies to what. A `claim` gives
 * a span its own rules, as a tie's are.
 *
 * A stop whose covered point falls before its start is reported as a
 * backwards-stop, not joined.
 *
 * Where `noLength` is given, a stop with no start open that could be its own,
 * one in its voice and staff or one naming no staff, first takes a start of
 * its number, voice and staff at the same instant after it, and the two are
 * handed to `noLength`. An exporter writes
 * a span that starts and stops at one point with its stop first. Paired any
 * other way, the stop closes another staff's span, and its start takes some
 * later stop of its number.
 */
export function pairSpans<T, S, P extends EndPlace = EndPlace>(
  ends: readonly ((SpanEnd<T, S> | DroppedStopEnd) & P)[],
  join: (payload: T, stop: StopEnd<S> & P, start: StartEnd<T> & P) => void,
  report: (
    reason: 'orphan-stop' | 'unclosed-start' | 'backwards-stop',
    end: SpanEnd<T, S> & P,
  ) => void,
  atSamePoint: SamePoint = 'stop-first',
  noLength?: (start: (StartEnd<T> | DroppedStartEnd) & P, stop: StopEnd<S> & P) => void,
  claim: Claim<P> = { prefers: () => false, owns: openedIn, reaches: () => true },
): void {
  const open = new Map<string, ((StartEnd<T> | DroppedStartEnd) & P)[]>()
  const ordered = inTimeOrder(ends, atSamePoint)
  const noLengthStarts = new Set<SpanEnd<T, S> | DroppedStopEnd>()

  for (const [index, end] of ordered.entries()) {
    if (end.kind === 'start') {
      if (!noLengthStarts.has(end)) open.set(end.number, [...(open.get(end.number) ?? []), end])
      continue
    }

    const waiting = open.get(end.number) ?? []
    const own =
      findLastOpened(waiting, (start) => claim.prefers(start, end) && claim.owns(start, end)) ??
      findLastOpened(waiting, (start) => claim.owns(start, end))
    // No start open on the stop's staff, and every one open names another
    // staff: none of them can be the stop's own.
    const elsewhere = waiting.every((start) => start.staff !== undefined && end.staff !== undefined)
    if (!own && elsewhere && noLength && !end.dropped) {
      const start = startAtInstant(ordered, index, end, noLengthStarts)
      if (start) {
        noLengthStarts.add(start)
        noLength(start, end)
        continue
      }
    }

    const started = own ?? findLastOpened(waiting, (start) => claim.reaches(start, end))
    if (!started) {
      if (!end.dropped) report('orphan-stop', end)
      continue
    }
    waiting.splice(waiting.indexOf(started), 1)
    // The drop was reported where the end was read; the other end goes with it.
    if (started.dropped || end.dropped) continue

    // The stop's cursor sits past the start, or it would not have paired, but
    // the point it covers can still fall before it, when the two ends
    // interleave through a backup or forward, or when the stop opens the
    // measure the start opens.
    const coversMeasure = end.coversMeasure ?? end.measure
    if (
      coversMeasure < started.measure ||
      (coversMeasure === started.measure && compareFractions(end.covers, started.position) < 0)
    ) {
      report('backwards-stop', end)
      continue
    }

    join(started.payload, end, started)
  }

  for (const waiting of open.values()) {
    // A dropped start was reported when it was dropped; whether the source
    // ever closed it changes nothing about what was lost.
    for (const start of waiting) if (!start.dropped) report('unclosed-start', start)
  }
}

/** The most recently opened start that satisfies the rule, if any does. */
function findLastOpened<E>(waiting: readonly E[], keeps: (start: E) => boolean): E | undefined {
  for (let index = waiting.length - 1; index >= 0; index -= 1) {
    const start = waiting[index]
    if (start && keeps(start)) return start
  }
  return undefined
}

/**
 * The first start after `index` that falls at the instant `stop` marks and
 * is not already taken.
 */
function startAtInstant<T, S, P extends EndPlace>(
  ordered: readonly ((SpanEnd<T, S> | DroppedStopEnd) & P)[],
  index: number,
  stop: EndPlace,
  taken: ReadonlySet<SpanEnd<T, S> | DroppedStopEnd>,
): ((StartEnd<T> | DroppedStartEnd) & P) | undefined {
  for (const later of ordered.slice(index + 1)) {
    if (later.kind === 'start' && !taken.has(later) && startsWhereStops(later, stop)) return later
  }
  return undefined
}

/**
 * Whether two ends are written in one voice and one staff.
 *
 * "Where" is the voice for a tie or a slur, and the staff for a hairpin or an
 * octave shift, each of which states the one the other leaves unset.
 */
export function openedIn(start: EndPlace, end: EndPlace): boolean {
  return start.voice === end.voice && start.staff === end.staff
}

/**
 * Whether a start falls at the instant a stop of its number, voice and staff
 * marks: the same point, or the first beat after the barline the stop is
 * written at.
 */
function startsWhereStops(start: EndPlace, stop: EndPlace): boolean {
  if (start.number !== stop.number || !openedIn(start, stop)) return false
  if (start.measure === stop.measure) return compareFractions(start.position, stop.position) === 0
  return stop.atBarline === true && start.measure === stop.measure + 1 && isZero(start.position)
}

/**
 * The ends in the order they are paired: by measure, then by point in it,
 * then by the rules below.
 *
 * Two ends this calls equal keep the order the document wrote them in, which
 * is what decides which start a stop closes when several of one number open
 * at one point. That rests on Array.prototype.sort being stable, which it is
 * required to be.
 */
export function inTimeOrder<E extends EndPlace & { kind: 'start' | 'stop' }>(
  ends: readonly E[],
  atSamePoint: SamePoint,
): E[] {
  return [...ends].sort((a, b) => {
    if (a.measure !== b.measure) return a.measure - b.measure
    const byPosition = compareFractions(a.position, b.position)
    if (byPosition !== 0) return byPosition
    // A grace note sounds before the beat, so its end comes first whichever
    // order the document writes the two in. Another voice can write the
    // other end of the slur ahead of the grace note that opens it.
    if ((a.grace ?? false) !== (b.grace ?? false)) return a.grace ? -1 : 1
    if (atSamePoint === 'stop-first' && a.kind !== b.kind) return a.kind === 'stop' ? -1 : 1
    return 0
  })
}

/** A key for something in a voice: what a tie pairs by, or a slur's number. */
export function voiceKey(voice: string | undefined, key: string): string {
  return JSON.stringify([voice, key])
}
