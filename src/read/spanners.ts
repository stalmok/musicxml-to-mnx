// Joining up the two ends of a tie or a slur.
//
// MusicXML marks both ends and leaves the connection implied: a note says a
// tie starts here, and a later note of the same pitch says one stops. MNX
// states the connection once, on the end where it begins, pointing at the id
// of the end where it finishes.
//
// So the open ends have to be held until their partner turns up, which is
// routinely several measures later. That is why this is kept per part rather
// than per measure.

import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  CurveSide,
  Draft,
  Dynamic,
  Event,
  LineType,
  Measure,
  Note,
  Ottava,
  OttavaAmount,
  Pitch,
  Step,
} from '../model/score.js'
import type { CoveredEvent } from './voices.js'
import type { WarningCollector, WarningContext } from '../warnings.js'

/** A tie that has begun, waiting for the note that ends it. */
interface OpenTie {
  note: Note
  /** The side the tie is drawn on, where the start states it. */
  side: CurveSide | undefined
}

/** One end of a tie, and on a stop the note it is written on. */
interface TieEnd extends SpanEnd<OpenTie> {
  stop?: { note: Note }
}

/** An octave shift that has begun, waiting to learn where it stops. */
export interface OpenOttava {
  measure: number
  position: Fraction
  value: OttavaAmount
  staff: number | undefined
  orient?: 'above' | 'below'
}

/** A slur that has begun, waiting to learn which event ends it. */
interface OpenSlur {
  event: Event
  side: CurveSide | undefined
  lineType: LineType | undefined
}

/**
 * One end of a slur: a start carries the slur it opens, and a stop names the
 * event it is written on. Two shapes rather than one, because the pairing a
 * voice does for itself reads the slur straight off its own start, and the
 * split is what states there is one to read. No reader drops a slur start the
 * way it drops a hairpin's, so a start with nothing to join cannot be built.
 */
export type SlurEnd = SlurStart | SlurStop

interface SlurStart extends SpanEnd<OpenSlur> {
  kind: 'start'
  payload: OpenSlur
  stop?: undefined
}

interface SlurStop extends SpanEnd<OpenSlur> {
  kind: 'stop'
  payload: undefined
  stop: {
    event: Event
    /** The side the slur bends to at its close, for an S-shaped one. */
    sideEnd: CurveSide | undefined
  }
}

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
interface WedgeEnd extends SpanEnd<Dynamic> {
  stop?: WedgeStop
}

/**
 * One end of something that spans a stretch of music and is written between
 * the notes rather than on one: a hairpin, an octave shift.
 *
 * These cannot be paired up as they are met, the way ties and slurs are,
 * because MusicXML's document order is not time order: a measure holding two
 * voices is written as one pass per voice with a <backup> between them, so a
 * stop belonging to the first voice is written before a start belonging to
 * the second even though the music has it the other way round. Pairing in
 * document order made a hairpin out of a stop and a start that had nothing to
 * do with each other, one of them 28 measures long.
 */
export interface SpanEnd<T> {
  kind: 'start' | 'stop'
  /** What the source numbers it, so two open at once can be told apart. */
  number: string
  /** Where in the score: a measure's place in the part, and a point in it. */
  measure: number
  /** Where it is written, which is what puts the ends in order. */
  position: Fraction
  /**
   * The place it actually marks. The two differ for the stop of an octave
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
   * says nothing, which is not read as the first staff: a source that names
   * the staff on the start and leaves it off the stop means the start's, and
   * neither reading is safe to assume.
   */
  staff?: number | undefined
  /**
   * Whether the event it sits on is a grace note. A grace note sounds before
   * the beat, so its end comes first among the ends at one point, whichever
   * order the document writes them in.
   */
  grace?: boolean
  /** Carried on a start, and handed back when its stop is found. */
  payload: T | undefined
  /**
   * A start the reader dropped and already reported. It still takes its place
   * in pairing, so the stop the source wrote for it is consumed with it, in
   * silence: reporting that stop as an orphan would say the source never
   * started the span, when it did.
   */
  dropped?: boolean
  context: WarningContext
}

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
 * stop closes the most recently opened start written where it was, meaning
 * the same voice and the same staff, and where that has none open, the most
 * recently opened of any. Both halves matter. Without the first, two voices
 * each holding a slur numbered 1 over the same beats close into each other
 * and the hands are sewn together, and two hands each holding a hairpin
 * numbered 1 do the same. Without the fallback, a voice that opens a slur
 * another voice closes takes a partner of its own from measures away, and
 * the two ends the music meant for each other are both reported as
 * unmatched. lastOpenedIn below states which half applies to what.
 *
 * A stop whose covered point falls before its start is reported as a
 * backwards-stop rather than joined: the joined span would end before it
 * starts, which no consumer accepts.
 */
export function pairSpans<T, E extends SpanEnd<T>>(
  ends: readonly E[],
  join: (payload: T, stop: E) => void,
  report: (reason: 'orphan-stop' | 'unclosed-start' | 'backwards-stop', end: E) => void,
  atSamePoint: SamePoint = 'stop-first',
): void {
  const open = new Map<string, E[]>()

  for (const end of inTimeOrder(ends, atSamePoint)) {
    if (end.kind === 'start') {
      open.set(end.number, [...(open.get(end.number) ?? []), end])
      continue
    }

    const waiting = open.get(end.number) ?? []
    const started = lastOpenedIn(waiting, end)
    if (!started) {
      report('orphan-stop', end)
      continue
    }
    waiting.splice(waiting.indexOf(started), 1)
    // The drop was reported where the start was read; the stop goes with it.
    if (started.dropped) continue
    /* v8 ignore next 2 -- only a start carries a payload, and only a start is
       ever pushed onto the stack this came off. */
    if (started.payload === undefined) throw new Error('A span start with nothing to join.')

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
 * Exported for the test that pins its answers. Reading it through a score
 * cannot: a stream this calls not its own goes to the pass across the part,
 * which hands back what it cannot pair and prefers a stop's own voice, so it
 * mostly reaches the same joins by a longer road.
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
 * Exported for the test that pins its four answers, for the reason
 * accountsForItself is.
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
 * The voice-and-number streams that must not be treated as a voice's own,
 * even where accountsForItself says they balance, because the pair it would
 * join is one a different voice's residue confirms from both sides: an
 * unclosed start of the same number in another voice, in the same measure as
 * this pair's start or the one right after, and separately an orphan stop of
 * the same number in another voice, in the same measure as this pair's stop
 * or the one right before. That is the source stating a slur crossing voices
 * right there, on both the measure this pair opens in and the measure it
 * closes in, which a coincidence touches at most one side of.
 *
 * A stream a whole-part count finds balanced can still be one of these: two
 * separate cross-voice slurs reusing its number can leave it with exactly
 * one start and one stop of its own, which is no more the same slur than two
 * unrelated notes are the same note for sharing a pitch. Such a stream's
 * balance beyond the measure is coincidence, not a slur anyone wrote, so it
 * goes to the pass across the part with every other stream that cannot
 * account for itself.
 *
 * Confirmed from both sides rather than one: a voice's own slur runs past a
 * stray, unrelated end in another voice often enough that one-sided evidence
 * throws it to the pass across the part too, and there the nearer stray
 * wins over the farther partner the voice actually states. Requiring both
 * sides keeps that voice's own reading, because a stray end at only one
 * boundary of the pair does not also explain the other.
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

    // Every other voice's residue for this number, at the measure it falls
    // in, so a pair's own boundaries can be checked against it directly.
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
function findLastOpened<T, E extends SpanEnd<T>>(
  waiting: readonly E[],
  keeps: (start: E) => boolean,
): E | undefined {
  for (let index = waiting.length - 1; index >= 0; index -= 1) {
    const start = waiting[index]
    if (start && keeps(start)) return start
  }
  return undefined
}

/**
 * The start a stop closes: the last one opened where the stop was written, or
 * failing that the last one opened at all.
 *
 * "Where" is the voice for a tie or a slur, and the staff for a hairpin or an
 * octave shift, each of which states the one the other leaves unset. An
 * exporter that numbers each hand from 1 has both hands holding a hairpin
 * numbered 1 at once, and on the number alone each closes on the other hand's
 * stop. The fallback keeps a source that names the staff on one end and not
 * the other pairing as it did, since neither reading of the silent end is
 * safe to assume.
 */
function lastOpenedIn<T, E extends SpanEnd<T>>(waiting: readonly E[], end: E): E | undefined {
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
 * required to be. It used to rest on the ends being decorated with their
 * position in the array and compared by it, which said the same thing twice.
 */
function inTimeOrder<T, E extends SpanEnd<T>>(ends: readonly E[], atSamePoint: SamePoint): E[] {
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

// Ties are matched on pitch across the part, not within a voice. A tie
// routinely runs between voices, which MNX itself allows for with a
// crossVoice target type, and piano writing is full of them: the seed corpus
// fails to resolve 30 of 108 ties when the voice is part of the match,
// against 4 when it is not.
//
// Matched on the sounding pitch rather than the written spelling, because a
// tie can end on a respelling of the same sound: the corpus ties G sharp to
// A flat, and B sharp crosses the octave boundary to C. A pair that
// disagrees on the sound stays unmatched and keeps warning.
const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function tieKey(pitch: Pitch): string {
  return String((pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + pitch.alter)
}

// Slurs are matched on the number the source gives them, across the whole
// part rather than within a voice. In piano writing a slur routinely runs
// from one hand to the other, which is a different voice and a different
// staff, and scoping the number to a voice breaks every one of those.
//
// Measured across the seed corpus: 24 of 343 slurs fail to resolve when the
// number is scoped to a voice, against 12 when it is scoped to the part.
// Allowing several slurs to share a number, and closing the most recently
// opened one, accounts for most of the rest.

export class SpannerResolver {
  // Both ends of every tie in the part, paired once all of them are in.
  readonly #tieEnds: TieEnd[] = []
  // Both ends of every slur in the part, paired once all of them are in.
  readonly #slurEnds: SlurEnd[] = []
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: WedgeEnd[] = []

  /** Notes the note a tie begins on, to be paired once the part is read. */
  startTie(
    note: Note,
    voice: string | undefined,
    side: CurveSide | undefined,
    measure: number,
    position: Fraction,
    grace: boolean,
    context: WarningContext,
  ): void {
    this.#tieEnds.push({
      kind: 'start',
      number: tieKey(note.pitch),
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: { note, side },
      context,
    })
  }

  /** The same, for the note a tie ends on. */
  stopTie(
    note: Note,
    voice: string | undefined,
    measure: number,
    position: Fraction,
    grace: boolean,
    context: WarningContext,
  ): void {
    this.#tieEnds.push({
      kind: 'stop',
      number: tieKey(note.pitch),
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: undefined,
      context,
      stop: { note },
    })
  }

  /**
   * Joins every tie in the part, once both ends of all of them are in.
   *
   * Paired in time order rather than as the ends are met, for the same
   * reason the slurs are: a measure holding two voices is written one voice
   * at a time with a <backup> between them, so a stop belonging to the first
   * voice is written before the start belonging to the second even though
   * the music has it the other way round.
   *
   * A stop takes the most recent open start of its own voice, so two hands
   * each sustaining one pitch pair within a hand rather than across. That
   * pair is the source's own statement, and it holds at any distance: real
   * scores tie a note to its pitch's next sounding measures away, across
   * rests, and the corpus carries one such tie.
   *
   * A stop with no same-voice start falls back to the most recent open
   * start of any voice, which is the cross-voice tie MNX marks. That pair
   * is this reader's inference, so it reaches back one measure at most: a
   * cross-voice tie joins two notes sounding into each other, and a note
   * never crosses a barline. A start further back is stale, and pairing
   * with it would invent a tie the source never states.
   */
  #resolveTies(warnings: WarningCollector): void {
    // Two ties of one pitch can be open at once, as when two hands each
    // sustain it, so each pitch holds a stack rather than a single open tie.
    const open = new Map<string, TieEnd[]>()

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
          end.context,
          'tie',
        )
        continue
      }
      waiting.splice(waiting.indexOf(started), 1)
      /* v8 ignore next 2 -- only a start carries a payload, and only a start
         is ever pushed onto the stack this came off. */
      if (started.payload === undefined) throw new Error('A tie start with nothing to join.')
      /* v8 ignore next 2 -- every stop is pushed with the note it is written
         on. */
      if (!end.stop) throw new Error('A tie stop with no note.')

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
          start.context,
          'tie',
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
    context: WarningContext,
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
      context,
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
    context: WarningContext,
  ): void {
    this.#slurEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: undefined,
      context,
      stop: { event, sideEnd },
    })
  }

  /**
   * Joins every slur in the part, once both ends of all of them are in.
   *
   * Paired in time order rather than as the ends are met, because a measure
   * holding two voices is written as one pass per voice with a <backup>
   * between them. A slur running from the second voice to the first therefore
   * has its stop written before its start. Paired as met, that stop closed
   * whichever slur was open from an earlier measure, and every later slur of
   * the same number shifted along with it.
   *
   * A voice keeps its own slurs of one number only where its ends account for
   * each other: it opens each before closing it and leaves none over, and no
   * other voice leaves a complementary end of that number over in the same
   * measure (see crossesVoicesInAMeasure). A measure is written one voice at
   * a time, so such a stream is that voice's beyond doubt, and exporters
   * reuse one number in every voice.
   *
   * Everything else joins one stream for the whole part. A voice that leaves
   * an end over is a voice whose slur runs into another, and pairing it
   * through to the end on its own put no bound on how far its partner could
   * be: one voice took a same-voice stop 178 measures on over the stop in the
   * next measure, and both ends the music meant for each other were reported
   * as unmatched. Across the vendored corpus that shape carries 31 slurs the
   * voice-first pairing lost, and drops the spans of five measures or more
   * from 124 to 84.
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
    const join = (open: OpenSlur, end: SlurEnd): void => {
      /* v8 ignore next 2 -- join hands back a stop, and every stop is
         pushed with the event it is written on. */
      if (!end.stop) throw new Error('A slur stop with no event.')
      const sideEnd = end.stop.sideEnd
      open.event.slurs = [
        ...open.event.slurs,
        {
          target: end.stop.event.id,
          side: open.side,
          // MNX's sideEnd is for an S-shaped slur that ends bending the other
          // way; a stop merely restating the start's side adds nothing.
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
      for (const pair of ownPairs(ends)) join(pair.start.payload, pair.stop)
    }

    // Back in the order the document has, because the streams gave their ends
    // up a stream at a time. A grace note begins where the note it ornaments
    // begins, so a slur between the two has both ends at one point.
    pairSpans<OpenSlur, SlurEnd>(
      this.#slurEnds.filter((end) => spare.has(end)),
      join,
      (reason, end) => {
        warnings.add('unclosed:spanner', messages[reason], end.context, 'slur')
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
    context: WarningContext,
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
      context,
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
    context: WarningContext,
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
      payload: undefined,
      context,
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
    context: WarningContext,
  ): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      payload: undefined,
      dropped: true,
      context,
    })
  }

  /**
   * Pairs every span that waits until the whole part is read: the hairpins,
   * the octave shifts, the slurs, and the ties. One entry point on purpose:
   * all four share the rule that nothing left open once the part ends may be
   * dropped in silence, and as separate calls a caller could pair the spans
   * yet never report what stayed unpaired, because each pair step reports
   * its own leftovers rather than leaving them to one flush at the end.
   */
  finish(measures: readonly Measure[], warnings: WarningCollector): void {
    this.#resolveWedges(measures, warnings)
    this.#resolveOttavas(measures, warnings)
    this.#resolveSlurs(warnings)
    this.#resolveTies(warnings)
  }

  /** Joins every hairpin in the part, once all of both ends are in. */
  #resolveWedges(measures: readonly Measure[], warnings: WarningCollector): void {
    // MNX allows a gradual mark with no end, so of the three failures only
    // the orphan stop drops anything whole: a hairpin whose stop is missing
    // or unusable keeps its mark, and what is lost is how far it runs. Today
    // a hairpin's stop covers the very point where it is written, so no stop
    // covers a point before its start; the backwards message is here for
    // when the two diverge, as an octave shift's do.
    const messages = {
      'orphan-stop': 'A hairpin stops where none had started, and is not carried over.',
      'backwards-stop':
        'A hairpin would end before it starts, its stop covering a point earlier ' +
        'than its start, so how far it runs is not carried over.',
      'unclosed-start':
        'A hairpin starts where nothing ends it, so how far it runs is not carried over.',
    }
    const closed = new Map<SpanEnd<Dynamic>, Dynamic>()
    pairSpans<Dynamic, WedgeEnd>(
      this.#wedgeEnds,
      (dynamic, stop) => {
        // The grace note the hairpin ends on is stated where the stop covers
        // one, and the key left off where it does not: MNX reads an absent
        // key as the beat itself. Assigned rather than spread in, so that the
        // compiler holds the difference between the two.
        const end: NonNullable<Dynamic['end']> = { measure: stop.measure, position: stop.covers }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        dynamic.end = end
        closed.set(stop, dynamic)
      },
      (reason, end) => {
        warnings.add('unclosed:spanner', messages[reason], end.context, 'wedge')
      },
    )

    // Wording written at a closing edge goes on the hairpin the pairing joins
    // to that stop. It is drawn on its own where the stop closed nothing, and
    // where the hairpin already carries wording from its starting edge: the
    // source wrote both, so the closing words do not overwrite the opening.
    for (const end of this.#wedgeEnds) {
      const wording = end.stop?.wording
      if (!wording) continue
      const hairpin = closed.get(end)
      if (hairpin && hairpin.suffix === undefined) hairpin.suffix = wording.text
      else insertAtPosition(measures[end.measure]?.dynamics, wording.standalone)
    }
    this.#wedgeEnds.length = 0
  }

  // Both ends of every octave shift in the part, paired the same way.
  readonly #ottavaEnds: SpanEnd<OpenOttava>[] = []

  startOttava(
    open: OpenOttava,
    number: string,
    measure: number,
    position: Fraction,
    context: WarningContext,
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
      context,
    })
  }

  stopOttava(
    number: string,
    measure: number,
    position: Fraction,
    cursor: Fraction,
    graceWritten: number,
    staff: number | undefined,
    context: WarningContext,
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
      payload: undefined,
      context,
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
    lastEventBefore: (position: Fraction, staff?: number) => CoveredEvent | undefined,
    graceNotesAt: (position: Fraction, staff?: number) => number,
  ): void {
    const overGraceNotes = (end: SpanEnd<unknown>): boolean => {
      if (!end.graceWritten) return false
      end.coversGraceIndex = graceNotesAt(end.covers, end.staff) - end.graceWritten + 1
      return true
    }

    // The sweep settles the stops of the measure just read, against that
    // measure's own events. A stop of any other measure is settled by the
    // sweep of its own, and settling it again here would move it to an event
    // of a measure it never reached.
    const stoppingHere = <E extends SpanEnd<unknown>>(ends: readonly E[]): E[] =>
      ends.filter((end) => end.kind === 'stop' && end.measure === measure)

    for (const end of stoppingHere(this.#wedgeEnds)) {
      overGraceNotes(end)
    }

    // Only an octave shift moves back off the point its stop was written at.
    //
    // Failing an event on the staff the stop names, the last on any staff.
    // A source can name a staff that holds nothing here: poldowski-l-heure-
    // exquise stops two shifts on staff 2 over a measure whose staff 2 is one
    // whole-measure rest, and MNX writes such a rest as the measure's own
    // rather than as an event. Leaving the stop where it was written ended
    // those shifts on the bar line, which is a place no event begins. The
    // fallback is the one the pairing already makes for the same reason: a
    // source naming the staff on one end only means the end that names it.
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
    context: WarningContext,
  ): void {
    this.#ottavaEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      payload: undefined,
      dropped: true,
      context,
    })
  }

  /**
   * Joins every octave shift in the part, putting each finished one on the
   * measure it begins in. Unlike a hairpin, MNX requires a shift to say where
   * it stops, so one the source never closed cannot be written at all.
   */
  #resolveOttavas(measures: readonly Measure[], warnings: WarningCollector): void {
    pairSpans<OpenOttava, SpanEnd<OpenOttava>>(
      this.#ottavaEnds,
      (open, stop) => {
        // Assigned rather than spread in, for the reason the hairpin's end is.
        const end: Ottava['end'] = { measure: stop.measure, position: stop.covers }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        const ottava: Draft<Ottava> = {
          position: open.position,
          end,
          value: open.value,
          staff: open.staff,
        }
        if (open.orient !== undefined) ottava.orient = open.orient
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
          end.context,
          'octave-shift',
        )
      },
    )
    this.#ottavaEnds.length = 0
  }
}

/**
 * Deterministic ids, in document order, so that converting the same file
 * twice gives byte-for-byte the same output.
 */
export class IdGenerator {
  #events = 0
  #notes = 0

  nextEvent(): string {
    this.#events += 1
    return `ev${String(this.#events)}`
  }

  nextNote(): string {
    this.#notes += 1
    return `note${String(this.#notes)}`
  }
}
