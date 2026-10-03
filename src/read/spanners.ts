// Joining up the two ends of a tie or a slur.
//
// MusicXML marks both ends and leaves the connection implied: a note says a
// tie starts here, and a later note of the same pitch says one stops. MNX
// states the connection once, on the end where it begins, pointing at the id
// of the end where it finishes.
//
// The open ends are held until their partner is read, often several measures
// later, so this is kept per part.

import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  CurveSide,
  Dynamic,
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
import type { GraceNotesAt, LastEventBefore } from './voices.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'

/** A tie that has begun, waiting for the note that ends it. */
interface OpenTie {
  note: TieTarget
  /** The side the tie is drawn on, where the start states it. */
  side: CurveSide | undefined
  /** Whether the start states the tie in <tied>, not in <tie> alone. */
  drawn: boolean
}

/** One end of a tie, and on a stop the note it is written on. */
type TieEnd = StartEnd<OpenTie> | StopEnd<{ note: TieTarget; drawn: boolean }>

/**
 * The element an end is written with, and the part and measure it sits in.
 * An end is reported once the part is whole, so it carries both.
 */
export interface WrittenAt {
  context: ReportContext
  element: XmlElement
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

/**
 * Wording written at a hairpin's closing edge. It waits until the pairing
 * says which hairpin the stop closes.
 */
export interface StopWording {
  /** The words, to become that hairpin's suffix. */
  text: string
  /** The dynamic group drawn where no hairpin takes them. */
  standalone: Dynamic
}

/**
 * A hairpin's stop, handed back before the hairpin it closes is known. Which
 * one that is depends on ends not read yet. A <backup> can write a start
 * after this stop, although the music puts that start earlier.
 */
export interface WedgeStop {
  wording?: StopWording
}

/** A hairpin end, and on a stop the wording waiting at it. */
type WedgeEnd = SpanEnd<Dynamic, WedgeStop>

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
   * How many grace notes stood where a stop was written, at the point it was
   * written. The grace notes read after it belong on the far side of it, so
   * the index above cannot be settled until the measure is whole.
   */
  graceWritten?: number
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
 * another. lastOpenedIn below states which rule applies to what.
 *
 * A stop whose covered point falls before its start is reported as a
 * backwards-stop, not joined.
 */
export function pairSpans<T, S>(
  ends: readonly (SpanEnd<T, S> | DroppedStopEnd)[],
  join: (payload: T, stop: StopEnd<S>) => void,
  report: (reason: 'orphan-stop' | 'unclosed-start' | 'backwards-stop', end: SpanEnd<T, S>) => void,
  atSamePoint: SamePoint = 'stop-first',
): void {
  const open = new Map<string, (StartEnd<T> | DroppedStartEnd)[]>()

  for (const end of inTimeOrder(ends, atSamePoint)) {
    if (end.kind === 'start') {
      open.set(end.number, [...(open.get(end.number) ?? []), end])
      continue
    }

    const waiting = open.get(end.number) ?? []
    const started = lastOpenedIn(waiting, end)
    if (!started) {
      if (!end.dropped) report('orphan-stop', end)
      continue
    }
    waiting.splice(waiting.indexOf(started), 1)
    // The drop was reported where the end was read; the other end goes with it.
    if (started.dropped || end.dropped) continue

    // The stop's cursor sits past the start, or it would not have paired, but
    // the point it covers can still fall before it, when the two ends
    // interleave through a backup or forward. A stop never pairs with a start
    // in a later measure, so only a stop in the start's own measure can cover
    // a point before it.
    if (end.measure === started.measure && compareFractions(end.covers, started.position) < 0) {
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
 * The start a stop closes: the last one opened where the stop was written, or
 * failing that the last one opened.
 *
 * "Where" is the voice for a tie or a slur, and the staff for a hairpin or an
 * octave shift, each of which states the one the other leaves unset. The
 * fallback pairs a source that names the staff on one end only.
 */
function lastOpenedIn<E extends EndPlace>(waiting: readonly E[], end: EndPlace): E | undefined {
  return (
    findLastOpened(
      waiting,
      (start) => (start.voice ?? '') === (end.voice ?? '') && start.staff === end.staff,
    ) ?? waiting[waiting.length - 1]
  )
}

/**
 * Puts a dynamic in a measure at the point the source drew it, before the
 * first one written later. The measure's marks are read in document order,
 * which a <backup> can take back to an earlier point, so this is where the
 * source has it rather than a sort of the whole measure.
 */
/** The wording a hairpin carries, quoted for a report, or '' where it has none. */
function wordingOf(hairpin: Dynamic): string {
  return [hairpin.prefix, hairpin.suffix]
    .filter((text) => text !== undefined)
    .map((text) => `"${text}"`)
    .join(' and ')
}

function insertAtPosition(dynamics: Dynamic[] | undefined, added: Dynamic): void {
  if (!dynamics) return
  const after = dynamics.findIndex((mark) => compareFractions(mark.position, added.position) > 0)
  if (after < 0) dynamics.push(added)
  else dynamics.splice(after, 0, added)
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
  // Both ends of every slur in the part, paired once all of them are in.
  readonly #slurEnds: SlurEnd[] = []
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: WedgeEnd[] = []

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
    })
  }

  /**
   * Joins every tie in the part, once both ends of all of them are in.
   *
   * Paired in time order, not as the ends are met, for the reason the slurs
   * are.
   *
   * A stop takes the most recent open start of its own voice, so two hands
   * each sustaining one pitch pair within a hand. That pair is the source's
   * own statement, and it holds at any distance: a score can tie a note to
   * its pitch's next sounding measures away, across rests.
   *
   * A stop with no same-voice start falls back to the most recent open start
   * of any voice, which is the cross-voice tie MNX marks. That pair is
   * inferred, so it reaches back one measure at most: a cross-voice tie joins
   * two notes sounding into each other, and a note never crosses a barline.
   */
  #resolveTies(warnings: WarningCollector): void {
    // Two ties of one pitch can be open at once, as when two hands each
    // sustain it, so each pitch holds a stack rather than a single open tie.
    const open = new Map<string, StartEnd<OpenTie>[]>()

    for (const end of inTimeOrder(this.#tieEnds, 'as-written')) {
      if (end.kind === 'start') {
        open.set(end.number, [...(open.get(end.number) ?? []), end])
        continue
      }

      const waiting = open.get(end.number) ?? []
      const started =
        findLastOpened(waiting, (start) => (start.voice ?? '') === (end.voice ?? '')) ??
        findLastOpened(waiting, (start) => end.measure - start.measure <= 1)
      if (!started) {
        warnings.add(
          'unclosed:spanner',
          'A tie ends on a note where none had started, and is not carried over.',
          end.where.context,
          end.where.element,
        )
        continue
      }
      waiting.splice(waiting.indexOf(started), 1)

      // A tie stated in <tie> at both ends and in <tied> at neither sounds
      // but is not drawn, as MuseScore writes an invisible tie.
      if (!started.payload.drawn && !end.stop.drawn) {
        warnings.add(
          'unrepresentable:element',
          'A tie stated by <tie> with no <tied> on either note sounds but is not drawn, ' +
            'and cannot be expressed in MNX, where a tie is always drawn.',
          started.where.context,
          started.where.element,
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
        warnings.add(
          'unclosed:spanner',
          'A tie starts on a note that nothing ties to, and is not carried over.',
          start.where.context,
          start.where.element,
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
        warnings.add('unclosed:spanner', messages[reason], end.where.context, end.where.element)
      },
      'as-written',
    )
    this.#slurEnds.length = 0
  }

  /** Notes where a hairpin begins, to be paired once the part is read. */
  startWedge(
    dynamic: Dynamic,
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
    const closed = new Map<StopEnd<WedgeStop>, Dynamic>()
    pairSpans<Dynamic, WedgeStop>(
      this.#wedgeEnds,
      (dynamic, stop) => {
        // The grace note the hairpin ends on is stated where the stop covers
        // one, and the key left off where it does not: MNX reads an absent
        // key as the beat itself. Assigned, not spread in, so the compiler
        // tells an absent key from an undefined one.
        const end: Draft<SpanStop> = { measure: stop.measure, position: stop.covers }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        dynamic.end = end
        closed.set(stop, dynamic)
      },
      (reason, end) => {
        // Only a start can carry wording, and only an unclosed one reaches here.
        const words = end.kind === 'start' && !end.dropped ? wordingOf(end.payload) : ''
        const message =
          words === ''
            ? messages[reason]
            : `A hairpin starts where nothing ends it, and is not carried over, nor its wording ${words}.`
        warnings.add('unclosed:spanner', message, end.where.context, end.where.element)
      },
    )

    for (const end of this.#wedgeEnds) {
      if (end.kind !== 'start' || end.dropped || end.payload.end !== undefined) continue
      const dynamics = measures[end.measure]?.dynamics ?? []
      dynamics.splice(0, dynamics.length, ...dynamics.filter((mark) => mark !== end.payload))
    }

    // Wording written at a closing edge goes on the hairpin the pairing joins
    // to that stop. It is drawn on its own where the stop closed nothing, and
    // where the hairpin already carries wording from its starting edge: the
    // source wrote both, so the closing words do not overwrite the opening.
    for (const end of this.#wedgeEnds) {
      if (end.kind !== 'stop' || !end.stop.wording) continue
      const wording = end.stop.wording
      const hairpin = closed.get(end)
      if (hairpin && hairpin.suffix === undefined) hairpin.suffix = wording.text
      else insertAtPosition(measures[end.measure]?.dynamics, wording.standalone)
    }
    this.#wedgeEnds.length = 0
  }

  // Both ends of every octave shift in the part, paired the same way.
  readonly #ottavaEnds: SpanEnd<OpenOttava, undefined>[] = []

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
   * had passed, on the staff the stop names.
   */
  settleSpanCovers(
    measure: number,
    lastEventBefore: LastEventBefore,
    graceNotesAt: GraceNotesAt,
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
      const covered = lastEventBefore(end.covers, end.staff) ?? lastEventBefore(end.covers)
      if (!covered) continue
      end.covers = covered.start
      if (covered.graceIndex !== undefined) end.coversGraceIndex = covered.graceIndex
    }
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
        const end: Draft<SpanStop> = { measure: stop.measure, position: stop.covers }
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
        warnings.add(
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
          end.where.context,
          end.where.element,
        )
      },
    )
    this.#ottavaEnds.length = 0
  }
}
