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
  Dynamic,
  Event,
  LineType,
  Measure,
  Note,
  OttavaAmount,
  Pitch,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'

interface OpenTie {
  note: Note
  /** The voice the tie starts in, to tell a tie that crosses voices. */
  voice: string | undefined
  /** The side the tie is drawn on, where the start states it. */
  side: CurveSide | undefined
  context: WarningContext
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

/** One end of a slur, and on a stop what that end states. */
interface SlurEnd extends SpanEnd<OpenSlur> {
  /** Where the document writes it, which orders two ends at one point. */
  read: number
  /** The voice it is written in, which pairs a voice's own slurs first. */
  voice?: string | undefined
  stop?: {
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
 * Several may carry the same number at once, so each number holds a stack and
 * a stop closes the most recently opened.
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

    const started = open.get(end.number)?.pop()
    if (!started) {
      report('orphan-stop', end)
      continue
    }
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

function inTimeOrder<T, E extends SpanEnd<T>>(ends: readonly E[], atSamePoint: SamePoint): E[] {
  return ends
    .map((end, index) => ({ end, index }))
    .sort((a, b) => {
      if (a.end.measure !== b.end.measure) return a.end.measure - b.end.measure
      const byPosition = compareFractions(a.end.position, b.end.position)
      if (byPosition !== 0) return byPosition
      if (atSamePoint === 'stop-first' && a.end.kind !== b.end.kind) {
        return a.end.kind === 'stop' ? -1 : 1
      }
      return a.index - b.index
    })
    .map((entry) => entry.end)
}

// Ties are matched on pitch across the part, not within a voice. A tie
// routinely runs between voices, which MNX itself allows for with a
// crossVoice target type, and piano writing is full of them: the seed corpus
// fails to resolve 30 of 108 ties when the voice is part of the match,
// against 4 when it is not.
function tieKey(pitch: Pitch): string {
  return `${pitch.step}${String(pitch.octave)}|${String(pitch.alter)}`
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
  // Two ties of one pitch can be open at once, as when two hands each sustain
  // it, so each pitch holds a stack rather than a single open tie: keyed by a
  // single value, the second start would overwrite the first and drop it with
  // no warning.
  readonly #openTies = new Map<string, OpenTie[]>()
  // Both ends of every slur in the part, paired once all of them are in.
  readonly #slurEnds: SlurEnd[] = []
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: WedgeEnd[] = []

  startTie(
    note: Note,
    voice: string | undefined,
    side: CurveSide | undefined,
    context: WarningContext,
  ): void {
    const key = tieKey(note.pitch)
    this.#openTies.set(key, [...(this.#openTies.get(key) ?? []), { note, voice, side, context }])
  }

  /** Joins the tie waiting on this pitch, if one is. */
  stopTie(
    note: Note,
    voice: string | undefined,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    const open = this.#openTies.get(tieKey(note.pitch)) ?? []
    // Prefer the most recent start in the same voice, so two hands each
    // sustaining one pitch pair within a hand rather than across. A tie that
    // finds no same-voice start falls back to the most recent open one, which
    // is the cross-voice case MNX marks. Voices are compared the way sequences
    // are bucketed: a note stating no voice and one stating an empty voice are
    // both the unnamed voice.
    let chosen = open.length - 1
    for (let index = open.length - 1; index >= 0; index -= 1) {
      if ((open[index]?.voice ?? '') === (voice ?? '')) {
        chosen = index
        break
      }
    }
    const started = open[chosen]
    if (!started) {
      warnings.add(
        'unclosed:spanner',
        'A tie ends on a note where none had started, and is not carried over.',
        context,
        'tie',
      )
      return
    }

    const crossVoice = (started.voice ?? '') !== (voice ?? '')
    started.note.ties = [
      ...started.note.ties,
      {
        target: note.id,
        crossVoice,
        ...(started.side !== undefined ? { side: started.side } : {}),
      },
    ]
    open.splice(chosen, 1)
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
    context: WarningContext,
  ): void {
    this.#slurEnds.push({
      kind: 'start',
      read: this.#slurEnds.length,
      number,
      measure,
      position,
      voice,
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
    context: WarningContext,
  ): void {
    this.#slurEnds.push({
      kind: 'stop',
      read: this.#slurEnds.length,
      number,
      measure,
      position,
      voice,
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
   * Each voice pairs its own slurs first. A slur that opens and closes in one
   * voice is that voice's beyond doubt, and exporters reuse one number in
   * every voice, so pairing the part as a single stream lets one voice's stop
   * close another's start. What no voice accounts for is what genuinely runs
   * between them, and that pairs across the part afterwards.
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

    const byVoice = new Map<string, SlurEnd[]>()
    for (const end of this.#slurEnds) {
      const voice = end.voice ?? ''
      byVoice.set(voice, [...(byVoice.get(voice) ?? []), end])
    }

    // What one voice cannot account for on its own, kept for the pass across
    // the part rather than reported: another voice may well close it. Put
    // back in the order the document has, because it comes out of the voices
    // a voice at a time, and two ends at one point are settled by which the
    // document writes first.
    const crossing: SlurEnd[] = []
    for (const ends of byVoice.values()) {
      // A grace note begins where the note it ornaments begins, so a slur
      // between the two has both ends at one point.
      pairSpans<OpenSlur, SlurEnd>(ends, join, (_reason, end) => crossing.push(end), 'as-written')
    }
    crossing.sort((a, b) => a.read - b.read)
    pairSpans<OpenSlur, SlurEnd>(
      crossing,
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
    context: WarningContext,
  ): WedgeStop {
    const stop: WedgeStop = {}
    this.#wedgeEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      covers: position,
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
    context: WarningContext,
  ): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      payload: undefined,
      dropped: true,
      context,
    })
  }

  /**
   * Pairs every span that waits until the whole part is read, the hairpins and
   * the octave shifts, and reports whatever is still open, the ties and slurs
   * with them. One entry point on purpose: the three share the rule that
   * nothing left open once the part ends may be dropped in silence, and as
   * three separate calls a caller could pair the spans yet never report what
   * stayed unpaired, because each pair step reports its own leftovers rather
   * than leaving them to one flush at the end.
   */
  finish(measures: readonly Measure[], warnings: WarningCollector): void {
    this.#resolveWedges(measures, warnings)
    this.#resolveOttavas(measures, warnings)
    this.#resolveSlurs(warnings)
    this.#reportUnclosed(warnings)
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
        dynamic.end = { measure: stop.measure, position: stop.covers }
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
      payload: open,
      context,
    })
  }

  stopOttava(
    number: string,
    measure: number,
    position: Fraction,
    covers: Fraction,
    context: WarningContext,
  ): void {
    this.#ottavaEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      covers,
      payload: undefined,
      context,
    })
  }

  /** The same as dropWedgeStart, for an octave shift the reader dropped. */
  dropOttavaStart(
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
        measures[open.measure]?.ottavas.push({
          position: open.position,
          end: { measure: stop.measure, position: stop.covers },
          value: open.value,
          staff: open.staff,
          ...(open.orient !== undefined ? { orient: open.orient } : {}),
        })
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

  /**
   * Reports whatever is still open once the part is read. Real scores do
   * contain these, so they are worth saying rather than worth refusing.
   */
  #reportUnclosed(warnings: WarningCollector): void {
    for (const waiting of this.#openTies.values()) {
      for (const open of waiting) {
        warnings.add(
          'unclosed:spanner',
          'A tie starts on a note that nothing ties to, and is not carried over.',
          open.context,
          'tie',
        )
      }
    }
    this.#openTies.clear()
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
