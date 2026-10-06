// Joining up the two ends of a tie or a slur.
//
// MusicXML marks both ends and leaves the connection implied: a note says a
// tie starts here, and a later note of the same pitch says one stops. MNX
// states the connection once, on the end where it begins, pointing at the id
// of the end where it finishes.
//
// The open ends are held until their partner is read, often several measures
// later, so this is kept per part.

import { compareFractions, isZero } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  CurveSide,
  GradualDynamic,
  Event,
  LineType,
  Measure,
  Ottava,
  OttavaAmount,
  Pitch,
  SpanStop,
  Step,
  TieTarget,
} from '../model/score.js'
import type { Draft } from './draft.js'
import type { CoveredEvent, GraceNotesAt, LastEventBefore, LastEvents } from './voices.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { WarningCode } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'

/** An event read on a staff, and the measure it is in. */
interface LastSeen {
  measure: number
  event: CoveredEvent
}

/** A tie that has begun, waiting for the note that ends it. */
interface OpenTie {
  note: TieTarget
  /** The side the tie is drawn on, where the start states it. */
  side: CurveSide | undefined
  /** Whether the start states the tie in <tied>, not in <tie> alone. */
  drawn: boolean
}

/**
 * One end of a tie, and on a stop the note it is written on. `sounded` is how
 * many events its voice has sounded in the part, its own included.
 */
type TieEnd = (StartEnd<OpenTie> | StopEnd<{ note: TieTarget; drawn: boolean }>) & {
  sounded: number
}

/**
 * The element an end is written with, and the part and measure it sits in.
 * An end is reported once the part is whole, so it carries both.
 */
export interface WrittenAt {
  context: ReportContext
  element: XmlElement
  /** The element's place in the report, taken when it was read. */
  place: WarningPlace
}

/** Where an end is written, holding its place in the report from now. */
export function writtenAt(
  element: XmlElement,
  context: ReportContext,
  warnings: WarningCollector,
): WrittenAt {
  return { context, element, place: warnings.reserve() }
}

/** Reports a loss at the place its element took in the document. */
function reportAt(
  where: WrittenAt,
  code: WarningCode,
  message: string,
  warnings: WarningCollector,
): void {
  warnings.addAt(where.place, code, message, where.context, where.element)
}

/** An octave shift that has begun, waiting to learn where it stops. */
export interface OpenOttava {
  measure: number
  position: Fraction
  value: OttavaAmount
  staff: number | undefined
  placement?: 'above' | 'below'
}

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
 * A hairpin's stop, handed back before the hairpin it closes is known. Which
 * one that is depends on ends not read yet. A <backup> can write a start
 * after this stop, although the music puts that start earlier.
 */
export interface WedgeStop {
  /** Wording at the closing edge. It waits until the pairing says which
   * hairpin the stop closes, and becomes that hairpin's suffix. */
  wording?: Wording
}

/** A hairpin end, and on a stop the wording waiting at it. */
type WedgeEnd = SpanEnd<GradualDynamic, WedgeStop>

/** Where an end of a span is written, and what it marks, whichever end it is. */
interface EndPlace {
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
interface DroppedStartEnd extends EndPlace {
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
interface DroppedStopEnd extends EndPlace {
  kind: 'stop'
  dropped: true
}

/**
 * One end of something that spans a stretch of music and is written between
 * the notes rather than on one: a hairpin, an octave shift.
 *
 * These cannot be paired up as they are met, the way ties and slurs are,
 * because MusicXML's document order is not time order: a measure holding two
 * voices is written as one pass per voice with a <backup> between them, so a
 * stop belonging to the first voice is written before a start belonging to
 * the second even though the music has it the other way round.
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
 * another. openedIn below states which rule applies to what.
 *
 * A stop whose covered point falls before its start is reported as a
 * backwards-stop, not joined.
 *
 * Where `noLength` is given, a stop with no start open in its own voice and
 * staff first takes a start of its number, voice and staff at the same
 * instant after it, and the two are handed to `noLength`. An exporter writes
 * a span that starts and stops at one point with its stop first. Paired any
 * other way, the stop closes another staff's span, and its start takes some
 * later stop of its number.
 */
export function pairSpans<T, S>(
  ends: readonly (SpanEnd<T, S> | DroppedStopEnd)[],
  join: (payload: T, stop: StopEnd<S>) => void,
  report: (reason: 'orphan-stop' | 'unclosed-start' | 'backwards-stop', end: SpanEnd<T, S>) => void,
  atSamePoint: SamePoint = 'stop-first',
  noLength?: (start: StartEnd<T> | DroppedStartEnd, stop: StopEnd<S>) => void,
): void {
  const open = new Map<string, (StartEnd<T> | DroppedStartEnd)[]>()
  const ordered = inTimeOrder(ends, atSamePoint)
  const noLengthStarts = new Set<SpanEnd<T, S> | DroppedStopEnd>()

  for (const [index, end] of ordered.entries()) {
    if (end.kind === 'start') {
      if (!noLengthStarts.has(end)) open.set(end.number, [...(open.get(end.number) ?? []), end])
      continue
    }

    const waiting = open.get(end.number) ?? []
    const own = findLastOpened(waiting, (start) => openedIn(start, end))
    if (!own && noLength && !end.dropped) {
      const start = startAtInstant(ordered, index, end, noLengthStarts)
      if (start) {
        noLengthStarts.add(start)
        noLength(start, end)
        continue
      }
    }

    const started = own ?? waiting[waiting.length - 1]
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

    join(started.payload, end)
  }

  for (const waiting of open.values()) {
    // A dropped start was reported when it was dropped; whether the source
    // ever closed it changes nothing about what was lost.
    for (const start of waiting) if (!start.dropped) report('unclosed-start', start)
  }
}

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
    const byVoice = new Map<string, SlurEnd[]>()
    for (const end of numberEnds) {
      const voice = end.voice ?? ''
      byVoice.set(voice, [...(byVoice.get(voice) ?? []), end])
    }

    // Every other voice's leftover ends for this number, at the measure it
    // falls in, so a pair's own boundaries can be checked against it directly.
    const residueAt = new Map<string, Map<number, 'unclosed' | 'orphan' | 'both'>>()
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
      exceptVoice: string,
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
        if (confirmedAtStart && confirmedAtStop) crossing.add(`${voice} ${number}`)
      }
    }
  }
  return crossing
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
function startAtInstant<T, S>(
  ordered: readonly (SpanEnd<T, S> | DroppedStopEnd)[],
  index: number,
  stop: EndPlace,
  taken: ReadonlySet<SpanEnd<T, S> | DroppedStopEnd>,
): StartEnd<T> | DroppedStartEnd | undefined {
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
function openedIn(start: EndPlace, end: EndPlace): boolean {
  return (start.voice ?? '') === (end.voice ?? '') && start.staff === end.staff
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

/** The wording a hairpin carries, quoted for a report, or '' where it has none. */
function wordingOf(hairpin: GradualDynamic): string {
  return [hairpin.prefix, hairpin.suffix]
    .filter((text) => text !== undefined)
    .map((text) => `"${text}"`)
    .join(' and ')
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
function inTimeOrder<E extends EndPlace & { kind: 'start' | 'stop' }>(
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

// Ties are matched on pitch across the part, not within a voice. A tie often
// runs between voices, which MNX allows with a crossVoice target.
//
// Matched on the sounding pitch, not the written spelling, because a tie can
// end on a respelling of the same sound: G sharp to A flat, or B sharp to C
// across the octave boundary. A pair that disagrees on the sound stays
// unmatched and is reported.
const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function tieKey(pitch: Pitch): string {
  return String((pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + pitch.alter)
}

// Slurs are matched on the number the source gives them, across the whole
// part. In piano writing a slur often runs from one hand to the other, which
// is a different voice and a different staff. Several slurs may share a
// number, and a stop closes the most recently opened one.

export class SpannerResolver {
  // Both ends of every tie in the part, paired once all of them are in.
  readonly #tieEnds: TieEnd[] = []
  // How many events each voice has sounded so far in the part.
  readonly #sounded = new Map<string, number>()
  // Both ends of every slur in the part, paired once all of them are in.
  readonly #slurEnds: SlurEnd[] = []
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: WedgeEnd[] = []

  /**
   * Counts an event that sounds in a voice. A tie in its own voice joins one
   * event to the next its voice sounds, so this is what tells a stop from a
   * start its voice has sounded past.
   */
  sound(voice: string | undefined): void {
    const key = voice ?? ''
    this.#sounded.set(key, this.#soundedIn(key) + 1)
  }

  #soundedIn(voice: string | undefined): number {
    return this.#sounded.get(voice ?? '') ?? 0
  }

  /**
   * Notes the note a tie begins on, to be paired once the part is read.
   *
   * A tie joins two notes of the same sound, and `pairedBy` is what says two
   * are the same: a pitch for a pitched note, and the kit component struck
   * for a note with no pitch to compare.
   */
  startTie(
    note: TieTarget,
    pairedBy: string,
    voice: string | undefined,
    side: CurveSide | undefined,
    drawn: boolean,
    measure: number,
    position: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    this.#tieEnds.push({
      kind: 'start',
      number: pairedBy,
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: { note, side, drawn },
      where,
      sounded: this.#soundedIn(voice),
    })
  }

  /** The same, for the note a tie ends on. */
  stopTie(
    note: TieTarget,
    pairedBy: string,
    voice: string | undefined,
    drawn: boolean,
    measure: number,
    position: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    this.#tieEnds.push({
      kind: 'stop',
      number: pairedBy,
      measure,
      position,
      voice,
      grace,
      covers: position,
      where,
      stop: { note, drawn },
      sounded: this.#soundedIn(voice),
    })
  }

  /**
   * Joins every tie in the part, once both ends of all of them are in.
   *
   * Paired in time order, not as the ends are met, for the reason the slurs
   * are.
   *
   * A stop takes the open start of its own voice on the event its voice
   * sounded just before, so two hands each sustaining one pitch pair within a
   * hand. That pair is the source's own statement, and it holds at any
   * distance: a score can tie a note to its pitch's next sounding measures
   * away, across rests. A start its voice has sounded past is not one.
   *
   * A stop with no same-voice start falls back to the most recent open start
   * of any voice, which is the cross-voice tie MNX marks. That pair is
   * inferred, so it reaches back one measure at most: a cross-voice tie joins
   * two notes sounding into each other, and a note never crosses a barline.
   */
  #resolveTies(warnings: WarningCollector): void {
    // Two ties of one pitch can be open at once, as when two hands each
    // sustain it, so each pitch holds a stack rather than a single open tie.
    const open = new Map<string, (StartEnd<OpenTie> & { sounded: number })[]>()

    for (const end of inTimeOrder(this.#tieEnds, 'as-written')) {
      if (end.kind === 'start') {
        open.set(end.number, [...(open.get(end.number) ?? []), end])
        continue
      }

      const waiting = open.get(end.number) ?? []
      const started =
        findLastOpened(
          waiting,
          (start) => (start.voice ?? '') === (end.voice ?? '') && end.sounded === start.sounded + 1,
        ) ?? findLastOpened(waiting, (start) => end.measure - start.measure <= 1)
      if (!started) {
        reportAt(
          end.where,
          'unclosed:spanner',
          'A tie ends on a note where none had started, and is not carried over.',
          warnings,
        )
        continue
      }
      waiting.splice(waiting.indexOf(started), 1)

      // A tie stated in <tie> at both ends and in <tied> at neither sounds
      // but is not drawn, as MuseScore writes an invisible tie.
      if (!started.payload.drawn && !end.stop.drawn) {
        reportAt(
          started.where,
          'unrepresentable:element',
          'A tie stated by <tie> with no <tied> on either note sounds but is not drawn, ' +
            'and cannot be expressed in MNX, where a tie is always drawn.',
          warnings,
        )
        continue
      }

      started.payload.note.ties = [
        ...started.payload.note.ties,
        {
          target: end.stop.note.id,
          // Voices are compared the way sequences are bucketed: a note
          // stating no voice and one stating an empty voice are both the
          // unnamed voice.
          crossVoice: (started.voice ?? '') !== (end.voice ?? ''),
          ...(started.payload.side !== undefined ? { side: started.payload.side } : {}),
        },
      ]
    }

    for (const waiting of open.values()) {
      for (const start of waiting) {
        reportAt(
          start.where,
          'unclosed:spanner',
          'A tie starts on a note that nothing ties to, and is not carried over.',
          warnings,
        )
      }
    }
    this.#tieEnds.length = 0
  }

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
      // A slur number holds no space, so the last space separates the two and
      // no pair of voice and number keys another pair's stream.
      const key = `${end.voice ?? ''} ${end.number}`
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

  /** Notes where a hairpin begins, to be paired once the part is read. */
  startWedge(
    dynamic: GradualDynamic,
    number: string,
    measure: number,
    position: Fraction,
    where: WrittenAt,
  ): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      // The staff is the hairpin's own, so the two cannot disagree about it.
      staff: dynamic.staff,
      payload: dynamic,
      where,
    })
  }

  /**
   * The same, where one stops. Hands back a handle for the stop rather than
   * the hairpin it closes, because which hairpin that is cannot be told until
   * the whole part is in: a stop closes the most recently opened hairpin of
   * its number, and a <backup> writes a start the music puts earlier than
   * this stop after it in the document. Wording written at the closing edge
   * waits on the handle and is put on the hairpin by the pairing.
   */
  stopWedge(
    number: string,
    measure: number,
    position: Fraction,
    graceWritten: number,
    staff: number | undefined,
    where: WrittenAt,
  ): WedgeStop {
    const stop: WedgeStop = {}
    this.#wedgeEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      covers: position,
      graceWritten,
      staff,
      where,
      stop,
    })
    return stop
  }

  /**
   * Notes a hairpin start the reader dropped and already reported, so the stop
   * the source wrote for it is consumed rather than reported as an orphan.
   */
  dropWedgeStart(
    number: string,
    measure: number,
    position: Fraction,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      dropped: true,
      where,
    })
  }

  /**
   * Pairs every span that waits until the whole part is read: the hairpins,
   * the octave shifts, the slurs, and the ties. One entry point, so a caller
   * cannot pair the spans and skip the report of what stays unpaired.
   */
  finish(measures: readonly Measure[], warnings: WarningCollector): void {
    this.#resolveWedges(measures, warnings)
    this.#resolveOttavas(measures, warnings)
    this.#resolveSlurs(warnings)
    this.#resolveTies(warnings)
  }

  /** Joins every hairpin in the part, once all of both ends are in. */
  #resolveWedges(measures: readonly Measure[], warnings: WarningCollector): void {
    // MNX requires a gradual dynamic to state where it ends, so a hairpin
    // left with no stop is not carried over. A hairpin's stop covers the
    // point where it is written, so no stop covers a point before its start;
    // the backwards message is for when the two differ, as an octave shift's
    // do.
    const messages = {
      'orphan-stop': 'A hairpin stops where none had started, and is not carried over.',
      'backwards-stop':
        'A hairpin would end before it starts, its stop covering a point earlier ' +
        'than its start, and is not carried over.',
      'unclosed-start': 'A hairpin starts where nothing ends it, and is not carried over.',
    }
    const closed = new Map<StopEnd<WedgeStop>, GradualDynamic>()
    pairSpans<GradualDynamic, WedgeStop>(
      this.#wedgeEnds,
      (dynamic, stop) => {
        // The grace note the hairpin ends on is stated where the stop covers
        // one, and the key left off where it does not: MNX reads an absent
        // key as the beat itself. Assigned, not spread in, so the compiler
        // tells an absent key from an undefined one.
        const end: Draft<SpanStop> = { measure: stop.measure, position: stop.covers }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        dynamic.end = end
        // A hairpin stating no staff applies to all of them, so only one
        // naming its staff can end on another.
        if (
          dynamic.staff !== undefined &&
          stop.staff !== undefined &&
          stop.staff !== dynamic.staff
        ) {
          dynamic.staffEnd = stop.staff
        }
        closed.set(stop, dynamic)
      },
      (reason, end) => {
        // Only a start can carry wording, and only an unclosed one reaches here.
        const words = end.kind === 'start' && !end.dropped ? wordingOf(end.payload) : ''
        const message =
          words === ''
            ? messages[reason]
            : `A hairpin starts where nothing ends it, and is not carried over, nor its wording ${words}.`
        reportAt(end.where, 'unclosed:spanner', message, warnings)
      },
      'stop-first',
      (start) => {
        if (start.dropped) return
        const words = wordingOf(start.payload)
        reportAt(
          start.where,
          'unclosed:spanner',
          'A hairpin stops at the point where it starts, and is not carried over' +
            (words === '' ? '.' : `, nor its wording ${words}.`),
          warnings,
        )
      },
    )

    for (const end of this.#wedgeEnds) {
      if (end.kind !== 'start' || end.dropped || end.payload.end !== undefined) continue
      const dynamics = measures[end.measure]?.dynamics ?? []
      dynamics.splice(0, dynamics.length, ...dynamics.filter((mark) => mark !== end.payload))
    }

    // Wording written at a closing edge goes on the hairpin the pairing joins
    // to that stop. It qualifies no mark where the stop closed nothing, and
    // where the hairpin already carries wording from its starting edge: the
    // source wrote both, so the closing words do not overwrite the opening.
    for (const end of this.#wedgeEnds) {
      if (end.kind !== 'stop' || !end.stop.wording) continue
      const wording = end.stop.wording
      const hairpin = closed.get(end)
      if (hairpin && hairpin.suffix === undefined) hairpin.suffix = wording.text
      else reportLoneWording(wording, warnings)
    }
    this.#wedgeEnds.length = 0
  }

  // Both ends of every octave shift in the part, paired the same way.
  readonly #ottavaEnds: SpanEnd<OpenOttava, undefined>[] = []
  // The last event read on each staff, from the measures settled so far.
  readonly #lastSeen = new Map<number, LastSeen>()

  startOttava(
    open: OpenOttava,
    number: string,
    measure: number,
    position: Fraction,
    where: WrittenAt,
  ): void {
    this.#ottavaEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      // The staff is the shift's own, so the two cannot disagree about it.
      staff: open.staff,
      payload: open,
      where,
    })
  }

  stopOttava(
    number: string,
    measure: number,
    position: Fraction,
    cursor: Fraction,
    graceWritten: number,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#ottavaEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      staff,
      // Where the cursor stood when the stop was written. settleSpanCovers
      // below reads the covered event from it once the measure is whole, and
      // it stands as written where the measure holds no event before it.
      covers: cursor,
      graceWritten,
      where,
      stop: undefined,
    })
  }

  /**
   * States which event each hairpin and octave-shift stop of a measure covers,
   * once the whole measure is read. Neither can be settled while the measure
   * is still being read: a <backup> can put an octave shift's covered event
   * later in the document than its stop, and grace notes read after a stop
   * change how MNX numbers the ones read before it.
   *
   * A stop written after grace notes is drawn over them, so it ends on the
   * last one written before it. MNX numbers a grace note back from the note
   * it ornaments, counting from the right, so that one is the total standing
   * there less the ones the stop was written after, plus one.
   *
   * A stop with no grace notes before it keeps the place it was written for a
   * hairpin, and for an octave shift moves back to the last event the cursor
   * had passed, on the staff the stop names. Where the stop is written before
   * any event of its measure, that event is in a measure before.
   *
   * A hairpin stop also learns whether it sits at the barline, which is the
   * measure's `length` from its start.
   */
  settleSpanCovers(
    measure: number,
    length: Fraction,
    lastEventBefore: LastEventBefore,
    graceNotesAt: GraceNotesAt,
    lastEvents: LastEvents,
  ): void {
    const overGraceNotes = (end: EndPlace): boolean => {
      if (!end.graceWritten) return false
      end.coversGraceIndex = graceNotesAt(end.covers, end.staff) - end.graceWritten + 1
      return true
    }

    // The sweep settles the stops of the measure just read, against that
    // measure's own events. A stop of any other measure is settled by the
    // sweep of its own, and settling it again here would move it to an event
    // of a measure it never reached.
    const stoppingHere = <E extends EndPlace & { kind: 'start' | 'stop' }>(
      ends: readonly E[],
    ): E[] => ends.filter((end) => end.kind === 'stop' && end.measure === measure)

    for (const end of stoppingHere(this.#wedgeEnds)) {
      overGraceNotes(end)
      end.atBarline = compareFractions(end.position, length) === 0
    }

    // Only an octave shift moves back off the point its stop was written at.
    //
    // The stop moves to the last event before it on the staff it names. If
    // that staff has no event, the stop moves to the last event on any staff.
    // A source can name a staff that holds only a whole-measure rest, which MNX
    // writes as the measure's own, not as an event. Left where it was
    // written, such a stop would end on the barline, where no event begins.
    for (const end of stoppingHere(this.#ottavaEnds)) {
      if (overGraceNotes(end)) continue
      const inMeasure = lastEventBefore(end.covers, end.staff) ?? lastEventBefore(end.covers)
      const before = inMeasure ? undefined : this.#lastSeenOn(end.staff)
      if (before) end.coversMeasure = before.measure
      const covered = inMeasure ?? before?.event
      if (!covered) continue
      end.covers = covered.start
      if (covered.graceIndex !== undefined) end.coversGraceIndex = covered.graceIndex
    }

    for (const [staff, event] of lastEvents()) this.#lastSeen.set(staff, { measure, event })
  }

  /**
   * The last event read so far on a staff, or on any staff where that staff
   * has none or none is named.
   */
  #lastSeenOn(staff: number | undefined): LastSeen | undefined {
    const own = staff === undefined ? undefined : this.#lastSeen.get(staff)
    if (own) return own
    let latest: LastSeen | undefined
    for (const seen of this.#lastSeen.values()) {
      if (
        !latest ||
        seen.measure > latest.measure ||
        (seen.measure === latest.measure &&
          compareFractions(seen.event.start, latest.event.start) > 0)
      ) {
        latest = seen
      }
    }
    return latest
  }

  /** The same as dropWedgeStart, for an octave shift the reader dropped. */
  dropOttavaStart(
    number: string,
    measure: number,
    position: Fraction,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#ottavaEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      dropped: true,
      where,
    })
  }

  /**
   * Joins every octave shift in the part, putting each finished one on the
   * measure it begins in. Unlike a hairpin, MNX requires a shift to say where
   * it stops, so one the source never closed cannot be written.
   */
  #resolveOttavas(measures: readonly Measure[], warnings: WarningCollector): void {
    pairSpans<OpenOttava, undefined>(
      this.#ottavaEnds,
      (open, stop) => {
        // Assigned, not spread in, so the compiler tells an absent key from an
        // undefined one.
        const end: Draft<SpanStop> = {
          measure: stop.coversMeasure ?? stop.measure,
          position: stop.covers,
        }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        const ottava: Draft<Ottava> = {
          position: open.position,
          end,
          value: open.value,
          staff: open.staff,
        }
        if (open.placement !== undefined) ottava.placement = open.placement
        measures[open.measure]?.ottavas.push(ottava)
      },
      (reason, end) => {
        reportAt(
          end.where,
          'unclosed:spanner',
          reason === 'orphan-stop'
            ? 'An octave shift stops where none had started, and is not carried over.'
            : reason === 'backwards-stop'
              ? // MNX states the end of a shift as the last event it covers,
                // and the stop's cursor can pass the start while that event
                // falls before it. Dropped and reported, the same as one the
                // source never closed.
                'An octave shift would end before it starts, its stop covering an event ' +
                'earlier than its start, and is not carried over.'
              : 'An octave shift starts where nothing ends it, and MNX states where one ' +
                'stops, so it is not carried over.',
          warnings,
        )
      },
    )
    this.#ottavaEnds.length = 0
  }
}
